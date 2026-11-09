/* Connect Four adapter — reuses games/shared/rules.js (GameRules.connect4).
 *
 * The engine works on a flat Int8Array; each session keeps the same layout in
 * a plain Array. Move application and win/draw detection are delegated to the
 * engine's applyMove + status, so the adapter adds ids and JSON snapshots only.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../shared/agent-api.js'), require('../../shared/rules.js'));
  } else {
    factory(root.GameAgent, root.GameRules);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GA, Rules) {
  'use strict';

  var E = Rules && Rules.connect4;
  var COLS = E ? E.COLS : 7;

  function toPlain(int8) {
    var out = [];
    for (var i = 0; i < int8.length; i++) out.push(int8[i]);
    return out;
  }

  function engineState(st) {
    var b = new Int8Array(st.board.length);
    for (var i = 0; i < st.board.length; i++) b[i] = st.board[i];
    return { b: b, turn: st.turn, last: st.last, plies: st.plies };
  }

  function initialState() {
    var s = E.setup();
    return {
      board: toPlain(s.b),
      turn: s.turn,
      last: s.last,
      plies: s.plies,
      winner: null,
      line: null
    };
  }

  function parseColumn(id) {
    if (typeof id !== 'string' || id.indexOf('drop:') !== 0) return -1;
    var raw = id.slice(5);
    if (!/^\d+$/.test(raw)) return -1;
    var col = Number(raw);
    return col >= 0 && col < COLS ? col : -1;
  }

  function makeSession(seed) {
    var st = initialState();
    st.seed = seed === undefined ? 1 : seed;

    return {
      slug: 'connect4',
      version: '1.0.0',
      seats: ['p1', 'p2'],

      state: function () { return GA.cloneJSON(st); },

      legalActions: function () {
        if (st.winner) return [];
        var out = [];
        for (var c = 0; c < COLS; c++) {
          if (st.board[c] !== 0) continue;
          out.push({
            id: 'drop:' + c,
            type: 'drop',
            payload: { column: c },
            desc: 'drop a disc into column ' + c
          });
        }
        return out;
      },

      apply: function (id) {
        if (st.winner) return { ok: false, error: 'game_over' };
        var col = parseColumn(id);
        if (col < 0 || st.board[col] !== 0) return { ok: false, error: 'illegal_action' };

        var next = E.applyMove(engineState(st), col);
        if (!next) return { ok: false, error: 'illegal_action' };

        st.board = toPlain(next.b);
        st.turn = next.turn;
        st.last = next.last;
        st.plies = next.plies;

        var res = E.status(next);
        if (res.over) {
          st.winner = res.draw ? 'draw' : (res.winner === E.P1 ? 'p1' : 'p2');
          st.line = res.line;
        }
        return { ok: true, state: GA.cloneJSON(st) };
      },

      status: function () {
        return { phase: st.winner ? 'over' : 'playing', winner: st.winner };
      },

      player: function () { return st.turn === E.P1 ? 'p1' : 'p2'; },

      hash: function () { return GA.hashState(st); }
    };
  }

  function create(opts) {
    opts = opts || {};
    return makeSession(opts.seed);
  }

  create.players = 2;
  create.moves = 'drop';
  create.source = 'games/shared/rules.js (GameRules.connect4)';
  if (GA) GA.register('connect4', create);

  return { create: create };
});
