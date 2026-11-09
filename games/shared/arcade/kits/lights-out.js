/* Arcade kit: 关灯（n×n）。state = { lights, moves, won } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var n = (params && params.n) || 3;
    var N = n * n;

    function toggle(lights, index) {
      var r = Math.floor(index / n), c = index % n;
      var add = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var k = 0; k < add.length; k++) {
        var rr = r + add[k][0], cc = c + add[k][1];
        if (rr >= 0 && rr < n && cc >= 0 && cc < n) {
          var at = rr * n + cc;
          lights[at] = lights[at] ? 0 : 1;
        }
      }
      return lights;
    }

    function newGame(rng) {
      rng = rng || Math.random;
      var lights = new Array(N).fill(0);
      var clicks = 6 + n;
      for (var i = 0; i < clicks; i++) {
        toggle(lights, Math.min(N - 1, Math.floor(rng() * N)));
      }
      if (lights.every(function (v) { return v === 0; })) {
        toggle(lights, Math.floor(N / 2));
      }
      return { lights: lights, moves: 0, won: false };
    }

    function act(state, index, rng) {
      if (typeof index !== 'number' || index < 0 || index >= N) {
        return { state: state, changed: false, gained: 0 };
      }
      var lights = state.lights.slice();
      toggle(lights, index);
      var won = lights.every(function (v) { return v === 0; });
      return {
        state: { lights: lights, moves: state.moves + 1, won: won },
        changed: true,
        gained: 0,
      };
    }

    function status(state) {
      return state.lights.every(function (v) { return v === 0; }) ? 'won' : 'playing';
    }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['0..' + (N - 1)]; },
    };
  }
  return { create: create };
});
