'use strict';

/*
 * Adapters for the deterministic AI eval engine.
 *
 *   builtin()            reference solver: recomputes every answer with the
 *                        repository's own engines. This is the control
 *                        baseline that proves each task is solvable.
 *   random(seed)         lower-bound baseline: deterministic random guesses.
 *   http({...})          any OpenAI-compatible /chat/completions endpoint.
 *
 * The HTTP adapter reads credentials only from the caller/environment. It
 * never logs, echoes or serialises the API key. Failures degrade to
 * { __ai_eval_invalid_format: true, reason } instead of throwing.
 *
 * Adapter contract:
 *   answer(publicTask) -> answer value (suite A)
 *   move(view)         -> one of view.legalActions (suite B)
 *   solve(publicTask, ctx) -> {files: {name: fullFileContent}} (suite C)
 *
 * `ctx.reference` is supplied only for the builtin adapter: it contains the
 * pristine source files the built-in code tasks were mutated from. HTTP and
 * random adapters ignore it.
 */

var H = require('../shared/hand-eval.js');
var Shuffle = require('../shared/shuffle.js');
var TCG = require('../shared/tcg.js');
var GameRules = require('../shared/rules.js');
var score = require('./score.js');

var INVALID = { __ai_eval_invalid_format: true };

function invalid(reason, detail) {
  var out = { __ai_eval_invalid_format: true, reason: reason || 'invalid_format' };
  if (detail !== undefined) out.detail = String(detail).slice(0, 300);
  return out;
}

function isInvalid(value) {
  return !!value && value.__ai_eval_invalid_format === true;
}

function randInt(rng, n) {
  if (!(n > 0)) return 0;
  if (typeof rng.nextUint32 === 'function') {
    var limit = 4294967296 - (4294967296 % n);
    var x;
    do { x = rng.nextUint32(); } while (x >= limit);
    return x % n;
  }
  var j = Math.floor(rng() * n);
  return j >= n ? n - 1 : (j < 0 ? 0 : j);
}

/* ============================== builtin ================================== */

var GOMOKU_N = GameRules.gomoku.N;

function gomokuResult(board) {
  var has = { 1: false, 2: false };
  var filled = 0;
  for (var i = 0; i < board.length; i++) {
    var p = board[i];
    if (p === 1 || p === 2) {
      filled++;
      var r = (i / GOMOKU_N) | 0;
      var c = i % GOMOKU_N;
      if (!has[p] && GameRules.gomoku.lineAt(board, r, c, p)) has[p] = true;
    }
  }
  if (has[1] && !has[2]) return 'black';
  if (has[2] && !has[1]) return 'white';
  if (has[1] && has[2]) return 'both';
  if (filled === board.length) return 'draw';
  return 'none';
}

function replayLegal(data) {
  var match = TCG.createMatch(data.setup);
  var history = data.history || [];
  for (var i = 0; i < history.length; i++) match.apply(history[i]);
  return match.legalActions(data.viewedPlayer);
}

function builtinAnswer(task) {
  var d = task.data || {};
  switch (task.family) {
    case 'mahjong':
      return { winning: H.checkWinningHand(d.tiles34).winning };
    case 'poker-category': {
      var ev = H.evalPoker(d.cards);
      return { category: ev.key, rank: ev.rank, tiebreak: ev.tiebreak.slice() };
    }
    case 'poker-compare':
      return { compare: H.comparePoker(H.evalPoker(d.a), H.evalPoker(d.b)) };
    case 'gomoku':
      return { winner: gomokuResult(d.board) };
    case 'tcg-legal':
      return replayLegal(d);
    default:
      return invalid('unknown_family:' + String(task.family));
  }
}

// Deterministic heuristic used for the builtin player in suite B and as the
// opponent. It only reads the public view, never hidden cards.
function findUnit(list, id) {
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
  return null;
}

