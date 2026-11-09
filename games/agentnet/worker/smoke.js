/* End-to-end smoke test for the agentnet relay.
 *
 *   node smoke.js
 *
 * Starts `wrangler dev` locally (two instances are used in sequence: the main
 * one for gameplay, and a tiny one with MAX_ROOMS=3 to prove the global cap),
 * then drives two real WebSocket clients through a full gomoku game, an
 * illegal-move exchange and a timeout loss. Assertions:
 *   - both seats see byte-identical state frames after every move
 *   - illegal actions are rejected and leave the state untouched
 *   - GET /api/match/:id/log replays and its hashChain equals the live hashes
 *   - the per-IP creation limit and the global room cap both fire
 *
 * The test never inspects the game visually; it only uses protocol frames.
 */
'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const core = require('./src/rules/core.js');

const WRANGLER = process.env.WRANGLER || 'npx';
const MOVE_TIMEOUT_MS = 3000;
const JOIN_TIMEOUT_MS = 4000;
const START_TIMEOUT_MS = 90000;

const children = [];
const tempDirs = [];
const createCounts = new Map();

function note(text) {
  console.log('[smoke] ' + text);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentnet-smoke-'));
  tempDirs.push(dir);
  return dir;
}

function startWrangler(port, persistDir, extraVars) {
  const args = [
    '--yes', 'wrangler', 'dev',
    '--port', String(port),
    '--ip', '127.0.0.1',
    '--persist-to', persistDir,
    '--var', 'MOVE_TIMEOUT_MS:' + MOVE_TIMEOUT_MS,
    '--var', 'JOIN_TIMEOUT_MS:' + JOIN_TIMEOUT_MS,
    '--var', 'ROOM_RECLAIM_MS:3000',
  ];
  for (const pair of extraVars || []) args.push('--var', pair);

  const child = spawn(WRANGLER, args, {
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      CI: '1',
      WRANGLER_SEND_METRICS: 'false',
    }),
  });
  child.log = '';
  const append = (chunk) => {
    child.log += chunk.toString();
    if (child.log.length > 200000) child.log = child.log.slice(-100000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  children.push(child);
  return child;
}

function stopWrangler(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const done = () => resolve();
    child.once('exit', done);
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (e) {
      try { child.kill('SIGTERM'); } catch (e2) {}
    }
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
      resolve();
    }, 3000).unref();
  });
}

async function waitHealthy(base, child) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('wrangler exited early (' + child.exitCode + ')\n' + tail(child.log));
    }
    try {
      const res = await fetch(base + '/health', { signal: AbortSignal.timeout(2000) });
      const body = await res.json();
      if (res.ok && body && body.ok === true) return body;
      lastError = new Error('health returned ' + res.status + ' ' + JSON.stringify(body));
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('wrangler did not become healthy: ' + (lastError && lastError.message) + '\n' + tail(child.log));
}

function tail(text) {
  const lines = String(text || '').trim().split('\n');
  return lines.slice(-60).join('\n');
}

async function getJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    body = { raw: text };
  }
  return { status: res.status, body: body };
}

