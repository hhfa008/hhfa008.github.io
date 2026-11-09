'use strict';

// Mancala (Kalah) engine tests. Run directly:
//   node test.js
// The engine is a plain CommonJS module with no DOM dependency.

var E = require('./engine.js');

var passed = 0;
var failed = 0;
var failures = [];

function show(value) {
  try { return JSON.stringify(value); } catch (err) { return String(value); }
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  failures.push(name + (detail === undefined ? '' : ' — ' + detail));
  console.error('FAIL: ' + name + (detail === undefined ? '' : ' — ' + detail));
}

function eq(name, actual, expected) {
  var same = show(actual) === show(expected);
  check(name, same, same ? undefined : 'got ' + show(actual) + ', expected ' + show(expected));
}

function zeros() {
  var out = [];
  for (var i = 0; i < E.PIT_COUNT; i++) out.push(0);
  return out;
}

function stateWith(pits, stores, turn) {
  return {
    pits: pits.slice(),
    stores: (stores || [0, 0]).slice(),
    turn: turn == null ? 0 : turn,
    over: false,
    winner: null,
    draw: false,
    moves: 0,
    lastMove: null
  };
}

function snapshot(state) {
  return JSON.stringify(state);
}

function group(name) {
  console.log('\n# ' + name);
}

/* ------------------------------------------------------------------ */
group('初始状态与合法走法');