function scoreTcgAction(action, view) {
  var me = view.me || {};
  var foe = view.foe || {};
  if (!action || typeof action.type !== 'string') return -1000;
  switch (action.type) {
    case 'playCard': {
      var card = findUnit(me.hand, action.cardId);
      if (!card) return -50;
      var body = (Number(card.atk) || 0) * 2 + (Number(card.hp) || 0);
      return 10 + body - (Number(card.cost) || 0) * 0.5;
    }
    case 'attack': {
      var atk = findUnit(me.field, action.attacker);
      if (!atk) return -50;
      var power = Number(atk.atk) || 0;
      if (action.target === 'core') {
        if ((Number(foe.core) || 0) <= power) return 10000;
        return 10 + power;
      }
      var target = findUnit(foe.field, action.target);
      if (!target) return -50;
      var kill = (Number(target.hp) || 0) <= power;
      var dies = (Number(atk.hp) || 0) <= (Number(target.atk) || 0);
      if (kill && !dies) return 500 + (Number(target.atk) || 0) + (Number(target.hp) || 0);
      if (kill && dies) return 300 + (Number(target.atk) || 0) + (Number(target.hp) || 0) - power;
      if (!kill && dies) return -30;
      return 40 + (Number(target.atk) || 0);
    }
    case 'activate':
      return 35;
    case 'endTurn':
      return 0;
    default:
      return -100;
  }
}

function chooseTcgAction(view, legal) {
  var list = Array.isArray(legal) ? legal : [];
  if (!list.length) return { type: 'endTurn' };
  // Opaque host states (for example an agent-api adapter that exposes a
  // different snapshot shape) still get a deterministic, sensible policy:
  // develop the board first, then attack/activate, then end the turn.
  if (!view.me || !Array.isArray(view.me.field)) {
    var priority = { playCard: 3, attack: 2, activate: 1, endTurn: 0 };
    var chosen = list[0];
    var chosenRank = -1;
    var chosenKey = '';
    for (var q = 0; q < list.length; q++) {
      var ty = list[q] && list[q].type;
      var rk = priority[ty] === undefined ? -1 : priority[ty];
      var ky = score.canonicalKey(list[q], false);
      if (rk > chosenRank || (rk === chosenRank && ky < chosenKey)) {
        chosen = list[q];
        chosenRank = rk;
        chosenKey = ky;
      }
    }
    return chosen;
  }
  var best = null;
  var bestScore = -Infinity;
  var bestKey = '';
  for (var i = 0; i < list.length; i++) {
    var s = scoreTcgAction(list[i], view);
    var key = score.canonicalKey(list[i], false);
    if (s > bestScore || (s === bestScore && key < bestKey)) {
      best = list[i];
      bestScore = s;
      bestKey = key;
    }
  }
  return best || list[0];
}

var builtinAdapter = {
  name: 'builtin',
  answer: function (task) {
    try { return builtinAnswer(task); }
    catch (e) { return invalid('builtin_error', e && e.message); }
  },
  move: function (view) {
    var legal = view.legalActions || [];
    if (view.game === 'connect4') {
      // Center-first deterministic Connect Four policy (extension point).
      var order = [3, 2, 4, 1, 5, 0, 6];
      for (var i = 0; i < order.length; i++) {
        if (legal.indexOf(order[i]) >= 0) return order[i];
      }
      return legal[0];
    }
    return chooseTcgAction(view, legal);
  },
  solve: function (task, ctx) {
    if (ctx && ctx.reference) return { files: ctx.reference };
    return invalid('builtin_no_reference');
  }
};

function builtin() {
  return builtinAdapter;
}

/* =============================== random ================================== */

var GOMOKU_ANSWERS = ['black', 'white', 'draw'];

function randomTcgActions(state) {
  var actions = [];
  try {
    if (!state || state.phase === 'over') return [{ type: 'endTurn' }];
    var p = state.activePlayer;
    var me = state.players[p];
    var foe = state.players[1 - p];
    actions.push({ type: 'endTurn' });
    var i;
    for (i = 0; i < me.hand.length; i++) {
      actions.push({ type: 'playCard', cardId: me.hand[i].id });
    }
    for (i = 0; i < me.field.length; i++) {
      var unit = me.field[i];
      actions.push({ type: 'attack', attacker: unit.id, target: 'core' });
      for (var j = 0; j < foe.field.length; j++) {
        actions.push({ type: 'attack', attacker: unit.id, target: foe.field[j].id });
      }
      actions.push({ type: 'activate', unitId: unit.id, abilityIndex: 0 });
    }
  } catch (e) {
    return [{ type: 'endTurn' }];
  }
  return actions;
}

