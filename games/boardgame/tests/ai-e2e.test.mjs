'use strict';

/*
 * L3/L4 contract: end-to-end AI API.
 *
 * Starts app/server.mjs on a free loopback port, then exercises:
 *   - /health
 *   - room create / password join / state / action / close
 *   - existing matches API regression
 *   - server/ai-eval.mjs CLI (HTTP-only bot) stdout JSON + --out file
 *
 * This test never imports the game engine; everything goes through HTTP.
 */

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';
import { fetchJson, urlFor } from './lib/http.mjs';

const s = createSuite('boardgame-ai-e2e', { log: function (line) { console.log(line); } });
const SERVER = path.join(ROOT, 'app', 'server.mjs');
const AI_EVAL = path.join(ROOT, 'server', 'ai-eval.mjs');

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

function errorCode(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.error && typeof body.error === 'object') return body.error.code;
  return body.code;
}

async function call(base, method, route, body) {
  return fetchJson(urlFor(base, route), { method: method, body: body, timeoutMs: 5000 });
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-ai-e2e-'));
const outFile = path.join(tmpDir, 'result.json');

try {
  await s.run(async () => {
    const health = await waitHealthy(base);
    s.ok('server starts and /health returns ok', health.ok, JSON.stringify(health.last));
    if (!health.ok) return;
    const healthBody = health.res.body || {};
    s.ok('health advertises rooms capability',
      Array.isArray(healthBody.capabilities) && healthBody.capabilities.indexOf('rooms') !== -1,
      JSON.stringify(healthBody.capabilities));

    let roomId = null;
    let p1Session = null;
    let p2Session = null;

    await s.group('rooms', async () => {
      const created = await call(base, 'POST', '/api/rooms', {
        gameType: 'card-battle', playerId: 'p1', seed: 42, password: 'secret-1'
      });
      s.ok('create room 201', created.status === 201, 'status ' + created.status);
      const room = created.body || {};
      roomId = room.roomId;
      p1Session = room.playerSession;
      s.ok('create returns roomId', typeof roomId === 'string' && roomId.length > 0, String(roomId));
      s.ok('create returns inviteCode', typeof room.inviteCode === 'string' && room.inviteCode.length > 0,
        String(room.inviteCode));
      s.ok('create returns playerSession', typeof p1Session === 'string' && p1Session.length > 0,
        String(p1Session));
      s.ok('create returns legalActions array', Array.isArray(room.legalActions),
        JSON.stringify(room.legalActions));
      s.ok('response has no plaintext password', created.text.indexOf('secret-1') === -1);

      const wrong = await call(base, 'POST', '/api/rooms/' + roomId + '/join',
        { playerId: 'p2', password: 'wrong' });
      s.ok('wrong password rejected with 403', wrong.status === 403, 'status ' + wrong.status);
      s.ok('wrong password has E_PASSWORD', errorCode(wrong.body) === 'E_PASSWORD',
        JSON.stringify(wrong.body));

      const joined = await call(base, 'POST', '/api/rooms/' + roomId + '/join',
        { playerId: 'p2', password: 'secret-1' });
      s.ok('correct password joins with 200', joined.status === 200, 'status ' + joined.status);
      p2Session = joined.body && joined.body.playerSession;
      s.ok('join returns a second playerSession', typeof p2Session === 'string' && p2Session.length > 0,
        String(p2Session));

      const roomsState = await call(base, 'GET',
        '/api/rooms/' + roomId + '?playerId=p1&session=' + encodeURIComponent(p1Session));
      s.ok('state read returns 200', roomsState.status === 200, 'status ' + roomsState.status);
      const state = roomsState.body || {};
      s.ok('state has 2 players', Array.isArray(state.players) && state.players.length === 2,
        JSON.stringify(state.players && state.players.length));
      s.ok('state has turn/phase/zones',
        typeof state.turn === 'number' && typeof state.phase === 'string' &&
        state.zones !== null && typeof state.zones === 'object',
        JSON.stringify({ turn: state.turn, phase: state.phase, zones: state.zones && Object.keys(state.zones) }));
      s.ok('state exposes legalActions', Array.isArray(state.legalActions),
        JSON.stringify(state.legalActions));
      s.ok('state exposes currentPlayerId', typeof state.currentPlayerId === 'string',
        String(state.currentPlayerId));

      const currentId = state.currentPlayerId;
      const session = currentId === 'p1' ? p1Session : p2Session;
      const action = (state.legalActions || []).find(function (item) {
        return /attack|play/i.test(String(item.type));
      }) || (state.legalActions || [])[0] || { type: 'endTurn' };
      const acted = await call(base, 'POST', '/api/rooms/' + roomId + '/actions',
        Object.assign({}, action, { playerId: currentId, session: session }));
      s.ok('room action returns 200', acted.status === 200, 'status ' + acted.status + ' ' + acted.text.slice(0, 200));
      s.ok('room action response has turn and legalActions',
        Boolean(acted.body) && typeof acted.body.turn === 'number' && Array.isArray(acted.body.legalActions),
        JSON.stringify(acted.body && { turn: acted.body.turn, legal: acted.body.legalActions && acted.body.legalActions.length }));

      const invalid = await call(base, 'POST', '/api/rooms/' + roomId + '/actions',
        { type: 'not-a-real-action', playerId: currentId, session: session });
      s.ok('invalid room action is 4xx', invalid.status >= 400 && invalid.status < 500,
        'status ' + invalid.status);
      s.ok('invalid room action has error.code', Boolean(errorCode(invalid.body)),
        JSON.stringify(invalid.body));
    });

    await s.group('matches regression', async () => {
      const match = await call(base, 'POST', '/api/matches', { game: 'pokemon', seed: 20261110, ai: true });
      s.ok('POST /api/matches returns 201', match.status === 201, 'status ' + match.status);
      const matchId = match.body && match.body.matchId;
      s.ok('matchId is present', typeof matchId === 'string' && matchId.length > 0, String(matchId));
      const state = await call(base, 'GET', '/api/matches/' + matchId);
      s.ok('GET match state 200', state.status === 200, 'status ' + state.status);
      const actions = await call(base, 'GET', '/api/matches/' + matchId + '/actions');
      s.ok('GET match actions returns array', actions.status === 200 && Array.isArray(actions.body.actions),
        'status ' + actions.status);
      const acted = await call(base, 'POST', '/api/matches/' + matchId + '/actions', { type: 'end-turn' });
      s.ok('POST match action 200', acted.status === 200, 'status ' + acted.status);
      const evaluation = await call(base, 'POST', '/api/ai/evaluate', {
        game: 'pokemon', state: { turn: 1, handSize: 7, prizesRemaining: 6 }, actions: ['attack', 'end-turn']
      });
      s.ok('POST /api/ai/evaluate 200', evaluation.status === 200, 'status ' + evaluation.status);
      s.ok('evaluation object present', Boolean(evaluation.body && evaluation.body.evaluation),
        JSON.stringify(evaluation.body));
    });

    await s.group('ai-eval CLI', async () => {
      if (!roomId) {
        s.skip('ai-eval CLI', 'rooms group did not create a room');
        return;
      }
      const cli = spawnSync(process.execPath, [
        AI_EVAL,
        '--base-url', base,
        '--game', 'card-battle',
        '--seed', '42',
        '--max-turns', '200',
        '--out', outFile
      ], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60000,
        env: Object.assign({}, process.env, { BOARDGAME_API_TOKEN: '' })
      });
      s.ok('ai-eval exits 0', cli.status === 0,
        'status ' + cli.status + ' stderr=' + (cli.stderr || '').slice(0, 300));
      let report = null;
      try {
        report = JSON.parse(cli.stdout || '');
      } catch (err) {
        report = null;
      }
      s.ok('ai-eval stdout is pure JSON', report !== null, String(cli.stdout || '').slice(0, 200));
      if (!report) return;
      s.eq('ai-eval schemaVersion', report.schemaVersion, 1);
      s.eq('ai-eval game', report.game, 'card-battle');
      s.eq('ai-eval seed', report.seed, 42);
      s.ok('ai-eval has startedAt/finishedAt',
        typeof report.startedAt === 'string' && typeof report.finishedAt === 'string',
        JSON.stringify([report.startedAt, report.finishedAt]));
      s.ok('ai-eval produced moves', Array.isArray(report.moves) && report.moves.length > 0,
        JSON.stringify(report.moves && report.moves.length));
      s.ok('ai-eval move items carry action + result',
        report.moves.every(function (move) {
          return move && typeof move === 'object' && move.action && move.result &&
            typeof move.playerId === 'string';
        }),
        JSON.stringify(report.moves[0]));
      s.ok('ai-eval result has winner/score/reason',
        report.result && typeof report.result === 'object' &&
        'winner' in report.result && 'score' in report.result && 'reason' in report.result,
        JSON.stringify(report.result));
      s.ok('ai-eval errors is an array', Array.isArray(report.errors), JSON.stringify(report.errors));
      s.ok('ai-eval --out file matches stdout', fs.existsSync(outFile) &&
        JSON.stringify(JSON.parse(fs.readFileSync(outFile, 'utf8'))) === JSON.stringify(report));
    });
  });
} finally {
  try { service.kill('SIGTERM'); } catch (err) { /* ignore */ }
  await sleep(150);
  try { service.kill('SIGKILL'); } catch (err) { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  if (serverStderr) {
    process.stderr.write('[ai-e2e] server stderr (tail):\n' + serverStderr.slice(-2000) + '\n');
  }
}
