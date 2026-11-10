'use strict';

// 熄灯十二格 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-17');
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
s.ok("求解器给出点击序列", sol.length > 0);
sol.forEach(function (id) { E.act(st, { type: "cell", id: id }); });
s.ok("按解点击后全灭", E.solved(st));
s.eq("步数等于点击次数", st.moves, sol.length);
var st2 = E.create(3);
var before2 = JSON.stringify(st2.grid);
E.act(st2, { type: "cell", id: 0 });
E.act(st2, { type: "cell", id: 0 });
s.eq("同一格点两次复原", JSON.stringify(st2.grid), before2);
var st3 = E.create(3);
var moves3 = st3.moves;
E.act(st3, { type: "cell", id: 999 });
s.eq("越界点击被忽略", st3.moves, moves3);
s.ok("初始仍有亮灯", st3.grid.indexOf(1) >= 0);
});

s.done();
