'use strict';

// 相邻归位 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-01');
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
var st = E.create(21);
var sol = E.solve(st);
s.ok("求解器给出交换序列", sol.length > 0);
sol.forEach(function (pair) { E.act(st, { type: "swap", i: pair[0], j: pair[1] }); });
s.ok("逐步执行解法后完成", E.solved(st));
s.eq("步数等于交换次数", st.moves, sol.length);
var st2 = E.create(21);
var before2 = JSON.stringify(st2.tiles);
E.act(st2, { type: "swap", i: 0, j: 3 });
s.eq("拒绝交换非相邻块", JSON.stringify(st2.tiles), before2);
var st3 = E.create(5);
var asc = st3.target[0] < st3.target[1];
var mono = st3.target.every(function (v, i) { if (!i) return true; return asc ? st3.target[i - 1] < v : st3.target[i - 1] > v; });
s.ok("目标序列严格单调", mono);
var a3 = st3.tiles.slice().sort(function (a, b) { return a - b; }).join(",");
var b3 = st3.target.slice().sort(function (a, b) { return a - b; }).join(",");
s.eq("盘面数字与目标一致", a3, b3);
});

s.done();
