/* Arcade kit: 贪吃蛇。state = { size, body:[[r,c],...], dir, food:[r,c], score, alive } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    params = params || {};
    var size = params.size || 16;
    var wrap = !!params.wrap;
    var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    var OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

    function occupied(state, r, c) {
      return state.body.some(function (p) { return p[0] === r && p[1] === c; });
    }

    function spawnFood(state, rng) {
      var free = [];
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) if (!occupied(state, r, c)) free.push([r, c]);
      }
      if (!free.length) return state.food;
      return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
    }

    function newGame(rng) {
      rng = rng || Math.random;
      var mid = Math.floor(size / 2);
      var state = {
        size: size,
        body: [[mid, mid + 1], [mid, mid], [mid, mid - 1]].filter(function (p) {
          return p[1] >= 0 && p[1] < size;
        }),
        dir: 'right',
        food: null,
        score: 0,
        alive: true,
      };
      state.food = spawnFood(state, rng);
      return state;
    }

    function act(state, dir, rng) {
      rng = rng || Math.random;
      if (!state.alive || !DIRS[dir] || OPP[state.dir] === dir) {
        return { state: state, changed: false, gained: 0 };
      }
      var head = state.body[0];
      var nr = head[0] + DIRS[dir][0];
      var nc = head[1] + DIRS[dir][1];
      if (wrap) {
        nr = (nr + size) % size;
        nc = (nc + size) % size;
      } else if (nr < 0 || nr >= size || nc < 0 || nc >= size) {
        var dead = { size: size, body: state.body.slice(), dir: dir, food: state.food, score: state.score, alive: false };
        return { state: dead, changed: true, gained: 0 };
      }

      var eats = state.food && state.food[0] === nr && state.food[1] === nc;
      // 不含尾巴：尾巴会移动（除非吃到食物）
      var bodyWithoutTail = eats ? state.body.slice() : state.body.slice(0, state.body.length - 1);
      var hitSelf = bodyWithoutTail.some(function (p) { return p[0] === nr && p[1] === nc; });
      var body = [[nr, nc]].concat(state.body.slice());
      if (!eats) body.pop();

      var next = {
        size: size,
        body: body,
        dir: dir,
        food: state.food,
        score: state.score + (eats ? 1 : 0),
        alive: !hitSelf,
      };
      if (eats) next.food = spawnFood(next, rng);
      return { state: next, changed: true, gained: eats ? 1 : 0 };
    }

    function status(state) { return state.alive ? 'playing' : 'lost'; }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['up', 'down', 'left', 'right']; },
    };
  }
  return { create: create };
});
