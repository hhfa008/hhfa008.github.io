'use strict';

// 凑数二十四 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-23');
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
var st = E.create(7);
var sol = E.solve(st);
s.eq("求解给出三次合成", sol.length, 3);
sol.forEach(function (step) { E.act(st, { type: "cell", id: step[0] }); E.act(st, { type: "cell", id: step[1] }); E.act(st, { type: "action", id: step[2] }); });
s.ok("按解合成到目标", E.solved(st));
s.eq("最后只剩一个数", st.nums.length, 1);
var st2 = E.create(7);
var before2 = JSON.stringify(st2.nums);
E.act(st2, { type: "action", id: "+" });
s.eq("未选两数时运算符无效", JSON.stringify(st2.nums), before2);
var st3 = E.create(7);
E.act(st3, { type: "cell", id: 9999 });
s.eq("无效数字被忽略", st3.selected.length, 0);
s.eq("初始有四个数字", st2.nums.length, 4);
s.eq("目标为 24", st2.target, 24);
});

s.done();