function randomAnswer(task, rng) {
  var d = task.data || {};
  switch (task.family) {
    case 'mahjong':
      return { winning: randInt(rng, 2) === 1 };
    case 'poker-category': {
      var cats = ['high', 'pair', 'twopair', 'trips', 'straight', 'flush',
        'fullhouse', 'quads', 'straightflush', 'royal'];
      var rank = randInt(rng, 10);
      var tb = [];
      var tbLen = randInt(rng, 4);
      for (var i = 0; i < tbLen; i++) tb.push(2 + randInt(rng, 13));
      return { category: cats[rank], rank: rank, tiebreak: tb };
    }
    case 'poker-compare':
      return { compare: [-1, 0, 1][randInt(rng, 3)] };
    case 'gomoku':
      return { winner: GOMOKU_ANSWERS[randInt(rng, 3)] };
    case 'tcg-legal': {
      var pool = randomTcgActions(d.state);
      var picked = [];
      var count = randInt(rng, Math.min(4, pool.length + 1));
      var used = {};
      for (var k = 0; k < count; k++) {
        var at = randInt(rng, pool.length);
        if (!used[at]) { used[at] = true; picked.push(pool[at]); }
      }
      return picked;
    }
    default:
      return null;
  }
}

function random(seed) {
  var rng = Shuffle.createRng('ai-eval-random:' + String(seed === undefined ? 1 : seed));
  return {
    name: 'random',
    answer: function (task) { return randomAnswer(task, rng); },
    move: function (view) {
      var legal = view.legalActions || [];
      if (!legal.length) return { type: 'endTurn' };
      return legal[randInt(rng, legal.length)];
    },
    solve: function (task) {
      // Lower bound: hand back the buggy files unchanged.
      return { files: task.files || {} };
    }
  };
}

/* ================================ HTTP =================================== */

function joinEndpoint(baseUrl) {
  var url = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(url)) return url;
  return url + '/chat/completions';
}

function extractContent(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.choices && json.choices[0]) {
    var c = json.choices[0];
    if (c.message && typeof c.message.content === 'string') return c.message.content;
    if (typeof c.text === 'string') return c.text;
  }
  if (typeof json.content === 'string') return json.content;
  return null;
}

// A cancellable timeout signal for Promise.race. The timer is cleared after
// the race, otherwise a successful request would keep Node alive for up to
// `timeoutMs` (60s by default).
function makeTimeout(ms) {
  var timer = null;
  var promise = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve({ __timeout: true }); }, ms);
    if (timer && timer.unref) timer.unref();
  });
  return { promise: promise, clear: function () { if (timer) clearTimeout(timer); } };
}

