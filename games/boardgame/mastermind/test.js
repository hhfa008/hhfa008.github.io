'use strict';

/*
 * 珠玑妙算（Mastermind）引擎测试。
 *
 * 直接 require 同源 engine.js，测试页面实际运行的规则，不复制实现。
 * 运行：node games/boardgame/mastermind/test.js
 */

var E = require('./engine.js');

var passed = 0;
var failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('FAIL: ' + label + (detail ? ' — ' + detail : ''));
  }
}

function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  ok(label, a === b, 'expected ' + b + ', got ' + a);
}

function scoreCase(label, secret, guess, black, white) {
  var result = E.score(secret, guess);
  ok(label, result.black === black && result.white === white,
    'expected ' + black + '黑' + white + '白, got ' + result.black + '黑' + result.white + '白');
}

function isCode(value) {
  return E.isValidGuess(value);
}

function countBlackWhite(secret, history) {
  return history.every(function (entry) {
    var s = E.score(secret, entry.guess);
    return s.black === entry.black && s.white === entry.white;
  });
}

/* ------------------------------------------------------------------ */
/* 1. 常量                                                             */
/* ------------------------------------------------------------------ */

eq('COLORS 有 6 种颜色', E.COLORS.length, 6);
ok('COLORS 全部是唯一字符串', new Set(E.COLORS).size === 6 &&
  E.COLORS.every(function (color) { return typeof color === 'string' && color.length > 0; }));
eq('CODE_LEN 为 4', E.CODE_LEN, 4);
eq('MAX_GUESSES 为 10', E.MAX_GUESSES, 10);

/* ------------------------------------------------------------------ */
/* 2. 密码生成与合法性                                                  */
/* ------------------------------------------------------------------ */

var secretA = E.createSecret(E.mulberry32(42));
var secretB = E.createSecret(E.mulberry32(42));
ok('createSecret 生成合法 4 位密码', isCode(secretA));
eq('createSecret 对同一 seed 可复现', secretA, secretB);
ok('createSecret 默认无参数也可用', isCode(E.createSecret()));

ok('合法猜测被接受', E.isValidGuess(['R', 'R', 'G', 'G']));
ok('重复颜色合法', E.isValidGuess(['O', 'O', 'O', 'O']));
ok('拒绝长度不足', !E.isValidGuess(['R', 'G', 'B']));
ok('拒绝长度超出', !E.isValidGuess(['R', 'G', 'B', 'Y', 'O']));
ok('拒绝未知颜色', !E.isValidGuess(['R', 'G', 'B', 'X']));
ok('拒绝 null', !E.isValidGuess(null));
ok('拒绝字符串', !E.isValidGuess('RGGB'));
ok('拒绝混入数字', !E.isValidGuess(['R', 'G', 'B', 3]));

/* ------------------------------------------------------------------ */
/* 3. score 黑白计分（含重复颜色）                                      */
/* ------------------------------------------------------------------ */

scoreCase('全中为 4 黑 0 白', ['R', 'Y', 'G', 'B'], ['R', 'Y', 'G', 'B'], 4, 0);
scoreCase('完全无关为 0 黑 0 白', ['R', 'Y', 'G', 'B'], ['P', 'P', 'P', 'P'], 0, 0);
scoreCase('颜色全对且完全错位为 0 黑 4 白', ['R', 'Y', 'G', 'B'], ['Y', 'B', 'R', 'G'], 0, 4);
scoreCase('三黑零白', ['R', 'Y', 'G', 'B'], ['R', 'Y', 'G', 'P'], 3, 0);
scoreCase('两黑一白', ['R', 'Y', 'G', 'B'], ['R', 'G', 'P', 'B'], 2, 1);
scoreCase('重复颜色只按数量计黑', ['R', 'R', 'R', 'R'], ['R', 'R', 'Y', 'G'], 2, 0);
scoreCase('重复颜色黑与白混合', ['R', 'R', 'G', 'G'], ['R', 'G', 'R', 'G'], 2, 2);
scoreCase('重复颜色完全错位为 0 黑 4 白', ['R', 'R', 'G', 'G'], ['G', 'G', 'R', 'R'], 0, 4);
scoreCase('重复颜色不会多算白', ['R', 'R', 'R', 'R'], ['R', 'R', 'Y', 'Y'], 2, 0);
scoreCase('同色猜测被有限数量限制', ['R', 'R', 'G', 'G'], ['G', 'G', 'G', 'G'], 2, 0);
scoreCase('精确重复密码为 4 黑', ['P', 'P', 'G', 'G'], ['P', 'P', 'G', 'G'], 4, 0);

var invalidScore1 = E.score(null, ['R', 'R', 'R', 'R']);
ok('非法 secret 的 score 不崩溃且标记无效', invalidScore1.valid === false &&
  invalidScore1.black === 0 && invalidScore1.white === 0);
