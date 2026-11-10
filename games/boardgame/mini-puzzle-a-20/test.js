'use strict';

// 递推接龙 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-20');
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
var st = E.create(6);
var ans = E.solve(st);
s.ok("答案在选项中", st.options.indexOf(ans) >= 0);
s.eq("选项数量为四", st.options.length, 4);
s.eq("选项互不重复", new Set(st.options).size, 4);
E.act(st, { type: "choice", id: st.options.indexOf(ans) });
s.ok("选对即胜利", E.solved(st));
var st2 = E.create(6);
var wrong = st2.options.findIndex(function (v) { return v !== st2.answer; });
E.act(st2, { type: "choice", id: wrong });
s.ok("选错不判胜", !E.solved(st2));
var seq = st.seq.slice(), ruleOk = false;
if (st.mode === "add") ruleOk = seq[1] - seq[0] === seq[2] - seq[1] && seq[2] - seq[1] === seq[3] - seq[2];
else if (st.mode === "mul") ruleOk = seq[1] * seq[1] === seq[0] * seq[2] && seq[2] * seq[2] === seq[1] * seq[3];
else ruleOk = seq[2] === seq[0] + seq[1] && seq[3] === seq[1] + seq[2];
s.ok("前四项符合同一规律", ruleOk);
s.eq("答案延续规律", ans, st.seq[4]);
});

s.done();
