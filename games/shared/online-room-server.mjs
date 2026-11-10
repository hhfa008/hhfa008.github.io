#!/usr/bin/env node
/*
 * Shared online room server for turn-based boardgames.
 *
 * One server implementation, one contract. Each game supplies a small adapter
 * (createMatch / view / applyAction / aiAction / result) and gets the same
 * room, invite, password, reconnect, AI fill, timeout takeover, rematch and
 * leaderboard behaviour as every other premium game. No game copies this file.
 *
 * Transport: HTTP/JSON with short polling. Server-authoritative: rules run on
 * the server, the client only renders adapter.view(). The adapter decides what
 * is private; the server never merges hidden state into a public view.
 *
 *   POST   /api/rooms                    create (host seat)
 *   POST   /api/rooms/:id/join           join with invite token or password
 *   GET    /api/rooms/:id                room + viewer-specific public state
 *   POST   /api/rooms/:id/start          host starts, empty seats become AI
 *   POST   /api/rooms/:id/actions        { action, idempotencyKey? }
 *   POST   /api/rooms/:id/reconnect      session reconnect, clears takeover
 *   POST   /api/rooms/:id/leave          seat becomes AI
 *   POST   /api/rooms/:id/invite         host creates a new single-use invite
 *   POST   /api/rooms/:id/tick           force an AI step (poll/E2E helper)
 *   POST   /api/rooms/:id/restart        host rematch
 *   DELETE /api/rooms/:id                host closes
 *   GET    /api/leaderboard?game=slug
 *   GET    /health | /api/health
 *
 * Adapter contract (see the four premium online-server.mjs wrappers):
 *   slug, title, minPlayers, maxPlayers, defaultPlayers
 *   aiNames[]
 *   seatCount({ humans }) -> total seats to play with
 *   createMatch({ seed, seats: [{ name, ai }] }) -> match
 *   view(match, seatIndex) -> JSON public view
 *   legalActions(match, seatIndex) -> array
 *   applyAction(match, seatIndex, action) -> { ok, error?, over? }
 *   aiAction(match, seatIndex) -> action | null
 *   isOver(match) -> boolean
 *   result(match) -> { winnerSeat, winnerName, tied, scores, rounds, turns }
 *   restart(match) -> new match
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(__dirname, '..');
const BOARD_ROOT = path.join(GAMES_ROOT, 'boardgame');
const MAX_BODY = 64 * 1024;
const MAX_LEADERBOARD = 200;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8'
};

function randomHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }
function fail(message, code, status) {
  return { ok: false, error: { code: code || 'E_ROOM', message: message }, status: status || 409 };
}
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}
function sendError(res, failure) {
  const f = failure || {};
  sendJson(res, f.status || 409, {
    ok: false,
    error: {
      code: f.code || (f.error && f.error.code) || 'E_ROOM',
      message: f.message || (f.error && f.error.message) || 'room operation rejected'
    }
  });
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { code: 'E_BODY' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(Object.assign(new Error('invalid JSON'), { code: 'E_JSON' })); }
    });
    req.on('error', reject);
  });
}

function normalizeAdapter(adapter) {
  if (!adapter || !adapter.slug) throw new Error('online server: adapter.slug is required');
  const a = Object.assign({}, adapter);
  a.minPlayers = Math.max(1, Number(a.minPlayers) || 2);
  a.maxPlayers = Math.max(a.minPlayers, Number(a.maxPlayers) || a.minPlayers);
  a.defaultPlayers = Math.max(a.minPlayers, Math.min(a.maxPlayers, Number(a.defaultPlayers) || a.minPlayers));
  a.aiNames = Array.isArray(a.aiNames) && a.aiNames.length
    ? a.aiNames.slice()
    : ['AI · 一号', 'AI · 二号', 'AI · 三号', 'AI · 四号', 'AI · 五号', 'AI · 六号', 'AI · 七号', 'AI · 八号', 'AI · 九号', 'AI · 十号'];
  if (typeof a.seatCount !== 'function') a.seatCount = ({ humans }) => Math.max(a.minPlayers, Math.min(a.maxPlayers, Math.max(a.defaultPlayers, humans)));
  if (typeof a.view !== 'function') a.view = () => ({});
  if (typeof a.legalActions !== 'function') a.legalActions = () => [];
  if (typeof a.aiAction !== 'function') throw new Error('online server: adapter.aiAction is required for AI fill');
  if (typeof a.isOver !== 'function') a.isOver = (m) => !!(m && m.over);
  if (typeof a.result !== 'function') a.result = () => ({ winnerSeat: null, winnerName: null, tied: true, scores: [], rounds: 0, turns: 0 });
  if (typeof a.restart !== 'function') a.restart = (m) => a.createMatch({ seed: Date.now(), seats: (m.seats || []).map((s) => ({ name: s.name, ai: s.ai })) });
  return a;
}

export function createOnlineServer(options) {
  const opts = options || {};
  const adapter = normalizeAdapter(opts.adapter);
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 550);
  const maxRooms = Math.max(4, Number(opts.maxRooms) || 200);
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  const seenResults = new Set();
  let seq = 0;
  let stateSeq = 0;

  // The generic room store is a CommonJS module with its own state machine.
  const roomsModule = require(path.join(BOARD_ROOT, 'app', 'rooms.js'));
  const roomStore = opts.roomStore || roomsModule.createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: adapter.maxPlayers
  });

  function issueSession(roomId, playerId) {
    const token = 'bg_sess_' + (++seq) + '_' + randomHex(9);
    sessions.set(token, { roomId: roomId, playerId: playerId, createdAt: Date.now() });
    return token;
  }
  function sessionFor(token) {
    return typeof token === 'string' && token ? sessions.get(token) || null : null;
  }
  function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }
  function roomOf(id) { return rooms.get(id) || null; }
  function seatOfPlayer(rs, playerId) {
    return rs.seats.find((seat) => seat.playerId === playerId) || null;
  }
  function humanSeats(rs) { return rs.seats.filter((seat) => !seat.ai); }
  function viewerSeat(rs, playerId) {
    const seat = seatOfPlayer(rs, playerId);
    return seat ? seat.index : null;
  }
  function actor(req, body, rs, query) {
    const b = body || {};
    const q = query || new URLSearchParams();
    const token = b.session || b.token || q.get('session') || q.get('token') ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const playerId = b.playerId || q.get('playerId');
    const session = sessionFor(token);
    if (!session || session.roomId !== rs.id) {
      return fail('valid room session required', 'E_SESSION', 401);
    }
    if (playerId && playerId !== session.playerId) {
      return fail('session does not belong to this player', 'E_SESSION', 401);
    }
    const seat = seatOfPlayer(rs, session.playerId);
    if (!seat) return fail('player is not seated', 'E_SEAT', 403);
    return { ok: true, playerId: session.playerId, seat: seat, token: token };
  }

  function assignSeats(rs) {
    const room = rs.roomData || (rs.roomData = roomStore.get(rs.id));
    const players = room ? room.players.slice() : [];
    rs.seats.forEach((seat) => {
      if (seat.playerId && players.indexOf(seat.playerId) === -1) {
        seat.playerId = null;
        seat.ai = true;
        seat.nickname = adapter.aiNames[seat.index] || ('AI · 座位 ' + (seat.index + 1));
      }
    });
    players.forEach((playerId) => {
      if (rs.seats.some((seat) => seat.playerId === playerId)) return;
      const free = rs.seats.find((seat) => !seat.playerId && seat.ai);
      if (!free) return;
      free.playerId = playerId;
      free.ai = false;
      free.nickname = (rs.roomData && rs.roomData.nicknames && rs.roomData.nicknames[playerId]) || ('玩家 ' + (free.index + 1));
    });
  }

  function makeSeats(rs, count) {
    const seats = [];
    for (let i = 0; i < count; i += 1) {
      const existing = rs.seats[i];
      if (existing && !existing.ai) {
        seats.push({ name: existing.nickname, ai: false });
        existing.name = existing.nickname;
      } else {
        const name = adapter.aiNames[i] || ('AI · 座位 ' + (i + 1));
        seats.push({ name: name, ai: true });
        rs.seats[i] = { index: i, playerId: null, nickname: name, ai: true, name: name };
      }
    }
    rs.seats.length = count;
    return seats;
  }

  function createMatchFor(rs) {
    const humans = rs.seats.filter((seat) => !seat.ai).length;
    const count = Math.max(adapter.minPlayers, Math.min(adapter.maxPlayers, adapter.seatCount({ humans: humans, seats: rs.seats.slice() })));
    const seats = makeSeats(rs, count);
    const match = adapter.createMatch({ seed: (Date.now() ^ (++stateSeq * 2654435761)) >>> 0, seats: seats });
    match.seats = seats;
    rs.match = match;
    rs.started = true;
    rs.over = false;
    rs.result = null;
    rs.stateVersion = (rs.stateVersion || 0) + 1;
    rs.lastAction = { type: 'start', at: Date.now(), stateVersion: rs.stateVersion };
    rs.takeover = {};
    rs.startedAt = Date.now();
  }

  function tickRoom(rs, force) {
    if (!rs.started || !rs.match) return;
    let steps = 0;
    while (steps < 80 && !adapter.isOver(rs.match)) {
      let acted = false;
      const order = rs.seats.map((seat) => seat.index);
      for (const index of order) {
        const seat = rs.seats[index];
        if (!seat || !seat.ai) continue;
        const action = adapter.aiAction(rs.match, index);
        if (action == null) continue;
        const applied = adapter.applyAction(rs.match, index, action);
        if (applied && applied.ok === false) continue;
        acted = true;
        steps += 1;
        rs.stateVersion = (rs.stateVersion || 0) + 1;
        rs.lastAction = { type: 'ai', seat: index, at: Date.now(), stateVersion: rs.stateVersion, action: action };
        if (adapter.isOver(rs.match)) break;
      }
      if (!acted) break;
      if (!force && aiDelayMs > 0 && steps > 24) break;
    }
    if (adapter.isOver(rs.match)) finishRoom(rs);
  }

  function finishRoom(rs) {
    if (rs.over) return;
    rs.over = true;
    rs.result = adapter.result(rs.match);
    rs.stateVersion = (rs.stateVersion || 0) + 1;
    rs.lastAction = { type: 'over', at: Date.now(), stateVersion: rs.stateVersion };
    if (!seenResults.has(rs.id)) {
      seenResults.add(rs.id);
      rs.seats.forEach((seat, index) => {
        const entry = {
          game: adapter.slug,
          roomId: rs.id,
          seat: index,
          name: seat.nickname || seat.name || ('座位 ' + (index + 1)),
          ai: Boolean(seat.ai),
          playerId: seat.ai ? null : 'sha256:' + sha256(seat.playerId).slice(0, 16),
          winner: rs.result && rs.result.winnerSeat === index,
          score: rs.result && Array.isArray(rs.result.scores) ? rs.result.scores[index] : null,
          at: Date.now()
        };
        leaderboard.unshift(entry);
      });
      while (leaderboard.length > MAX_LEADERBOARD) leaderboard.pop();
    }
  }

  function publicRoom(rs, viewerId) {
    const seatIndex = viewerId ? viewerSeat(rs, viewerId) : null;
    const state = rs.match ? adapter.view(rs.match, seatIndex) : null;
    const canMove = Boolean(rs.started && !rs.over && seatIndex != null && rs.seats[seatIndex] && !rs.seats[seatIndex].ai);
    const legal = canMove ? adapter.legalActions(rs.match, seatIndex) : [];
    return {
      ok: true,
      roomId: rs.id,
      code: rs.code,
      game: adapter.slug,
      hostId: rs.hostId,
      started: rs.started,
      over: rs.over,
      playerCount: rs.seats.length,
      seats: rs.seats.map((seat) => ({
        index: seat.index,
        name: seat.nickname || seat.name,
        ai: Boolean(seat.ai),
        isHost: seat.playerId != null && seat.playerId === rs.hostId,
        isYou: viewerId != null && seat.playerId === viewerId,
        connected: seat.ai || rs.lastSeen.has(seat.playerId)
      })),
      you: seatIndex,
      state: state,
      legalActions: legal,
      stateVersion: rs.stateVersion || 0,
      lastAction: rs.lastAction || null,
      result: rs.result,
      canRestart: Boolean(rs.over && viewerId === rs.hostId),
      takeover: Object.keys(rs.takeover || {}).map(Number),
      inviteCode: rs.inviteCode || null,
      createdAt: rs.createdAt || null
    };
  }

  function roomView(rs, viewerId) {
    const body = publicRoom(rs, viewerId);
    if (rs.roomData) {
      body.room = {
        id: rs.roomData.id,
        code: rs.roomData.code,
        status: rs.roomData.status,
        visibility: rs.roomData.visibility,
        hasPassword: rs.roomData.hasPassword,
        players: rs.roomData.players.slice(),
        maxPlayers: rs.roomData.maxPlayers
      };
    }
    return body;
  }

  function createRoomRecord(hostId, nickname, visibility, password) {
    if (!hostId) return fail('playerId is required', 'E_PLAYER', 400);
    if (rooms.size >= maxRooms) return fail('server room limit reached', 'E_LIMIT', 503);
    let created;
    try {
      created = roomStore.create({
        hostId: hostId,
        gameId: adapter.slug,
        visibility: visibility === 'private' ? 'private' : 'public',
        password: password == null ? null : password,
        maxPlayers: adapter.maxPlayers,
        nickname: nickname
      });
    } catch (err) {
      return fail(err.message || 'room create failed', err.code || 'E_ROOM', 400);
    }
    const room = created.room;
    const token = created.invite && created.invite.token;
    const rs = {
      id: room.id,
      code: room.code,
      hostId: hostId,
      roomData: room,
      seats: [],
      match: null,
      started: false,
      over: false,
      result: null,
      stateVersion: 0,
      lastAction: null,
      lastSeen: new Map(),
      takeover: {},
      invites: new Set(),
      idempotency: new Map(),
      createdAt: Date.now()
    };
    rs.invites.add(token);
    rs.seats.push({ index: 0, playerId: hostId, nickname: nickname || '房主', ai: false, name: nickname || '房主' });
    for (let i = 1; i < adapter.maxPlayers; i += 1) {
      const name = adapter.aiNames[i] || ('AI · 座位 ' + (i + 1));
      rs.seats.push({ index: i, playerId: null, nickname: name, ai: true, name: name });
    }
    rs.inviteCode = token;
    rooms.set(rs.id, rs);
    return { ok: true, rs: rs, inviteToken: token };
  }

  function joinRoomRecord(rs, playerId, nickname, inviteCode, password) {
    if (!playerId) return fail('playerId is required', 'E_PLAYER', 400);
    const already = seatOfPlayer(rs, playerId);
    if (already) return { ok: true, rs: rs, seat: already.index, rejoin: true };
    if (rs.started) return fail('match already started', 'E_STARTED', 409);
    const free = rs.seats.find((seat) => seat.ai && seat.playerId == null);
    if (!free) return fail('room is full', 'E_FULL', 409);
    let result;
    if (inviteCode) {
      result = roomStore.consumeInvite(inviteCode, { playerId: playerId, nickname: nickname });
      // The lobby accepts either an invite token or the room id/code. If the
      // value was not an invite, fall back to the room's normal join guard
      // (password / visibility), so a short room code also works.
      if (!result || result.ok === false) {
        result = roomStore.join(rs.id, { playerId: playerId, nickname: nickname, password: password });
      }
    } else {
      result = roomStore.join(rs.id, { playerId: playerId, nickname: nickname, password: password });
    }
    if (result && result.ok === false) return fail(result.message || 'join rejected', result.code || 'E_JOIN', 409);
    free.playerId = playerId;
    free.ai = false;
    free.nickname = nickname || ('玩家 ' + (free.index + 1));
    free.name = free.nickname;
    rs.roomData = roomStore.get(rs.id) || rs.roomData;
    rs.invites.delete(inviteCode);
    return { ok: true, rs: rs, seat: free.index };
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch (err) { return sendError(res, fail('bad url', 'E_URL', 400)); }
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'public, max-age=86400' });
      res.end();
      return;
    }
    if (pathname === '/health' || pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        game: adapter.slug,
        rooms: rooms.size,
        started: Array.from(rooms.values()).filter((rs) => rs.started).length,
        uptimeSec: Math.round(process.uptime())
      });
    }
    if (pathname === '/api/leaderboard' && req.method === 'GET') {
      const game = url.searchParams.get('game') || adapter.slug;
      return sendJson(res, 200, {
        ok: true,
        game: game,
        entries: leaderboard.filter((entry) => entry.game === game).slice(0, 50)
      });
    }
    if (pathname === '/api/rooms' && req.method === 'POST') {
      return readJson(req).then((body) => {
        const nickname = body.nickname || ('房主-' + randomHex(2));
        const made = createRoomRecord(body.playerId, nickname, body.visibility, body.password);
        if (!made.ok) return sendError(res, made);
        const rs = made.rs;
        const session = issueSession(rs.id, body.playerId);
        rs.lastSeen.set(body.playerId, Date.now());
        sendJson(res, 201, Object.assign(roomView(rs, body.playerId), {
          playerId: body.playerId,
          session: session,
          inviteToken: made.inviteToken,
          inviteCode: made.inviteToken,
          inviteUrl: '/boardgame/' + adapter.slug + '/online.html?room=' + encodeURIComponent(rs.id) +
            '&code=' + encodeURIComponent(made.inviteToken)
        }));
      }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/([^/]+))?$/);
    if (roomMatch) {
      const roomKey = roomMatch[1];
      const actionName = roomMatch[2] || '';
      let rs = roomOf(roomKey);
      if (!rs) {
        const storeRoom = roomStore.get(roomKey);
        if (!storeRoom) return sendError(res, fail('room not found', 'E_NOT_FOUND', 404));
        rs = Array.from(rooms.values()).find((entry) => entry.code === storeRoom.code);
      }
      if (!rs) return sendError(res, fail('room not found', 'E_NOT_FOUND', 404));

      if (!actionName && req.method === 'GET') {
        const who = actor(req, {}, rs, url.searchParams);
        if (!who.ok) return sendError(res, who);
        rs.lastSeen.set(who.playerId, Date.now());
        return sendJson(res, 200, roomView(rs, who.playerId));
      }
      if (actionName === 'join' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const joined = joinRoomRecord(rs, body.playerId, body.nickname, body.inviteCode || body.code, body.password);
          if (!joined.ok) return sendError(res, joined);
          const session = issueSession(rs.id, body.playerId);
          rs.lastSeen.set(body.playerId, Date.now());
          sendJson(res, 200, Object.assign(roomView(rs, body.playerId), {
            playerId: body.playerId,
            session: session,
            seat: joined.seat,
            rejoin: Boolean(joined.rejoin)
          }));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'start' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.hostId) return sendError(res, fail('only the host can start', 'E_HOST', 403));
          if (rs.started) return sendError(res, fail('match already started', 'E_STARTED', 409));
          createMatchFor(rs);
          tickRoom(rs, true);
          rs.roomData = roomStore.get(rs.id) || rs.roomData;
          if (rs.roomData) { try { roomStore.start(rs.id, who.playerId); } catch (err) {} }
          sendJson(res, 200, roomView(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'actions' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          rs.lastSeen.set(who.playerId, Date.now());
          if (!rs.started) return sendError(res, fail('match has not started', 'E_STATE', 409));
          if (rs.over) return sendError(res, fail('match is over', 'E_STATE', 409));
          if (who.seat.ai) return sendError(res, fail('seat is under AI control', 'E_AI', 409));
          const key = body.idempotencyKey ? String(body.idempotencyKey) : null;
          if (key) {
            const prior = rs.idempotency.get(who.playerId + ':' + key);
            if (prior) return sendJson(res, prior.status, prior.body);
          }
          const applied = adapter.applyAction(rs.match, who.seat.index, body.action);
          if (applied && applied.ok === false) {
            return sendError(res, fail(applied.error || 'illegal action', applied.code || 'E_MOVE', 409));
          }
          rs.stateVersion = (rs.stateVersion || 0) + 1;
          rs.lastAction = { type: 'human', seat: who.seat.index, at: Date.now(), stateVersion: rs.stateVersion, action: body.action };
          tickRoom(rs, false);
          if (adapter.isOver(rs.match)) finishRoom(rs);
          const response = roomView(rs, who.playerId);
          if (key) rs.idempotency.set(who.playerId + ':' + key, { status: 200, body: response });
          sendJson(res, 200, response);
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'reconnect' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const token = body.session || body.token || url.searchParams.get('session');
          const session = sessionFor(token);
          if (!session || session.roomId !== rs.id) return sendError(res, fail('invalid session', 'E_SESSION', 401));
          const seat = seatOfPlayer(rs, session.playerId);
          if (!seat) return sendError(res, fail('player is not seated', 'E_SEAT', 403));
          seat.ai = false;
          delete rs.takeover[seat.index];
          rs.lastSeen.set(session.playerId, Date.now());
          sendJson(res, 200, Object.assign(roomView(rs, session.playerId), {
            ok: true,
            reconnected: true,
            playerId: session.playerId,
            session: token,
            seat: seat.index
          }));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'leave' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          const seat = who.seat;
          if (rs.started) {
            seat.ai = true;
            seat.playerId = null;
            seat.nickname = adapter.aiNames[seat.index] || ('AI · 座位 ' + (seat.index + 1));
            rs.takeover[seat.index] = true;
          }
          try { roomStore.leave(rs.id, who.playerId); } catch (err) { /* finished room */ }
          rs.lastSeen.delete(who.playerId);
          rs.roomData = roomStore.get(rs.id) || rs.roomData;
          if (!rs.started) assignSeats(rs);
          tickRoom(rs, false);
          sendJson(res, 200, roomView(rs, seat.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'invite' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.hostId) return sendError(res, fail('only the host can invite', 'E_HOST', 403));
          const invite = roomStore.invite(rs.id, { inviterId: who.playerId, ttlMs: 60 * 60 * 1000 });
          rs.invites.add(invite.token);
          rs.inviteCode = invite.token;
          sendJson(res, 200, {
            ok: true,
            roomId: rs.id,
            inviteCode: invite.token,
            inviteToken: invite.token,
            expiresAt: invite.expiresAt,
            inviteUrl: '/boardgame/' + adapter.slug + '/online.html?room=' + encodeURIComponent(rs.id) +
              '&code=' + encodeURIComponent(invite.token)
          });
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'tick' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          tickRoom(rs, true);
          sendJson(res, 200, roomView(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (actionName === 'restart' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.hostId) return sendError(res, fail('only the host can restart', 'E_HOST', 403));
          if (!rs.over) return sendError(res, fail('match is not over', 'E_STATE', 409));
          const oldSeats = rs.seats.slice();
          const match = adapter.restart(rs.match);
          match.seats = oldSeats.map((seat, index) => ({
            name: seat.nickname || seat.name || ('座位 ' + (index + 1)),
            ai: Boolean(seat.ai)
          }));
          rs.match = match;
          rs.over = false;
          rs.result = null;
          rs.stateVersion = (rs.stateVersion || 0) + 1;
          rs.lastAction = { type: 'restart', at: Date.now(), stateVersion: rs.stateVersion };
          rs.takeover = {};
          seenResults.delete(rs.id);
          tickRoom(rs, true);
          sendJson(res, 200, roomView(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }
      if (!actionName && req.method === 'DELETE') {
        const who = actor(req, {}, rs, url.searchParams);
        if (!who.ok) return sendError(res, who);
        if (who.playerId !== rs.hostId) return sendError(res, fail('only the host can close', 'E_HOST', 403));
        try { roomStore.close(rs.id, who.playerId); } catch (err) {}
        rooms.delete(rs.id);
        return sendJson(res, 200, { ok: true, roomId: rs.id, closed: true });
      }
      return sendError(res, fail('method not allowed', 'E_METHOD', 405));
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
  });

  function serveStatic(req, res, pathname) {
    let rel = pathname;
    if (rel === '/') rel = '/boardgame/' + adapter.slug + '/online.html';
    const file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'service-worker-allowed': path.dirname(rel) + '/'
      });
      res.end(data);
    });
  }

  // Timeout takeover + AI cadence. One interval for every room.
  const interval = setInterval(() => {
    const now = Date.now();
    for (const rs of rooms.values()) {
      if (!rs.started || rs.over) continue;
      for (const seat of rs.seats) {
        if (seat.ai || !seat.playerId) continue;
        const last = rs.lastSeen.get(seat.playerId) || 0;
        if (last && now - last > idleTimeoutMs) {
          seat.ai = true;
          rs.takeover[seat.index] = true;
        }
      }
      try { tickRoom(rs, false); } catch (err) { rs.lastAiError = err && err.message; }
    }
  }, Math.max(100, Math.min(500, aiDelayMs || 500)));
  interval.unref();

  return {
    server: server,
    rooms: rooms,
    leaderboard: leaderboard,
    adapter: adapter,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number.isFinite(port) ? port : 8787, host || '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      clearInterval(interval);
      return new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    }
  };
}

export async function startOnlineServer(options) {
  const opts = options || {};
  const app = createOnlineServer(opts);
  const address = await app.listen(opts.port == null ? 8787 : opts.port, opts.host);
  return { app: app, server: app.server, address: address, close: app.close };
}

export { pathToFileURL };
