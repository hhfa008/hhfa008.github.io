'use strict';

// 2048 家族共享测试：对任意 n 的参数化实现做规则断言。
module.exports = function run(CORE, params, s) {
  var n = params.n || 4;
  var N = n * n;

  function st(cells, score) {
    var b = new Array(N).fill(0);
    Object.keys(cells || {}).forEach(function (k) { b[+k] = cells[k]; });
    return { board: b, score: score || 0, moves: 0, won: false, over: false };
  }
  function row(b, r) { return b.slice(r * n, r * n + n).join(','); }
  function col(b, c) {
    var out = [];
    for (var r = 0; r < n; r++) out.push(b[r * n + c]);
    return out.join(',');
  }
  function seq(values) {
    var i = 0;
    return function () { return values[Math.min(i++, values.length - 1)]; };
  }
  function fillRow(v) {
    var cells = {};
    for (var i = 0; i < n; i++) cells[i] = v;
    return cells;
  }

  s.group('初始状态', function () {
    var g = CORE.newGame(seq([0, 0]));
    s.eq('棋盘长度', g.board.length, N);
    s.eq('初始 2 块', g.board.filter(function (v) { return v !== 0; }).length, 2);
    s.eq('初始 score', g.score, 0);
    s.eq('初始 moves', g.moves, 0);
    s.eq('初始 status', CORE.status(g), 'playing');
    var same = CORE.newGame(seq([0.3, 0.3]));
    s.eq('固定 rng 初始盘面一致', CORE.newGame(seq([0.3, 0.3])).board.join(','), same.board.join(','));
  });

  s.group('左移合并', function () {
    var r = CORE.act(st({ 0: 2, 1: 2 }), 'left', seq([0, 0]));
    s.eq('[2,2] 左移首格', r.state.board[0], 4);
    s.eq('得分 4', r.gained, 4);
    s.eq('总分 4', r.state.score, 4);
    s.ok('changed', r.changed === true);
    s.eq('新块在首个空格', r.state.board[1], 2);

    if (n >= 4) {
      r = CORE.act(st({ 0: 2, 1: 2, 2: 2, 3: 2 }), 'left', seq([0, 0]));
      s.eq('[2,2,2,2] 不连锁', row(r.state.board, 0), ('4,4,2' + ',0'.repeat(n - 3)));
      s.eq('[2,2,2,2] 得分 8', r.gained, 8);
    } else {
      r = CORE.act(st(fillRow(2)), 'left', seq([0, 0]));
      s.eq('整行 2 左移', row(r.state.board, 0).split(',')[0], '4');
      s.ok('整行合并得分 > 0', r.gained > 0);
    }

    r = CORE.act(st({ 1: 2, [n - 1]: 2 }), 'left', seq([0, 0]));
    s.eq('[0,2,0,2] 左移', r.state.board[0], 4);
  });

  s.group('其他方向', function () {
    var r = CORE.act(st({ 0: 2, 1: 2 }), 'right', seq([0, 0]));
    s.eq('右移末格', r.state.board[n - 1], 4);

    r = CORE.act(st({ 0: 2, [n]: 2 }), 'up', seq([0, 0]));
    s.eq('上移首行', r.state.board[0], 4);

    r = CORE.act(st({ [N - 1]: 4, [N - 1 - n]: 4 }), 'down', seq([0, 0]));
    s.eq('下移末行', r.state.board[N - 1], 8);
  });

  s.group('无效移动与纯函数', function () {
    var input = st({ 0: 2, 1: 2 });
    var before = input.board.join(',');
    CORE.act(input, 'left', seq([0, 0]));
    s.eq('act 不修改入参', input.board.join(','), before);

    var dead = {};
    for (var r0 = 0; r0 < n; r0++) {
      for (var c0 = 0; c0 < n; c0++) dead[r0 * n + c0] = (r0 + c0) % 2 === 0 ? 2 : 4;
    }
    var r = CORE.act(st(dead), 'left', seq([0, 0]));
    s.ok('死局 changed=false', r.changed === false);
    s.eq('死局 gained=0', r.gained, 0);
    s.eq('死局 status=lost', CORE.status(st(dead)), 'lost');
  });

  s.group('随机与胜利', function () {
    var hi = CORE.newGame(seq([0.95, 0.95]));
    s.ok('rng 高值出 4', hi.board.some(function (v) { return v === 4; }));

    var cells = { 0: 1024, 1: 1024 };
    var r = CORE.act(st(cells), 'left', seq([0.95, 0.95]));
    s.ok('合出 2048', r.state.board.indexOf(2048) !== -1);
    s.eq('胜利 status', CORE.status(r.state), 'won');
  });
};
