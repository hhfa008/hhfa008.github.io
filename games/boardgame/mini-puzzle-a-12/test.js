'use strict';

// 量水三升 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-12');
var E = require('./engine.js');

s.group('基础契约', function () {
  var a = E.create(7), b = E.create(7);
  s.ok('导出 create 函数', typeof E.create === 'function');
  s.eq('同 seed 生成相同状态', JSON.stringify(a), JSON.stringify(b));
  s.ok('初始状态尚未完成', !E.solved(a));
  var v = E.view(a);
  s.ok('view 返回 cells 数组', Array.isArray(v.cells));
  s.ok('view 返回 actions 数组', Array.isArray(v.actions));
  s.ok('view 提供提示文案', typeof v.prompt === 'string' && v.prompt.length > 0);
  s.ok('存在可操作元素', v.cells.length + v.actions.length > 0);
  var threw = false;
  try { E.act(a, { type: 'unknown-action' }); } catch (e) { threw = true; }
  s.ok('非法动作不会抛错', !threw);
});

s.group('玩法与解法', function () {
var st = E.create(3);
var sol = E.solve(st);
s.ok("存在量水方案", sol.length > 0);
sol.forEach(function (id) { E.act(st, { type: "action", id: id }); });
s.ok("按方案量出目标", E.solved(st));
s.eq("步数等于方案长度", st.moves, sol.length);
var st2 = E.create(3);
E.act(st2, { type: "action", id: "fill0" });
E.act(st2, { type: "action", id: "fill0" });
s.eq("装满不会超过容量", st2.amt[0], st2.caps[0]);
var before2 = JSON.stringify(st2.amt);
E.act(st2, { type: "action", id: "nonsense" });
s.eq("未知操作不改变水量", JSON.stringify(st2.amt), before2);
s.ok("目标不超过容量", st.target <= st.caps[1]);
});

s.done();
