'use strict';

module.exports = function run(CORE, params, s) {
  var rows = params.rows, cols = params.cols, mines = params.mines;
  var N = rows * cols;

  function blank() {
    return {
      rows: rows, cols: cols, mines: [], revealed: new Array(N).fill(false),
      flags: new Array(N).fill(false), status: 'playing', started: false,
    };
  }
  function preset(mineIdx) {
    var st = blank();
    st.mines = mineIdx.slice();
    st.started = true;
    return st;
  }
  function seq(v) { var i = 0; return function () { return v[Math.min(i++, v.length - 1)]; }; }

  s.group('初始与首翻', function () {
    var g = CORE.newGame();
    s.eq('初始未开始', g.started, false);
    s.eq('初始雷数 0', g.mines.length, 0);
    s.eq('初始 status', CORE.status(g), 'playing');
    s.eq('revealed 长度', g.revealed.length, N);
    s.eq('flags 长度', g.flags.length, N);

    var r = CORE.act(g, { type: 'reveal', index: Math.floor(N / 2) }, seq([0.1]));
    s.ok('首翻 changed', r.changed === true);
    s.eq('首翻后雷数', r.state.mines.length, mines);
    s.ok('首翻点不是雷', r.state.mines.indexOf(Math.floor(N / 2)) < 0);
    s.eq('首翻后已开始', r.state.started, true);
    var safeNeighbors = 0;
    var neighbors = [];
    var cr = Math.floor(Math.floor(N / 2) / cols), cc = Math.floor(N / 2) % cols;
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      var rr = cr + dr, ccc = cc + dc;
      if (rr >= 0 && rr < rows && ccc >= 0 && ccc < cols) neighbors.push(rr * cols + ccc);
    }
    neighbors.forEach(function (i) { if (r.state.mines.indexOf(i) < 0) safeNeighbors++; });
    s.eq('首翻邻格安全', safeNeighbors, neighbors.length);
  });

  s.group('相邻雷数', function () {
    var st = preset([0, 1, cols]);
    s.eq('(1,1) 邻雷数', CORE.adjacent(st, cols + 1), 3);
    s.eq('(2,2) 邻雷数', CORE.adjacent(st, 2 * cols + 2), 0);
    s.eq('(1,2) 邻雷数', CORE.adjacent(st, cols + 2), 1);
  });

  s.group('插旗与胜负', function () {
    var st = preset([0]);
    var f = CORE.act(st, { type: 'flag', index: 5 });
    s.ok('插旗 changed', f.changed === true);
    s.eq('插旗后 flags[5]', f.state.flags[5], true);
    var blocked = CORE.act(f.state, { type: 'reveal', index: 5 }, seq([0]));
    s.ok('插旗格不能翻开', blocked.changed === false);
    var unf = CORE.act(f.state, { type: 'flag', index: 5 });
    s.eq('取消插旗', unf.state.flags[5], false);

    var hit = CORE.act(preset([0]), { type: 'reveal', index: 0 }, seq([0]));
    s.eq('踩雷 status=lost', CORE.status(hit.state), 'lost');

    var win = preset([0]);
    for (var i = 1; i < N; i++) win = CORE.act(win, { type: 'reveal', index: i }, seq([0])).state;
    s.eq('非雷全开 status=won', CORE.status(win), 'won');
  });

  s.group('纯函数', function () {
    var st = preset([0]);
    var before = JSON.stringify(st);
    CORE.act(st, { type: 'reveal', index: 1 }, seq([0]));
    s.eq('act 不修改入参', JSON.stringify(st), before);
  });
};
