/* Dixit (只言片语) simplified — pure 3-player word-card engine (you + 2 AI).
 * No images: each abstract card is a Chinese phrase with tags. Storyteller
 * gives a clue, others submit a card, everyone votes for the storyteller's
 * card, then Dixit scoring is applied. UMD for tests/browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DixitEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CARD_BANK = [
    { id: 'd01', text: '回声', tags: ['声音', '空', '记忆'] },
    { id: 'd02', text: '纸飞机', tags: ['童年', '飞行', '纸'] },
    { id: 'd03', text: '午夜列车', tags: ['夜晚', '旅行', '孤独'] },
    { id: 'd04', text: '许愿池', tags: ['水', '愿望', '秘密'] },
    { id: 'd05', text: '褪色的照片', tags: ['记忆', '时间', '旧'] },
    { id: 'd06', text: '雨中的伞', tags: ['雨', '孤独', '保护'] },
    { id: 'd07', text: '无人接听', tags: ['声音', '孤独', '距离'] },
    { id: 'd08', text: '旧钥匙', tags: ['旧', '秘密', '门'] },
    { id: 'd09', text: '半开的门', tags: ['门', '秘密', '选择'] },
    { id: 'd10', text: '玻璃海', tags: ['水', '梦', '脆弱'] },
    { id: 'd11', text: '影子戏', tags: ['光', '梦', '表演'] },
    { id: 'd12', text: '最后一班公交', tags: ['夜晚', '旅行', '回家'] },
    { id: 'd13', text: '生锈的钟', tags: ['时间', '旧', '停止'] },
    { id: 'd14', text: '风筝线', tags: ['飞行', '牵挂', '天空'] },
    { id: 'd15', text: '空椅子', tags: ['空', '等待', '孤独'] },
    { id: 'd16', text: '雪地脚印', tags: ['雪', '痕迹', '旅行'] },
    { id: 'd17', text: '借来的光', tags: ['光', '希望', '秘密'] },
    { id: 'd18', text: '未寄出的信', tags: ['秘密', '距离', '文字'] },
    { id: 'd19', text: '潮汐', tags: ['水', '时间', '循环'] },
    { id: 'd20', text: '沙漏', tags: ['时间', '等待', '脆弱'] },
    { id: 'd21', text: '猫的凝视', tags: ['动物', '秘密', '夜晚'] },
    { id: 'd22', text: '星图', tags: ['天空', '梦', '距离'] },
    { id: 'd23', text: '雾中灯塔', tags: ['雾', '光', '希望'] },
    { id: 'd24', text: '断线电话', tags: ['声音', '距离', '孤独'] },
    { id: 'd25', text: '折叠的城', tags: ['城市', '梦', '空间'] },
    { id: 'd26', text: '无声电影', tags: ['表演', '声音', '旧'] },
    { id: 'd27', text: '蓝色火焰', tags: ['火', '梦', '冷'] },
    { id: 'd28', text: '迷路的指南针', tags: ['旅行', '选择', '迷失'] },
    { id: 'd29', text: '月台', tags: ['旅行', '等待', '夜晚'] },
    { id: 'd30', text: '棉花糖云', tags: ['天空', '童年', '甜'] },
    { id: 'd31', text: '秘密花园', tags: ['秘密', '花', '梦'] },
    { id: 'd32', text: '倒着走的钟', tags: ['时间', '梦', '旧'] }
  ];
  var BY_ID = {};
  CARD_BANK.forEach(function (c) { BY_ID[c.id] = c; });
  var TARGET_SCORE = 10;
  var MAX_ROUNDS = 4;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 100) state.log.shift();
  }
  function card(id) { return BY_ID[id]; }
  function nonStorytellers(state) {
    return state.players.filter(function (p) { return p.id !== state.storyteller; });
  }
  function submittedBy(state, id) {
    return state.submissions.some(function (s) { return s.playerId === id; });
  }
  function votedBy(state, id) {
    return state.votes.some(function (v) { return v.voterId === id; });
  }
  function displayOf(state, displayId) {
    return state.display.filter(function (d) { return d.displayId === displayId; })[0];
  }

  function similarity(state, clue, cardId) {
    var c = card(cardId);
    var score = 0;
    c.tags.forEach(function (tag) {
      if (clue === tag) score += 4;
      else if (clue.indexOf(tag) >= 0 || tag.indexOf(clue) >= 0) score += 2;
    });
    if (clue && c.text.indexOf(clue) >= 0) score += 1;
    if (clue) {
      for (var i = 0; i < clue.length; i++) {
        if (c.text.indexOf(clue.charAt(i)) >= 0) score += 0.4;
      }
    }
    return score + state.rng() * 1.6;
  }

  function createGame(opts) {
    opts = opts || {};
    var rng = opts.rng || mulberry32(opts.seed == null ? 1 : opts.seed);
    var deck = shuffle(CARD_BANK.map(function (c) { return c.id; }), rng);
    var names = opts.names || ['你', '小满', '阿岚'];
    var players = [];
    for (var i = 0; i < 3; i++) {
      players.push({
        id: i,
        name: names[i] || ('玩家' + i),
        score: 0,
        hand: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()]
      });
    }
    var state = {
      players: players,
      deck: deck,
      round: 1,
      maxRounds: MAX_ROUNDS,
      target: TARGET_SCORE,
      storyteller: 0,
      phase: 'clue',
      clue: null,
      storyCard: null,
      submissions: [],
      display: null,
      votes: [],
      lastScore: null,
      winner: null,
      log: [],
      rng: rng,
      seat: 0,
      aiAll: !!opts.aiAll
    };
    log(state, '第 1 回合：讲述者从手牌选一张，给出一个不太直白、也不太模糊的线索。');
    return state;
  }

  function isOver(state) { return state.phase === 'over' || state.winner !== null; }

  function actorId(state) {
    if (state.phase === 'clue') return state.storyteller;
    if (state.phase === 'submit') {
      var p = state.players.filter(function (x) {
        return x.id !== state.storyteller && !submittedBy(state, x.id);
      })[0];
      return p ? p.id : null;
    }
    if (state.phase === 'vote') {
      var v = state.players.filter(function (x) {
        return x.id !== state.storyteller && !votedBy(state, x.id);
      })[0];
      return v ? v.id : null;
    }
    return 0;
  }

  function needsHuman(state) {
    if (state.aiAll || isOver(state)) return false;
    if (state.phase === 'score') return true;
    return actorId(state) === state.seat;
  }

  function validateClue(state, text) {
    if (typeof text !== 'string') return false;
    text = text.trim();
    if (!text || text.length > 30) return false;
    return true;
  }

  function startRound(state) {
    if (isOver(state)) return;
    if (state.round > state.maxRounds) {
      finishByScore(state);
      return;
    }
    state.players.forEach(function (p) {
      while (p.hand.length < 5 && state.deck.length) p.hand.push(state.deck.pop());
    });
    state.storyteller = (state.round - 1) % state.players.length;
    state.phase = 'clue';
    state.clue = null;
    state.storyCard = null;
    state.submissions = [];
    state.display = null;
    state.votes = [];
    state.lastScore = null;
    log(state, '第 ' + state.round + ' 回合：' + state.players[state.storyteller].name + '是讲述者。');
  }

  function buildDisplay(state) {
    var entries = state.submissions.map(function (s) {
      return { ownerId: s.playerId, cardId: s.cardId };
    });
    shuffle(entries, state.rng);
    state.display = entries.map(function (e, i) {
      return { displayId: i, ownerId: e.ownerId, cardId: e.cardId };
    });
    state.phase = 'vote';
    state.votes = [];
    log(state, '所有玩家已出牌，开始投票。');
  }

  function scoreVotes(players, display, votes, storyteller) {
    var voters = players.filter(function (p) { return p.id !== storyteller; }).length;
    var storyDisplay = display.filter(function (d) { return d.ownerId === storyteller; })[0];
    var correct = votes.filter(function (v) { return v.displayId === storyDisplay.displayId; }).length;
    var add = {};
    players.forEach(function (p) { add[p.id] = 0; });
    var rows = [];
    if (correct === 0 || correct === voters) {
      players.forEach(function (p) {
        if (p.id !== storyteller) add[p.id] += 2;
      });
      rows.push({ kind: 'all-or-none', correct: correct });
    } else {
      add[storyteller] += 3;
      players.forEach(function (p) {
        if (p.id === storyteller) return;
        var received = votes.filter(function (v) {
          var d = display.filter(function (x) { return x.displayId === v.displayId; })[0];
          return d && d.ownerId === p.id;
        }).length;
        add[p.id] += received;
      });
      votes.forEach(function (v) {
        if (v.displayId === storyDisplay.displayId) add[v.voterId] += 3;
      });
      rows.push({ kind: 'partial', correct: correct });
    }
    return { add: add, correct: correct, voters: voters, storyDisplayId: storyDisplay.displayId, rows: rows };
  }

  function scoreRound(state) {
    var result = scoreVotes(state.players, state.display, state.votes, state.storyteller);
    Object.keys(result.add).forEach(function (id) {
      state.players[Number(id)].score += result.add[Number(id)];
    });
    state.lastScore = result;
    state.phase = 'score';
    var someone = state.players.some(function (p) { return p.score >= state.target; });
    if (someone || state.round >= state.maxRounds) {
      finishByScore(state);
      return;
    }
    log(state, '本回合计分完成：讲述者 ' + result.add[state.storyteller] + ' 分，' +
      (result.correct === 0 || result.correct === result.voters ? '无人/全部猜中。' : '部分猜中。'));
  }

  function finishByScore(state) {
    var top = Math.max.apply(null, state.players.map(function (p) { return p.score; }));
    var leaders = state.players.filter(function (p) { return p.score === top; });
    state.winner = leaders.length === 1 ? leaders[0].id : -1;
    state.phase = 'over';
    log(state, '对局结束：' + (state.winner >= 0 ? state.players[state.winner].name + '以 ' + top + ' 分获胜！' : '最高分并列，平局。'));
  }

  function applyAction(state, action) {
    if (!action || isOver(state)) return { ok: false, error: '对局已结束' };
    if (state.phase === 'clue') {
      if (action.type !== 'clue') return { ok: false, error: '讲述者需要给出线索' };
      var sp = state.players[state.storyteller];
      if (sp.hand.indexOf(action.cardId) < 0) return { ok: false, error: '该牌不在讲述者手中' };
      var text = typeof action.text === 'string' ? action.text.trim() : '';
      if (!validateClue(state, text) || text === card(action.cardId).text) {
        return { ok: false, error: '线索需为 1–30 字，且不能直接等于卡面文字' };
      }
      state.storyCard = action.cardId;
      sp.hand.splice(sp.hand.indexOf(action.cardId), 1);
      state.clue = text;
      state.submissions = [{ playerId: sp.id, cardId: action.cardId }];
      state.phase = 'submit';
      log(state, '讲述者的线索：「' + state.clue + '」。其他玩家出牌。');
      return { ok: true };
    }
    if (state.phase === 'submit') {
      if (action.type !== 'submit') return { ok: false, error: '请选择一张手牌' };
      var id = actorId(state);
      var p = state.players[id];
      if (!p || p.id === state.storyteller) return { ok: false, error: '讲述者不能参与出牌' };
      if (p.hand.indexOf(action.cardId) < 0) return { ok: false, error: '该牌不在手中' };
      p.hand.splice(p.hand.indexOf(action.cardId), 1);
      state.submissions.push({ playerId: p.id, cardId: action.cardId });
      log(state, p.name + '已暗出一张牌。');
      if (state.submissions.length === state.players.length) buildDisplay(state);
      return { ok: true };
    }
    if (state.phase === 'vote') {
      if (action.type !== 'vote') return { ok: false, error: '请选择一张牌投票' };
      var vid = actorId(state);
      if (vid === state.storyteller) return { ok: false, error: '讲述者不能投票' };
      if (votedBy(state, vid)) return { ok: false, error: '你已经投过票' };
      var d = displayOf(state, action.displayId);
      if (!d) return { ok: false, error: '无效的牌位' };
      if (d.ownerId === vid) return { ok: false, error: '不能投自己出的牌' };
      state.votes.push({ voterId: vid, displayId: action.displayId });
      log(state, state.players[vid].name + '已投票。');
      if (state.votes.length === state.players.length - 1) scoreRound(state);
      return { ok: true };
    }
    if (state.phase === 'score') {
      if (action.type !== 'next') return { ok: false, error: '请进入下一回合' };
      state.round++;
      if (state.round > state.maxRounds) { finishByScore(state); return { ok: true }; }
      startRound(state);
      return { ok: true };
    }
    return { ok: false, error: '当前不能行动' };
  }

  function aiClue(state) {
    var p = state.players[state.storyteller];
    var cardId = p.hand[Math.floor(state.rng() * p.hand.length)];
    var tags = card(cardId).tags;
    var tag = tags[Math.floor(state.rng() * tags.length)];
    var text = tag;
    if (text === card(cardId).text) text = tags[1] || '故事';
    return { type: 'clue', cardId: cardId, text: text };
  }

  function aiSubmit(state) {
    var id = actorId(state);
    var p = state.players[id];
    var best = p.hand[0], bestScore = -1;
    p.hand.forEach(function (cid) {
      var sc = similarity(state, state.clue, cid);
      if (sc > bestScore) { bestScore = sc; best = cid; }
    });
    return { type: 'submit', cardId: best };
  }

  function aiVote(state) {
    var id = actorId(state);
    var own = state.submissions.filter(function (s) { return s.playerId === id; })[0];
    var ownDisplay = state.display.filter(function (d) { return own && d.cardId === own.cardId; })[0];
    var options = state.display.filter(function (d) { return !ownDisplay || d.displayId !== ownDisplay.displayId; });
    if (state.rng() < 0.22) {
      return { type: 'vote', displayId: options[Math.floor(state.rng() * options.length)].displayId };
    }
    var best = options[0], bestScore = -1;
    options.forEach(function (d) {
      var sc = similarity(state, state.clue, d.cardId);
      if (sc > bestScore) { bestScore = sc; best = d; }
    });
    return { type: 'vote', displayId: best.displayId };
  }

  function aiAction(state) {
    if (isOver(state)) return null;
    if (state.phase === 'clue') return aiClue(state);
    if (state.phase === 'submit') return aiSubmit(state);
    if (state.phase === 'vote') return aiVote(state);
    if (state.phase === 'score') return { type: 'next' };
    return null;
  }

  function autoRun(state, limit) {
    var n = 0;
    limit = limit || 300;
    while (!isOver(state) && !needsHuman(state) && n++ < limit) {
      var a = aiAction(state);
      if (!a) break;
      var r = applyAction(state, a);
      if (!r.ok) break;
    }
    return n;
  }

  function viewFor(state, seat) {
    var revealOwners = state.phase === 'score' || isOver(state);
    return {
      seat: seat,
      round: state.round,
      maxRounds: state.maxRounds,
      target: state.target,
      storyteller: state.storyteller,
      phase: state.phase,
      clue: state.clue,
      winner: state.winner,
      lastScore: state.lastScore ? JSON.parse(JSON.stringify(state.lastScore)) : null,
      log: state.log.slice(),
      deckLeft: state.deck.length,
      players: state.players.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          score: p.score,
          handCount: p.hand.length,
          hand: p.id === seat ? p.hand.slice() : p.hand.map(function () { return 'hidden'; })
        };
      }),
      display: state.display ? state.display.map(function (d) {
        return {
          displayId: d.displayId,
          cardId: d.cardId,
          ownerId: revealOwners ? d.ownerId : 'hidden',
          text: card(d.cardId).text,
          tags: card(d.cardId).tags.slice()
        };
      }) : null,
      votes: revealOwners ? state.votes.slice() : [],
      mySubmitted: (function () {
        var s = state.submissions.filter(function (x) { return x.playerId === seat; })[0];
        if (!s || !state.display) return null;
        var d = state.display.filter(function (x) { return x.cardId === s.cardId; })[0];
        return d ? d.displayId : null;
      }())
    };
  }

  return {
    CARD_BANK: CARD_BANK,
    CARD_BY_ID: BY_ID,
    TARGET_SCORE: TARGET_SCORE,
    MAX_ROUNDS: MAX_ROUNDS,
    createGame: createGame,
    viewFor: viewFor,
    needsHuman: needsHuman,
    actorId: actorId,
    validateClue: validateClue,
    scoreVotes: scoreVotes,
    aiAction: aiAction,
    applyAction: applyAction,
    autoRun: autoRun,
    isOver: isOver
  };
}));
