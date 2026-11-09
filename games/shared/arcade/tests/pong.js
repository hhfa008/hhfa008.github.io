'use strict';

module.exports = function run(CORE, params, s) {
  var ai = params.ai !== false;

  function st(ball, leftY, rightY, score, over) {
    return {
      w: 100, h: 60,
      ball: ball,
      left: { y: leftY == null ? 30 : leftY },
      right: { y: rightY == null ? 30 : rightY },
      score: score || [0, 0],
      over: !!over,
    };
  }

  s.group('初始与推进', function () {
    var g = CORE.newGame(function () { return 0.3; });
    s.eq('初始比分', g.score.join(','), '0,0');
    s.eq('初始 status', CORE.status(g), 'playing');
    s.eq('球在中心附近', g.ball.x, 50);
    s.ok('有水平速度', g.ball.vx !== 0);

    var r = CORE.act(st({ x: 50, y: 30, vx: 1, vy: 0 }), 'tick', function () { return 0.5; });
    s.eq('tick 后 x 增加', r.state.ball.x, 51);
    s.eq('tick changed', r.changed, true);
  });

  s.group('反弹与球拍', function () {
    var top = CORE.act(st({ x: 50, y: 1.5, vx: 1, vy: -1 }), 'tick', function () { return 0.5; });
    s.ok('上边界反弹', top.state.ball.vy > 0);

    var paddle = CORE.act(st({ x: 5.5, y: 30, vx: -1, vy: 0 }, 30), 'tick', function () { return 0.5; });
    s.ok('左拍反弹', paddle.state.ball.vx > 0);

    var up = CORE.act(st({ x: 50, y: 30, vx: 1, vy: 0 }, 30), 'up');
    s.ok('左拍上移', up.state.left.y < 30);
    s.eq('左拍上移 changed', up.changed, true);

    var clamp = CORE.act(st({ x: 50, y: 30, vx: 1, vy: 0 }, 0), 'up');
    s.ok('球拍不越界', clamp.state.left.y >= 0);
  });

  s.group('得分与结束', function () {
    var miss = CORE.act(st({ x: 0.5, y: 30, vx: -1, vy: 0 }, 0), 'tick', function () { return 0.5; });
    s.eq('漏球对手得分', miss.state.score[1], 1);
    s.eq('得分 gained=1', miss.gained, 1);

    var leftMiss = CORE.act(st({ x: 99.5, y: 30, vx: 1, vy: 0 }, 30, 4), 'tick', function () { return 0.5; });
    s.eq('右侧漏球我方得分', leftMiss.state.score[0], 1);

    var w = st({ x: 50, y: 30, vx: 1, vy: 0 }, 30, 30, [7, 3], true);
    s.eq('7 分 status=won', CORE.status(w), 'won');
    var l = st({ x: 50, y: 30, vx: 1, vy: 0 }, 30, 30, [3, 7], true);
    s.eq('对手 7 分 status=lost', CORE.status(l), 'lost');
    var stopped = CORE.act(w, 'tick', function () { return 0.5; });
    s.eq('结束后不再推进', stopped.changed, false);
  });

  s.group('纯函数', function () {
    var g = st({ x: 50, y: 30, vx: 1, vy: 0 });
    var before = JSON.stringify(g);
    CORE.act(g, 'tick', function () { return 0.5; });
    s.eq('act 不修改入参', JSON.stringify(g), before);
  });
};
