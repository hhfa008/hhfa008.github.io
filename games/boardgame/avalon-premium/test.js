'use strict';

// Avalon premium — engine, presentation and page checks.
// Runs through games/tests/run-all.js (the suite prints RESULT: ...).

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('avalon-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function chineseCount(html) {
  return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length;
}
function seatsByRole(g, role) {
  var out = [];
  g.players.forEach(function (p, i) { if (p.role === role) out.push(i); });
  return out;
}
function goodSeats(g) {
  var out = [];
  g.players.forEach(function (p, i) { if (!p.evil) out.push(i); });
  return out;
}
function evilSeats(g) {
  var out = [];
  g.players.forEach(function (p, i) { if (p.evil) out.push(i); });
  return out;
}
function allVotes(g, approve) {
  for (var i = 0; i < g.players.length; i++) {
    if (g.phase !== 'vote') break;
    if (g.votes[i] == null) E.castVote(g, i, approve);
  }
}
function resetProposal(g, team) {
  g.phase = 'propose';
  g.leader = team[0];
  g.team = [];
  g.votes = [null, null, null, null, null];
  g.missionVotes = {};
}
// Force one quest with a given team and fail seats. Returns the quest entry.
function forceQuest(g, team, failSeats) {
  resetProposal(g, team);
  E.proposeTeam(g, g.leader, team);
  allVotes(g, true);
  if (g.phase !== 'mission') throw new Error('quest team was not approved');
  team.forEach(function (seat) {
    E.castMission(g, seat, failSeats.indexOf(seat) >= 0);
  });
  return g.history[g.history.length - 1];
}
function questNeeded(g) { return E.teamSize(g); }

s.group('五人人份与官方任务表', function () {
  var g = E.createGame({ seed: 1, names: D.aiNames });
  s.eq('固定 5 名玩家', g.players.length, 5);
  s.eq('好人 3 名', g.players.filter(function (p) { return !p.evil; }).length, 3);
  s.eq('坏人 2 名', g.players.filter(function (p) { return p.evil; }).length, 2);
  s.eq('梅林恰好 1 名', seatsByRole(g, 'merlin').length, 1);
  s.eq('派西维尔恰好 1 名', seatsByRole(g, 'percival').length, 1);
  s.eq('忠臣恰好 1 名', seatsByRole(g, 'loyal').length, 1);
  s.eq('莫甘娜恰好 1 名', seatsByRole(g, 'morgana').length, 1);
  s.eq('刺客恰好 1 名', seatsByRole(g, 'assassin').length, 1);
  s.eq('任务人数 2/3/2/3/3', E.QUEST_SIZES, [2, 3, 2, 3, 3]);
  s.eq('5 人局每个任务只需 1 张失败', E.FAILS_TO_FAIL, [1, 1, 1, 1, 1]);
  s.eq('五个任务', g.quests.length, 5);
  s.eq('任务人数写入任务轨道', g.quests.map(function (q) { return q.size; }), [2, 3, 2, 3, 3]);
  s.eq('三次任务获胜', E.QUESTS_TO_WIN, 3);
  s.eq('连续五次否决邪恶获胜', E.MAX_REJECTS, 5);
  s.eq('初始阶段为提名', g.phase, 'propose');
  s.eq('初始队长为 0 号', g.leader, 0);
  s.eq('初始任务序号 0', g.questIndex, 0);
  s.eq('初始否决数 0', g.rejects, 0);
  s.eq('初始比分 0:0', g.missions, { good: 0, evil: 0 });
  s.eq('默认首名玩家是你', g.players[0].name, '你');
  s.eq('状态可 JSON 序列化', JSON.parse(JSON.stringify(g)).phase, 'propose');
  s.eq('状态不含函数', JSON.stringify(g).indexOf('function'), -1);
  var a = E.createGame({ seed: 7 }).players.map(function (p) { return p.role; });
  var b = E.createGame({ seed: 7 }).players.map(function (p) { return p.role; });
  s.eq('同种子角色完全一致', a, b);
  var different = 0;
  [8, 9, 10].forEach(function (seed) {
    var c = E.createGame({ seed: seed }).players.map(function (p) { return p.role; });
    if (JSON.stringify(c) !== JSON.stringify(a)) different++;
  });
  s.ok('不同种子至少出现不同发牌', different > 0, 'different=' + different);
  s.eq('角色顺序来自共享洗牌且无重复', new Set(a).size, 5);
});

