'use strict';

// 彩液分层 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-25');
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
var st = E.create(2);
var sol = E.solve(st);
s.ok("存在倒液方案", sol.length > 0);
sol.forEach(function (p) { E.act(st, { type: "pour", from: p[0], to: p[1] }); });
s.ok("按方案完成分层", E.solved(st));
s.eq("步数等于方案长度", st.moves, sol.length);
var st2 = E.create(2);
s.ok("每管不超过容量", st2.tubes.every(function (t) { return t.length <= st2.cap; }));
var badFrom = -1, badTo = -1;
for (var i = 0; i < st2.tubes.length; i++) { for (var j = 0; j < st2.tubes.length; j++) { if (i !== j && st2.tubes[i].length && st2.tubes[j].length && st2.tubes[i][st2.tubes[i].length - 1] !== st2.tubes[j][st2.tubes[j].length - 1]) { badFrom = i; badTo = j; } } }
if (badFrom >= 0) { var before2 = JSON.stringify(st2.tubes); E.act(st2, { type: "pour", from: badFrom, to: badTo }); s.eq("颜色不同不能倒", JSON.stringify(st2.tubes), before2); } else { s.ok("颜色不同不能倒", true); }
s.ok("初始并非已完成", !E.solved(E.create(9)));
});

s.done();
