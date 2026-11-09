/* Arcade kit: 汉诺塔。state = { disks, pegs:[[...],[...],[]], moves, won } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var disks = (params && params.disks) || 4;

    function newGame() {
      var first = [];
      for (var d = disks; d >= 1; d--) first.push(d);
      return { disks: disks, pegs: [first, [], []], moves: 0, won: false };
    }

    function act(state, action) {
      if (!Array.isArray(action) || action.length !== 2) return { state: state, changed: false, gained: 0 };
      var from = action[0], to = action[1];
      if (from === to || from < 0 || from > 2 || to < 0 || to > 2) return { state: state, changed: false, gained: 0 };
      var src = state.pegs[from], dst = state.pegs[to];
      if (!src.length) return { state: state, changed: false, gained: 0 };
      var moving = src[src.length - 1];
      if (dst.length && dst[dst.length - 1] < moving) return { state: state, changed: false, gained: 0 };
      var pegs = state.pegs.map(function (p) { return p.slice(); });
      pegs[from].pop();
      pegs[to].push(moving);
      var won = pegs[2].length === disks;
      return {
        state: { disks: disks, pegs: pegs, moves: state.moves + 1, won: won },
        changed: true,
        gained: 0,
      };
    }

    function status(state) { return state.pegs[2].length === disks ? 'won' : 'playing'; }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['[from,to]']; },
    };
  }
  return { create: create };
});