var invalidScore2 = E.score(['R', 'Y', 'G', 'B'], ['X', 'Y', 'G', 'B']);
ok('非法 guess 的 score 不崩溃且标记无效', invalidScore2.valid === false);
var invalidScore3 = E.score(undefined, undefined);
ok('两个参数都非法也不崩溃', invalidScore3.valid === false);

var beforeSecret = secretA.slice();
var beforeGuess = ['R', 'Y', 'G', 'B'];
E.score(beforeSecret, beforeGuess);
eq('score 不修改 secret', beforeSecret, secretA);
eq('score 不修改 guess', beforeGuess, ['R', 'Y', 'G', 'B']);

/* ------------------------------------------------------------------ */
/* 4. newGame 与 submitGuess                                           */
/* ------------------------------------------------------------------ */

var game = E.newGame(12345);
ok('newGame 生成合法密码', isCode(game.secret));
eq('newGame 同 seed 密码可复现', game.secret, E.createSecret(E.mulberry32(12345)));
ok('newGame 初始状态正确', game.status === 'playing' && game.attempts === 0 &&
  game.remaining === 10 && game.history.length === 0 && game.ok === true);
ok('newGame 接受字符串 seed', isCode(E.newGame('mastermind').secret));

var firstGuess = ['R', 'R', 'Y', 'Y'];
var afterFirst = E.submitGuess(game, firstGuess);
ok('合法提交被接受', afterFirst.ok === true);
eq('提交后历史长度为 1', afterFirst.history.length, 1);
eq('提交后剩余 9 次', afterFirst.remaining, 9);
eq('提交后 attempts 为 1', afterFirst.attempts, 1);
eq('历史记录保留猜测', afterFirst.history[0].guess, firstGuess);
ok('历史记录的黑白与 score 一致',
  afterFirst.history[0].black === E.score(game.secret, firstGuess).black &&
  afterFirst.history[0].white === E.score(game.secret, firstGuess).white);
eq('submitGuess 不修改原 state.history', game.history.length, 0);
eq('submitGuess 不修改原 state.attempts', game.attempts, 0);

var shortGuess = E.submitGuess(game, ['R', 'G', 'B']);
ok('非法猜测被拒绝', shortGuess.ok === false && typeof shortGuess.lastError === 'string');
eq('非法猜测不消耗次数', shortGuess.remaining, 10);
eq('非法猜测不写入历史', shortGuess.history.length, 0);
ok('非法 state 不崩溃', E.submitGuess(null, firstGuess).ok === false &&
  E.submitGuess({}, firstGuess).ok === false);
var malformedState = {
  seed: 1,
  secret: ['R', 'Y', 'G', 'B'],
  history: [null, {}, { guess: ['X'], black: 1, white: 0 }],
  status: 'playing'
};
var afterMalformed = E.submitGuess(malformedState, ['Y', 'Y', 'Y', 'Y']);
ok('state.history 含畸形条目时不崩溃', afterMalformed.ok === true && afterMalformed.history.length === 1);

var winState = E.newGame(777);
var winResult = E.submitGuess(winState, winState.secret.slice());
ok('猜中后获胜', winResult.ok === true && winResult.won === true && winResult.status === 'won');
eq('获胜后剩余次数不增加', winResult.remaining, 9);
var afterWin = E.submitGuess(winResult, ['R', 'R', 'R', 'R']);
ok('获胜后不能继续提交', afterWin.ok === false && afterWin.status === 'won');

var lossState = E.newGame(1);
var wrong = E.score(lossState.secret, ['R', 'R', 'R', 'R']).black === 4
  ? ['G', 'G', 'G', 'G']
  : ['R', 'R', 'R', 'R'];
var current = lossState;
for (var i = 0; i < E.MAX_GUESSES; i++) {
  current = E.submitGuess(current, wrong);
  ok('第 ' + (i + 1) + ' 次错误提交仍被接受', current.ok === true);
}
ok('十次错误后失败', current.status === 'lost' && current.lost === true && current.won === false);
eq('失败后剩余次数为 0', current.remaining, 0);
eq('失败后历史长度为 10', current.history.length, 10);
ok('失败后所有历史反馈正确', countBlackWhite(lossState.secret, current.history));
var afterLoss = E.submitGuess(current, ['R', 'R', 'R', 'R']);
ok('失败后第 11 次提交被拒绝', afterLoss.ok === false && afterLoss.lastError);
eq('失败后历史仍是 10 条', afterLoss.history.length, 10);
ok('剩余次数不会为负', afterLoss.remaining === 0);

/* ------------------------------------------------------------------ */
/* 5. AI 猜测与解题                                                    */
/* ------------------------------------------------------------------ */

var emptyGuess = E.aiGuess([], E.mulberry32(5));
ok('AI 无历史时返回合法猜测', isCode(emptyGuess));
var legalAcrossSeeds = true;
for (var s = 0; s < 20; s++) {
  if (!isCode(E.aiGuess(null, E.mulberry32(s)))) legalAcrossSeeds = false;
}
ok('AI 在不同 seed 下始终返回合法猜测', legalAcrossSeeds);

