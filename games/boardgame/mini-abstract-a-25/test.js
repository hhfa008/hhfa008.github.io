'use strict';

// 斜行决斗 engine tests. Engine is required directly, not copied.
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-abstract-a-25');

var N = E.CFG.size;

s.group('初始化', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('棋盘格数', g.board.length, N * N);
  s.eq('首手轮到玩家', g.turn, 0);
  s.eq('初始手数为 0', g.moves, 0);
  s.eq('初始未结束', g.over, false);
  s.eq('初始双方棋子数', [E.countOf(g.board, 0), E.countOf(g.board, 1)], [E.CFG.pieces, E.CFG.pieces]);
  s.ok('初始存在合法行动', E.legalMoves(g, 0).length > 0);
  s.ok('引擎导出配置', E.CFG.slug === 'mini-abstract-a-25');
});

  s.group('移动合法性', function () {
    var g = E.createGame({ seed: 2 });
    s.ok('初始有合法走法', E.legalMoves(g, 0).length > 0);
    var threw = false;
    try { E.applyMove(g, { from: 0, to: E.CFG.size * E.CFG.size - 1 }); } catch (e) { threw = true; }
    s.ok('远距离移动被拒绝', threw);
    var mv = E.legalMoves(g, 0)[0];
    var before = [E.countOf(g.board, 0), E.countOf(g.board, 1)];
    E.applyMove(g, mv);
    s.eq('起点变空', g.board[mv.from], -1);
    s.eq('终点为己方棋子', g.board[mv.to], 0);
    s.eq('回合交给对手', g.turn, 1);
    s.eq('双方棋子数不变（无吃子）', [E.countOf(g.board, 0), E.countOf(g.board, 1)], before);
  });

  s.group('吃子与终结', function () {
    var g = E.createGame({ seed: 3 });
    g.board = new Array(g.board.length).fill(-1);
    var from = E.idx(2, 2), to = E.idx(2, 3);
    g.board[from] = 0; g.board[to] = 1;
    g.turn = 0;
    E.applyMove(g, { from: from, to: to });
    s.eq('对手棋子被吃', E.countOf(g.board, 1), 0);
    s.eq('吃光对手立即获胜', E.winnerOf(g), 0);
    s.eq('吃子后终点归蓝方', g.board[to], 0);
    var g2 = E.createGame({ seed: 6 });
    s.eq('初始双方棋子数', [E.countOf(g2.board, 0), E.countOf(g2.board, 1)], [E.CFG.pieces, E.CFG.pieces]);
  });

s.group('AI 走子', function () {
  var g = E.createGame({ seed: 7 });
  var mv = E.aiMove(g);
  s.ok('AI 返回合法动作', mv !== null);
  E.applyMove(g, mv);
  s.eq('AI 落子生效', g.board[mv.to], 0);
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
