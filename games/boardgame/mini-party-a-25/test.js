'use strict';

// 接龙暗号 engine tests. The test requires the same engine the page loads.
var path = require('path');
var fs = require('fs');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-party-a-25');

s.group('初始化与隐藏信息', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('轮次从 0 开始', g.round, 0);
  s.eq('总轮数为 5', g.maxRounds, 5);
  s.eq('阶段为选择', g.phase, 'choose');
  s.eq('公共视图四个选项', E.publicView(g).current.options.length, 4);
  s.ok('双方初始 0 分', g.score === 0 && g.aiScore === 0);
  s.ok('公共视图不含答案索引', E.publicView(g).current.answerIndex === undefined);
  s.ok('公共视图不含 AI 选择', E.publicView(g).current.aiChoice === undefined);
});

s.group('选择与计分', function () {
  var g = E.createGame({ seed: 2 });
  var ans = g.current.answerIndex;
  s.ok('答案索引合法', ans >= 0 && ans < g.current.options.length);
  E.choose(g, ans);
  s.eq('选择后进入揭晓', g.phase, 'reveal');
  s.eq('答对得 2 分', g.score, 2);
  s.eq('历史记录一条', g.history.length, 1);
  s.eq('揭晓后公开答案', E.publicView(g).current.answerIndex, ans);
  E.next(g);
  s.eq('进入下一轮', g.round, 1);
});

s.group('非法输入', function () {
  var g = E.createGame({ seed: 3 });
  var threw = false;
  try { E.choose(g, -1); } catch (e) { threw = true; }
  s.ok('负数索引抛错', threw);
  threw = false;
  try { E.choose(g, 4); } catch (e) { threw = true; }
  s.ok('越界索引抛错', threw);
  threw = false;
  try { E.choose(g, 0); E.choose(g, 0); } catch (e) { threw = true; }
  s.ok('重复选择抛错', threw);
});

  s.group('题面结构', function () {
    var g = E.createGame({ seed: 9 });
    var v = E.publicView(g);
    s.eq('四个候选答案', v.current.options.length, 4);
    s.ok('题面非空', v.current.prompt.length >= 2);
    s.ok('候选答案互不相同', new Set(v.current.options).size === 4);
  });

s.group('20 局 AI 自对弈', function () {
  var bad = 0, roundsOk = true, overOk = true, scoreOk = true;
  for (var seed = 1; seed <= 20; seed++) {
    try {
      var r = E.selfPlay(seed);
      if (r.round !== 5 || r.history.length !== 5) roundsOk = false;
      if (r.phase !== 'over') overOk = false;
      if (!(r.score >= 0) || !(r.aiScore >= 0)) scoreOk = false;
    } catch (err) { bad++; }
  }
  s.eq('20 局无异常', bad, 0);
  s.ok('每局恰好 5 轮', roundsOk);
  s.ok('每局正常结束', overOk);
  s.ok('分数非负', scoreOk);
});

s.group('规则页静态合规', function () {
  var html = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  var parsed = null;
  try { parsed = JSON.parse(m[1]); } catch (e) { parsed = null; }
  s.eq('FAQ JSON-LD 可解析', parsed && parsed['@type'], 'FAQPage');
  var plain = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  var cn = (plain.match(/[\u4e00-\u9fa5]/g) || []).length;
  s.ok('规则正文 300-500 个汉字', cn >= 300 && cn <= 500, '实际 ' + cn);
});

s.done();
