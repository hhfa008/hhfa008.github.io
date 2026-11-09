#!/usr/bin/env node
'use strict';

/*
 * Deterministic AI agent evaluation runner.
 *
 *   node games/ai-eval/runner.js --suite A --seed 42 --adapter builtin
 *   node games/ai-eval/runner.js --suite A --seed 42 --adapter random
 *   node games/ai-eval/runner.js --suite B --seed 42 --adapter http --n 20
 *   node games/ai-eval/runner.js --all --seed 42 --adapter builtin --json
 *
 * Three suites, no LLM judge:
 *   A closed-form rule reproduction (exact JSON, arrays as sets)
 *   B seeded matches vs the builtin heuristic (win rate + Wilson 95% CI)
 *   C code tasks (failing test -> green, plus tiny diff bonus)
 *
 * Reproducibility:
 *   - suite A bank is generated from a fixed internal seed; the run seed
 *     chooses the sample.
 *   - suite B match seeds derive from the run seed.
 *   - engineVersion is a SHA-256 over the shared engines + this engine.
 *   - each result carries a `digest` that ignores wall-clock timestamps.
 *
 * Suite B prefers games/shared/agent-api.js when it exists and exposes
 * GameAgent.create(slug,{seed}); otherwise it drives shared/tcg.js directly.
 * The opponent's strength ceiling is the builtin heuristic either way.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var TCG = require('../shared/tcg.js');
var tasks = require('./tasks.js');
var score = require('./score.js');
var adapters = require('./adapters.js');

var MAX_PLIES = 600;
var REPO_ROOT = tasks.ROOT;

/* ------------------------------ game sessions ----------------------------- */

function loadAgentApi() {
  try {
    var mod = require('../shared/agent-api.js');
    if (mod && typeof mod.create === 'function') return mod;
    if (mod && mod.GameAgent && typeof mod.GameAgent.create === 'function') return mod.GameAgent;
    if (mod && mod.default && typeof mod.default.create === 'function') return mod.default;
  } catch (e) { /* not present or not importable: use the direct fallback */ }
  return null;
}

function directState(match) {
  return match.state;
}

function createDirectTcgSession(seed) {
  var match = TCG.createMatch(tasks.tcgConfig(seed));
  return {
    kind: 'tcg-direct',
    seats: [0, 1],
    state: function () { return directState(match); },
    player: function () { return directState(match).activePlayer; },
    legalActions: function () {
      return match.legalActions().map(function (action, i) {
        return { id: i, action: action, raw: action };
      });
    },
    applyEntry: function (entry) { match.apply(entry.action); },
    status: function () {
      var s = directState(match);
      return {
        over: s.phase === 'over',
        winner: s.winner === undefined ? null : s.winner,
        draw: !!s.draw
      };
    }
  };
}

// Flatten an agent-api legal action ({id,type,payload,desc}) into the plain
// action object our adapters/policy understand, while keeping the id for
// session.apply(id).
function flattenAgentAction(item, index) {
  if (item && typeof item === 'object' && item.action && typeof item.action === 'object') {
    return { id: item.id === undefined ? index : item.id, action: item.action, raw: item };
  }
  if (!item || typeof item !== 'object') {
    return { id: index, action: item, raw: item };
  }
  var action = {};
  Object.keys(item).forEach(function (key) {
    if (key === 'id' || key === 'desc' || key === 'payload') return;
    action[key] = item[key];
  });
  var payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
  Object.keys(payload).forEach(function (key) { action[key] = payload[key]; });
  return {
    id: item.id === undefined ? index : item.id,
    action: action,
    raw: item
  };
}

