/* Avalon (阿瓦隆) — premium UMD rules engine for the official 5-player base game.
 *
 * Node: require('./engine.js'); browser: window.AvalonPremiumEngine
 *
 * Official 5-player base game, no expansions:
 *   Good: Merlin, Percival, Loyal Servant (3)
 *   Evil: Morgana, Assassin (2)
 *   Quests: 5, team sizes [2, 3, 2, 3, 3].
 *   For five players every quest needs only ONE fail card (the "two fails on
 *   quest 4" rule only applies to games with 7+ players; it is not used here).
 *   Good must win 3 quests, after which the Assassin gets one shot at Merlin.
 *   Evil wins by failing 3 quests, by five consecutive rejected proposals, or
 *   by assassinating Merlin.
 *
 * Hidden information:
 *   - publicView(viewer) never serialises another seat's role; it only returns
 *     the viewer's own role plus a roleKnowledge token per seat:
 *       'you'       your own seat
 *       'evil'      Merlin's knowledge: this seat is evil
 *       'magic'     Percival's knowledge: Merlin OR Morgana (indistinguishable)
 *       'evil-ally' an evil player's knowledge: this seat is also evil
 *       'unknown'   no information
 *   - Individual approval votes are hidden while the vote is still open and
 *     become public in history once it resolves (simultaneous show-of-hands).
 *   - Mission cards are never attributed; only the fail count is revealed.
 *   - All roles are revealed only after state.phase === 'over'.
 *
 * The engine is JSON-serialisable: no functions, promises or class instances
 * live on state. AI randomness uses state.rngState; the role deal uses the
 * repo-wide seeded Fisher-Yates in games/shared/shuffle.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.AvalonPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Reuse the repo-wide seeded shuffle. No per-game shuffle copy.
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('AvalonPremiumEngine requires games/shared/shuffle.js');
  }

  var ROLES = ['merlin', 'percival', 'loyal', 'morgana', 'assassin'];
  var ROLE_NAMES = {
    merlin: '梅林',
    percival: '派西维尔',
    loyal: '忠臣',
    morgana: '莫甘娜',
    assassin: '刺客'
  };
  var ROLE_SIDES = {
    merlin: 'good',
    percival: 'good',
    loyal: 'good',
    morgana: 'evil',
    assassin: 'evil'
  };
  var ROLE_COUNTS = { merlin: 1, percival: 1, loyal: 1, morgana: 1, assassin: 1 };
  var ROLE_ORDER = ['merlin', 'percival', 'loyal', 'morgana', 'assassin'];

  var PLAYER_COUNT = 5;
  var QUEST_SIZES = [2, 3, 2, 3, 3];
  // Official 5-player table: every quest fails on the first fail card.
  var FAILS_TO_FAIL = [1, 1, 1, 1, 1];
  var MAX_REJECTS = 5;
  var QUESTS_TO_WIN = 3;
  var DEFAULT_NAMES = ['你', '蓝骑士', '灰袍', '红隼', '夜莺'];
  var DEFAULT_SEED = 20261110;

  // Serializable PRNG step for AI-only variance. The deal itself is seeded by
  // the shared shuffle; keeping this counter in state makes a match cloneable
  // and replayable over plain JSON.
  function nextRandom(state) {
    var a = (state.rngState | 0) + 0x6D2B79F5 | 0;
    state.rngState = a;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  function isEvil(role) {
    return role === 'morgana' || role === 'assassin';
  }
  function isGood(role) {
    return !isEvil(role);
  }
  function roleSide(role) {
    return ROLE_SIDES[role] || 'unknown';
  }
  function roleName(role) {
    return ROLE_NAMES[role] || String(role || '');
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 120) state.log.shift();
  }
  function emit(state, event) {
    state.events.push(event);
    if (state.events.length > 160) state.events.shift();
  }

  function makeNullVotes() {
    return [null, null, null, null, null];
  }

  function emptyQuests() {
    return QUEST_SIZES.map(function (size, index) {
      return { index: index, size: size, result: null, winner: null, failCount: null, team: [], approved: null };
    });
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? DEFAULT_SEED : opts.seed;
    var names = opts.names || DEFAULT_NAMES;
    if (!Array.isArray(names) || names.length !== PLAYER_COUNT) {
      throw new Error('Avalon needs exactly ' + PLAYER_COUNT + ' player names');
    }
    var dealt = ShuffleApi.shuffle(ROLES, { seed: seed });
    var players = [];
    for (var i = 0; i < PLAYER_COUNT; i++) {
      players.push({
        id: i,
        name: String(names[i]),
        human: i === 0,
        role: dealt[i],
        evil: isEvil(dealt[i])
      });
    }
    var state = {
      version: 1,
      seed: seed,
      rngState: ((Number(seed) | 0) || 1),
      players: players,
      questIndex: 0,
      quests: emptyQuests(),
      missions: { good: 0, evil: 0 },
      leader: 0,
      team: [],
      votes: makeNullVotes(),
      missionVotes: {},
      rejects: 0,
      phase: 'propose', // propose | vote | mission | assassin | over
      history: [],
      winner: null,
      winReason: '',
      assassinTarget: null,
      log: [],
      events: [],
      stepCount: 0,
      proposalCount: 0
    };
    log(state, '五人阿瓦隆开局：第 1 次任务由 ' + players[0].name + ' 担任队长，需选出 ' + QUEST_SIZES[0] + ' 人');
    emit(state, { type: 'start', seed: seed, leader: 0, quest: 0, size: QUEST_SIZES[0] });
    return state;
  }

  function teamSize(state) {
    var index = state.phase === 'over'
      ? Math.min(state.questIndex, QUEST_SIZES.length - 1)
      : state.questIndex;
    return QUEST_SIZES[Math.max(0, Math.min(QUEST_SIZES.length - 1, index))];
  }

  function failsRequired(state) {
    var index = state.phase === 'over'
      ? Math.min(state.questIndex, FAILS_TO_FAIL.length - 1)
      : state.questIndex;
    return FAILS_TO_FAIL[Math.max(0, Math.min(FAILS_TO_FAIL.length - 1, index))];
  }

  function evilPlayers(state) {
    var out = [];
    state.players.forEach(function (p, i) { if (p.evil) out.push(i); });
    return out;
  }
  function merlinId(state) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].role === 'merlin') return i;
    return -1;
  }
  function percivalId(state) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].role === 'percival') return i;
    return -1;
  }
  function morganaId(state) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].role === 'morgana') return i;
    return -1;
  }
  function assassinId(state) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].role === 'assassin') return i;
    return -1;
  }
  function loyalIds(state) {
    var out = [];
    state.players.forEach(function (p, i) { if (p.role === 'loyal') out.push(i); });
    return out;
  }

  // ------------------------------------------------------------------------
  // Legal checks
  // ------------------------------------------------------------------------

  function legalProposal(state, seat, team) {
    if (!state || state.phase !== 'propose') return false;
    if (seat !== state.leader) return false;
    if (!Array.isArray(team) || team.length !== teamSize(state)) return false;
    var seen = {};
    for (var i = 0; i < team.length; i++) {
      var t = team[i];
      if (typeof t !== 'number' || t % 1 !== 0 || t < 0 || t >= PLAYER_COUNT) return false;
      if (seen[t]) return false;
      seen[t] = true;
    }
    return true;
  }

  function legalVote(state, seat) {
    return !!state && state.phase === 'vote' && seat >= 0 && seat < PLAYER_COUNT && state.votes[seat] == null;
  }

  function legalMission(state, seat) {
    return !!state && state.phase === 'mission' &&
      seat >= 0 && seat < PLAYER_COUNT &&
      state.team.indexOf(seat) >= 0 && state.missionVotes[seat] == null;
  }

  function legalAssassination(state, seat, target) {
    return !!state && state.phase === 'assassin' &&
      seat === assassinId(state) &&
      typeof target === 'number' && target % 1 === 0 &&
      target >= 0 && target < PLAYER_COUNT && target !== seat;
  }

  // ------------------------------------------------------------------------
  // Propose / vote
  // ------------------------------------------------------------------------

  function proposeTeam(state, seat, team) {
    if (!legalProposal(state, seat, team)) throw new Error('illegal team proposal');
    state.team = team.slice().sort(function (a, b) { return a - b; });
    state.votes = makeNullVotes();
    state.missionVotes = {};
    state.phase = 'vote';
    state.proposalCount += 1;
    state.stepCount += 1;
    var entry = {
      quest: state.questIndex,
      team: state.team.slice(),
      votes: null,
      approved: null,
      yes: null,
      no: null,
      failCount: null,
      result: null,
      winner: null
    };
    state.history.push(entry);
    log(state, '第 ' + (state.questIndex + 1) + ' 次任务 · ' + state.players[seat].name + ' 提名队伍：' +
      state.team.map(function (i) { return state.players[i].name; }).join('、'));
    emit(state, { type: 'propose', quest: state.questIndex, leader: seat, team: state.team.slice(), size: teamSize(state) });
    return state;
  }

  function castVote(state, seat, approve) {
    if (!legalVote(state, seat)) throw new Error('illegal vote');
    state.votes[seat] = !!approve;
    state.stepCount += 1;
    emit(state, { type: 'vote-cast', seat: seat });
    log(state, state.players[seat].name + ' 已投票（票面保密）');
    if (state.votes.every(function (v) { return v != null; })) resolveVote(state);
    return state;
  }

  function resolveVote(state) {
    var entry = state.history[state.history.length - 1];
    var yes = state.votes.filter(function (v) { return v === true; }).length;
    var no = PLAYER_COUNT - yes;
    // Majority (strictly more than half). With five players that means 3+ yes;
    // a tie would be rejected by the same rule.
    var approved = yes > PLAYER_COUNT / 2;
    entry.votes = state.votes.slice();
    entry.approved = approved;
    entry.yes = yes;
    entry.no = no;
    log(state, '投票结果：' + yes + ' 赞成 / ' + no + ' 反对 · 队伍' + (approved ? '通过' : '被否决'));
    emit(state, { type: 'vote-result', approved: approved, yes: yes, no: no, quest: state.questIndex });
    if (approved) {
      state.rejects = 0;
      state.phase = 'mission';
      state.missionVotes = {};
      log(state, '队伍出发执行任务，成员秘密提交任务卡');
      emit(state, { type: 'mission-start', quest: state.questIndex, team: state.team.slice() });
      return;
    }
    state.rejects += 1;
    if (state.rejects >= MAX_REJECTS) {
      finish(state, 'evil', '连续 ' + MAX_REJECTS + ' 次组队被否决，邪恶方获胜');
      return;
    }
    state.leader = (state.leader + 1) % PLAYER_COUNT;
    state.team = [];
    state.votes = makeNullVotes();
    state.phase = 'propose';
    log(state, '队长轮到 ' + state.players[state.leader].name + '（连续否决 ' + state.rejects + ' 次）');
    emit(state, { type: 'rejected', rejects: state.rejects, leader: state.leader });
  }

  // ------------------------------------------------------------------------
  // Mission
  // ------------------------------------------------------------------------

  function castMission(state, seat, fail) {
    if (!legalMission(state, seat)) throw new Error('illegal mission card');
    if (fail && !state.players[seat].evil) throw new Error('good players must play success');
    state.missionVotes[seat] = !!fail;
    state.stepCount += 1;
    emit(state, { type: 'mission-cast', seat: seat });
    log(state, state.players[seat].name + ' 已提交任务卡');
    if (state.team.every(function (i) { return state.missionVotes[i] != null; })) resolveMission(state);
    return state;
  }

  function resolveMission(state) {
    var entry = state.history[state.history.length - 1];
    var failCount = state.team.filter(function (i) { return state.missionVotes[i] === true; }).length;
    var required = failsRequired(state);
    var failed = failCount >= required;
    var winner = failed ? 'evil' : 'good';
    var result = failed ? 'fail' : 'success';
    entry.failCount = failCount;
    entry.result = result;
    entry.winner = winner;
    var quest = state.quests[state.questIndex];
    quest.result = result;
    quest.winner = winner;
    quest.failCount = failCount;
    quest.team = state.team.slice();
    quest.approved = true;
    state.missions[winner] += 1;
    log(state, '第 ' + (state.questIndex + 1) + ' 次任务' + (failed ? '失败' : '成功') +
      '（破坏票 ' + failCount + ' 张，5 人局需 ' + required + ' 张）');
    emit(state, {
      type: 'mission-result', quest: state.questIndex, failCount: failCount,
      required: required, result: result, winner: winner
    });
    if (state.missions.evil >= QUESTS_TO_WIN) {
      finish(state, 'evil', '邪恶方成功破坏三次任务');
      return;
    }
    if (state.missions.good >= QUESTS_TO_WIN) {
      state.phase = 'assassin';
      state.team = [];
      state.votes = makeNullVotes();
      state.missionVotes = {};
      log(state, '正义方赢下三次任务！刺客现在可以暗杀梅林');
      emit(state, { type: 'assassin-phase', quest: state.questIndex });
      return;
    }
    state.questIndex += 1;
    state.leader = (state.leader + 1) % PLAYER_COUNT;
    state.team = [];
    state.votes = makeNullVotes();
    state.missionVotes = {};
    state.phase = 'propose';
    log(state, '第 ' + (state.questIndex + 1) + ' 次任务：' + state.players[state.leader].name +
      ' 担任队长，需选出 ' + teamSize(state) + ' 人');
    emit(state, { type: 'next-quest', quest: state.questIndex, leader: state.leader, size: teamSize(state) });
  }

  // ------------------------------------------------------------------------
  // Assassination / finish
  // ------------------------------------------------------------------------

  function assassinate(state, seat, target) {
    if (!legalAssassination(state, seat, target)) throw new Error('illegal assassination');
    state.assassinTarget = target;
    var merlin = merlinId(state);
    log(state, '刺客 ' + state.players[seat].name + ' 将暗杀目标指向 ' + state.players[target].name);
    emit(state, { type: 'assassinate', seat: seat, target: target });
    if (target === merlin) {
      finish(state, 'evil', '刺客暗杀了梅林，邪恶方翻盘获胜');
    } else {
      finish(state, 'good', '刺客暗杀了 ' + state.players[target].name + '，梅林幸存，正义方获胜');
    }
    return state;
  }

  function finish(state, winner, reason) {
    state.phase = 'over';
    state.winner = winner;
    state.winReason = reason;
    state.team = [];
    state.votes = makeNullVotes();
    state.missionVotes = {};
    log(state, (winner === 'good' ? '正义方' : '邪恶方') + '获胜：' + reason);
    emit(state, {
      type: 'over', winner: winner, reason: reason,
      merlin: merlinId(state), assassin: assassinId(state), target: state.assassinTarget,
      missions: { good: state.missions.good, evil: state.missions.evil }
    });
  }

  // ------------------------------------------------------------------------
  // AI
  // ------------------------------------------------------------------------

  // Deterministic team used by legalActions / tests. No RNG, so asking for
  // legal actions never mutates the match.
  function suggestTeam(state, seat) {
    if (!state || state.phase !== 'propose' || seat !== state.leader) return [];
    var size = teamSize(state);
    var leader = state.leader;
    var me = state.players[leader];
    var others = [];
    for (var i = 0; i < PLAYER_COUNT; i++) if (i !== leader) others.push(i);
    function key(i) {
      var p = state.players[i];
      if (me.role === 'merlin') return p.evil ? 1000 + i : i;
      if (me.role === 'percival') return (p.role === 'merlin' || p.role === 'morgana') ? -10 + i : i;
      if (me.evil) return p.evil ? -10 + i : i;
      return i;
    }
    others.sort(function (a, b) { return key(a) - key(b) || a - b; });
    return [leader].concat(others.slice(0, size - 1)).sort(function (a, b) { return a - b; });
  }

  function proposeScore(state, seat) {
    var me = state.players[state.leader];
    var p = state.players[seat];
    if (me.role === 'merlin') return p.evil ? -100 : 1;
    if (me.role === 'percival') return (p.role === 'merlin' || p.role === 'morgana') ? 2.4 : 1;
    if (me.evil) return p.evil ? 4 : 1;
    return 1;
  }

  function aiProposeTeam(state) {
    var size = teamSize(state);
    var leader = state.leader;
    var others = [];
    for (var i = 0; i < PLAYER_COUNT; i++) if (i !== leader) others.push(i);
    var scored = others.map(function (i) {
      return { seat: i, score: proposeScore(state, i) + nextRandom(state) * 1.8 };
    });
    scored.sort(function (a, b) { return b.score - a.score || a.seat - b.seat; });
    var team = [leader];
    for (var k = 0; k < scored.length && team.length < size; k++) team.push(scored[k].seat);
    return team.sort(function (a, b) { return a - b; });
  }

  function taintedSeats(state) {
    var tainted = {};
    state.history.forEach(function (h) {
      if (h.result !== 'fail') return;
      h.team.forEach(function (i) { tainted[i] = true; });
    });
    return tainted;
  }

  function aiVote(state, seat) {
    var p = state.players[seat];
    var team = state.team;
    var teamEvil = team.some(function (i) { return state.players[i].evil; });
    var teamMagic = team.filter(function (i) {
      return state.players[i].role === 'merlin' || state.players[i].role === 'morgana';
    }).length;
    var r = nextRandom(state);
    if (p.evil) {
      if (teamEvil) return r < 0.9;
      if (state.rejects >= 3) return r < 0.22; // push toward five rejections
      return r < 0.28;
    }
    if (p.role === 'merlin') {
      return teamEvil ? r < 0.1 : r < 0.92;
    }
    if (p.role === 'percival') {
      if (teamMagic >= 2) return r < 0.12;
      if (teamMagic === 1) return r < 0.72;
      return r < 0.78;
    }
    var tainted = taintedSeats(state);
    var dirty = team.some(function (i) { return tainted[i]; });
    if (dirty) return r < 0.18;
    if (state.rejects >= 3) return r < 0.86;
    return r < 0.8;
  }

  function aiMission(state, seat) {
    if (!state.players[seat].evil) return false;
    var r = nextRandom(state);
    // Failing quest 1 too eagerly makes the evil team obvious; keep a little
    // restraint early and fail decisively later.
    if (state.questIndex === 0) return r < 0.62;
    return r < 0.8;
  }

  function aiAssassinate(state) {
    var me = assassinId(state);
    var best = -1;
    var bestScore = -Infinity;
    for (var i = 0; i < PLAYER_COUNT; i++) {
      if (i === me || state.players[i].evil) continue;
      var score = nextRandom(state) * 0.9;
      state.history.forEach(function (h) {
        if (!h.votes || h.votes[i] == null) return;
        var teamHadEvil = h.team.some(function (t) { return state.players[t].evil; });
        if (h.votes[i] === false && teamHadEvil) score += 2.2; // smells like Merlin
        else if (h.votes[i] === true && !teamHadEvil) score += 0.8;
        else if (h.votes[i] === false && !teamHadEvil) score -= 1.1;
      });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) {
      for (var j = 0; j < PLAYER_COUNT; j++) {
        if (j !== me) { best = j; break; }
      }
    }
    return best;
  }

  function aiDecision(state, seat) {
    if (!state || seat < 0 || seat >= PLAYER_COUNT) return null;
    if (state.phase === 'propose') {
      if (state.leader !== seat) return null;
      return { type: 'propose', seat: seat, team: aiProposeTeam(state) };
    }
    if (state.phase === 'vote') {
      if (state.votes[seat] != null) return null;
      return { type: 'vote', seat: seat, approve: aiVote(state, seat) };
    }
    if (state.phase === 'mission') {
      if (state.team.indexOf(seat) < 0 || state.missionVotes[seat] != null) return null;
      return { type: 'mission', seat: seat, fail: aiMission(state, seat) };
    }
    if (state.phase === 'assassin') {
      if (assassinId(state) !== seat) return null;
      return { type: 'assassinate', seat: seat, target: aiAssassinate(state) };
    }
    return null;
  }

  function applyDecision(state, decision) {
    if (!decision) return null;
    if (decision.type === 'propose') {
      proposeTeam(state, decision.seat == null ? state.leader : decision.seat, decision.team);
    } else if (decision.type === 'vote') {
      castVote(state, decision.seat, decision.approve);
    } else if (decision.type === 'mission') {
      castMission(state, decision.seat, decision.fail);
    } else if (decision.type === 'assassinate') {
      assassinate(state, decision.seat, decision.target);
    } else {
      throw new Error('unknown decision: ' + decision.type);
    }
    return decision;
  }

  function aiAct(state, seat) {
    return applyDecision(state, aiDecision(state, seat));
  }

  function legalActionsFor(state, seat) {
    if (!state) return [];
    if (state.phase === 'propose' && state.leader === seat) {
      return [{ type: 'propose', seat: seat, team: suggestTeam(state, seat) }];
    }
    if (state.phase === 'vote' && state.votes[seat] == null) {
      return [{ type: 'vote', seat: seat, approve: true }, { type: 'vote', seat: seat, approve: false }];
    }
    if (state.phase === 'mission' && state.team.indexOf(seat) >= 0 && state.missionVotes[seat] == null) {
      var actions = [{ type: 'mission', seat: seat, fail: false }];
      if (state.players[seat].evil) actions.push({ type: 'mission', seat: seat, fail: true });
      return actions;
    }
    if (state.phase === 'assassin' && assassinId(state) === seat) {
      var target = -1;
      for (var i = 0; i < PLAYER_COUNT; i++) {
        if (i !== seat && !state.players[i].evil) { target = i; break; }
      }
      if (target < 0) target = (seat + 1) % PLAYER_COUNT;
      return [{ type: 'assassinate', seat: seat, target: target }];
    }
    return [];
  }

  function selfPlay(seed) {
    var state = createGame({
      seed: seed == null ? DEFAULT_SEED : seed,
      names: ['AI-1', 'AI-2', 'AI-3', 'AI-4', 'AI-5']
    });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 5000) throw new Error('selfPlay: no progress');
      var acted = false;
      for (var i = 0; i < PLAYER_COUNT; i++) {
        var decision = aiDecision(state, i);
        if (decision) { applyDecision(state, decision); acted = true; break; }
      }
      if (!acted) throw new Error('selfPlay: stalled in phase ' + state.phase);
    }
    return state;
  }

  // ------------------------------------------------------------------------
  // Viewer-scoped public state
  // ------------------------------------------------------------------------

  function visibleKnowledge(state, viewer, seat) {
    if (seat === viewer) return 'you';
    var mine = state.players[viewer].role;
    var theirs = state.players[seat].role;
    if (mine === 'merlin') return isEvil(theirs) ? 'evil' : 'unknown';
    if (mine === 'percival') return (theirs === 'merlin' || theirs === 'morgana') ? 'magic' : 'unknown';
    if (isEvil(mine)) return isEvil(theirs) ? 'evil-ally' : 'unknown';
    return 'unknown';
  }

  function publicView(state, viewer) {
    if (!state) return null;
    var seat = viewer == null ? 0 : viewer;
    if (seat < 0 || seat >= PLAYER_COUNT) seat = 0;
    var over = state.phase === 'over';
    var resolvedLastVote = null;
    for (var h = state.history.length - 1; h >= 0; h--) {
      if (state.history[h].approved != null) { resolvedLastVote = state.history[h]; break; }
    }
    var view = {
      version: 1,
      phase: state.phase,
      questIndex: state.questIndex,
      quest: state.questIndex,
      questSizes: QUEST_SIZES.slice(),
      questSize: teamSize(state),
      teamSize: teamSize(state),
      failsRequired: failsRequired(state),
      leader: state.leader,
      team: state.team.slice(),
      rejects: state.rejects,
      maxRejects: MAX_REJECTS,
      missions: { good: state.missions.good, evil: state.missions.evil, needed: QUESTS_TO_WIN, total: QUEST_SIZES.length },
      quests: state.quests.map(function (q) {
        return {
          index: q.index, size: q.size, result: q.result, winner: q.winner,
          failCount: q.failCount, approved: q.approved,
          team: q.result ? q.team.slice() : []
        };
      }),
      yourSeat: seat,
      yourRole: state.players[seat].role,
      yourSide: roleSide(state.players[seat].role),
      roleKnowledge: state.players.map(function (p, i) {
        return { seat: i, role: visibleKnowledge(state, seat, i) };
      }),
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          human: i === seat,
          leader: i === state.leader,
          onTeam: state.team.indexOf(i) >= 0,
          voted: state.votes[i] != null,
          missionVoted: state.missionVotes[i] != null,
          revealedRole: over ? p.role : null,
          revealedSide: over ? roleSide(p.role) : null
        };
      }),
      history: state.history.map(function (entry) {
        return {
          quest: entry.quest,
          team: entry.team.slice(),
          votes: entry.approved == null ? null : entry.votes.slice(),
          approved: entry.approved,
          yes: entry.yes,
          no: entry.no,
          failCount: entry.failCount,
          result: entry.result,
          winner: entry.winner
        };
      }),
      lastVote: resolvedLastVote ? {
        quest: resolvedLastVote.quest,
        team: resolvedLastVote.team.slice(),
        votes: resolvedLastVote.votes.slice(),
        approved: resolvedLastVote.approved,
        yes: resolvedLastVote.yes,
        no: resolvedLastVote.no
      } : null,
      votedCount: state.votes.filter(function (v) { return v != null; }).length,
      missionVotedCount: state.team.filter(function (i) { return state.missionVotes[i] != null; }).length,
      winner: state.winner,
      winReason: state.winReason,
      assassinTarget: over ? state.assassinTarget : null,
      reveal: over ? {
        roles: state.players.map(function (p) { return p.role; }),
        merlinSeat: merlinId(state),
        percivalSeat: percivalId(state),
        morganaSeat: morganaId(state),
        assassinSeat: assassinId(state),
        loyalSeats: loyalIds(state),
        assassinTarget: state.assassinTarget
      } : null,
      log: state.log.slice()
    };
    return view;
  }

  return {
    createGame: createGame,
    proposeTeam: proposeTeam,
    castVote: castVote,
    castMission: castMission,
    assassinate: assassinate,
    legalProposal: legalProposal,
    legalVote: legalVote,
    legalMission: legalMission,
    legalAssassination: legalAssassination,
    legalActionsFor: legalActionsFor,
    aiDecision: aiDecision,
    applyDecision: applyDecision,
    aiAct: aiAct,
    aiProposeTeam: aiProposeTeam,
    aiVote: aiVote,
    aiMission: aiMission,
    aiAssassinate: aiAssassinate,
    suggestTeam: suggestTeam,
    selfPlay: selfPlay,
    publicView: publicView,
    visibleKnowledge: visibleKnowledge,
    teamSize: teamSize,
    failsRequired: failsRequired,
    isEvil: isEvil,
    isGood: isGood,
    roleSide: roleSide,
    roleName: roleName,
    evilPlayers: evilPlayers,
    merlinId: merlinId,
    percivalId: percivalId,
    morganaId: morganaId,
    assassinId: assassinId,
    loyalIds: loyalIds,
    nextRandom: nextRandom,
    ROLES: ROLES,
    ROLE_NAMES: ROLE_NAMES,
    ROLE_SIDES: ROLE_SIDES,
    ROLE_COUNTS: ROLE_COUNTS,
    ROLE_ORDER: ROLE_ORDER,
    QUEST_SIZES: QUEST_SIZES,
    FAILS_TO_FAIL: FAILS_TO_FAIL,
    MAX_REJECTS: MAX_REJECTS,
    QUESTS_TO_WIN: QUESTS_TO_WIN,
    PLAYER_COUNT: PLAYER_COUNT,
    DEFAULT_NAMES: DEFAULT_NAMES
  };
});
