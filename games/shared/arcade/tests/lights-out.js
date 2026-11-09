'use strict';

module.exports = function run(CORE, params, s) {
  var n = params.n || 3;
  var N = n * n;

  function off() { return new Array(N).fill(0); }
  function st(lights, moves) {
    return { lights: (lights || off()).slice(), moves: moves || 0, won: false };
  }

  s.group('初始状态', function () {
    var g = CORE.newGame(function () { return 0.42; });
    s.eq('灯数量', g.lights.length, N);
    s.eq('步数归零', g.moves, 0);
    s.eq('未完成 status', CORE.status(g), 'playing');
    s.ok('至少一盏亮着', g.lights.some(function (v) { return v === 1; }));
    var a = CORE.newGame(function () { return 0.31; });
    var b = CORE.newGame(function () { return 0.31; });
    s.eq('固定 rng 初始盘面一致', a.lights.join(','), b.lights.join(','));
  });

  s.group('十字翻转', function () {
    var center = Math.floor(N / 2);
    var r = CORE.act(st(), center);
    s.ok('中心点击 changed', r.changed === true);
    s.eq('步数 +1', r.state.moves, 1);
    s.eq('中心点翻转', r.state.lights[center], 1);
    var expected = 5;
    var r0 = Math.floor(center / n), c0 = center % n;
    if (r0 === 0 || r0 === n - 1) expected--;
    if (c0 === 0 || c0 === n - 1) expected--;
    s.eq('中心影响格数', r.state.lights.filter(function (v) { return v === 1; }).length, expected);

    r = CORE.act(st(), 0);
    s.eq('角落影响格数', r.state.lights.filter(function (v) { return v === 1; }).length, 3);

    var bad = CORE.act(st(), -1);
    s.ok('非法下标 changed=false', bad.changed === false);
  });

  s.group('胜负与纯函数', function () {
    s.eq('全灭 status=won', CORE.status(st()), 'won');
    var input = st();
    var before = input.lights.join(',');
    CORE.act(input, 0);
    s.eq('act 不修改入参', input.lights.join(','), before);

    var one = st();
    one.lights[0] = 1;
    var r = CORE.act(one, 0);
    var saved = r.state.lights.slice();
    r = CORE.act(r.state, 0);
    s.eq('同一格点两次复原', r.state.lights.join(','), one.lights.join(','));
    s.ok('两次点击不改变最终状态', r.state.lights.join(',') === one.lights.join(','));
    s.ok('内部状态未共享', saved !== one.lights);
  });
};
