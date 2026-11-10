/*
 * Dixit（妙语说书人）premium rules engine — UMD.
 * 3–6 players, 84 original abstract cards, 6 cards per hand, first to 30.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DixitEngine = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var Data = null;
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { Data = require('./data.js'); } catch (err) { Data = null; }
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!Data && root && root.DixitData) Data = root.DixitData;
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!Data) throw new Error('DixitEngine requires data.js');
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') throw new Error('DixitEngine requires games/shared/shuffle.js');

  var VERSION = '1.0.0';
  var HAND_SIZE = Data.HAND_SIZE;
  var TARGET_SCORE = Data.TARGET_SCORE;
  var MIN_PLAYERS = Data.MIN_PLAYERS;
  var MAX_PLAYERS = Data.MAX_PLAYERS;
  var MAX_LOG = 160;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function assertPlayerCount(n) { if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('玩家人数必须是 3–6'); }
  function pushLog(state, text, data) {
    state.log.push({ turn: state.turn, round: state.round, text: text, data: data || null });
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }
  function nextPlayer(state, from) { return (from + 1) % state.playerCount; }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var playerCount = opts.playerCount == null ? 4 : Number(opts.playerCount);
    assertPlayerCount(playerCount);
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var names = opts.names && opts.names.length === playerCount ? opts.names.slice() : Data.NAMES.slice(0, playerCount);
    var aiFlags = opts.isAI && opts.isAI.length === playerCount ? opts.isAI.slice() : names.map(function (_, i) { return i > 0; });
    var deck = ShuffleApi.shuffle(Data.CARDS.map(function (c) { return c.id; }), { seed: String(seed) + ':deal' });
    var players = [];
    for (var i = 0; i < playerCount; i++) players.push({ index: i, name: names[i], isAI: !!aiFlags[i], score: 0, hand: [] });
    players.forEach(function (p) { for (var h = 0; h < HAND_SIZE; h++) p.hand.push(deck.pop()); });
    var state = {
      version: VERSION, seed: seed, shuffleCount: 1, playerCount: playerCount,
      players: players, deck: deck, discard: [], round: 1, turn: 1,
      storyteller: 0, phase: 'clue', current: 0, clue: '', storytellerCard: null,
      submissions: {}, submitOrder: [], voteOrder: [], votes: {}, targetScore: TARGET_SCORE,
      over: false, winners: [], winner: null, log: [], lastAction: null, lastRound: null, result: null
    };
    pushLog(state, '第 1 轮：' + players[0].name + ' 是说书人。');
    return state;
  }

  function voters(state) { return state.players.filter(function (p) { return p.index !== state.storyteller; }); }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = state.players[state.current];
    if (!player) return [];
    if (state.phase === 'clue') { if (state.current !== state.storyteller) return []; return player.hand.map(function (card) { return { type: 'clue', card: card }; }); }
    if (state.phase === 'submit') { if (state.current === state.storyteller) return []; return player.hand.map(function (card) { return { type: 'submit', card: card }; }); }
    if (state.phase === 'vote') {
      if (state.current === state.storyteller) return [];
      var own = state.submissions[state.current];
      return state.voteOrder.filter(function (card) { return card !== own; }).map(function (card) { return { type: 'vote', card: card }; });
    }
    return [];
  }

  function moveKey(move) { return [move.type, move.card, move.text || ''].join(':'); }
  function validateMove(state, move) {
    if (!state || state.over) return '对局已结束';
    if (!move || !move.type) return '动作格式不正确';
    var card = Number(move.card);
    if (!Number.isInteger(card)) return '牌号不正确';
    if (state.phase === 'clue') {
      if (state.current !== state.storyteller) return '现在不是你的说书回合';
      if (state.players[state.storyteller].hand.indexOf(card) < 0) return '手中没有这张牌';
      var text = String(move.text == null ? '' : move.text).trim();
      if (!text) return '请给出一条线索';
      if (text.length > 60) return '线索不能超过 60 个字符';
      if (/\n/.test(text)) return '线索不能换行';
      return null;
    }
    var legal = getLegalMoves(state).some(function (m) { return moveKey(m) === moveKey(move); });
    if (!legal) return '动作不合法';
    return null;
  }

  function advanceSubmit(state, from) {
    for (var step = 1; step <= state.playerCount; step++) {
      var idx = (from + step) % state.playerCount;
      if (idx !== state.storyteller && state.submissions[idx] == null) return idx;
    }
    return -1;
  }
  function advanceVote(state, from) {
    for (var step = 1; step <= state.playerCount; step++) {
      var idx = (from + step) % state.playerCount;
      if (idx !== state.storyteller && state.votes[idx] == null) return idx;
    }
    return -1;
  }

  function ownerOf(state, cardId) {
    var keys = Object.keys(state.submissions);
    for (var i = 0; i < keys.length; i++) if (state.submissions[keys[i]] === cardId) return Number(keys[i]);
    return null;
  }

  function scoreRound(state) {
    var story = state.storyteller;
    var storytellerCard = state.storytellerCard;
    var allVoters = voters(state);
    var correct = allVoters.filter(function (p) { return state.votes[p.index] === storytellerCard; });
    var delta = {};
    state.players.forEach(function (p) { delta[p.index] = 0; });
    var outcome;
    if (correct.length === 0) {
      outcome = 'none';
      state.players.forEach(function (p) { if (p.index !== story) { p.score += 2; delta[p.index] = 2; } });
    } else if (correct.length === allVoters.length) {
      outcome = 'all';
      state.players.forEach(function (p) { if (p.index !== story) { p.score += 2; delta[p.index] = 2; } });
    } else {
      outcome = 'normal';
      state.players[story].score += 3; delta[story] = 3;
      correct.forEach(function (p) { p.score += 3; delta[p.index] += 3; });
      allVoters.forEach(function (p) {
        var card = state.votes[p.index];
        var owner = ownerOf(state, card);
        if (owner != null && card !== storytellerCard) { state.players[owner].score += 1; delta[owner] += 1; }
      });
    }
    var cards = state.voteOrder.map(function (cardId) {
      var owner = cardId === storytellerCard ? story : ownerOf(state, cardId);
      var count = allVoters.filter(function (p) { return state.votes[p.index] === cardId; }).length;
      return { card: cardId, owner: owner, votes: count, storyteller: cardId === storytellerCard };
    });
    state.lastRound = {
      round: state.round, storyteller: story, storytellerName: state.players[story].name, clue: state.clue,
      storytellerCard: storytellerCard, cards: cards,
      votes: allVoters.map(function (p) { return { voter: p.index, voterName: p.name, card: state.votes[p.index] }; }),
      correct: correct.map(function (p) { return p.index; }), outcome: outcome, delta: delta,
      scores: state.players.map(function (p) { return { index: p.index, name: p.name, score: p.score, isAI: p.isAI }; })
    };
    pushLog(state, '第 ' + state.round + ' 轮结算：说书人 ' + state.players[story].name + '，' +
      (outcome === 'all' ? '所有人都猜中' : outcome === 'none' ? '没有人猜中' : correct.length + ' 人猜中') + '。');
    state.discard = state.discard.concat(state.voteOrder);
    state.players.forEach(function (p) { while (p.hand.length < HAND_SIZE && state.deck.length) p.hand.push(state.deck.pop()); });
    var top = Math.max.apply(null, state.players.map(function (p) { return p.score; }));
    var leaders = state.players.filter(function (p) { return p.score === top; });
    if (top >= state.targetScore || state.deck.length === 0) {
      state.over = true; state.phase = 'over'; state.winners = leaders.map(function (p) { return p.index; });
      state.winner = state.winners.length === 1 ? state.winners[0] : -1;
      state.result = makeResult(state);
      pushLog(state, state.winner >= 0 ? state.players[state.winner].name + '赢得比赛！' : '比赛以共享胜利结束。');
      return;
    }
    state.round += 1; state.turn += 1;
    state.storyteller = nextPlayer(state, story); state.phase = 'clue'; state.current = state.storyteller;
    state.clue = ''; state.storytellerCard = null; state.submissions = {}; state.submitOrder = []; state.voteOrder = []; state.votes = {}; state.lastAction = null;
    pushLog(state, '第 ' + state.round + ' 轮：' + state.players[state.storyteller].name + ' 是说书人。');
  }

  function makeResult(state) {
    return {
      over: state.over, winners: state.winners.slice(), targetScore: state.targetScore,
      scores: state.players.map(function (p) { return { index: p.index, name: p.name, score: p.score, isAI: p.isAI }; }),
      rounds: state.round
    };
  }

  function resolve(state, move) {
    var card = Number(move.card);
    var player = state.players[state.current];
    if (state.phase === 'clue') {
      var idx = player.hand.indexOf(card); player.hand.splice(idx, 1);
      state.storytellerCard = card; state.clue = String(move.text).trim();
      state.lastAction = { type: 'clue', player: player.index, card: card, text: state.clue };
      state.phase = 'submit'; state.submitOrder = [];
      state.current = advanceSubmit(state, state.storyteller);
      pushLog(state, player.name + '说出线索：「' + state.clue + '」。');
      return;
    }
    if (state.phase === 'submit') {
      var si = player.hand.indexOf(card); player.hand.splice(si, 1);
      state.submissions[player.index] = card; state.submitOrder.push(card);
      state.lastAction = { type: 'submit', player: player.index };
      pushLog(state, player.name + '提交了一张牌。');
      var nextSubmit = advanceSubmit(state, state.current);
      if (nextSubmit >= 0) { state.current = nextSubmit; return; }
      state.voteOrder = ShuffleApi.shuffle([state.storytellerCard].concat(state.submitOrder), { seed: String(state.seed) + ':vote:' + state.round });
      state.phase = 'vote'; state.votes = {};
      state.current = advanceVote(state, state.storyteller);
      pushLog(state, '所有牌已提交，开始投票。');
      return;
    }
    if (state.phase === 'vote') {
      state.votes[player.index] = card;
      state.lastAction = { type: 'vote', player: player.index, card: card };
      pushLog(state, player.name + '投出了一票。');
      var nextVote = advanceVote(state, state.current);
      if (nextVote >= 0) { state.current = nextVote; return; }
      scoreRound(state);
    }
  }

  function applyMove(state, move) {
    var error = validateMove(state, move);
    if (error) throw new Error(error);
    var next = clone(state);
    resolve(next, move);
    return next;
  }

  function rngFor(state) {
    var seed = (state.seed ^ (state.turn * 2654435761) ^ (state.current * 97) ^ (state.round * 40503)) >>> 0;
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(list, rng) { return list.length ? list[Math.floor(rng() * list.length) % list.length] : null; }

  function tagScore(cardId, clue) {
    var card = Data.BY_ID[cardId];
    if (!card) return 0;
    var score = 0, text = String(clue || '');
    card.tags.forEach(function (tag) { if (text.indexOf(tag) !== -1) score += 3; });
    if (text.indexOf(card.title) !== -1) score += 2;
    return score;
  }

  var CLUE_TEMPLATES = ['像{tag}一样安静','在{tag}的尽头','{tag}与{tag2}','当{tag}落下','关于{tag}的一个梦','我听见{tag}','{tag}，但没有声音','把{tag}折起来'];
  function aiClue(state, cardId) {
    var card = Data.BY_ID[cardId], rng = rngFor(state);
    var tpl = CLUE_TEMPLATES[Math.floor(rng() * CLUE_TEMPLATES.length)];
    return tpl.replace('{tag}', card.tags[0]).replace('{tag2}', card.tags[1]);
  }

  function chooseAIMove(state) {
    if (!state || state.over) return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var rng = rngFor(state), player = state.players[state.current];
    if (state.phase === 'clue') { var card = pick(player.hand, rng); return { type: 'clue', card: card, text: aiClue(state, card) }; }
    if (state.phase === 'submit') {
      var scored = player.hand.map(function (c) { return { card: c, score: tagScore(c, state.clue) + rng() * 2.5 }; });
      scored.sort(function (a, b) { return b.score - a.score; });
      return { type: 'submit', card: (rng() < 0.18 && scored.length > 1) ? scored[1].card : scored[0].card };
    }
    if (state.phase === 'vote') {
      var own = state.submissions[state.current];
      var options = state.voteOrder.filter(function (c) { return c !== own; }).map(function (c) { return { card: c, score: tagScore(c, state.clue) + rng() * 2.5 }; });
      options.sort(function (a, b) { return b.score - a.score; });
      return { type: 'vote', card: (rng() < 0.22 && options.length > 1) ? options[1].card : options[0].card };
    }
    return null;
  }

  function isGameOver(state) { return !!(state && state.over); }
  function getResults(state) { return state ? makeResult(state) : null; }

  function getView(state, seat) {
    if (!state) return null;
    var viewer = seat != null && state.players[seat] ? seat : null;
    var revealRound = state.over || (!!state.lastRound && state.lastRound.round === state.round);
    var voteCards = (state.phase === 'vote' || state.over || (state.lastRound && state.lastRound.round === state.round)) ? state.voteOrder.slice() : [];
    return {
      version: state.version, playerCount: state.playerCount, round: state.round, turn: state.turn,
      phase: state.phase, current: state.current, storyteller: state.storyteller, clue: state.clue,
      targetScore: state.targetScore, deckLeft: state.deck.length, over: state.over,
      winner: state.winner, winners: state.winners ? state.winners.slice() : [],
      voteCards: voteCards, votesCast: Object.keys(state.votes).length, votersTotal: state.playerCount - 1,
      storytellerCard: revealRound ? state.storytellerCard : null,
      players: state.players.map(function (p) {
        var own = viewer === p.index;
        return {
          index: p.index, name: p.name, isAI: p.isAI, score: p.score, handCount: p.hand.length,
          hand: own ? p.hand.slice() : p.hand.map(function () { return 'hidden'; }),
          isStoryteller: p.index === state.storyteller,
          submitted: state.submissions[p.index] != null, voted: state.votes[p.index] != null
        };
      }),
      ownSubmission: viewer != null && state.submissions[viewer] != null ? state.submissions[viewer] : null,
      ownVote: viewer != null && state.votes[viewer] != null ? state.votes[viewer] : null,
      submissionsCount: Object.keys(state.submissions).length,
      log: state.log.slice(-50),
      lastAction: (function () {
        if (!state.lastAction) return null;
        var action = clone(state.lastAction);
        if (!revealRound) { if (action.type === 'clue') delete action.card; if (action.type === 'submit' || action.type === 'vote') delete action.card; }
        return action;
      })(),
      lastRound: state.lastRound ? clone(state.lastRound) : null,
      result: state.over ? getResults(state) : null
    };
  }

  return Object.freeze({
    VERSION: VERSION, HAND_SIZE: HAND_SIZE, TARGET_SCORE: TARGET_SCORE, MIN_PLAYERS: MIN_PLAYERS, MAX_PLAYERS: MAX_PLAYERS,
    createGame: createGame, getLegalMoves: getLegalMoves, applyMove: applyMove, chooseAIMove: chooseAIMove,
    isGameOver: isGameOver, getResults: getResults, getView: getView, tagScore: tagScore
  });
}));
