/* MatchDO: one Durable Object per match. Holds the authoritative game state,
 * validates every move with the server-side rule copy, and maintains the
 * SHA-256 hash chain that anyone can replay from GET /api/match/:id/log.
 *
 * Persistence: a single `match` record in state.storage (restart-safe). Room
 * logs are kept for LOG_TTL_MS (24 h) and then deleted by an alarm.
 * No IP address is ever stored here; the only identity is the self-reported
 * agent.id string (<= 64 printable chars).
 */
import './rules/core.js';

const CORE = globalThis.AgentNetCore;

const SEATS = ['p1', 'p2'];
const MAX_SOCKETS_PER_ROOM = 8;
const MAX_MESSAGE_BYTES = 8192;
const MAX_ID_CHARS = 64;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (e) {
    // Socket already closed; the close handler owns cleanup.
  }
}

// Strips C0/C1 control characters, trims, and enforces a length budget.
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  if (!text || text.length > max) return null;
  return text;
}

export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._match = null;
    this._tail = Promise.resolve();
  }

  // Durable Objects can interleave at await points even though they are
  // single-threaded; serialise seat assignment, moves and alarms explicitly.
  withLock(fn) {
    const run = this._tail.then(() => fn());
    this._tail = run.then(() => undefined, () => undefined);
    return run;
  }

  cfg(name, fallback) {
    const raw = this.env ? this.env[name] : undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  async load() {
    if (this._match) return this._match;
    const stored = await this.state.storage.get('match');
    this._match = stored || null;
    return this._match;
  }

  async save(match) {
    this._match = match;
    await this.state.storage.put('match', match);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ws')) return this.handleSocket(request);
    if (url.pathname.endsWith('/log')) {
      return this.withLock(() => this.handleLog());
    }
    if (url.pathname.endsWith('/init')) {
      return this.withLock(() => this.handleInit(request));
    }
    return json({ error: 'not_found' }, 404);
  }

  async handleInit(request) {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'bad_request' }, 400);
    }
    const matchId = body && body.matchId;
    const game = body && body.game;
    const seed = body && body.seed;
    if (typeof matchId !== 'string' || !CORE.isGame(game) || typeof seed !== 'string') {
      return json({ error: 'bad_request' }, 400);
    }
    let match = await this.load();
    if (match) {
      return json({ ok: true, idempotent: true, matchId: match.meta.matchId });
    }
    const now = Date.now();
    match = {
      meta: {
        matchId: matchId,
        game: game,
        seed: seed,
        createdAt: now,
        version: 1,
      },
      state: CORE.createGame(game),
      moves: [],
      hashChain: [],
      hash: await CORE.genesisHash(game, seed),
      started: false,
      over: false,
      result: null,
      logHash: null,
      seats: { p1: null, p2: null },
      moveDeadline: null,
      joinDeadline: now + this.cfg('JOIN_TIMEOUT_MS', 600000),
      disconnectedSince: null,
      logExpiresAt: now + this.cfg('LOG_TTL_MS', 86400000),
    };
    await this.save(match);
    await this.scheduleAlarm(match, now);
    return json({ ok: true, matchId: matchId });
  }

  async handleSocket(request) {
    const match = await this.load();
    if (!match) return json({ error: 'not_found' }, 404);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'upgrade_required' }, 426);
    }
    if (this.state.getWebSockets().length >= MAX_SOCKETS_PER_ROOM) {
      return json({ error: 'room_full' }, 503);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ seat: null, agentId: null, name: null });
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleLog() {
    const match = await this.load();
    if (!match) return json({ error: 'not_found' }, 404);
    return json({
      game: match.meta.game,
      seed: match.meta.seed,
      matchId: match.meta.matchId,
      createdAt: match.meta.createdAt,
      genesisHash: await CORE.genesisHash(match.meta.game, match.meta.seed),
      moves: match.moves,
      hashChain: match.hashChain,
      finalHash: match.hash,
      started: match.started,
      over: match.over,
      result: match.result,
      logHash: match.logHash,
    });
  }

  roomMessage(match, seat) {
    return {
      t: 'room',
      matchId: match.meta.matchId,
      seat: seat,
      state: match.state,
      legal: match.started && !match.over ? CORE.legalActions(match.state) : [],
      turn: match.state.turn,
      n: match.moves.length,
      hash: match.hash,
    };
  }

  stateMessage(match) {
    return {
      t: 'state',
      state: match.state,
      legal: match.over ? [] : CORE.legalActions(match.state),
      turn: match.state.turn,
      n: match.moves.length,
      hash: match.hash,
    };
  }

  resultMessage(match) {
    const result = match.result || {};
    return {
      t: 'result',
      winner: result.winner || null,
      draw: !!result.draw,
      byTimeout: !!result.byTimeout,
      moves: match.moves,
      hashChain: match.hashChain,
      logHash: match.logHash,
    };
  }

  broadcast(match, message) {
    const data = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (!att.seat) continue;
      try {
        ws.send(data);
      } catch (e) {
        // Dead socket; the close handler will reconcile.
      }
    }
  }

  connectedSeats(exclude) {
    const seats = new Set();
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const att = ws.deserializeAttachment() || {};
      if (att.seat && ws.readyState === 1) seats.add(att.seat);
    }
    return seats;
  }

  socketForSeat(seat, exclude) {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const att = ws.deserializeAttachment() || {};
      if (att.seat === seat && ws.readyState === 1) return ws;
    }
    return null;
  }

  fail(ws, code) {
    send(ws, { t: 'error', code: code });
  }

  async webSocketMessage(ws, raw) {
    return this.withLock(() => this.dispatch(ws, raw));
  }

  async dispatch(ws, raw) {
    const match = await this.load();
    if (!match) {
      this.fail(ws, 'bad_hello');
      return;
    }
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) {
      this.fail(ws, 'bad_hello');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      this.fail(ws, 'bad_hello');
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      this.fail(ws, 'bad_hello');
      return;
    }
    const att = ws.deserializeAttachment() || {};
    if (msg.t === 'hello') return this.handleHello(ws, msg, att, match);
    if (!att.seat) {
      this.fail(ws, 'bad_hello');
      return;
    }
    if (msg.t === 'move') return this.handleMove(ws, msg, att, match);
    this.fail(ws, 'bad_hello');
  }

  async handleHello(ws, msg, att, match) {
    if (msg.v !== 1) return this.fail(ws, 'bad_hello');
    const agent = msg.agent && typeof msg.agent === 'object' ? msg.agent : {};
    const agentId = cleanText(agent.id, MAX_ID_CHARS);
    if (!agentId) return this.fail(ws, 'bad_hello');
    const agentName = cleanText(agent.name, MAX_ID_CHARS) || agentId;
    if (msg.game !== match.meta.game) return this.fail(ws, 'bad_hello');
    if (msg.seed !== undefined && String(msg.seed) !== match.meta.seed) {
      return this.fail(ws, 'bad_hello');
    }
    if (msg.seat !== undefined && msg.seat !== 'p1' && msg.seat !== 'p2') {
      return this.fail(ws, 'bad_hello');
    }

    // A socket keeps its claimed seat; re-hello on it is a resync only.
    if (att.seat) {
      if (att.agentId !== agentId) return this.fail(ws, 'bad_hello');
      this.sendRoomAndMaybeResult(ws, match, att.seat);
      return;
    }

    let seat = null;
    for (const s of SEATS) {
      if (match.seats[s] && match.seats[s].agentId === agentId) seat = s;
    }
    if (!seat && msg.seat && !match.seats[msg.seat]) seat = msg.seat;
    if (!seat && !match.seats.p1) seat = 'p1';
    if (!seat && !match.seats.p2) seat = 'p2';
    if (!seat) {
      send(ws, { t: 'error', code: 'room_full' });
      try { ws.close(4001, 'room_full'); } catch (e) {}
      return;
    }

    const holder = match.seats[seat];
    if (holder && holder.agentId !== agentId) {
      send(ws, { t: 'error', code: 'room_full' });
      try { ws.close(4001, 'room_full'); } catch (e) {}
      return;
    }
    // One agent id cannot own both seats (blocks the cheapest self-play loop).
    const other = CORE.otherSeat(seat);
    if (match.seats[other] && match.seats[other].agentId === agentId) {
      send(ws, { t: 'error', code: 'room_full' });
      try { ws.close(4001, 'room_full'); } catch (e) {}
      return;
    }

    const now = Date.now();
    const replaced = this.socketForSeat(seat, ws);
    if (replaced) {
      try {
        replaced.close(4003, 'replaced');
      } catch (e) {}
    }

    if (!holder) {
      match.seats[seat] = { agentId: agentId, name: agentName, claimedAt: now, lastSeenAt: now };
    } else {
      match.seats[seat].name = agentName;
      match.seats[seat].lastSeenAt = now;
    }
    ws.serializeAttachment({ seat: seat, agentId: agentId, name: agentName });
    match.disconnectedSince = null;

    let startedNow = false;
    if (!match.started && match.seats.p1 && match.seats.p2) {
      match.started = true;
      match.moveDeadline = now + this.cfg('MOVE_TIMEOUT_MS', 60000);
      startedNow = true;
    }
    await this.save(match);
    send(ws, this.roomMessage(match, seat));
    if (startedNow) this.broadcast(match, this.stateMessage(match));
    if (match.over) send(ws, this.resultMessage(match));
    await this.scheduleAlarm(match, now);
  }

  sendRoomAndMaybeResult(ws, match, seat) {
    send(ws, this.roomMessage(match, seat));
    if (match.over) send(ws, this.resultMessage(match));
  }

  async handleMove(ws, msg, att, match) {
    if (!match.started) return this.fail(ws, 'not_your_turn');
    if (match.over) return this.fail(ws, 'game_over');
    if (att.seat !== match.state.turn) return this.fail(ws, 'not_your_turn');

    const result = CORE.applyMove(match.state, msg.id);
    if (!result.ok) {
      return this.fail(ws, result.code === 'game_over' ? 'game_over' : 'illegal_action');
    }

    const n = match.moves.length + 1;
    const hash = await CORE.chainNext(match.hash, result.state, n);
    match.state = result.state;
    match.moves.push({ n: n, seat: att.seat, id: result.action.id });
    match.hashChain.push(hash);
    match.hash = hash;

    const now = Date.now();
    let finished = false;
    if (result.state.over) {
      finished = true;
      match.over = true;
      match.result = {
        winner: result.state.winner || null,
        draw: !!result.state.draw,
        byTimeout: false,
      };
      match.moveDeadline = null;
      match.logExpiresAt = now + this.cfg('LOG_TTL_MS', 86400000);
      match.logHash = await CORE.computeLogHash({
        game: match.meta.game,
        seed: match.meta.seed,
        matchId: match.meta.matchId,
        moves: match.moves,
        hashChain: match.hashChain,
        result: match.result,
      });
    } else {
      match.moveDeadline = now + this.cfg('MOVE_TIMEOUT_MS', 60000);
    }

    await this.save(match);
    this.broadcast(match, this.stateMessage(match));
    if (finished) {
      this.broadcast(match, this.resultMessage(match));
      await this.releaseRegistry(match.meta.matchId);
    }
    await this.scheduleAlarm(match, now);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code || 1000, typeof reason === 'string' ? reason.slice(0, 80) : ''); } catch (e) {}
    await this.withLock(() => this.afterDisconnect(ws));
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'websocket_error'); } catch (e) {}
    await this.withLock(() => this.afterDisconnect(ws));
  }

  async afterDisconnect(ws) {
    const match = await this.load();
    if (!match) return;
    const connected = this.connectedSeats(ws);
    const now = Date.now();
    if (connected.size === 0) {
      if (!match.disconnectedSince) match.disconnectedSince = now;
    } else {
      match.disconnectedSince = null;
    }
    await this.save(match);
    await this.scheduleAlarm(match, now);
  }

  async alarm() {
    await this.withLock(() => this.handleAlarm());
  }

  async handleAlarm() {
    const match = await this.load();
    const now = Date.now();
    if (!match) {
      await this.state.storage.deleteAll();
      return;
    }

    if (match.over) {
      if (now >= match.logExpiresAt) {
        await this.state.storage.deleteAll();
        this._match = null;
        return;
      }
      await this.scheduleAlarm(match, now);
      return;
    }

    if (!match.started && now >= match.joinDeadline) {
      await this.abandon(match);
      return;
    }

    if (match.started && match.moveDeadline) {
      // When both seats are offline, the 5-minute reclamation rule wins: do
      // not award a timeout win to nobody's benefit. One side offline still
      // times out normally, so a ghost player cannot stall a live opponent.
      const bothOffline = !!match.disconnectedSince && this.connectedSeats().size === 0;
      const timeout = bothOffline ? null : CORE.timeoutResult(match.state, now, match.moveDeadline);
      if (timeout) {
        match.over = true;
        match.result = { winner: timeout.winner, draw: false, byTimeout: true, loser: timeout.loser };
        match.moveDeadline = null;
        match.logExpiresAt = now + this.cfg('LOG_TTL_MS', 86400000);
        match.logHash = await CORE.computeLogHash({
          game: match.meta.game,
          seed: match.meta.seed,
          matchId: match.meta.matchId,
          moves: match.moves,
          hashChain: match.hashChain,
          result: match.result,
        });
        await this.save(match);
        this.broadcast(match, this.resultMessage(match));
        await this.releaseRegistry(match.meta.matchId);
        await this.scheduleAlarm(match, now);
        return;
      }
    }

    if (match.disconnectedSince) {
      const reclaimAt = match.disconnectedSince + this.cfg('ROOM_RECLAIM_MS', 300000);
      if (now >= reclaimAt) {
        await this.abandon(match);
        return;
      }
    }

    await this.scheduleAlarm(match, now);
  }

  async abandon(match) {
    const matchId = match.meta.matchId;
    for (const ws of this.state.getWebSockets()) {
      try { ws.close(4000, 'room_closed'); } catch (e) {}
    }
    await this.state.storage.deleteAll();
    this._match = null;
    await this.releaseRegistry(matchId);
  }

  async scheduleAlarm(match, now) {
    const candidates = [];
    const bothOffline = !!match.disconnectedSince && this.connectedSeats().size === 0;
    if (match.over) {
      candidates.push(match.logExpiresAt);
    } else {
      if (!match.started) candidates.push(match.joinDeadline);
      // Skip a past move deadline while both seats are offline, otherwise the
      // alarm would re-arm itself every 50 ms until the reclaim window ends.
      if (match.started && match.moveDeadline && !bothOffline) candidates.push(match.moveDeadline);
      if (match.disconnectedSince) {
        candidates.push(match.disconnectedSince + this.cfg('ROOM_RECLAIM_MS', 300000));
      }
      candidates.push(match.logExpiresAt);
    }
    const valid = candidates.filter((t) => Number.isFinite(t));
    if (!valid.length) return;
    let at = Math.min.apply(null, valid);
    if (at <= now) at = now + 50;
    try {
      const current = await this.state.storage.getAlarm();
      if (current === null || Math.abs(current - at) > 20) {
        await this.state.storage.setAlarm(at);
      }
    } catch (e) {
      // Alarm scheduling failure must not corrupt the match; next event retries.
    }
  }

  async releaseRegistry(matchId) {
    try {
      const id = this.env.REGISTRY.idFromName('registry');
      await this.env.REGISTRY.get(id).fetch('https://registry.internal/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchId: matchId }),
      });
    } catch (e) {
      // Registry has its own age-based pruning; a missed release self-heals.
    }
  }
}
