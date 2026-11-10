'use strict';

/* 名次竞猜（mini-party-b-25）引擎与页面测试。
 * 页面与测试共用同源 engine.js；直接 require，不复制规则。
 * 运行：node games/boardgame/mini-party-b-25/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('mini-party-b-25');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

function playSeed(seed) {
  var g = E.createGame({ seed: seed, aiAll: true });
  var steps = 0;
  while (!E.isOver(g) && steps < 400) {
    var action = E.aiAction(g);
    if (!action) throw new Error('AI 无动作，seed=' + seed + ' round=' + g.round + ' phase=' + g.phase);
    var res = E.applyAction(g, action);
    if (!res.ok) throw new Error('动作被拒：' + JSON.stringify(res) + ' seed=' + seed);
    steps++;
  }
  return { game: g, steps: steps };
}

s.group('静态页面约束', function () {
  s.ok('引用同源 engine.js', /<script[^>]*src="\.\/engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 http(s) 请求', !/(src|href)="https?:\/\//.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('触控目标 >=44px', /min-height:\s*(44|48|52|56)px/.test(html));
  s.ok('存在 aria-label', /aria-label=/.test(html));
  s.ok('标题包含游戏名', html.indexOf('名次竞猜') >= 0);
  s.ok('规则页含 FAQ JSON-LD', /FAQPage/.test(rules));
  s.ok('规则页有回游戏链接', /href="index\.html"/.test(rules));
  s.ok('规则页无外部请求', !/(src|href)="https?:\/\//.test(rules.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  var body = rules.split('<!-- RULES:BEGIN -->')[1].split('<!-- RULES:END -->')[0];
  var han = (body.match(/[\u4e00-\u9fff]/g) || []).length;
  s.ok('规则正文 300–500 字', han >= 300 && han <= 500, 'han=' + han);
});

s.group('开局状态', function () {
  var state = E.createGame({ seed: 7 });
  s.eq('双人对局', state.players.length, 2);
  s.eq('玩家席位', state.players.map(function (p) { return p.name; }), ['你', 'AI']);
  s.eq('分数数组', state.scores.length, 2);
  s.eq('从第 1 回合开始', state.round, 1);
  s.eq('回合上限', state.maxRounds, 9);
  s.eq('初始阶段', state.phase, 'choose');
  s.ok('提示非空', state.prompt.length > 0);
  s.ok('选项数量合理', state.options.length >= 2);
  s.ok('选项 id 唯一', new Set(state.options.map(function (o) { return o.id; })).size === state.options.length);
  s.ok('GAME 配置与目录一致', E.GAME.slug === 'mini-party-b-25' && E.GAME.family === 'ranking');
});

s.group('家族规则', function () {
  var state = E.createGame({ seed: 11 });
  s.ok('四个排序候选', state.options.length === 4);
  s.ok('展示数值', state.detail.indexOf('数值') >= 0);
  s.eq('唯一正确答案', state.correctSet.length, 1);
  var acted = E.applyAction(state, { type: 'choose', choice: state.correctSet[0] });
  s.ok('作答后进入结算', acted.ok && state.phase === 'result', JSON.stringify(acted));
});

s.group('回合推进', function () {
  var state = E.createGame({ seed: 3 });
  var acted = E.applyAction(state, { type: 'choose', choice: state.options[0].id, ms: 600 });
  s.ok('首回合可作答', acted.ok, JSON.stringify(acted));
  s.eq('作答后处于结算', state.phase, 'result');
  var advanced = E.applyAction(state, { type: 'next' });
  s.ok('可进入下一回合', advanced.ok, JSON.stringify(advanced));
  s.ok('回合推进或对局结束', state.round === 2 || E.isOver(state), 'round=' + state.round);
  if (!E.isOver(state)) s.eq('新回合回到选择阶段', state.phase, 'choose');
});

s.group('AI 自对弈 20 局', function () {
  var finished = 0;
  for (var seed = 1; seed <= 20; seed++) {
    var out = playSeed(seed);
    var g = out.game;
    if (!E.isOver(g)) { s.ok('seed ' + seed + ' 能结束', false, 'steps=' + out.steps); continue; }
    finished++;
    s.ok('seed ' + seed + ' 有胜负或平局', [0, 1, -1].indexOf(g.winner) >= 0, 'winner=' + g.winner);
    s.ok('seed ' + seed + ' 分数有效', Number.isFinite(g.scores[0]) && Number.isFinite(g.scores[1]), g.scores.join(':'));
    s.ok('seed ' + seed + ' 回合数合法', g.round <= g.maxRounds, 'round=' + g.round);
    s.ok('seed ' + seed + ' 有历史记录', g.history.length >= 1);
  }
  s.eq('20 局全部完成', finished, 20);
});

s.done();
