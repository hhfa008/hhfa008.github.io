'use strict';

module.exports = function run(CORE, params, s) {
  var size = params.size || 16;
  var wrap = !!params.wrap;

  function st(body, dir, food, score) {
    return { size: size, body: body.map(function (p) { return p.slice(); }), dir: dir || 'right', food: food || [0, 0], score: score || 0, alive: true };
  }
  function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }
  function inBody(state, p) { return state.body.some(function (q) { return same(q, p); }); }

  s.group('初始状态', function () {
    var g = CORE.newGame(function () { return 0.4; });
    s.eq('初始长度', g.body.length, 3);
    s.eq('初始分数', g.score, 0);
    s.eq('存活', g.alive, true);
    s.ok('食物不在蛇身上', !inBody(g, g.food));
    s.eq('status', CORE.status(g), 'playing');
    s.ok('身体坐标在界内', g.body.every(function (p) { return p[0] >= 0 && p[0] < size && p[1] >= 0 && p[1] < size; }));
  });

  s.group('移动与进食', function () {
    var g = st([[5, 5], [5, 4], [5, 3]], 'right', [0, 0]);
    var r = CORE.act(g, 'right');
    s.ok('右移 changed', r.changed === true);
    s.eq('新头位置', r.state.body[0].join(','), '5,6');
    s.eq('长度不变', r.state.body.length, 3);

    var eat = st([[2, 2], [2, 1]], 'right', [2, 3]);
    var e = CORE.act(eat, 'right');
    s.eq('吃到食物分数 +1', e.state.score, 1);
    s.eq('吃到食物 gained=1', e.gained, 1);
    s.eq('吃到食物长度 +1', e.state.body.length, 3);
    s.ok('新食物不在蛇身', !inBody(e.state, e.state.food));
    s.ok('新食物在界内', e.state.food[0] >= 0 && e.state.food[0] < size && e.state.food[1] >= 0 && e.state.food[1] < size);
  });

  s.group('死亡与反向', function () {
    var wall = st([[0, 0]], 'up', [5, 5]);
    var w = CORE.act(wall, 'up');
    if (!wrap) {
      s.eq('撞墙后 alive', w.state.alive, false);
      s.eq('撞墙 status=lost', CORE.status(w.state), 'lost');
    }

    var self = st([[2, 2], [2, 1], [1, 1], [1, 2], [0, 2]], 'right', [5, 5]);
    var sf = CORE.act(self, 'up');
    s.eq('撞到自己 alive', sf.state.alive, false);

    var back = st([[5, 5], [5, 4]], 'right', [0, 0]);
    var b = CORE.act(back, 'left');
    s.ok('禁止 180° 反向', b.changed === false);
  });

  if (wrap) {
    s.group('穿墙', function () {
      var g = st([[0, 5]], 'up', [3, 3]);
      var r = CORE.act(g, 'up');
      s.ok('向上穿墙存活', r.state.alive === true);
      s.eq('从底部出现', r.state.body[0].join(','), (size - 1) + ',5');
    });
  }

  s.group('纯函数', function () {
    var g = st([[5, 5], [5, 4]], 'right', [0, 0]);
    var before = JSON.stringify(g);
    CORE.act(g, 'right');
    s.eq('act 不修改入参', JSON.stringify(g), before);
  });
};