var aiSecret = ['R', 'Y', 'G', 'B'];
var probe = ['R', 'R', 'Y', 'Y'];
var probeScore = E.score(aiSecret, probe);
var aiHistory = [{ guess: probe, black: probeScore.black, white: probeScore.white }];
var aiReply = E.aiGuess(aiHistory, E.mulberry32(99));
ok('AI 带历史时返回合法猜测', isCode(aiReply));
var filteredReply = E.aiGuess(aiHistory, E.mulberry32(99));
var replyScore = E.score(filteredReply, probe);
ok('AI 猜测与已有黑白历史一致',
  replyScore.black === probeScore.black && replyScore.white === probeScore.white);

var malformed = [
  null,
  {},
  { guess: ['X', 'Y', 'G', 'B'], black: 1, white: 0 },
  { guess: ['R', 'Y', 'G', 'B'], black: 'oops', white: 0 }
];
ok('AI 面对畸形历史不崩溃且仍合法', isCode(E.aiGuess(malformed, E.mulberry32(3))));
var contradictory = [{ guess: ['R', 'R', 'R', 'R'], black: 2, white: 2 }];
ok('AI 面对矛盾历史不崩溃且仍合法', isCode(E.aiGuess(contradictory, E.mulberry32(4))));
ok('AI 面对非数组历史不崩溃', isCode(E.aiGuess('not-a-history', E.mulberry32(6))));

var solveCases = [
  ['R', 'R', 'G', 'G'],
  ['R', 'Y', 'G', 'B'],
  ['P', 'P', 'P', 'P'],
  ['O', 'B', 'Y', 'R'],
  ['G', 'G', 'G', 'R']
];
solveCases.forEach(function (secret, index) {
  var result = E.aiSolve(secret, E.mulberry32(1000 + index));
  ok('AI 在 10 次内解出固定密码 ' + secret.join(''), result.solved === true && result.attempts <= 10,
    'attempts=' + result.attempts);
  ok('AI 解 ' + secret.join('') + ' 的每一步都合法', result.guesses.every(isCode));
  ok('AI 解 ' + secret.join('') + ' 的历史反馈真实', countBlackWhite(secret, result.history));
});

var repeatOne = E.aiSolve(['O', 'B', 'Y', 'R'], E.mulberry32(2026));
var repeatTwo = E.aiSolve(['O', 'B', 'Y', 'R'], E.mulberry32(2026));
eq('aiSolve 对同一 seed 可复现', repeatOne.guesses, repeatTwo.guesses);
var invalidSolve = E.aiSolve(['X', 'Y', 'G', 'B'], E.mulberry32(1));
ok('aiSolve 非法密码不崩溃', invalidSolve.solved === false && typeof invalidSolve.error === 'string');

/* ------------------------------------------------------------------ */
/* 6. 30 局 AI vs AI 自对弈                                            */
/* ------------------------------------------------------------------ */

var started = Date.now();
var selfPlaySolved = true;
var selfPlayLegal = true;
var selfPlayTerminated = true;
var selfPlayConsistent = true;
var selfPlayNoEmpty = true;
var failures = [];

for (var seed = 1; seed <= 30; seed++) {
  var secret = E.createSecret(E.mulberry32(seed));
  var outcome = E.aiSolve(secret, E.mulberry32(seed * 7919 + 13));
  var legal = outcome.guesses.every(isCode);
  var consistent = countBlackWhite(secret, outcome.history);
  var terminated = outcome.attempts > 0 && outcome.attempts <= E.MAX_GUESSES;
  if (!outcome.solved) { selfPlaySolved = false; failures.push(seed + ':未解出'); }
  if (!legal) { selfPlayLegal = false; failures.push(seed + ':非法猜测'); }
  if (!terminated) { selfPlayTerminated = false; failures.push(seed + ':步数 ' + outcome.attempts); }
  if (!consistent) { selfPlayConsistent = false; failures.push(seed + ':反馈不一致'); }
  if (outcome.guesses.length !== outcome.history.length) {
    selfPlayNoEmpty = false;
    failures.push(seed + ':步数记录不一致');
  }
}
var elapsed = Date.now() - started;
ok('30 局自对弈全部解出', selfPlaySolved, failures.slice(0, 3).join('; '));
ok('30 局自对弈没有非法猜测', selfPlayLegal, failures.slice(0, 3).join('; '));
ok('30 局自对弈全部在 10 次内结束', selfPlayTerminated, failures.slice(0, 3).join('; '));
ok('30 局自对弈历史反馈与真实密码一致', selfPlayConsistent, failures.slice(0, 3).join('; '));
ok('30 局自对弈步数与历史长度一致', selfPlayNoEmpty, failures.slice(0, 3).join('; '));
ok('30 局自对弈在 5 秒内完成', elapsed < 5000, 'elapsed=' + elapsed + 'ms');

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed > 0 ? 1 : 0;
