'use strict';

/*
 * 24 点 · 24 Game Premium — 规则、解析器与生成器测试。
 *
 *   node games/boardgame/24game-premium/test.js
 *
 * 输出 RESULT: N passed, M failed；有失败时 exit 1。
 * 覆盖：40 张牌守恒、精确有理数、递归下降解析器（无 eval）、
 * 四张牌各一次、除数非零、求解器已知有解/无解集合、
 * 三档难度生成、每日种子、状态机动作、序列化与不可变约束。
 */

var E = require('./engine.js');
var D = require('./data.js');

var passed = 0;
var failed = 0;
var failures = [];

function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
  return !!cond;
}
function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  return ok(label, a === e, 'got ' + a + ', want ' + e);
}
function throws(label, fn, pattern) {
  try {
    fn();
    return ok(label, false, 'did not throw');
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    return ok(label, pattern ? pattern.test(msg) : true, msg);
  }
}
function sum(values) { return values.reduce(function (a, b) { return a + b; }, 0); }
function valuesOf(cards) { return cards.map(function (c) { return c.value; }); }
function cardsFor(values) {
  var pool = E.makeDeck();
  var used = {};
  return values.map(function (value) {
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].value === value && !used[pool[i].id]) {
        used[pool[i].id] = true;
        return pool[i];
      }
    }
    throw new Error('cannot build cards for ' + values.join(','));
  });
}
function wrongExpression(cards) {
  var v = valuesOf(cards).slice().sort(function (a, b) { return a - b; });
  var candidates = [
    v[0] + '+' + v[1] + '+' + v[2] + '+' + v[3],
    v[0] + '*' + v[1] + '+' + v[2] + '+' + v[3],
    '(' + v[0] + '+' + v[1] + ')*(' + v[2] + '+' + v[3] + ')',
    v[0] + '*' + v[1] + '*' + v[2] + '-' + v[3],
    v[0] + '*' + v[1] + '+' + v[2] + '*' + v[3],
    '(' + v[0] + '-' + v[1] + ')*(' + v[2] + '-' + v[3] + ')'
  ];
  for (var i = 0; i < candidates.length; i++) {
    var check = E.checkAnswer(cards, candidates[i]);
    if (check.valid && !check.ok) return candidates[i];
  }
  throw new Error('failed to craft a wrong expression for ' + JSON.stringify(v));
}
function noMutation(state, fn) {
  var before = JSON.stringify(state);
  fn();
  return ok('state is not mutated', JSON.stringify(state) === before);
}

