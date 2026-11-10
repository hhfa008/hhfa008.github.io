'use strict';

// 狐鹅豆筏 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-11');
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
var st = E.create(1);
var sol = E.solve(st);
s.ok("存在过河方案", sol.length > 0);
sol.forEach(function (a) { E.act(st, { type: "action", id: a }); });
s.ok("按方案完成过河", E.solved(st));
s.ok("全程未触发冲突", !st.lost);
s.eq("步数等于方案长度", st.moves, sol.length);
var st2 = E.create(1);
E.act(st2, { type: "action", id: "fox" });
E.act(st2, { type: "action", id: "goose" });
s.eq("不能带对岸没有的东西", st2.moves, 1);
var st3 = E.create(1);
E.act(st3, { type: "action", id: "alone" });
s.ok("无人看管会失败", st3.lost);
});

s.done();