var initial = E.setup();
eq('棋盘有 12 个洞', initial.pits.length, E.PIT_COUNT);
eq('开局每洞 4 颗石子', initial.pits, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
eq('开局总石子为 48', E.totalSeeds(initial), 48);
eq('两个仓库都为空', initial.stores, [0, 0]);
eq('玩家 0 先行', initial.turn, 0);
check('开局尚未结束', !E.isTerminal(initial));
eq('开局合法洞为 0..5', E.legalMoves(initial), [0, 1, 2, 3, 4, 5]);

var initialStatus = E.status(initial);
eq('开局 status 的 over/winner/draw', [initialStatus.over, initialStatus.winner, initialStatus.draw], [false, null, false]);
eq('开局 status 比分', initialStatus.scores, [0, 0]);

var aiFirst = E.setup();
aiFirst.turn = 1;
eq('AI 回合合法洞为 6..11', E.legalMoves(aiFirst), [6, 7, 8, 9, 10, 11]);

var emptyFirst = E.setup();
emptyFirst.pits[0] = 0;
eq('空洞不进入合法走法', E.legalMoves(emptyFirst), [1, 2, 3, 4, 5]);

/* ------------------------------------------------------------------ */
group('播种方向与额外回合');

var afterZero = E.applyMove(initial, 0);
eq('玩家从 0 号洞播种后该洞清空', afterZero.pits[0], 0);
eq('0 号洞的 4 颗依次播到 1..4 号洞', afterZero.pits.slice(1, 5), [5, 5, 5, 5]);
eq('5 号洞没有被播到', afterZero.pits[5], 4);
eq('石子没有进入仓库', afterZero.stores, [0, 0]);
eq('普通走法后轮到 AI', afterZero.turn, 1);
eq('普通走法无额外回合', afterZero.lastMove.extraTurn, false);
eq('普通走法不触发吃子', afterZero.lastMove.capture, 0);
eq('走法后总石子仍为 48', E.totalSeeds(afterZero), 48);

var aiPits = zeros();
aiPits[0] = 1;    // keep player 0's row non-empty
aiPits[11] = 4;
var aiDirection = E.applyMove(stateWith(aiPits, [0, 0], 1), 11);
eq('AI 从 11 号洞向左播到 10..7', aiDirection.pits, [1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
eq('AI 普通走法后轮到玩家', aiDirection.turn, 0);

var extra = E.applyMove(initial, 2);
eq('最后一颗落进自己仓库，获得额外回合', extra.lastMove.extraTurn, true);
eq('额外回合仍由玩家行动', extra.turn, 0);
eq('仓库得到一颗', extra.stores, [1, 0]);
eq('额外回合的 landed 标记为 store', extra.lastMove.landed, 'store');

var skipPits = zeros();
skipPits[0] = 1;
skipPits[6] = 10;  // path crosses opponent store and triggers a capture on pit 9
var skipped = E.applyMove(stateWith(skipPits, [0, 0], 1), 6);
eq('播种会跳过对手仓库', skipped.stores[0], 0);
eq('跳过对手仓库后仍继续播种', skipped.pits, [2, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1]);
eq('该走法在 9 号洞吃子', [skipped.lastMove.capture, skipped.lastMove.capturedPit], [2, 3]);
eq('吃子进入 AI 仓库', skipped.stores[1], 3);

/* ------------------------------------------------------------------ */
group('吃子规则');

var capturePits = zeros();
capturePits[0] = 1;
capturePits[4] = 1;
capturePits[5] = 0;
capturePits[6] = 1;
capturePits[11] = 3;
var captured = E.applyMove(stateWith(capturePits, [0, 0], 0), 4);
eq('最后一颗落进己方空洞触发吃子', captured.lastMove.capture, 4);
eq('吃子目标为对面 11 号洞', captured.lastMove.capturedPit, 11);
eq('己方落点和对面洞都清空', [captured.pits[5], captured.pits[11]], [0, 0]);
eq('最后一颗和对面 3 颗都进己方仓库', captured.stores, [4, 0]);
eq('触发吃子后轮到 AI', captured.turn, 1);
eq('吃子后总石子不变', E.totalSeeds(captured), 6);

var noCapturePits = zeros();
noCapturePits[0] = 1;
noCapturePits[4] = 1;
noCapturePits[6] = 1;
noCapturePits[7] = 1;
var noCapture = E.applyMove(stateWith(noCapturePits, [0, 0], 0), 4);
eq('对面为空时不吃子', noCapture.lastMove.capture, 0);
eq('不吃子时最后一颗留在洞里', noCapture.pits[5], 1);
eq('不吃子时仓库不变', noCapture.stores, [0, 0]);

var occupiedPits = zeros();
occupiedPits[0] = 1;
occupiedPits[4] = 1;
occupiedPits[5] = 2;
occupiedPits[6] = 1;
occupiedPits[11] = 3;
var occupied = E.applyMove(stateWith(occupiedPits, [0, 0], 0), 4);
eq('落点原本不空时不吃子', occupied.lastMove.capture, 0);
eq('落点只是增加一颗', occupied.pits[5], 3);
eq('对面石子原样保留', occupied.pits[11], 3);

var aiCapturePits = zeros();
aiCapturePits[0] = 1;
aiCapturePits[1] = 2;
aiCapturePits[8] = 1;
aiCapturePits[11] = 2;
var aiCapture = E.applyMove(stateWith(aiCapturePits, [0, 0], 1), 8);
eq('AI 也能按对称规则吃子', [aiCapture.lastMove.capture, aiCapture.lastMove.capturedPit], [3, 1]);
eq('AI 吃子进入 AI 仓库', aiCapture.stores, [0, 3]);

/* ------------------------------------------------------------------ */
group('非法操作与不可变性');

var beforeIllegal = snapshot(initial);
eq('负数洞被拒绝', E.applyMove(initial, -1), false);
eq('超过棋盘范围被拒绝', E.applyMove(initial, 12), false);
eq('非整数洞被拒绝', E.applyMove(initial, 1.5), false);
eq('字符串洞被拒绝', E.applyMove(initial, '2'), false);
eq('尝试走对手的洞被拒绝', E.applyMove(initial, 6), false);
eq('空状态被拒绝', E.applyMove(null, 0), false);
eq('空格被拒绝', E.applyMove(emptyFirst, 0), false);
check('所有非法操作都没有修改原状态', snapshot(initial) === beforeIllegal);

var beforeValid = snapshot(initial);
var moved = E.applyMove(initial, 0);
check('applyMove 返回新的状态对象', moved !== initial);
check('applyMove 返回新的 pits 数组', moved.pits !== initial.pits);
check('applyMove 返回新的 stores 数组', moved.stores !== initial.stores);
check('合法走法不修改原状态', snapshot(initial) === beforeValid);

var withHistory = E.applyMove(initial, 0);
var historyBefore = snapshot(withHistory);
var secondMove = E.applyMove(withHistory, 6);
check('连续走法同样不修改输入状态', snapshot(withHistory) === historyBefore);
check('新状态拥有新的 lastMove 对象', secondMove.lastMove !== withHistory.lastMove);

var overState = {
  pits: zeros(),
  stores: [24, 24],
  turn: 0,
  over: true,
  winner: null,
  draw: true,
  moves: 60,
  lastMove: null
};
eq('终局后 legalMoves 为空', E.legalMoves(overState), []);
eq('终局后 applyMove 被拒绝', E.applyMove(overState, 0), false);
eq('终局后 AI 无路可走', E.aiMove(overState, { depth: 5, seed: 1 }), null);

/* ------------------------------------------------------------------ */
group('结束、仓库计分与胜负');

var endPits = zeros();
endPits[4] = 1;
endPits[6] = 10;
endPits[11] = 1;
var aiWin = E.applyMove(stateWith(endPits, [0, 0], 0), 4);
eq('玩家一侧清空后立即结束', aiWin.over, true);
eq('对手剩余 10 颗归入其仓库', aiWin.stores, [2, 10]);
eq('结算后总石子仍为 12', E.totalSeeds(aiWin), 12);
eq('AI 获胜', E.winner(aiWin), 1);
check('终局被识别', E.isTerminal(aiWin));
eq('终局没有合法走法', E.legalMoves(aiWin), []);
eq('终局 status 比分', E.status(aiWin).scores, [2, 10]);
eq('终局 status 非平局', E.status(aiWin).draw, false);
eq('终局记录了被收走的石子', [aiWin.lastMove.collected, aiWin.lastMove.collectedTo], [10, 1]);

var winPits = zeros();
winPits[0] = 1;
winPits[4] = 1;
winPits[11] = 1;
var humanWin = E.applyMove(stateWith(winPits, [0, 0], 0), 4);
eq('对手一侧清空后玩家剩余石子归玩家', humanWin.stores, [3, 0]);
eq('玩家获胜', E.winner(humanWin), 0);
eq('玩家胜利结算收到 1 颗', [humanWin.lastMove.collected, humanWin.lastMove.collectedTo], [1, 0]);

var drawState = {
  pits: zeros(),
  stores: [12, 12],
  turn: 0,
  over: true,
  winner: null,
  draw: true,
  moves: 50,
  lastMove: null
};
eq('仓库相等时判平局', E.status(drawState).draw, true);
eq('平局没有唯一赢家', E.winner(drawState), null);
eq('平局比分保留', E.scores(drawState), [12, 12]);
eq('未结束时 winner 为 null', E.winner(initial), null);
eq('scores 不修改原仓库', (function () {
  var sc = E.scores(initial);
  sc[0] = 99;
  return initial.stores[0];
})(), 0);

/* ------------------------------------------------------------------ */
group('AI 合法性、可复现性与性能保护');

var aiState = E.applyMove(initial, 0); // now AI to move
var aiSnapshot = snapshot(aiState);
var aiPick = E.aiMove(aiState, { seed: 20241110, depth: 5 });
check('AI 返回合法落点', E.legalMoves(aiState).indexOf(aiPick) !== -1, 'move=' + show(aiPick));
check('AI 思考不修改输入状态', snapshot(aiState) === aiSnapshot);

var aiPickAgain = E.aiMove(aiState, { seed: 20241110, depth: 5 });
eq('相同 seed 与深度可复现同一落点', aiPickAgain, aiPick);

var aiPickOtherSeed = E.aiMove(aiState, { seed: 7, depth: 6 });
check('换 seed 后落点仍然合法', E.legalMoves(aiState).indexOf(aiPickOtherSeed) !== -1);
check('高深度被限制在性能保护范围内', aiPickOtherSeed !== null);

var setupAi = E.setup();
setupAi.turn = 1;
var setupAiPick = E.aiMove(setupAi, { seed: 3 });
check('AI 回合只会选自己一侧的洞', setupAiPick >= 6 && setupAiPick <= 11);

var rngA = E.mulberry32(12345);
var rngB = E.mulberry32(12345);
eq('mulberry32 同 seed 输出一致', [rngA(), rngA(), rngA()], [rngB(), rngB(), rngB()]);
check('mulberry32 输出在 [0,1) 内', (function () {
  var rng = E.mulberry32(9);
  for (var i = 0; i < 100; i++) {
    var x = rng();
    if (!(x >= 0 && x < 1)) return false;
  }
  return true;
})());

/* ------------------------------------------------------------------ */
group('30 局 AI 自对弈');

var GAMES = 30;
var MAX_STEPS = 400;
var finished = 0;
var illegal = 0;
var badTotal = 0;
var stuck = 0;
var overCap = 0;
var longest = 0;
var totalSteps = 0;

for (var g = 0; g < GAMES; g++) {
  var game = E.setup();
  var steps = 0;

  while (!game.over && steps < MAX_STEPS) {
    var legal = E.legalMoves(game);
    if (!legal.length) {
      if (!game.over) stuck += 1;
      break;
    }

    var move = E.aiMove(game, {
      seed: 9000 + g * 131 + steps,
      depth: 5,
      maxNodes: 60000
    });

    if (move == null || legal.indexOf(move) === -1) {
      illegal += 1;
      break;
    }

    var next = E.applyMove(game, move);
    if (!next) {
      illegal += 1;
      break;
    }
    if (E.totalSeeds(next) !== 48) {
      badTotal += 1;
      break;
    }

    game = next;
    steps += 1;
  }

  if (steps >= MAX_STEPS) overCap += 1;
  if (game.over) finished += 1;
  if (steps > longest) longest = steps;
  totalSteps += steps;
}

eq('30 局自对弈全部结束', finished, GAMES);
eq('自对弈没有非法动作', illegal, 0);
eq('自对弈过程中石子总数始终为 48', badTotal, 0);
eq('自对弈没有卡死循环', stuck, 0);
eq('没有对局触碰总步数上限', overCap, 0);
check('最长对局低于步数上限', longest < MAX_STEPS, 'longest=' + longest);
console.log('  games=' + GAMES + ', avgSteps=' + (totalSteps / GAMES).toFixed(1) +
  ', longest=' + longest);

/* ------------------------------------------------------------------ */
console.log('\n' + (failed ? failures.join('\n') : 'All checks passed.'));
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
