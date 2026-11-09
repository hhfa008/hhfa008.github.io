'use strict';

module.exports = function run(CORE, params, s) {
  var disks = params.disks;

  s.group('初始状态', function () {
    var g = CORE.newGame();
    s.eq('盘数', g.pegs[0].length, disks);
    s.eq('左柱从大到小', g.pegs[0].join(','), Array.from({ length: disks }, function (_, i) { return disks - i; }).join(','));
    s.eq('中柱为空', g.pegs[1].length, 0);
    s.eq('右柱为空', g.pegs[2].length, 0);
    s.eq('步数 0', g.moves, 0);
    s.eq('status', CORE.status(g), 'playing');
  });

  s.group('移动规则', function () {
    var g = CORE.newGame();
    var r = CORE.act(g, [0, 2]);
    s.ok('合法移动 changed', r.changed === true);
    s.eq('步数 +1', r.state.moves, 1);
    s.eq('右柱得到最小盘', r.state.pegs[2].join(','), '1');
    s.eq('左柱减少一', r.state.pegs[0].length, disks - 1);

    var onto = CORE.act(g, [0, 2]);
    var bad = CORE.act(onto.state, [0, 2]);
    s.ok('大盘不能压小盘', bad.changed === false && bad.state.moves === 1);

    var same = CORE.act(g, [0, 0]);
    s.ok('同柱移动无效', same.changed === false);

    var empty = CORE.act(g, [1, 2]);
    s.ok('空柱不能移出', empty.changed === false);
  });

  s.group('完成与纯函数', function () {
    var g = CORE.newGame();
    // 递归求解，验证最少步数与最终状态
    var moves = [];
    (function solve(k, a, b, c) {
      if (!k) return;
      solve(k - 1, a, c, b);
      moves.push([a, c]);
      solve(k - 1, b, a, c);
    })(disks, 0, 1, 2);

    var state = g;
    for (var i = 0; i < moves.length; i++) state = CORE.act(state, moves[i]).state;
    s.eq('完成 status=won', CORE.status(state), 'won');
    s.eq('完成步数', state.moves, Math.pow(2, disks) - 1);
    s.eq('右柱盘数', state.pegs[2].length, disks);

    var before = JSON.stringify(g);
    CORE.act(g, [0, 2]);
    s.eq('act 不修改入参', JSON.stringify(g), before);
  });
};
