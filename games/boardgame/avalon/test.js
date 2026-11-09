'use strict';

// Avalon simplified engine tests. Engine is required directly (no rule copy).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('avalon');

function fixed(seed) {
  var g = E.createGame({ seed: seed || 1 });
  var roles = ['merlin', 'assassin', 'loyal', 'minion', 'loyal'];
  g.players.forEach(function (p, i) {
    p.role = roles[i];
    p.evil = E.isEvil(roles[i]);
  });
  return g;
}

s.group('发牌与初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('5 名玩家', g.players.length, 5);
  var counts = {};
  g.players.forEach(function (p) { counts[p.role] = (counts[p.role] || 0) + 1; });
  s.eq('1 名梅林', counts.merlin, 1);
  s.eq('1 名刺客', counts.assassin, 1);
  s.eq('2 名忠臣', counts.loyal, 2);
  s.eq('1 名爪牙', counts.minion, 1);
  s.eq('邪恶正好 2 人', E.evilPlayers(g).length, 2);
  s.eq('梅林与刺客各一名', [E.merlinId(g) >= 0, E.assassinId(g) >= 0], [true, true]);
  s.eq('首次任务需 2 人', E.teamSize(g), 2);
  s.eq('玩家 0 首先组队', g.leader, 0);
  s.eq('阶段为组队', g.phase, 'propose');
});

s.group('组队合法性', function () {
  var g = E.createGame({ seed: 2 });
  s.ok('队长可选正确人数', E.legalProposal(g, g.leader, [0, 1]));
  s.ok('人数不足非法', !E.legalProposal(g, g.leader, [0]));
  s.ok('人数过多非法', !E.legalProposal(g, g.leader, [0, 1, 2]));
  s.ok('重复成员非法', !E.legalProposal(g, g.leader, [0, 0]));
  s.ok('非法成员非法', !E.legalProposal(g, g.leader, [0, 9]));
  s.ok('非队长不能组队', !E.legalProposal(g, (g.leader + 1) % 5, [0, 1]));
  var threw = false;
  try { E.proposeTeam(g, (g.leader + 1) % 5, [0, 1]); } catch (e) { threw = true; }
  s.ok('非法组队抛错', threw);
  E.proposeTeam(g, g.leader, [0, 1]);
  s.eq('进入投票', g.phase, 'vote');
  s.eq('队伍已记录', g.team, [0, 1]);
});

s.group('投票与任务', function () {
  var g = fixed(3);
  E.proposeTeam(g, 0, [0, 2]);
  E.castVote(g, 0, true);
  E.castVote(g, 1, true);
  E.castVote(g, 2, true);
  E.castVote(g, 3, false);
  E.castVote(g, 4, false);
  s.eq('3:2 通过', g.phase, 'mission');
  s.eq('连续否决清零', g.rejects, 0);
  var threw = false;
  try { E.castMission(g, 0, true); } catch (e) { threw = true; }
  s.ok('好人不能投破坏', threw);
  E.castMission(g, 0, false);
  E.castMission(g, 2, false);
  s.eq('任务成功', g.missions.good, 1);
  s.eq('任务推进到第 2 次', g.quest, 1);
  s.eq('队长轮转', g.leader, 1);
  s.eq('队伍清空', g.team.length, 0);
});

s.group('否决与邪恶胜利', function () {
  var g = fixed(4);
  for (var i = 0; i < 5; i++) {
    E.proposeTeam(g, g.leader, [g.leader, (g.leader + 1) % 5]);
    for (var p = 0; p < 5; p++) E.castVote(g, p, false);
    if (g.phase === 'over') break;
  }
  s.eq('连续 5 次否决后结束', g.phase, 'over');
  s.eq('邪恶获胜', g.winner, 'evil');
  s.ok('记录否决理由', /否决/.test(g.winReason));
});

s.group('暗杀阶段', function () {
  var g = fixed(5);
  g.missions = { good: 1, evil: 1 };
  g.quest = 2;
  g.leader = 0;
  E.proposeTeam(g, 0, [0, 2]);
  for (var i = 0; i < 5; i++) E.castVote(g, i, true);
  E.castMission(g, 0, false);
  E.castMission(g, 2, false);
  s.eq('好人两胜进入暗杀', g.phase, 'assassin');
  var threw = false;
  try { E.assassinate(g, 0, 1); } catch (e) { threw = true; }
  s.ok('非刺客不能暗杀', threw);
  E.assassinate(g, E.assassinId(g), E.merlinId(g));
  s.eq('暗杀梅林邪恶胜', g.winner, 'evil');

  var h = fixed(6);
  h.missions = { good: 1, evil: 1 };
  h.quest = 2;
  E.proposeTeam(h, 0, [0, 2]);
  for (var j = 0; j < 5; j++) E.castVote(h, j, true);
  E.castMission(h, 0, false);
  E.castMission(h, 2, false);
  E.assassinate(h, E.assassinId(h), 4);
  s.eq('刺杀错人好人胜', h.winner, 'good');
});

s.group('30 局 AI 自对弈', function () {
  var bad = 0, winners = {}, historyOk = true, mercy = true;
  for (var seed = 1; seed <= 30; seed++) {
    try {
      var g = E.selfPlay(seed);
      if (g.phase !== 'over' || !g.winner) bad++;
      winners[g.winner] = (winners[g.winner] || 0) + 1;
      if (!g.history.every(function (h) {
        return h.approved ? h.failCount != null : h.failCount == null;
      })) historyOk = false;
      if (g.missions && g.missions.good > 2) mercy = false;
    } catch (e) { bad++; }
  }
  s.eq('30 局无异常', bad, 0);
  s.ok('赢家只会是善/恶', Object.keys(winners).every(function (k) {
    return k === 'good' || k === 'evil';
  }));
  s.ok('历史记录字段一致', historyOk);
  s.ok('任务数不超过 3', mercy);
});

s.group('身份视图不泄漏', function () {
  var g = fixed(7);
  var merlinView = E.publicView(g, 0);
  s.eq('自己知道自己是梅林', merlinView.yourRole, 'merlin');
  s.eq('梅林看见刺客', merlinView.roleKnowledge[1].role, 'evil-known');
  s.eq('梅林看见爪牙', merlinView.roleKnowledge[3].role, 'evil-known');
  s.eq('梅林看不见忠臣身份', merlinView.roleKnowledge[2].role, 'unknown');
  s.eq('他人真实身份不公开', merlinView.players[1].revealedRole, 'unknown');

  var assassinView = E.publicView(g, 1);
  s.eq('刺客看见队友', assassinView.roleKnowledge[3].role, 'evil-ally');
  s.eq('刺客看不见梅林', assassinView.roleKnowledge[0].role, 'unknown');
  s.eq('爪牙也看不见梅林', E.publicView(g, 3).roleKnowledge[0].role, 'unknown');
  s.ok('视图不含完整角色数组', merlinView.roles === undefined);
});

s.done();
