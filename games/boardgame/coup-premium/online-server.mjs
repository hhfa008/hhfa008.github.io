#!/usr/bin/env node
/*
 * Coup premium — authoritative online room server.
 *
 * Reuses the shared room state machine in ../app/rooms.js (password rooms,
 * single-use invites, TTL, host/join/leave/start/close) and exposes a small
 * HTTP/JSON API plus static files. Game rules are enforced by engine.js on
 * the server; hidden influence is never sent to other seats.
 *
 *   POST /api/rooms                         create room (maxPlayers 2..6)
 *   POST /api/rooms/:id/join                join by password / invite / code
 *   GET  /api/rooms/:id                     room + your private view
 *   POST /api/rooms/:id/start               host starts, empty seats become AI
 *   POST /api/rooms/:id/actions             { action:{type,...} }
 *   POST /api/rooms/:id/reconnect           session reconnect + takeover clear
 *   POST /api/rooms/:id/leave               leave (seat becomes AI)
 *   POST /api/rooms/:id/invite              host creates another invite
 *   POST /api/rooms/:id/tick                force AI steps (tests/manual sync)
 *   POST /api/rooms/:id/restart             host rematch after game over
 *   DELETE /api/rooms/:id                   host closes
 *   GET  /api/leaderboard                   finished-game board
 *   GET  /health | /api/health
 *
 * Start: node online-server.mjs --port 8787
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRoomStoreInternal } from '../app/rooms.js';
import { SOLO_AI_FILL, startRoomWithAiFill } from '../app/ai-seat.mjs';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(__dirname, '../..');
const ASSET_ROOT = path.join(GAMES_ROOT, 'assets');
const SHARED_ROOT = path.join(GAMES_ROOT, 'shared');
const MAX_BODY = 64 * 1024;
const AI_NAMES = ['你', 'AI · 铁幕', 'AI · 密探', 'AI · 黑账房', 'AI · 喉舌', 'AI · 夜莺'];
const AI_LEVELS = ['normal', 'hard', 'normal', 'easy', 'hard', 'normal'];
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

export function createOnlineServer(options) {
  const opts = options || {};
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 520);
  const store = opts.roomStore || createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: 6
  });
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  let seq = 0;

  function issueSession(roomId, playerId) {
    const token = 'cpsess_' + (++seq) + '_' + randomHex(9);
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
    const players = (room || rs.room).players.slice();
    const max = (room || rs.room).maxPlayers;
    const previous = rs.seats || [];
    const seats = [];
    for (let i = 0; i < max; i += 1) {
      const playerId = players[i] || null;
      const old = previous.find((s) => s.playerId === playerId && playerId);
      seats.push({
        index: i,
        playerId: playerId,
        nickname: playerId ? (old ? old.nickname : playerId) : (AI_NAMES[i] || ('AI · 座位 ' + (i + 1))),
        ai: !playerId,
        aiLevel: AI_LEVELS[i] || 'normal',
        takeover: false
      });
    }
    rs.seats = seats;
    return seats;
  }
  function seatState(rs, seat) {
    const now = Date.now();
    const state = rs.match ? rs.match.state : null;
    const isControlled = controlled(rs, seat, now);
    const takeover = !seat.ai && !!rs.takeover[seat.index];
    return {
      index: seat.index,
      playerIndex: seat.index,
      playerId: seat.playerId,
      nickname: seat.nickname,
      label: seat.playerId ? '玩家 ' + (seat.index + 1) : 'AI 座位 ' + (seat.index + 1),
      ai: !!seat.ai,
      aiLevel: seat.ai ? seat.aiLevel : null,
      takeover: takeover,
      controlledByAI: !!(seat.ai || isControlled),
      current: !!(state && !state.over && E.actorId(state) === seat.index)
    };
  }
  function recordResult(rs) {
    if (!rs || !rs.match || rs.resultRecorded) return;
    const state = rs.match.state;
    if (!state.over) return;
    rs.resultRecorded = true;
    rs.finishedAt = Date.now();
    try { store.finish(rs.room.id, rs.room.hostId); } catch (err) { /* host may have left */ }
    const winner = state.winner;
    const entry = {
      id: 'coup_result_' + rs.id + '_' + rs.finishedAt,
      roomId: rs.id,
      roomCode: rs.room.code,
      game: 'coup',
      winner: winner,
      winnerName: winner != null && winner >= 0 ? state.players[winner].name : null,
      players: state.players.map((p) => ({
        index: p.id,
        name: p.name,
        coins: p.coins,
        eliminated: p.eliminated,
        lost: p.lost.slice(),
        ai: !!(rs.seats[p.id] && rs.seats[p.id].ai)
      })),
      turns: state.turns,
      actions: state.actionCount,
      stats: Object.assign({}, state.stats),
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
      const actor = E.actorId(state);
      if (actor == null) break;
      const seat = rs.seats[actor];
      if (!seat || !controlled(rs, seat, Date.now())) break;
      if (!force && Date.now() < (rs.nextAiAt || 0)) break;
      let action;
      try {
        action = E.chooseAIAction(state, seat.ai ? seat.aiLevel : 'normal');
      } catch (err) {
        rs.lastAiError = err && err.message ? err.message : String(err);
        break;
      }
      if (!action) {
        rs.lastAiError = 'AI returned no action in phase ' + state.phase;
        break;
      }
      try {
        const result = E.applyAction(state, action);
        if (!result.ok) throw new Error(result.error);
        rs.events = [state.lastEvent];
        rs.lastActionAt = Date.now();
        guard += 1;
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
    const seatIndex = seat ? seat.index : null;
    const now = Date.now();
    const seats = rs.seats.map((s) => seatState(rs, s));
    const actor = state && !state.over ? E.actorId(state) : null;
    const actorSeat = actor == null ? null : rs.seats[actor];
    const actorControlled = actorSeat ? controlled(rs, actorSeat, now) : true;
    const canAct = Boolean(seat && state && !state.over && actor === seat.index && !actorControlled);
    const stateView = state ? E.viewFor(state, seatIndex) : null;
    if (stateView) {
      stateView.players.forEach((p, i) => {
        const s = rs.seats[i];
        if (!s) return;
        p.name = s.nickname;
        p.isAI = !!(s.ai || (rs.takeover[i]));
      });
    }
    return {
      ok: true,
      roomId: rs.id,
      roomCode: rs.room.code,
      inviteCode: rs.room.code,
      inviteToken: playerId === rs.room.hostId ? rs.inviteToken : null,
      game: 'coup',
      hostId: rs.room.hostId,
      isHost: playerId === rs.room.hostId,
      visibility: rs.room.visibility,
      hasPassword: rs.room.hasPassword,
      maxPlayers: rs.room.maxPlayers,
      status: state && state.over ? 'finished' : rs.started ? 'playing' : (rs.room.status || 'waiting'),
      started: !!rs.started,
      seats: seats,
      players: seats.map((s) => ({
        index: s.index, playerId: s.playerId, nickname: s.nickname,
        ai: s.ai, aiLevel: s.aiLevel, takeover: s.takeover, controlledByAI: s.controlledByAI
      })),
      you: seat ? { playerId: seat.playerId, playerIndex: seat.index, nickname: seat.nickname } : null,
      currentPlayerIndex: state ? state.current : null,
      currentActorIndex: actor,
      currentPlayerId: actorSeat && !actorControlled ? actorSeat.playerId : null,
      currentControlledByAI: actorControlled,
      currentSeat: actor,
      takeoverSeats: seats.filter((s) => s.takeover).map((s) => s.index),
      aiSeats: seats.filter((s) => s.ai).map((s) => s.index),
      canMove: canAct,
      canAct: canAct,
      canStart: !rs.started && rs.room.hostId === playerId && rs.room.players.length >= 2,
      canRestart: !!rs.match && rs.match.state.over && rs.room.hostId === playerId,
      state: stateView,
      legalActions: canAct ? E.getLegalActions(state) : [],
      lastEvents: rs.events ? rs.events.slice() : [],
      lastAiError: rs.lastAiError || null,
      result: rs.lastResult || null,
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
    const state = E.createGame({ seed: seed, playerCount: rs.seats.length, aiAll: false, humanSeat: 0 });
    state.players.forEach((p, i) => {
      const seat = rs.seats[i];
      p.name = seat ? seat.nickname : p.name;
      p.isAI = seat ? !!seat.ai : true;
      p.aiLevel = seat ? (seat.ai ? seat.aiLevel : null) : 'normal';
    });
    return { id: 'coup_' + randomHex(6), game: 'coup', state: state };
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
    else if (pathname === '/ACCEPTANCE.md') file = local('ACCEPTANCE.md');
    else if (pathname.indexOf('/boardgame/coup-premium/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/boardgame/coup-premium/'.length));
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
        ok: true, status: 'ok', service: 'coup-premium-online', game: 'coup',
        rooms: rooms.size, sessions: sessions.size, leaderboard: leaderboard.length,
        idleTimeoutMs: idleTimeoutMs, minPlayers: 2, maxPlayers: 6
      });
    }
    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      return sendJson(res, 200, { ok: true, game: 'coup', entries: leaderboard.slice(0, limit), total: leaderboard.length });
    }
    if (req.method === 'POST' && pathname === '/api/rooms') {
      return readJson(req).then((body) => {
        const input = body || {};
        const playerId = input.playerId || input.hostId || input.userId;
        if (!playerId) return sendError(res, fail('playerId is required', 'E_INVALID_ARGS', 422));
        if (input.email || input.phone) return sendError(res, fail('personal information is not accepted', 'E_PII', 422));
        const maxPlayers = Math.max(2, Math.min(6, Number(input.maxPlayers) || 2));
        let created;
        try {
          created = store.create({
            hostId: playerId,
            gameId: 'coup',
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
          resultRecorded: false, nextAiAt: 0, events: [], lastResult: null
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
          const invite = input.inviteToken || input.inviteCode;
          let result;
          if (invite && invite !== rs.room.code) {
            const verified = store.verifyInvite(invite);
            if (!verified.ok) return sendError(res, fail('invalid or expired invite', 'E_INVITE', 403));
            if (verified.roomId !== rs.id) return sendError(res, fail('invite belongs to another room', 'E_INVITE', 403));
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
          const started = startRoomWithAiFill(store, rs.id, who.playerId, rs.room.players.length, SOLO_AI_FILL.minHumanPlayers);
          if (!started || !started.ok) return sendError(res, fail((started && started.message) || 'cannot start', (started && started.code) || 'E_START', 409));
          rs.room = started.solo ? Object.assign({}, rs.room, { status: 'playing' }) : (store.get(rs.id) || rs.room);
          assignSeats(rs, rs.room);
          rs.match = newMatch(rs, crypto.randomBytes(4).readUInt32LE(0));
          resetForRematch(rs);
          tick(rs, true);
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
          const actorIndex = E.actorId(state);
          if (actorIndex !== who.seat.index) return sendError(res, fail("not this player's turn", 'E_TURN', 409));
          if (controlled(rs, who.seat, Date.now())) return sendError(res, fail('seat is AI-controlled', 'E_TAKEOVER', 409));
          const action = body.action || body.act || (body.type !== 'action' ? { type: body.type, target: body.target, role: body.role, index: body.index, indices: body.indices } : null);
          if (!action || typeof action !== 'object' || !action.type) return sendError(res, fail('action is required', 'E_ACTION', 422));
          try {
            const result = E.applyAction(state, action);
            if (!result.ok) return sendError(res, fail(result.error, 'E_ACTION', 422));
          } catch (err) {
            return sendError(res, fail(err.message || 'action rejected', 'E_ACTION', 422));
          }
          rs.events = [state.lastEvent];
          rs.nextAiAt = Date.now() + aiDelayMs;
          if (state.over) recordResult(rs);
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
            if (rs.match) rs.match.state.players[seat.index].isAI = true;
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
        try { store.close(rs.id, who.playerId); } catch (err) {}
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
    console.log('[coup-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[coup-online] http://' + addr.address + ':' + addr.port + '/index.html   (单人版)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