s.group('组队合法性与投票', function () {
  var g = E.createGame({ seed: 11 });
  s.ok('队长可提名正确人数', E.legalProposal(g, 0, [0, 1]));
  s.ok('非队长不能提名', !E.legalProposal(g, 1, [0, 1]));
  s.ok('人数不足不能提名', !E.legalProposal(g, 0, [0]));
  s.ok('人数过多不能提名', !E.legalProposal(g, 0, [0, 1, 2]));
  s.ok('重复座位不能提名', !E.legalProposal(g, 0, [0, 0]));
  s.ok('越界座位不能提名', !E.legalProposal(g, 0, [0, 9]));
  var threw = false;
  try { E.proposeTeam(g, 1, [0, 1]); } catch (e) { threw = true; }
  s.ok('非法提名抛错', threw);
  E.proposeTeam(g, 0, [1, 0]);
  s.eq('提名后进入投票', g.phase, 'vote');
  s.eq('队伍排序稳定', g.team, [0, 1]);
  s.eq('历史新增一条提名', g.history.length, 1);
  s.eq('投票前历史票面隐藏', g.history[0].votes, null);
  s.eq('投票前公共视图隐藏票面', E.publicView(g, 0).history[0].votes, null);
  s.eq('投票前已投人数为 0', E.publicView(g, 0).votedCount, 0);
  E.castVote(g, 0, true);
  E.castVote(g, 1, true);
  E.castVote(g, 2, false);
  E.castVote(g, 3, false);
  s.eq('四票后仍等待最后一人', g.phase, 'vote');
  s.eq('公共视图只显示已投状态', E.publicView(g, 0).players.map(function (p) { return p.voted; }), [true, true, true, true, false]);
  E.castVote(g, 4, true);
  s.eq('3 赞成 2 反对时队伍通过', g.history[0].approved, true);
  s.eq('通过后进入任务', g.phase, 'mission');
  s.eq('通过后否决数归零', g.rejects, 0);
  s.eq('结算后票面公开', g.history[0].votes, [true, true, false, false, true]);
  s.eq('记录赞成数', g.history[0].yes, 3);
  s.eq('记录反对数', g.history[0].no, 2);
  threw = false;
  try { E.castVote(g, 0, true); } catch (e) { threw = true; }
  s.ok('任务阶段不能再次投票', threw);

  var r = E.createGame({ seed: 12 });
  E.proposeTeam(r, 0, [0, 1]);
  E.castVote(r, 0, true);
  E.castVote(r, 1, true);
  E.castVote(r, 2, false);
  E.castVote(r, 3, false);
  E.castVote(r, 4, false);
  s.eq('2 赞成 3 反对被否决', r.history[0].approved, false);
  s.eq('否决后回到提名', r.phase, 'propose');
  s.eq('否决计数为 1', r.rejects, 1);
  s.eq('队长顺延到下一人', r.leader, 1);
  E.proposeTeam(r, 1, [1, 2]);
  allVotes(r, true);
  s.eq('通过后否决计数清零', r.rejects, 0);
});

