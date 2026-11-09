'use strict';

// 24 Game engine test.
// The solver, parser and validator live in the page between __CORE_START__ and
// __CORE_END__, so this test runs the exact browser source.

var path = require('path');
var lib = require('../tests/lib.js');
var s = lib.suite('24game');

var html = lib.page(__dirname);
var CORE = lib.evalBetween(html, '// __CORE_START__', '// __CORE_END__', 'CORE');

s.group('分数运算', function () {
  s.eq('gcd(12,18)', CORE.gcd(12, 18), 6);
  s.eq('gcd(5,0)', CORE.gcd(5, 0), 5);
  s.eq('gcd(-8,12)', CORE.gcd(-8, 12), 4);
  s.eq('fr(2,4) 约分', CORE.fr(2, 4), { n: 1, d: 2 });
  s.eq('fr(1,-2) 符号归一到分子', CORE.fr(1, -2), { n: -1, d: 2 });
  s.eq('fr(1,0) 除零', CORE.fr(1, 0), null);
  s.eq('fstr(1/2)', CORE.fstr({ n: 1, d: 2 }), '1/2');
  s.eq('fstr(3/1)', CORE.fstr({ n: 3, d: 1 }), '3');
});

s.group('可解性', function () {
  s.ok('8,3,8,3 有解 (8/(3-8/3))', !!CORE.solve([8, 3, 8, 3]), JSON.stringify(CORE.solve([8, 3, 8, 3])));
  s.ok('3,3,8,8 有解', CORE.solvable([3, 3, 8, 8]));
  s.ok('1,5,5,5 有解', CORE.solvable([1, 5, 5, 5]));
  s.ok('2,3,4,6 有解', CORE.solvable([2, 3, 4, 6]));
  s.ok('6,6,6,6 有解', CORE.solvable([6, 6, 6, 6]));
  s.ok('4,4,10,10 有解', CORE.solvable([4, 4, 10, 10]));
  s.ok('1,1,1,1 无解', !CORE.solvable([1, 1, 1, 1]));
  s.ok('1,1,2,2 无解', !CORE.solvable([1, 1, 2, 2]));
  var expr = CORE.solve([8, 3, 8, 3]).expr;
  s.ok('解表达式包含全部四张牌', /8/.test(expr) && /3/.test(expr) && expr.length >= 7, expr);
});

s.group('表达式校验', function () {
  s.ok('6*4*1*1 用牌 6,4,1,1 合法', CORE.validate('6*4*1*1', [6, 4, 1, 1]).ok);
  s.ok('(6+4)*2*1 用牌 6,4,2,1 = 20 不合法', !CORE.validate('(6+4)*2*1', [6, 4, 2, 1]).ok);
  s.eq('答案不是 24 的 reason', CORE.validate('6*5*1*1', [6, 5, 1, 1]).reason, 'value');
  s.eq('少用一张牌的 reason', CORE.validate('6*4*1', [6, 4, 1, 1]).reason, 'usage');
  s.eq('用不存在的牌的 reason', CORE.validate('6*7', [6, 4]).reason, 'foreign');
  s.eq('除零的 reason', CORE.validate('6/(4-4)', [6, 4, 4]).reason, 'zero');
  s.eq('非法字符的 reason', CORE.validate('6a4', [6, 4, 1, 1]).reason, 'char');
  s.eq('语法错误的 reason', CORE.validate('6**4', [6, 4, 1, 1]).reason, 'syntax');
  s.eq('空表达式', CORE.validate('  ', [1, 2, 3, 4]).reason, 'empty');
  s.ok('全角符号可解析', CORE.validate('（6＋6）＊（1＋1）', [6, 6, 1, 1]).ok);
  s.ok('24.0 浮点容差', CORE.validate('8*3*1*1', [8, 3, 1, 1]).ok);
});

s.group('发牌', function () {
  var bad = 0, checked = 0;
  for (var i = 0; i < 100; i++) {
    var cards = CORE.dealSolvable();
    checked++;
    if (!cards || cards.length !== 4) { bad++; continue; }
    var vals = cards.map(function (c) { return c.r; });
    if (vals.some(function (r) { return r < 1 || r > 13; })) bad++;
    if (!CORE.solve(vals)) bad++;
  }
  s.eq('100 次发牌均 4 张且可解', bad, 0);
  s.eq('发牌次数', checked, 100);
});

s.group('提示', function () {
  var h = CORE.hint([8, 3, 8, 3]);
  s.ok('有解局面返回提示', !!h);
  s.ok('提示含表达式', h && typeof h.expr === 'string' && h.expr.length > 0, h && h.expr);
  s.ok('提示含首步结果', h && h.result && typeof h.result.n === 'number');
  s.ok('无解局面无提示', CORE.hint([1, 1, 1, 1]) === null);
});

s.done();
