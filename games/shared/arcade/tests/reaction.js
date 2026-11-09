'use strict';

module.exports = function run(CORE, params, s) {
  var time = params.time || 30;

  s.group('初始状态', function () {
    var g = CORE.newGame();
    s.eq('初始分数', g.score, 0);
    s.eq('初始命中', g.hits, 0);
    s.eq('初始失误', g.misses, 0);
    s.eq('初始剩余时间', g.timeLeft, time);
    s.eq('running', g.running, true);
    s.eq('status', CORE.status(g), 'playing');
  });

  s.group('命中、失误与计时', function () {
    var g = CORE.newGame();
    var hit = CORE.act(g, 'hit');
    s.eq('命中分数 +1', hit.state.score, 1);
    s.eq('命中 gained=1', hit.gained, 1);
    s.eq('命中数 +1', hit.state.hits, 1);

    var miss = CORE.act(hit.state, 'miss');
    s.eq('失误不扣分', miss.state.score, 1);
    s.eq('失误数 +1', miss.state.misses, 1);

    var tick = CORE.act(g, 'tick');
    s.eq('tick 剩余时间 -1', tick.state.timeLeft, time - 1);

    var state = g;
    for (var i = 0; i < time; i++) state = CORE.act(state, 'tick').state;
    s.eq('时间归零', state.timeLeft, 0);
    s.eq('时间到 over', state.over, true);
    s.eq('结束后 status=won', CORE.status(state), 'won');
    var after = CORE.act(state, 'hit');
    s.eq('结束后不能再得分', after.changed, false);
  });

  s.group('纯函数', function () {
    var g = CORE.newGame();
    var before = JSON.stringify(g);
    CORE.act(g, 'hit');
    s.eq('act 不修改入参', JSON.stringify(g), before);
  });
};
