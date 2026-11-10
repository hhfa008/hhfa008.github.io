/*
 * Skull（骷髅牌）premium rules engine — UMD.
 * 3–6 players, 4 coasters each (3 roses + 1 skull), first to 2 challenges.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SkullEngine = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var Data = null;
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { Data = require('./data.js'); } catch (err) { Data = null; }
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!Data && root && root.SkullData) Data = root.SkullData;
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!Data) throw new Error('SkullEngine requires data.js');
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') throw new Error('SkullEngine requires games/shared/shuffle.js');

  var VERSION = '1.0.0';
  var MIN_PLAYERS = Data.MIN_PLAYERS;
  var MAX_PLAYERS = Data.MAX_PLAYERS;
  var TARGET_POINTS = Data.TARGET_POINTS;
  var MAX_LOG = 140;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function assertPlayerCount(n) { if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('玩家人数必须是 3–6'); }
  function totalDiscs(player) { return player.roses + player.skull; }
  function pushLog(state, text, data) {
    state.log.push({ turn: state.turn, round: state.round, text: text, data: data || null });
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }
  function nextActive(state, from) {
    var n = state.playerCount;
    for (var step = 1; step <= n; step++) {
      var idx = (from + step) % n;
      if (!state.players[idx].out) return idx;
    }
    return -1;
  }
  function activePlayers(state) { return state.players.filter(function (p) { return !p.out; }); }

  function resetRoundState(state, firstPlayer) {
    state.phase = 'placement';
    state.current = firstPlayer;
    state.turn += 1;
    state.placement = { placedTotal: 0, lastPlacedBy: null };
    state.bid = null;
    state.reveal = null;
    state.roundWinner = null;
    state.lastAction = null;
    state.players.forEach(function (p) { p.stack = []; p.passed = false; p.bidPassed = false; });
    pushLog(state, '第 ' + state.round + ' 轮：从 ' + state.players[firstPlayer].name + ' 开始放置。');
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var playerCount = opts.playerCount == null ? 3 : Number(opts.playerCount);
    assertPlayerCount(playerCount);
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var names = opts.names && opts.names.length === playerCount ? opts.names.slice() : Data.NAMES.slice(0, playerCount);
    var aiFlags = opts.isAI && opts.isAI.length === playerCount ? opts.isAI.slice() : names.map(function (_, i) { return i > 0; });
    var players = [];
    for (var i = 0; i < playerCount; i++) {
      players.push({ index: i, name: names[i], isAI: !!aiFlags[i], score: 0, roses: Data.ROSES_PER_PLAYER, skull: Data.SKULLS_PER_PLAYER, stack: [], passed: false, bidPassed: false, out: false, lost: 0 });
    }
    var state = {
      version: VERSION, seed: seed, playerCount: playerCount, players: players,
      round: 1, turn: 1, phase: 'placement', current: 0, firstPlayer: 0,
      placement: { placedTotal: 0, lastPlacedBy: null }, bid: null, reveal: null,
      roundWinner: null, over: false, winner: null, winners: [], targetPoints: TARGET_POINTS,
      log: [], lastAction: null, lastRound: null, result: null
    };
    resetRoundState(state, 0);
    state.lastRound = null;
    return state;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = state.players[state.current];
    if (!player || player.out) return [];
    var moves = [];
    if (state.phase === 'placement') {
      if (state.placement.placedTotal > 0) moves.push({ type: 'pass' });
      if (player.roses > 0) moves.push({ type: 'place', disc: 'rose' });
      if (player.skull > 0) moves.push({ type: 'place', disc: 'skull' });
      if (!moves.length) moves.push({ type: 'pass' });
      return moves;
    }
    if (state.phase === 'bidding') {
      var highest = state.bid ? state.bid.highest : 0;
      var total = state.placement.placedTotal;
      for (var amount = highest + 1; amount <= total; amount++) moves.push({ type: 'bid', amount: amount });
      if (highest > 0) moves.push({ type: 'pass' });
      return moves;
    }
    if (state.phase === 'reveal') {
      var bidder = state.reveal.bidder;
      state.players.forEach(function (p) {
        if (!p.stack.length) return;
        if (p.index === bidder) moves.push({ type: 'reveal', player: p.index });
        else if (!state.reveal.revealedFrom[p.index]) moves.push({ type: 'reveal', player: p.index });
      });
      return moves;
    }
    return moves;
  }

  function moveKey(move) { return [move.type, move.disc || '', move.amount == null ? '' : move.amount, move.player == null ? '' : move.player].join(':'); }
  function validateMove(state, move) {
    if (!state || state.over) return '对局已结束';
    if (!move || !move.type) return '动作格式不正确';
    var legal = getLegalMoves(state).some(function (m) { return moveKey(m) === moveKey(move); });
    if (!legal) return '动作不合法';
    return null;
  }

  function nextPlacementPlayer(state) {
    var n = state.playerCount;
    for (var step = 1; step <= n; step++) {
      var idx = (state.current + step) % n;
      var p = state.players[idx];
      if (!p.out && !p.passed) return idx;
    }
    return -1;
  }

  function beginBidding(state) {
    state.phase = 'bidding';
    state.bid = { highest: 0, bidder: null, current: state.placement.lastPlacedBy == null ? state.firstPlayer : state.placement.lastPlacedBy };
    state.current = state.bid.current;
    state.players.forEach(function (p) { p.bidPassed = false; });
    pushLog(state, '放置结束，共 ' + state.placement.placedTotal + ' 枚。由 ' + state.players[state.current].name + ' 开始叫价。');
  }

  function advanceBidding(state, from) {
    var n = state.playerCount;
    for (var step = 1; step <= n; step++) {
      var idx = (from + step) % n;
      if (!state.players[idx].out && !state.players[idx].bidPassed) return idx;
    }
    return -1;
  }

  function beginReveal(state) {
    state.phase = 'reveal';
    state.reveal = { bidder: state.bid.bidder, target: state.bid.highest, flipped: 0, flips: [], revealedFrom: {} };
    state.current = state.reveal.bidder;
    state.players.forEach(function (p) { state.reveal.revealedFrom[p.index] = 0; });
    pushLog(state, state.players[state.reveal.bidder].name + '叫到 ' + state.reveal.target + ' 枚，开始翻牌。');
  }

  function returnAllDiscs(state) {
    state.players.forEach(function (p) {
      p.stack.forEach(function (disc) { if (disc === 'rose') p.roses += 1; else p.skull += 1; });
      p.stack = [];
    });
    if (state.reveal) {
      state.reveal.flips.forEach(function (flip) {
        var owner = state.players[flip.player];
        if (flip.disc === 'rose') owner.roses += 1; else owner.skull += 1;
      });
    }
  }

  function loseRandomDisc(state, player) {
    var total = totalDiscs(player);
    if (!total) return null;
    var bag = [];
    for (var r = 0; r < player.roses; r++) bag.push('rose');
    for (var s = 0; s < player.skull; s++) bag.push('skull');
    bag = ShuffleApi.shuffle(bag, { seed: String(state.seed) + ':loss:' + state.round + ':' + state.turn + ':' + player.index });
    var lost = bag.pop();
    if (lost === 'skull') player.skull -= 1; else player.roses -= 1;
    player.lost += 1;
    return lost;
  }

  function finishRound(state, success, reason) {
    var bidder = state.reveal ? state.players[state.reveal.bidder] : null;
    var flips = state.reveal ? state.reveal.flips.slice() : [];
    var target = state.reveal ? state.reveal.target : 0;
    returnAllDiscs(state);
    var lostDisc = null;
    if (!success && bidder) {
      lostDisc = loseRandomDisc(state, bidder);
      pushLog(state, bidder.name + '挑战失败，失去一枚' + (lostDisc === 'skull' ? '骷髅' : '玫瑰') + '牌。');
    } else if (success && bidder) {
      bidder.score += 1;
      pushLog(state, bidder.name + '成功翻出 ' + target + ' 枚玫瑰，得分！');
    }
    state.players.forEach(function (p) {
      if (!p.out && totalDiscs(p) === 0) { p.out = true; pushLog(state, p.name + '失去全部牌，出局。'); }
    });
    state.lastRound = {
      round: state.round, success: !!success, bidder: bidder ? bidder.index : null,
      bidderName: bidder ? bidder.name : null, target: target, flips: flips, lostDisc: lostDisc, reason: reason,
      scores: state.players.map(function (p) { return { index: p.index, name: p.name, score: p.score, discs: totalDiscs(p), out: p.out }; })
    };
    state.log.push({ turn: state.turn, round: state.round, text: '第 ' + state.round + ' 轮结束。', data: { type: 'round-end' } });
    var leaders = activePlayers(state).filter(function (p) { return p.score >= TARGET_POINTS; });
    var alive = activePlayers(state);
    if (leaders.length) {
      state.over = true; state.winners = leaders.map(function (p) { return p.index; });
      state.winner = state.winners.length === 1 ? state.winners[0] : -1;
      state.phase = 'over'; state.result = makeResult(state);
      pushLog(state, state.winner >= 0 ? state.players[state.winner].name + '赢得整场比赛！' : '共享胜利。');
      return;
    }
    if (alive.length <= 1) {
      state.over = true; state.winners = alive.map(function (p) { return p.index; });
      state.winner = state.winners.length === 1 ? state.winners[0] : -1;
      state.phase = 'over'; state.result = makeResult(state);
      pushLog(state, state.winner >= 0 ? state.players[state.winner].name + '成为最后的玩家！' : '无人可继续。');
      return;
    }
    state.round += 1;
    var next = nextActive(state, state.firstPlayer);
    state.firstPlayer = next;
    resetRoundState(state, next);
  }

  function makeResult(state) {
    return {
      over: state.over, winners: state.winners.slice(), targetPoints: state.targetPoints,
      scores: state.players.map(function (p) { return { index: p.index, name: p.name, score: p.score, discs: totalDiscs(p), isAI: p.isAI, out: p.out }; }),
      rounds: state.round
    };
  }

  function resolvePlacement(state, move) {
    var player = state.players[state.current];
    if (move.type === 'pass') {
      player.passed = true;
      pushLog(state, player.name + '停手。');
      state.lastAction = { type: 'pass', player: player.index, name: player.name };
    } else {
      var disc = move.disc;
      if (disc === 'rose') player.roses -= 1; else player.skull -= 1;
      player.stack.unshift(disc);
      state.placement.placedTotal += 1;
      state.placement.lastPlacedBy = player.index;
      player.passed = false;
      pushLog(state, player.name + '放置了一枚牌（面朝下）。');
      state.lastAction = { type: 'place', player: player.index, name: player.name };
    }
    state.turn += 1;
    var next = nextPlacementPlayer(state);
    if (next < 0) { beginBidding(state); return; }
    state.current = next;
    if (state.placement.placedTotal > 0 && activePlayers(state).every(function (p) { return p.passed; })) beginBidding(state);
  }

  function resolveBid(state, move) {
    var player = state.players[state.current];
    if (move.type === 'pass') {
      player.bidPassed = true;
      pushLog(state, player.name + '不叫了。');
      state.lastAction = { type: 'pass', player: player.index, name: player.name };
    } else {
      state.bid.highest = move.amount;
      state.bid.bidder = state.current;
      pushLog(state, player.name + '叫到 ' + move.amount + ' 枚。');
      state.lastAction = { type: 'bid', player: player.index, name: player.name, amount: move.amount };
    }
    state.turn += 1;
    var active = state.players.filter(function (p) { return !p.out && !p.bidPassed; });
    if (active.length <= 1 && state.bid.highest > 0) { beginReveal(state); return; }
    var next = advanceBidding(state, state.current);
    if (next < 0) { beginReveal(state); return; }
    state.current = next;
  }

  function resolveReveal(state, move) {
    var target = state.players[move.player];
    var disc = target.stack.shift();
    state.reveal.revealedFrom[target.index] = (state.reveal.revealedFrom[target.index] || 0) + 1;
    state.reveal.flips.push({ player: target.index, disc: disc });
    state.reveal.flipped += 1;
    state.turn += 1;
    state.lastAction = { type: 'reveal', player: target.index, name: target.name, disc: disc };
    if (disc === 'skull') {
      pushLog(state, target.name + '的牌翻开：骷髅！挑战失败。');
      finishRound(state, false, 'skull');
      return;
    }
    pushLog(state, target.name + '的牌翻开：玫瑰（' + state.reveal.flipped + '/' + state.reveal.target + '）。');
    if (state.reveal.flipped >= state.reveal.target) { finishRound(state, true, 'success'); return; }
    var stillRevealable = getLegalMoves(state).some(function (m) { return m.type === 'reveal'; });
    if (!stillRevealable) {
      pushLog(state, '所有可翻的牌都已翻开，仍未达到叫价。挑战失败。');
      finishRound(state, false, 'exhausted');
      return;
    }
    state.current = state.reveal.bidder;
  }

  function applyMove(state, move) {
    var error = validateMove(state, move);
    if (error) throw new Error(error);
    var next = clone(state);
    if (next.phase === 'placement') resolvePlacement(next, move);
    else if (next.phase === 'bidding') resolveBid(next, move);
    else if (next.phase === 'reveal') resolveReveal(next, move);
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

  function chooseAIMove(state) {
    if (!state || state.over) return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var rng = rngFor(state);
    var player = state.players[state.current];
    if (state.phase === 'placement') {
      var places = moves.filter(function (m) { return m.type === 'place'; });
      if (!places.length) return { type: 'pass' };
      var roseMove = places.filter(function (m) { return m.disc === 'rose'; })[0];
      var skullMove = places.filter(function (m) { return m.disc === 'skull'; })[0];
      var stackLen = player.stack.length;
      if (!stackLen) {
        if (skullMove && player.roses > 0 && rng() < 0.42) return skullMove;
        if (roseMove) return roseMove;
        return places[0];
      }
      if (state.placement.placedTotal >= state.playerCount + 1 && rng() < 0.26) return { type: 'pass' };
      if (skullMove && player.roses === 0) return skullMove;
      if (roseMove) return roseMove;
      return places[0];
    }
    if (state.phase === 'bidding') {
      var total = state.placement.placedTotal;
      var highest = state.bid.highest;
      var min = highest + 1;
      var ownTopRoses = 0;
      for (var i = 0; i < player.stack.length; i++) { if (player.stack[i] === 'rose') ownTopRoses += 1; else break; }
      var opponentStacks = state.players.filter(function (p) { return p.index !== player.index && !p.out && p.stack.length; }).length;
      var expected = ownTopRoses + opponentStacks * 0.7;
      if (expected < 1) expected = 1;
      if (min > total) return highest > 0 ? { type: 'pass' } : null;
      if (min > Math.ceil(expected) && highest > 0) return { type: 'pass' };
      var amount = Math.min(total, Math.max(min, Math.floor(expected) + (rng() < 0.2 ? 1 : 0)));
      var bids = moves.filter(function (m) { return m.type === 'bid' && m.amount === amount; });
      if (bids.length) return bids[0];
      return moves.filter(function (m) { return m.type === 'bid'; }).slice(-1)[0] || { type: 'pass' };
    }
    if (state.phase === 'reveal') {
      var reveals = moves.filter(function (m) { return m.type === 'reveal'; });
      if (!reveals.length) return null;
      var own = player.stack.length ? reveals.filter(function (m) { return m.player === player.index; }) : [];
      if (own.length && player.stack[0] === 'rose') return own[0];
      var others = reveals.filter(function (m) { return m.player !== player.index; });
      if (others.length) return pick(others, rng);
      return pick(reveals, rng);
    }
    return moves[0];
  }

  function isGameOver(state) { return !!(state && state.over); }
  function getResults(state) { return state ? makeResult(state) : null; }

  function getView(state, seat) {
    if (!state) return null;
    var viewer = seat != null && state.players[seat] ? seat : null;
    return {
      version: state.version, playerCount: state.playerCount, round: state.round, turn: state.turn,
      phase: state.phase, current: state.current, firstPlayer: state.firstPlayer, targetPoints: state.targetPoints,
      over: state.over, winner: state.winner, winners: state.winners ? state.winners.slice() : [],
      placement: state.placement ? { placedTotal: state.placement.placedTotal, lastPlacedBy: state.placement.lastPlacedBy } : null,
      bid: state.bid ? { highest: state.bid.highest, bidder: state.bid.bidder, current: state.bid.current } : null,
      reveal: state.reveal ? { bidder: state.reveal.bidder, target: state.reveal.target, flipped: state.reveal.flipped, flips: state.reveal.flips.map(function (f) { return { player: f.player, disc: f.disc }; }) } : null,
      players: state.players.map(function (p) {
        var own = viewer === p.index || state.over;
        return {
          index: p.index, name: p.name, isAI: p.isAI, score: p.score, out: p.out,
          passed: p.passed, bidPassed: p.bidPassed, handCount: totalDiscs(p),
          roses: own ? p.roses : null, skull: own ? p.skull : null,
          stack: p.stack.map(function (disc) { return own ? disc : 'hidden'; }), stackCount: p.stack.length
        };
      }),
      log: state.log.slice(-50),
      lastAction: state.lastAction ? clone(state.lastAction) : null,
      lastRound: state.lastRound ? clone(state.lastRound) : null,
      result: state.over ? getResults(state) : null
    };
  }

  return Object.freeze({
    VERSION: VERSION, MIN_PLAYERS: MIN_PLAYERS, MAX_PLAYERS: MAX_PLAYERS, TARGET_POINTS: TARGET_POINTS,
    ROSES_PER_PLAYER: Data.ROSES_PER_PLAYER, SKULLS_PER_PLAYER: Data.SKULLS_PER_PLAYER, DISCS_PER_PLAYER: Data.DISCS_PER_PLAYER,
    createGame: createGame, getLegalMoves: getLegalMoves, applyMove: applyMove, chooseAIMove: chooseAIMove,
    isGameOver: isGameOver, getResults: getResults, getView: getView, totalDiscs: totalDiscs
  });
}));
