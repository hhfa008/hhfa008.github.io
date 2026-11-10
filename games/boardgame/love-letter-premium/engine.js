/*
 * Love Letter（情书）premium rules engine — UMD.
 *
 * Official 2019 base game, 2–4 players, 16 cards. Draw one, play one.
 * First to 7 / 5 / 4 tokens (2 / 3 / 4 players) wins the match.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.LoveLetterEngine = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var Data = null;
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { Data = require('./data.js'); } catch (err) { Data = null; }
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!Data && root && root.LoveLetterData) Data = root.LoveLetterData;
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!Data) throw new Error('LoveLetterEngine requires data.js');
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('LoveLetterEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var CARDS = Data.CARDS;
  var BY_ID = Data.BY_ID;
  var TOTAL_CARDS = Data.TOTAL_CARDS;
  var TARGET_TOKENS = Data.TARGET_TOKENS;
  var BURN_COUNT = Data.BURN_COUNT;
  var NAMES = Data.NAMES;
  var MAX_LOG = 120;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function assertPlayerCount(n) {
    if (n !== 2 && n !== 3 && n !== 4) throw new Error('玩家人数必须是 2、3 或 4');
  }

  function cardName(id) { return BY_ID[id] ? BY_ID[id].name : '未知'; }

  function pushLog(state, text, data) {
    state.log.push({ turn: state.turn, round: state.round, text: text, data: data || null });
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }

  function alive(state) { return state.players.filter(function (p) { return !p.out; }); }
  function aliveOthers(state, index) {
    return state.players.filter(function (p) { return !p.out && p.index !== index; });
  }
  function handValue(player) { return player.hand.length ? player.hand[0] : 0; }
  function discardSum(player) {
    return player.discard.reduce(function (sum, id) { return sum + id; }, 0);
  }

  function buildDeck(state) {
    var deck = [];
    CARDS.forEach(function (card) {
      for (var i = 0; i < card.count; i++) deck.push(card.id);
    });
    deck = ShuffleApi.shuffle(deck, {
      seed: String(state.seed) + ':round:' + state.round + ':' + state.shuffleCount
    });
    state.shuffleCount += 1;
    return deck;
  }

  function clearKnownAbout(state, target) {
    Object.keys(state.known).forEach(function (viewer) {
      if (state.known[viewer]) delete state.known[viewer][target];
    });
  }

  function newRound(state, firstPlayer) {
    state.deck = buildDeck(state);
    var burnCount = BURN_COUNT[state.playerCount] || 0;
    state.burn = [];
    for (var b = 0; b < burnCount; b++) state.burn.push(state.deck.pop());
    state.players.forEach(function (player) {
      player.hand = [];
      player.discard = [];
      player.protected = false;
      player.out = false;
      player.hand.push(state.deck.pop());
    });
    state.current = firstPlayer == null ? 0 : firstPlayer;
    state.phase = 'play';
    state.roundWinner = null;
    state.roundWinners = [];
    state.lastAction = null;
    pushLog(state, '第 ' + state.round + ' 轮开始：16 张角色牌，' +
      (burnCount ? '暗置 ' + burnCount + ' 张，' : '') + '每人发 1 张。');
    beginTurn(state);
  }

  function beginTurn(state) {
    if (state.over) return;
    if (alive(state).length <= 1) { finishRound(state, '仅剩一名玩家'); return; }
    if (!state.deck.length) { finishByComparison(state); return; }
    var player = state.players[state.current];
    player.protected = false;
    player.hand.push(state.deck.pop());
    player.hand.sort(function (a, b) { return a - b; });
    state.phase = 'play';
  }

  function nextAlive(state, from) {
    var n = state.playerCount;
    for (var step = 1; step <= n; step++) {
      var idx = (from + step) % n;
      if (!state.players[idx].out) return idx;
    }
    return -1;
  }

  function eliminate(state, index, reason) {
    var player = state.players[index];
    if (player.out) return;
    player.out = true;
    player.protected = false;
    player.hand.forEach(function (id) { player.discard.push(id); });
    player.hand = [];
    clearKnownAbout(state, index);
    pushLog(state, player.name + '出局（' + reason + '）。', { type: 'out', player: index });
  }

  function finishByComparison(state) {
    var contenders = alive(state);
    var best = -1;
    contenders.forEach(function (p) {
      var value = handValue(p);
      if (value > best) best = value;
    });
    var top = contenders.filter(function (p) { return handValue(p) === best; });
    if (top.length > 1) {
      var bestDiscard = -1;
      top.forEach(function (p) { bestDiscard = Math.max(bestDiscard, discardSum(p)); });
      top = top.filter(function (p) { return discardSum(p) === bestDiscard; });
    }
    finishRound(state, '牌堆耗尽，比拼手牌', top.map(function (p) { return p.index; }));
  }

  function finishRound(state, reason, forcedWinners) {
    var winners = forcedWinners;
    if (!winners) winners = alive(state).map(function (p) { return p.index; });
    if (!winners.length) winners = state.players.map(function (p) { return p.index; });
    state.roundWinner = winners.length === 1 ? winners[0] : -1;
    state.roundWinners = winners.slice();
    state.phase = 'round-end';
    var hands = state.players.map(function (p) {
      return { index: p.index, name: p.name, value: handValue(p), discardSum: discardSum(p), out: p.out };
    });
    winners.forEach(function (index) { state.players[index].tokens += 1; });
    state.lastRound = {
      round: state.round,
      reason: reason,
      winners: winners.slice(),
      winnerNames: winners.map(function (i) { return state.players[i].name; }),
      shared: winners.length > 1,
      hands: hands,
      tokens: state.players.map(function (p) { return { index: p.index, name: p.name, tokens: p.tokens }; })
    };
    pushLog(state, reason + '。' + winners.map(function (i) { return state.players[i].name; }).join('、') +
      '获得情书标记。', { type: 'round-end', winners: winners.slice() });

    var topTokens = Math.max.apply(null, state.players.map(function (p) { return p.tokens; }));
    var leaders = state.players.filter(function (p) { return p.tokens === topTokens; });
    if (topTokens >= state.targetTokens) {
      state.over = true;
      state.phase = 'over';
      state.winners = leaders.map(function (p) { return p.index; });
      state.winner = state.winners.length === 1 ? state.winners[0] : -1;
      state.result = makeResult(state);
      pushLog(state, state.winner >= 0
        ? state.players[state.winner].name + '赢得整场比赛！' : '比赛以共享胜利结束。', { type: 'match-end' });
      return;
    }
    state.round += 1;
    newRound(state, winners[0]);
  }

  function makeResult(state) {
    var top = Math.max.apply(null, state.players.map(function (p) { return p.tokens; }));
    return {
      over: state.over,
      winners: state.players.filter(function (p) { return p.tokens === top && p.tokens >= state.targetTokens; })
        .map(function (p) { return p.index; }),
      tokens: state.players.map(function (p) {
        return { index: p.index, name: p.name, tokens: p.tokens, isAI: p.isAI };
      }),
      rounds: state.round,
      targetTokens: state.targetTokens
    };
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var playerCount = opts.playerCount == null ? 2 : Number(opts.playerCount);
    assertPlayerCount(playerCount);
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var names = opts.names && opts.names.length === playerCount ? opts.names.slice() : NAMES.slice(0, playerCount);
    var aiFlags = opts.isAI && opts.isAI.length === playerCount ? opts.isAI.slice() : names.map(function (_, i) { return i > 0; });
    var players = [];
    for (var i = 0; i < playerCount; i++) {
      players.push({ index: i, name: names[i], isAI: !!aiFlags[i], tokens: 0, hand: [], discard: [], protected: false, out: false });
    }
    var known = {};
    players.forEach(function (p) { known[p.index] = {}; });
    var state = {
      version: VERSION, seed: seed, shuffleCount: 1, playerCount: playerCount,
      players: players, deck: [], burn: [], current: 0, turn: 1, round: 1,
      phase: 'setup', over: false, winner: null, winners: [], roundWinner: null,
      roundWinners: [], targetTokens: TARGET_TOKENS[playerCount], known: known,
      log: [], lastAction: null, lastRound: null, result: null, firstPlayer: 0
    };
    newRound(state, 0);
    state.lastRound = null;
    return state;
  }

  function forcedCountess(player) {
    return player.hand.indexOf(7) >= 0 && (player.hand.indexOf(6) >= 0 || player.hand.indexOf(5) >= 0);
  }

  function getLegalMoves(state) {
    if (!state || state.over || state.phase !== 'play') return [];
    var player = state.players[state.current];
    var forced = forcedCountess(player);
    var others = aliveOthers(state, player.index);
    var moves = [];
    player.hand.forEach(function (card) {
      if (forced && card !== 7) return;
      if (card === 1) {
        others.forEach(function (target) {
          for (var guess = 2; guess <= 8; guess++) {
            moves.push({ type: 'play', card: 1, target: target.index, guess: guess });
          }
        });
      } else if (card === 2 || card === 3 || card === 6) {
        others.forEach(function (target) { moves.push({ type: 'play', card: card, target: target.index }); });
      } else if (card === 5) {
        alive(state).forEach(function (target) { moves.push({ type: 'play', card: 5, target: target.index }); });
      } else {
        moves.push({ type: 'play', card: card });
      }
    });
    return moves;
  }

  function moveKey(move) {
    return [move.card, move.target == null ? '-' : move.target, move.guess == null ? '-' : move.guess].join(':');
  }

  function validateMove(state, move) {
    if (!state || state.over) return '对局已结束';
    if (state.phase !== 'play') return '当前不能出牌';
    if (!move || move.type !== 'play') return '动作格式不正确';
    var player = state.players[state.current];
    if (player.hand.indexOf(move.card) < 0) return '手中没有这张牌';
    if (forcedCountess(player) && move.card !== 7) return '持有女伯爵与国王/王子时必须打出女伯爵';
    var legal = getLegalMoves(state).some(function (m) { return moveKey(m) === moveKey(move); });
    if (!legal) return '目标或猜测不合法';
    return null;
  }

  function resolve(state, move) {
    var actor = state.players[state.current];
    var actorIndex = actor.index;
    var card = move.card;
    var targetIndex = move.target;
    var target = targetIndex == null ? null : state.players[targetIndex];
    var index = actor.hand.indexOf(card);
    actor.hand.splice(index, 1);
    // A Priest fact stays true while the seen card remains in hand. If the
    // target plays the seen card, the remaining card is unknown.
    Object.keys(state.known).forEach(function (viewer) {
      var known = state.known[viewer][actorIndex];
      if (known == null) return;
      if (card === known) delete state.known[viewer][actorIndex];
      else state.known[viewer][actorIndex] = handValue(actor);
    });
    var effect = { card: card, cardName: cardName(card), target: targetIndex == null ? null : targetIndex, guess: move.guess == null ? null : move.guess };
    var detail = [];
    var cancelled = false;

    if (card === 1) {
      effect.guessName = cardName(move.guess);
      if (target.protected) { cancelled = true; detail.push(target.name + '受侍女保护，卫兵的猜测落空。'); }
      else if (handValue(target) === move.guess) {
        detail.push('猜中了：' + target.name + '手中正是' + cardName(move.guess) + '。');
        eliminate(state, target.index, '被卫兵猜中');
      } else detail.push('猜错了：' + target.name + '手中不是' + cardName(move.guess) + '。');
    } else if (card === 2) {
      if (target.protected) { cancelled = true; detail.push(target.name + '受侍女保护，神父什么也看不到。'); }
      else { state.known[actorIndex][target.index] = handValue(target); detail.push(actor.name + '看到了' + target.name + '的手牌。'); }
    } else if (card === 3) {
      if (target.protected) { cancelled = true; detail.push(target.name + '受侍女保护，男爵的比较无效。'); }
      else {
        var mine = handValue(actor), theirs = handValue(target);
        detail.push('男爵比较：' + actor.name + ' ' + mine + ' 对 ' + target.name + ' ' + theirs + '。');
        if (mine < theirs) eliminate(state, actorIndex, '男爵落败');
        else if (theirs < mine) eliminate(state, target.index, '男爵落败');
        else detail.push('平手，无人出局。');
      }
    } else if (card === 4) {
      actor.protected = true;
      detail.push(actor.name + '受到侍女保护，直到下个回合。');
    } else if (card === 5) {
      if (target.index !== actorIndex && target.protected) { cancelled = true; detail.push(target.name + '受侍女保护，王子的命令无效。'); }
      else if (!target.hand.length) detail.push(target.name + '没有手牌可弃。');
      else {
        var dropped = target.hand.shift();
        target.discard.push(dropped);
        clearKnownAbout(state, target.index);
        detail.push(target.name + '弃掉了手牌' + (target.index === actorIndex ? '' : '（' + cardName(dropped) + '）') + '。');
        if (dropped === 8) eliminate(state, target.index, '弃掉公主');
        else if (state.deck.length) { target.hand.push(state.deck.pop()); detail.push(target.name + '补了一张牌。'); }
        else detail.push('牌堆已空，' + target.name + '无法补牌。');
      }
    } else if (card === 6) {
      if (target.protected) { cancelled = true; detail.push(target.name + '受侍女保护，国王无法交换。'); }
      else {
        var tmp = actor.hand;
        actor.hand = target.hand;
        target.hand = tmp;
        clearKnownAbout(state, actorIndex);
        clearKnownAbout(state, target.index);
        detail.push('国王与' + target.name + '交换了手牌。');
      }
    } else if (card === 7) detail.push('女伯爵没有额外效果。');
    else if (card === 8) { detail.push(actor.name + '打出了公主。'); eliminate(state, actorIndex, '打出公主'); }

    actor.discard.push(card);
    state.lastAction = {
      player: actorIndex, playerName: actor.name, card: card, cardName: cardName(card),
      target: effect.target, targetName: target ? target.name : null,
      guess: effect.guess, guessName: effect.guessName || null,
      cancelled: cancelled, detail: detail.join(' '), turn: state.turn
    };
    pushLog(state, actor.name + '打出「' + cardName(card) + '」。' +
      (effect.target != null ? '目标：' + target.name + '。' : '') + detail.join(' '),
      { type: 'play', player: actorIndex, card: card, target: effect.target });
    state.turn += 1;

    if (alive(state).length <= 1) { finishRound(state, '仅剩一名玩家'); return; }
    if (!state.deck.length && !alive(state).some(function (p) { return p.hand.length; })) {
      finishByComparison(state);
      return;
    }
    var next = nextAlive(state, actorIndex);
    if (next < 0) { finishRound(state, '无人可继续'); return; }
    state.current = next;
    beginTurn(state);
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
  function pickRandom(list, rng) { return list.length ? list[Math.floor(rng() * list.length) % list.length] : null; }

  function chooseAIMove(state) {
    if (!state || state.over || state.phase !== 'play') return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var player = state.players[state.current];
    var rng = rngFor(state);
    var others = aliveOthers(state, player.index);
    var known = state.known[player.index] || {};
    var remaining = player.hand.slice();
    var forced = forcedCountess(player);
    if (forced) return moves.filter(function (m) { return m.card === 7; })[0] || moves[0];

    function without(card) { var i = remaining.indexOf(card); return i >= 0 ? remaining[(i + 1) % remaining.length] : remaining[0]; }
    function has(card) { return remaining.indexOf(card) >= 0; }

    if (has(1)) {
      var guardMoves = moves.filter(function (m) { return m.card === 1; });
      var knownHit = guardMoves.filter(function (m) { return known[m.target] === m.guess; });
      if (knownHit.length) return knownHit[0];
      var guesses = [8, 7, 6, 5, 3, 2, 4];
      for (var g = 0; g < guesses.length; g++) {
        var hits = guardMoves.filter(function (m) { return m.guess === guesses[g]; });
        if (hits.length && rng() < 0.42) return hits[Math.floor(rng() * hits.length)];
      }
      return pickRandom(guardMoves, rng) || moves[0];
    }
    if (has(5)) {
      var ownOther = without(5);
      var princeMoves = moves.filter(function (m) { return m.card === 5; });
      if (ownOther === 8) {
        var enemy = princeMoves.filter(function (m) { return m.target !== player.index; });
        if (enemy.length) return enemy[0];
      }
      var unprotected = princeMoves.filter(function (m) { return m.target === player.index || !state.players[m.target].protected; });
      if (unprotected.length) return pickRandom(unprotected, rng);
      return princeMoves[0];
    }
    if (has(3)) {
      var keep = without(3);
      if (keep >= 5) { var baronMoves = moves.filter(function (m) { return m.card === 3; }); if (baronMoves.length) return baronMoves[0]; }
    }
    if (has(6)) {
      var kingKeep = without(6);
      if (kingKeep <= 3) {
        var kingMoves = moves.filter(function (m) { return m.card === 6; });
        if (kingMoves.length && rng() < 0.85) return pickRandom(kingMoves, rng);
      }
    }
    if (has(2) && others.length) {
      var unknownTargets = others.filter(function (p) { return known[p.index] == null; });
      if (unknownTargets.length && rng() < 0.8) {
        var priestMoves = moves.filter(function (m) { return m.card === 2 && m.target === unknownTargets[0].index; });
        if (priestMoves.length) return priestMoves[0];
      }
    }
    if (has(4)) {
      var other = without(4);
      if (other === 8 || other === 7 || other <= 2) {
        var handmaid = moves.filter(function (m) { return m.card === 4; });
        if (handmaid.length) return handmaid[0];
      }
    }
    var safe = moves.filter(function (m) { return m.card !== 8; });
    if (safe.length) {
      var prefer = safe.filter(function (m) { return m.card !== 7; });
      return pickRandom(prefer.length ? prefer : safe, rng);
    }
    return moves[0];
  }

  function isGameOver(state) { return !!(state && state.over); }

  function getResults(state) {
    if (!state) return null;
    var top = Math.max.apply(null, state.players.map(function (p) { return p.tokens; }));
    return {
      over: state.over, winner: state.winner,
      winners: state.players.filter(function (p) { return p.tokens === top && p.tokens >= state.targetTokens; }).map(function (p) { return p.index; }),
      shared: state.winners && state.winners.length > 1,
      targetTokens: state.targetTokens,
      tokens: state.players.map(function (p) { return { index: p.index, name: p.name, tokens: p.tokens, isAI: p.isAI }; }),
      rounds: state.round
    };
  }

  function getView(state, seat) {
    if (!state) return null;
    var revealAll = state.over;
    var viewer = seat != null && state.players[seat] ? seat : null;
    return {
      version: state.version, playerCount: state.playerCount, current: state.current,
      turn: state.turn, round: state.round, phase: state.phase, over: state.over,
      winner: state.winner, winners: state.winners ? state.winners.slice() : [],
      targetTokens: state.targetTokens, deckLeft: state.deck.length, burnCount: state.burn.length,
      players: state.players.map(function (p) {
        var own = viewer != null && p.index === viewer;
        return {
          index: p.index, name: p.name, isAI: p.isAI, tokens: p.tokens, out: p.out,
          protected: p.protected, discard: p.discard.slice(), handCount: p.hand.length,
          hand: (own || revealAll) ? p.hand.slice() : p.hand.map(function () { return 'hidden'; })
        };
      }),
      known: viewer != null ? clone(state.known[viewer] || {}) : {},
      log: state.log.slice(-50),
      lastAction: state.lastAction ? clone(state.lastAction) : null,
      lastRound: state.lastRound ? clone(state.lastRound) : null,
      result: state.over ? getResults(state) : null
    };
  }

  return Object.freeze({
    VERSION: VERSION, CARDS: CARDS, BY_ID: BY_ID, TOTAL_CARDS: TOTAL_CARDS,
    TARGET_TOKENS: TARGET_TOKENS, BURN_COUNT: BURN_COUNT,
    createGame: createGame, getLegalMoves: getLegalMoves, applyMove: applyMove,
    chooseAIMove: chooseAIMove, isGameOver: isGameOver, getResults: getResults,
    getView: getView, handValue: handValue, discardSum: discardSum, cardName: cardName
  });
}));
