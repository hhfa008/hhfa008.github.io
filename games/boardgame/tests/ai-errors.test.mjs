'use strict';

/*
 * L3/L4 contract: HTTP error paths for rooms and actions.
 *
 * Black-box only: every case goes through app/server.mjs over loopback HTTP.
 * The engine is never imported, so what is asserted here is the wire contract
 * (status code + error.code + "state did not change"), not engine internals.
 *
 * Covered:
 *   - missing room: GET room / POST join / GET actions / POST actions -> 404
 *   - wrong room password -> 403 E_PASSWORD and unchanged room state
 *   - non-member action / bogus session / private room anonymous read -> 403
 *   - illegal moves: unknown action type, illegal cardId, non-current player,
 *     out-of-range attach target -> 4xx with an explicit code, state unchanged
 *   - room edges: duplicate join is idempotent, third join after the room is
 *     full/started is rejected, non-host start/close -> 403
 *   - voice token: non-member 403 E_VOICE, member gets the interface-only stub
 *
 * Starts app/server.mjs on a free loopback port and kills it afterwards.
 * Prints exactly one machine-readable line:
 *   RESULT: N passed, M failed, K skipped
 */

import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';
import { fetchJson, urlFor } from './lib/http.mjs';

const s = createSuite('boardgame-ai-errors', { log: function (line) { console.log(line); } });
const SERVER = path.join(ROOT, 'app', 'server.mjs');
const MISSING_ROOM = 'room_does_not_exist_' + Date.now().toString(36);

function freePort() {
  return new Promise(function (resolve, reject) {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      const port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function errorCode(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.error && typeof body.error === 'object') return body.error.code;
  return body.code;
}

async function call(base, method, route, body) {
  return fetchJson(urlFor(base, route), { method: method, body: body, timeoutMs: 5000 });
}

async function waitHealthy(base) {
  const deadline = Date.now() + 10000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetchJson(urlFor(base, '/health'), { timeoutMs: 1000 });
      last = res;
      if (res.status === 200 && res.body && res.body.ok === true) return { ok: true, res: res };
    } catch (err) {
      last = { error: err && err.message ? err.message : String(err) };
    }
    await sleep(100);
  }
  return { ok: false, last: last };
}

/*
 * Stable projection of everything an action could mutate. legalActions and
 * timestamps are intentionally excluded: they are derived, not game state.
 */
function compact(state) {
  const value = state || {};
  return {
    turn: value.turn,
    phase: value.phase,
    status: value.status,
    roomStatus: value.roomStatus,
    currentPlayerId: value.currentPlayerId,
    players: Array.isArray(value.players)
      ? value.players.map(function (player) { return { id: player.id, seat: player.seat }; })
      : null,
    zones: value.zones && Array.isArray(value.zones.players)
      ? value.zones.players.map(function (zone) {
        return {
          hand: zone.hand,
          deck: zone.deck,
          discard: zone.discard,
          prizes: zone.prizes,
          active: zone.active ? zone.active.cardId : null
        };
      })
      : null
  };
}

function snapshotOf(state) {
  return JSON.stringify(compact(state));
}

const port = await freePort();
const base = 'http://127.0.0.1:' + port;
const service = spawn(process.execPath, [SERVER, '--port', String(port)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { BOARDGAME_API_TOKEN: '' })
});
let serverStderr = '';
service.stderr.on('data', function (chunk) { serverStderr += chunk.toString(); });
service.stdout.on('data', function () {});

/* Create a card-battle room. Seed 42 => P1 (seat 0) acts first. */
async function createRoom(playerId, extra) {
  const body = Object.assign({ gameType: 'card-battle', playerId: playerId, seed: 42 }, extra || {});
  return call(base, 'POST', '/api/rooms', body);
}

async function readState(roomId, playerId, session) {
  let route = '/api/rooms/' + encodeURIComponent(roomId);
  if (playerId) route += '?playerId=' + encodeURIComponent(playerId);
  if (session) route += '&session=' + encodeURIComponent(session);
  return call(base, 'GET', route);
}