s.group('连续五次否决与任务结果', function () {
  var g = E.createGame({ seed: 13 });
  for (var k = 0; k < 5; k++) {
    var leader = g.leader;
    E.proposeTeam(g, leader, [leader, (leader + 1) % 5]);
    E.castVote(g, 0, true);
    E.castVote(g, 1, true);
    E.castVote(g, 2, false);
    E.castVote(g, 3, false);
    E.castVote(g, 4, false);
  }
  s.eq('连续五次否决后结束', g.phase, 'over');
  s.eq('邪恶方因五次否决获胜', g.winner, 'evil');
  s.ok('原因包含连续五次', /连续 5 次/.test(g.winReason), g.winReason);
  s.eq('五次否决后任务仍为 0:0', g.missions, { good: 0, evil: 0 });

  var m = E.createGame({ seed: 14 });
  var mEvil = evilSeats(m)[0];
  var mGood = goodSeats(m)[0];
  var team = [mEvil, mGood];
  resetProposal(m, team);
  E.proposeTeam(m, mEvil, team);
  allVotes(m, true);
  s.eq('任务阶段公共视图不暴露任务卡', E.publicView(m, 0).history[0].failCount, null);
  s.eq('任务阶段已提交数为 0', E.publicView(m, 0).missionVotedCount, 0);
  var goodSeat = mGood;
  var threw = false;
  try { E.castMission(m, goodSeat, true); } catch (e) { threw = true; }
  s.ok('好人不能打出失败卡', threw);
  E.castMission(m, team[0], false);
  s.eq('只提交一张时任务未结算', m.phase, 'mission');
  s.eq('公共视图只显示已提交人数', E.publicView(m, 0).missionVotedCount, 1);
  E.castMission(m, team[1], false);
  s.eq('两张成功卡任务成功', m.quests[0].result, 'success');
  s.eq('成功后进入下一任务', m.questIndex, 1);
  s.eq('任务轨道记录成功', m.quests[0].winner, 'good');
  s.eq('任务结算后比分 1:0', m.missions, { good: 1, evil: 0 });

  var f = E.createGame({ seed: 15 });
  var evil = evilSeats(f)[0];
  var good = goodSeats(f)[0];
  resetProposal(f, [evil, good]);
  E.proposeTeam(f, evil, [evil, good]);
  allVotes(f, true);
  E.castMission(f, evil, true);
  E.castMission(f, good, false);
  s.eq('一张失败卡即任务失败（5 人局）', f.quests[0].result, 'fail');
  s.eq('失败票数记录为 1', f.quests[0].failCount, 1);
  s.eq('失败原因写入比分', f.missions, { good: 0, evil: 1 });
  s.eq('任务失败后进入下一任务', f.questIndex, 1);
});

s.group('三次成功、暗杀与胜负', function () {
  var g = E.createGame({ seed: 21 });
  var good = goodSeats(g);
  forceQuest(g, good.slice(0, questNeeded(g)), []);
  forceQuest(g, good.slice(0, questNeeded(g)), []);
  forceQuest(g, good.slice(0, questNeeded(g)), []);
  s.eq('正义方三胜后进入暗杀', g.phase, 'assassin');
  s.eq('正义方任务数为 3', g.missions.good, 3);
  s.eq('暗杀阶段保留任务轨道', g.quests.filter(function (q) { return q.result === 'success'; }).length, 3);
  var assassin = E.assassinId(g);
  var merlin = E.merlinId(g);
  s.eq('每局恰好一名刺客', evilSeats(g).filter(function (i) { return g.players[i].role === 'assassin'; }).length, 1);
  s.ok('刺客可以暗杀梅林', E.legalAssassination(g, assassin, merlin));
  s.ok('刺客不能暗杀自己', !E.legalAssassination(g, assassin, assassin));
  s.ok('好人不能执行暗杀', !E.legalAssassination(g, merlin, assassin));
  var threw = false;
  try { E.assassinate(g, merlin, assassin); } catch (e) { threw = true; }
  s.ok('非刺客暗杀抛错', threw);
  E.assassinate(g, assassin, merlin);
  s.eq('命中梅林时邪恶获胜', g.winner, 'evil');
  s.eq('暗杀后对局结束', g.phase, 'over');
  s.ok('原因包含梅林', /梅林/.test(g.winReason), g.winReason);
  var view = E.publicView(g, 0);
  s.eq('结束后公开所有身份', view.players.every(function (p) { return !!p.revealedRole; }), true);
  s.eq('结束后公开梅林座位', view.reveal.merlinSeat, merlin);
  s.eq('结束后公开刺客目标', view.reveal.assassinTarget, merlin);
  s.eq('结束后公开全部角色', view.reveal.roles.length, 5);

  var miss = E.createGame({ seed: 22 });
  var good2 = goodSeats(miss);
  forceQuest(miss, good2.slice(0, questNeeded(miss)), []);
  forceQuest(miss, good2.slice(0, questNeeded(miss)), []);
  forceQuest(miss, good2.slice(0, questNeeded(miss)), []);
  var assassin2 = E.assassinId(miss);
  var merlin2 = E.merlinId(miss);
  var decoy = good2.filter(function (i) { return i !== merlin2; })[0];
  E.assassinate(miss, assassin2, decoy);
  s.eq('暗杀未命中时正义获胜', miss.winner, 'good');
  s.ok('未命中原因包含幸存', /幸存/.test(miss.winReason), miss.winReason);

  var evilWin = E.createGame({ seed: 23 });
  var evil = evilSeats(evilWin);
  var good3 = goodSeats(evilWin);
  function evilTeam(size) {
    return [evil[0]].concat(good3.slice(0, size - 1));
  }
  forceQuest(evilWin, evilTeam(questNeeded(evilWin)), [evil[0]]);
  forceQuest(evilWin, evilTeam(questNeeded(evilWin)), [evil[0]]);
  forceQuest(evilWin, evilTeam(questNeeded(evilWin)), [evil[0]]);
  s.eq('邪恶方三败直接获胜', evilWin.winner, 'evil');
  s.eq('邪恶三败后不进入暗杀', evilWin.phase, 'over');
  s.ok('原因包含三次任务', /三次任务/.test(evilWin.winReason), evilWin.winReason);

  var fifth = E.createGame({ seed: 24 });
  var gd = goodSeats(fifth);
  var ev = evilSeats(fifth);
  forceQuest(fifth, gd.slice(0, questNeeded(fifth)), []);
  forceQuest(fifth, [ev[0]].concat(gd.slice(0, questNeeded(fifth) - 1)), [ev[0]]);
  forceQuest(fifth, gd.slice(0, questNeeded(fifth)), []);
  forceQuest(fifth, [ev[0]].concat(gd.slice(0, questNeeded(fifth) - 1)), [ev[0]]);
  s.eq('四任务后比分 2:2', fifth.missions, { good: 2, evil: 2 });
  s.eq('五局打满时进入第五任务', fifth.questIndex, 4);
  s.eq('第五任务人数为 3', E.teamSize(fifth), 3);
  forceQuest(fifth, gd.slice(0, 3), []);
  s.eq('第五任务成功后进入暗杀', fifth.phase, 'assassin');
});

