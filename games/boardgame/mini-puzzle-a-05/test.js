'use strict';

// 暗码侦探 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-05');
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
var st = E.create(11);
var code = E.solve(st);
s.eq("解的长度正确", code.length, st.len);
for (var i = 0; i < st.len; i++) E.act(st, { type: "digit", d: 0 });
E.act(st, { type: "action", id: "submit" });
for (i = 0; i < st.len; i++) E.act(st, { type: "digit", d: 1 });
E.act(st, { type: "action", id: "submit" });
var code2 = E.solve(st);
s.eq("有历史反馈后仍给出候选", code2.length, st.len);
st.attempts.forEach(function (a) { var fb = E.feedback(code2, a.guess); s.ok("候选码与历史反馈一致", fb.exact === a.exact && fb.partial === a.partial); });
var st2 = E.create(11);
st2.secret.forEach(function (d) { E.act(st2, { type: "digit", d: d }); });
E.act(st2, { type: "action", id: "submit" });
s.ok("直接猜中即胜利", E.solved(st2));
var st3 = E.create(11);
E.act(st3, { type: "digit", d: 0 });
E.act(st3, { type: "action", id: "clear" });
s.eq("清空按钮有效", st3.guess.length, 0);
var st4 = E.create(11);
E.act(st4, { type: "digit", d: 99 });
s.eq("拒绝越界数字", st4.guess.length, 0);
});

s.done();
