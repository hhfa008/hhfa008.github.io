'use strict';

// 中心地盘 engine tests. Engine is required directly, not copied.
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-abstract-a-20');

var N = E.CFG.size;

s.group('初始化', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('棋盘格数', g.board.length, N * N);
  s.eq('首手轮到玩家', g.turn, 0);
  s.eq('初始手数为 0', g.moves, 0);
  s.eq('初始未结束', g.over, false);
  s.eq('开局空格数', E.countOf(g.board, -1), E.CFG.mode === 'flip' ? N * N - 4 : N * N);
  s.ok('初始存在合法行动', E.legalMoves(g, 0).length > 0);
  s.ok('引擎导出配置', E.CFG.slug === 'mini-abstract-a-20');
});

  s.group('落子与回合', function () {
    var g = E.createGame({ seed: 2 });
    var mv = E.legalMoves(g, 0)[0];
    E.applyMove(g, mv);
    s.eq('落点变成蓝子', g.board[mv], 0);
    s.eq('回合交给对手', g.turn, 1);
    s.eq('手数加一', g.moves, 1);
    var threw = false;
    try { E.applyMove(g, mv); } catch (e) { threw = true; }
    s.ok('重复落子被拒绝', threw);
    s.ok('对手有合法落点', E.legalMoves(g, 1).length > 0);
  });

  s.group('终局计分', function () {
    var g = E.createGame({ seed: 3 });
    var last = g.board.length - 1;
    for (var i = 0; i < last; i++) g.board[i] = 0;
    g.turn = 0;
    E.applyMove(g, last);
    s.eq('填满立即结束', g.over, true);
    s.eq('全蓝方获胜', E.winnerOf(g), 0);
    var sc = E.score(g);
    s.ok('蓝方分数更高', sc[0] > sc[1]);
    s.ok('分数为非负整数', sc[0] >= 0 && sc[0] % 1 === 0 && sc[1] % 1 === 0);
    var g2 = E.createGame({ seed: 6 });
    s.eq('初始为空盘', E.countOf(g2.board, -1), g2.board.length);
  });

s.group('AI 走子', function () {
  var g = E.createGame({ seed: 7 });
  var mv = E.aiMove(g);
  s.ok('AI 返回合法动作', mv !== null);
  E.applyMove(g, mv);
  s.eq('AI 落子生效', g.board[mv], 0);
  s.eq('AI 行动后交换回合', g.turn, 1);
});

s.group('20 局 AI 自对弈', function () {
  var done = 0, outcomes = { 0: 0, 1: 0, draw: 0 };
  for (var i = 0; i < 20; i++) {
    var r = E.selfPlay(1000 + i * 37);
    var ok = r.game.over === true && (r.winner === 0 || r.winner === 1 || r.winner === 'draw');
    done++;
    if (ok) outcomes[String(r.winner)]++;
    s.ok('第 ' + (i + 1) + ' 局正常结束', ok, r.truncated ? '达到步数上限' : '');
  }
  s.eq('完成 20 局', done, 20);
  s.ok('产生合法结局', outcomes[0] + outcomes[1] + outcomes.draw === 20);
});

s.done();
