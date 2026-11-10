#!/usr/bin/env node
/*
 * Shared authoritative online room server for premium board games.
 *
 * Every premium game ships a thin `online-server.mjs` that calls
 * `startGameOnlineServer({ game, engine, ... })`. The room/invite/password
 * state machine lives in `rooms.js`; this module owns the HTTP/JSON API,
 * seats, AI fill, reconnect, idle takeover, rematch and leaderboard.
 *
 * Game-specific parts are injected:
 *   createState(seats, seed)  -> fresh engine state
 *   publicState(state)        -> JSON-safe public view (hide decks/bags)
 *   moveOf(body)              -> engine move object from a request body
 *   applyMove(state, move)    -> next state  (default engine.applyMove)
 *   aiStep(state)             -> next state after one AI turn
 *   legalMoves(state)         -> public legal moves for the current seat
 *   resultRows(state)         -> [{index,name,total,...}] for the leaderboard
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRoomStoreInternal } from './rooms.js';
import { makeAiStep } from './ai-seat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(GAMES_ROOT, '..');
const ASSET_ROOT = path.join(GAMES_ROOT, 'assets');
const SHARED_ROOT = path.join(GAMES_ROOT, 'shared');
const APP_ROOT = path.join(GAMES_ROOT, 'boardgame', 'app');
const MAX_BODY = 96 * 1024;
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
  return { ok: false, error: { code: code || 'E_ROOM', message: message } , status: status || 409 };
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

export function createGameOnlineServer(options) {
  const opts = options || {};
  const game = opts.game || 'game';
  const engine = opts.engine;
  if (!engine) throw new Error('engine is required');
  const createState = opts.createState;
  const publicState = opts.publicState || ((state) => state);
  const moveOf = opts.moveOf || ((body) => body.move || body.act || body);
  const applyMove = opts.applyMove || ((state, move) => engine.applyMove(state, move));
  const fallbackAiStep = makeAiStep(engine, applyMove);
  const currentSeat = opts.currentSeat || ((state) => (state && state.current != null ? state.current : 0));
  const legalMoves = opts.legalMoves || (typeof engine.getLegalMoves === 'function'
    ? (state) => engine.getLegalMoves(state) : () => []);
  const aiNames = opts.aiNames || ['AI · 1', 'AI · 2', 'AI · 3', 'AI · 4', 'AI · 5'];
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 650);
  const maxPlayers = Math.max(2, Math.min(6, Number(opts.maxPlayers) || 4));
  const defaultPlayers = Math.max(2, Math.min(maxPlayers, Number(opts.defaultPlayers) || 2));
  const minHumanPlayers = Math.max(1, Number(opts.minHumanPlayers) || 2);
  const store = opts.roomStore || createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: maxPlayers
  });
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  let seq = 0;

  function issueSession(roomId, playerId) {
    const token = game.slice(0, 2) + 'sess_' + (++seq) + '_' + randomHex(9);
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
        nickname: playerId ? (old ? old.nickname : playerId) : aiNames[i] || ('AI · 座位 ' + (i + 1)),
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
      current: !!(rs.match && currentSeat(rs.match.state) === seat.index)
    };
  }
  function resultRows(state) {
    if (typeof opts.resultRows === 'function') return opts.resultRows(state);
    const result = state && state.result;
    if (!result) return [];
    if (Array.isArray(result.scores) && result.scores.length && typeof result.scores[0] === 'object') {
      return result.scores.map((row, i) => ({
        index: row.index == null ? i : row.index,
        name: row.name || ('玩家 ' + (i + 1)),
        total: row.total == null ? row.base : row.total
      }));
    }
    return (state.players || []).map((p, i) => ({ index: i, name: p.name, total: result.scores[i] }));
  }
  function recordResult(rs) {
    if (!rs || !rs.match || rs.resultRecorded) return;
    const state = rs.match.state;
    if (!state.over) return;
    rs.resultRecorded = true;
    rs.finishedAt = Date.now();
    try { store.finish(rs.room.id, rs.room.hostId); } catch (err) { /* host may have left */ }
    const rows = resultRows(state);
    const best = rows.reduce((m, row) => Math.max(m, row.total), -Infinity);
    const winners = rows.filter((row) => row.total === best);
    const entry = {
      id: game + '_result_' + rs.id + '_' + rs.finishedAt,
      roomId: rs.id,
      roomCode: rs.room.code,
      game: game,
      winner: winners.length === 1 ? winners[0].index : null,
      tied: winners.length !== 1,
      winnerName: winners.length === 1 ? winners[0].name : null,
      scores: rows,
      rounds: state.round || state.turn || null,
      turns: state.turn == null ? null : state.turn,
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
      const seat = rs.seats[currentSeat(state)];
      if (!seat) break;
      if (!controlled(rs, seat, Date.now())) break;
      if (!force && Date.now() < (rs.nextAiAt || 0)) break;
      try {
        const next = opts.aiStep ? opts.aiStep(state) : fallbackAiStep(state);
        rs.match.state = next;
        rs.events = next.lastAction ? [next.lastAction] : (next.events || []).slice(-3);
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
    const currentSeatRow = state ? rs.seats[currentSeat(state)] : null;
    const currentControlled = currentSeatRow ? controlled(rs, currentSeatRow, now) : true;
    const canMove = Boolean(seat && state && !state.over && currentSeat(state) === seat.index && !currentControlled);
    const viewState = state ? publicState(state) : null;
    if (viewState && viewState.players) {
      viewState.players.forEach((p, i) => {
        const s = rs.seats[i];
        if (!s) return;
        p.name = s.nickname;
        p.isAI = seats[i].controlledByAI;
      });
    }
    const base = {
      ok: true,
      roomId: rs.id,
      roomCode: rs.room.code,
      inviteCode: rs.room.code,
      inviteToken: playerId === rs.room.hostId ? rs.inviteToken : null,
      game: game,
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
      currentPlayerIndex: state ? currentSeat(state) : null,
      currentPlayerId: currentSeatRow && !currentControlled ? currentSeatRow.playerId : null,
      currentControlledByAI: currentControlled,
      currentSeat: currentSeatRow ? currentSeatRow.index : null,
      takeoverSeats: seats.filter((s) => s.takeover).map((s) => s.index),
      aiSeats: seats.filter((s) => s.ai).map((s) => s.index),
      canMove: canMove,
      canStart: !rs.started && rs.room.hostId === playerId && rs.room.players.length >= 2,
      canRestart: !!rs.match && rs.match.state.over && rs.room.hostId === playerId,
      isHost: rs.room.hostId === playerId,
      state: viewState,
      legalMoves: canMove && typeof legalMoves === 'function' ? legalMoves(state) : [],
      lastEvents: rs.events || [],
      lastAiError: rs.lastAiError || null,
      result: rs.lastResult || null,
      createdAt: rs.room.createdAt,
      expiresAt: rs.room.expiresAt
    };
    return typeof opts.viewExtras === 'function'
      ? Object.assign(base, opts.viewExtras(rs, state, playerId) || {})
      : base;
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
    const seats = rs.seats.slice();
    const state = createState(seats, seed);
    state.players.forEach((p, i) => {
      p.name = seats[i] ? seats[i].nickname : p.name;
      p.isAI = seats[i] ? seats[i].ai : true;
    });
    state.current = typeof opts.startingSeat === 'function' ? opts.startingSeat(state) : (state.current || 0);
    return { id: game.slice(0, 2) + '_' + randomHex(6), game: game, state: state };
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
    const gameRoot = path.resolve(__dirname, '..', opts.dir || '');
    const local = (name) => path.join(gameRoot, name);
    const gamePrefix = '/boardgame/' + (opts.dir || '') + '/';
    if (pathname === '/' || pathname === '/index.html') {
      const target = '/boardgame/' + (opts.dir || '') + '/index.html';
      res.writeHead(302, { location: target });
      res.end();
      return;
    }
    if (pathname === '/online.html') file = local('online.html');
    else if (pathname === '/rules.html') file = local('rules.html');
    else if (pathname === '/engine.js') file = local('engine.js');
    else if (pathname === '/sw.js') file = local('sw.js');
    else if (pathname === '/meta.json') file = local('meta.json');
    else if (pathname === '/DESIGN.md') file = local('DESIGN.md');
    else if (pathname.indexOf(gamePrefix) === 0) {
      const rel = decodeURIComponent(pathname.slice(gamePrefix.length));
      if (rel.indexOf('..') !== -1) return sendError(res, fail('invalid path', 'E_PATH', 400));
      file = path.join(gameRoot, rel);
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
    } else if (pathname.indexOf('/boardgame/app/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/boardgame/app/'.length));
      const resolved = path.resolve(APP_ROOT, rel);
      if (resolved !== APP_ROOT && resolved.indexOf(APP_ROOT + path.sep) !== 0) {
        return sendError(res, fail('invalid app path', 'E_PATH', 400));
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
        ok: true, status: 'ok', service: game + '-premium-online', game: game,
        rooms: rooms.size, sessions: sessions.size, leaderboard: leaderboard.length,
        idleTimeoutMs: idleTimeoutMs
      });
    }
    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      return sendJson(res, 200, { ok: true, game: game, entries: leaderboard.slice(0, limit), total: leaderboard.length });
    }
    if (req.method === 'POST' && pathname === '/api/rooms') {
      return readJson(req).then((body) => {
        const input = body || {};
        const playerId = input.playerId || input.hostId || input.userId;
        if (!playerId) return sendError(res, fail('playerId is required', 'E_INVALID_ARGS', 422));
        if (input.email || input.phone) return sendError(res, fail('personal information is not accepted', 'E_PII', 422));
        const roomMax = Math.max(2, Math.min(maxPlayers, Number(input.maxPlayers) || defaultPlayers));
        let created;
        try {
          created = store.create({
            hostId: playerId,
            gameId: game,
            visibility: input.visibility == null ? 'public' : input.visibility,
            password: input.password,
            maxPlayers: roomMax,
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
          if (rs.room.players.length < minHumanPlayers) {
            const need = minHumanPlayers === 1 ? '1 human player' : minHumanPlayers + ' human players';
            return sendError(res, fail('need at least ' + need + '; empty seats are AI', 'E_PLAYERS', 409));
          }
          const started = rs.room.players.length >= 2
            ? store.start(rs.id, who.playerId)
            : null;
          if (rs.room.players.length >= 2 && (!started || !started.ok)) {
            return sendError(res, fail((started && started.message) || 'cannot start', (started && started.code) || 'E_START', 409));
          }
          if (started && started.ok) {
            rs.room = store.get(rs.id) || rs.room;
          } else {
            // Solo start against AI: the room store wants two members, so mark
            // the live room playing without persisting a second player.
            rs.room = Object.assign({}, rs.room, { status: 'playing' });
          }
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
          if (currentSeat(state) !== who.seat.index) return sendError(res, fail('not this player\'s turn', 'E_TURN', 409));
          if (controlled(rs, who.seat, Date.now())) return sendError(res, fail('seat is AI-controlled', 'E_TAKEOVER', 409));
          let move;
          try { move = moveOf(body, state); }
          catch (err) { return sendError(res, fail(err.message || 'move is required', 'E_ACTION', 422)); }
          if (!move || typeof move !== 'object') return sendError(res, fail('move is required', 'E_ACTION', 422));
          let next;
          try { next = applyMove(state, move); }
          catch (err) { return sendError(res, fail(err.message || 'action rejected', 'E_ACTION', 422)); }
          rs.match.state = next;
          rs.events = next.lastAction ? [next.lastAction] : (next.events || []).slice(-4);
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
            seat.nickname = aiNames[seat.index] || ('AI · 座位 ' + (seat.index + 1));
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

export async function startGameOnlineServer(options) {
  const opts = options || {};
  const app = createGameOnlineServer(opts);
  const address = await app.listen(opts.port == null ? 8787 : opts.port, opts.host);
  return { app: app, server: app.server, address: address, close: app.close };
}
