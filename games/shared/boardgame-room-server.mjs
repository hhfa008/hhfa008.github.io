#!/usr/bin/env node
/*
 * Generic two-seat online room server for abstract board games.
 *
 * Shared by xiangqi-premium, draughts-premium and checkers-jump-premium so
 * the three games do not each carry a copy of the room / invite / reconnect /
 * takeover / leaderboard logic. Room bookkeeping is delegated to
 * games/boardgame/app/rooms.js; the game itself is injected as an adapter:
 *
 *   {
 *     game: 'xiangqi',
 *     aiNames: ['AI · 楚河', 'AI · 汉界'],
 *     initialState(seats) -> state,
 *     apply(state, action, seatIndex) -> nextState,   // throws on illegal
 *     resign(state, seatIndex) -> nextState,
 *     aiAction(state) -> action | null,
 *     isOver(state) -> bool,
 *     result(state) -> {winnerSeat, reason},
 *     turnSeat(state) -> 0 | 1 | null,
 *     view(state, seatIndex) -> public state
 *   }
 *
 * HTTP/JSON API (same shape as the existing premium games):
 *   POST   /api/rooms                       create
 *   POST   /api/rooms/:id/join              join by invite or password
 *   GET    /api/rooms/:id                   room + public game state
 *   POST   /api/rooms/:id/start             host starts; empty seat becomes AI
 *   POST   /api/rooms/:id/actions           {type:'move'|'resign', ...}
 *   POST   /api/rooms/:id/reconnect         session reconnect + takeover clear
 *   POST   /api/rooms/:id/leave             leave (seat becomes AI)
 *   POST   /api/rooms/:id/invite            host creates a fresh invite
 *   POST   /api/rooms/:id/tick              force AI steps (tests/manual)
 *   POST   /api/rooms/:id/restart           host rematch
 *   DELETE /api/rooms/:id                   host closes
 *   GET    /api/leaderboard                 finished-game board
 *   GET    /health | /api/health
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRoomStoreInternal } from '../boardgame/app/rooms.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');
const MAX_BODY = 64 * 1024;
const PII_KEY = /^(email|e-mail|mail|phone|mobile|telephone|address|realname|real_name|fullname|full_name|idcard|id_card|passport|wechat|qq)$/i;
const PLAYER_ID = /^[\p{L}\p{N} _.\-·]{1,24}$/u;

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
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2'
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
    error: { code: f.code || (f.error && f.error.code) || 'E_ROOM', message: f.message || (f.error && f.error.message) || 'room operation rejected' }
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
function hasPii(value, depth) {
  if (!value || typeof value !== 'object' || (depth || 0) > 4) return false;
  for (const key of Object.keys(value)) {
    if (PII_KEY.test(key)) return true;
    if (hasPii(value[key], (depth || 0) + 1)) return true;
  }
  return false;
}
function cleanPlayerId(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || !PLAYER_ID.test(value)) return null;
  return value;
}
function cleanNickname(raw, fallback) {
  const value = String(raw == null ? '' : raw).trim().slice(0, 24);
  return value || fallback;
}

export function createRoomServer(options) {
  const opts = options || {};
  const adapter = opts.adapter;
  if (!adapter || typeof adapter.apply !== 'function') throw new Error('adapter required');
  if (typeof adapter.aiAction !== 'function') throw new Error('adapter.aiAction is required for AI fill');
  const game = adapter.game || 'boardgame';
  const idleTimeoutMs = opts.idleTimeoutMs == null ? 15000 : Math.max(100, Number(opts.idleTimeoutMs));
  const aiDelayMs = opts.aiDelayMs == null ? 500 : Math.max(0, Number(opts.aiDelayMs));
  const roomTtlMs = Number(opts.roomTtlMs) || 2 * 60 * 60 * 1000;
  const aiNames = adapter.aiNames || ['AI · 一号', 'AI · 二号'];
  const store = opts.roomStore || createRoomStoreInternal({ ttlMs: roomTtlMs, maxPlayers: 2 });
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  let seq = 0;

  function issueSession(roomId, playerId) {
    const token = 'sess_' + (++seq) + '_' + randomHex(9);
    sessions.set(token, { roomId, playerId });
    return token;
  }
  function sessionFor(token) {
    return typeof token === 'string' && token ? sessions.get(token) || null : null;
  }
  function roomFor(id) { return rooms.get(String(id || '')) || null; }
  function newSeats(hostId) {
    return [
      { index: 0, playerId: hostId, nickname: hostId, ai: false, connected: true },
      { index: 1, playerId: null, nickname: aiNames[1] || 'AI', ai: true, connected: true }
    ];
  }
  function humanCount(rs) { return rs.seats.filter((s) => !s.ai).length; }
  function seatOf(rs, playerId) { return rs.seats.find((s) => !s.ai && s.playerId === playerId) || null; }
  function touch(rs, playerId) { if (playerId) rs.lastSeen.set(playerId, Date.now()); }
  function markTakeover(rs, seat, reason) {
    if (!seat || seat.ai) return;
    rs.takenFrom = rs.takenFrom || {};
    if (seat.playerId) rs.takenFrom[seat.index] = seat.playerId;
    seat.ai = true;
    seat.playerId = null;
    seat.nickname = aiNames[seat.index] || ('AI · 座位 ' + (seat.index + 1));
    rs.takeover[seat.index] = reason || 'idle';
    rs.takeoverSeats = Object.keys(rs.takeover).map(Number);
  }

  function roomMeta(rs, seatIndex) {
    const seat = seatIndex == null ? null : rs.seats[seatIndex];
    return {
      ok: true,
      game,
      roomId: rs.id,
      roomCode: rs.room ? rs.room.code : rs.code,
      status: rs.started ? (adapter.isOver(rs.match.state) ? 'finished' : 'playing') : 'waiting',
      started: rs.started,
      maxPlayers: 2,
      seats: rs.seats.map((s) => ({
        index: s.index, playerId: s.playerId, nickname: s.nickname,
        ai: s.ai, connected: s.ai ? true : s.connected
      })),
      isHost: !!(seat && rs.room && rs.room.hostId === seat.playerId),
      canStart: !rs.started && !!(seat && rs.room && rs.room.hostId === seat.playerId),
      you: seat ? { playerIndex: seat.index, playerId: seat.playerId, nickname: seat.nickname } : null,
      takeoverSeats: rs.takeoverSeats.slice(),
      inviteToken: seat && rs.room && rs.room.hostId === seat.playerId ? rs.inviteToken : undefined
    };
  }

  function viewFor(rs, playerId) {
    const seat = playerId ? seatOf(rs, playerId) : null;
    const seatIndex = seat ? seat.index : null;
    const meta = roomMeta(rs, seatIndex);
    if (!rs.started) {
      return Object.assign(meta, { state: null, canMove: false, legal: [] });
    }
    const state = rs.match.state;
    const publicView = adapter.view(state, seatIndex);
    const over = adapter.isOver(state);
    const turnSeat = adapter.turnSeat(state);
    return Object.assign(meta, {
      state: publicView,
      over,
      result: over ? adapter.result(state) : null,
      canMove: !over && seatIndex != null && turnSeat === seatIndex && !rs.seats[seatIndex].ai,
      legal: !over && seatIndex != null && turnSeat === seatIndex && typeof adapter.legal === 'function'
        ? adapter.legal(state) : []
    });
  }

  function pushResult(rs) {
    const state = rs.match.state;
    if (rs.resultRecorded || !adapter.isOver(state)) return;
    rs.resultRecorded = true;
    const result = adapter.result(state);
    leaderboard.unshift({
      game,
      roomId: rs.id,
      roomCode: rs.room ? rs.room.code : rs.code,
      players: rs.seats.map((s) => ({ index: s.index, nickname: s.nickname, ai: s.ai })),
      winnerSeat: result.winnerSeat,
      reason: result.reason,
      moves: typeof adapter.moveCount === 'function' ? adapter.moveCount(state) : null,
      finishedAt: new Date().toISOString()
    });
    if (leaderboard.length > 50) leaderboard.length = 50;
    if (rs.room) { try { store.finish(rs.id, rs.room.hostId); } catch (err) { /* best effort */ } }
  }

  function runAi(rs, force) {
    if (!rs.started) return;
    let guard = 0;
    while (guard++ < 24) {
      const state = rs.match.state;
      if (adapter.isOver(state)) { pushResult(rs); return; }
      const turnSeat = adapter.turnSeat(state);
      if (turnSeat == null || !rs.seats[turnSeat] || !rs.seats[turnSeat].ai) return;
      if (!force && Date.now() < (rs.nextAiAt || 0)) return;
      const action = adapter.aiAction(state);
      if (!action) return;
      rs.match.state = adapter.apply(state, action, turnSeat);
      rs.match.events = [{ type: action.type || 'move', seat: turnSeat, at: Date.now() }];
      rs.nextAiAt = Date.now() + aiDelayMs;
      if (adapter.isOver(rs.match.state)) { pushResult(rs); return; }
      if (aiDelayMs > 0) return;
    }
  }

  function expireTakeovers(rs) {
    if (!rs.started) return;
    const now = Date.now();
    rs.seats.forEach((seat) => {
      if (seat.ai || !seat.playerId) return;
      const last = rs.lastSeen.get(seat.playerId) || rs.startedAt || now;
      if (now - last > idleTimeoutMs) markTakeover(rs, seat, 'idle');
    });
    runAi(rs, false);
  }

  function actor(req, body, rs, search) {
    const q = search || new URLSearchParams();
    const token = (body && body.session) || q.get('session') || (body && body.token);
    const playerId = cleanPlayerId((body && body.playerId) || q.get('playerId'));
    if (!token || !playerId) return fail('session and playerId required', 'E_AUTH', 401);
    const session = sessionFor(token);
    if (!session || session.roomId !== rs.id || session.playerId !== playerId) {
      return fail('invalid session', 'E_AUTH', 403);
    }
    let seat = seatOf(rs, playerId);
    if (!seat) {
      // A seat taken over by the idle timer (or by leave) no longer carries
      // the playerId, but the session is still valid: tick/reconnect must work
      // so the client can see the takeover and reclaim the seat. Actions that
      // need a live seat check `actorInfo.seat` themselves.
      const takenFrom = rs.takenFrom || {};
      const index = Object.keys(takenFrom).find((i) => takenFrom[i] === playerId);
      if (index == null) return fail('not seated in this room', 'E_SEAT', 403);
      touch(rs, playerId);
      return { ok: true, playerId, seat: null, session, takenOver: true };
    }
    touch(rs, playerId);
    seat.connected = true;
    return { ok: true, playerId, seat, session };
  }

  function createRoom(body) {
    const playerId = cleanPlayerId(body.playerId);
    if (!playerId) return fail('playerId must be 1..24 letters, digits, space, dot or dash', 'E_PLAYER', 422);
    if (hasPii(body)) return fail('personal contact fields are not accepted', 'E_PII', 422);
    if (body.password != null && (String(body.password).length < 4 || String(body.password).length > 64)) {
      return fail('password must be 4..64 characters', 'E_PASSWORD', 422);
    }
    const made = store.create({
      hostId: playerId,
      gameId: game,
      nickname: cleanNickname(body.nickname, playerId),
      password: body.password == null ? null : String(body.password),
      visibility: body.visibility === 'private' ? 'private' : 'public',
      maxPlayers: 2
    });
    const id = made.room.id;
    const rs = {
      id,
      room: made.room,
      inviteToken: made.invite.token,
      code: made.room.code,
      seats: newSeats(playerId),
      started: false,
      match: null,
      lastSeen: new Map([[playerId, Date.now()]]),
      takeover: {},
      takeoverSeats: [],
      startedAt: 0,
      nextAiAt: 0,
      resultRecorded: false
    };
    rs.seats[0].nickname = cleanNickname(body.nickname, playerId);
    rooms.set(id, rs);
    return { status: 201, body: Object.assign(roomMeta(rs, 0), {
      playerSession: issueSession(id, playerId),
      inviteToken: made.invite.token,
      inviteCode: made.room.code,
      roomCode: made.room.code,
      seats: roomMeta(rs, 0).seats
    }) };
  }

  function joinRoom(rs, body) {
    const playerId = cleanPlayerId(body.playerId);
    if (!playerId) return fail('playerId required', 'E_PLAYER', 422);
    if (hasPii(body)) return fail('personal contact fields are not accepted', 'E_PII', 422);
    let joined;
    if (body.inviteCode) {
      const invite = store.verifyInvite(String(body.inviteCode));
      if (!invite.ok) return fail(invite.message, invite.code, 403);
      if (invite.roomId !== rs.id) return fail('invite belongs to another room', 'E_INVITE', 403);
      joined = store.consumeInvite(String(body.inviteCode), { playerId, nickname: cleanNickname(body.nickname, playerId) });
    } else {
      joined = store.join(rs.id, {
        playerId,
        nickname: cleanNickname(body.nickname, playerId),
        password: body.password
      });
    }
    if (!joined || joined.ok === false) {
      return fail(joined && (joined.message || joined.code) || 'join rejected', joined && joined.code || 'E_JOIN', 409);
    }
    rs.room = store.get(rs.id) || rs.room;
    let seat = seatOf(rs, playerId);
    if (!seat) {
      const free = rs.seats.find((s) => s.ai);
      if (!free) return fail('room is full', 'E_FULL', 409);
      free.ai = false;
      free.playerId = playerId;
      free.nickname = cleanNickname(body.nickname, playerId);
      free.connected = true;
      seat = free;
    }
    rs.lastSeen.set(playerId, Date.now());
    delete rs.takeover[seat.index];
    rs.takeoverSeats = Object.keys(rs.takeover).map(Number);
    return { status: 200, body: Object.assign(roomMeta(rs, seat.index), {
      playerSession: issueSession(rs.id, playerId),
      inviteCode: rs.room.code,
      roomCode: rs.room.code
    }) };
  }

  function startRoom(rs, actorInfo) {
    if (rs.room.hostId !== actorInfo.playerId) return fail('only the host can start', 'E_HOST', 403);
    if (rs.started) return fail('match already started', 'E_STATE', 409);
    if (humanCount(rs) < 1) return fail('need at least one player', 'E_PLAYERS', 409);
    rs.seats.forEach((seat) => {
      if (seat.ai) seat.nickname = aiNames[seat.index] || seat.nickname;
    });
    rs.match = { state: adapter.initialState(rs.seats.map((s) => ({ index: s.index, nickname: s.nickname, ai: s.ai }))), events: [] };
    rs.started = true;
    rs.startedAt = Date.now();
    rs.nextAiAt = Date.now() + aiDelayMs;
    rs.resultRecorded = false;
    try { store.start(rs.id, actorInfo.playerId); } catch (err) { /* store may disagree if AI filled */ }
    runAi(rs, true);
    return { status: 200, body: viewFor(rs, actorInfo.playerId) };
  }

  function applyAction(rs, actorInfo, body) {
    if (!actorInfo.seat) return fail('seat is under AI control', 'E_TAKEOVER', 409);
    if (!rs.started || !rs.match) return fail('match has not started', 'E_STATE', 409);
    if (adapter.isOver(rs.match.state)) return fail('match is already over', 'E_STATE', 409);
    const turnSeat = adapter.turnSeat(rs.match.state);
    if (turnSeat !== actorInfo.seat.index) return fail('not your turn', 'E_TURN', 409);
    if (rs.seats[actorInfo.seat.index].ai) return fail('seat is under AI control', 'E_TAKEOVER', 409);
    const type = body.type || 'move';
    let next;
    try {
      if (type === 'resign') {
        next = adapter.resign(rs.match.state, actorInfo.seat.index);
      } else {
        next = adapter.apply(rs.match.state, body, actorInfo.seat.index);
      }
    } catch (err) {
      return fail(err.message || 'action rejected', 'E_ACTION', 422);
    }
    rs.match.state = next;
    rs.match.events = [{ type, seat: actorInfo.seat.index, at: Date.now() }];
    rs.nextAiAt = Date.now() + aiDelayMs;
    if (adapter.isOver(next)) pushResult(rs);
    runAi(rs, false);
    return { status: 200, body: viewFor(rs, actorInfo.playerId) };
  }

  function reconnect(rs, body, search) {
    const token = (body && (body.session || body.token)) || (search && search.get('session'));
    const playerId = cleanPlayerId((body && body.playerId) || (search && search.get('playerId')));
    if (!token || !playerId) return fail('session and playerId required', 'E_AUTH', 401);
    const session = sessionFor(token);
    if (!session || session.roomId !== rs.id || session.playerId !== playerId) {
      return fail('invalid session', 'E_AUTH', 403);
    }
    let seat = seatOf(rs, playerId);
    if (!seat && rs.takenFrom) {
      const index = Object.keys(rs.takenFrom).find((i) => rs.takenFrom[i] === playerId);
      if (index != null && rs.seats[Number(index)]) seat = rs.seats[Number(index)];
    }
    if (!seat) return fail('no reconnectable seat', 'E_SEAT', 403);
    if (seat.ai) {
      seat.ai = false;
      seat.playerId = playerId;
      seat.nickname = cleanNickname(body.nickname, playerId);
      delete rs.takeover[seat.index];
      rs.takeoverSeats = Object.keys(rs.takeover).map(Number);
    }
    seat.connected = true;
    rs.lastSeen.set(playerId, Date.now());
    return { status: 200, body: Object.assign({ reconnected: true }, viewFor(rs, playerId)) };
  }

  function leave(rs, actorInfo) {
    if (!actorInfo.seat) return fail('seat is under AI control', 'E_TAKEOVER', 409);
    const seat = actorInfo.seat;
    if (rs.started) {
      markTakeover(rs, seat, 'left');
      runAi(rs, true);
    } else {
      seat.ai = true;
      seat.playerId = null;
      seat.nickname = aiNames[seat.index] || seat.nickname;
    }
    try { store.leave(rs.id, actorInfo.playerId); } catch (err) { /* best effort */ }
    rs.room = store.get(rs.id) || rs.room;
    return { status: 200, body: { ok: true, roomId: rs.id, playerId: actorInfo.playerId, left: true } };
  }

  function restart(rs, actorInfo) {
    if (!rs.room || rs.room.hostId !== actorInfo.playerId) return fail('only the host can restart', 'E_HOST', 403);
    if (!rs.started) return fail('match has not started', 'E_STATE', 409);
    rs.seats.forEach((seat) => {
      if (seat.ai && !seat.playerId) seat.nickname = aiNames[seat.index] || seat.nickname;
    });
    rs.match = { state: adapter.initialState(rs.seats.map((s) => ({ index: s.index, nickname: s.nickname, ai: s.ai }))), events: [] };
    rs.resultRecorded = false;
    rs.startedAt = Date.now();
    rs.nextAiAt = Date.now() + aiDelayMs;
    try { store.start(rs.id, actorInfo.playerId); } catch (err) { /* room may still be playing */ }
    runAi(rs, true);
    return { status: 200, body: viewFor(rs, actorInfo.playerId) };
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep)) { res.writeHead(403); res.end('forbidden'); return true; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(data);
    });
    return true;
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch (err) { res.writeHead(400); res.end('bad url'); return; }
    const pathname = url.pathname;

    if (pathname === '/health' || pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, game, rooms: rooms.size, uptime: process.uptime() });
    }
    if (pathname === '/api/leaderboard' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, game, entries: leaderboard.slice(0, 20) });
    }
    if (pathname === '/api/rooms' && req.method === 'POST') {
      return readJson(req).then((body) => {
        const out = createRoom(body || {});
        if (out.status >= 400) return sendError(res, out);
        sendJson(res, 201, out.body);
      }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
    }
    if (pathname === '/api/rooms' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        game,
        rooms: Array.from(rooms.values()).filter((r) => r.room && r.room.visibility !== 'private').map((r) => ({
          roomId: r.id, roomCode: r.room.code, status: r.started ? 'playing' : 'waiting',
          players: humanCount(r)
        }))
      });
    }

    const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/([a-z]+))?$/);
    if (!match) {
      if (req.method === 'GET') return serveStatic(req, res, pathname);
      return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
    }
    const rs = roomFor(decodeURIComponent(match[1]));
    if (!rs) return sendError(res, fail('room not found', 'E_NOT_FOUND', 404));
    const actionName = match[2] || '';

    try {
      if (!actionName && req.method === 'GET') {
        const token = url.searchParams.get('session');
        const playerId = cleanPlayerId(url.searchParams.get('playerId'));
        let seat = playerId ? seatOf(rs, playerId) : null;
        let authed = false;
        if (token && playerId) {
          const session = sessionFor(token);
          if (session && session.roomId === rs.id && session.playerId === playerId) {
            authed = true;
            touch(rs, playerId);
            if (seat) seat.connected = true;
          }
        }
        if (rs.room && rs.room.visibility === 'private' && !authed) {
          return sendError(res, fail('private room requires a session', 'E_PRIVATE', 403));
        }
        if (rs.started) expireTakeovers(rs);
        return sendJson(res, 200, viewFor(rs, seat ? seat.playerId : null));
      }

      if (actionName === 'join' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const out = joinRoom(rs, body || {});
          if (out.status >= 400) return sendError(res, out);
          sendJson(res, 200, out.body);
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'start' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          const out = startRoom(rs, who);
          if (out.status >= 400) return sendError(res, out);
          sendJson(res, out.status, out.body);
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'actions' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          const out = applyAction(rs, who, body || {});
          if (out.status >= 400) return sendError(res, out);
          sendJson(res, out.status, out.body);
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'reconnect' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const out = reconnect(rs, body || {}, url.searchParams);
          if (out.status >= 400) return sendError(res, out);
          sendJson(res, out.status, out.body);
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'leave' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          const out = leave(rs, who);
          sendJson(res, out.status, out.body);
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'invite' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.room || rs.room.hostId !== who.playerId) return sendError(res, fail('only the host can invite', 'E_HOST', 403));
          const invite = store.invite(rs.id, { inviterId: who.playerId, ttlMs: 60 * 60 * 1000 });
          rs.inviteToken = invite.token;
          sendJson(res, 200, { ok: true, roomId: rs.id, roomCode: rs.room.code, inviteToken: invite.token, expiresAt: invite.expiresAt });
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'tick' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.started) return sendError(res, fail('match has not started', 'E_STATE', 409));
          expireTakeovers(rs);
          runAi(rs, (body && body.force) !== false);
          sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (actionName === 'restart' && req.method === 'POST') {
        return readJson(req).then((body) => {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          const out = restart(rs, who);
          if (out.status >= 400) return sendError(res, out);
          sendJson(res, out.status, out.body);
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400)));
      }

      if (!actionName && req.method === 'DELETE') {
        const who = actor(req, {}, rs, url.searchParams);
        if (!who.ok) return sendError(res, who);
        if (!rs.room || rs.room.hostId !== who.playerId) return sendError(res, fail('only the host can close', 'E_HOST', 403));
        try { store.close(rs.id, who.playerId); } catch (err) { /* best effort */ }
        rooms.delete(rs.id);
        return sendJson(res, 200, { ok: true, roomId: rs.id, closed: true });
      }
      return sendError(res, fail('method not allowed', 'E_METHOD', 405));
    } catch (err) {
      return sendError(res, fail(err.message || 'server error', err.code || 'E_SERVER', 500));
    }
  });

  const interval = setInterval(() => {
    for (const rs of rooms.values()) {
      try { expireTakeovers(rs); } catch (err) { rs.lastAiError = err && err.message; }
    }
  }, 250);
  interval.unref();

  return {
    server,
    rooms,
    leaderboard,
    adapter,
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

export async function startGameServer(options) {
  const opts = options || {};
  const app = createRoomServer(opts);
  const address = await app.listen(opts.port == null ? 8787 : opts.port, opts.host);
  return { app, server: app.server, address, close: app.close };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  const modArg = process.argv.indexOf('--adapter');
  if (modArg === -1) {
    console.error('usage: node boardgame-room-server.mjs --adapter ./online-adapter.mjs [--port 8787]');
    process.exit(1);
  }
  import(pathToFileURL(path.resolve(process.argv[modArg + 1])).href).then(async (mod) => {
    const handle = await startGameServer(Object.assign({ port }, mod.default || mod));
    console.log('[room-server] http://' + handle.address.address + ':' + handle.address.port + '/  game=' + handle.app.adapter.game);
  }).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}