class Client {
  constructor(ws, name) {
    this.ws = ws;
    this.name = name;
    this.frames = [];
    this.cursor = 0;
    this.waiters = [];
    this.closed = false;
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch (e) {
        return;
      }
      this.frames.push(msg);
      for (const waiter of this.waiters.slice()) {
        if (waiter.pred(msg)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(msg);
        }
      }
    });
    ws.addEventListener('close', () => { this.closed = true; });
  }

  static connect(url, name) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error(name + ': websocket open timeout')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Client(ws, name));
      }, { once: true });
      ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(name + ': websocket error ' + (event && event.message ? event.message : '')));
      }, { once: true });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  // Resolves with the next unconsumed frame matching pred.
  waitFor(pred, label, timeout = 12000) {
    for (let i = this.cursor; i < this.frames.length; i++) {
      if (pred(this.frames[i])) {
        this.cursor = i + 1;
        return Promise.resolve(this.frames[i]);
      }
    }
    return new Promise((resolve, reject) => {
      const waiter = { pred: pred, resolve: resolve };
      waiter.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(
          this.name + ': timeout waiting for ' + label + '; saw [' +
          this.frames.map((f) => f.t + (f.n !== undefined ? ':' + f.n : '')).join(', ') + ']',
        ));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  stateFrames() {
    return this.frames.filter((f) => f.t === 'state');
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function createMatch(base, game) {
  const res = await getJson(base + '/api/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game: game }),
  });
  assert.strictEqual(res.status, 200, 'create match: ' + JSON.stringify(res.body));
  assert.ok(/^[0-9a-f-]{36}$/.test(res.body.matchId), 'matchId looks wrong');
  assert.ok(res.body.joinUrl.startsWith('ws://'), 'joinUrl must be a ws URL');
  createCounts.set(base, (createCounts.get(base) || 0) + 1);
  return res.body;
}

async function fetchLog(base, matchId) {
  const res = await getJson(base + '/api/match/' + matchId + '/log');
  assert.strictEqual(res.status, 200, 'log: ' + JSON.stringify(res.body));
  return res.body;
}

function display(msg) {
  return JSON.stringify(msg, null, 0);
}

function printFrame(tag, msg, abbreviateLegal) {
  const shown = JSON.parse(JSON.stringify(msg));
  if (abbreviateLegal && Array.isArray(shown.legal) && shown.legal.length > 8) {
    shown.legal = shown.legal.slice(0, 8).concat(['... +' + (msg.legal.length - 8) + ' more']);
  }
  console.log('--- ' + tag + ' ---');
  console.log(display(shown));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function playMainGame(base) {
  note('game: creating gomoku match');
  const match = await createMatch(base, 'gomoku');
  const p1 = await Client.connect(match.joinUrl, 'p1');
  const p2 = await Client.connect(match.joinUrl, 'p2');

  p1.send({ t: 'hello', v: 1, agent: { id: 'smoke-p1', name: 'Smoke P1' }, game: 'gomoku' });
  const room1 = await p1.waitFor((m) => m.t === 'room', 'room for p1');
  assert.strictEqual(room1.seat, 'p1');
  assert.strictEqual(room1.matchId, match.matchId);

  p2.send({ t: 'hello', v: 1, agent: { id: 'smoke-p2', name: 'Smoke P2' }, game: 'gomoku', seat: 'p2' });
  const room2 = await p2.waitFor((m) => m.t === 'room', 'room for p2');
  assert.strictEqual(room2.seat, 'p2');

  const start1 = await p1.waitFor((m) => m.t === 'state' && m.n === 0, 'game start on p1');
  const start2 = await p2.waitFor((m) => m.t === 'state' && m.n === 0, 'game start on p2');
  assert.deepStrictEqual(start1.state, start2.state, 'initial states differ between seats');
  assert.strictEqual(start1.hash, start2.hash, 'initial hashes differ');
  assert.strictEqual(start1.turn, 'p1');
  assert.strictEqual(start1.legal.length, 225);

  // --- illegal actions must be rejected and must not alter state
  const statesBefore = p1.stateFrames().length;
  p2.send({ t: 'move', id: '0,0' }); // p2 moves out of turn
  const wrongTurn = await p2.waitFor((m) => m.t === 'error', 'not_your_turn');
  assert.strictEqual(wrongTurn.code, 'not_your_turn');

  p1.send({ t: 'move', id: '99,99' }); // out of bounds
  const illegal = await p1.waitFor((m) => m.t === 'error', 'illegal_action');
  assert.strictEqual(illegal.code, 'illegal_action');

  const blockedOccupied = core.applyMove(start1.state, '0,0'); // sanity: legal elsewhere
  assert.strictEqual(blockedOccupied.ok, true);

  await sleep(250);
  assert.strictEqual(p1.stateFrames().length, statesBefore, 'illegal moves broadcast a state change');
  assert.strictEqual(p2.stateFrames().length, 1, 'illegal moves broadcast a state change');

  // --- deterministic win for p1: row 7 vs row 0
  const script = [
    ['p1', '7,0'], ['p2', '0,0'],
    ['p1', '7,1'], ['p2', '0,1'],
    ['p1', '7,2'], ['p2', '0,2'],
    ['p1', '7,3'], ['p2', '0,3'],
    ['p1', '7,4'],
  ];
  const hashes = [start1.hash];
  const states1 = [start1.state];
  const states2 = [start2.state];
  let lastState = start1.state;

  for (let i = 0; i < script.length; i++) {
    const seat = script[i][0];
    const id = script[i][1];
    const client = seat === 'p1' ? p1 : p2;
    client.send({ t: 'move', id: id });
    const expectedN = i + 1;
    const s1 = await p1.waitFor((m) => m.t === 'state' && m.n === expectedN, 'state n=' + expectedN + ' p1');
    const s2 = await p2.waitFor((m) => m.t === 'state' && m.n === expectedN, 'state n=' + expectedN + ' p2');
    assert.deepStrictEqual(s1.state, s2.state, 'state divergence at n=' + expectedN);
    assert.strictEqual(s1.hash, s2.hash, 'hash divergence at n=' + expectedN);
    assert.strictEqual(s1.state.plies, expectedN);
    assert.strictEqual(s1.turn, seat === 'p1' ? 'p2' : 'p1');
    hashes.push(s1.hash);
    states1.push(s1.state);
    states2.push(s2.state);
    lastState = s1.state;
  }
  assert.strictEqual(lastState.over, true);
  assert.strictEqual(lastState.winner, 'p1');
  assert.deepStrictEqual(states1[states1.length - 1], states2[states2.length - 1]);

  const result1 = await p1.waitFor((m) => m.t === 'result', 'result on p1');
  const result2 = await p2.waitFor((m) => m.t === 'result', 'result on p2');
  assert.deepStrictEqual(result1, result2, 'result frames differ between seats');
  assert.strictEqual(result1.winner, 'p1');
  assert.strictEqual(result1.draw, false);
  assert.strictEqual(result1.byTimeout, false);
  assert.strictEqual(result1.moves.length, script.length);
  assert.deepStrictEqual(result1.hashChain, hashes.slice(1));
  assert.ok(/^[0-9a-f]{64}$/.test(result1.logHash), 'logHash is not 32 bytes of hex');

  note('game: fetching and independently replaying the log');
  const log = await fetchLog(base, match.matchId);
  assert.strictEqual(log.game, 'gomoku');
  assert.strictEqual(typeof log.seed, 'string');
  assert.strictEqual(log.over, true);
  assert.strictEqual(log.result.winner, 'p1');
  assert.deepStrictEqual(log.moves.map((m) => m.id), script.map((x) => x[1]));
  assert.deepStrictEqual(log.hashChain, hashes.slice(1), 'live hashes != log hashChain');
  assert.strictEqual(log.finalHash, hashes[hashes.length - 1]);
  assert.strictEqual(log.logHash, result1.logHash);

  const verdict = await core.verifyLog(log);
  assert.deepStrictEqual(verdict.errors, [], 'replay verification failed');
  assert.strictEqual(verdict.ok, true);
  assert.deepStrictEqual(verdict.finalState, lastState, 'replayed final state != live final state');

  printFrame('hello -> room (p1)', room1);
  printFrame('move {id:"7,0"} -> state (p1)', states1.length > 1 ? p1.frames.find((f) => f.t === 'state' && f.n === 1) : null, true);
  printFrame('result (p1)', result1);

  p1.close();
  p2.close();
  return { match, hashes, log };
}

async function playTimeoutGame(base) {
  note('timeout: creating a match and idling');
  const match = await createMatch(base, 'gomoku');
  const p1 = await Client.connect(match.joinUrl, 'timeout-p1');
  const p2 = await Client.connect(match.joinUrl, 'timeout-p2');
  p1.send({ t: 'hello', v: 1, agent: { id: 'timeout-p1', name: 'Timeout P1' }, game: 'gomoku' });
  await p1.waitFor((m) => m.t === 'room', 'timeout room p1');
  p2.send({ t: 'hello', v: 1, agent: { id: 'timeout-p2', name: 'Timeout P2' }, game: 'gomoku' });
  await p2.waitFor((m) => m.t === 'room', 'timeout room p2');
  await p1.waitFor((m) => m.t === 'state' && m.n === 0, 'timeout start p1');

  const startedAt = Date.now();
  const result = await p1.waitFor((m) => m.t === 'result', 'timeout result', MOVE_TIMEOUT_MS + 12000);
  const elapsed = Date.now() - startedAt;
  assert.strictEqual(result.winner, 'p2', 'timeout should award the win to the opponent of p1');
  assert.strictEqual(result.byTimeout, true);
  assert.strictEqual(result.draw, false);
  assert.deepStrictEqual(result.moves, []);
  assert.deepStrictEqual(result.hashChain, []);
  assert.ok(elapsed >= MOVE_TIMEOUT_MS - 250, 'timeout fired too early: ' + elapsed + 'ms');

  const result2 = await p2.waitFor((m) => m.t === 'result', 'timeout result p2');
  assert.deepStrictEqual(result, result2, 'timeout result differs between seats');

  const log = await fetchLog(base, match.matchId);
  assert.deepStrictEqual(log.moves, []);
  assert.strictEqual(log.result.byTimeout, true);
  assert.strictEqual(log.result.winner, 'p2');
  assert.strictEqual(log.finalHash, await core.genesisHash('gomoku', log.seed));
  const verdict = await core.verifyLog(log);
  assert.deepStrictEqual(verdict.errors, [], 'timeout log verification failed');

  printFrame('timeout result (p1)', result);
  note('timeout: fired after ' + elapsed + 'ms');

  p1.close();
  p2.close();
}

async function reclaimCheck(base) {
  note('reclaim: both seats drop and the room must be wiped, not timeout-judged');
  const match = await createMatch(base, 'gomoku');
  const p1 = await Client.connect(match.joinUrl, 'reclaim-p1');
  const p2 = await Client.connect(match.joinUrl, 'reclaim-p2');
  p1.send({ t: 'hello', v: 1, agent: { id: 'reclaim-p1', name: 'Reclaim P1' }, game: 'gomoku' });
  await p1.waitFor((m) => m.t === 'room', 'reclaim room p1');
  p2.send({ t: 'hello', v: 1, agent: { id: 'reclaim-p2', name: 'Reclaim P2' }, game: 'gomoku' });
  await p2.waitFor((m) => m.t === 'room', 'reclaim room p2');
  await p1.waitFor((m) => m.t === 'state' && m.n === 0, 'reclaim start');

  p1.close();
  p2.close();

  // ROOM_RECLAIM_MS is 3 s in this smoke run. If the timeout path won instead,
  // the log would stay for 24 h and this 404 would never arrive.
  const deadline = Date.now() + 12000;
  let status = null;
  while (Date.now() < deadline) {
    const res = await getJson(base + '/api/match/' + match.matchId + '/log');
    status = res.status;
    if (status === 404) break;
    await sleep(300);
  }
  assert.strictEqual(status, 404, 'both-offline room was not reclaimed');

  let rooms = null;
  for (let i = 0; i < 20; i++) {
    const health = await getJson(base + '/health');
    rooms = health.body.rooms;
    if (rooms === 0) break;
    await sleep(200);
  }
  assert.strictEqual(rooms, 0, 'registry still counts reclaimed rooms');
  note('reclaim: room wiped, active rooms = 0');
}

async function rateLimitCheck(base) {
  note('limits: per-IP creation rate (10/min)');
  const prior = createCounts.get(base) || 0;
  let successes = 0;
  let limited = null;
  for (let i = 0; i < 12; i++) {
    const res = await getJson(base + '/api/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: 'connect4' }),
    });
    if (res.status === 200) {
      successes++;
      createCounts.set(base, (createCounts.get(base) || 0) + 1);
    } else {
      limited = res;
      break;
    }
  }
  assert.ok(limited, 'never hit the creation rate limit');
  assert.strictEqual(limited.status, 429);
  assert.strictEqual(limited.body.error, 'rate_limited');
  assert.strictEqual(successes, Math.max(0, 10 - prior), 'unexpected successful creates before limit');
  note('limits: rate limit hit after ' + (prior + successes) + ' creates in this process');
}

async function roomCapCheck() {
  note('limits: global room cap via a second instance (MAX_ROOMS=3)');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const child = startWrangler(port, tempDir(), ['MAX_ROOMS:3', 'JOIN_TIMEOUT_MS:60000']);
  try {
    const health = await waitHealthy(base, child);
    assert.strictEqual(health.ok, true);

    const created = [];
    for (let i = 0; i < 3; i++) created.push(await createMatch(base, 'connect4'));
    assert.strictEqual(created.length, 3);

    const capped = await getJson(base + '/api/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: 'connect4' }),
    });
    assert.strictEqual(capped.status, 429, JSON.stringify(capped.body));
    assert.strictEqual(capped.body.error, 'room_limit');

    const health2 = await getJson(base + '/health');
    assert.strictEqual(health2.body.rooms, 3);
    note('limits: room cap held at ' + health2.body.rooms + ' active rooms');
  } finally {
    await stopWrangler(child);
  }
}

async function main() {
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const child = startWrangler(port, tempDir(), []);
  let ok = false;
  try {
    const health = await waitHealthy(base, child);
    assert.strictEqual(health.ok, true);
    assert.ok(typeof health.version === 'string' && health.version.length > 0);
    assert.strictEqual(typeof health.rooms, 'number');
    note('health: ' + JSON.stringify(health));

    const game = await playMainGame(base);
    await playTimeoutGame(base);
    await reclaimCheck(base);
    await rateLimitCheck(base);
    await roomCapCheck();

    // Independent third-party check of the retained log, exactly as README
    // instructs: replay using the shared rule engine, not any live room state.
    const res = await getJson(base + '/api/match/' + game.match.matchId + '/log');
    const shared = require('../../shared/rules.js');
    const replay = await replayWithShared(shared, res.body);
    assert.strictEqual(replay.ok, true, JSON.stringify(replay.errors));
    assert.strictEqual(replay.finalHash, game.hashes[game.hashes.length - 1]);

    ok = true;
    console.log('[smoke] PASS');
  } catch (err) {
    console.error('[smoke] FAIL: ' + (err && err.stack ? err.stack : err));
    console.error('--- wrangler output (tail) ---');
    console.error(tail(child.log));
    process.exitCode = 1;
  } finally {
    await stopWrangler(child);
    for (const child2 of children.slice()) await stopWrangler(child2);
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  if (ok) note('all smoke assertions passed');
}

// Standalone replay path used as a second opinion: it uses games/shared/rules.js
// (the upstream source) rather than the worker's snapshot copy.
function replayWithShared(sharedRules, log) {
  const errors = [];
  const board = new Array(225).fill(0);
  let turn = 1;
  const hashes = [];
  let prev = null;
  const enc = new TextEncoder();
  const sha = async (text) => {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  return (async () => {
    prev = await sha(JSON.stringify({ v: 1, game: log.game, seed: String(log.seed) }));
    if (log.game !== 'gomoku') return { ok: false, errors: ['unsupported_game_in_shared_replay'], finalHash: null };
    for (let i = 0; i < log.moves.length; i++) {
      const move = log.moves[i];
      const parts = String(move.id).split(',');
      const r = Number(parts[0]);
      const c = Number(parts[1]);
      const expectedSeat = turn === 1 ? 'p1' : 'p2';
      if (move.n !== i + 1) errors.push('n');
      if (move.seat !== expectedSeat) errors.push('seat');
      if (!(r >= 0 && r < 15 && c >= 0 && c < 15) || board[r * 15 + c] !== 0) {
        errors.push('illegal_' + (i + 1));
        break;
      }
      board[r * 15 + c] = turn;
      const over = sharedRules.gomoku.checkWinAt(board, r, c, turn) || i + 1 >= 225;
      const state = {
        game: 'gomoku',
        board: board.slice(),
        turn: turn === 1 ? 'p2' : 'p1',
        last: r * 15 + c,
        plies: i + 1,
        over: over ? 1 : 0,
        winner: over ? (turn === 1 ? 'p1' : 'p2') : null,
        draw: over && !sharedRules.gomoku.checkWinAt(board, r, c, turn) ? 1 : 0,
      };
      const canonical = JSON.stringify({
        v: 1,
        n: i + 1,
        game: state.game,
        board: state.board,
        turn: state.turn,
        last: state.last,
        plies: state.plies,
        over: state.over,
        winner: state.winner,
        draw: state.draw,
      });
      prev = await sha(prev + canonical);
      hashes.push(prev);
      turn = 3 - turn;
    }
    const finalHash = hashes.length ? hashes[hashes.length - 1] : await sha(JSON.stringify({ v: 1, game: log.game, seed: String(log.seed) }));
    for (let i = 0; i < log.hashChain.length; i++) {
      if (log.hashChain[i] !== hashes[i]) errors.push('chain_' + (i + 1));
    }
    if (log.finalHash !== finalHash) errors.push('final');
    return { ok: errors.length === 0, errors: errors, finalHash: finalHash };
  })();
}

main();