function wrapAgentApiSession(raw) {
  return {
    kind: 'agent-api',
    raw: raw,
    seats: Array.isArray(raw.seats) && raw.seats.length ? raw.seats.slice() : ['p1', 'p2'],
    state: function () { return typeof raw.state === 'function' ? raw.state() : raw.state; },
    player: function () {
      if (typeof raw.player === 'function') return raw.player();
      return activePlayerOf(this.state());
    },
    legalActions: function () {
      var list = typeof raw.legalActions === 'function' ? (raw.legalActions() || []) : [];
      return list.map(flattenAgentAction);
    },
    applyEntry: function (entry) {
      // Protocol: apply(id) -> {ok:true}|{ok:false,error}. Fall back to the
      // action object only for hosts that throw on ids.
      var res;
      try {
        res = raw.apply(entry.id);
      } catch (first) {
        return raw.apply(entry.action);
      }
      if (res && res.ok === false) {
        var err = new Error(res.error || 'agent-api rejected a legal action');
        err.code = 'apply_error';
        throw err;
      }
      if (res === false) {
        var err2 = new Error('agent-api rejected a legal action');
        err2.code = 'apply_error';
        throw err2;
      }
      return res;
    },
    status: function () {
      var st = null;
      if (typeof raw.status === 'function') st = raw.status();
      else st = this.state();
      if (st && typeof st === 'object') {
        var over = st.over === true || st.phase === 'over' || st.status === 'over' ||
          st.finished === true;
        var winner = st.winner;
        if (winner === undefined) winner = st.winnerPlayer;
        if (winner === undefined) winner = null;
        var draw = st.draw === true || winner === 'draw' ||
          (over && (winner === null || winner === undefined));
        return {
          over: over,
          winner: draw ? null : winner,
          draw: draw
        };
      }
      return { over: false, winner: null, draw: false };
    }
  };
}

function createBSession(game, seed) {
  var api = loadAgentApi();
  if (api && game === 'tcg') {
    try {
      var raw = api.create(game, { seed: String(seed) });
      if (raw && typeof raw.legalActions === 'function' && typeof raw.apply === 'function') {
        return wrapAgentApiSession(raw);
      }
    } catch (e) { /* fall through to the direct engine */ }
  }
  if (game === 'tcg') return createDirectTcgSession(seed);
  throw new Error('suite B: unsupported game "' + game + '" (supported: tcg)');
}

/* -------------------------------- B helpers ------------------------------- */

function cloneJson(v) { return JSON.parse(JSON.stringify(v)); }

function cardView(state, card) {
  var def = state.defs && state.defs[card.defId] ? state.defs[card.defId] : {};
  return {
    id: card.id,
    defId: card.defId,
    cost: def.cost,
    atk: card.atk,
    hp: card.hp
  };
}

function unitView(card) {
  return {
    id: card.id,
    defId: card.defId,
    atk: card.atk,
    hp: card.hp,
    ready: card.ready === true,
    playedTurn: card.playedTurn
  };
}

// Hide the opponent's hand/deck and both deck orders. Legal actions are
// enumerated by the runner, so the agent never needs hidden information.
function sanitizeTcgState(state, player) {
  var copy = cloneJson(state);
  if (!copy || !Array.isArray(copy.players)) return copy;
  // The RNG state and seed would let an agent reconstruct hidden deck order.
  if (Object.prototype.hasOwnProperty.call(copy, 'rng')) delete copy.rng;
  if (Object.prototype.hasOwnProperty.call(copy, 'seed')) delete copy.seed;
  for (var p = 0; p < copy.players.length; p++) {
    var pl = copy.players[p];
    if (p !== player) {
      pl.hand = (pl.hand || []).map(function () { return { hidden: true }; });
    }
    pl.deck = (pl.deck || []).map(function () { return { hidden: true }; });
  }
  return copy;
}

function buildView(session, game, player, legalEntries, playerIndex) {
  var state = session.state();
  var legal = legalEntries.map(function (e) { return e.action; });
  var index = Number(playerIndex);
  if (!(index >= 0) || index > 1) index = typeof player === 'number' ? player : 0;
  var view = { game: game, player: player, playerIndex: index, legalActions: legal, state: state };
  if (game === 'tcg' && state && Array.isArray(state.players) && state.players[index]) {
    var me = state.players[index];
    var foe = state.players[1 - index];
    view.state = sanitizeTcgState(state, index);
    view.me = {
      core: me.core,
      resource: me.resource,
      hand: (me.hand || []).map(function (c) { return cardView(state, c); }),
      field: (me.field || []).map(unitView),
      deckCount: (me.deck || []).length
    };
    view.foe = {
      core: foe.core,
      resource: foe.resource,
      handCount: (foe.hand || []).length,
      field: (foe.field || []).map(unitView),
      deckCount: (foe.deck || []).length
    };
  }
  return view;
}

