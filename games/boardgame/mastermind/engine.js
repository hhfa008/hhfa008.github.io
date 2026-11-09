/*
 * 珠玑妙算 Mastermind 纯规则引擎 — UMD
 *
 * 浏览器：页面先加载 engine.js，使用 globalThis.MastermindEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM，任何函数都不会崩溃在非法输入上。
 *   - 所有随机性来自注入的 RNG（mulberry32），默认使用 Date.now() 播种。
 *   - 密码与猜测都是长度为 CODE_LEN 的颜色数组，颜色取值为 COLORS 中的字符串。
 *   - 允许重复颜色；黑白提示按多重集（multiset）匹配，不重复计数。
 *   - submitGuess 不修改传入的 state，返回新的 state。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MastermindEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = Object.freeze(['R', 'Y', 'G', 'B', 'P', 'O']);
  var CODE_LEN = 4;
  var MAX_GUESSES = 10;

  var COLOR_INDEX = Object.create(null);
  for (var ci = 0; ci < COLORS.length; ci++) COLOR_INDEX[COLORS[ci]] = ci;

  /* ------------------------------------------------------------------ */
  /* 随机数                                                              */
  /* ------------------------------------------------------------------ */

  function normalizeSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
    if (typeof seed === 'string') {
      var hash = 2166136261;
      for (var i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }
    return Date.now() >>> 0;
  }

  // mulberry32：小巧、可复现、足够均匀的 32 位 PRNG。
  function mulberry32(seed) {
    var a = normalizeSeed(seed);
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomInt(rng, n) {
    if (n <= 0) return 0;
    var value = Number(rng());
    if (!isFinite(value)) value = 0;
    var index = Math.floor(value * n);
    if (index < 0) index = 0;
    if (index >= n) index = n - 1;
    return index;
  }

  /* ------------------------------------------------------------------ */
  /* 基础校验与计分                                                      */
  /* ------------------------------------------------------------------ */

  function isValidGuess(guess) {
    if (!Array.isArray(guess) || guess.length !== CODE_LEN) return false;
    for (var i = 0; i < CODE_LEN; i++) {
      if (typeof guess[i] !== 'string' || !(guess[i] in COLOR_INDEX)) return false;
    }
    return true;
  }

  // 内部快速计分，返回 (black << 4) | white；调用前必须已校验。
  function scoreInt(secret, guess) {
    var black = 0;
    var secretCounts = [0, 0, 0, 0, 0, 0];
    var guessCounts = [0, 0, 0, 0, 0, 0];

    for (var i = 0; i < CODE_LEN; i++) {
      var s = secret[i];
      var g = guess[i];
      if (s === g) {
        black++;
      } else {
        secretCounts[COLOR_INDEX[s]]++;
        guessCounts[COLOR_INDEX[g]]++;
      }
    }

    var white = 0;
    for (var c = 0; c < COLORS.length; c++) {
      white += Math.min(secretCounts[c], guessCounts[c]);
    }
    return (black << 4) | white;
  }

  function score(secret, guess) {
    if (!isValidGuess(secret) || !isValidGuess(guess)) {
      return { black: 0, white: 0, valid: false, error: '密码或猜测不合法' };
    }
    var packed = scoreInt(secret, guess);
    return { black: packed >> 4, white: packed & 15 };
  }

  /* ------------------------------------------------------------------ */
  /* 新局与提交                                                          */
  /* ------------------------------------------------------------------ */

  function createSecret(rng) {
    var random = typeof rng === 'function' ? rng : mulberry32(Date.now());
    var secret = [];
    for (var i = 0; i < CODE_LEN; i++) {
      secret.push(COLORS[randomInt(random, COLORS.length)]);
    }
    return secret;
  }

  function newGame(seed) {
    var actualSeed = (seed === undefined || seed === null) ? (Date.now() >>> 0) : normalizeSeed(seed);
    var secret = createSecret(mulberry32(actualSeed));
    var history = [];
    return {
      seed: actualSeed,
      secret: secret,
      history: history,
      guesses: history,
      attempts: 0,
      remaining: MAX_GUESSES,
      maxGuesses: MAX_GUESSES,
      status: 'playing',
      won: false,
      lost: false,
      ok: true,
      lastError: null,
      lastScore: null
    };
  }

  function copyHistory(history) {
    var clean = [];
    if (!Array.isArray(history)) return clean;
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (!entry || !isValidGuess(entry.guess)) continue;
      var black = Number(entry.black);
      var white = Number(entry.white);
      if (!Number.isInteger(black) || !Number.isInteger(white)) continue;
      if (black < 0 || white < 0 || black + white > CODE_LEN) continue;
      clean.push({ guess: entry.guess.slice(), black: black, white: white });
    }
    return clean;
  }

  function copyState(state) {
    var history = copyHistory(state.history);
    return {
      seed: state.seed,
      secret: state.secret.slice(),
      history: history,
      guesses: history,
      attempts: history.length,
      remaining: Math.max(0, MAX_GUESSES - history.length),
      maxGuesses: MAX_GUESSES,
      status: state.status,
      won: state.status === 'won',
      lost: state.status === 'lost',
      ok: false,
      lastError: null,
      lastScore: null
    };
  }

  function rejectState(state, message) {
    var next;
    if (state && Array.isArray(state.history) && Array.isArray(state.secret)) {
      next = copyState(state);
    } else {
      next = {
        seed: null,
        secret: [],
        history: [],
        guesses: [],
        attempts: 0,
        remaining: 0,
        maxGuesses: MAX_GUESSES,
        status: 'invalid',
        won: false,
        lost: false,
        ok: false,
        lastError: null,
        lastScore: null
      };
    }
    next.ok = false;
    next.lastError = message;
    next.error = message;
    return next;
  }

  function submitGuess(state, guess) {
    if (!state || typeof state !== 'object' || !isValidGuess(state.secret) || !Array.isArray(state.history)) {
      return rejectState(state, '游戏状态不合法');
    }
    if (state.status !== 'playing') {
      return rejectState(state, '本局已经结束，请重新开始');
    }
    if (state.history.length >= MAX_GUESSES) {
      return rejectState(state, '已经没有剩余次数');
    }
    if (!isValidGuess(guess)) {
      return rejectState(state, '猜测必须是 4 个合法颜色');
    }

    var scored = score(state.secret, guess);
    var history = copyHistory(state.history);
    history.push({
      guess: guess.slice(),
      black: scored.black,
      white: scored.white
    });

    var attempts = history.length;
    var status = 'playing';
    if (scored.black === CODE_LEN) status = 'won';
    else if (attempts >= MAX_GUESSES) status = 'lost';

    return {
      seed: state.seed,
      secret: state.secret.slice(),
      history: history,
      guesses: history,
      attempts: attempts,
      remaining: Math.max(0, MAX_GUESSES - attempts),
      maxGuesses: MAX_GUESSES,
      status: status,
      won: status === 'won',
      lost: status === 'lost',
      ok: true,
      lastError: null,
      error: null,
      lastGuess: guess.slice(),
      lastScore: { black: scored.black, white: scored.white, valid: true }
    };
  }

  /* ------------------------------------------------------------------ */
  /* AI 解题器                                                           */
  /* ------------------------------------------------------------------ */

  // 全部 6^4 = 1296 个可能密码；候选过滤与极小化选择都基于它。
  var UNIVERSE = (function () {
    var codes = [];
    for (var a = 0; a < COLORS.length; a++) {
      for (var b = 0; b < COLORS.length; b++) {
        for (var c = 0; c < COLORS.length; c++) {
          for (var d = 0; d < COLORS.length; d++) {
            codes.push([COLORS[a], COLORS[b], COLORS[c], COLORS[d]]);
          }
        }
      }
    }
    return codes;
  })();

  function normalizeHistory(history) {
    var clean = [];
    if (!Array.isArray(history)) return clean;
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (!entry || !isValidGuess(entry.guess)) continue;
      var black = Number(entry.black);
      var white = Number(entry.white);
      if (!Number.isInteger(black) || !Number.isInteger(white)) continue;
      if (black < 0 || white < 0 || black + white > CODE_LEN) continue;
      if (black === CODE_LEN && white !== 0) continue;
      clean.push({ guess: entry.guess.slice(), black: black, white: white });
    }
    return clean;
  }

  function filterCandidates(history) {
    var candidates = UNIVERSE;
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      var expected = (entry.black << 4) | entry.white;
      candidates = candidates.filter(function (code) {
        return scoreInt(code, entry.guess) === expected;
      });
    }
    return candidates;
  }

  // 在候选集中挑一个能尽量均匀切分剩余可能性的猜测。
  // 只考虑候选猜测可以显著降低计算量；对 4 位 6 色足够在 10 步内解出。
  function chooseGuess(candidates, rng) {
    if (candidates.length === 1) return candidates[0].slice();

    var bestWorst = Infinity;
    var bestSquares = Infinity;
    var tied = [];

    for (var gi = 0; gi < candidates.length; gi++) {
      var guess = candidates[gi];
      var buckets = new Array(128);
      for (var k = 0; k < 128; k++) buckets[k] = 0;
      for (var si = 0; si < candidates.length; si++) {
        buckets[scoreInt(candidates[si], guess)]++;
      }
      var worst = 0;
      var squares = 0;
      for (var key = 0; key < 128; key++) {
        var count = buckets[key];
        if (count === 0) continue;
        if (count > worst) worst = count;
        squares += count * count;
      }
      if (worst < bestWorst || (worst === bestWorst && squares < bestSquares)) {
        bestWorst = worst;
        bestSquares = squares;
        tied = [guess];
      } else if (worst === bestWorst && squares === bestSquares) {
        tied.push(guess);
      }
    }

    if (tied.length === 0) return candidates[randomInt(rng, candidates.length)].slice();
    return tied[randomInt(rng, tied.length)].slice();
  }

  function aiGuess(history, rng) {
    var random = typeof rng === 'function' ? rng : mulberry32(Date.now());
    var clean = normalizeHistory(history);

    // 开局用 0011 模式：首轮即可区分“位置对”和“仅颜色对”。
    if (clean.length === 0) return [COLORS[0], COLORS[0], COLORS[1], COLORS[1]];

    var candidates = filterCandidates(clean);
    // 历史自相矛盾（或全部条目非法）时，仍返回一个合法猜测而不是崩溃。
    if (candidates.length === 0) return [COLORS[0], COLORS[0], COLORS[1], COLORS[1]];
    return chooseGuess(candidates, random);
  }

  function aiSolve(secret, rng) {
    var random = typeof rng === 'function' ? rng : mulberry32(Date.now());
    var result = {
      solved: false,
      won: false,
      secret: null,
      guesses: [],
      history: [],
      attempts: 0,
      maxGuesses: MAX_GUESSES,
      error: null
    };
    if (!isValidGuess(secret)) {
      result.error = '密码不合法';
      return result;
    }

    var workSecret = secret.slice();
    var history = [];
    for (var turn = 0; turn < MAX_GUESSES; turn++) {
      var guess = aiGuess(history, random);
      if (!isValidGuess(guess)) guess = [COLORS[0], COLORS[0], COLORS[1], COLORS[1]];
      var scored = score(workSecret, guess);
      history.push({
        guess: guess.slice(),
        black: scored.black,
        white: scored.white
      });
      if (scored.black === CODE_LEN) {
        result.solved = true;
        result.won = true;
        break;
      }
    }

    result.secret = workSecret;
    result.history = history;
    result.guesses = history.map(function (entry) { return entry.guess.slice(); });
    result.attempts = history.length;
    return result;
  }

  return {
    COLORS: COLORS,
    CODE_LEN: CODE_LEN,
    MAX_GUESSES: MAX_GUESSES,
    mulberry32: mulberry32,
    normalizeSeed: normalizeSeed,
    createSecret: createSecret,
    score: score,
    isValidGuess: isValidGuess,
    newGame: newGame,
    submitGuess: submitGuess,
    aiGuess: aiGuess,
    aiSolve: aiSolve
  };
});
