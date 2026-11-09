'use strict';

module.exports = function run(CORE, params, s) {
  var n = params.n || 3;
  var N = n * n;

  function st(board, status) {
    return { n: n, board: board.slice(), turn: 1, status: status || 'playing' };
  }
  function blank() { return new Array(N).fill(0); }

  s.group('初始状态', function () {
    var g = CORE.newGame();
    s.eq('棋盘大小', g.board.length, N);
    s.eq('全空', g.board.every(function (v) { return v === 0; }), true);
    s.eq('status', CORE.status(g), 'playing');
    s.eq('先手 X', g.turn, 1);
  });

  s.group('胜负判定', function () {
    var b = blank();
    for (var i = 0; i < n - 1; i++) b[i] = 1;
    var r = CORE.act(st(b), n - 1, function () { return 0; });
    s.eq('X 连成一行 status=won', r.state.status, 'won');
    s.eq('棋盘落下 X', r.state.board[n - 1], 1);

    var col = blank();
    for (var r0 = 0; r0 < n - 1; r0++) col[r0 * n] = 1;
    var rc = CORE.act(st(col), (n - 1) * n, function () { return 0; });
    s.eq('X 连成一列 status=won', rc.state.status, 'won');
  });

  s.group('AI 行为', function () {
    var g = CORE.newGame();
    var r = CORE.act(g, Math.floor(N / 2), function () { return 0; });
    s.eq('玩家落子为 X', r.state.board[Math.floor(N / 2)], 1);
    s.eq('AI 落子为 O', r.state.board.filter(function (v) { return v === 2; }).length, 1);
    s.ok('AI 落子只一个 O', r.state.board.filter(function (v) { return v === 2; }).length === 1);

    var b = blank();
    b[0] = 1; b[1] = 1;
    var block = CORE.act(st(b), N - 1, function () { return 0; });
    s.eq('AI 挡住必败点', block.state.board[2], 2);

    if (n === 3) {
      var ob = blank();
      ob[0] = 1; ob[3] = 2; ob[4] = 2;
      var loss = CORE.act(st(ob), 8, function () { return 0; });
      s.eq('AI 连成一线 status=lost', loss.state.status, 'lost');
    }
  });

  s.group('平局与非法落子', function () {
    if (n === 3) {
      var drawBoard = [1, 2, 1, 1, 2, 2, 2, 1, 0];
      var d = CORE.act(st(drawBoard), 8, function () { return 0; });
      s.eq('满盘平局 status=draw', d.state.status, 'draw');
    }
    var g = CORE.newGame();
    var same = CORE.act(g, -1, function () { return 0; });
    s.eq('非法下标 changed=false', same.changed, false);
    var occupied = st([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (N === 9) {
      var again = CORE.act(occupied, 0, function () { return 0; });
      s.eq('已占用格 changed=false', again.changed, false);
    }
  });

  s.group('纯函数', function () {
    var g = CORE.newGame();
    var before = JSON.stringify(g);
    CORE.act(g, 0, function () { return 0; });
    s.eq('act 不修改入参', JSON.stringify(g), before);
  });
};
