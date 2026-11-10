#!/usr/bin/env node
/*
 * Splendor premium — online room server.
 *
 * Reuses the shared room state machine in ../app/rooms.js (password rooms,
 * single-use invites, TTL, host/join/leave/start/close) and exposes a small
 * HTTP/JSON API plus static files:
 *
 *   POST /api/rooms                         create room (2 seats)
 *   POST /api/rooms/:id/join                join by password or invite
 *   GET  /api/rooms/:id                     room + public game state
 *   POST /api/rooms/:id/start               host starts; empty seat becomes AI
 *   POST /api/rooms/:id/actions             { type:'move', move:{...} }
 *   POST /api/rooms/:id/reconnect           session reconnect + takeover clear
 *   POST /api/rooms/:id/leave               leave (seat becomes AI)
 *   POST /api/rooms/:id/invite              host creates another invite
 *   POST /api/rooms/:id/tick                force AI steps (E2E/manual sync)
 *   POST /api/rooms/:id/restart             host rematch after game over
 *   DELETE /api/rooms/:id                   host closes
 *   GET  /api/leaderboard                   finished-game board
 *   GET  /health | /api/health
 *
 * Rules are enforced by engine.js on the server. Empty seats are AI. A human
 * seat idle for longer than idleTimeoutMs is temporarily AI-controlled; any
 * GET/action/reconnect clears the takeover. No PII, no external calls.
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

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(__dirname, '../..');
const ASSET_ROOT = path.join(GAMES_ROOT, 'assets');
const SHARED_ROOT = path.join(GAMES_ROOT, 'shared');
const GAME = 'splendor';
const MAX_PLAYERS = 2;
const AI_NAMES = ['AI · 黄金座位', 'AI · 白银座位'];
const PII_KEYS = ['email', 'phone', 'mobile', 'address', 'realName', 'idCard', 'passport'];
const MAX_BODY = 64 * 1024;
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
    'content-length': Buffer.byteLength(text),
    'access-control-allow-origin': '*'
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
function hasPii(body) {
  if (!body || typeof body !== 'object') return false;
  return PII_KEYS.some((key) => body[key] != null && String(body[key]).trim() !== '');
}

function publicState(state, viewerIndex) {
  if (!state) return null;
  const viewer = viewerIndex;
  return {
    seed: state.seed,
    current: state.current,
    round: state.round,
    turn: state.turn,
    over: state.over,
    overReason: state.overReason,
    endgameTriggered: state.endgameTriggered,
    gems: state.gems,
    faceUp: {
      1: state.faceUp[1].map((card) => card ? Object.assign({}, card) : null),
      2: state.faceUp[2].map((card) => card ? Object.assign({}, card) : null),
      3: state.faceUp[3].map((card) => card ? Object.assign({}, card) : null)
    },
    deckCounts: {
      1: state.decks[1].length,
      2: state.decks[2].length,
      3: state.decks[3].length
    },
    nobles: state.nobles,
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      isAI: p.isAI,
      tokens: p.tokens,
      bonuses: p.bonuses,
      prestige: p.prestige,
      cards: p.cards,
      reserved: p.index === viewer ? p.reserved : p.reserved.map(() => ({ hidden: true })),
      nobles: p.nobles
    })),
    result: state.result,
    log: state.log.slice(-40)
  };
}

function scoreRows(state) {
  const rows = state.result && state.result.scores ? state.result.scores : [];
  return rows.map((r) => ({
    index: r.index, name: r.name, total: r.prestige,
    prestige: r.prestige, cards: r.cards, nobles: r.nobles
  }));
}

function newMatch(rs) {
  const names = rs.seats.map((s) => s.nickname);
  const state = E.createGame({ seed: rs.seed, names: names });
  state.players.forEach((p, i) => {
    p.name = names[i];
    p.isAI = !!(rs.seats[i] && rs.seats[i].ai);
  });
  return { id: 'sp_' + randomHex(6), game: GAME, state: state };
}

export function createOnlineServer(options) {
  const opts = options || {};
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 650);
  const store = opts.roomStore || createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: MAX_PLAYERS
  });
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  const startedAt = Date.now();
  let seq = 0;

  function issueSession(roomId, playerId) {
    const token = 'sess_' + (++seq) + '_' + randomHex(9);
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
    const previous = rs.seats || [];
    const seats = [];
    for (let i = 0; i < (room || rs.room).maxPlayers; i += 1) {
      const playerId = players[i] || null;
      const old = previous.find((s) => s.playerId === playerId && playerId);
      seats.push({
        index: i,
        playerId: playerId,
        nickname: playerId ? (old ? old.nickname : playerId) : AI_NAMES[i] || ('AI · 座位 ' + (i + 1)),
        ai: !playerId,
        takeover: false
      });
    }
    rs.seats = seats;
    return seats;
  }
  function seatState(rs, seat) {
    const isControlled = controlled(rs, seat, Date.now());
    const takeover = !seat.ai && !!rs.takeover[seat.index];
    return {
      index: seat.index,
      playerIndex: seat.index,
      playerId: seat.playerId,
      nickname: seat.nickname,
      label: seat.playerId ? '玩家 ' + (seat.index + 1) : 'AI 座位 ' + (seat.index + 1),
      ai: !!seat.ai,
      takeover: takeover,
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
    const rows = scoreRows(state);
    const winnerRow = rows.find((row) => row.index === (state.result ? state.result.winner : null));
    const entry = {
      id: GAME + '_result_' + rs.id + '_' + rs.finishedAt,
      roomId: rs.id,
      roomCode: rs.room.code,
      game: GAME,
      winner: state.result ? state.result.winner : null,
      tied: !!(state.result && state.result.winner == null),
      winnerName: winnerRow ? winnerRow.name : null,
      scores: rows,
      rounds: state.round || state.turn || 0,
      turns: state.turn || 0,
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
    while (guard < 800 && !rs.match.state.over) {
      const state = rs.match.state;
      const seat = rs.seats[state.current];
      if (!seat) break;
      if (!controlled(rs, seat, Date.now())) break;
      if (!force && Date.now() < (rs.nextAiAt || 0)) break;
      let move;
      try {
        move = E.chooseAIMove(state);
      } catch (err) {
        rs.lastAiError = err && err.message ? err.message : String(err);
        break;
      }
      try {
        const next = E.applyMove(state, move);
        rs.match.state = next;
        rs.events = [next.lastAction || next.lastMove || null];
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
    const now = Date.now();
    const seats = rs.seats.map((s) => seatState(rs, s));
    const currentSeat = state ? rs.seats[state.current] : null;
    const currentControlled = currentSeat ? controlled(rs, currentSeat, now) : true;
    const canMove = Boolean(seat && state && !state.over && state.current === seat.index && !currentControlled);
    return {
      ok: true,
      roomId: rs.id,
      roomCode: rs.room.code,
      inviteCode: rs.room.code,
      inviteToken: playerId === rs.room.hostId ? rs.inviteToken : null,
      game: GAME,
      hostId: rs.room.hostId,
      visibility: rs.room.visibility,
      hasPassword: rs.room.hasPassword,
      maxPlayers: rs.room.maxPlayers,
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
      canStart: !rs.started && rs.room.hostId === playerId,
      canRestart: !!rs.match && rs.match.state.over && rs.room.hostId === playerId,
      isHost: rs.room.hostId === playerId,
      state: state ? publicState(state, seat ? seat.index : -1) : null,
      legalMoves: canMove ? E.getLegalMoves(state) : [],
      lastEvents: rs.events || [],
      lastAiError: rs.lastAiError || null,
      result: rs.lastResult || null,
      createdAt: rs.room.createdAt,
      expiresAt: rs.room.expiresAt
    };
  }
  function actor(body, rs, query) {
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
  function resetForRematch(rs) {
    rs.started = true;
    rs.startedAt = Date.now();
    rs.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    rs.match = newMatch(rs);
    rs.resultRecorded = false;
    rs.takeover = {};
    rs.lastSeen = new Map();
    rs.seats.forEach((s) => { if (s.playerId) rs.lastSeen.set(s.playerId, Date.now()); });
    rs.nextAiAt = Date.now() + aiDelayMs;
    rs.events = [];
    rs.lastResult = null;
    rs.lastAiError = null;
    rs.finishedAt = null;
  }
  function createRoom(input) {
    const body = input || {};
    if (hasPii(body)) return fail('personal data is not accepted', 'E_PII', 422);
    if (!body.playerId) return fail('playerId is required', 'E_PLAYER', 400);
    let password = body.password == null ? null : String(body.password);
    if (password !== null && (password.length < 4 || password.length > 64)) {
      return fail('password must be 4..64 characters', 'E_PASSWORD', 400);
    }
    const created = store.create({
      hostId: body.playerId,
      nickname: body.nickname || body.playerId,
      gameId: GAME,
      visibility: body.visibility === 'private' ? 'private' : 'public',
      password: password,
      maxPlayers: MAX_PLAYERS
    });
    const rs = {
      id: created.room.id,
      room: store.get(created.room.id),
      inviteToken: created.invite.token,
      seats: [],
      match: null,
      started: false,
      startedAt: 0,
      seed: 0,
      lastSeen: new Map(),
      takeover: {},
      events: [],
      lastResult: null,
      lastAiError: null,
      resultRecorded: false,
      nextAiAt: 0
    };
    assignSeats(rs);
    rs.lastSeen.set(body.playerId, Date.now());
    rooms.set(rs.id, rs);
    const session = issueSession(rs.id, body.playerId);
    const view = viewFor(rs, body.playerId);
    return {
      status: 201,
      body: Object.assign({}, view, { playerSession: session, inviteToken: created.invite.token, roomId: rs.id, roomCode: rs.room.code })
    };
  }
  function joinRoom(rs, body) {
    const input = body || {};
    if (hasPii(input)) return fail('personal data is not accepted', 'E_PII', 422);
    if (!input.playerId) return fail('playerId is required', 'E_PLAYER', 400);
    if (rs.started) return fail('room already started', 'E_LOCKED', 403);
    let result;
    if (input.inviteCode || input.inviteToken) {
      result = store.consumeInvite(String(input.inviteCode || input.inviteToken), {
        playerId: input.playerId, nickname: input.nickname || input.playerId
      });
    } else {
      result = store.join(rs.id, {
        playerId: input.playerId, nickname: input.nickname || input.playerId, password: input.password
      });
    }
    if (!result || result.ok === false) return fail((result && result.message) || 'join rejected', (result && result.code) || 'E_JOIN', 403);
    rs.room = store.get(rs.id) || rs.room;
    assignSeats(rs);
    rs.lastSeen.set(input.playerId, Date.now());
    const session = issueSession(rs.id, input.playerId);
    const view = viewFor(rs, input.playerId);
    return { status: 200, body: Object.assign({}, view, { playerSession: session, roomId: rs.id, roomCode: rs.room.code }) };
  }

  function serveStatic(req, res, pathname) {
    let file = null;
    const local = (name) => path.join(__dirname, name);
    if (pathname === '/' || pathname === '/index.html') file = local('index.html');
    else if (pathname === '/online.html') file = local('online.html');
    else if (pathname === '/rules.html') file = local('rules.html');
    else if (pathname === '/engine.js') file = local('engine.js');
    else if (pathname === '/data.js') file = local('data.js');
    else if (pathname === '/sw.js') file = local('sw.js');
    else if (pathname === '/meta.json') file = local('meta.json');
    else if (pathname === '/DESIGN.md') file = local('DESIGN.md');
    else if (pathname.indexOf('/boardgame/' + path.basename(__dirname) + '/') === 0) {
      const rel = decodeURIComponent(pathname.slice(('/boardgame/' + path.basename(__dirname) + '/').length));
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
    const pathname = url.pathname;
    const method = req.method || 'GET';
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type'
      });
      res.end();
      return;
    }
    if (pathname === '/health' || pathname === '/api/health') {
      sendJson(res, 200, { ok: true, game: GAME, rooms: rooms.size, uptimeMs: Date.now() - startedAt, externalRequests: 0 });
      return;
    }
    if (pathname === '/api/leaderboard' && method === 'GET') {
      sendJson(res, 200, { ok: true, game: GAME, entries: leaderboard.slice(0, 50) });
      return;
    }
    if (pathname === '/api/rooms' && method === 'POST') {
      readJson(req).then((body) => {
        const created = createRoom(body);
        if (created.ok === false) return sendError(res, created);
        sendJson(res, created.status || 201, created.body);
      }).catch((err) => sendError(res, fail(err.message, err.code || 'E_BODY', 400)));
      return;
    }
    const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/([a-z]+))?$/);
    if (match) {
      const rs = resolveRoom(decodeURIComponent(match[1]));
      const action = match[2] || '';
      if (!rs) return sendError(res, fail('room not found', 'E_NOT_FOUND', 404));
      if (method === 'GET' && !action) {
        const q = url.searchParams;
        const auth = actor(null, rs, q);
        if (rs.room.hasPassword && rs.room.visibility === 'private' && auth.ok === false) {
          return sendError(res, fail('private room requires a session', 'E_PRIVATE', 403));
        }
        const playerId = auth.ok ? auth.playerId : null;
        if (playerId) touch(rs, playerId);
        tick(rs, false);
        return sendJson(res, 200, viewFor(rs, playerId));
      }
      if (method === 'POST' && action) {
        readJson(req).then((body) => {
          if (hasPii(body)) return sendError(res, fail('personal data is not accepted', 'E_PII', 422));
          if (action === 'join') {
            const joined = joinRoom(rs, body);
            if (joined.ok === false) return sendError(res, joined);
            return sendJson(res, joined.status || 200, joined.body);
          }
          const auth = actor(body, rs, url.searchParams);
          if (auth.ok === false) return sendError(res, auth);
          if (action === 'start') {
            if (rs.room.hostId !== auth.playerId) return sendError(res, fail('only the host can start', 'E_HOST', 403));
            if (rs.started) return sendError(res, fail('already started', 'E_STARTED', 409));
            if (rs.room.players.length >= 2) {
              const started = store.start(rs.id, auth.playerId);
              if (started && started.ok === false) return sendError(res, fail(started.message, started.code, 409));
            }
            rs.started = true;
            rs.startedAt = Date.now();
            rs.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
            rs.match = newMatch(rs);
            rs.resultRecorded = false;
            rs.takeover = {};
            rs.seats.forEach((s) => { if (s.playerId) rs.lastSeen.set(s.playerId, Date.now()); });
            tick(rs, false);
            return sendJson(res, 200, viewFor(rs, auth.playerId));
          }
          if (action === 'actions') {
            if (!rs.started || !rs.match) return sendError(res, fail('game not started', 'E_STATE', 409));
            const state = rs.match.state;
            if (state.over) return sendError(res, fail('game is over', 'E_OVER', 409));
            if (state.current !== auth.seat.index) return sendError(res, fail('not your turn', 'E_TURN', 409));
            if (controlled(rs, auth.seat, Date.now())) return sendError(res, fail('seat is AI-controlled', 'E_TAKEOVER', 409));
            const move = body.move || body;
            try {
              const next = E.applyMove(state, move);
              rs.match.state = next;
              rs.events = [next.lastAction || next.lastMove || move];
              rs.lastActionAt = Date.now();
              if (next.over) recordResult(rs);
              else tick(rs, false);
            } catch (err) {
              return sendError(res, fail(err && err.message ? err.message : 'illegal move', 'E_MOVE', 409));
            }
            touch(rs, auth.playerId);
            return sendJson(res, 200, viewFor(rs, auth.playerId));
          }
          if (action === 'reconnect') {
            const token = body.token || body.session || url.searchParams.get('token');
            const session = sessionFor(token);
            if (!session) return sendError(res, fail('invalid reconnect token', 'E_TOKEN', 403));
            if (session.playerId !== auth.playerId || session.roomId !== rs.id) {
              return sendError(res, fail('token does not match player', 'E_TOKEN', 403));
            }
            touch(rs, auth.playerId);
            tick(rs, false);
            return sendJson(res, 200, Object.assign({}, viewFor(rs, auth.playerId), { reconnected: true }));
          }
          if (action === 'leave') {
            store.leave(rs.id, auth.playerId);
            rs.room = store.get(rs.id) || rs.room;
            assignSeats(rs);
            return sendJson(res, 200, viewFor(rs, auth.playerId));
          }
          if (action === 'invite') {
            if (rs.room.hostId !== auth.playerId) return sendError(res, fail('only the host can invite', 'E_HOST', 403));
            const invite = store.invite(rs.id, { inviterId: auth.playerId });
            return sendJson(res, 200, { ok: true, inviteToken: invite.token, inviteCode: invite.token, expiresAt: invite.expiresAt });
          }
          if (action === 'tick') {
            tick(rs, !!body.force);
            return sendJson(res, 200, viewFor(rs, auth.playerId));
          }
          if (action === 'restart') {
            if (rs.room.hostId !== auth.playerId) return sendError(res, fail('only the host can restart', 'E_HOST', 403));
            if (!rs.match || !rs.match.state.over) return sendError(res, fail('game is not over', 'E_STATE', 409));
            resetForRematch(rs);
            tick(rs, false);
            return sendJson(res, 200, viewFor(rs, auth.playerId));
          }
          return sendError(res, fail('unknown action', 'E_ACTION', 404));
        }).catch((err) => sendError(res, fail(err.message, err.code || 'E_BODY', 400)));
        return;
      }
      if (method === 'DELETE' && !action) {
        const auth = actor(null, rs, url.searchParams);
        if (auth.ok === false) return sendError(res, auth);
        if (rs.room.hostId !== auth.playerId) return sendError(res, fail('only the host can close', 'E_HOST', 403));
        store.close(rs.id, auth.playerId);
        rooms.delete(rs.id);
        return sendJson(res, 200, { ok: true, closed: true });
      }
      return sendError(res, fail('method not allowed', 'E_METHOD', 405));
    }
    if (method === 'GET') return serveStatic(req, res, pathname);
    return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
  });

  return server;
}

export function startOnlineServer(options) {
  const opts = options || {};
  const server = createOnlineServer(opts);
  const port = opts.port == null ? 0 : Number(opts.port);
  const host = opts.host || '127.0.0.1';
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        server: server,
        address: server.address(),
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--port');
  const port = at !== -1 ? Number(args[at + 1]) : 8787;
  startOnlineServer({ port: port, host: '127.0.0.1' }).then((handle) => {
    console.log(GAME + ' online server on http://127.0.0.1:' + handle.address.port);
  }).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