s.group('隐藏身份只给该看的信息', function () {
  var bad = 0;
  for (var seed = 1; seed <= 25; seed++) {
    var g = E.createGame({ seed: seed });
    var merlin = E.merlinId(g);
    var percival = E.percivalId(g);
    var morgana = E.morganaId(g);
    var assassin = E.assassinId(g);
    var loyal = E.loyalIds(g)[0];
    var mv = E.publicView(g, merlin);
    var pv = E.publicView(g, percival);
    var av = E.publicView(g, assassin);
    var ov = E.publicView(g, morgana);
    var lv = E.publicView(g, loyal);
    if (mv.roleKnowledge.filter(function (k) { return k.role === 'evil'; }).length !== 2) bad++;
    if (mv.roleKnowledge[merlin].role !== 'you') bad++;
    if (pv.roleKnowledge.filter(function (k) { return k.role === 'magic'; }).length !== 2) bad++;
    if (pv.roleKnowledge[merlin].role !== 'magic' || pv.roleKnowledge[morgana].role !== 'magic') bad++;
    if (av.roleKnowledge[morgana].role !== 'evil-ally') bad++;
    if (ov.roleKnowledge[assassin].role !== 'evil-ally') bad++;
    if (lv.roleKnowledge.filter(function (k) { return k.role !== 'unknown' && k.role !== 'you'; }).length !== 0) bad++;
    if (av.roleKnowledge[merlin].role !== 'unknown') bad++;
    if (pv.roleKnowledge[assassin].role !== 'unknown') bad++;
  }
  s.eq('25 局角色知识矩阵全部正确', bad, 0);

  var g2 = E.createGame({ seed: 31 });
  var merlin = E.merlinId(g2);
  var view = E.publicView(g2, merlin);
  s.eq('进行中不公开他人身份', view.players.every(function (p) { return p.revealedRole === null; }), true);
  s.eq('进行中 reveal 为空', view.reveal, null);
  s.eq('公共视图不含 state 角色字段', view.players.every(function (p) { return p.role === undefined; }), true);
  s.eq('自己的角色只出现一次', view.yourRole, 'merlin');
  var publicPayload = JSON.stringify({ players: view.players, roleKnowledge: view.roleKnowledge, history: view.history });
  s.eq('梅林视野里不含莫甘娜角色名', publicPayload.indexOf('morgana'), -1);
  s.eq('梅林视野里不含刺客角色名', publicPayload.indexOf('assassin'), -1);
  s.eq('梅林视野里不含派西维尔角色名', publicPayload.indexOf('percival'), -1);
  var evil = E.assassinId(g2);
  var evilView = E.publicView(g2, evil);
  s.eq('邪恶玩家自己的身份正确', evilView.yourRole, 'assassin');
  s.eq('邪恶玩家看不到梅林', JSON.stringify({ players: evilView.players, roleKnowledge: evilView.roleKnowledge }).indexOf('merlin'), -1);
  var loyal = E.loyalIds(g2)[0];
  var loyalView = E.publicView(g2, loyal);
  s.eq('忠臣没有额外情报', loyalView.roleKnowledge.filter(function (k) { return k.role !== 'unknown' && k.role !== 'you'; }).length, 0);
  s.eq('进行中日志不泄露角色名', /梅林|莫甘娜|刺客|派西维尔/.test(view.log.join(' ')), false);
});

