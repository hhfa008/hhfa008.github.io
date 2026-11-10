/* No Thanks! (不谢) — premium UMD rules engine.
 * Node: require('./engine.js'); browser: window.NoThanksPremiumEngine
 *
 * Rules implemented (official 3-5 player game):
 *  - Cards 3..35 (33 cards). Nine are removed face-down before play.
 *  - Every player starts with 11 chips.
 *  - The top card is revealed. On your turn either take the card together with
 *    every chip on it, or pay one chip onto the card and pass.
 *  - You may not pass with zero chips; you must take the card.
 *  - When all 24 remaining cards have been taken the game ends.
 *  - Score = for each run of consecutive cards only its lowest card counts,
 *    minus one point per chip. Lowest total wins.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.NoThanksPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Reuse the repo-wide seeded Fisher-Yates. No per-game shuffle copy.
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('NoThanksPremiumEngine requires games/shared/shuffle.js');
  }

  var MIN_CARD = 3;
  var MAX_CARD = 35;
  var REMOVED = 9;
  var START_CHIPS = 11;
  var MIN_PLAYERS = 3;
  var MAX_PLAYERS = 5;
  var DEFAULT_NAMES = ['你', '不谢达人', '筹码守财奴', '薄荷商人', '迟到的骑士'];

  // Serializable PRNG step for AI-only variance. The deal itself uses the
  // shared seeded shuffle; keeping this counter in state means a match can be
  // cloned, replayed and sent over JSON without losing determinism.
  function nextRandom(state) {
    var a = (state.rngState | 0) + 0x6D2B79F5 | 0;
    state.rngState = a;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  function fullDeck() {
    var d = [];
    for (var c = MIN_CARD; c <= MAX_CARD; c++) d.push(c);
    return d;
  }

  // Official scoring: only the first card of a consecutive run is paid for.
  function scoreCards(cards) {
    var sorted = cards.slice().sort(function (a, b) { return a - b; });
    var total = 0;
    var runs = [];
    for (var i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i] !== sorted[i - 1] + 1) {
        total += sorted[i];
        runs.push([sorted[i]]);
      } else {
        runs[runs.length - 1].push(sorted[i]);
      }
    }
    return total;
  }

  function scoreBreakdown(state, player) {
    var p = state.players[player];
    var sorted = p.cards.slice().sort(function (a, b) { return a - b; });
    var runs = [];
    sorted.forEach(function (card) {
      var last = runs[runs.length - 1];
      if (last && last[last.length - 1] + 1 === card) last.push(card);
      else runs.push([card]);
    });
    return {
      cards: sorted.slice(),
      runs: runs.map(function (run) { return { cards: run.slice(), cost: run[0] }; }),
      cardPoints: scoreCards(p.cards),
      chips: p.chips,
      total: scoreCards(p.cards) - p.chips
    };
  }

  function makePlayers(count, names) {
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        id: i,
        name: (names && names[i]) || DEFAULT_NAMES[i] || ('玩家' + (i + 1)),
        human: i === 0,
        chips: START_CHIPS,
        cards: []
      });
    }
    return out;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var count = opts.players == null ? 3 : opts.players;
    if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
      throw new Error('players must be ' + MIN_PLAYERS + '..' + MAX_PLAYERS);
    }
    var deck = ShuffleApi.shuffle(fullDeck(), { seed: seed });
    var removed = deck.slice(0, REMOVED).sort(function (a, b) { return a - b; });
    deck = deck.slice(REMOVED);
    var state = {
      version: 1,
      seed: seed,
      rngState: (seed | 0) || 1,
      players: makePlayers(count, opts.names),
      deck: deck,                      // draw order; hidden from every view
      removed: removed,                // hidden until the game ends
      current: null,
      chipsOnCard: 0,
      turn: 0,
      phase: 'playing',                // playing | over
      winner: null,
      winnerIds: [],
      log: [],
      events: [],
      stepCount: 0,
      turnCount: 0
    };
    state.current = state.deck.pop();
    emit(state, { type: 'start', card: state.current, player: state.turn });
    log(state, '翻开 ' + state.current + ' 号牌，' + state.players[state.turn].name + ' 先行动');
    return state;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 60) state.log.shift();
  }

  function emit(state, event) {
    state.events.push(event);
    if (state.events.length > 80) state.events.shift();
  }

  function legalTake(state, player) {
    return state.phase === 'playing' && state.current != null && player === state.turn;
  }

  function legalPass(state, player) {
    return legalTake(state, player) && state.players[player].chips > 0;
  }

  function take(state, player) {
    if (!legalTake(state, player)) throw new Error('illegal take');
    var p = state.players[player];
    var card = state.current;
    var chips = state.chipsOnCard;
    p.cards.push(card);
    p.cards.sort(function (a, b) { return a - b; });
    p.chips += chips;
    state.chipsOnCard = 0;
    state.turnCount++;
    emit(state, { type: 'take', player: player, card: card, chips: chips, total: p.chips });
    log(state, p.name + ' 收下 ' + card + ' 号牌' + (chips ? '，拿走 ' + chips + ' 枚筹码' : '') +
      '（筹码 ' + p.chips + '）');
    if (!state.deck.length) {
      state.current = null;
      state.phase = 'over';
      finish(state);
      return state;
    }
    state.current = state.deck.pop();
    state.chipsOnCard = 0;
    state.turn = (player + 1) % state.players.length;
    emit(state, { type: 'reveal', card: state.current, player: state.turn });
    log(state, '翻开 ' + state.current + ' 号牌');
    return state;
  }

  function pass(state, player) {
    if (!legalPass(state, player)) throw new Error('illegal pass');
    var p = state.players[player];
    p.chips -= 1;
    state.chipsOnCard += 1;
    state.turn = (player + 1) % state.players.length;
    state.turnCount++;
    emit(state, { type: 'pass', player: player, chipsOnCard: state.chipsOnCard, left: p.chips });
    log(state, p.name + ' 放 1 枚筹码跳过（牌上共 ' + state.chipsOnCard + ' 枚）');
    return state;
  }

  function score(state, player) {
    return scoreCards(state.players[player].cards) - state.players[player].chips;
  }

  function finish(state) {
    var best = Infinity;
    state.players.forEach(function (p, i) {
      var s = score(state, i);
      if (s < best) best = s;
    });
    state.winnerIds = [];
    state.players.forEach(function (p, i) {
      if (score(state, i) === best) state.winnerIds.push(i);
    });
    state.winner = state.winnerIds[0];
    emit(state, { type: 'over', winner: state.winner, winners: state.winnerIds.slice(), scores: state.players.map(function (p, i) { return score(state, i); }) });
    log(state, '游戏结束：' + state.winnerIds.map(function (i) { return state.players[i].name; }).join('、') +
      ' 以 ' + best + ' 分获胜（低分者胜）');
  }

  // --- AI -----------------------------------------------------------------
  // The AI compares the real marginal cost of taking now with the cost of
  // paying a chip and hoping the card comes back cheaper. It also values
  // neighbour cards (which turn two cards into one run) and dumps high cards
  // when it still has chips.
  function marginalTake(state, player) {
    var cards = state.players[player].cards;
    var before = scoreCards(cards);
    var after = scoreCards(cards.concat([state.current]));
    return (after - before) - state.chipsOnCard;
  }

  function hasNeighbour(cards, card) {
    for (var i = 0; i < cards.length; i++) {
      if (Math.abs(cards[i] - card) === 1) return true;
    }
    return false;
  }

  // Pure-ish decision: it advances only the serializable AI rng counter and
  // returns the action to apply. The online server applies it on the
  // authoritative match, so there is exactly one state mutation.
  function aiDecision(state, player) {
    if (!legalTake(state, player)) throw new Error('AI cannot act now');
    var p = state.players[player];
    var card = state.current;
    var margin = marginalTake(state, player);
    var neighbour = hasNeighbour(p.cards, card);
    var chipsLeft = p.chips;
    var stack = state.chipsOnCard;

    if (chipsLeft === 0) {
      return { type: 'take', player: player, card: card, reason: 'no-chips' };
    }

    // Value of one chip in the late game rises; with few cards left passing is
    // less attractive because the card may never return.
    var cardsLeft = state.deck.length + 1;
    var chipValue = 1 + (state.players.length - 1) / Math.max(2, cardsLeft);
    // marginalTake already subtracts the chips on the card, so the stack must
    // not be charged twice here. Neighbours and remaining cards are the only
    // extra adjustments.
    var desire = margin + (neighbour ? -5.5 : 0) + nextRandom(state) * 2.2;

    var threshold = chipValue + (chipsLeft >= 7 ? 0.8 : -0.3);
    if (stack >= 7) threshold += 3;
    if (cardsLeft <= 5) threshold -= 1.2;
    if (chipsLeft <= 2) threshold += 1.2;

    if (desire <= threshold) {
      return { type: 'take', player: player, card: card, reason: 'value', desire: desire, threshold: threshold };
    }
    return { type: 'pass', player: player, desire: desire, threshold: threshold };
  }

  function applyDecision(state, decision) {
    if (!decision) return null;
    if (decision.type === 'take') take(state, decision.player);
    else if (decision.type === 'pass') pass(state, decision.player);
    else throw new Error('unknown AI decision: ' + decision.type);
    return decision;
  }

  function aiAct(state, player) {
    return applyDecision(state, aiDecision(state, player));
  }

  function step(state) {
    if (state.phase === 'over') return { over: true };
    state.stepCount++;
    if (state.stepCount > 5000) throw new Error('step limit: possible loop');
    if (state.turn === 0 && state.players[0].human) return { needsHuman: true, turn: 0 };
    return aiAct(state, state.turn);
  }

  function selfPlay(seed, players) {
    var state = createGame({ seed: seed, players: players || 3, names: ['AI-1', 'AI-2', 'AI-3', 'AI-4', 'AI-5'] });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 5000) throw new Error('no progress');
      aiAct(state, state.turn);
    }
    return state;
  }

  function publicView(state, viewer) {
    return {
      phase: state.phase,
      current: state.current,
      chipsOnCard: state.chipsOnCard,
      turn: state.turn,
      deckCount: state.deck.length,
      turnCount: state.turnCount,
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          chips: p.chips,
          cards: p.cards.slice(),
          count: p.cards.length,
          score: score(state, i),
          breakdown: scoreBreakdown(state, i),
          human: i === viewer
        };
      }),
      winner: state.winner,
      winnerIds: state.winnerIds.slice(),
      log: state.log.slice(),
      // Deliberately no deck order and no removed cards while playing.
      removed: state.phase === 'over' ? state.removed.slice() : undefined
    };
  }

  return {
    createGame: createGame,
    take: take,
    pass: pass,
    legalTake: legalTake,
    legalPass: legalPass,
    score: score,
    scoreCards: scoreCards,
    scoreBreakdown: scoreBreakdown,
    publicView: publicView,
    step: step,
    aiAct: aiAct,
    aiDecision: aiDecision,
    applyDecision: applyDecision,
    selfPlay: selfPlay,
    marginalTake: marginalTake,
    MIN_CARD: MIN_CARD,
    MAX_CARD: MAX_CARD,
    REMOVED: REMOVED,
    START_CHIPS: START_CHIPS,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    fullDeck: fullDeck,
    nextRandom: nextRandom
  };
});
