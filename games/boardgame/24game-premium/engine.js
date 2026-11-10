/*
 * 24 点 · 24 Game Premium — 纯规则引擎（UMD）
 *
 * 浏览器：globalThis.Game24Engine；Node：require('./engine.js')
 *
 * 规则与实现口径
 * --------------
 *  - 每题 4 张牌，点数 1–10（A=1），四种花色；点数值允许重复。
 *  - 玩家用 + − × ÷ 与括号，把四个点数各用一次，凑出精确的 24。
 *  - 全程使用规范化整数分数（有理数）计算，不使用浮点比较。
 *  - 表达式由自写的递归下降解析器解析，绝不使用 eval / Function。
 *  - 除法分母为 0 时拒绝（解析成功、求值报错）。
 *  - 全部题目由精确求解器生成，保证有解；难度按不同规范算式的数量分档：
 *      简单 easy   ≥ 4 种规范解
 *      普通 normal 2–3 种规范解
 *      困难 hard   恰好 1 种规范解
 *    这里“规范解”指把 + / × 的交换律归一、对表达式树去重后的写法。
 *  - 牌组固定 40 张（10 点数 × 4 花色）。任一时刻
 *      state.deck（36 张）+ state.cards（4 张）= 40 张，且 id 唯一。
 *  - applyMove 永远不修改入参：先 clone，再返回新 state；非法动作抛 Error。
 *  - 发牌只用 games/shared/shuffle.js 的 seeded Fisher-Yates，不用 Math.random。
 *
 * 设计约束
 * --------
 *  - 纯函数、无 DOM、无网络、无计时器。计时与持久化由页面负责，
 *    页面把 elapsedMs 随 submit 动作传入，引擎据此计算奖励分。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Game24Engine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('Game24Engine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  var SUITS = Object.freeze([
    Object.freeze({ key: 'spades', symbol: '♠', zh: '黑桃', en: 'Spades', red: false, color: '#1c1a17' }),
    Object.freeze({ key: 'hearts', symbol: '♥', zh: '红桃', en: 'Hearts', red: true, color: '#a13a32' }),
    Object.freeze({ key: 'diamonds', symbol: '♦', zh: '方块', en: 'Diamonds', red: true, color: '#a13a32' }),
    Object.freeze({ key: 'clubs', symbol: '♣', zh: '梅花', en: 'Clubs', red: false, color: '#1c1a17' })
  ]);
  var SUIT_KEYS = SUITS.map(function (s) { return s.key; });
  var SUIT_BY_KEY = {};
  SUITS.forEach(function (s) { SUIT_BY_KEY[s.key] = s; });

  var DECK_SIZE = 40;
  var CARDS_PER_PUZZLE = 4;
  var TARGET = 24;
  var MAX_EXPRESSION_LENGTH = 160;
  var DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
  var DIFFICULTY_BANDS = Object.freeze({
    easy: Object.freeze({ min: 4, max: Infinity, label: '简单', desc: '至少 4 种规范解', base: 80 }),
    normal: Object.freeze({ min: 2, max: 3, label: '普通', desc: '2–3 种规范解', base: 100 }),
    hard: Object.freeze({ min: 1, max: 1, label: '困难', desc: '恰好 1 种规范解', base: 140 })
  });
  // 牌面点阵数量：A/1 一枚，2–10 与点数值相同。整套牌共 220 枚。
  var PIP_COUNTS = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 });
  var STATUSES = Object.freeze(['playing', 'solved', 'revealed', 'skipped']);

  /* ------------------------------------------------------------------ *
   * 基础工具                                                           *
   * ------------------------------------------------------------------ */

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function isDifficulty(value) { return DIFFICULTIES.indexOf(value) !== -1; }

  function assertDifficulty(value) {
    if (!isDifficulty(value)) throw new Error('难度必须是 easy / normal / hard');
    return value;
  }

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      var t = a % b;
      a = b;
      b = t;
    }
    return a || 1;
  }

  function checkInteger(value, label) {
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value) {
      throw new Error((label || '数值') + '必须是整数');
    }
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('数值过大');
    return value;
  }

  /* ------------------------------------------------------------------ *
   * 精确有理数                                                         *
   * ------------------------------------------------------------------ */

  function makeFraction(n, d) {
    checkInteger(n, '分子');
    checkInteger(d, '分母');
    if (d === 0) throw new Error('分母不能为 0');
    if (d < 0) { n = -n; d = -d; }
    var g = gcd(n, d);
    return { n: n / g, d: d / g };
  }

  function fadd(a, b) { return makeFraction(a.n * b.d + b.n * a.d, a.d * b.d); }
  function fsub(a, b) { return makeFraction(a.n * b.d - b.n * a.d, a.d * b.d); }
  function fmul(a, b) { return makeFraction(a.n * b.n, a.d * b.d); }
  function fdiv(a, b) {
    if (b.n === 0) throw new Error('除数不能为 0');
    return makeFraction(a.n * b.d, a.d * b.n);
  }
  function fractionEquals(a, b) { return a.n === b.n && a.d === b.d; }
  function fractionEqualsInt(a, value) { return a.d === 1 && a.n === value; }

  function fractionText(f) {
    if (!f) return '';
    return f.d === 1 ? String(f.n) : (f.n + '/' + f.d);
  }

  /* ------------------------------------------------------------------ *
   * 发牌 / 牌张                                                         *
   * ------------------------------------------------------------------ */

  function cardId(value, suit) { return String(value) + '-' + suit; }

  function makeCard(value, suit) {
    if (VALUES.indexOf(value) === -1) throw new Error('点数必须在 1–10');
    if (SUIT_KEYS.indexOf(suit) === -1) throw new Error('花色非法');
    var meta = SUIT_BY_KEY[suit];
    return {
      id: cardId(value, suit),
      value: value,
      suit: suit,
      suitZh: meta.zh,
      symbol: meta.symbol,
      red: meta.red
    };
  }

  function makeDeck() {
    var deck = [];
    SUITS.forEach(function (suit) {
      VALUES.forEach(function (value) {
        deck.push({
          id: cardId(value, suit.key),
          value: value,
          suit: suit.key,
          suitZh: suit.zh,
          symbol: suit.symbol,
          red: suit.red
        });
      });
    });
    return deck;
  }

  function cardLabel(card) {
    if (!card) return '';
    return (SUIT_BY_KEY[card.suit] ? SUIT_BY_KEY[card.suit].zh : card.suit) + ' ' +
      (card.value === 1 ? 'A(1)' : String(card.value));
  }

  function allCards(state) {
    if (!state || !Array.isArray(state.cards) || !Array.isArray(state.deck)) {
      throw new Error('缺少牌局');
    }
    return state.deck.concat(state.cards);
  }

  function conservationOk(state) {
    try {
      if (!state || !Array.isArray(state.cards) || !Array.isArray(state.deck)) return false;
      if (state.cards.length !== CARDS_PER_PUZZLE) return false;
      if (state.deck.length !== DECK_SIZE - CARDS_PER_PUZZLE) return false;
      var cards = allCards(state);
      if (cards.length !== DECK_SIZE) return false;
      var seen = {};
      var suitsSeen = {};
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (!card || typeof card.id !== 'string') return false;
        if (seen[card.id]) return false;
        seen[card.id] = 1;
        if (VALUES.indexOf(card.value) === -1) return false;
        if (SUIT_KEYS.indexOf(card.suit) === -1) return false;
        suitsSeen[card.suit] = (suitsSeen[card.suit] || 0) + 1;
      }
      for (var s = 0; s < SUIT_KEYS.length; s++) {
        if (suitsSeen[SUIT_KEYS[s]] !== VALUES.length) return false;
        for (var v = 0; v < VALUES.length; v++) {
          if (!seen[cardId(VALUES[v], SUIT_KEYS[s])]) return false;
        }
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * 安全表达式解析器（递归下降，零 eval）                                 *
   * ------------------------------------------------------------------ */

  function syntaxError(message, code) {
    var err = new Error(message);
    err.code = code || 'syntax';
    return err;
  }

  function normalizeCharacters(text) {
    var map = {
      '×': '*', '✕': '*', '÷': '/',
      '−': '-', '–': '-', '—': '-',
      '＋': '+', '－': '-', '＊': '*', '／': '/',
      '（': '(', '）': ')'
    };
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      out += map[ch] || ch;
    }
    return out;
  }

  function tokenize(text) {
    if (typeof text !== 'string') throw syntaxError('算式必须是字符串');
    var source = normalizeCharacters(text);
    if (source.length > MAX_EXPRESSION_LENGTH) throw syntaxError('算式过长');
    var tokens = [];
    var i = 0;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === '.') throw syntaxError('不允许小数');
      if (/[0-9]/.test(ch)) {
        var start = i;
        while (i < source.length && /[0-9]/.test(source.charAt(i))) i += 1;
        if (source.charAt(i) === '.') throw syntaxError('不允许小数');
        var digits = source.slice(start, i);
        if (digits.length > 4) throw syntaxError('数字过大');
        if (digits.length > 1 && digits.charAt(0) === '0') throw syntaxError('数字不能有前导零');
        var value = parseInt(digits, 10);
        if (value > 9999) throw syntaxError('数字过大');
        tokens.push({ type: 'num', value: value, text: digits });
        continue;
      }
      if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
        tokens.push({ type: 'op', value: ch });
        i += 1;
        continue;
      }
      if (ch === '(' || ch === ')') {
        tokens.push({ type: ch });
        i += 1;
        continue;
      }
      throw syntaxError('非法字符“' + ch + '”（只支持数字、+ − × ÷、括号）');
    }
    if (!tokens.length) throw syntaxError('算式不能为空');
    return tokens;
  }

  // expr   := term (('+' | '-') term)*
  // term   := unary (('*' | '/') unary)*
  // unary  := ('+' | '-') unary | primary
  // primary:= INTEGER | '(' expr ')'
  function parseExpression(text) {
    var tokens = tokenize(text);
    var pos = 0;
    var depth = 0;

    function peek() { return tokens[pos] || null; }
    function isOp(token, values) { return token && token.type === 'op' && values.indexOf(token.value) !== -1; }

    function parseExpr() {
      var node = parseTerm();
      while (isOp(peek(), ['+', '-'])) {
        var op = tokens[pos++].value;
        node = { type: 'bin', op: op, left: node, right: parseTerm() };
      }
      return node;
    }

    function parseTerm() {
      var node = parseUnary();
      while (isOp(peek(), ['*', '/'])) {
        var op = tokens[pos++].value;
        node = { type: 'bin', op: op, left: node, right: parseUnary() };
      }
      return node;
    }

    function parseUnary() {
      var token = peek();
      if (isOp(token, ['+', '-'])) {
        pos += 1;
        var child = parseUnary();
        if (token.value === '+') return child;
        return { type: 'neg', child: child };
      }
      return parsePrimary();
    }

    function parsePrimary() {
      var token = peek();
      if (!token) throw syntaxError('算式意外结束');
      if (token.type === 'num') { pos += 1; return { type: 'num', value: token.value }; }
      if (token.type === '(') {
        pos += 1;
        depth += 1;
        if (depth > 32) throw syntaxError('括号嵌套过深');
        var node = parseExpr();
        var close = peek();
        if (!close || close.type !== ')') throw syntaxError('缺少右括号');
        pos += 1;
        depth -= 1;
        return node;
      }
      if (token.type === ')') throw syntaxError('多余的右括号');
      throw syntaxError('运算符位置不对');
    }

    var ast = parseExpr();
    if (pos !== tokens.length) {
      var extra = tokens[pos];
      if (extra && extra.type === ')') throw syntaxError('多余的右括号');
      throw syntaxError('算式尾部有多余内容');
    }
    return ast;
  }

  function evaluateAst(node) {
    if (!node || typeof node !== 'object') throw syntaxError('表达式结构非法');
    if (node.type === 'num') return makeFraction(node.value, 1);
    if (node.type === 'neg') {
      var inner = evaluateAst(node.child);
      return makeFraction(-inner.n, inner.d);
    }
    if (node.type === 'bin') {
      var left = evaluateAst(node.left);
      var right = evaluateAst(node.right);
      if (node.op === '+') return fadd(left, right);
      if (node.op === '-') return fsub(left, right);
      if (node.op === '*') return fmul(left, right);
      if (node.op === '/') return fdiv(left, right);
    }
    throw syntaxError('表达式结构非法');
  }

  function collectValues(node, out) {
    out = out || [];
    if (!node || typeof node !== 'object') throw syntaxError('表达式结构非法');
    if (node.type === 'num') out.push(node.value);
    else if (node.type === 'neg') collectValues(node.child, out);
    else if (node.type === 'bin') {
      collectValues(node.left, out);
      collectValues(node.right, out);
    } else throw syntaxError('表达式结构非法');
    return out;
  }

  function precedenceOf(node) {
    if (!node) return 0;
    if (node.type === 'bin') return (node.op === '+' || node.op === '-') ? 1 : 2;
    if (node.type === 'neg') return 3;
    return 4;
  }

  function printAst(node) {
    if (!node || typeof node !== 'object') throw syntaxError('表达式结构非法');
    if (node.type === 'num') return String(node.value);
    if (node.type === 'neg') {
      var childText = printAst(node.child);
      if (node.child.type === 'bin' || node.child.type === 'neg') childText = '(' + childText + ')';
      return '−' + childText;
    }
    if (node.type === 'bin') {
      var parent = precedenceOf(node);
      var left = printAst(node.left);
      var right = printAst(node.right);
      var leftPrec = precedenceOf(node.left);
      var rightPrec = precedenceOf(node.right);
      if (leftPrec < parent) left = '(' + left + ')';
      if (rightPrec < parent || (rightPrec === parent && (node.op === '-' || node.op === '/'))) {
        right = '(' + right + ')';
      }
      var symbol = node.op === '*' ? '×' : (node.op === '/' ? '÷' : (node.op === '-' ? '−' : '+'));
      return left + symbol + right;
    }
    throw syntaxError('表达式结构非法');
  }

  function evaluateExpressionText(text) {
    var ast = parseExpression(text);
    var value = evaluateAst(ast);
    return { ast: ast, value: value, used: collectValues(ast), pretty: printAst(ast) };
  }

  function multisetEqual(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort(function (p, q) { return p - q; });
    var y = b.slice().sort(function (p, q) { return p - q; });
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function checkAnswer(cards, text) {
    var result = {
      ok: false, valid: false, code: 'syntax', error: null,
      value: null, valueText: '', used: [], pretty: ''
    };
    try {
      if (!Array.isArray(cards) || cards.length !== CARDS_PER_PUZZLE) {
        throw syntaxError('当前题目需要 4 张牌');
      }
      var parsed = evaluateExpressionText(text);
      result.used = parsed.used.slice();
      result.pretty = parsed.pretty;
      var expected = cards.map(function (c) { return c.value; });
      if (!multisetEqual(parsed.used, expected)) {
        throw syntaxError('必须把四张牌的点数各用一次', 'cards');
      }
      result.valid = true;
      result.value = parsed.value;
      result.valueText = fractionText(parsed.value);
      if (!fractionEqualsInt(parsed.value, TARGET)) {
        result.code = 'wrong';
        result.error = '结果是 ' + result.valueText + '，不是 24';
        return result;
      }
      result.ok = true;
      result.code = 'ok';
      result.error = null;
      return result;
    } catch (err) {
      var code = err && err.code ? err.code : 'syntax';
      if (code === 'syntax' && /除数不能为 0/.test(err.message || '')) code = 'zero';
      result.code = code === 'cards' ? 'cards' : (code === 'zero' ? 'zero' : 'syntax');
      result.error = err && err.message ? err.message : String(err);
      return result;
    }
  }

  /* ------------------------------------------------------------------ *
   * 精确求解器                                                         *
   * ------------------------------------------------------------------ */

  var solutionCache = Object.create(null);

  function solutionKey(values) {
    return values.slice().sort(function (a, b) { return a - b; }).join(',');
  }

  function canonicalCombine(op, a, b) {
    if (op === '+' || op === '*') {
      var pair = [a, b].sort();
      return '(' + pair[0] + op + pair[1] + ')';
    }
    return '(' + a + op + b + ')';
  }

  function solveValues(values) {
    if (!Array.isArray(values) || values.length !== CARDS_PER_PUZZLE) {
      throw new Error('求解器需要 4 个点数');
    }
    values.forEach(function (v) {
      if (VALUES.indexOf(v) === -1) throw new Error('点数必须在 1–10');
    });
    var key = solutionKey(values);
    if (solutionCache[key]) return solutionCache[key].slice();

    var items = values.map(function (v) { return { v: makeFraction(v, 1), expr: String(v) }; });
    var found = Object.create(null);

    function walk(list) {
      if (list.length === 1) {
        if (fractionEqualsInt(list[0].v, TARGET)) found[list[0].expr] = true;
        return;
      }
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var a = list[i];
          var b = list[j];
          var rest = [];
          for (var k = 0; k < list.length; k++) {
            if (k !== i && k !== j) rest.push(list[k]);
          }
          var candidates = [
            { v: fadd(a.v, b.v), expr: canonicalCombine('+', a.expr, b.expr) },
            { v: fmul(a.v, b.v), expr: canonicalCombine('*', a.expr, b.expr) },
            { v: fsub(a.v, b.v), expr: '(' + a.expr + '-' + b.expr + ')' },
            { v: fsub(b.v, a.v), expr: '(' + b.expr + '-' + a.expr + ')' }
          ];
          if (b.v.n !== 0) candidates.push({ v: fdiv(a.v, b.v), expr: '(' + a.expr + '/' + b.expr + ')' });
          if (a.v.n !== 0) candidates.push({ v: fdiv(b.v, a.v), expr: '(' + b.expr + '/' + a.expr + ')' });
          for (var c = 0; c < candidates.length; c++) {
            var candidate = candidates[c];
            rest.push({ v: candidate.v, expr: candidate.expr });
            walk(rest);
            rest.pop();
          }
        }
      }
    }

    walk(items);
    var out = Object.keys(found).sort(function (a, b) {
      if (a.length !== b.length) return a.length - b.length;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    solutionCache[key] = out;
    return out.slice();
  }

  function solutionCount(values) { return solveValues(values).length; }

  function prettyFromCanonical(expression) {
    try { return printAst(parseExpression(expression)); }
    catch (err) {
      return String(expression).replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
    }
  }

  function bestSolution(solutions) {
    if (!Array.isArray(solutions) || !solutions.length) return null;
    var best = null;
    var bestPretty = null;
    solutions.forEach(function (canonical) {
      var pretty = prettyFromCanonical(canonical);
      if (best === null || pretty.length < bestPretty.length ||
        (pretty.length === bestPretty.length && pretty < bestPretty)) {
        best = canonical;
        bestPretty = pretty;
      }
    });
    return bestPretty;
  }

  function inBand(count, difficulty) {
    var band = DIFFICULTY_BANDS[difficulty];
    return !!band && count >= band.min && count <= band.max;
  }

  /* ------------------------------------------------------------------ *
   * 题目生成                                                           *
   * ------------------------------------------------------------------ */

  var FALLBACK_VALUES = Object.freeze({
    easy: Object.freeze([1, 2, 3, 4]),
    normal: Object.freeze([1, 1, 4, 4]),
    hard: Object.freeze([1, 1, 1, 8])
  });

  function pickCardsForValues(pool, values) {
    var used = Object.create(null);
    var chosen = [];
    values.forEach(function (value) {
      var found = null;
      for (var i = 0; i < pool.length; i++) {
        var card = pool[i];
        if (card.value === value && !used[card.id]) { found = card; break; }
      }
      if (!found) throw new Error('牌池不足以构造题目');
      used[found.id] = true;
      chosen.push(found);
    });
    return chosen;
  }

  function puzzleWithCards(pool, group, solutions, meta) {
    var used = Object.create(null);
    group.forEach(function (card) { used[card.id] = true; });
    var deck = pool.filter(function (card) { return !used[card.id]; });
    return {
      cards: group.slice(),
      deck: deck,
      solutions: solutions.slice(),
      solutionCount: solutions.length,
      attempt: meta && meta.attempt != null ? meta.attempt : 0,
      groupIndex: meta && meta.groupIndex != null ? meta.groupIndex : 0,
      fallback: !!(meta && meta.fallback)
    };
  }

  function generatePuzzle(seed, difficulty, puzzleIndex) {
    assertDifficulty(difficulty);
    var index = puzzleIndex == null ? 0 : puzzleIndex;
    if (!Number.isInteger(index) || index < 0) throw new Error('题号非法');
    var pool = makeDeck();
    var seedText = String(seed);

    for (var attempt = 0; attempt < 240; attempt++) {
      var shuffled = ShuffleApi.shuffle(pool, { seed: seedText + ':puzzle:' + index + ':attempt:' + attempt });
      for (var group = 0; group < DECK_SIZE / CARDS_PER_PUZZLE; group++) {
        var candidate = shuffled.slice(group * CARDS_PER_PUZZLE, group * CARDS_PER_PUZZLE + CARDS_PER_PUZZLE);
        var values = candidate.map(function (card) { return card.value; });
        var solutions = solveValues(values);
        if (inBand(solutions.length, difficulty)) {
          return puzzleWithCards(pool, candidate, solutions, { attempt: attempt, groupIndex: group, fallback: false });
        }
      }
    }

    // 理论上很难走到这里；仍给一个确定性的、规则正确的兜底题。
    var fallbackValues = FALLBACK_VALUES[difficulty];
    var fallbackGroup = pickCardsForValues(pool, fallbackValues);
    var fallbackSolutions = solveValues(fallbackValues);
    if (!inBand(fallbackSolutions.length, difficulty)) {
      throw new Error('无法生成难度 ' + difficulty + ' 的题目');
    }
    return puzzleWithCards(pool, fallbackGroup, fallbackSolutions, { attempt: -1, groupIndex: -1, fallback: true });
  }

  function dailySeed(date, difficulty) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('日期必须是 YYYY-MM-DD');
    assertDifficulty(difficulty);
    return '24game:daily:' + date + ':' + difficulty;
  }

  /* ------------------------------------------------------------------ *
   * 状态与动作                                                         *
   * ------------------------------------------------------------------ */

  function makeStats() {
    return {
      solved: 0, revealed: 0, skipped: 0, attempts: 0,
      streak: 0, bestStreak: 0, score: 0, puzzles: 1
    };
  }

  function freshState(opts) {
    var o = opts && typeof opts === 'object' ? opts : { seed: opts };
    var mode = o.mode || o.drawMode || 'free';
    if (mode !== 'free' && mode !== 'daily') throw new Error('模式必须是 free 或 daily');
    var difficulty = o.difficulty == null ? 'normal' : assertDifficulty(o.difficulty);
    var date = null;
    var seed;
    if (mode === 'daily') {
      date = o.date == null ? null : String(o.date);
      if (!date) throw new Error('每日挑战需要日期');
      seed = dailySeed(date, difficulty);
    } else if (o.seed != null) {
      seed = o.seed;
    } else {
      seed = '24game:free:1';
    }

    var puzzle = generatePuzzle(seed, difficulty, 0);
    var state = {
      version: VERSION,
      seed: String(seed),
      mode: mode,
      date: date,
      difficulty: difficulty,
      puzzleIndex: 0,
      cards: puzzle.cards,
      deck: puzzle.deck,
      solutions: puzzle.solutions,
      solutionCount: puzzle.solutionCount,
      status: 'playing',
      attempts: [],
      hintsUsed: 0,
      hintText: null,
      revealed: false,
      wrongCount: 0,
      lastFeedback: null,
      result: null,
      stats: makeStats(),
      log: []
    };
    appendLog(state, 'start', (mode === 'daily' ? '每日挑战' : '自由练习') +
      ' · ' + DIFFICULTY_BANDS[difficulty].label + ' · 共 ' + puzzle.solutionCount + ' 种规范解');
    return state;
  }

  function createGame(opts) { return freshState(opts); }
  function newGame(opts) { return freshState(opts); }

  function appendLog(state, type, text) {
    state.log.push({ type: type, text: text, puzzleIndex: state.puzzleIndex });
    if (state.log.length > 160) state.log.splice(0, state.log.length - 160);
  }

  function validateState(state) {
    if (!state || typeof state !== 'object') throw new Error('缺少对局状态');
    if (state.version !== VERSION) throw new Error('版本不匹配');
    if (!Array.isArray(state.cards) || !Array.isArray(state.deck)) throw new Error('牌局缺失');
    if (state.cards.length !== CARDS_PER_PUZZLE) throw new Error('当前题必须是 4 张牌');
    if (state.deck.length !== DECK_SIZE - CARDS_PER_PUZZLE) throw new Error('牌库必须是 36 张牌');
    if (!conservationOk(state)) throw new Error('牌张守恒被破坏');
    if (STATUSES.indexOf(state.status) === -1) throw new Error('状态非法');
    assertDifficulty(state.difficulty);
    if (!Array.isArray(state.solutions) || !state.solutions.length) throw new Error('题目缺少解');
    return state;
  }

  function getLegalMoves(state) {
    if (!state) throw new Error('缺少对局状态');
    if (state.status === 'playing') {
      return [
        { type: 'submit', key: 'submit' },
        { type: 'hint', key: 'hint' },
        { type: 'show-solution', key: 'show-solution' },
        { type: 'skip', key: 'skip' }
      ];
    }
    if (STATUSES.indexOf(state.status) !== -1) return [{ type: 'next', key: 'next' }];
    return [];
  }

  function legalMoves(state) { return getLegalMoves(state); }

  function moveKey(move) {
    if (!move || typeof move !== 'object') return '';
    if (move.type === 'submit') return 'submit:' + String(move.expression == null ? '' : move.expression).trim();
    if (move.type === 'hint') return 'hint';
    if (move.type === 'show-solution') return 'show-solution';
    if (move.type === 'skip') return 'skip';
    if (move.type === 'next') return 'next';
    return 'unknown';
  }

  function elapsedOf(move) {
    var value = Number(move && move.elapsedMs);
    if (!isFinite(value) || value < 0) return 0;
    return Math.min(value, 3600000);
  }

  function scoreForSolve(state, elapsedMs) {
    var base = DIFFICULTY_BANDS[state.difficulty].base;
    var seconds = Math.floor(elapsedMs / 1000);
    var timeBonus = Math.max(0, 60 - seconds) * 2;
    var streak = state.stats.streak + 1;
    var streakBonus = (streak - 1) * 15;
    var hintPenalty = state.hintsUsed * 25;
    return Math.max(10, base + timeBonus + streakBonus - hintPenalty);
  }

  function validateMove(state, move) {
    if (!state) throw new Error('缺少对局状态');
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    if (STATUSES.indexOf(state.status) === -1) throw new Error('对局状态非法');
    if (state.status !== 'playing') {
      if (move.type !== 'next') throw new Error('当前题已结束，只能进入下一题');
      return move;
    }
    if (move.type === 'submit') {
      if (typeof move.expression !== 'string' || !move.expression.trim()) throw new Error('算式不能为空');
      var check = checkAnswer(state.cards, move.expression);
      if (check.code === 'syntax' || check.code === 'cards' || check.code === 'zero') {
        throw new Error(check.error || '算式不合法');
      }
      return move;
    }
    if (move.type === 'hint' || move.type === 'show-solution' || move.type === 'skip') return move;
    throw new Error('未知动作类型');
  }

  function applyMove(state, move) {
    var checked = validateMove(state, move);
    var next = clone(state);
    var check;

    if (checked.type === 'submit') {
      check = checkAnswer(next.cards, checked.expression);
      var elapsedMs = elapsedOf(checked);
      next.attempts.push({
        expression: checked.expression,
        pretty: check.pretty,
        valueText: check.valueText,
        ok: !!check.ok,
        elapsedMs: elapsedMs
      });
      if (next.attempts.length > 40) next.attempts.splice(0, next.attempts.length - 40);
      next.stats.attempts += 1;

      if (check.ok) {
        var earned = scoreForSolve(next, elapsedMs);
        next.status = 'solved';
        next.stats.solved += 1;
        next.stats.streak += 1;
        next.stats.bestStreak = Math.max(next.stats.bestStreak, next.stats.streak);
        next.stats.score += earned;
        next.result = {
          solved: true,
          revealed: false,
          skipped: false,
          expression: checked.expression,
          pretty: check.pretty,
          valueText: '24',
          scoreEarned: earned,
          elapsedMs: elapsedMs,
          streak: next.stats.streak,
          difficulty: next.difficulty,
          puzzleIndex: next.puzzleIndex
        };
        next.lastFeedback = {
          ok: true,
          code: 'ok',
          message: '正确！' + check.pretty + ' = 24，本题 +' + earned + ' 分',
          pretty: check.pretty
        };
        appendLog(next, 'solved', check.pretty + ' = 24，+' + earned + ' 分，连胜 ' + next.stats.streak);
      } else {
        next.wrongCount += 1;
        next.lastFeedback = {
          ok: false,
          code: 'wrong',
          message: '结果是 ' + check.valueText + '，不是 24',
          valueText: check.valueText,
          pretty: check.pretty
        };
        appendLog(next, 'wrong', check.pretty + ' = ' + check.valueText + '，未达 24');
      }
      return next;
    }

    if (checked.type === 'hint') {
      if (!next.hintText) {
        next.hintsUsed += 1;
        next.hintText = bestSolution(next.solutions);
      }
      next.lastFeedback = {
        ok: null,
        code: 'hint',
        message: '提示：' + next.hintText,
        pretty: next.hintText
      };
      appendLog(next, 'hint', '使用提示：' + next.hintText);
      return next;
    }

    if (checked.type === 'show-solution') {
      next.status = 'revealed';
      next.revealed = true;
      next.hintText = bestSolution(next.solutions);
      next.stats.revealed += 1;
      next.stats.streak = 0;
      next.result = {
        solved: false,
        revealed: true,
        skipped: false,
        pretty: next.hintText,
        solutions: next.solutions.slice(),
        scoreEarned: 0,
        elapsedMs: elapsedOf(checked),
        streak: 0,
        difficulty: next.difficulty,
        puzzleIndex: next.puzzleIndex
      };
      next.lastFeedback = {
        ok: false,
        code: 'revealed',
        message: '参考解：' + next.hintText + '（本题不计连胜）',
        pretty: next.hintText
      };
      appendLog(next, 'revealed', '查看参考解：' + next.hintText + '，连胜归零');
      return next;
    }

    if (checked.type === 'skip') {
      next.status = 'skipped';
      next.stats.skipped += 1;
      next.stats.streak = 0;
      next.result = {
        solved: false,
        revealed: false,
        skipped: true,
        pretty: null,
        scoreEarned: 0,
        elapsedMs: elapsedOf(checked),
        streak: 0,
        difficulty: next.difficulty,
        puzzleIndex: next.puzzleIndex
      };
      next.lastFeedback = { ok: false, code: 'skipped', message: '已跳过，连胜归零', pretty: null };
      appendLog(next, 'skipped', '跳过本题');
      return next;
    }

    if (checked.type === 'next') {
      var index = next.puzzleIndex + 1;
      var puzzle = generatePuzzle(next.seed, next.difficulty, index);
      next.puzzleIndex = index;
      next.cards = puzzle.cards;
      next.deck = puzzle.deck;
      next.solutions = puzzle.solutions;
      next.solutionCount = puzzle.solutionCount;
      next.status = 'playing';
      next.attempts = [];
      next.hintsUsed = 0;
      next.hintText = null;
      next.revealed = false;
      next.wrongCount = 0;
      next.lastFeedback = null;
      next.result = null;
      next.stats.puzzles += 1;
      appendLog(next, 'next', '第 ' + (index + 1) + ' 题 · ' + puzzle.solutionCount + ' 种规范解');
      return next;
    }

    throw new Error('未知动作类型');
  }

  function isWon(state) { return !!state && state.status === 'solved'; }
  function isPuzzleOver(state) { return !!state && state.status !== 'playing'; }
  function isGameOver(state) { return isPuzzleOver(state); }

  function score(state) {
    if (!state || !state.stats) throw new Error('缺少对局状态');
    return state.stats.score;
  }

  function hint(state) {
    if (!state || !Array.isArray(state.solutions)) throw new Error('缺少对局状态');
    return bestSolution(state.solutions);
  }

  function result(state) {
    if (!state) return null;
    return state.result ? clone(state.result) : null;
  }

  function serialize(state) {
    validateState(state);
    return JSON.stringify(state);
  }

  function deserialize(text) {
    var parsed;
    try { parsed = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (err) { throw new Error('序列化数据不是合法 JSON'); }
    return validateState(parsed);
  }

  function allSolutionsPretty(solutions) {
    return (solutions || []).map(function (canonical) { return prettyFromCanonical(canonical); });
  }

  return Object.freeze({
    VERSION: VERSION,
    VALUES: VALUES,
    SUITS: SUITS,
    SUIT_KEYS: SUIT_KEYS,
    SUIT_BY_KEY: SUIT_BY_KEY,
    DECK_SIZE: DECK_SIZE,
    CARDS_PER_PUZZLE: CARDS_PER_PUZZLE,
    TARGET: TARGET,
    DIFFICULTIES: DIFFICULTIES,
    DIFFICULTY_BANDS: DIFFICULTY_BANDS,
    PIP_COUNTS: PIP_COUNTS,
    MAX_EXPRESSION_LENGTH: MAX_EXPRESSION_LENGTH,
    makeDeck: makeDeck,
    makeCard: makeCard,
    cardId: cardId,
    cardLabel: cardLabel,
    allCards: allCards,
    conservationOk: conservationOk,
    makeFraction: makeFraction,
    add: fadd,
    sub: fsub,
    mul: fmul,
    div: fdiv,
    fractionEquals: fractionEquals,
    fractionEqualsInt: fractionEqualsInt,
    fractionText: fractionText,
    parseExpression: parseExpression,
    evaluateAst: evaluateAst,
    evaluateExpressionText: evaluateExpressionText,
    collectValues: collectValues,
    printAst: printAst,
    checkAnswer: checkAnswer,
    solveValues: solveValues,
    solutionCount: solutionCount,
    prettyFromCanonical: prettyFromCanonical,
    bestSolution: bestSolution,
    allSolutionsPretty: allSolutionsPretty,
    dailySeed: dailySeed,
    generatePuzzle: generatePuzzle,
    createGame: createGame,
    newGame: newGame,
    validateState: validateState,
    getLegalMoves: getLegalMoves,
    legalMoves: getLegalMoves,
    moveKey: moveKey,
    validateMove: validateMove,
    applyMove: applyMove,
    isWon: isWon,
    isPuzzleOver: isPuzzleOver,
    isGameOver: isGameOver,
    score: score,
    hint: hint,
    result: result,
    serialize: serialize,
    deserialize: deserialize
  });
});