function findLegalEntry(decision, entries) {
  for (var i = 0; i < entries.length; i++) {
    if (score.deepEqual(decision, entries[i].action)) return entries[i];
    // Accept the protocol id/index as a shortcut for the same legal action.
    if (decision !== null && decision !== undefined && !Array.isArray(decision)) {
      if (typeof decision === 'object' && decision.id !== undefined &&
        String(decision.id) === String(entries[i].id)) return entries[i];
      if (typeof decision !== 'object' && String(decision) === String(entries[i].id)) return entries[i];
    }
  }
  return null;
}

function activePlayerOf(state) {
  if (!state || typeof state !== 'object') return 0;
  if (state.activePlayer !== undefined) return state.activePlayer;
  if (state.turn !== undefined && (state.currentPlayer !== undefined)) return state.currentPlayer;
  return 0;
}

/* --------------------------------- suite A -------------------------------- */

async function runSuiteA(opts) {
  var seed = String(opts.seed);
  var bank = tasks.generateABank();
  var n = opts.n === undefined ? 120 : Number(opts.n);
  var selected = tasks.sampleTasks(bank, n, seed, 'A');
  var cases = [];
  for (var i = 0; i < selected.length; i++) {
    var task = selected[i];
    var answer;
    try {
      answer = await opts.adapter.answer(tasks.publicTask(task));
    } catch (e) {
      cases.push({
        id: task.id,
        pass: false,
        detail: { family: task.family, reason: 'adapter_error', error: score.shorten(e && e.message, 240) }
      });
      continue;
    }
    if (adapters.isInvalid(answer)) {
      cases.push({
        id: task.id,
        pass: false,
        detail: { family: task.family, reason: 'invalid_format', error: answer.reason || 'invalid_format' }
      });
      continue;
    }
    var pass = score.deepEqual(answer, task.expected);
    var detail = { family: task.family };
    if (!pass) {
      detail.reason = 'mismatch';
      detail.got = score.shorten(answer, 320);
      detail.want = score.shorten(task.expected, 320);
    }
    cases.push({ id: task.id, pass: pass, detail: detail });
  }
  var passed = cases.filter(function (c) { return c.pass; }).length;
  var summary = {
    score: passed,
    total: cases.length,
    passRate: cases.length ? passed / cases.length : 0,
    bankSize: bank.length,
    sampled: cases.length,
    families: tasks.bankSizes()
  };
  return finalize({
    suite: 'A',
    seed: opts.seed,
    startedAt: opts.startedAt,
    engineVersion: opts.engineVersion,
    cases: cases,
    summary: summary
  }, opts.adapter);
}

/* --------------------------------- suite B -------------------------------- */

