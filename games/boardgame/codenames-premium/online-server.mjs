#!/usr/bin/env node
/* Codenames Premium — online room server.
 *
 * Reuses the shared room state machine in ../app/rooms.js (password rooms,
 * single-use invites, TTL, host/join/leave) and exposes the same HTTP shape as
 * app/server.mjs:
 *
 *   POST /api/rooms                       create room
 *   POST /api/rooms/:id/join              join (password or invite token)
 *   GET  /api/rooms/:id                   room + per-player game view
 *   POST /api/rooms/:id/start             host starts; empty seats become AI
 *   POST /api/rooms/:id/actions           clue / guess / pass
 *   POST /api/rooms/:id/reconnect         session reconnect + takeover clear
 *   POST /api/rooms/:id/leave             leave (seat becomes AI until rejoin)
 *   POST /api/rooms/:id/invite            host creates another invite token
 *   POST /api/rooms/:id/tick              force AI steps (E2E/manual sync)
 *   DELETE /api/rooms/:id                 host closes
 *   GET  /api/leaderboard                 finished-game board
 *   GET  /health | /api/health
 *
 * Seats (fixed, no hidden roles): red-captain, red-operative,
 * blue-captain, blue-operative. Empty seats are AI. A human seat whose last
 * poll/action is older than idleTimeoutMs is temporarily AI-controlled
 * (timeout takeover); any GET/action/reconnect clears the takeover.
 *
 * No external network calls, no PII. Listen on 127.0.0.1 by default.
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
const REPO_ROOT = path.resolve(__dirname, '../../..');
const GAMES_ROOT = path.join(REPO_ROOT, 'games');
const ASSET_ROOT = path.join(GAMES_ROOT, 'assets');
const SHARED_ROOT = path.join(GAMES_ROOT, 'shared');
const MAX_BODY = 64 * 1024;
const SEATS = [
  { id: 'red-captain', team: 'red', role: 'captain' },
  { id: 'red-operative', team: 'red', role: 'operative' },
  { id: 'blue-captain', team: 'blue', role: 'captain' },
  { id: 'blue-operative', team: 'blue', role: 'operative' }
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function randomHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }
function fail(message, code, status) { return { ok: false, error: { code: code || 'E_ROOM', message: message }, status: status || 409 }; }
function teamLabel(team) { return team === 'red' ? '红队' : '蓝队'; }
function roleLabel(seat) { return seat ? teamLabel(seat.team) + (seat.role === 'captain' ? '队长' : '队员') : ''; }

function seatForTeamPhase(state) {
  if (!state || state.phase === 'over') return null;
  return state.turn + '-' + (state.phase === 'clue' ? 'captain' : 'operative');
}

function makeAiSeat(def) {
  return {
    id: def.id, team: def.team, role: def.role,
    playerId: null, nickname: teamLabel(def.team) + ' AI' + (def.role === 'captain' ? '队长' : '队员'),
    ai: true
  };
}

function assignSeats(playerIds) {
  return SEATS.map(function (def, index) {
    var playerId = playerIds[index] || null;
    if (!playerId) return makeAiSeat(def);
    return {
      id: def.id, team: def.team, role: def.role,
      playerId: playerId, nickname: playerId, ai: false
    };
  });
}

export function createOnlineServer(options) {
  const opts = options || {};
  const idleTimeoutMs = Math.max(100, Number(opts.idleTimeoutMs) || 15000);
  const aiDelayMs = Math.max(0, Number(opts.aiDelayMs) || 650);
  const store = opts.roomStore || createRoomStoreInternal({
    ttlMs: opts.roomTtlMs || 2 * 60 * 60 * 1000,
    maxPlayers: 4
  });
  const rooms = new Map(); // roomId -> {
  //   id, room, seats, sessions, lastSeen, takeover, started, match,
  //   inviteToken, resultRecorded, nextAiAt, events, finishedAt
  // }
  const sessions = new Map(); // token -> {roomId, playerId}
  const leaderboard = [];
  let seq = 0;

  function issueSession(roomId, playerId) {
    const token = 'csess_' + (++seq) + '_' + randomHex(9);
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
    const id = seatForTeamPhase(rs.match.state);
    return id ? rs.seats.find(function (s) { return s.id === id; }) || null : null;
  }
  function touch(rs, playerId) {
    if (!rs || !playerId) return;
    rs.lastSeen.set(playerId, Date.now());
    const seat = seatOfPlayer(rs, playerId);
    if (seat) delete rs.takeover[seat.id];
  }
  function takeoverActive(rs, seat, now) {
    if (!seat) return false;
    if (seat.ai || !seat.playerId) return true;
    if (rs.takeover[seat.id]) return true;
    const seen = rs.lastSeen.get(seat.playerId) || rs.startedAt || now;
    if (now - seen > idleTimeoutMs) {
      rs.takeover[seat.id] = true;
      return true;
    }
    return false;
  }
  function seatState(rs, seat) {
    const now = Date.now();
    const ai = !seat.ai && seat.playerId ? takeoverActive(rs, seat, now) : seat.ai;
    return {
      id: seat.id, team: seat.team, role: seat.role,
      label: roleLabel(seat), playerId: seat.playerId,
      nickname: seat.nickname, ai: !!seat.ai, takeover: !!rs.takeover[seat.id],
      controlledByAI: !!ai,
      current: currentSeat(rs) ? currentSeat(rs).id === seat.id : false
    };
  }

  function recordResult(rs) {
    if (!rs || !rs.match || rs.resultRecorded) return;
    const state = rs.match.state;
    if (state.phase !== 'over') return;
    rs.resultRecorded = true;
    rs.finishedAt = Date.now();
    try { store.finish(rs.room.id, rs.room.hostId); } catch (err) { /* host may have left */ }
    const entry = {
      id: 'result_' + rs.id + '_' + rs.finishedAt,
      roomId: rs.id,
      roomCode: rs.room.code,
      game: 'codenames',
      winner: state.winner,
      scores: { red: state.scores.red, blue: state.scores.blue },
      turns: state.turnNo,
      durationMs: rs.finishedAt - (rs.startedAt || rs.finishedAt),
      finishedAt: new Date(rs.finishedAt).toISOString(),
      seats: rs.seats.map(function (s) {
        return {
          id: s.id, team: s.team, role: s.role,
          playerId: s.playerId, nickname: s.nickname, ai: !!s.ai
        };
      })
    };
    leaderboard.unshift(entry);
    if (leaderboard.length > 100) leaderboard.length = 100;
    rs.lastResult = entry;
  }

  function tick(rs, force) {
    if (!rs || !rs.match || !rs.started) return;
    const state = rs.match.state;
    if (state.phase === 'over') { recordResult(rs); return; }
    let guard = 0;
    while (guard < 600) {
      const seat = currentSeat(rs);
      if (!seat) break;
      const now = Date.now();
      if (!takeoverActive(rs, seat, now)) break;
      if (!force && now < (rs.nextAiAt || 0)) break;
      const action = E.aiAction(state);
      if (!action) break;
      const result = E.applyAction(state, action);
      if (!result.ok) {
        rs.lastAiError = result.error || 'AI action rejected';
        break;
      }
      rs.events = result.events || [];
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
    const reveal = !state || state.phase === 'over' ||
      Boolean(seat && seat.role === 'captain');
    const gameView = state ? E.viewFor(state, reveal) : null;
    const now = Date.now();
    const seats = rs.seats.map(function (s) { return seatState(rs, s); });
    const current = currentSeat(rs);
    return {
      ok: true,
      roomId: rs.id,
      roomCode: rs.room.code,
      inviteCode: rs.room.code,
      inviteToken: playerId === rs.room.hostId ? rs.inviteToken : null,
      game: 'codenames',
      hostId: rs.room.hostId,
      visibility: rs.room.visibility,
      hasPassword: rs.room.hasPassword,
      maxPlayers: rs.room.maxPlayers,
      status: state && state.phase === 'over' ? 'finished'
        : rs.started ? 'playing' : (rs.room.status || 'waiting'),
      roomStatus: rs.room.status,
      started: !!rs.started,
      seats: seats,
      players: seats.map(function (s) {
        return {
          id: s.playerId || s.id, seat: s.id, nickname: s.nickname,
          team: s.team, role: s.role, ai: s.ai, takeover: s.takeover
        };
      }),
      you: seat ? {
        playerId: seat.playerId, seat: seat.id, team: seat.team,
        role: seat.role, label: roleLabel(seat)
      } : null,
      currentSeat: current ? current.id : null,
      currentSeatLabel: current ? roleLabel(current) : null,
      currentPlayerId: current && !current.ai ? current.playerId : null,
      currentSeatIsAI: current ? takeoverActive(rs, current, now) : false,
      takeoverSeats: seats.filter(function (s) { return s.takeover; }).map(function (s) { return s.id; }),
      aiSeats: seats.filter(function (s) { return s.ai; }).map(function (s) { return s.id; }),
      turn: state ? state.turn : null,
      phase: state ? state.phase : 'waiting',
      turnNo: state ? state.turnNo : 0,
      clue: gameView ? gameView.clue : null,
      guessesLeft: gameView ? gameView.guessesLeft : 0,
      guessesMade: gameView ? gameView.guessesMade : 0,
      scores: gameView ? gameView.scores : { red: 0, blue: 0 },
      remaining: gameView ? gameView.remaining : { red: 9, blue: 8 },
      target: gameView ? gameView.target : { red: 9, blue: 8 },
      winner: gameView ? gameView.winner : null,
      keyVisible: Boolean(gameView && gameView.keyVisible),
      words: gameView ? gameView.words : [],
      log: gameView ? gameView.log : [],
      canClue: Boolean(seat && current && seat.id === current.id && seat.role === 'captain' &&
        state && state.phase === 'clue'),
      canGuess: Boolean(seat && current && seat.id === current.id && seat.role === 'operative' &&
        state && state.phase === 'guess'),
      canPass: Boolean(seat && current && seat.id === current.id && seat.role === 'operative' &&
        state && state.phase === 'guess' && state.guessesMade >= 1),
      suggestedClue: reveal && state && state.phase === 'clue' ? E.aiClue(state) : null,
      lastEvents: rs.events || [],
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
      q.session || q.playerSession || q.token;
    const session = sessionFor(token);
    if (token && !session) return { ok: false, status: 403, code: 'E_SESSION', message: 'invalid session token' };
    if (session && session.roomId !== rs.id) {
      return { ok: false, status: 403, code: 'E_SESSION', message: 'session does not belong to this room' };
    }
    const playerId = input.playerId || input.userId || q.playerId || q.userId ||
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
    if (pathname === '/' || pathname === '/index.html') file = path.join(__dirname, 'index.html');
    else if (pathname === '/online.html') file = path.join(__dirname, 'online.html');
    else if (pathname === '/rules.html') file = path.join(__dirname, 'rules.html');
    else if (pathname === '/detail.html') file = path.join(__dirname, 'detail.html');
    else if (pathname === '/smoke.html') file = path.join(__dirname, 'smoke.html');
    else if (pathname === '/engine.js') file = path.join(__dirname, 'engine.js');
    else if (pathname === '/words.js') file = path.join(__dirname, 'words.js');
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
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
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

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true, status: 'ok', service: 'codenames-premium-online',
        game: 'codenames', rooms: rooms.size, sessions: sessions.size,
        leaderboard: leaderboard.length, idleTimeoutMs: idleTimeoutMs
      });
    }

    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      return sendJson(res, 200, {
        ok: true, game: 'codenames', entries: leaderboard.slice(0, limit), total: leaderboard.length
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
            gameId: 'codenames',
            visibility: input.visibility == null ? 'public' : input.visibility,
            password: input.password,
            maxPlayers: 4,
            nickname: playerId
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
            result = store.consumeInvite(invite, { playerId: playerId, nickname: playerId });
          } else {
            result = store.join(rs.id, {
              playerId: playerId,
              password: input.password,
              nickname: playerId
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
          const view = viewFor(rs, playerId);
          return sendJson(res, 200, Object.assign({}, view, {
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
          rs.match = {
            id: 'cm_' + randomHex(6),
            game: 'codenames',
            state: E.createGame({ mode: 'auto', seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 })
          };
          rs.started = true;
          rs.startedAt = Date.now();
          rs.resultRecorded = false;
          rs.takeover = {};
          rs.lastSeen = new Map();
          rs.seats.forEach(function (s) { if (s.playerId) rs.lastSeen.set(s.playerId, Date.now()); });
          rs.nextAiAt = Date.now() + aiDelayMs;
          rs.events = [];
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
          if (!rs.match || rs.match.state.phase !== 'over') {
            return sendError(res, fail('match is not over', 'E_STATE', 409));
          }
          rs.match = {
            id: 'cm_' + randomHex(6),
            game: 'codenames',
            state: E.createGame({ mode: 'auto', seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 })
          };
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

      if (actionName === 'actions' && req.method === 'POST') {
        return readJson(req).then(function (body) {
          const who = actor(req, body, rs, url.searchParams);
          if (!who.ok) return sendError(res, who);
          if (!rs.started || !rs.match) return sendError(res, fail('match has not started', 'E_STATE', 409));
          touch(rs, who.playerId);
          const state = rs.match.state;
          if (state.phase === 'over') return sendError(res, fail('match is over', 'E_STATE', 409));
          const seat = currentSeat(rs);
          if (!seat) return sendError(res, fail('no active seat', 'E_STATE', 409));
          if (seat.playerId !== who.playerId || seat.ai) {
            return sendError(res, fail('not this player\'s turn', 'E_TURN', 409));
          }
          const type = String(body.type || body.action || '').trim().toLowerCase();
          let action = null;
          if (type === 'clue') {
            if (seat.role !== 'captain') return sendError(res, fail('only the captain gives clues', 'E_ROLE', 409));
            action = { type: 'clue', text: body.text, count: body.count == null ? body.number : body.count };
          } else if (type === 'guess') {
            if (seat.role !== 'operative') return sendError(res, fail('only the operative guesses', 'E_ROLE', 409));
            action = { type: 'guess', index: body.index };
          } else if (type === 'pass') {
            if (seat.role !== 'operative') return sendError(res, fail('only the operative can pass', 'E_ROLE', 409));
            action = { type: 'pass' };
          } else {
            return sendError(res, fail('unknown action', 'E_ACTION', 422));
          }
          const result = E.applyAction(state, action);
          if (!result.ok) return sendError(res, fail(result.error || 'action rejected', 'E_ACTION', 422));
          rs.events = result.events || [];
          rs.nextAiAt = Date.now() + aiDelayMs;
          tick(rs, false);
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
          return sendJson(res, 200, { ok: true, roomId: rs.id, inviteCode: rs.room.code, inviteToken: invite.token, expiresAt: invite.expiresAt });
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
            seat.nickname = roleLabel(seat) + ' AI（托管）';
            rs.takeover[seat.id] = true;
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
  return { app: app, server: app.server, address: address, close: app.close };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port }).then(function (handle) {
    const addr = handle.address;
    console.log('[codenames-online] http://' + addr.address + ':' + addr.port + '/  (online)');
    console.log('[codenames-online] http://' + addr.address + ':' + addr.port + '/index.html  (single-player)');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
