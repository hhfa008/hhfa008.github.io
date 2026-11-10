'use strict';

// 四方归位 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-10');
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
var st = E.create(4);
var sol = E.solve(st);
s.eq("解的规模正确", sol.length, st.people.length);
s.ok("解满足全部线索", E.checkClues(st, sol));
sol.forEach(function (item, i) { var guard = 0; while (st.assign[i] !== item && guard < 10) { E.act(st, { type: "cell", id: i }); guard++; } });
E.act(st, { type: "action", id: "check" });
s.ok("填入正解并核对后胜利", E.solved(st));
var st2 = E.create(4);
E.act(st2, { type: "action", id: "check" });
s.ok("错误组合不判胜", !E.solved(st2));
s.ok("至少有两条线索", st.clues.length >= 2);
s.eq("解法稳定且唯一", E.solve(st).join(","), sol.join(","));
});

s.done();