async function runBCase(caseDef, adapter) {
  var session;
  try {
    session = createBSession(caseDef.game, caseDef.seed);
  } catch (e) {
    return {
      id: caseDef.id,
      pass: false,
      detail: {
        game: caseDef.game,
        agentPlayer: caseDef.agentPlayer,
        seed: caseDef.seed,
        result: 'error',
        reason: 'session_error',
        error: score.shorten(e && e.message, 240)
      }
    };
  }
  var plies = 0;
  var illegal = null;
  var agentId = caseDef.agentPlayer;
  var seats = Array.isArray(session.seats) && session.seats.length ? session.seats : null;
  var agentSeat = seats ? seats[agentId] : agentId;
  var result = 'draw';
  var winner = null;

  while (plies < MAX_PLIES) {
    var status = session.status();
    if (status && status.over) {
      winner = status.winner;
      break;
    }
    var entries = session.legalActions();
    if (!entries.length) {
      illegal = { code: 'no_legal_actions' };
      break;
    }
    var state = session.state();
    var active = typeof session.player === 'function' ? session.player() : null;
    if (active === undefined || active === null) active = activePlayerOf(state);
    var activeIndex = seats ? seats.indexOf(active) : Number(active);
    if (activeIndex < 0) {
      activeIndex = activePlayerOf(state);
      if (seats) active = seats[activeIndex];
    }
    var view = buildView(session, caseDef.game, active, entries, activeIndex);
    var decision;
    try {
      if (String(active) === String(agentSeat)) decision = await adapter.move(view);
      else decision = adapters.chooseTcgAction(view, view.legalActions);
    } catch (e) {
      illegal = { code: 'adapter_error', message: score.shorten(e && e.message, 240) };
      break;
    }
    if (adapters.isInvalid(decision)) {
      illegal = { code: adapters.isInvalid(decision) ? (decision.reason || 'invalid_format') : 'invalid_format' };
      break;
    }
    var entry = findLegalEntry(decision, entries);
    if (!entry) {
      if (String(active) === String(agentSeat)) {
        illegal = {
          code: 'illegal_action',
          got: score.shorten(decision, 240)
        };
        break;
      }
      // The opponent is our own policy; never let a runner bug invalidate a
      // measurement. Fall back to the first offered legal action.
      entry = entries[0];
    }
    try {
      session.applyEntry(entry);
    } catch (e) {
      if (String(active) === String(agentSeat)) {
        illegal = { code: (e && e.code) || 'apply_error', message: score.shorten(e && e.message, 240) };
        break;
      }
      entry = entries[0];
      try { session.applyEntry(entry); }
      catch (e2) { illegal = { code: 'runner_apply_error', message: score.shorten(e2 && e2.message, 240) }; break; }
    }
    plies++;
  }

  if (plies >= MAX_PLIES) {
    illegal = illegal || { code: 'max_plies' };
  }

  var won = false;
  var drew = false;
  if (illegal) {
    result = 'loss';
  } else {
    // Re-read the terminal status; winner===null/undefined means a draw.
    var final = session.status();
    if (final && final.over) {
      if (final.draw || final.winner === null || final.winner === undefined) {
        result = 'draw';
        drew = true;
      } else if (String(final.winner) === String(agentSeat)) {
        result = 'win';
        won = true;
      } else {
        result = 'loss';
      }
    } else {
      result = 'draw';
      drew = true;
    }
  }

  var detail = {
    game: caseDef.game,
    agentPlayer: agentId,
    agentSeat: agentSeat,
    seed: caseDef.seed,
    result: result,
    plies: plies,
    session: session.kind
  };
  if (illegal) detail.illegal = illegal;
  return { id: caseDef.id, pass: won, detail: detail };
}

async function runSuiteB(opts) {
  var seed = String(opts.seed);
  var n = opts.n === undefined ? 20 : Number(opts.n);
  var games = opts.games && opts.games.length ? opts.games : ['tcg'];
  var defs = tasks.generateBCases(seed, n, games);
  var cases = [];
  for (var i = 0; i < defs.length; i++) {
    cases.push(await runBCase(defs[i], opts.adapter));
  }
  var wins = 0, losses = 0, draws = 0, illegal = 0, plies = 0;
  cases.forEach(function (c) {
    var r = c.detail.result;
    if (r === 'win') wins++;
    else if (r === 'loss') losses++;
    else draws++;
    if (c.detail.illegal) illegal++;
    plies += c.detail.plies || 0;
  });
  var decisive = wins + losses;
  var winRate = decisive ? wins / decisive : null;
  var ci = score.wilsonInterval(wins, decisive);
  var summary = {
    score: score.round(wins + draws * 0.5, 6),
    total: cases.length,
    passRate: cases.length ? wins / cases.length : 0,
    wins: wins,
    losses: losses,
    draws: draws,
    illegal: illegal,
    winRate: winRate,
    scoreRate: cases.length ? score.round((wins + draws * 0.5) / cases.length, 6) : 0,
    ci: ci,
    plies: plies,
    games: games,
    perSide: n
  };
  return finalize({
    suite: 'B',
    seed: opts.seed,
    startedAt: opts.startedAt,
    engineVersion: opts.engineVersion,
    cases: cases,
    summary: summary
  }, opts.adapter);
}

/* --------------------------------- suite C -------------------------------- */

function spawnNode(args, options) {
  return child.spawnSync(process.execPath, args, options);
}

function tail(text, max) {
  var s = String(text || '');
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max);
}

function normalizeSubmittedFiles(submitted, task) {
  if (typeof submitted === 'string') {
    var firstName = Object.keys(task.files || {})[0];
    if (!firstName) return { error: 'no_files' };
    var single = {};
    single[firstName] = submitted;
    return { files: single };
  }
  if (!submitted || typeof submitted !== 'object') return { error: 'invalid_format' };
  var raw = submitted.files;
  if (raw === undefined && typeof submitted.content === 'string') {
    raw = {};
    var name0 = Object.keys(task.files || {})[0];
    if (name0) raw[name0] = submitted.content;
  }
  if (!raw || typeof raw !== 'object') return { error: 'invalid_format' };
  var out = {};
  if (Array.isArray(raw)) {
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].path) out[raw[i].path] = raw[i].content;
    }
  } else {
    Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
  }
  if (!Object.keys(out).length) return { error: 'invalid_format' };
  var allowed = task.files || {};
  var keys = Object.keys(out);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    if (!Object.prototype.hasOwnProperty.call(allowed, key) || typeof out[key] !== 'string') {
      return { error: 'invalid_file', file: key };
    }
  }
  return { files: out };
}

