/* No Thanks! (不谢) — pure UMD rules engine.
 * Node: require('./engine.js'); browser: window.NoThanksEngine
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NoThanksEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN_CARD = 3;
  var MAX_CARD = 35;
  var REMOVED = 9;
  var START_CHIPS = 11;
  var PLAYER_NAMES = ['你', '不谢达人', '筹码守财奴'];

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

  function fullDeck() {
    var d = [];
    for (var c = MIN_CARD; c <= MAX_CARD; c++) d.push(c);
    return d;
  }

  // Score for a set of cards: only the lowest card of each consecutive run
  // counts. Chips are subtracted separately.
  function scoreCards(cards) {
    var sorted = cards.slice().sort(function (a, b) { return a - b; });
    var total = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i] !== sorted[i - 1] + 1) total += sorted[i];
    }
    return total;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var count = opts.players == null ? 3 : opts.players;
    if (count < 2 || count > 5) throw new Error('players must be 2..5');
    var names = opts.names || PLAYER_NAMES;
    var deck = shuffle(fullDeck(), rng);
    var removed = deck.slice(0, REMOVED);
    deck = deck.slice(REMOVED);
    var players = [];
    for (var i = 0; i < count; i++) {
      players.push({
        name: names[i] || ('玩家' + (i + 1)),
        human: i === 0,
        chips: START_CHIPS,
        cards: []
      });
    }
    var state = {
      seed: seed,
      rng: rng,
      players: players,
      deck: deck,
      removed: removed.sort(function (a, b) { return a - b; }),
      current: deck.pop(),
      chipsOnCard: 0,
      turn: 0,
      phase: 'playing',
      log: [],
      winner: null,
      stepCount: 0
    };
    log(state, '翻开 ' + state.current + ' 号牌，轮到 ' + state.players[state.turn].name);
    return state;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 40) state.log.shift();
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
    p.cards.push(state.current);
    p.cards.sort(function (a, b) { return a - b; });
    p.chips += state.chipsOnCard;
    log(state, p.name + ' 收下 ' + state.current + '（附带 ' + state.chipsOnCard + ' 筹码）');
    state.chipsOnCard = 0;
    if (!state.deck.length) {
      state.current = null;
      state.phase = 'over';
      finish(state);
      return state;
    }
    state.current = state.deck.pop();
    state.chipsOnCard = 0;
    state.turn = (player + 1) % state.players.length;
    log(state, '翻开 ' + state.current + ' 号牌');
    return state;
  }

  function pass(state, player) {
    if (!legalPass(state, player)) throw new Error('illegal pass');
    var p = state.players[player];
    p.chips -= 1;
    state.chipsOnCard += 1;
    state.turn = (player + 1) % state.players.length;
    log(state, p.name + ' 放 1 个筹码跳过（牌上共 ' + state.chipsOnCard + '）');
    return state;
  }

  function score(state, player) {
    return scoreCards(state.players[player].cards) - state.players[player].chips;
  }

  function finish(state) {
    var best = 0;
    state.players.forEach(function (p, i) {
      if (score(state, i) < score(state, best)) best = i;
    });
    state.winner = best;
    log(state, '游戏结束：' + state.players[best].name + ' 以 ' + score(state, best) + ' 分获胜（分低者胜）');
  }

  // --- AI -----------------------------------------------------------------

  function marginalTake(state, player) {
    var p = state.players[player];
    var before = scoreCards(p.cards);
    var after = scoreCards(p.cards.concat([state.current]));
    var chips = state.chipsOnCard;
    // Net points paid if taking now; negative is good.
    return (after - before) - chips;
  }

  function aiAct(state, player) {
    var p = state.players[player];
    var card = state.current;
    var margin = marginalTake(state, player);
    var hasNeighbor = p.cards.some(function (c) { return Math.abs(c - card) === 1; });
    var desire = margin + (hasNeighbor ? -6 : 0) + state.rng() * 3;
    var takeNow;
    if (p.chips === 0) takeNow = true;
    else if (state.chipsOnCard >= 8) takeNow = desire < 5;
    else if (hasNeighbor && margin <= 2) takeNow = true;
    else if (margin <= 0) takeNow = true;
    else if (card >= 30 && p.chips <= 3) takeNow = desire < 4;
    else takeNow = false;
    if (takeNow) { take(state, player); return { type: 'take', player: player, card: card }; }
    pass(state, player);
    return { type: 'pass', player: player };
  }

  function step(state) {
    if (state.phase === 'over') return { over: true };
    state.stepCount++;
    if (state.stepCount > 10000) throw new Error('step limit: possible loop');
    if (state.turn === 0) return { needsHuman: true };
    return aiAct(state, state.turn);
  }

  function selfPlay(seed, players) {
    var state = createGame({ seed: seed, players: players || 3 });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 10000) throw new Error('no progress');
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
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          chips: p.chips,
          cards: p.cards.slice(),
          count: p.cards.length,
          score: score(state, i),
          human: i === viewer
        };
      }),
      winner: state.winner,
      log: state.log.slice()
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
    publicView: publicView,
    step: step,
    aiAct: aiAct,
    selfPlay: selfPlay,
    MIN_CARD: MIN_CARD,
    MAX_CARD: MAX_CARD,
    REMOVED: REMOVED,
    START_CHIPS: START_CHIPS,
    fullDeck: fullDeck,
    mulberry32: mulberry32
  };
});
