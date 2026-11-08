'use strict';

// Undercover (谁是卧底) test. Logic lives between UC-LOGIC-START and
// UC-LOGIC-END markers; no DOM is needed.

var lib = require('../tests/lib.js');
var s = lib.suite('undercover');

var html = lib.page(__dirname);
var U = lib.evalBetween(html, '/* === UC-LOGIC-START === */', '/* === UC-LOGIC-END === */', '({' +
  'WORDS:WORDS,maxUndercover:maxUndercover,recommendedUndercover:recommendedUndercover,' +
  'isValidConfig:isValidConfig,judgeWin:judgeWin,dealRoles:dealRoles,assignWords:assignWords' +
  '})');

s.group('人数与卧底配置', function () {
  s.eq('4 人最多 1 卧底', U.maxUndercover(4), 1);
  s.eq('5 人最多 2 卧底', U.maxUndercover(5), 2);
  s.eq('12 人最多 3 卧底', U.maxUndercover(12), 3);
  s.eq('推荐 4-6 人 1 卧底', [U.recommendedUndercover(4), U.recommendedUndercover(6)], [1, 1]);
  s.eq('推荐 7-9 人 2 卧底', [U.recommendedUndercover(7), U.recommendedUndercover(9)], [2, 2]);
  s.eq('推荐 10 人以上 3 卧底', [U.recommendedUndercover(10), U.recommendedUndercover(12)], [3, 3]);
  s.ok('4 人 1 卧底合法', U.isValidConfig(4, 1));
  s.ok('3 人非法', !U.isValidConfig(3, 1));
  s.ok('13 人非法', !U.isValidConfig(13, 1));
  s.ok('6 人 3 卧底非法（超过上限）', !U.isValidConfig(6, 3));
  s.ok('人数必须多于卧底', !U.isValidConfig(4, 3));
  s.ok('12 人 1 卧底合法', U.isValidConfig(12, 1));
});

s.group('胜负判定', function () {
  s.eq('卧底全灭平民胜', U.judgeWin(0, 3), 'civ');
  s.eq('卧底不少于平民则卧底胜', U.judgeWin(2, 2), 'uc');
  s.eq('卧底多也胜', U.judgeWin(3, 1), 'uc');
  s.eq('尚未结束', U.judgeWin(1, 3), null);
  s.eq('双方都空仍判平民胜（先检查卧底全灭）', U.judgeWin(0, 0), 'civ');
});

s.group('发角色与发词', function () {
  var roles = U.dealRoles(6, 2, function () { return 0.5; });
  s.eq('角色数等于人数', roles.length, 6);
  s.eq('角色数恰好 2 个卧底', roles.filter(function (r) { return r === 'u'; }).length, 2);
  s.eq('其余为平民', roles.filter(function (r) { return r === 'c'; }).length, 4);
  var bad = 0;
  for (var i = 0; i < 200; i++) {
    var r2 = U.dealRoles(8, 3, Math.random);
    if (r2.length !== 8 || r2.filter(function (x) { return x === 'u'; }).length !== 3) bad++;
  }
  s.eq('200 次发角色均满足配置', bad, 0);
  var pair = { a: '可乐', b: '雪碧' };
  s.eq('平民拿正词、卧底拿反词', U.assignWords(['u', 'c'], pair, false), ['可乐', '雪碧']);
  s.eq('交换后角色词对调', U.assignWords(['u', 'c'], pair, true), ['雪碧', '可乐']);
  s.eq('每人一个词', U.assignWords(['c', 'c', 'u'], pair, false).length, 3);
});

s.group('词库', function () {
  s.eq('40 组词', U.WORDS.length, 40);
  s.ok('每组结构完整', U.WORDS.every(function (w) {
    return w && typeof w.a === 'string' && w.a && typeof w.b === 'string' && w.b &&
      typeof w.cat === 'string' && w.cat;
  }));
  s.ok('每组两词不相同', U.WORDS.every(function (w) { return w.a !== w.b; }));
  s.ok('词对不重复', (function () {
    var seen = {};
    for (var i = 0; i < U.WORDS.length; i++) {
      var k = [U.WORDS[i].a, U.WORDS[i].b].sort().join('|');
      if (seen[k]) return false;
      seen[k] = 1;
    }
    return true;
  })());
  s.ok('均为中文词条', U.WORDS.every(function (w) { return /[一-鿿]/.test(w.a); }));
});

s.done();
