#!/usr/bin/env node
/* 东京妖都 — online room server.
 *
 * Reuses the shared room state machine in ../app/rooms.js (password rooms,
 * single-use invites, TTL, host/join/leave) and mirrors the HTTP shape of the
 * Codenames premium sample and app/server.mjs:
 *
 *   POST /api/rooms                       create room
 *   POST /api/rooms/:id/join              join (password or invite token)
 *   GET  /api/rooms/:id                   room + authoritative game state
 *   POST /api/rooms/:id/start             host starts; empty seats become AI
 *   POST /api/rooms/:id/actions           engine action
 *   POST /api/rooms/:id/reconnect         session reconnect + takeover clear
 *   POST /api/rooms/:id/leave             leave (seat becomes AI)
 *   POST /api/rooms/:id/invite            host creates another invite token
 *   POST /api/rooms/:id/tick              force AI steps (E2E/manual sync)
 *   POST /api/rooms/:id/restart           host restarts a finished match
 *   DELETE /api/rooms/:id                 host closes
 *   GET  /api/leaderboard                 finished-game board
 *   GET  /health | /api/health
 *
 * Kot has no hidden information, so every member receives the full engine
 * state. The server remains authoritative: it only accepts actions returned by
 * E.getLegalMoves(state), and drives AI seats / idle-takeover seats with
 * E.selectAIMove. No external network calls, no PII, 127.0.0.1 by default.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRoomStoreInternal } from '../app/rooms.js';
import { SOLO_AI_FILL, startRoomWithAiFill } from '../app/ai-seat.mjs';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const DATA = require('./data.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GAMES_ROOT = path.join(REPO_ROOT, 'games');
const ASSET_ROOT = path.join(GAMES_ROOT, 'assets');
const SHARED_ROOT = path.join(GAMES_ROOT, 'shared');
const MAX_BODY = 64 * 1024;
const SLOT_LABELS = { city: '东京城', bay: '东京湾' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

function randomHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }
function fail(message, code, status) {
  return { ok: false, error: { code: code || 'E_ROOM', message: message }, status: status || 409 };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function actingIndex(state) {
  if (!state) return -1;
  if (state.pending && state.pending.playerId) {
    return state.players.findIndex(function (p) { return p.id === state.pending.playerId; });
  }
  return state.current;
}

function sameMove(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'toggleLock') return a.index === b.index;
  if (a.type === 'enterTokyo') return a.slot === b.slot;
  if (a.type === 'yieldDecision') return !!a.leave === !!b.leave;
  if (a.type === 'buyCard') return a.cardId === b.cardId;
  return true;
}

function normalizeAction(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.action && typeof body.action === 'object') return body.action;
  var action = { type: body.type };
  if (body.index != null) action.index = Number(body.index);
  if (body.slot != null) action.slot = String(body.slot);
  if (body.cardId != null) action.cardId = String(body.cardId);
  if (body.leave != null) action.leave = !!body.leave;
  if (body.actionType != null) action.type = String(body.actionType);
  return action;
}

export function createOnlineServer(options) {
  const opts = options || {};
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 300);
  const store = opts.roomStore || createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: 4
  });
  const rooms = new Map();
  const sessions = new Map();
  const leaderboard = [];
  let seq = 0;
  let matchSeq = 0;

  function issueSession(roomId, playerId) {
    const token = 'ksess_' + (++seq) + '_' + randomHex(9);
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
    return rs.seats.find(function (s) { return !s.ai && s.playerId === playerId; }) || null;
  }
  function currentSeat(rs) {
    if (!rs || !rs.match) return null;
    const index = actingIndex(rs.match.state);
    return index >= 0 ? rs.seats[index] || null : null;
  }
  function touch(rs, playerId) {
    if (!rs || !playerId) return;
    rs.lastSeen.set(playerId, Date.now());
    const seat = seatOfPlayer(rs, playerId);
    if (seat) delete rs.takeover[seat.index];
  }
  function takeoverActive(rs, seat, now) {
    if (!seat) return false;
    if (seat.ai || !seat.playerId) return true;
    if (rs.takeover[seat.index]) return true;
    const seen = rs.lastSeen.get(seat.playerId) || rs.startedAt || now;
    if (now - seen > idleTimeoutMs) {
      rs.takeover[seat.index] = true;
      return true;
    }
    return false;
  }
  function assignSeats(playerIds) {
    const seats = [];
    for (let i = 0; i < 4; i += 1) {
      const playerId = playerIds[i] || null;
      seats.push(playerId ? {
        index: i, playerId: playerId, nickname: playerId, ai: false
      } : {
        index: i, playerId: null, nickname: '电脑 ' + (i + 1), ai: true
      });
    }
    return seats;
  }
  function seatState(rs, seat, now) {
    const current = currentSeat(rs);
    const ai = seat.ai || (seat.playerId ? takeoverActive(rs, seat, now) : true);
    return {
      index: seat.index, seat: 'seat-' + seat.index,
      playerId: seat.playerId, nickname: seat.nickname, ai: !!seat.ai,
      takeover: !!rs.takeover[seat.index], controlledByAI: !!ai,
      current: current ? current.index === seat.index : false,
      monsterId: DATA.MONSTERS[seat.index].id,
      monsterName: DATA.MONSTERS[seat.index].name
    };
  }

  function createMatch(rs) {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const players = rs.seats.map(function (seat, i) {
      return {
        name: seat.nickname || ('电脑 ' + (i + 1)),
        monsterId: DATA.MONSTERS[i].id,
        ai: !!seat.ai
      };
    });
    matchSeq += 1;
    return {
      id: 'km_' + matchSeq + '_' + randomHex(5),
      game: 'kot-premium',
      seed: seed,
      state: E.createGame({ seed: seed, playerCount: 4, players: players })
    };
  }

  function recordResult(rs) {
    if (!rs || !rs.match || rs.resultRecorded) return;
    const state = rs.match.state;
    if (!state.gameOver) return;
    rs.resultRecorded = true;
    rs.finishedAt = Date.now();
    try { store.finish(rs.room.id, rs.room.hostId); } catch (err) { /* host may have left */ }
    const entry = {
      id: 'kresult_' + rs.id + '_' + rs.finishedAt,
      roomId: rs.id, roomCode: rs.room.code, game: 'kot-premium',
      winner: state.winnerName, winnerId: state.winner, winReason: state.winReason,
      players: state.players.map(function (p, i) {
        return {
          index: i, name: p.name, monster: DATA.MONSTERS[i].name,
          vp: p.vp, hp: p.hp, maxHp: p.maxHp, alive: p.alive,
          ai: !!rs.seats[i].ai, playerId: rs.seats[i].playerId
        };
      }),
      turns: state.turn, round: state.round,
      durationMs: rs.finishedAt - (rs.startedAt || rs.finishedAt),
      finishedAt: new Date(rs.finishedAt).toISOString(),
      seats: rs.seats.map(function (s) {
        return { index: s.index, playerId: s.playerId, nickname: s.nickname, ai: !!s.ai };
      })
    };
    leaderboard.unshift(entry);
    if (leaderboard.length > 100) leaderboard.length = 100;
    rs.lastResult = entry;
  }

  function tick(rs, force) {
    if (!rs || !rs.match || !rs.started) return;
    let guard = 0;
    while (guard < 600) {
      const state = rs.match.state;
      if (state.gameOver) { recordResult(rs); break; }
      const seat = currentSeat(rs);
      if (!seat) break;
      const now = Date.now();
      if (!takeoverActive(rs, seat, now)) break;
      if (!force && now < (rs.nextAiAt || 0)) break;
      const move = E.selectAIMove(state);
      if (!move) break;
      const before = state.logSeq;
      const next = E.applyMove(state, move);
      rs.match.state = next;
      rs.events = next.log.filter(function (e) { return e.seq > before; });
      rs.lastActionAt = now;
      guard += 1;
      if (!force) {
        rs.nextAiAt = now + aiDelayMs;
        break;
      }
    }
    recordResult(rs);
  }

  function viewFor(rs, playerId) {
    const state = rs.match ? rs.match.state : null;
    const seat = seatOfPlayer(rs, playerId);
    const now = Date.now();
    const currentIndex = state ? actingIndex(state) : -1;
    const current = currentSeat(rs);
    const myTurn = Boolean(state && seat && !seat.ai && currentIndex === seat.index &&
      !takeoverActive(rs, seat, now) && !state.gameOver);
    const seats = rs.seats.map(function (s) { return seatState(rs, s, now); });
    return {
      ok: true,
      roomId: rs.id,
      roomCode: rs.room.code,
      inviteCode: rs.room.code,
      inviteToken: playerId === rs.room.hostId ? rs.inviteToken : null,
      game: 'kot-premium',
      hostId: rs.room.hostId,
      visibility: rs.room.visibility,
      hasPassword: rs.room.hasPassword,
      maxPlayers: 4,
      status: !state ? 'waiting' : state.gameOver ? 'finished' : (rs.started ? 'playing' : 'waiting'),
      roomStatus: rs.room.status,
      started: !!rs.started,
      seats: seats,
      you: seat ? {
        playerId: seat.playerId, seat: 'seat-' + seat.index,
        index: seat.index, nickname: seat.nickname,
        monsterId: DATA.MONSTERS[seat.index].id,
        monsterName: DATA.MONSTERS[seat.index].name
      } : null,
      currentIndex: currentIndex,
      currentSeat: current ? 'seat-' + current.index : null,
      currentPlayerId: current && !current.ai ? current.playerId : null,
      currentSeatIsAI: current ? takeoverActive(rs, current, now) : false,
      takeoverSeats: seats.filter(function (s) { return s.takeover; }).map(function (s) { return s.seat; }),
      aiSeats: seats.filter(function (s) { return s.ai; }).map(function (s) { return s.seat; }),
      yourTurn: myTurn,
      canAct: myTurn,
      legalMoves: myTurn ? E.getLegalMoves(state) : [],
      state: state ? clone(state) : null,
      winner: state ? state.winnerName : null,
      winnerId: state ? state.winner : null,
      winReason: state ? state.winReason : null,
      log: state ? state.log.slice(-30) : [],
      lastEvents: rs.events || [],
      result: rs.lastResult || null,
      createdAt: rs.room.createdAt,
      expiresAt: rs.room.expiresAt,
      idleTimeoutMs: idleTimeoutMs
    };
  }

  function qget(query, key) {
    if (!query) return null;
    if (typeof query.get === 'function') return query.get(key);
    return query[key] == null ? null : String(query[key]);
  }
  function actor(req, body, rs, query) {
    const input = body || {};
    const q = query || {};
    const token = input.session || input.playerSession || input.token ||
      qget(q, 'session') || qget(q, 'playerSession') || qget(q, 'token');
    const session = sessionFor(token);
    if (token && !session) return { ok: false, status: 403, code: 'E_SESSION', message: 'invalid session token' };
    if (session && session.roomId !== rs.id) {
      return { ok: false, status: 403, code: 'E_SESSION', message: 'session does not belong to this room' };
    }
    const playerId = input.playerId || input.userId || qget(q, 'playerId') || qget(q, 'userId') ||
      (session && session.playerId) || null;
    if (!playerId) return { ok: false, status: 401, code: 'E_PLAYER', message: 'playerId or session is required' };
    const seat = seatOfPlayer(rs, playerId);
    if (!seat) return { ok: false, status: 403, code: 'E_PLAYER', message: 'not a member of this room' };
    if (session && session.playerId !== playerId) {
      return { ok: false, status: 403, code: 'E_SESSION', message: 'session does not match playerId' };
    }
    return { ok: true, playerId: playerId, seat: seat, session: token || null };
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
    const code = f.code || (f.error && f.error.code) || 'E_ROOM';
    const message = f.message || (f.error && f.error.message) || 'room operation rejected';
    sendJson(res, f.status || 409, { ok: false, error: { code: code, message: message } });
  }
  function readJson(req) {
    return new Promise(function (resolve, reject) {
      let size = 0;
      const chunks = [];
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('body too large'), { code: 'E_BODY' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', function () {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(Object.assign(new Error('invalid JSON'), { code: 'E_JSON' })); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    let file = null;
    if (pathname === '/' || pathname === '/online.html') file = path.join(__dirname, 'online.html');
    else if (pathname === '/index.html') file = path.join(__dirname, 'index.html');
    else if (pathname === '/rules.html') file = path.join(__dirname, 'rules.html');
    else if (pathname === '/data.js') file = path.join(__dirname, 'data.js');
    else if (pathname === '/engine.js') file = path.join(__dirname, 'engine.js');
    else if (pathname === '/meta.json') file = path.join(__dirname, 'meta.json');
    else if (pathname === '/games/boardgame/kot-premium/index.html') file = path.join(__dirname, 'index.html');
    else if (pathname === '/games/boardgame/kot-premium/online.html') file = path.join(__dirname, 'online.html');
    else if (pathname === '/games/boardgame/kot-premium/meta.json') file = path.join(__dirname, 'meta.json');
    else if (pathname === '/games/boardgame/kot-premium/rules.html') file = path.join(__dirname, 'rules.html');
    else if (pathname === '/games/boardgame/kot-premium/data.js') file = path.join(__dirname, 'data.js');
    else if (pathname === '/games/boardgame/kot-premium/engine.js') file = path.join(__dirname, 'engine.js');
    else if (pathname.indexOf('/games/assets/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/games/assets/'.length));
      const resolved = path.resolve(ASSET_ROOT, rel);
      if (resolved !== ASSET_ROOT && resolved.indexOf(ASSET_ROOT + path.sep) !== 0) return sendError(res, fail('invalid asset path', 'E_PATH', 400));
      file = resolved;
    } else if (pathname.indexOf('/games/shared/') === 0) {
      const rel = decodeURIComponent(pathname.slice('/games/shared/'.length));
      const resolved = path.resolve(SHARED_ROOT, rel);
      if (resolved !== SHARED_ROOT && resolved.indexOf(SHARED_ROOT + path.sep) !== 0) return sendError(res, fail('invalid shared path', 'E_PATH', 400));
      file = resolved;
    }
    else if (pathname.indexOf('/assets/') === 0) {
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
    fs.stat(file, function (err, stat) {
      if (err || !stat.isFile()) return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'content-length': stat.size
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(function (req, res) {
    res.on('error', function () {});
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
      return sendJson(res, 200, {
        ok: true, status: 'ok', service: 'kot-premium-online', game: 'kot-premium',
        rooms: rooms.size, sessions: sessions.size, leaderboard: leaderboard.length,
        idleTimeoutMs: idleTimeoutMs
      });
    }

    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      return sendJson(res, 200, {
        ok: true, game: 'kot-premium', entries: leaderboard.slice(0, limit), total: leaderboard.length
      });
    }

    if (req.method === 'POST' && pathname === '/api/rooms') {
      return readJson(req).then(function (body) {
        const input = body || {};
        const playerId = input.playerId || input.hostId || input.userId;
        if (!playerId) return sendError(res, fail('playerId is required', 'E_INVALID_ARGS', 422));
        if (input.email || input.phone) return sendError(res, fail('personal information is not accepted', 'E_PII', 422));
        let created;
        try {
          created = store.create({
            hostId: playerId,
            gameId: 'kot-premium',
            visibility: input.visibility == null ? 'public' : input.visibility,
            password: input.password,
            maxPlayers: 4,
            nickname: input.nickname || playerId
          });
        } catch (err) {
          return sendError(res, fail(err.message || 'cannot create room', err.code || 'E_ROOM', 422));
        }
        const room = created.room;
        const rs = {
          id: room.id, room: room, seats: assignSeats(room.players),
          sessions: new Map(), lastSeen: new Map([[playerId, Date.now()]]),
          takeover: {}, started: false, startedAt: 0, match: null,
          inviteToken: created.invite ? created.invite.token : null,
          resultRecorded: false, nextAiAt: 0, events: [], lastResult: null
        };
        rooms.set(room.id, rs);
        const token = issueSession(room.id, playerId);
        rs.sessions.set(token, playerId);
        const view = viewFor(rs, playerId);
        sendJson(res, 201, Object.assign({}, view, {
          playerSession: token, playerId: playerId,
          inviteToken: created.invite ? created.invite.token : null
        }));
      }).catch(function (err) {
        sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
      });
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
        if (session && session.roomId !== rs.id) {
          return sendError(res, fail('session does not belong to this room', 'E_SESSION', 403));
        }
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
        return readJson(req).then(function (body) {
          const input = body || {};
          const playerId = input.playerId || input.userId;
          if (!playerId) return sendError(res, fail('playerId is required', 'E_INVALID_ARGS', 422));
          const invite = input.inviteCode || input.inviteToken;
          let result;
          if (invite && invite !== rs.room.code) {
            const verified = store.verifyInvite(invite);
            if (!verified.ok) return sendError(res, fail('invalid or expired invite', 'E_INVITE', 403));
            result = store.consumeInvite(invite, { playerId: playerId, nickname: input.nickname || playerId });
          } else {
            result = store.join(rs.id, {
              playerId: playerId,
              password: input.password,
              nickname: input.nickname || playerId
            });
          }
          if (!result || !result.ok) {
            const code = result && result.code;
            const status = code === 'E_PASSWORD' || code === 'E_INVITE' ? 403
              : code === 'E_LOCKED' ? 423 : code === 'E_FULL' ? 409
                : code === 'E_NOT_FOUND' ? 404 : 422;
            return sendError(res, fail((result && result.message) || 'join rejected', code || 'E_JOIN', status));
          }
          const room = store.get(rs.id) || result.room;
          rs.room = room;
          if (!rs.started) rs.seats = assignSeats(room.players);
          const token = issueSession(rs.id, playerId);
          rs.sessions.set(token, playerId);
          rs.lastSeen.set(playerId, Date.now());
          return sendJson(res, 200, Object.assign({}, viewFor(rs, playerId), {
            playerSession: token, playerId: playerId
          }));
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'reconnect' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const token = body && (body.token || body.session || body.playerSession);
          const session = sessionFor(token);
          if (!session || session.roomId !== rs.id) {
            return sendError(res, fail('invalid session token', 'E_TOKEN', 403));
          }
          const playerId = body.playerId || body.userId || session.playerId;
          if (playerId !== session.playerId) return sendError(res, fail('session does not match playerId', 'E_SESSION', 403));
          touch(rs, playerId);
          tick(rs, false);
          return sendJson(res, 200, Object.assign({}, viewFor(rs, playerId), {
            playerSession: token, playerId: playerId, reconnected: true
          }));
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'start' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can start', 'E_HOST', 403));
          if (rs.started) return sendError(res, fail('match already started', 'E_STATE', 409));
          const started = startRoomWithAiFill(store, rs.id, who.playerId, rs.room.players.length, SOLO_AI_FILL.minHumanPlayers);
          if (!started || !started.ok) return sendError(res, fail((started && started.message) || 'cannot start', (started && started.code) || 'E_START', 409));
          rs.room = started.solo ? Object.assign({}, rs.room, { status: 'playing' }) : (store.get(rs.id) || rs.room);
          rs.seats = assignSeats(rs.room.players);
          rs.match = createMatch(rs);
          rs.started = true;
          rs.startedAt = Date.now();
          rs.resultRecorded = false;
          rs.takeover = {};
          rs.lastSeen = new Map();
          rs.seats.forEach(function (s) { if (s.playerId) rs.lastSeen.set(s.playerId, Date.now()); });
          rs.nextAiAt = Date.now() + aiDelayMs;
          rs.events = [];
          rs.lastResult = null;
          tick(rs, true);
          return sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'restart' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can restart', 'E_HOST', 403));
          if (!rs.match || !rs.match.state.gameOver) {
            return sendError(res, fail('match is not over', 'E_STATE', 409));
          }
          rs.match = createMatch(rs);
          rs.started = true;
          rs.startedAt = Date.now();
          rs.resultRecorded = false;
          rs.takeover = {};
          rs.lastSeen = new Map();
          rs.seats.forEach(function (s) { if (s.playerId) rs.lastSeen.set(s.playerId, Date.now()); });
          rs.nextAiAt = Date.now() + aiDelayMs;
          rs.events = [];
          rs.lastResult = null;
          touch(rs, who.playerId);
          tick(rs, true);
          return sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'actions' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.started || !rs.match) return sendError(res, fail('match has not started', 'E_STATE', 409));
          touch(rs, who.playerId);
          const state = rs.match.state;
          if (state.gameOver) return sendError(res, fail('match is over', 'E_STATE', 409));
          const index = actingIndex(state);
          if (index !== who.seat.index) return sendError(res, fail('not this player\'s turn', 'E_TURN', 409));
          if (takeoverActive(rs, who.seat, Date.now())) {
            return sendError(res, fail('seat is under AI takeover; poll/reconnect to recover', 'E_TAKEOVER', 409));
          }
          const action = normalizeAction(body);
          const legal = E.getLegalMoves(state);
          if (!legal.some(function (m) { return sameMove(m, action); })) {
            return sendError(res, fail('action is not legal', 'E_ACTION', 422));
          }
          const before = state.logSeq;
          const next = E.applyMove(state, action);
          rs.match.state = next;
          rs.events = next.log.filter(function (e) { return e.seq > before; });
          rs.nextAiAt = Date.now() + aiDelayMs;
          tick(rs, true);
          return sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'tick' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.started) return sendError(res, fail('match has not started', 'E_STATE', 409));
          tick(rs, body && body.force !== false);
          return sendJson(res, 200, viewFor(rs, who.playerId));
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'invite' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can invite', 'E_HOST', 403));
          const invite = store.invite(rs.id, { inviterId: who.playerId, ttlMs: 60 * 60 * 1000 });
          rs.inviteToken = invite.token;
          return sendJson(res, 200, {
            ok: true, roomId: rs.id, inviteCode: rs.room.code,
            inviteToken: invite.token, expiresAt: invite.expiresAt
          });
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (actionName === 'leave' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          const seat = who.seat;
          if (rs.started) {
            seat.ai = true;
            seat.playerId = null;
            seat.nickname = seat.nickname + ' AI（托管）';
            rs.takeover[seat.index] = true;
          }
          try { store.leave(rs.id, who.playerId); } catch (err) { /* room may already be finished */ }
          rs.lastSeen.delete(who.playerId);
          rs.room = store.get(rs.id) || rs.room;
          if (!rs.started) rs.seats = assignSeats(rs.room.players);
          return sendJson(res, 200, { ok: true, roomId: rs.id, playerId: who.playerId, left: true });
        }).catch(function (err) {
          sendError(res, fail(err.message || 'bad request', err.code || 'E_JSON', err.code === 'E_BODY' ? 413 : 400));
        });
      }

      if (!actionName && req.method === 'DELETE') {
        const who = actor(req, {}, rs, url.searchParams);
        if (!who.ok) return sendError(res, who);
        if (who.playerId !== rs.room.hostId) return sendError(res, fail('only the host can close', 'E_HOST', 403));
        store.close(rs.id, who.playerId);
        rooms.delete(rs.id);
        return sendJson(res, 200, { ok: true, roomId: rs.id, closed: true });
      }

      return sendError(res, fail('method not allowed', 'E_METHOD', 405));
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    return sendError(res, fail('not found', 'E_NOT_FOUND', 404));
  });

  const interval = setInterval(function () {
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
      return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(Number.isFinite(port) ? port : 8787, host || '127.0.0.1', function () {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      clearInterval(interval);
      return new Promise(function (resolve) {
        server.close(function () { resolve(); });
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    }
  };
}

export async function startOnlineServer(options) {
  const opts = options || {};
  const app = createOnlineServer(opts);
  const address = await app.listen(opts.port == null ? 8787 : opts.port, opts.host);
  return Object.assign({}, app, { address: address });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.argv[2] || process.env.PORT || 8787);
  startOnlineServer({ port: port }).then(function (handle) {
    console.log('东京妖都 online server: http://127.0.0.1:' + handle.address.port + '/online.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