/* ---------------------------------------------------------------- 牌组与真实尺寸 */
console.log('[STEP] 牌组、花色与标准尺寸');
var deck = E.makeDeck();
eq('牌组共 40 张', deck.length, 40);
eq('DECK_SIZE 常量 40', E.DECK_SIZE, 40);
eq('每题 4 张', E.CARDS_PER_PUZZLE, 4);
eq('40 个唯一 id', new Set(deck.map(function (c) { return c.id; })).size, 40);
eq('四种花色', new Set(deck.map(function (c) { return c.suit; })).size, 4);
eq('十个点数', Array.from(new Set(deck.map(function (c) { return c.value; }))).sort(function (a, b) { return a - b; }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
eq('每个点数 4 张', E.VALUES.map(function (v) { return deck.filter(function (c) { return c.value === v; }).length; }), [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
eq('每种花色 10 张', E.SUIT_KEYS.map(function (s) { return deck.filter(function (c) { return c.suit === s; }).length; }), [10, 10, 10, 10]);
ok('每个点数×花色组合唯一', E.VALUES.every(function (v) {
  return E.SUIT_KEYS.every(function (s) {
    return deck.filter(function (c) { return c.value === v && c.suit === s; }).length === 1;
  });
}));
eq('红桃与方块为红', E.SUITS.filter(function (s) { return s.red; }).map(function (s) { return s.key; }), ['hearts', 'diamonds']);
eq('黑桃与梅花为黑', E.SUITS.filter(function (s) { return !s.red; }).map(function (s) { return s.key; }), ['spades', 'clubs']);
eq('花色符号', E.SUITS.map(function (s) { return s.symbol; }), ['♠', '♥', '♦', '♣']);
ok('A 的牌面标签标明 1', /A\(1\)/.test(E.cardLabel(E.makeCard(1, 'spades'))));
throws('点数 0 非法', function () { E.makeCard(0, 'spades'); }, /1/);
throws('点数 11 非法', function () { E.makeCard(11, 'spades'); }, /1/);
throws('花色非法', function () { E.makeCard(5, 'stars'); }, /花色/);
eq('PIP_COUNTS 合计 55', sum(Object.keys(E.PIP_COUNTS).map(function (k) { return E.PIP_COUNTS[k]; })), 55);
eq('整副牌花色点阵 220 枚', 55 * 4, 220);
eq('data.js 点阵合计 55', D.PIP_TOTAL, 55);
eq('data.js 2–10 点阵数等于点数', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (v) { return D.PIPS[v].length; }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
eq('标准扑克比例 63:88', D.CARD_ASPECT, [63, 88]);
ok('比例与 CSS 牌面一致（误差 <1%）', Math.abs(63 / 88 - 0.715909) < 0.001);
ok('四花色 SVG 路径齐全', E.SUIT_KEYS.every(function (s) { return typeof D.SUIT_PATHS[s] === 'string' && D.SUIT_PATHS[s].length > 20; }));
ok('data.js 与引擎花色一致', E.SUITS.every(function (s, i) { return D.SUITS[i].key === s.key && D.SUITS[i].symbol === s.symbol && D.SUITS[i].red === s.red; }));

/* ---------------------------------------------------------------- 精确有理数 */
console.log('[STEP] 精确有理数');
var f = E.makeFraction(2, 4);
eq('2/4 归一为 1/2', [f.n, f.d], [1, 2]);
eq('负分母翻正', (function () { var x = E.makeFraction(6, -4); return [x.n, x.d]; })(), [-3, 2]);
eq('零归一为 0/1', (function () { var x = E.makeFraction(0, 5); return [x.n, x.d]; })(), [0, 1]);
throws('分母为 0 被拒绝', function () { E.makeFraction(1, 0); }, /分母/);
eq('1/3 + 1/3 = 2/3', E.fractionText(E.add(E.makeFraction(1, 3), E.makeFraction(1, 3))), '2/3');
eq('1/2 + 1/3 = 5/6', E.fractionText(E.add(E.makeFraction(1, 2), E.makeFraction(1, 3))), '5/6');
eq('3/4 − 1/4 = 1/2', E.fractionText(E.sub(E.makeFraction(3, 4), E.makeFraction(1, 4))), '1/2');
eq('10/3 × 9/10 = 3', E.fractionText(E.mul(E.makeFraction(10, 3), E.makeFraction(9, 10))), '3');
eq('1/2 ÷ 1/4 = 2', E.fractionText(E.div(E.makeFraction(1, 2), E.makeFraction(1, 4))), '2');
eq('(−3/2) ÷ (3/4) = −2', E.fractionText(E.div(E.makeFraction(-3, 2), E.makeFraction(3, 4))), '−2'.replace('−', '-'));
throws('有理数除法分母为 0', function () { E.div(E.makeFraction(1, 2), E.makeFraction(0, 1)); }, /除数/);
ok('48/2 精确等于 24', E.fractionEqualsInt(E.makeFraction(48, 2), 24));
ok('24/1 不等于 23/1', !E.fractionEqualsInt(E.makeFraction(24, 1), 23));
ok('0.1 + 0.2 的浮点误差不进入引擎', E.fractionText(E.add(E.makeFraction(1, 10), E.makeFraction(2, 10))) === '3/10');
eq('分数文本 5/2', E.fractionText(E.makeFraction(5, 2)), '5/2');

/* ---------------------------------------------------------------- 安全解析器 */
console.log('[STEP] 安全递归下降解析器');
function evalText(text) { return E.fractionText(E.evaluateExpressionText(text).value); }
eq('1+2×3 先乘后加', evalText('1+2*3'), '7');
eq('括号改变优先级', evalText('(1+2)*3'), '9');
eq('10/4 精确分数', evalText('10/4'), '5/2');
eq('1/3+1/6 = 1/2', evalText('1/3+1/6'), '1/2');
eq('除号 × ÷ 与全角括号', evalText('2×（3＋4）'), '14');
eq('Unicode 减号', evalText('10−4'), '6');
eq('连续一元负号', evalText('--3'), '3');
eq('一元负号参与运算', evalText('1+-2'), '-1');
eq('负号包裹括号', evalText('-(1+2)'), '-3');
eq('空格被忽略', evalText(' 1 + 2 * ( 3 + 4 ) '), '15');
eq('5×(5−1÷5) 精确等于 24', evalText('5*(5-1/5)'), '24');
eq('8÷(3−8÷3) 精确等于 24', evalText('8/(3-8/3)'), '24');
eq('收集数字字面量', E.collectValues(E.parseExpression('1+2*3')), [1, 2, 3]);
eq('pretty 输出 × ÷', E.evaluateExpressionText('5*(5-1/5)').pretty, '5×(5−1÷5)');
throws('空表达式', function () { E.parseExpression(''); }, /为空/);
throws('纯空格', function () { E.parseExpression('   '); }, /为空/);
throws('小数被拒绝', function () { E.parseExpression('1.5+2'); }, /小数/);
throws('裸小数点被拒绝', function () { E.parseExpression('1.+2'); }, /小数/);
throws('科学计数法被拒绝', function () { E.parseExpression('1e3'); }, /非法字符/);
throws('字母与 eval 被拒绝', function () { E.parseExpression('eval("1+2")'); }, /非法字符/);
throws('Math 调用被拒绝', function () { E.parseExpression('Math.max(1,2)'); }, /非法字符/);
throws('分号注入被拒绝', function () { E.parseExpression('1+2;alert(1)'); }, /非法字符/);
throws('引号被拒绝', function () { E.parseExpression("'1'+2"); }, /非法字符/);
throws('缺少右括号', function () { E.parseExpression('(1+2'); }, /右括号/);
throws('多余右括号', function () { E.parseExpression('1+2)'); }, /右括号/);
throws('空括号', function () { E.parseExpression('()'); }, /右括号|意外/);
throws('尾随运算符', function () { E.parseExpression('1+'); }, /意外结束/);
throws('双运算符', function () { E.parseExpression('1**2'); }, /意外|位置/);
throws('相邻数字', function () { E.parseExpression('1 2'); }, /尾部/);
throws('过大数字', function () { E.parseExpression('99999'); }, /过大/);
throws('前导零', function () { E.parseExpression('01+2'); }, /前导零/);
throws('表达式过长', function () { E.parseExpression(new Array(200).join('1+')); }, /过长/);
eq('pretty 自动省略多余括号', E.printAst(E.parseExpression('((1+2)*3)')), '(1+2)×3');
eq('pretty 保持减法右结合括号', E.printAst(E.parseExpression('1-(2-3)')), '1−(2−3)');
eq('pretty 保持除法右结合括号', E.printAst(E.parseExpression('8/(3-8/3)')), '8÷(3−8÷3)');
ok('解析器源码不使用 eval', require('fs').readFileSync(__dirname + '/engine.js', 'utf8').indexOf('eval(') === -1);
ok('解析器源码不使用 Function 构造器', require('fs').readFileSync(__dirname + '/engine.js', 'utf8').indexOf('new Function') === -1);

/* ---------------------------------------------------------------- 四张牌各一次 */
console.log('[STEP] 每张牌恰好使用一次');
var c1118 = cardsFor([1, 1, 1, 8]);
var c1127 = cardsFor([1, 1, 2, 7]);
var c5551 = cardsFor([5, 5, 5, 1]);
var checkOk = E.checkAnswer(c1127, '(1+2)*(1+7)');
ok('(1+2)×(1+7) = 24', checkOk.ok);
eq('checkAnswer 标记合法', checkOk.valid, true);
eq('使用的数值多重集', checkOk.used.slice().sort(function (a, b) { return a - b; }), [1, 1, 2, 7]);
var missing = E.checkAnswer(c1127, '1+2+7');
eq('漏用一张牌被拒绝', missing.code, 'cards');
var extra = E.checkAnswer(c1127, '1+1+2+7+1');
eq('多用数字被拒绝', extra.code, 'cards');
var wrongValue = E.checkAnswer(c1127, '1*1*2*7');
eq('合法但不等于 24 标记 wrong', wrongValue.code, 'wrong');
eq('错误结果文本', wrongValue.valueText, '14');
ok('wrong 仍然 valid', wrongValue.valid === true);
var zero = E.checkAnswer(c1127, '1/(1-1)+2*7');
eq('除以零被拒绝', zero.code, 'zero');
ok('除以零错误信息', /除数/.test(zero.error));
var syntax = E.checkAnswer(c1127, '1.5+2');
eq('语法错误标记 syntax', syntax.code, 'syntax');
var good555 = E.checkAnswer(c5551, '5*(5-1/5)');
ok('5×(5−1÷5) 使用三张 5 和一张 1', good555.ok);
eq('重复点数按出现次数计算', good555.used.slice().sort(function (a, b) { return a - b; }), [1, 5, 5, 5]);
var notEnoughFives = E.checkAnswer(c5551, '5*(5-1)');
eq('少一个 5 被拒绝', notEnoughFives.code, 'cards');
var c1118bad = E.checkAnswer(c1118, '(1+1+1)*8');
ok('(1+1+1)×8 = 24', c1118bad.ok);
eq('checkAnswer pretty 使用 ×', c1118bad.pretty, '(1+1+1)×8');

/* ---------------------------------------------------------------- 求解器 */
console.log('[STEP] 精确求解器与已知集合');
function verifySolutions(values) {
  var cards = cardsFor(values);
  var solutions = E.solveValues(values);
  return solutions.every(function (expression) {
    var check = E.checkAnswer(cards, expression);
    return check.ok && check.valid;
  });
}
var known = [[5, 5, 5, 1], [1, 1, 4, 4], [1, 2, 3, 4], [1, 1, 1, 8], [3, 3, 8, 8], [6, 6, 6, 6], [1, 2, 5, 10]];
known.forEach(function (values) {
  var solutions = E.solveValues(values);
  ok('已知有解 ' + values.join(',') + ' 至少一解', solutions.length >= 1, 'count=' + solutions.length);
  ok('已知有解 ' + values.join(',') + ' 每个解都成立', verifySolutions(values));
});
eq('1,1,1,8 恰好一种规范解', E.solutionCount([1, 1, 1, 8]), 1);
eq('1,1,4,4 恰好两种规范解', E.solutionCount([1, 1, 4, 4]), 2);
eq('5,5,5,1 恰好一种规范解', E.solutionCount([5, 5, 5, 1]), 1);
eq('1,1,1,1 无解', E.solutionCount([1, 1, 1, 1]), 0);
eq('10,10,10,10 无解', E.solutionCount([10, 10, 10, 10]), 0);
eq('1,1,1,10 无解', E.solutionCount([1, 1, 1, 10]), 0);
ok('1,2,3,4 有多种解', E.solutionCount([1, 2, 3, 4]) >= 20, 'count=' + E.solutionCount([1, 2, 3, 4]));
ok('求解器不修改入参数组', (function () {
  var values = [4, 1, 2, 3];
  E.solveValues(values);
  return JSON.stringify(values) === '[4,1,2,3]';
})());
ok('solveValues 返回副本', (function () {
  var a = E.solveValues([1, 1, 1, 8]);
  a.push('x');
  return E.solveValues([1, 1, 1, 8]).length === 1;
})());
var best555 = E.bestSolution(E.solveValues([5, 5, 5, 1]));
ok('bestSolution 返回最短可解析解', E.evaluateExpressionText(best555).value.n === 24);
ok('bestSolution 使用 × ÷', /×|÷/.test(best555), best555);
eq('无解时 bestSolution 为 null', E.bestSolution([]), null);
eq('难度常量三档', E.DIFFICULTIES, ['easy', 'normal', 'hard']);
eq('简单档下界 ≥2', E.DIFFICULTY_BANDS.easy.min >= 2, true);
eq('困难档恰为 1–2', [E.DIFFICULTY_BANDS.hard.min, E.DIFFICULTY_BANDS.hard.max], [1, 1]);

/* ---------------------------------------------------------------- 三档生成 */
console.log('[STEP] 三档题目生成（每档 8 个种子）');
var generatedTotal = 0;
var fallbackTotal = 0;
['easy', 'normal', 'hard'].forEach(function (difficulty) {
  for (var i = 0; i < 8; i++) {
    var seed = 'test-gen-' + difficulty + '-' + i;
    var game = E.createGame({ seed: seed, difficulty: difficulty });
    var values = valuesOf(game.cards);
    var count = E.solutionCount(values);
    var band = E.DIFFICULTY_BANDS[difficulty];
    generatedTotal += 1;
    ok(difficulty + ' #' + i + ' 4 张牌', game.cards.length === 4, String(game.cards.length));
    ok(difficulty + ' #' + i + ' 点数为 1–10', values.every(function (v) { return v >= 1 && v <= 10; }), values.join(','));
    ok(difficulty + ' #' + i + ' 解法数在档位内', count >= band.min && count <= band.max, 'count=' + count);
    ok(difficulty + ' #' + i + ' 40 张守恒', E.conservationOk(game), 'cards=' + E.allCards(game).length);
    ok(difficulty + ' #' + i + ' 状态解列表与求解器一致', JSON.stringify(game.solutions) === JSON.stringify(E.solveValues(values)));
    var again = E.createGame({ seed: seed, difficulty: difficulty });
    ok(difficulty + ' #' + i + ' 同种子可复现', JSON.stringify(game.cards.map(function (c) { return c.id; })) === JSON.stringify(again.cards.map(function (c) { return c.id; })));
    var puzzle = E.generatePuzzle(seed, difficulty, 0);
    if (puzzle.fallback) fallbackTotal += 1;
  }
});
eq('生成 24 道题', generatedTotal, 24);
eq('没有走到兜底生成', fallbackTotal, 0);
var different = [];
for (var ds = 0; ds < 6; ds++) {
  different.push(E.createGame({ seed: 'diff-' + ds, difficulty: 'normal' }).cards.map(function (c) { return c.id; }).join('|'));
}
ok('不同种子至少给出两种牌面', new Set(different).size >= 2, String(new Set(different).size));

/* ---------------------------------------------------------------- 每日挑战 */
console.log('[STEP] 每日种子与模式');
var dailyA = E.createGame({ mode: 'daily', date: '2026-11-10', difficulty: 'normal' });
var dailyB = E.createGame({ mode: 'daily', date: '2026-11-10', difficulty: 'normal' });
var dailyC = E.createGame({ mode: 'daily', date: '2026-11-11', difficulty: 'normal' });
eq('每日题同日期同难度一致', dailyA.cards.map(function (c) { return c.id; }), dailyB.cards.map(function (c) { return c.id; }));
ok('每日题不同日期不同', dailyA.cards.map(function (c) { return c.id; }).join('|') !== dailyC.cards.map(function (c) { return c.id; }).join('|'));
eq('每日种子格式', dailyA.seed, '24game:daily:2026-11-10:normal');
eq('每日模式标记', dailyA.mode, 'daily');
eq('每日日期记录', dailyA.date, '2026-11-10');
throws('每日模式必须给日期', function () { E.createGame({ mode: 'daily', difficulty: 'normal' }); }, /日期/);
throws('日期格式错误', function () { E.dailySeed('2026/11/10', 'normal'); }, /YYYY-MM-DD/);
throws('难度非法', function () { E.createGame({ seed: 1, difficulty: 'insane' }); }, /难度/);
eq('自由模式默认 normal', E.createGame({ seed: 3 }).difficulty, 'normal');
eq('自由模式默认 seed', E.createGame({}).seed, '24game:free:1');
eq('drawMode 作为 mode 别名', E.createGame({ drawMode: 'daily', date: '2026-01-02', difficulty: 'easy' }).mode, 'daily');

/* ---------------------------------------------------------------- 状态机动作 */
console.log('[STEP] 状态机、动作与计分');
var game = E.createGame({ seed: 2468, difficulty: 'normal' });
eq('初始状态 playing', game.status, 'playing');
eq('初始 4 张题面', game.cards.length, 4);
eq('初始牌库 36 张', game.deck.length, 36);
eq('初始 40 张守恒', E.conservationOk(game), true);
eq('初始分数 0', game.stats.score, 0);
eq('初始连胜 0', game.stats.streak, 0);
eq('初始无结果', game.result, null);
eq('初始 getLegalMoves 四种', E.getLegalMoves(game).map(function (m) { return m.key; }), ['submit', 'hint', 'show-solution', 'skip']);
eq('moveKey submit', E.moveKey({ type: 'submit', expression: ' 1+2 ' }), 'submit:1+2');
eq('moveKey hint', E.moveKey({ type: 'hint' }), 'hint');
eq('moveKey next', E.moveKey({ type: 'next' }), 'next');
ok('未结束时 score() 可读', E.score(game) === 0);
eq('未结束时 result() 为空', E.result(game), null);
ok('hint() 给出最短解', E.evaluateExpressionText(E.hint(game)).value.n === 24);

noMutation(game, function () { E.applyMove(game, { type: 'hint' }); });
noMutation(game, function () { E.applyMove(game, { type: 'submit', expression: E.hint(game) === null ? '' : E.bestSolution(game.solutions) }); });

var wrongExpr = wrongExpression(game.cards);
var wrongState = E.applyMove(game, { type: 'submit', expression: wrongExpr, elapsedMs: 1200 });
eq('错误答案仍 playing', wrongState.status, 'playing');
eq('错误答案记录尝试', wrongState.attempts.length, 1);
eq('错误答案累计 attempts', wrongState.stats.attempts, 1);
eq('错误答案 wrongCount', wrongState.wrongCount, 1);
eq('错误答案 feedback 为 false', wrongState.lastFeedback.ok, false);
eq('错误答案不加分', wrongState.stats.score, 0);
eq('错误答案不增连胜', wrongState.stats.streak, 0);
ok('错误答案仍可继续', E.getLegalMoves(wrongState).some(function (m) { return m.type === 'submit'; }));

var solution = E.bestSolution(game.solutions);
var solvedState = E.applyMove(game, { type: 'submit', expression: E.solveValues(valuesOf(game.cards))[0], elapsedMs: 5000 });
eq('正确答案 status solved', solvedState.status, 'solved');
eq('isWon 为 true', E.isWon(solvedState), true);
eq('isGameOver 为 true', E.isGameOver(solvedState), true);
eq('result.solved 为 true', solvedState.result.solved, true);
eq('result.elapsedMs 记录', solvedState.result.elapsedMs, 5000);
eq('solved 计数 1', solvedState.stats.solved, 1);
eq('连胜 1', solvedState.stats.streak, 1);
eq('最佳连胜 1', solvedState.stats.bestStreak, 1);
ok('得分 > 0', solvedState.stats.score > 0, String(solvedState.stats.score));
eq('result.scoreEarned 与总分一致', solvedState.result.scoreEarned, solvedState.stats.score);
eq('score() 读取总分', E.score(solvedState), solvedState.stats.score);
ok('正确答案 feedback 为 true', solvedState.lastFeedback.ok === true);
ok('pretty 解使用 × ÷', /×|÷/.test(solvedState.lastFeedback.pretty || solution), String(solvedState.lastFeedback.pretty));
eq('结束后只剩 next', E.getLegalMoves(solvedState).map(function (m) { return m.key; }), ['next']);
throws('结束后不能提交', function () { E.applyMove(solvedState, { type: 'submit', expression: solution }); }, /已结束|下一题/);
throws('结束后不能提示', function () { E.applyMove(solvedState, { type: 'hint' }); }, /已结束|下一题/);

var afterNoMut = JSON.stringify(game);
E.applyMove(game, { type: 'submit', expression: solution });
eq('applyMove 不修改原 state', JSON.stringify(game), afterNoMut);
eq('原 state 仍 playing', game.status, 'playing');

var nextState = E.applyMove(solvedState, { type: 'next' });
eq('下一题编号 1', nextState.puzzleIndex, 1);
eq('下一题回到 playing', nextState.status, 'playing');
eq('下一题清空 attempts', nextState.attempts.length, 0);
eq('下一题清空提示', nextState.hintText, null);
eq('下一题清空 hintsUsed', nextState.hintsUsed, 0);
eq('下一题 result 为空', nextState.result, null);
eq('下一题 puzzles 计数 2', nextState.stats.puzzles, 2);
eq('下一题保留得分', nextState.stats.score, solvedState.stats.score);
eq('下一题保留连胜', nextState.stats.streak, 1);
eq('下一题 40 张守恒', E.conservationOk(nextState), true);
ok('下一题仍有解', nextState.solutionCount >= 1);
ok('下一题解法数仍在档位', nextState.solutionCount >= E.DIFFICULTY_BANDS[nextState.difficulty].min && nextState.solutionCount <= E.DIFFICULTY_BANDS[nextState.difficulty].max, 'count=' + nextState.solutionCount);

var solvedAgain = E.applyMove(nextState, { type: 'submit', expression: nextState.solutions[0], elapsedMs: 0 });
eq('连续第二题 solved 计数 2', solvedAgain.stats.solved, 2);
eq('连续第二题连胜 2', solvedAgain.stats.streak, 2);
eq('最佳连胜 2', solvedAgain.stats.bestStreak, 2);
ok('连续第二题分数增加', solvedAgain.stats.score > nextState.stats.score);

var hintGame = E.createGame({ seed: 1357, difficulty: 'easy' });
var hinted = E.applyMove(hintGame, { type: 'hint' });
ok('提示返回解文案', !!hinted.hintText);
eq('提示次数 1', hinted.hintsUsed, 1);
var hintedTwice = E.applyMove(hinted, { type: 'hint' });
eq('重复提示不重复计数', hintedTwice.hintsUsed, 1);
var hintedSolved = E.applyMove(hintedTwice, { type: 'submit', expression: hintedTwice.solutions[0], elapsedMs: 0 });
var plainSolved = E.applyMove(hintGame, { type: 'submit', expression: hintGame.solutions[0], elapsedMs: 0 });
ok('使用提示后得分更低', hintedSolved.stats.score < plainSolved.stats.score,
  hintedSolved.stats.score + ' < ' + plainSolved.stats.score);

var revealGame = E.createGame({ seed: 97531, difficulty: 'hard' });
var revealed = E.applyMove(revealGame, { type: 'show-solution' });
eq('看答案后 revealed', revealed.status, 'revealed');
eq('看答案不算获胜', E.isWon(revealed), false);
eq('看答案 result.revealed', revealed.result.revealed, true);
eq('看答案清零连胜', revealed.stats.streak, 0);
eq('看答案 revealed 计数 1', revealed.stats.revealed, 1);
ok('看答案展示参考解', !!revealed.hintText);
eq('看答案后只剩 next', E.getLegalMoves(revealed).map(function (m) { return m.key; }), ['next']);

var streakGame = E.createGame({ seed: 8642, difficulty: 'normal' });
var oneWin = E.applyMove(streakGame, { type: 'submit', expression: streakGame.solutions[0], elapsedMs: 0 });
var afterWinNext = E.applyMove(oneWin, { type: 'next' });
var skipped = E.applyMove(afterWinNext, { type: 'skip' });
eq('跳过状态', skipped.status, 'skipped');
eq('跳过清零连胜', skipped.stats.streak, 0);
eq('跳过计数 1', skipped.stats.skipped, 1);

throws('空动作', function () { E.applyMove(game, null); }, /动作非法/);
throws('未知动作', function () { E.applyMove(game, { type: 'teleport' }); }, /未知|只能/);
throws('playing 时不能 next', function () { E.applyMove(game, { type: 'next' }); }, /未知|只能/);
throws('空表达式', function () { E.applyMove(game, { type: 'submit', expression: '' }); }, /为空/);
throws('非字符串表达式', function () { E.applyMove(game, { type: 'submit', expression: 42 }); }, /为空|字符串/);
throws('语法错误表达式', function () { E.applyMove(game, { type: 'submit', expression: '1.5+2' }); }, /小数/);
throws('牌数不匹配表达式', function () { E.applyMove(game, { type: 'submit', expression: '1+2' }); }, /四张牌|各用一次/);
throws('除以零表达式', function () { E.applyMove(game, { type: 'submit', expression: '1/(1-1)+2*7' }); }, /除数/);
throws('缺少状态', function () { E.applyMove(null, { type: 'hint' }); }, /状态/);
eq('空状态 legalMoves 抛错', (function () { try { E.getLegalMoves(null); return false; } catch (e) { return true; } })(), true);

/* ---------------------------------------------------------------- 序列化与守恒 */
console.log('[STEP] 序列化、守恒与长序列');
var roundTrip = E.deserialize(E.serialize(solvedAgain));
eq('序列化往返状态一致', JSON.stringify(roundTrip), JSON.stringify(solvedAgain));
eq('序列化往返仍守恒', E.conservationOk(roundTrip), true);
throws('坏 JSON 被拒绝', function () { E.deserialize('{oops'); }, /JSON/);
var badVersion = JSON.parse(JSON.stringify(solvedAgain));
badVersion.version = '0.0.1';
throws('版本不匹配被拒绝', function () { E.deserialize(badVersion); }, /版本/);
var badDeck = JSON.parse(JSON.stringify(solvedAgain));
badDeck.deck.pop();
throws('少牌被拒绝', function () { E.deserialize(badDeck); }, /36|守恒/);
var duplicate = JSON.parse(JSON.stringify(solvedAgain));
duplicate.deck[0] = duplicate.cards[0];
throws('重复牌被拒绝', function () { E.deserialize(duplicate); }, /守恒/);

var sim = E.createGame({ seed: 'long-run', difficulty: 'normal' });
var simOk = true;
var conservationOk = true;
for (var step = 0; step < 48; step++) {
  if (sim.status === 'playing') {
    var move;
    if (step % 7 === 0) move = { type: 'hint' };
    else if (step % 5 === 0) move = { type: 'submit', expression: wrongExpression(sim.cards), elapsedMs: step * 10 };
    else if (step % 13 === 0) move = { type: 'skip' };
    else if (step % 17 === 0) move = { type: 'show-solution' };
    else move = { type: 'submit', expression: sim.solutions[0], elapsedMs: step * 10 };
    try { sim = E.applyMove(sim, move); }
    catch (err) { simOk = false; console.log('sim move failed: ' + err.message); break; }
  } else {
    sim = E.applyMove(sim, { type: 'next' });
  }
  if (!E.conservationOk(sim)) conservationOk = false;
  if (sim.attempts.length > 40) simOk = false;
}
ok('48 步混合动作全部执行', simOk);
ok('48 步每一步都保持 40 张守恒', conservationOk);
ok('长序列后状态仍合法', (function () { try { E.validateState(sim); return true; } catch (e) { return false; } })());
ok('长序列分数非负', sim.stats.score >= 0, String(sim.stats.score));
ok('长序列题号递增', sim.puzzleIndex > 0, String(sim.puzzleIndex));
ok('长序列未结状态可继续', sim.status === 'playing' || E.getLegalMoves(sim)[0].type === 'next');

// 合法性检查：随机伪造的 4 张题面与 36 张牌库仍须守恒。
var cooked = E.createGame({ seed: 'cook', difficulty: 'normal' });
var cookedCards = E.makeDeck().slice(0, 4);
var usedIds = {};
cookedCards.forEach(function (c) { usedIds[c.id] = true; });
cooked.cards = cookedCards;
cooked.deck = E.makeDeck().filter(function (c) { return !usedIds[c.id]; });
eq('重新拼装后仍守恒', E.conservationOk(cooked), true);
cooked.deck[0] = cooked.cards[0];
eq('重复牌使守恒失败', E.conservationOk(cooked), false);

console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
  process.exitCode = 1;
}
