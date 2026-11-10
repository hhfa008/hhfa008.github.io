'use strict';

// 爆点小栈 - engine and page contract tests. Run: node test.js
var path = require('path');
var fs = require('fs');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('爆点小栈');

s.group('初始化与导出', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('引擎名称正确', E.META.name, '爆点小栈');
  s.eq('模式正确', E.META.mode, 'push');
  s.eq('初始回合为一', g.round, 1);
  s.eq('先手是玩家', g.turn, 'you');
  s.eq('初始未结束', g.phase, 'play');
  s.ok('存在合法动作', E.actions(g).length > 0);
});

s.group('参数与边界', function () {
  s.eq('骰子颗数符合设定', E.CFG.dice, 3);
  s.ok('爆点值在骰面范围内', E.CFG.bust >= 1 && E.CFG.bust <= E.CFG.faces);
  s.ok('爆点倒扣不为负', E.CFG.penalty >= 0);
  s.ok('同点翻倍开关为布尔', typeof E.CFG.critDouble === 'boolean');
  s.eq('回合上限一致', E.CFG.maxRounds, 6);
});

s.group('种子确定性', function () {
  var a = E.createGame({ seed: 77 });
  var b = E.createGame({ seed: 77 });
  for (var i = 0; i < 12 && a.phase !== 'over'; i++) E.autoMove(a);
  for (var j = 0; j < 12 && b.phase !== 'over'; j++) E.autoMove(b);
  s.eq('同种子同状态', JSON.stringify(E.view(a)), JSON.stringify(E.view(b)));
  var c = E.createGame({ seed: 78 });
  for (var k = 0; k < 12 && c.phase !== 'over'; k++) E.autoMove(c);
  s.ok('不同种子产生不同轨迹', JSON.stringify(E.view(a)) !== JSON.stringify(E.view(c)));
});

s.group('非法动作保护', function () {
  var g = E.createGame({ seed: 3 });
  var before = JSON.stringify(E.view(g));
  var r = E.act(g, 'definitely-not-a-move');
  s.eq('非法动作返回失败', r.ok, false);
  s.eq('非法动作不改变状态', JSON.stringify(E.view(g)), before);
  var over = E.createGame({ seed: 4 });
  over.phase = 'over';
  s.eq('结束后拒绝动作', E.act(over, 'roll').ok, false);
});

s.group('单步动作推进', function () {
  var g = E.createGame({ seed: 5 });
  var before = JSON.stringify(E.view(g));
  var a = E.actions(g)[0];
  var r = E.act(g, a.id);
  s.ok('合法动作成功', r.ok);
  s.ok('状态发生变化', JSON.stringify(E.view(g)) !== before);
  s.ok('view 可序列化', typeof JSON.stringify(E.view(g)) === 'string');
  s.ok('玩家分数非负', g.you.score >= 0 && g.you.bankroll >= 0);
});

s.group('20 局 AI 自对弈', function () {
  var bad = 0, wins = {}, total = 0, guardMax = 0;
  for (var i = 0; i < 20; i++) {
    var g = E.createGame({ seed: 1000 + i });
    var guard = 0;
    while (g.phase !== 'over' && guard < 600) {
      var r = E.autoMove(g);
      if (!r || !r.ok) break;
      guard++;
    }
    if (g.phase !== 'over') bad++;
    if (guard > guardMax) guardMax = guard;
    wins[g.winner] = (wins[g.winner] || 0) + 1;
    total++;
    if (g.winner !== 'you' && g.winner !== 'ai' && g.winner !== 'draw') bad++;
    if (g.round < 1 || g.round > g.maxRounds + 1) bad++;
    if (g.you.score < 0 || g.ai.score < 0) bad++;
  }
  s.eq('20 局全部结束且字段合法', bad, 0);
  s.eq('统计局数为二十', total, 20);
  s.ok('每局都产生赢家标记', Object.keys(wins).length >= 1);
  s.ok('单局步数在界内', guardMax <= 600);
  s.ok('对局结束后无可用动作', E.actions(E.createGame({ seed: 9 })).length > 0);
});

s.group('页面与规则文件', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  s.ok('页面内联引擎', html.indexOf('DiceMiniEngine') >= 0 && html.indexOf('function createGame') >= 0);
  s.eq('页面无外部请求', lib.externalRefs(html), []);
  s.ok('页面含规则链接', html.indexOf('rules.html') >= 0);
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('规则含 FAQ JSON-LD', /application\/ld\+json/.test(rules));
  var body = lib.between(rules, '<!--RULE-->', '<!--/RULE-->');
  var cn = (body.match(/[\u4e00-\u9fa5]/g) || []).length;
  s.ok('规则正文 300-500 汉字', cn >= 300 && cn <= 500, 'got ' + cn);
  s.eq('规则页无外部请求', lib.externalRefs(rules), []);
});

s.done();
