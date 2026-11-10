'use strict';

// 午夜列车 — engine contract tests (no DOM, no copied rules).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-ameri-b-22');

s.group('初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('从开场进入', g.scene, 'start');
  s.eq('开场三个选项', E.legalActions(g).length, 3);
  s.eq('初始未结束', g.over, false);
  s.eq('初始标记为空', Object.keys(g.flags).length, 0);
  s.eq('已访问开场', g.visited.join(','), 'start');
});

s.group('选择与标记', function () {
  var g = E.createGame({ seed: 2 });
  E.applyAction(g, 0);
  s.eq('选择后进入 mid0', g.scene, 'mid0');
  s.eq('记录路线标记', g.flags.path, 'a');
  s.eq('访问记录追加', g.visited.length, 2);
  s.eq('中段有两个选项', E.legalActions(g).length, 2);
  E.applyAction(g, 0);
  s.ok('分支抵达结局', g.over && g.ending === 'good');
  var threw = false;
  try { E.applyAction(g, 0); } catch (e) { threw = true; }
  s.ok('结局后不能继续选择', threw);
  var bad = E.createGame({ seed: 3 });
  var threw2 = false;
  try { E.applyAction(bad, 7); } catch (e) { threw2 = true; }
  s.ok('非法选项抛错', threw2);
});

s.group('场景图求解校验', function () {
  var scenes = E.scenes;
  var ids = Object.keys(scenes);
  var badLinks = 0;
  var endings = {};
  ids.forEach(function (id) {
    var sc = scenes[id];
    if (sc.ending) endings[sc.ending] = true;
    (sc.choices || []).forEach(function (ch) {
      if (!scenes[ch.next]) badLinks++;
    });
  });
  s.eq('所有选项都指向有效场景', badLinks, 0);
  s.ok('至少存在三种结局', Object.keys(endings).length >= 3);
  var reached = {}, reachableEndings = {};
  function walk(id) {
    if (reached[id]) return;
    reached[id] = true;
    var sc = scenes[id];
    if (sc.ending) reachableEndings[sc.ending] = true;
    (sc.choices || []).forEach(function (ch) { walk(ch.next); });
  }
  walk('start');
  s.ok('所有结局均可到达', Object.keys(endings).every(function (k) { return reachableEndings[k]; }));
  s.ok('所有场景均可到达', ids.every(function (id) { return reached[id]; }));
});

s.group('20 局 AI 自对弈', function () {
  var bad = 0, seen = {}, stepsOk = true;
  for (var seed = 1; seed <= 20; seed++) {
    try {
      var g = E.selfPlay(seed);
      if (!g.over || !g.ending) bad++;
      seen[g.ending] = (seen[g.ending] || 0) + 1;
      if (g.stepCount > 12) stepsOk = false;
      if (!g.visited.length) stepsOk = false;
    } catch (e) { bad++; }
  }
  s.eq('20 局全部抵达结局', bad, 0);
  s.ok('结局类型合法', Object.keys(seen).every(function (k) { return k === 'good' || k === 'bad' || k === 'secret'; }));
  s.ok('步数始终受控', stepsOk);
  var a = E.selfPlay(21), b = E.selfPlay(21);
  s.eq('同种子结果可复现', [a.ending, a.steps || a.stepCount, a.visited.join('>')], [b.ending, b.steps || b.stepCount, b.visited.join('>')]);
});

s.done();
