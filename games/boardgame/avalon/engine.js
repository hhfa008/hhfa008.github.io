/* Avalon (阿瓦隆) 简化版 — pure UMD rules engine.
 * 5 players: Merlin, Assassin, 2 Loyal Servants, 1 Minion.
 * 3 quests (team sizes 2/3/2), good must win 2 then survive the assassination.
 * Node: require('./engine.js'); browser: window.AvalonEngine
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvalonEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PLAYER_NAMES = ['你', '蓝骑士', '灰袍', '红隼', '夜莺'];
  var ROLES = ['merlin', 'assassin', 'loyal', 'loyal', 'minion'];
  var ROLE_NAMES = {
    merlin: '梅林', assassin: '刺客', loyal: '忠臣', minion: '爪牙'
  };
  var QUEST_SIZES = [2, 3, 2];
  var MAX_REJECTS = 5;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function isEvil(role) { return role === 'assassin' || role === 'minion'; }
  function isGood(role) { return !isEvil(role); }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var names = opts.names || PLAYER_NAMES;
    if (names.length !== 5) throw new Error('Avalon needs exactly 5 names');
    var dealt = shuffle(ROLES, rng);
    var players = [];
    for (var i = 0; i < 5; i++) {
      players.push({
        name: names[i],
        human: i === 0,
        role: dealt[i],
        evil: isEvil(dealt[i])
      });
    }
    var state = {
      seed: seed,
      rng: rng,
      players: players,
      quest: 0,
      leader: 0,
      team: [],
      votes: players.map(function () { return null; }),
      missionVotes: {},
      rejects: 0,
      phase: 'propose', // propose | vote | mission | assassin | over
      history: [],
      winner: null,
      winReason: '',
      log: [],
      stepCount: 0
    };
    log(state, '第 1 次任务：' + players[0].name + ' 担任队长，需选出 ' + QUEST_SIZES[0] + ' 人');
    return state;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 60) state.log.shift();
  }

  function teamSize(state) { return QUEST_SIZES[state.quest]; }

  function evilPlayers(state) {
    return state.players.map(function (p, i) { return i; }).filter(function (i) {
      return state.players[i].evil;
    });
  }

  function merlinId(state) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].role === 'merlin') return i;
    return -1;
  }

  function assassinId(state) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].role === 'assassin') return i;
    return -1;
  }

  function legalProposal(state, player, team) {
    if (state.phase !== 'propose' || player !== state.leader) return false;
    if (!Array.isArray(team) || team.length !== teamSize(state)) return false;
    var seen = {};
    for (var i = 0; i < team.length; i++) {
      var t = team[i];
      if (typeof t !== 'number' || t < 0 || t >= state.players.length) return false;
      if (seen[t]) return false;
      seen[t] = true;
    }
    return true;
  }

  function proposeTeam(state, player, team) {
    if (!legalProposal(state, player, team)) throw new Error('illegal team proposal');
    state.team = team.slice().sort(function (a, b) { return a - b; });
    state.votes = state.players.map(function () { return null; });
    state.phase = 'vote';
    log(state, state.players[player].name + ' 提名队伍：' +
      state.team.map(function (i) { return state.players[i].name; }).join('、'));
    return state;
  }

  function castVote(state, player, approve) {
    if (state.phase !== 'vote') throw new Error('not voting phase');
    if (player < 0 || player >= state.players.length) throw new Error('bad voter');
    if (state.votes[player] != null) throw new Error('already voted');
    state.votes[player] = !!approve;
    if (state.votes.every(function (v) { return v != null; })) resolveVote(state);
    return state;
  }

  function aiVote(state, player) {
    var p = state.players[player];
    var team = state.team;
    var teamEvil = team.some(function (i) { return state.players[i].evil; });
    if (p.evil) {
      if (team.some(function (i) { return state.players[i].evil; })) return true;
      return state.rng() < 0.3;
    }
    if (p.role === 'merlin') return !teamEvil;
    // Loyal servant: distrust anyone who was on a failed quest.
    var tainted = {};
    state.history.forEach(function (h) {
      if (h.failCount > 0) h.team.forEach(function (i) { tainted[i] = 1; });
    });
    var hasTainted = team.some(function (i) { return tainted[i]; });
    if (state.rejects >= 3) return state.rng() < 0.85;
    if (hasTainted) return state.rng() < 0.2;
    return state.rng() < 0.8;
  }

  function resolveVote(state) {
    var yes = state.votes.filter(function (v) { return v === true; }).length;
    var approved = yes > state.players.length / 2;
    state.history.push({
      quest: state.quest, team: state.team.slice(), votes: state.votes.slice(),
      approved: approved, failCount: null, winner: null
    });
    log(state, '投票 ' + yes + ' 赞成 / ' + (state.players.length - yes) + ' 反对，队伍' +
      (approved ? '通过' : '被否决'));
    if (approved) {
      state.rejects = 0;
      state.phase = 'mission';
      state.missionVotes = {};
      log(state, '队伍成员请秘密表决任务成败');
    } else {
      state.rejects++;
      if (state.rejects >= MAX_REJECTS) {
        finish(state, 'evil', '连续 ' + MAX_REJECTS + ' 次组队被否决');
        return;
      }
      state.leader = (state.leader + 1) % state.players.length;
      state.team = [];
      state.votes = state.players.map(function () { return null; });
      state.phase = 'propose';
      log(state, '队长轮到 ' + state.players[state.leader].name + '（连续否决 ' + state.rejects + ' 次）');
    }
  }

  function castMission(state, player, fail) {
    if (state.phase !== 'mission') throw new Error('not mission phase');
    if (state.team.indexOf(player) < 0) throw new Error('not on team');
    if (state.missionVotes[player] != null) throw new Error('already voted');
    if (!state.players[player].evil && fail) throw new Error('good players must succeed');
    state.missionVotes[player] = !!fail;
    if (state.team.every(function (i) { return state.missionVotes[i] != null; })) resolveMission(state);
    return state;
  }

  function aiMission(state, player) {
    return state.players[player].evil && state.rng() < 0.75;
  }

  function resolveMission(state) {
    var failCount = state.team.filter(function (i) { return state.missionVotes[i] === true; }).length;
    var failed = failCount > 0;
    var h = state.history[state.history.length - 1];
    h.failCount = failCount;
    h.winner = failed ? 'evil' : 'good';
    log(state, '第 ' + (state.quest + 1) + ' 次任务' + (failed ? '失败' : '成功') +
      '（破坏票 ' + failCount + ' 张）');
    state.missions = state.missions || { good: 0, evil: 0 };
    state.missions[failed ? 'evil' : 'good']++;
    if (state.missions.evil >= 2) {
      finish(state, 'evil', '邪恶阵营赢下两次任务');
      return;
    }
    if (state.missions.good >= 2) {
      state.phase = 'assassin';
      log(state, '正义方赢下两次任务！刺客现在可以暗杀梅林');
      return;
    }
    state.quest++;
    state.leader = (state.leader + 1) % state.players.length;
    state.team = [];
    state.votes = state.players.map(function () { return null; });
    state.missionVotes = {};
    state.phase = 'propose';
    log(state, '第 ' + (state.quest + 1) + ' 次任务：' + state.players[state.leader].name +
      ' 担任队长，需选出 ' + teamSize(state) + ' 人');
  }

  function assassinate(state, player, target) {
    if (state.phase !== 'assassin') throw new Error('not assassin phase');
    if (player !== assassinId(state)) throw new Error('only the assassin may strike');
    if (target < 0 || target >= state.players.length || target === player) throw new Error('bad target');
    var merlin = merlinId(state);
    if (target === merlin) finish(state, 'evil', '刺客成功暗杀梅林');
    else finish(state, 'good', '刺客暗杀了 ' + state.players[target].name + '，梅林幸存');
    return state;
  }

  function aiAssassinate(state) {
    var me = assassinId(state);
    var merlin = merlinId(state);
    var best = -1, bestScore = -Infinity;
    for (var i = 0; i < state.players.length; i++) {
      if (i === me || state.players[i].evil) continue;
      var score = 0;
      state.history.forEach(function (h) {
        var vote = h.votes[i];
        if (vote == null) return;
        var teamHasEvil = h.team.some(function (t) { return state.players[t].evil; });
        if (teamHasEvil && vote === false) score += 2; // looks like Merlin
        if (!teamHasEvil && h.approved && vote === true) score += 1;
      });
      // A tiny random nudge avoids deterministic self-play.
      score += state.rng() * 1.2;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) best = (me + 1) % state.players.length;
    if (best === me) best = merlin === me ? (me + 1) % 5 : merlin;
    log(state, '刺客将目标指向 ' + state.players[best].name);
    assassinate(state, me, best);
    return best;
  }

  function finish(state, winner, reason) {
    state.phase = 'over';
    state.winner = winner;
    state.winReason = reason;
    log(state, (winner === 'good' ? '正义方' : '邪恶方') + '获胜：' + reason);
  }

  // --- AI driving ---------------------------------------------------------

  function aiPropose(state) {
    var me = state.leader;
    var p = state.players[me];
    var need = teamSize(state);
    var others = [];
    for (var i = 0; i < state.players.length; i++) if (i !== me) others.push(i);
    others.sort(function (a, b) {
      var sa = 0, sb = 0;
      if (p.role === 'merlin') {
        sa = state.players[a].evil ? 100 : state.rng();
        sb = state.players[b].evil ? 100 : state.rng();
      } else if (p.evil) {
        sa = state.players[a].evil ? -5 : state.rng();
        sb = state.players[b].evil ? -5 : state.rng();
      } else {
        sa = state.rng();
        sb = state.rng();
      }
      return sa - sb;
    });
    var team = [me].concat(others.slice(0, need - 1));
    proposeTeam(state, me, team);
    return team;
  }

  function fillVotes(state) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.votes[i] == null) castVote(state, i, aiVote(state, i));
      if (state.phase !== 'vote') break;
    }
  }

  function fillMissions(state) {
    for (var k = 0; k < state.team.length; k++) {
      var i = state.team[k];
      if (state.missionVotes[i] == null) castMission(state, i, aiMission(state, i));
      if (state.phase !== 'mission') break;
    }
  }

  function step(state) {
    if (state.phase === 'over') return { over: true };
    state.stepCount++;
    if (state.stepCount > 10000) throw new Error('step limit: possible loop');
    if (state.phase === 'propose') {
      if (state.leader !== 0) return { type: 'propose', team: aiPropose(state) };
      return { needsHuman: true, phase: 'propose' };
    }
    if (state.phase === 'vote') {
      if (state.votes[0] == null) return { needsHuman: true, phase: 'vote' };
      fillVotes(state);
      return { type: 'votes' };
    }
    if (state.phase === 'mission') {
      if (state.team.indexOf(0) >= 0 && state.missionVotes[0] == null) {
        return { needsHuman: true, phase: 'mission' };
      }
      fillMissions(state);
      return { type: 'missions' };
    }
    if (state.phase === 'assassin') {
      if (assassinId(state) !== 0) return { type: 'assassinate', target: aiAssassinate(state) };
      return { needsHuman: true, phase: 'assassin' };
    }
    return { over: true };
  }

  function selfPlay(seed) {
    var state = createGame({ seed: seed });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 10000) throw new Error('no progress');
      if (state.phase === 'propose') aiPropose(state);
      else if (state.phase === 'vote') fillVotes(state);
      else if (state.phase === 'mission') fillMissions(state);
      else if (state.phase === 'assassin') aiAssassinate(state);
    }
    return state;
  }

  function visibleRole(state, viewer, i) {
    if (i === viewer) return state.players[i].role;
    var mine = state.players[viewer].role;
    if (mine === 'merlin' && state.players[i].evil) return 'evil-known';
    if (isEvil(mine) && state.players[i].evil) return 'evil-ally';
    return 'unknown';
  }

  function publicView(state, viewer) {
    return {
      phase: state.phase,
      quest: state.quest,
      teamSize: state.phase === 'over' ? null : teamSize(state),
      leader: state.leader,
      team: state.team.slice(),
      votes: state.votes.slice(),
      rejects: state.rejects,
      missions: state.missions || { good: 0, evil: 0 },
      yourRole: state.players[viewer].role,
      roleKnowledge: state.players.map(function (p, i) {
        return { player: i, role: visibleRole(state, viewer, i) };
      }),
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          human: i === viewer,
          leader: i === state.leader,
          onTeam: state.team.indexOf(i) >= 0,
          revealedRole: state.phase === 'over' ? p.role : 'unknown',
          voted: state.votes[i]
        };
      }),
      history: state.history.map(function (h) {
        return {
          quest: h.quest, team: h.team.slice(), approved: h.approved,
          failCount: h.failCount, winner: h.winner
        };
      }),
      winner: state.winner,
      winReason: state.winReason,
      log: state.log.slice()
    };
  }

  return {
    createGame: createGame,
    proposeTeam: proposeTeam,
    castVote: castVote,
    castMission: castMission,
    assassinate: assassinate,
    legalProposal: legalProposal,
    aiVote: aiVote,
    aiMission: aiMission,
    aiPropose: aiPropose,
    aiAssassinate: aiAssassinate,
    fillVotes: fillVotes,
    fillMissions: fillMissions,
    step: step,
    selfPlay: selfPlay,
    publicView: publicView,
    isEvil: isEvil,
    merlinId: merlinId,
    assassinId: assassinId,
    evilPlayers: evilPlayers,
    teamSize: teamSize,
    ROLES: ROLES,
    ROLE_NAMES: ROLE_NAMES,
    QUEST_SIZES: QUEST_SIZES,
    MAX_REJECTS: MAX_REJECTS,
    mulberry32: mulberry32
  };
});