async function runSandboxTask(task, adapter, opts) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eval-C-'));
  var keep = !!opts.keepSandboxes;
  try {
    Object.keys(task.files).forEach(function (name) {
      fs.writeFileSync(path.join(dir, name), task.files[name]);
    });
    fs.writeFileSync(path.join(dir, task.testFile), task.test);
    var submitted;
    try {
      submitted = await adapter.solve(tasks.publicTask(task), {
        reference: task.reference,
        sandbox: dir
      });
    } catch (e) {
      return {
        pass: false,
        score: 0,
        detail: { reason: 'adapter_error', error: score.shorten(e && e.message, 240) }
      };
    }
    if (adapters.isInvalid(submitted)) {
      return {
        pass: false,
        score: 0,
        detail: { reason: 'invalid_format', error: submitted.reason || 'invalid_format' }
      };
    }
    var normalized = normalizeSubmittedFiles(submitted, task);
    if (normalized.error) {
      return { pass: false, score: 0, detail: { reason: normalized.error, file: normalized.file } };
    }
    var changed = 0;
    Object.keys(normalized.files).forEach(function (name) {
      var before = task.files[name];
      var after = normalized.files[name];
      changed += score.diffLineCount(before, after).total;
      fs.writeFileSync(path.join(dir, name), after);
    });
    var run = spawnNode([task.testFile], {
      cwd: dir,
      timeout: opts.testTimeoutMs || 30000,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '' }
    });
    var timedOut = !!(run.error && run.error.code === 'ETIMEDOUT');
    var pass = !timedOut && run.status === 0;
    var bonus = pass ? 0.25 * (1 - Math.min(1, changed / 40)) : 0;
    var taskScore = pass ? 1 + bonus : 0;
    return {
      pass: pass,
      score: score.round(taskScore, 6),
      detail: {
        reason: pass ? 'test_green' : (timedOut ? 'test_timeout' : 'test_failed'),
        testExit: run.status,
        changedLines: changed,
        score: score.round(taskScore, 6),
        stdoutTail: tail(run.stdout, 240),
        stderrTail: tail(run.stderr, 240),
        sandbox: keep ? dir : undefined
      }
    };
  } finally {
    if (!keep) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  }
}

function runFullRepoSuite() {
  var started = Date.now();
  var run = spawnNode([path.join(REPO_ROOT, 'games', 'tests', 'run-all.js')], {
    cwd: REPO_ROOT,
    timeout: 300000,
    encoding: 'utf8'
  });
  var timedOut = !!(run.error && run.error.code === 'ETIMEDOUT');
  return {
    ok: !timedOut && run.status === 0,
    exitCode: run.status,
    timedOut: timedOut,
    durationMs: Date.now() - started,
    stderrTail: tail(run.stderr, 200)
  };
}

function gitChangedLines(paths) {
  if (!paths || !paths.length) return null;
  try {
    var run = child.spawnSync('git', ['diff', '--numstat', '--'].concat(paths), {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30000
    });
    if (run.status !== 0) return null;
    var total = 0;
    var files = 0;
    String(run.stdout || '').split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var parts = line.split(/\s+/);
      var added = parts[0] === '-' ? 0 : Number(parts[0]);
      var removed = parts[1] === '-' ? 0 : Number(parts[1]);
      if (isFinite(added) && isFinite(removed)) {
        total += added + removed;
        files++;
      }
    });
    return { total: total, files: files };
  } catch (e) {
    return null;
  }
}