function http(opts) {
  opts = opts || {};
  var baseUrl = opts.baseUrl || process.env.AI_EVAL_BASE_URL;
  var model = opts.model || process.env.AI_EVAL_MODEL;
  var apiKey = opts.apiKey !== undefined ? opts.apiKey : process.env.AI_EVAL_API_KEY;
  var timeoutMs = opts.timeoutMs === undefined ? 60000 : Number(opts.timeoutMs);
  var maxTokens = opts.maxTokens === undefined ? 4096 : Number(opts.maxTokens);
  var retry = opts.retry === undefined ? 1 : Number(opts.retry);
  var fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  var stats = { requests: 0, failures: 0 };

  function configured() {
    return !!(baseUrl && model && apiKey && fetchImpl);
  }

  async function chat(messages, maxTokensOverride) {
    if (!configured()) {
      return { ok: false, code: 'not_configured' };
    }
    var body = {
      model: model,
      messages: messages,
      temperature: opts.temperature === undefined ? 0 : opts.temperature,
      max_tokens: maxTokensOverride === undefined ? maxTokens : maxTokensOverride,
      stream: false
    };
    var tries = Math.max(0, retry) + 1;
    var lastCode = 'network';
    for (var attempt = 0; attempt < tries; attempt++) {
      stats.requests++;
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      var request;
      try {
        request = fetchImpl(joinEndpoint(baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + apiKey
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (e) {
        clearTimeout(timer);
        lastCode = 'network';
        stats.failures++;
        continue;
      }
      var guard = makeTimeout(timeoutMs);
      var raced = await Promise.race([
        Promise.resolve(request).then(function (r) { return { response: r }; }, function (e) {
          return { error: e };
        }),
        guard.promise
      ]);
      guard.clear();
      clearTimeout(timer);
      if (raced && raced.__timeout) {
        lastCode = 'timeout';
        try { controller.abort(); } catch (e) { /* ignore */ }
        stats.failures++;
        continue;
      }
      if (raced && raced.error) {
        var isAbort = raced.error && raced.error.name === 'AbortError';
        lastCode = isAbort ? 'timeout' : 'network';
        stats.failures++;
        continue;
      }
      var res = raced && raced.response;
      if (!res) {
        lastCode = 'network';
        stats.failures++;
        continue;
      }
      if (!res.ok) {
        lastCode = 'http_' + res.status;
        stats.failures++;
        var retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < tries - 1) continue;
        return { ok: false, code: lastCode };
      }
      var json;
      try { json = await res.json(); }
      catch (e) {
        lastCode = 'bad_response_json';
        stats.failures++;
        if (attempt < tries - 1) continue;
        return { ok: false, code: lastCode };
      }
      var content = extractContent(json);
      if (content == null) {
        lastCode = 'bad_response_shape';
        stats.failures++;
        if (attempt < tries - 1) continue;
        return { ok: false, code: lastCode };
      }
      return { ok: true, content: content };
    }
    return { ok: false, code: lastCode };
  }

  async function askJson(system, user, extra) {
    var messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
    var result = await chat(messages, extra && extra.maxTokens);
    if (!result.ok) {
      return invalid(result.code === 'not_configured' ? 'not_configured' : result.code);
    }
    var parsed = score.parseJsonLoose(result.content);
    if (!parsed.ok) return invalid('invalid_format', parsed.error);
    return parsed.value;
  }

  function publicTask(task) {
    var out = {
      id: task.id,
      family: task.family,
      prompt: task.prompt,
      data: task.data
    };
    return out;
  }

  var SYSTEM_A = [
    'You are being evaluated. Answer the question and return ONLY one JSON value.',
    'Do not add explanations, markdown fences or surrounding prose.',
    'Arrays that represent sets may be returned in any order.'
  ].join(' ');

  var SYSTEM_B = [
    'You are playing a deterministic two-player game.',
    'Pick exactly one action from view.legalActions and return ONLY that action as JSON.',
    'Do not invent actions, do not add explanations. Arrays are not involved.'
  ].join(' ');

  var SYSTEM_C = [
    'You are fixing a small JavaScript module so its failing test passes.',
    'Return ONLY JSON of the form {"files":{"<name>":"<full file content>"}}.',
    'Keep the public behaviour intact. Do not edit the test file.'
  ].join(' ');

  return {
    name: 'http',
    // Exposed for tests/diagnostics; contains no secret material.
    stats: function () { return { requests: stats.requests, failures: stats.failures }; },
    configured: configured,
    answer: async function (task) {
      return askJson(SYSTEM_A, JSON.stringify(publicTask(task), null, 2));
    },
    move: async function (view) {
      var value = await askJson(SYSTEM_B, JSON.stringify(view, null, 2));
      if (isInvalid(value)) return value;
      if (value && !Array.isArray(value) && value.action && typeof value.action === 'object') {
        return value.action;
      }
      return value;
    },
    solve: async function (task) {
      var user = JSON.stringify({
        id: task.id,
        prompt: task.prompt,
        testFile: task.testFile,
        test: task.test,
        files: task.files
      }, null, 2);
      var value = await askJson(SYSTEM_C, user, {
        // Suite C returns a complete shared-engine file; the default 4k output
        // cap is too small for hand-eval.js (~1k lines).
        maxTokens: opts.solveMaxTokens || Math.max(maxTokens, 16384)
      });
      if (isInvalid(value)) return value;
      if (!value || typeof value !== 'object') return invalid('invalid_format');
      var files = value.files;
      if (!files) return invalid('invalid_format');
      var normalized = {};
      if (Array.isArray(files)) {
        for (var i = 0; i < files.length; i++) {
          if (files[i] && files[i].path) normalized[files[i].path] = files[i].content;
        }
      } else if (typeof files === 'object') {
        Object.keys(files).forEach(function (k) { normalized[k] = files[k]; });
      }
      if (!Object.keys(normalized).length) return invalid('invalid_format');
      return { files: normalized };
    }
  };
}

module.exports = {
  INVALID: INVALID,
  isInvalid: isInvalid,
  builtin: builtin,
  random: random,
  http: http,
  gomokuResult: gomokuResult,
  chooseTcgAction: chooseTcgAction,
  scoreTcgAction: scoreTcgAction
};
