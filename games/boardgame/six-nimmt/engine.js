/* 6 Nimmt! (谁是牛头王) — pure UMD rules engine.
 * Node: require('./engine.js'); browser: window.SixNimmtEngine
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SixNimmtEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PLAYER_NAMES = ['你', '牛头猎手', '接龙赌徒'];
  var HAND_SIZE = 10;
  var ROWS = 4;

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
    for (var c = 1; c <= 104; c++) d.push(c);
    return d;
  }

  // Official bull-head values: 55 is special, then multiples of 11/10/5.
  function bull(card) {
    if (card === 55) return 7;
    if (card % 11 === 0) return 5;
    if (card % 10 === 0) return 3;
    if (card % 5 === 0) return 2;
    return 1;
  }

  function rowPoints(row) {
    return row.reduce(function (a, c) { return a + bull(c); }, 0);
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var count = opts.players == null ? 3 : opts.players;
    if (count < 2 || count > 5) throw new Error('players must be 2..5');
    var names = opts.names || PLAYER_NAMES;
    var deck = shuffle(fullDeck(), rng);
    var players = [];
    for (var i = 0; i < count; i++) {
      var hand = deck.splice(0, HAND_SIZE).sort(function (a, b) { return a - b; });
      players.push({
        name: names[i] || ('玩家' + (i + 1)),
        human: i === 0,
        hand: hand,
        taken: []
      });
    }
    var rows = [];
    for (var r = 0; r < ROWS; r++) rows.push([deck.pop()]);
    var state = {
      seed: seed,
      rng: rng,
      players: players,
      rows: rows,
      round: 1,
      picks: players.map(function () { return null; }),
      phase: 'pick', // pick | chooseRow | over
      resolving: null,
      pending: null,
      log: [],
      winner: null,
      stepCount: 0
    };
    log(state, '第 1 轮：请选择一张手牌');
    return state;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 50) state.log.shift();
  }

  function legalCard(state, player, card) {
    if (state.phase !== 'pick') return false;
    if (state.players[player].hand.indexOf(card) < 0) return false;
    return state.picks[player] == null;
  }

  function chooseCard(state, player, card) {
    if (!legalCard(state, player, card)) throw new Error('illegal card');
    state.picks[player] = card;
    state.players[player].hand.splice(state.players[player].hand.indexOf(card), 1);
    if (state.picks.every(function (p) { return p != null; })) resolveRound(state);
    return state;
  }

  function targetRow(rows, card) {
    var best = -1;
    var bestEnd = -1;
    for (var i = 0; i < rows.length; i++) {
      var end = rows[i][rows[i].length - 1];
      if (end < card && end > bestEnd) { bestEnd = end; best = i; }
    }
    return best;
  }

  function resolveRound(state) {
    var entries = state.picks.map(function (card, player) { return { player: player, card: card }; });
    entries.sort(function (a, b) { return a.card - b.card; });
    state.picks = state.players.map(function () { return null; });
    state.phase = 'pick';
    state.resolving = { entries: entries, idx: 0 };
    continueResolve(state);
  }

  function continueResolve(state) {
    var res = state.resolving;
    while (res.idx < res.entries.length) {
      var entry = res.entries[res.idx];
      var trow = targetRow(state.rows, entry.card);
      if (trow < 0) {
        // Card is lower than every row end: the owner chooses a row.
        if (entry.player === 0) {
          state.phase = 'chooseRow';
          state.pending = { player: 0, card: entry.card };
          log(state, '你的 ' + entry.card + ' 小于所有行尾，请选择吃哪一行');
          return;
        }
        trow = aiRowChoice(state, entry.player);
        takeRow(state, entry.player, trow, entry.card, true);
      } else {
        placeOnRow(state, entry.player, trow, entry.card);
      }
      res.idx++;
    }
    finishResolve(state);
  }

  function placeOnRow(state, player, trow, card) {
    var row = state.rows[trow];
    if (row.length === 5) {
      takeRow(state, player, trow, card, false);
      return;
    }
    row.push(card);
    log(state, state.players[player].name + ' 的 ' + card + ' 接到第 ' + (trow + 1) + ' 行');
  }

  function takeRow(state, player, trow, card, mustChoose) {
    var row = state.rows[trow];
    var pts = rowPoints(row);
    state.players[player].taken = state.players[player].taken.concat(row);
    state.rows[trow] = [card];
    log(state, state.players[player].name + (mustChoose ? ' 选择' : ' 被迫') +
      '吃下第 ' + (trow + 1) + ' 行的 ' + row.join('/') + '（+' + pts + ' 牛头）');
  }

  function chooseRow(state, rowIndex) {
    if (state.phase !== 'chooseRow' || !state.pending) throw new Error('no row choice pending');
    if (rowIndex < 0 || rowIndex >= state.rows.length) throw new Error('bad row');
    var card = state.pending.card;
    takeRow(state, state.pending.player, rowIndex, card, true);
    state.pending = null;
    state.phase = 'pick';
    state.resolving.idx++;
    continueResolve(state);
    return state;
  }

  function finishResolve(state) {
    state.resolving = null;
    var empty = state.players.every(function (p) { return p.hand.length === 0; });
    if (empty) {
      state.phase = 'over';
      finish(state);
      return;
    }
    state.round++;
    state.phase = 'pick';
    log(state, '第 ' + state.round + ' 轮：请选择一张手牌');
  }

  function score(state, player) {
    return state.players[player].taken.reduce(function (a, c) { return a + bull(c); }, 0);
  }

  function finish(state) {
    var best = 0;
    state.players.forEach(function (p, i) {
      if (score(state, i) < score(state, best)) best = i;
    });
    state.winner = best;
    log(state, '游戏结束：' + state.players[best].name + ' 以 ' + score(state, best) + ' 牛头获胜（分低者胜）');
  }

  // --- AI -----------------------------------------------------------------

  function aiPickCard(state, player) {
    var hand = state.players[player].hand;
    var bestCard = hand[0];
    var bestCost = Infinity;
    for (var i = 0; i < hand.length; i++) {
      var card = hand[i];
      var trow = targetRow(state.rows, card);
      var cost;
      if (trow < 0) cost = 12 + rowPoints(state.rows[0]) * 0.1;
      else if (state.rows[trow].length === 5) cost = 10 + rowPoints(state.rows[trow]) * 0.1;
      else {
        // Safe cards are good; dumping very high cards early is slightly bad.
        cost = -3 + card / 200 + state.rng() * 2;
      }
      if (cost < bestCost) { bestCost = cost; bestCard = card; }
    }
    return bestCard;
  }

  function aiRowChoice(state, player) {
    var best = 0;
    for (var i = 1; i < state.rows.length; i++) {
      if (rowPoints(state.rows[i]) < rowPoints(state.rows[best])) best = i;
    }
    return best;
  }

  // Fill every empty pick with an AI choice, then resolve if all are picked.
  function aiFill(state) {
    var acted = [];
    for (var i = 0; i < state.players.length; i++) {
      if (i !== 0 && state.picks[i] == null) {
        var card = aiPickCard(state, i);
        chooseCard(state, i, card);
        acted.push({ player: i, card: card });
        if (state.phase !== 'pick') break;
      }
    }
    return acted;
  }

  function step(state) {
    if (state.phase === 'over') return { over: true };
    state.stepCount++;
    if (state.stepCount > 10000) throw new Error('step limit: possible loop');
    if (state.phase === 'chooseRow') {
      if (state.pending.player === 0) return { needsHuman: true, phase: 'chooseRow' };
      chooseRow(state, aiRowChoice(state, state.pending.player));
      return { type: 'row', player: state.pending && state.pending.player };
    }
    if (state.picks[0] == null) return { needsHuman: true, phase: 'pick' };
    aiFill(state);
    return { type: 'ai-fill' };
  }

  function selfPlay(seed, players) {
    var state = createGame({ seed: seed, players: players || 3 });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 10000) throw new Error('no progress');
      if (state.phase === 'chooseRow') {
        chooseRow(state, aiRowChoice(state, state.pending.player));
      } else if (state.phase === 'pick') {
        for (var i = 0; i < state.players.length; i++) {
          if (state.picks[i] == null) chooseCard(state, i, aiPickCard(state, i));
          if (state.phase !== 'pick') break;
        }
        if (state.phase === 'chooseRow' && state.pending.player !== 0) {
          chooseRow(state, aiRowChoice(state, state.pending.player));
        }
        if (state.phase === 'chooseRow' && state.pending.player === 0) {
          chooseRow(state, aiRowChoice(state, 0));
        }
      }
    }
    return state;
  }

  function publicView(state, viewer) {
    return {
      phase: state.phase,
      round: state.round,
      rows: state.rows.map(function (r) { return r.slice(); }),
      pending: state.pending,
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          hand: i === viewer ? p.hand.slice() : null,
          handCount: p.hand.length,
          taken: p.taken.slice(),
          score: score(state, i),
          picked: state.picks[i] != null,
          human: i === viewer
        };
      }),
      winner: state.winner,
      log: state.log.slice()
    };
  }

  return {
    createGame: createGame,
    chooseCard: chooseCard,
    chooseRow: chooseRow,
    legalCard: legalCard,
    aiPickCard: aiPickCard,
    aiRowChoice: aiRowChoice,
    aiFill: aiFill,
    step: step,
    selfPlay: selfPlay,
    publicView: publicView,
    bull: bull,
    rowPoints: rowPoints,
    score: score,
    targetRow: targetRow,
    HAND_SIZE: HAND_SIZE,
    ROWS: ROWS,
    fullDeck: fullDeck,
    mulberry32: mulberry32
  };
});