s.group('AI 自对弈与不变量', function () {
  var ends = 0, teamSizeBad = 0, voteBad = 0, missionBad = 0, winnerBad = 0;
  var assassinBad = 0, serialBad = 0, roleBad = 0;
  for (var seed = 1; seed <= 40; seed++) {
    var g = E.selfPlay(seed);
    if (g.phase === 'over') ends++;
    if (g.winner !== 'good' && g.winner !== 'evil') winnerBad++;
    if (g.missions.good + g.missions.evil > 5) badCount();
    g.history.forEach(function (h) {
      if (h.team.length !== E.QUEST_SIZES[h.quest]) teamSizeBad++;
      if (h.approved != null && (!Array.isArray(h.votes) || h.votes.length !== 5)) voteBad++;
      if (h.failCount != null) {
        var evilOnTeam = h.team.filter(function (i) { return g.players[i].evil; }).length;
        if (h.failCount > evilOnTeam) missionBad++;
      }
    });
    var goodCount = g.players.filter(function (p) { return !p.evil; }).length;
    if (goodCount !== 3) roleBad++;
    if (g.phase === 'over' && g.quests.filter(function (q) { return q.result; }).length !== g.missions.good + g.missions.evil) serialBad++;
    if (g.winner === 'good' && g.phase === 'over' && g.assassinTarget != null) {
      if (g.assassinTarget === E.assassinId(g)) assassinBad++;
      if (g.players[g.assassinTarget] && g.players[g.assassinTarget].evil) assassinBad++;
    }
  }
  function badCount() { serialBad++; }
  s.eq('40 局全部结束', ends, 40);
  s.eq('40 局赢家均合法', winnerBad, 0);
  s.eq('40 局任务队伍人数符合官方表', teamSizeBad, 0);
  s.eq('40 局已结算投票都有 5 票记录', voteBad, 0);
  s.eq('40 局失败票不超过队伍邪恶人数', missionBad, 0);
  s.eq('40 局身份组成始终 3 好 2 坏', roleBad, 0);
  s.eq('40 局任务轨道与比分一致', serialBad, 0);
  s.eq('AI 刺客从不暗杀自己或同伙', assassinBad, 0);
  var a = E.selfPlay(77);
  var b = E.selfPlay(77);
  s.eq('同种子自对弈可复现', {
    winner: a.winner, quests: a.quests, missions: a.missions
  }, {
    winner: b.winner, quests: b.quests, missions: b.missions
  });
  s.ok('自对弈状态可 JSON 序列化', JSON.stringify(a).length > 100);
});

s.group('数据文件与 B 站来源', function () {
  s.eq('标题正确', D.title, 'Avalon 阿瓦隆');
  s.eq('人数说明正确', D.players, '5 人（官方基础版）');
  s.eq('任务表与引擎一致', D.questSizes, E.QUEST_SIZES);
  s.eq('5 人局失败阈值一致', D.questFailCards, [1, 1, 1, 1, 1]);
  s.eq('角色数量表正确', D.roleCounts, { merlin: 1, percival: 1, loyal: 1, morgana: 1, assassin: 1 });
  s.eq('来源至少 3 条', D.sources.length >= 3, true);
  var bvs = D.sources.map(function (src) { return src.bv; });
  ['BV1Ym4y1Q7Gq', 'BV16CYPzLE7p', 'BV1JZtZetESQ'].forEach(function (bv) {
    s.ok('包含来源 ' + bv, bvs.indexOf(bv) >= 0);
  });
  D.sources.forEach(function (src, i) {
    s.ok('来源 ' + (i + 1) + ' 有标题', typeof src.title === 'string' && src.title.length > 3);
    s.ok('来源 ' + (i + 1) + ' 有 UP', typeof src.up === 'string' && src.up.length > 1);
    s.ok('来源 ' + (i + 1) + ' 链接是 B 站', /^https:\/\/www\.bilibili\.com\/video\/BV/.test(src.url));
    s.ok('来源 ' + (i + 1) + ' 有规则要点', Array.isArray(src.points) && src.points.length >= 2);
  });
  ['merlin', 'percival', 'loyal', 'morgana', 'assassin'].forEach(function (role) {
    s.ok('角色文案存在 ' + role, D.roles[role] && D.roles[role].name && D.roles[role].ability);
  });
});