function runRepoTask(task, repoSuite) {
  var checkScript = path.join(REPO_ROOT, 'scripts', 'check-tasks.js');
  var run = spawnNode([checkScript, '--task', task.checkTaskId], {
    cwd: REPO_ROOT,
    timeout: 120000,
    encoding: 'utf8'
  });
  var checkOk = run.status === 0 && !(run.error && run.error.code === 'ETIMEDOUT');
  var suiteOk = !!(repoSuite && repoSuite.ok);
  var pass = checkOk && suiteOk;
  var changed = gitChangedLines(task.probePaths);
  // Same bounded simplicity signal as the built-in tasks. `git diff` also
  // sees unrelated uncommitted edits in the same files, so this is a weak
  // bonus, never a correctness substitute.
  var bonus = pass && changed ? 0.25 * (1 - Math.min(1, changed.total / 40)) : 0;
  return {
    pass: pass,
    score: pass ? score.round(1 + bonus, 6) : 0,
    detail: {
      reason: pass ? 'check_green' : (!checkOk ? 'probe_check_failed' : 'repo_suite_red'),
      source: 'repo',
      checkExit: run.status,
      repoSuiteOk: suiteOk,
      changedLines: changed ? changed.total : null,
      stdoutTail: tail(run.stdout, 200),
      stderrTail: tail(run.stderr, 200)
    }
  };
}

async function runSuiteC(opts) {
  var seed = String(opts.seed);
  var info = tasks.generateCBank({ forceBuiltin: !!opts.forceBuiltinC });
  var n = opts.n === undefined ? info.tasks.length : Number(opts.n);
  var selected = tasks.sampleTasks(info.tasks, n, seed, 'C');
  var repoSuite = info.source === 'repo' ? runFullRepoSuite() : null;
  var cases = [];
  for (var i = 0; i < selected.length; i++) {
    var task = selected[i];
    var outcome;
    if (task.source === 'repo') {
      outcome = runRepoTask(task, repoSuite);
    } else {
      outcome = await runSandboxTask(task, opts.adapter, opts);
    }
    cases.push({ id: task.id, pass: outcome.pass, score: outcome.score, detail: outcome.detail });
  }
  var totalScore = 0;
  var passed = 0;
  var changedLines = 0;
  cases.forEach(function (c) {
    totalScore += c.score || 0;
    if (c.pass) passed++;
    if (c.detail && typeof c.detail.changedLines === 'number') changedLines += c.detail.changedLines;
  });
  var summary = {
    score: score.round(totalScore, 6),
    total: cases.length,
    passRate: cases.length ? passed / cases.length : 0,
    changedLines: changedLines,
    source: info.source,
    repoSuite: repoSuite
  };
  return finalize({
    suite: 'C',
    seed: opts.seed,
    startedAt: opts.startedAt,
    engineVersion: opts.engineVersion,
    cases: cases,
    summary: summary
  }, opts.adapter);
}

/* -------------------------------- finalize -------------------------------- */

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;
  var out = {};
  Object.keys(value).forEach(function (key) {
    // Wall-clock timings and temp-dir paths must not enter the digest.
    if (key === 'durationMs' || key === 'sandbox' ||
      key === 'startedAt' || key === 'finishedAt' ||
      key === 'stdoutTail' || key === 'stderrTail') return;
    out[key] = stripVolatile(value[key]);
  });
  return out;
}

function finalize(result, adapter) {
  result.adapter = adapter && adapter.name ? adapter.name : 'unknown';
  result.finishedAt = new Date().toISOString();
  result.digest = score.sha256(score.stableStringify({
    suite: result.suite,
    seed: String(result.seed),
    engineVersion: result.engineVersion,
    adapter: result.adapter,
    cases: stripVolatile(result.cases),
    summary: stripVolatile(result.summary)
  }));
  return result;
}

async function runSuite(options) {
  var opts = options || {};
  if (!opts.adapter) throw new Error('runSuite: adapter is required');
  var suite = String(opts.suite || '').toUpperCase();
  var seed = opts.seed === undefined ? 42 : opts.seed;
  var common = {
    seed: seed,
    adapter: opts.adapter,
    n: opts.n,
    games: opts.games,
    startedAt: new Date().toISOString(),
    engineVersion: tasks.engineVersion(),
    testTimeoutMs: opts.testTimeoutMs,
    keepSandboxes: opts.keepSandboxes,
    forceBuiltinC: !!(opts.forceBuiltinC || opts.builtinC)
  };
  if (suite === 'A') return runSuiteA(common);
  if (suite === 'B') return runSuiteB(common);
  if (suite === 'C') return runSuiteC(common);
  throw new Error('unknown suite: ' + opts.suite);
}

