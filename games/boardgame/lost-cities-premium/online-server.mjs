#!/usr/bin/env node
/*
 * Lost Cities premium — online room server.
 *
 * Reuses ../app/rooms.js for room codes, passwords, single-use invites, TTL,
 * host/join/leave/close. Rules are authoritative in engine.js.
 *
 *   POST /api/rooms
 *   POST /api/rooms/:id/join
 *   GET  /api/rooms/:id
 *   POST /api/rooms/:id/start
 *   POST /api/rooms/:id/actions
 *   POST /api/rooms/:id/reconnect
 *   POST /api/rooms/:id/leave
 *   POST /api/rooms/:id/invite
 *   POST /api/rooms/:id/tick
 *   POST /api/rooms/:id/restart
 *   DELETE /api/rooms/:id
 *   GET  /api/leaderboard
 *   GET  /health | /api/health
 *
 * Two seats. An empty seat is AI; one human may start against AI. A human idle
 * past idleTimeoutMs becomes AI-controlled until reconnect/touch. Hands are
 * hidden from the other seat; deck order is never serialized.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRoomStoreInternal } from '../app/rooms.js';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(__dirname, '../..');
const ASSET_ROOT = path.join(GAMES_ROOT, 'assets');
const SHARED_ROOT = path.join(GAMES_ROOT, 'shared');
const MAX_BODY = 64 * 1024;
const AI_NAMES = ['AI · 苔原学者', 'AI · 黄铜向导'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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

function publicState(state, viewerIndex) {
  if (!state) return null;
  return {
    version: state.version,
    playerCount: 2,
    round: state.round,
    rounds: state.rounds,
    phase: state.phase,
    current: state.current,
    starter: state.starter,
    turn: state.turn,
    deckCount: state.deck.length,
    players: state.players.map((p, i) => ({
      index: p.index,
      name: p.name,
      isAI: p.isAI,
      hand: i === viewerIndex ? p.hand.map((c) => Object.assign({}, c)) : [],
      handCount: p.hand.length,
      exp: JSON.parse(JSON.stringify(p.exp)),
      roundScores: p.roundScores.slice(),
      totalScore: p.totalScore
    })),
    discards: JSON.parse(JSON.stringify(state.discards)),
    pendingDiscard: state.pendingDiscard,
    lastAction: state.lastAction,
    lastRound: state.lastRound,
    roundResults: state.roundResults.map((r) => JSON.parse(JSON.stringify(r))),
    over: state.over,
    result: state.result,
    log: state.log.slice(-28).map((row) => Object.assign({}, row))
  };
}

export function createOnlineServer(options) {
  const opts = options || {};
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 650);
  const store = opts.roomStore || createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: 2
  });
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  let seq = 0;

  function issueSession(roomId, playerId) {
    const token = 'lcsess_' + (++seq) + '_' + randomHex(9);
    sessions.set(token, { roomId: roomId, playerId: playerId });
    return token;
  }
  function sessionFor(token) {
    return typeof token === 'string' && token ? sessions.get(token) || null : null;
  }
  function resolveRoom(value) {
    if (value == null) return null;
    const publicRoom = store.get(String(value));
    if (!publicRoom) return null;
    return rooms.get(publicRoom.id) || null;
  }
  function seatOfPlayer(rs, playerId) {
    if (!rs || !playerId) return null;
    return rs.seats.find((s) => s.playerId === playerId) || null;
  }
  function controlled(rs, seat, now) {
    if (!seat) return true;
    if (seat.ai || !seat.playerId) return true;
    if (rs.takeover[seat.index]) return true;
    const seen = rs.lastSeen.get(seat.playerId) || rs.startedAt || now;
    if (now - seen > idleTimeoutMs) {
      rs.takeover[seat.index] = true;
      return true;
    }
    return false;
  }
  function touch(rs, playerId) {
    if (!rs || !playerId) return;
    rs.lastSeen.set(playerId, Date.now());
    const seat = seatOfPlayer(rs, playerId);
    if (seat) delete rs.takeover[seat.index];
  }
  function assignSeats(rs, room) {
    const players = (room || rs.room).players.slice(0, 2);
    const previous = rs.seats || [];
    const seats = [];
    for (let i = 0; i < 2; i += 1) {
      const playerId = players[i] || null;
      const old = previous.find((s) => s.playerId === playerId && playerId);
      seats.push({
        index: i,
        playerId: playerId,
        nickname: playerId ? (old ? old.nickname : playerId) : AI_NAMES[i],
        ai: !playerId,
        takeover: false
      });
    }
    rs.seats = seats;
    return seats;
  }
  function seatState(rs, seat) {
    const now = Date.now();
    const isControlled = controlled(rs, seat, now);
    return {
      index: seat.index,
      playerIndex: seat.index,
      playerId: seat.playerId,
      nickname: seat.nickname,
      label: seat.playerId ? '玩家 ' + (seat.index + 1) : 'AI 座位 ' + (seat.index + 1),
      ai: !!seat.ai,
      takeover: !seat.ai && !!rs.takeover[seat.index],
      controlledByAI: !!(seat.ai || isControlled),
      current: !!(rs.match && rs.match.state.current === seat.index)
    };
  }
  function recordResult(rs) {
    if (!rs || !rs.match || rs.resultRecorded) return;
    const state = rs.match.state;
    if (!state.over) return;
    rs.resultRecorded = true;
    rs.finishedAt = Date.now();
    try { store.finish(rs.room.id, rs.room.hostId); } catch (err) { /* host may have left */ }
    const entry = {
      id: 'lc_result_' + rs.id + '_' + rs.finishedAt,
      roomId: rs.id,
      roomCode: rs.room.code,
      game: 'lost-cities',
      winner: state.result ? state.result.winner : null,
      tied: state.result ? state.result.tied : false,
      winnerName: state.result && state.result.winner != null
        ? state.result.scores.find((s) => s.index === state.result.winner).name : null,
      scores: state.result ? state.result.scores.map((s) => ({
        index: s.index, name: s.name, total: s.total, roundScores: s.roundScores.slice()
      })) : [],
      rounds: state.round,
      turns: state.turn,
      durationMs: rs.finishedAt - (rs.startedAt || rs.finishedAt),
      finishedAt: new Date(rs.finishedAt).toISOString(),
      seats: rs.seats.map((s) => ({
        index: s.index, playerId: s.playerId, nickname: s.nickname, ai: !!s.ai
      }))
    };
    leaderboard.unshift(entry);
    if (leaderboard.length > 100) leaderboard.length = 100;
    rs.lastResult = entry;
  }
  function tick(rs, force) {
    if (!rs || !rs.match || !rs.started) return;
    let guard = 0;
    while (guard < 1200 && !rs.match.state.over) {
      const state = rs.match.state;
      const seat = rs.seats[state.current];
      if (!seat) break;
      if (!controlled(rs, seat, Date.now())) break;
      if (!force && Date.now() < (rs.nextAiAt || 0)) break;
      let move;
      try {
        move = E.chooseAIMove(state, rs.aiLevel || 'normal');
      } catch (err) {
        rs.lastAiError = err && err.message ? err.message : String(err);
        break;
      }
      try {
        const next = E.applyMove(state, move);
        rs.match.state = next;
        rs.events = [next.lastAction];
        rs.lastActionAt = Date.now();
        guard += 1;
        if (next.over) { recordResult(rs); break; }
      } catch (err) {
        rs.lastAiError = err && err.message ? err.message : String(err);
        break;
      }
      if (!force) {
        rs.nextAiAt = Date.now() + aiDelayMs;
        break;
      }
    }
    if (rs.match.state.over) recordResult(rs);
  }
  function viewFor(rs, playerId) {
    const state = rs.match ? rs.match.state : null;
    const seat = seatOfPlayer(rs, playerId);
    const seats = rs.seats.map((s) => seatState(rs, s));
    const currentSeat = state ? rs.seats[state.current] : null;
    const currentControlled = currentSeat ? controlled(rs, currentSeat, Date.now()) : true;
    const canMove = Boolean(seat && state && !state.over && state.current === seat.index && !currentControlled);
    const viewerIndex = seat ? seat.index : 0;
    const viewState = state ? publicState(state, viewerIndex) : null;
    if (viewState) {
      viewState.players.forEach((p, i) => {
        const s = rs.seats[i];
        if (!s) return;
        p.name = s.nickname;
        p.isAI = seats[i].controlledByAI;
      });
    }
    return {
      ok: true,
      roomId: rs.id,
      roomCode: rs.room.code,
      inviteCode: rs.room.code,
      inviteToken: playerId === rs.room.hostId ? rs.inviteToken : null,
      game: 'lost-cities',
      hostId: rs.room.hostId,
      visibility: rs.room.visibility,
      hasPassword: rs.room.hasPassword,
      maxPlayers: 2,
      status: state && state.over ? 'finished' : rs.started ? 'playing' : (rs.room.status || 'waiting'),
      started: !!rs.started,
      seats: seats,
      players: seats.map((s) => ({
        index: s.index, playerId: s.playerId, nickname: s.nickname,
        ai: s.ai, takeover: s.takeover, controlledByAI: s.controlledByAI
      })),
      you: seat ? { playerId: seat.playerId, playerIndex: seat.index, nickname: seat.nickname } : null,
      currentPlayerIndex: state ? state.current : null,
      currentPlayerId: currentSeat && !currentControlled ? currentSeat.playerId : null,
      currentControlledByAI: currentControlled,
      currentSeat: currentSeat ? currentSeat.index : null,
      takeoverSeats: seats.filter((s) => s.takeover).map((s) => s.index),
      aiSeats: seats.filter((s) => s.ai).map((s) => s.index),
      canMove: canMove,
      canStart: !rs.started && rs.room.hostId === playerId && rs.room.players.length >= 1,
      canRestart: !!rs.match && rs.match.state.over && rs.room.hostId === playerId,
      isHost: rs.room.hostId === playerId,
      state: viewState,
      legalMoves: canMove ? E.getLegalMoves(state) : [],
      deckCount: state ? state.deck.length : 0,
      lastEvents: rs.events || [],
      lastAiError: rs.lastAiError || null,
      result: rs.lastResult || null,
      aiLevel: rs.aiLevel || 'normal',
      createdAt: rs.room.createdAt,
      expiresAt: rs.room.expiresAt
    };
  }
  function actor(req, body, rs, query) {
    const input = body || {};
    const q = query || {};
    const token = input.session || input.playerSession || input.token ||
      q.get('session') || q.get('playerSession') || q.get('token');
    const session = sessionFor(token);
    if (token && !session) return fail('invalid session token', 'E_SESSION', 403);
    if (session && session.roomId !== rs.id) return fail('session does not belong to this room', 'E_SESSION', 403);
    const playerId = input.playerId || input.userId || q.get('playerId') || q.get('userId') ||
      (session && session.playerId) || null;
    if (!playerId) return fail('playerId or session is required', 'E_PLAYER', 401);
    const seat = seatOfPlayer(rs, playerId);
    if (!seat) return fail('not a member of this room', 'E_PLAYER', 403);
    if (session && session.playerId !== playerId) return fail('session does not match playerId', 'E_SESSION', 403);
    return { ok: true, playerId: playerId, seat: seat, session: token || null };
  }
  function newMatch(rs, seed) {
    const state = E.createGame({ seed: seed, playerCount: 2 });
    state.players.forEach((p, i) => {
      p.name = rs.seats[i] ? rs.seats[i].nickname : p.name;
      p.isAI = rs.seats[i] ? rs.seats[i].ai : true;
    });
    return { id: 'lc_' + randomHex(6), game: 'lost-cities', state: state };
  }
  function resetForRematch(rs) {
    rs.started = true;
    rs.startedAt = Date.now();
    rs.resultRecorded = false;
    rs.takeover = {};
    rs.lastSeen = new Map();
    rs.seats.forEach((s) => { if (s.playerId) rs.lastSeen.set(s.playerId, Date.now()); });
    rs.nextAiAt = Date.now() + aiDelayMs;
    rs.events = [];
    rs.lastResult = null;
    rs.lastAiError = null;
  }
  function startMatch(rs, who) {
    if (rs.room.players.length >= 2) {
      const started = store.start(rs.id, who.playerId);
      if (started && started.ok) rs.room = store.get(rs.id) || rs.room;
    } else {
      // One human + an AI seat: the shared store requires two members to
      // start, so the room is marked playing only on the live server view.
      rs.room = Object.assign({}, rs.room, { status: 'playing' });
    }
    assignSeats(rs, rs.room);
    rs.match = newMatch(rs, crypto.randomBytes(4).readUInt32LE(0));
    resetForRematch(rs);
    tick(rs, true);
  }

  function serveStatic(req, res, pathname) {
    let file = null;
    const local = (name) => path.join(__dirname, name);
    if (pathname === '/' || pathname === '/index.html') file = local('index.html');
    else if (pathname === '/online.html') file = local('online.html');
    else if (pathname === '/rules.html') file = local('rules.html');
    else if (pathname === '/engine.js') file = local('engine.js');
    else if (pathname === '/sw.js') file = local('sw.js');
    else if (pathname === '/meta.json') file = local('meta.json');
    else if (pathname === '/DESIGN.md') file = local('DESIGN.md');
    else if (pathname.indexOf('/boardgame/lost-cities-premium/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/boardgame/lost-cities-premium/'.length));
      if (rel.indexOf('..') !== -1) return sendError(res, fail('invalid path', 'E_PATH', 400));
      file = path.join(__dirname, rel);
    } else if (pathname.indexOf('/assets/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/assets/'.length));
      const resolved = path.resolve(ASSET_ROOT, rel);
      if (resolved !== ASSET_ROOT && resolved.indexOf(ASSET_ROOT + path.sep) !== 0) {
        return sendError(res, fail('invalid asset path', 'E_PATH', 400));
      }
      file = resolved;
    } else if (pathname.indexOf('/shared/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/shared/'.length));
      const resolved = path.resolve(SHARED_ROOT, rel);
      if (resolved !== SHARED_ROOT && resolved.indexOf(SHARED_ROOT + path.sep) !== 0) {
        return sendError(res, fail('invalid shared path', 'E_PATH', 400));
      }
      file = resolved;
    }
    if (!file) return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'content-length': stat.size
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer((req, res) => {
    res.on('error', () => {});
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
      return sendJson(res, 200, {
        ok: true, status: 'ok', service: 'lost-cities-premium-online', game: 'lost-cities',
        rooms: rooms.size, sessions: sessions.size, leaderboard: leaderboard.length,
        idleTimeoutMs: idleTimeoutMs
      });
    }
    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      return sendJson(res, 200, { ok: true, game: 'lost-cities', entries: leaderboard.slice(0, limit), total: leaderboard.length });
    }
    if (req.method === 'POST' && pathname === '/api/rooms') {
      return readJson(req).then((body) => {
        const input = body || {};
        const playerId = input.playerId || input.hostId || input.userId;
        if (!playerId) return sendError(res, fail('playerId is required', 'E_INVALID_ARGS', 422));
        if (input.email || input.phone) return sendError(res, fail('personal information is not accepted', 'E_PII', 422));
        const maxPlayers = 2;
        let created;
        try {
          created = store.create({
            hostId: playerId,
            gameId: 'lost-cities',
            visibility: input.visibility == null ? 'public' : input.visibility,
            password: input.password,
            maxPlayers: maxPlayers,
            nickname: playerId
          });
        } catch (err) {
          return sendError(res, fail(err.message || 'cannot create room', err.code || 'E_ROOM', 422));
        }
        const room = created.room;
        const rs = {
          id: room.id, room: room, seats: [], sessions: new Map(),
          lastSeen: new Map([[playerId, Date.now()]]), takeover: {},
          started: false, startedAt: 0, match: null,
          inviteToken: created.invite ? created.invite.token : null,
          resultRecorded: false, nextAiAt: 0, events: [], lastResult: null,
          aiLevel: input.aiLevel === 'easy' || input.aiLevel === 'hard' ? input.aiLevel : 'normal'
        };
        assignSeats(rs, room);
        rooms.set(room.id, rs);
        const token = issueSession(room.id, playerId);
        rs.sessions.set(token, playerId);
        sendJson(res, 201, Object.assign({}, viewFor(rs, playerId), {
          playerSession: token, playerId: playerId,
          inviteToken: created.invite ? created.invite.token : null
        }));
      }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
    }

    const roomRoute = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(join|start|actions|reconnect|leave|invite|tick|restart))?$/);
    if (roomRoute) {
      const rs = resolveRoom(decodeURIComponent(roomRoute[1]));
      if (!rs) return sendError(res, fail('room not found', 'E_NOT_FOUND', 404));
      const actionName = roomRoute[2] || null;

      if (!actionName && req.method === 'GET') {
        const token = url.searchParams.get('session') || url.searchParams.get('token');
        const session = sessionFor(token);
        if (token && !session) return sendError(res, fail('invalid session token', 'E_SESSION', 403));
        if (session && session.roomId !== rs.id) return sendError(res, fail('session does not belong to this room', 'E_SESSION', 403));
        const playerId = url.searchParams.get('playerId') || (session && session.playerId) || null;
        if (rs.room.visibility === 'private') {
          const seat = seatOfPlayer(rs, playerId);
          if (!seat) return sendError(res, fail('private room requires a member session', 'E_PRIVATE', 403));
        }
        if (playerId) touch(rs, playerId);
        tick(rs, false);
        return sendJson(res, 200, viewFor(rs, playerId));
      }

      if (actionName === 'join' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const input = body || {};
          const playerId = input.playerId || input.userId;
          if (!playerId) return sendError(res, fail('playerId is required', 'E_INVALID_ARGS', 422));
          if (rs.started) return sendError(res, fail('match already started', 'E_STATE', 409));
          const invite = input.inviteCode || input.inviteToken;
          let result;
          if (invite && invite !== rs.room.code) {
            const verified = store.verifyInvite(invite);
            if (!verified.ok) return sendError(res, fail('invalid or expired invite', 'E_INVITE', 403));
            result = store.consumeInvite(invite, { playerId: playerId, nickname: playerId });
          } else {
            result = store.join(rs.id, { playerId: playerId, password: input.password, nickname: playerId });
          }
          if (!result || !result.ok) {
            const code = result && result.code;
            const status = code === 'E_PASSWORD' || code === 'E_INVITE' ? 403
              : code === 'E_LOCKED' ? 423 : code === 'E_FULL' ? 409
                : code === 'E_NOT_FOUND' ? 404 : 422;
            return sendError(res, fail((result && result.message) || 'join rejected', code || 'E_JOIN', status));
          }
          rs.room = store.get(rs.id) || result.room;
          if (!rs.started) assignSeats(rs, rs.room);
          const token = issueSession(rs.id, playerId);
          rs.sessions.set(token, playerId);
          rs.lastSeen.set(playerId, Date.now());
          sendJson(res, 200, Object.assign({}, viewFor(rs, playerId), { playerSession: token, playerId: playerId }));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'reconnect' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const token = body && (body.token || body.session || body.playerSession);
          const session = sessionFor(token);
          if (!session || session.roomId !== rs.id) return sendError(res, fail('invalid session token', 'E_TOKEN', 403));
          const playerId = body.playerId || body.userId || session.playerId;
          if (playerId !== session.playerId) return sendError(res, fail('session does not match playerId', 'E_SESSION', 403));
          touch(rs, playerId);
          tick(rs, false);
          sendJson(res, 200, Object.assign({}, viewFor(rs, playerId), {
            playerSession: token, playerId: playerId, reconnected: true
          }));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'start' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can start', 'E_HOST', 403));
          if (rs.started) return sendError(res, fail('match already started', 'E_STATE', 409));
          if (rs.room.players.length < 1) return sendError(res, fail('host is required', 'E_PLAYERS', 409));
          try { startMatch(rs, who); }
          catch (err) { return sendError(res, fail(err.message || 'cannot start', err.code || 'E_START', 409)); }
          sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'restart' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can restart', 'E_HOST', 403));
          if (!rs.match || !rs.match.state.over) return sendError(res, fail('match is not over', 'E_STATE', 409));
          rs.match = newMatch(rs, crypto.randomBytes(4).readUInt32LE(0));
          resetForRematch(rs);
          tick(rs, true);
          sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'actions' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.started || !rs.match) return sendError(res, fail('match has not started', 'E_STATE', 409));
          touch(rs, who.playerId);
          const state = rs.match.state;
          if (state.over) return sendError(res, fail('match is over', 'E_STATE', 409));
          if (state.current !== who.seat.index) return sendError(res, fail('not this player\'s turn', 'E_TURN', 409));
          if (controlled(rs, who.seat, Date.now())) return sendError(res, fail('seat is AI-controlled', 'E_TAKEOVER', 409));
          const move = body.move || body.act || (body.type ? body : null);
          if (!move || typeof move !== 'object') return sendError(res, fail('move is required', 'E_ACTION', 422));
          let next;
          try {
            next = E.applyMove(state, {
              type: move.type,
              handIndex: move.handIndex,
              cardId: move.cardId,
              source: move.source,
              color: move.color
            });
          } catch (err) {
            return sendError(res, fail(err.message || 'action rejected', 'E_ACTION', 422));
          }
          rs.match.state = next;
          rs.events = [next.lastAction];
          rs.nextAiAt = Date.now() + aiDelayMs;
          if (next.over) recordResult(rs);
          tick(rs, false);
          sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'tick' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.started) return sendError(res, fail('match has not started', 'E_STATE', 409));
          tick(rs, body && body.force !== false);
          sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'invite' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can invite', 'E_HOST', 403));
          const invite = store.invite(rs.id, { inviterId: who.playerId, ttlMs: 60 * 60 * 1000 });
          rs.inviteToken = invite.token;
          sendJson(res, 200, { ok: true, roomId: rs.id, inviteCode: rs.room.code, inviteToken: invite.token, expiresAt: invite.expiresAt });
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
            seat.nickname = AI_NAMES[seat.index] || ('AI · 座位 ' + (seat.index + 1));
            rs.takeover[seat.index] = true;
            if (rs.match) rs.match.state.players[seat.index].name = seat.nickname;
          }
          try { store.leave(rs.id, who.playerId); } catch (err) { /* room may already be finished */ }
          rs.lastSeen.delete(who.playerId);
          rs.room = store.get(rs.id) || rs.room;
          if (!rs.started) assignSeats(rs, rs.room);
          tick(rs, false);
          sendJson(res, 200, { ok: true, roomId: rs.id, playerId: who.playerId, left: true });
        }).catch((err) => sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (!actionName && req.method === 'DELETE') {
        const who = actor(req, {}, rs, url.searchParams);
        if (!who.ok) return sendError(res, who);
        if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can close', 'E_HOST', 403));
        try { store.close(rs.id, who.playerId); } catch (err) { /* already gone */ }
        rooms.delete(rs.id);
        return sendJson(res, 200, { ok: true, roomId: rs.id, closed: true });
      }
      return sendError(res, fail('method not allowed', 'E_METHOD', 405));
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
  });

  const interval = setInterval(() => {
    for (const rs of rooms.values()) {
      try { tick(rs, false); } catch (err) { rs.lastAiError = err && err.message; }
    }
  }, 200);
  interval.unref();

  return {
    server: server,
    rooms: rooms,
    leaderboard: leaderboard,
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

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port }).then((handle) => {
    const addr = handle.address;
    console.log('[lost-cities-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[lost-cities-online] http://' + addr.address + ':' + addr.port + '/index.html   (单人版)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
