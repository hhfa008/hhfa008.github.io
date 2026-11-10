'use strict';

// 拾钥小径 引擎测试：直接 require 同源 engine.js，覆盖生成、合法性、求解与通关。
var lib = require('../../tests/lib.js');
var s = lib.suite('mini-puzzle-a-07');
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
s.ok("求解器给出路径", sol.length > 0);
s.ok("路径步数覆盖钥匙与终点", sol.length >= st.keyCount);
sol.forEach(function (id) { E.act(st, { type: "cell", id: id }); });
s.ok("沿路径走完即胜利", E.solved(st));
s.eq("步数等于路径长度", st.moves, sol.length);
var st2 = E.create(3);
var wall = Number(Object.keys(st2.walls)[0]);
var p0 = st2.pos;
E.act(st2, { type: "cell", id: wall });
s.eq("墙格不可进入", st2.pos, p0);
var jump = (p0 + st2.cols * 2) % (st2.rows * st2.cols);
E.act(st2, { type: "cell", id: jump });
s.eq("不能跳跃移动", st2.pos, p0);
s.eq("钥匙总数正确", Object.keys(st2.keys).length, st2.keyCount);
});

s.done();
