/* Arcade kit: 反应/点击挑战。state = { score, hits, misses, timeLeft, running, over } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var time = (params && params.time) || 30;

    function newGame() {
      return { score: 0, hits: 0, misses: 0, timeLeft: time, running: true, over: false };
    }

    function act(state, action) {
      if (state.over || !state.running) return { state: state, changed: false, gained: 0 };
      if (action === 'hit') {
        return {
          state: { score: state.score + 1, hits: state.hits + 1, misses: state.misses, timeLeft: state.timeLeft, running: true, over: false },
          changed: true, gained: 1,
        };
      }
      if (action === 'miss') {
        return {
          state: { score: state.score, hits: state.hits, misses: state.misses + 1, timeLeft: state.timeLeft, running: true, over: false },
          changed: true, gained: 0,
        };
      }
      if (action === 'tick') {
        var left = state.timeLeft - 1;
        var over = left <= 0;
        return {
          state: { score: state.score, hits: state.hits, misses: state.misses, timeLeft: Math.max(0, left), running: !over, over: over },
          changed: true, gained: 0,
        };
      }
      return { state: state, changed: false, gained: 0 };
    }

    function status(state) {
      if (!state.over) return 'playing';
      return 'won';
    }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['hit', 'miss', 'tick']; },
    };
  }
  return { create: create };
});
