/* Arcade kit: 翻牌记忆（rows×cols）。state = { cards, flips, moves, won }
 * cards: [{ pair: number, up: bool, matched: bool }]
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var rows = (params && params.rows) || 4;
    var cols = (params && params.cols) || 4;
    var N = rows * cols;
    var pairs = Math.floor(N / 2);

    function deck() {
      var out = [];
      for (var p = 0; p < pairs; p++) { out.push({ pair: p, up: false, matched: false }); out.push({ pair: p, up: false, matched: false }); }
      if (out.length < N) out.push({ pair: -1, up: false, matched: true });
      return out;
    }

    function shuffle(arr, rng) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }

    function newGame(rng) {
      rng = rng || Math.random;
      return { cards: shuffle(deck(), rng), flips: 0, moves: 0, won: false };
    }

    function act(state, index, rng) {
      if (typeof index !== 'number' || index < 0 || index >= state.cards.length) {
        return { state: state, changed: false, gained: 0 };
      }
      if (state.cards[index].matched || state.cards[index].up) {
        return { state: state, changed: false, gained: 0 };
      }
      var cards = state.cards.map(function (c) {
        return { pair: c.pair, up: c.up, matched: c.matched };
      });
      cards[index].up = true;
      var up = [];
      for (var i = 0; i < cards.length; i++) if (cards[i].up && !cards[i].matched) up.push(i);
      var moves = state.moves;
      var gained = 0;
      if (up.length === 2) {
        moves++;
        if (cards[up[0]].pair === cards[up[1]].pair) {
          cards[up[0]].matched = true;
          cards[up[1]].matched = true;
          cards[up[0]].up = false;
          cards[up[1]].up = false;
          gained = 1;
        } else {
          cards[up[0]].up = false;
          cards[up[1]].up = false;
        }
      }
      var won = cards.every(function (c) { return c.matched; });
      return {
        state: { cards: cards, flips: state.flips + 1, moves: moves, won: won },
        changed: true,
        gained: gained,
      };
    }

    function status(state) {
      return state.cards.every(function (c) { return c.matched; }) ? 'won' : 'playing';
    }

    return {
      newGame: newGame,
      act: act,
      status: status,
      rows: rows,
      cols: cols,
      actions: function () { return ['0..' + (N - 1)]; },
    };
  }
  return { create: create };
});