async function runAll(options) {
  var opts = options || {};
  var startedAt = new Date().toISOString();
  var engineVersion = tasks.engineVersion();
  var suites = {};
  var list = ['A', 'B', 'C'];
  for (var i = 0; i < list.length; i++) {
    suites[list[i]] = await runSuite({
      suite: list[i],
      seed: opts.seed,
      adapter: opts.adapter,
      n: i === 0 ? (opts.n === undefined ? 120 : opts.n) : (i === 1 ? (opts.bN === undefined ? 20 : opts.bN) : opts.n),
      games: opts.games,
      testTimeoutMs: opts.testTimeoutMs,
      keepSandboxes: opts.keepSandboxes,
      forceBuiltinC: !!(opts.forceBuiltinC || opts.builtinC)
    });
  }
  var result = {
    mode: 'all',
    seed: opts.seed === undefined ? 42 : opts.seed,
    engineVersion: engineVersion,
    startedAt: startedAt,
    finishedAt: new Date().toISOString(),
    adapter: opts.adapter && opts.adapter.name ? opts.adapter.name : 'unknown',
    suites: suites
  };
  result.digest = score.sha256(score.stableStringify({
    mode: 'all',
    seed: String(result.seed),
    engineVersion: engineVersion,
    adapter: result.adapter,
    digests: list.map(function (s) { return suites[s].digest; })
  }));
  return result;
}

/* ----------------------------------- CLI ---------------------------------- */

function usage() {
  return [
    'Deterministic AI eval runner (no LLM judge)',
    '',
    'Usage:',
    '  node games/ai-eval/runner.js --suite A --seed 42 --adapter builtin',
    '  node games/ai-eval/runner.js --suite B --seed 42 --adapter random --n 20',
    '  node games/ai-eval/runner.js --all --seed 42 --adapter builtin --json > result.json',
    '',
    'Options:',
    '  --suite A|B|C     run one suite',
    '  --all             run A, B and C',
    '  --seed N          run seed (default 42)',
    '  --adapter NAME    builtin | random | http (default builtin)',
    '  --n N             A: sample size (default 120); B: games per side (default 20); C: task limit',
    '  --games LIST      B games, comma separated (default tcg)',
    '  --json            print machine-readable JSON to stdout',
    '  --out FILE        also write the JSON result to FILE',
    '  --timeout MS      HTTP request timeout (default 60000)',
    '  --keep-sandboxes  keep suite C temp dirs on disk',
    '  --builtin-c      suite C: use the 3 built-in tasks even if TASKS.json exists',
    '  --help            show this help',
    '',
    'HTTP adapter environment (never printed):',
    '  AI_EVAL_API_KEY, AI_EVAL_BASE_URL, AI_EVAL_MODEL'
  ].join('\n');
}

function parseArgs(argv) {
  var out = { _: [] };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--keep-sandboxes') out.keepSandboxes = true;
    else if (a === '--builtin-c') out.builtinC = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--suite' || a === '--seed' || a === '--adapter' || a === '--n' ||
      a === '--games' || a === '--out' || a === '--timeout') {
      var key = a.slice(2);
      if (i + 1 >= argv.length) throw new Error('missing value for ' + a);
      out[key] = argv[++i];
    } else if (a.charAt(0) === '-') {
      throw new Error('unknown option: ' + a);
    } else {
      out._.push(a);
    }
  }
  return out;
}

function makeAdapter(args, seed) {
  var name = String(args.adapter || 'builtin').toLowerCase();
  if (name === 'builtin') return adapters.builtin();
  if (name === 'random') return adapters.random(seed);
  if (name === 'http') {
    var adapter = adapters.http({
      // Values come from the environment only; a missing key is reported
      // without echoing any value.
      baseUrl: process.env.AI_EVAL_BASE_URL,
      model: process.env.AI_EVAL_MODEL,
      apiKey: process.env.AI_EVAL_API_KEY,
      timeoutMs: args.timeout === undefined ? 60000 : Number(args.timeout)
    });
    if (!adapter.configured()) {
      throw new Error('http adapter is not configured: set AI_EVAL_API_KEY, ' +
        'AI_EVAL_BASE_URL and AI_EVAL_MODEL (values are never printed)');
    }
    return adapter;
  }
  throw new Error('unknown adapter: ' + name);
}