s.group('页面静态检查', function () {
  var html = read('index.html');
  s.ok('index 使用本地 data.js', html.indexOf('<script src="data.js">') >= 0);
  s.ok('index 使用本地 engine.js', html.indexOf('<script src="engine.js">') >= 0);
  s.ok('页面复用共享洗牌模块', html.indexOf('../../shared/shuffle.js') >= 0);
  s.ok('页面复用共享音效模块', html.indexOf('../../shared/sfx.js') >= 0);
  s.ok('页面不再自建 AudioContext', html.indexOf('AudioContext') === -1 && html.indexOf('createOscillator') === -1);
  s.ok('页面有 ARIA 实时区域', html.indexOf('aria-live') >= 0);
  s.ok('页面包含 5 个任务轨道', html.indexOf('id="questTrack"') >= 0);
  s.ok('页面包含圆桌', html.indexOf('id="tableRound"') >= 0);
  s.ok('页面包含身份卡', html.indexOf('id="roleCard"') >= 0);
  s.ok('页面包含暗杀目标按钮容器', html.indexOf('id="actions"') >= 0);
  s.ok('页面有主题按钮', html.indexOf('id="themeBtn"') >= 0);
  s.ok('页面有静音按钮', html.indexOf('id="muteBtn"') >= 0);
  s.ok('页面声明 viewport', html.indexOf('width=device-width') >= 0);
  s.ok('页面使用宋体标题', html.indexOf('Songti SC') >= 0);
  s.ok('页面有至少 3 组关键帧动画', (html.match(/@keyframes/g) || []).length >= 3);
  s.ok('页面支持 reduced motion', html.indexOf('prefers-reduced-motion') >= 0);
  s.ok('页面有 52px 触控变量', html.indexOf('--tap:52px') >= 0);
  s.ok('页面有深色背景变量', html.indexOf('--bg:#0b1220') >= 0);
  s.ok('页面有浅色主题变量', html.indexOf('--bg:#ece3d2') >= 0);
  s.ok('页面无远程脚本', !/<script[^>]+src=["']https?:/i.test(html));
  s.ok('页面无远程样式', !/<link[^>]+href=["']https?:/i.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('页面无远程图片', !/<img[^>]+src=["']https?:/i.test(html));
  s.ok('index 链接联机页', html.indexOf('online.html') >= 0);
  s.ok('index 链接规则页', html.indexOf('rules.html') >= 0);
  s.ok('离线由大厅 /games/sw.js 统一接管', html.indexOf('serviceWorker') === -1);
  s.ok('不内联 per-game SW 清单', !fs.existsSync(path.join(__dirname, 'sw.js')));
});

s.group('规则页与交付产物', function () {
  var rules = read('rules.html');
  s.ok('规则页 1200+ 汉字', chineseCount(rules) >= 1200, 'got ' + chineseCount(rules));
  s.ok('规则页 Article JSON-LD', rules.indexOf('"@type": "Article"') >= 0);
  s.ok('规则页 FAQPage JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('规则页含两张详情配图', (rules.match(/assets\/detail-[12]\.webp/g) || []).length >= 2);
  s.ok('规则页包含三条 BV 号', (rules.match(/BV[0-9A-Za-z]+/g) || []).length >= 3);
  s.ok('规则页包含官方任务表', rules.indexOf('<table>') >= 0 && rules.indexOf('任务 4') >= 0);
  s.ok('规则页写明 5 人局一票失败', /5 人局|五人局/.test(rules) && /1 张失败|一张失败|一票失败/.test(rules));
  s.ok('规则页写明 7 人以上任务 4 需两张失败', /7 人以上|七人以上|8 人/.test(rules) && /两张失败|2 张失败/.test(rules));
  s.ok('规则页链接联机页', rules.indexOf('online.html') >= 0);
  s.ok('规则页无远程图片', !/<img[^>]+src=["']https?:/i.test(rules));

  ['engine.js', 'data.js', 'index.html', 'rules.html', 'online.html', 'online-server.mjs',
    'test.js', 'test-online.js', 'e2e.mjs', 'art-render.html', 'render-art.mjs',
    'meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md',
    'online-e2e.json', 'assets/cover.webp', 'assets/og.webp',
    'assets/detail-1.webp', 'assets/detail-2.webp'
  ].forEach(function (name) {
    s.ok('存在 ' + name, fs.existsSync(path.join(__dirname, name)));
  });

  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'avalon-premium');
  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 人数下限 5', meta.players.min, 5);
  s.eq('meta 人数上限 5', meta.players.max, 5);
  s.ok('meta 声明联机 ready', meta.online && meta.online.status === 'ready');
  s.ok('meta 声明 AI 补到 5 人', /5/.test(meta.online.features.aiFill));
  var realism = JSON.parse(read('realism.json'));
  s.ok('realism pass', realism.pass === true);
  s.ok('realism 至少 3 项', realism.checks.length >= 3, String(realism.checks.length));
  s.ok('realism 至少 3 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 3);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  var online = JSON.parse(read('online-e2e.json'));
  s.eq('online-e2e clients=2', online.clients, 2);
  s.eq('online-e2e sameGame', online.sameGame, true);
  s.eq('online-e2e 同局结算一致', online.settlementConsistent, true);
  s.eq('online-e2e 重连', online.reconnect, true);
  s.eq('online-e2e 超时接管', online.timeoutTakeover, true);
  s.eq('online-e2e 排行榜', online.leaderboard, true);
  s.eq('online-e2e 纳入 run-all', online.runAll, true);
  s.eq('online-e2e 控制组 exit 1', online.controlledFailure.exitCode, 1);
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端使用逐座位公共视图', server.indexOf('publicView') >= 0);
  s.ok('服务端权威判定任务与暗杀', server.indexOf('proposeTeam') >= 0 && server.indexOf('castMission') >= 0 && server.indexOf('assassinate') >= 0);
  var onlineHtml = read('online.html');
  s.ok('联机页含创建/加入/排行榜', onlineHtml.indexOf('createBtn') >= 0 && onlineHtml.indexOf('joinBtn') >= 0 && onlineHtml.indexOf('leaderboard') >= 0);
  s.ok('联机页含邀请复制', onlineHtml.indexOf('inviteBtn') >= 0);
  s.ok('联机页含重赛', onlineHtml.indexOf('restartBtn') >= 0);
  s.ok('联机页展示身份知识', onlineHtml.indexOf('roleKnowledge') >= 0);
  s.ok('联机页无远程脚本', !/<script[^>]+src=["']https?:/i.test(onlineHtml));
  var e2e = read('e2e.mjs');
  s.ok('e2e 有 --control 退出 1', e2e.indexOf('--control') >= 0 && e2e.indexOf('exit 1') >= 0);
  s.ok('e2e 包含浏览器联机段', /Online room|online room/.test(e2e));
  s.ok('e2e 校验 390x844 与 320x568', e2e.indexOf('390x844') >= 0 && e2e.indexOf('320x568') >= 0);
});

s.group('共享 precache 清单', function () {
  var root = path.join(__dirname, '..', '..');
  var manifestPath = path.join(root, 'precache-manifest.js');
  var indexHtml = read('index.html');
  s.ok('index 不写死 per-game SW 清单', indexHtml.indexOf('serviceWorker') === -1);
  if (!fs.existsSync(manifestPath)) {
    s.ok('v22 manifest 待合并生成', true);
    return;
  }
  var manifest = fs.readFileSync(manifestPath, 'utf8');
  var sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  var cacheVersion = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
  var manifestVersion = (manifest.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
  s.eq('manifest 版本与 CACHE_VERSION 同步', manifestVersion, cacheVersion);
  s.ok('manifest 收录本游戏页面', manifest.indexOf('/games/boardgame/avalon-premium/') >= 0);
  s.ok('manifest 收录共享洗牌/音效', manifest.indexOf('/games/shared/shuffle.js') >= 0 && manifest.indexOf('/games/shared/sfx.js') >= 0);
});

s.done();