/* A fresh 2-player room that has auto-started. */
async function startedRoom() {
  const created = await createRoom('p1');
  const roomId = created.body && created.body.roomId;
  const p1Session = created.body && created.body.playerSession;
  const joined = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join',
    { playerId: 'p2' });
  const p2Session = joined.body && joined.body.playerSession;
  const state = await readState(roomId, 'p1', p1Session);
  return {
    roomId: roomId,
    p1Session: p1Session,
    p2Session: p2Session,
    state: state.body || {}
  };
}

try {
  await s.run(async () => {
    const health = await waitHealthy(base);
    s.ok('server starts and /health returns ok', health.ok, JSON.stringify(health.last));
    if (!health.ok) return;

    await s.group('missing room', async () => {
      const routes = [
        { method: 'GET', route: '/api/rooms/' + MISSING_ROOM },
        { method: 'POST', route: '/api/rooms/' + MISSING_ROOM + '/join', body: { playerId: 'p2' } },
        { method: 'GET', route: '/api/rooms/' + MISSING_ROOM + '/actions' },
        { method: 'POST', route: '/api/rooms/' + MISSING_ROOM + '/actions',
          body: { type: 'endTurn', playerId: 'p2' } }
      ];
      for (const item of routes) {
        const res = await call(base, item.method, item.route, item.body);
        s.eq(item.method + ' ' + item.route + ' -> 404', res.status, 404);
        s.eq(item.method + ' ' + item.route + ' -> E_NOT_FOUND', errorCode(res.body), 'E_NOT_FOUND');
      }
    });

    await s.group('wrong password', async () => {
      const created = await createRoom('p1', { password: 'secret-1' });
      s.eq('password room created', created.status, 201);
      const roomId = created.body.roomId;
      const p1Session = created.body.playerSession;

      const before = await readState(roomId, 'p1', p1Session);
      s.eq('baseline state readable', before.status, 200);
      const beforeSnapshot = snapshotOf(before.body);

      const wrong = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join',
        { playerId: 'p2', password: 'wrong-password' });
      s.eq('wrong password -> 403', wrong.status, 403);
      s.eq('wrong password -> E_PASSWORD', errorCode(wrong.body), 'E_PASSWORD');
      s.ok('wrong password body has message',
        Boolean(wrong.body && wrong.body.error && typeof wrong.body.error.message === 'string'),
        JSON.stringify(wrong.body));

      const after = await readState(roomId, 'p1', p1Session);
      s.eq('state still readable after rejection', after.status, 200);
      s.ok('wrong password leaves game state unchanged', snapshotOf(after.body) === beforeSnapshot,
        'before=' + beforeSnapshot.slice(0, 300) + ' after=' + snapshotOf(after.body).slice(0, 300));
      s.eq('rejected player did not join', after.body.players.length, 1);
      s.eq('room is still waiting', after.body.roomStatus, 'waiting');
    });

    await s.group('non-member access', async () => {
      const created = await createRoom('p1');
      const roomId = created.body.roomId;
      const p1Session = created.body.playerSession;
      const before = await readState(roomId, 'p1', p1Session);
      const beforeSnapshot = snapshotOf(before.body);
      const roomPath = '/api/rooms/' + encodeURIComponent(roomId);

      const intruderAction = await call(base, 'POST', roomPath + '/actions',
        { type: 'endTurn', playerId: 'intruder' });
      s.eq('non-member action -> 403', intruderAction.status, 403);
      s.eq('non-member action -> E_PLAYER', errorCode(intruderAction.body), 'E_PLAYER');

      const badSession = await call(base, 'POST', roomPath + '/actions',
        { type: 'endTurn', playerId: 'p1', session: 'not-a-real-session' });
      s.eq('bogus session -> 403', badSession.status, 403);
      s.eq('bogus session -> E_SESSION', errorCode(badSession.body), 'E_SESSION');

      const wrongVoice = await call(base, 'POST', roomPath + '/voice/token', { userId: 'intruder' });
      s.eq('non-member voice token -> 403', wrongVoice.status, 403);
      s.eq('non-member voice token -> E_VOICE', errorCode(wrongVoice.body), 'E_VOICE');

      const after = await readState(roomId, 'p1', p1Session);
      s.ok('rejected non-member calls leave state unchanged', snapshotOf(after.body) === beforeSnapshot,
        'before=' + beforeSnapshot.slice(0, 300) + ' after=' + snapshotOf(after.body).slice(0, 300));

      const privateRoom = await createRoom('pv1', { visibility: 'private' });
      const privateRead = await call(base, 'GET',
        '/api/rooms/' + encodeURIComponent(privateRoom.body.roomId));
      s.eq('anonymous private room read -> 403', privateRead.status, 403);
      s.eq('anonymous private room read -> E_PRIVATE', errorCode(privateRead.body), 'E_PRIVATE');

      const memberVoice = await call(base, 'POST',
        '/api/rooms/' + encodeURIComponent(roomId) + '/voice/token', { userId: 'p1' });
      s.eq('member voice token -> 200', memberVoice.status, 200);
      s.ok('voice is interface-only (token/voice null)',
        memberVoice.body && memberVoice.body.token === null && memberVoice.body.voice === null,
        JSON.stringify(memberVoice.body));
    });

    await s.group('illegal moves', async () => {
      // unknown action type
      let room = await startedRoom();
      let before = await readState(room.roomId, 'p1', room.p1Session);
      let res = await call(base, 'POST',
        '/api/rooms/' + encodeURIComponent(room.roomId) + '/actions',
        { type: 'definitely-not-legal', playerId: 'p1', session: room.p1Session });
      s.eq('unknown action type -> 422', res.status, 422);
      s.eq('unknown action type -> E_INVALID_ACTION', errorCode(res.body), 'E_INVALID_ACTION');
      let after = await readState(room.roomId, 'p1', room.p1Session);
      s.ok('unknown action type leaves state unchanged', snapshotOf(after.body) === snapshotOf(before.body));

      // illegal cardId (card is not in hand; P1 has no active creature yet)
      room = await startedRoom();
      before = await readState(room.roomId, 'p1', room.p1Session);
      res = await call(base, 'POST',
        '/api/rooms/' + encodeURIComponent(room.roomId) + '/actions',
        { type: 'play', cardId: 'card-does-not-exist', playerId: 'p1', session: room.p1Session });
      s.eq('illegal cardId -> 409', res.status, 409);
      s.eq('illegal cardId -> E_CARD', errorCode(res.body), 'E_CARD');
      after = await readState(room.roomId, 'p1', room.p1Session);
      s.ok('illegal cardId leaves state unchanged', snapshotOf(after.body) === snapshotOf(before.body));

      // non-current player (P1 acts first with seed 42)
      room = await startedRoom();
      before = await readState(room.roomId, 'p1', room.p1Session);
      s.eq('current player is p1', before.body.currentPlayerId, 'p1');
      res = await call(base, 'POST',
        '/api/rooms/' + encodeURIComponent(room.roomId) + '/actions',
        { type: 'endTurn', playerId: 'p2', session: room.p2Session });
      s.eq('non-current player -> 409', res.status, 409);
      s.eq('non-current player -> E_TURN', errorCode(res.body), 'E_TURN');
      after = await readState(room.roomId, 'p1', room.p1Session);
      s.ok('non-current player leaves state unchanged', snapshotOf(after.body) === snapshotOf(before.body));

      // out-of-range attach target: play a creature first, then attach energy
      room = await startedRoom();
      before = await readState(room.roomId, 'p1', room.p1Session);
      const play = (before.body.legalActions || []).find(function (action) {
        return action.type === 'play';
      });
      s.ok('seed 42 exposes a legal play action', Boolean(play), JSON.stringify(before.body.legalActions));
      const played = await call(base, 'POST',
        '/api/rooms/' + encodeURIComponent(room.roomId) + '/actions',
        Object.assign({}, play, { playerId: 'p1', session: room.p1Session }));
      s.eq('legal play succeeds', played.status, 200);
      const withActive = await readState(room.roomId, 'p1', room.p1Session);
      const activeId = withActive.body.zones.players[0].active &&
        withActive.body.zones.players[0].active.cardId;
      s.ok('creature is now active', typeof activeId === 'string' && activeId.length > 0, String(activeId));
      const hand = (withActive.body.zones.players[0].hand || []);
      s.ok('seed 42 P1 still holds the energy card', hand.indexOf('en-001') !== -1, JSON.stringify(hand));
      const beforeAttach = snapshotOf(withActive.body);

      res = await call(base, 'POST',
        '/api/rooms/' + encodeURIComponent(room.roomId) + '/actions',
        { type: 'attach', cardId: 'en-001', target: 'c10', playerId: 'p1', session: room.p1Session });
      s.eq('out-of-range attach target -> 409', res.status, 409);
      s.eq('out-of-range attach target -> E_TARGET', errorCode(res.body), 'E_TARGET');
      after = await readState(room.roomId, 'p1', room.p1Session);
      s.ok('out-of-range attach target leaves state unchanged', snapshotOf(after.body) === beforeAttach,
        'before=' + beforeAttach.slice(0, 260) + ' after=' + snapshotOf(after.body).slice(0, 260));
    });

    await s.group('room membership edges', async () => {
      const created = await createRoom('p1');
      s.eq('room created', created.status, 201);
      const roomId = created.body.roomId;
      const p1Session = created.body.playerSession;
      const roomPath = '/api/rooms/' + encodeURIComponent(roomId);

      const dup = await call(base, 'POST', roomPath + '/join', { playerId: 'p1' });
      s.eq('duplicate join by host -> 200', dup.status, 200);
      let state = await readState(roomId, 'p1', p1Session);
      s.eq('duplicate join does not add a seat', state.body.players.length, 1);

      const tooEarly = await call(base, 'POST', roomPath + '/start',
        { playerId: 'p1', session: p1Session });
      s.eq('host start with one player -> 409', tooEarly.status, 409);
      s.eq('host start with one player -> E_PLAYERS', errorCode(tooEarly.body), 'E_PLAYERS');

      const p2 = await call(base, 'POST', roomPath + '/join', { playerId: 'p2' });
      s.eq('second player joins -> 200', p2.status, 200);
      const p2Session = p2.body.playerSession;
      state = await readState(roomId, 'p1', p1Session);
      s.eq('room auto-starts when full', state.body.status, 'playing');
      s.eq('two seats are occupied', state.body.players.length, 2);

      const p3 = await call(base, 'POST', roomPath + '/join', { playerId: 'p3' });
      s.eq('third player on a full/started room -> 423', p3.status, 423);
      s.eq('third player on a full/started room -> E_LOCKED', errorCode(p3.body), 'E_LOCKED');
      state = await readState(roomId, 'p1', p1Session);
      s.eq('rejected third player did not join', state.body.players.length, 2);
      s.ok('rejected third player is absent from seats',
        state.body.players.every(function (player) { return player.id !== 'p3'; }),
        JSON.stringify(state.body.players.map(function (player) { return player.id; })));

      const nonHostStart = await call(base, 'POST', roomPath + '/start',
        { playerId: 'p2', session: p2Session });
      s.eq('non-host start -> 403', nonHostStart.status, 403);
      s.eq('non-host start -> E_HOST', errorCode(nonHostStart.body), 'E_HOST');

      const beforeClose = snapshotOf((await readState(roomId, 'p1', p1Session)).body);
      const nonHostClose = await call(base, 'DELETE',
        roomPath + '?playerId=p2&session=' + encodeURIComponent(p2Session));
      s.eq('non-host close -> 403', nonHostClose.status, 403);
      s.eq('non-host close -> E_HOST', errorCode(nonHostClose.body), 'E_HOST');
      const afterClose = snapshotOf((await readState(roomId, 'p1', p1Session)).body);
      s.ok('non-host close leaves state unchanged', afterClose === beforeClose);

      const hostClose = await call(base, 'DELETE',
        roomPath + '?playerId=p1&session=' + encodeURIComponent(p1Session));
      s.eq('host close -> 200', hostClose.status, 200);
      const gone = await call(base, 'GET', roomPath);
      s.eq('closed room is gone -> 404', gone.status, 404);
      s.eq('closed room is gone -> E_NOT_FOUND', errorCode(gone.body), 'E_NOT_FOUND');
    });
  });
} finally {
  try { service.kill('SIGTERM'); } catch (err) { /* ignore */ }
  await sleep(150);
  try { service.kill('SIGKILL'); } catch (err) { /* ignore */ }
  if (serverStderr) {
    process.stderr.write('[ai-errors] server stderr (tail):\n' + serverStderr.slice(-2000) + '\n');
  }
}