function humanLine(result) {
  var s = result.summary || {};
  var lines = [];
  lines.push('suite ' + result.suite + '  seed ' + result.seed + '  adapter ' + result.adapter);
  lines.push('engine ' + result.engineVersion);
  if (result.suite === 'A') {
    lines.push('score ' + s.score + '/' + s.total +
      '  passRate ' + (100 * s.passRate).toFixed(2) + '%' +
      '  bank ' + s.bankSize + '  sampled ' + s.sampled);
  } else if (result.suite === 'B') {
    lines.push('score ' + s.score + '/' + s.total +
      '  W/L/D ' + s.wins + '/' + s.losses + '/' + s.draws +
      '  illegal ' + s.illegal);
    if (s.winRate === null || s.winRate === undefined) {
      lines.push('winRate n/a (no decisive games)');
    } else {
      lines.push('winRate ' + (100 * s.winRate).toFixed(2) + '%' +
        '  Wilson95 [' + (100 * s.ci.low).toFixed(2) + '%, ' +
        (100 * s.ci.high).toFixed(2) + '%]  n=' + s.ci.n);
    }
  } else {
    lines.push('score ' + s.score + '/' + s.total +
      '  passRate ' + (100 * s.passRate).toFixed(2) + '%' +
      '  changedLines ' + s.changedLines + '  source ' + s.source);
    if (s.repoSuite) {
      lines.push('repo suite ' + (s.repoSuite.ok ? 'green' : 'RED') +
        '  exit ' + s.repoSuite.exitCode);
    }
  }
  lines.push('digest ' + result.digest);
  return lines.join('\n');
}

function humanAll(result) {
  var lines = ['all suites  seed ' + result.seed + '  adapter ' + result.adapter,
    'engine ' + result.engineVersion];
  ['A', 'B', 'C'].forEach(function (s) {
    lines.push('');
    lines.push(humanLine(result.suites[s]));
  });
  lines.push('');
  lines.push('digest ' + result.digest);
  return lines.join('\n');
}

async function main(argv) {
  var args;
  try { args = parseArgs(argv); }
  catch (e) {
    console.error(e.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (args.help) { console.log(usage()); return; }
  if (!args.all && !args.suite) {
    console.error('one of --suite A|B|C or --all is required');
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  var seed = args.seed === undefined ? 42 : args.seed;
  var adapter;
  try { adapter = makeAdapter(args, seed); }
  catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  var games = args.games ? String(args.games).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : undefined;
  var startedAt = new Date().toISOString();
  var result;
  try {
    if (args.all) {
      result = await runAll({
        seed: seed, adapter: adapter, n: args.n === undefined ? undefined : Number(args.n),
        games: games, testTimeoutMs: args.timeout === undefined ? undefined : Number(args.timeout),
        keepSandboxes: args.keepSandboxes, forceBuiltinC: args.builtinC
      });
    } else {
      result = await runSuite({
        suite: args.suite, seed: seed, adapter: adapter,
        n: args.n === undefined ? undefined : Number(args.n),
        games: games,
        testTimeoutMs: args.timeout === undefined ? undefined : Number(args.timeout),
        keepSandboxes: args.keepSandboxes, forceBuiltinC: args.builtinC
      });
    }
  } catch (e) {
    console.error('run failed: ' + (e && e.message ? e.message : String(e)));
    if (process.env.AI_EVAL_DEBUG) console.error(e && e.stack);
    process.exitCode = 1;
    return;
  }
  var json = JSON.stringify(result, null, 2) + '\n';
  if (args.out) {
    try { fs.writeFileSync(path.resolve(process.cwd(), args.out), json); }
    catch (e) {
      console.error('could not write --out file: ' + e.message);
      process.exitCode = 2;
      return;
    }
  }
  if (args.json) {
    process.stdout.write(json);
  } else {
    console.log(args.all ? humanAll(result) : humanLine(result));
    console.error('started ' + startedAt + '  finished ' + result.finishedAt);
  }
}

module.exports = {
  runSuite: runSuite,
  runAll: runAll,
  createBSession: createBSession,
  buildView: buildView,
  sanitizeTcgState: sanitizeTcgState,
  humanLine: humanLine,
  parseArgs: parseArgs
};

if (require.main === module) {
  main(process.argv.slice(2)).catch(function (e) {
    console.error('fatal: ' + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  });
}
