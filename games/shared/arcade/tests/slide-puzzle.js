'use strict';

module.exports = function run(CORE, params, s) {
  var n = params.n || 4;
  var N = n * n;

  function st(tiles, blank, moves) {
    return { tiles: tiles.slice(), blank: blank, moves: moves || 0, won: false };
  }
  function solvedTiles() {
    var t = [];
    for (var i = 1; i < N; i++) t.push(i);
    t.push(0);
    return t;
  }

  s.group('初始状态', function () {
    var g = CORE.newGame(function () { return 0.37; });
    s.eq('方块数量', g.tiles.length, N);
    s.eq('空格数量', g.tiles.filter(function (v) { return v === 0; }).length, 1);
    s.eq('步数归零', g.moves, 0);
    var sorted = g.tiles.slice().sort(function (a, b) { return a - b; });
    var ok = sorted.every(function (v, i) { return v === i; });
    s.ok('是 0..N-1 的排列', ok);
    s.ok('初始不是已完成', g.tiles[N - 1] !== 0 || g.tiles[0] !== 1);
    s.eq('未完成 status', CORE.status(g), 'playing');
    var a = CORE.newGame(function () { return 0.2; });
    var b = CORE.newGame(function () { return 0.2; });
    s.eq('固定 rng 初始盘面一致', a.tiles.join(','), b.tiles.join(','));
  });

  s.group('滑动与步数', function () {
    var center = Math.floor(N / 2);
    var tiles = solvedTiles();
    var ci = tiles.indexOf(0);
    tiles[ci] = tiles[center];
    tiles[center] = 0;
    var r = CORE.act(st(tiles, center), 'up');
    s.ok('向上滑动 changed', r.changed === true);
    s.eq('步数 +1', r.state.moves, 1);
    s.eq('空格移动到上方', r.state.blank, center - n);
    s.eq('原空格位置收到上方方块', r.state.tiles[center], tiles[center - n]);

    var boundary = CORE.act(st(solvedTiles(), N - 1), 'down');
    s.ok('边界非法移动 changed=false', boundary.changed === false);
    s.eq('非法移动步数不变', boundary.state.moves, 0);
  });

  s.group('纯函数与完成判定', function () {
    var input = st(solvedTiles(), N - 1);
    var before = input.tiles.join(',');
    CORE.act(input, 'up');
    s.eq('act 不修改入参', input.tiles.join(','), before);

    var donestate = st(solvedTiles(), N - 1);
    s.eq('完成状态 status=won', CORE.status(donestate), 'won');
  });
};
