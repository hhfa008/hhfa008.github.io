/* AgentNet server-side game core and hash-chain helpers.
 *
 * UMD on purpose: the Worker bundle imports it for its side effect (it sets
 * globalThis.AgentNetCore) and Node tests `require()` the same file, so the
 * rules that the server enforces and the code under test are one artefact.
 *
 * The rule engines live in ./rules.js, a snapshot copy of
 * games/shared/rules.js. This file only adds the network-game view:
 *   - legal action ids            gomoku: "r,c"   connect4: "c"
 *   - immutable state transitions (server-authoritative, no client state)
 *   - canonical state serialisation and SHA-256 hash chaining
 *   - replay verification for /api/match/:id/log
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AgentNetCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var rules = root.GameRules;
  if (!rules && typeof module === 'object' && module.exports) rules = require('./rules.js');
  if (!rules) throw new Error('AgentNetCore: rules.js must be loaded first');

  var gomoku = rules.gomoku;
  var connect4 = rules.connect4;
  var N = gomoku.N;
  var NN = gomoku.NN;
  var COLS = connect4.COLS;
  var GAMES = ['gomoku', 'connect4'];
  var HASH_VERSION = 1;
  var encoder = new TextEncoder();

  function webcrypto() {
    if (typeof crypto !== 'undefined' && crypto && crypto.subtle) return crypto.subtle;
    throw new Error('WebCrypto (crypto.subtle) is unavailable');
  }

  async function sha256Hex(text) {
    var digest = await webcrypto().digest('SHA-256', encoder.encode(String(text)));
    var bytes = new Uint8Array(digest);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return out;
  }

  function isGame(game) {
    return GAMES.indexOf(game) !== -1;
  }

  function createGame(game) {
    if (!isGame(game)) throw new Error('unknown_game');
    var board = new Array(game === 'gomoku' ? NN : connect4.ROWS * COLS).fill(0);
    return {
      game: game,
      board: board,
      turn: 'p1',
      last: null,
      plies: 0,
      over: false,
      winner: null,
      draw: false,
    };
  }

  function otherSeat(seat) {
    return seat === 'p1' ? 'p2' : 'p1';
  }

  function markOf(seat) {
    return seat === 'p1' ? 1 : 2;
  }

  // Action ids double as coordinates: gomoku "r,c", connect4 "c". The server
  // never accepts coordinates outside this list, which is derived from state.
  function legalActions(state) {
    if (!state || state.over) return [];
    var out = [];
    var i;
    if (state.game === 'gomoku') {
      for (i = 0; i < NN; i++) {
        if (state.board[i] === 0) out.push(((i / N) | 0) + ',' + (i % N));
      }
      return out;
    }
    if (state.game === 'connect4') {
      for (i = 0; i < COLS; i++) {
        if (connect4.rowFor(state.board, i) >= 0) out.push(String(i));
      }
      return out;
    }
    return out;
  }

  function parseAction(state, id) {
    if (typeof id !== 'string' || id.length > 8) return null;
    var text = String(id);
    if (state.game === 'gomoku') {
      var m = /^([0-9]{1,2}),([0-9]{1,2})$/.exec(text);
      if (!m) return null;
      var r = +m[1];
      var c = +m[2];
      if (!gomoku.inBoard(r, c)) return null;
      var index = r * N + c;
      if (state.board[index] !== 0) return null;
      return { id: text, r: r, c: c, index: index };
    }
    if (state.game === 'connect4') {
      if (!/^[0-9]$/.test(text)) return null;
      var col = +text;
      if (col < 0 || col >= COLS) return null;
      var row = connect4.rowFor(state.board, col);
      if (row < 0) return null;
      return { id: text, c: col, r: row, index: row * COLS + col };
    }
    return null;
  }

  // Returns {ok:true, state, action} or {ok:false, code}. Never mutates input.
  function applyMove(state, id) {
    if (!state || !isGame(state.game)) return { ok: false, code: 'illegal_action' };
    if (state.over) return { ok: false, code: 'game_over' };
    var action = parseAction(state, id);
    if (!action) return { ok: false, code: 'illegal_action' };

    var seat = state.turn;
    var mark = markOf(seat);
    var board = Array.prototype.slice.call(state.board);
    var last;
    var over = false;
    var winner = null;
    var draw = false;

    if (state.game === 'gomoku') {
      last = action.index;
      board[last] = mark;
      if (gomoku.checkWinAt(board, action.r, action.c, mark)) {
        over = true;
        winner = seat;
      } else if (state.plies + 1 >= NN) {
        over = true;
        draw = true;
      }
    } else {
      var rr = connect4.rowFor(board, action.c);
      if (rr < 0) return { ok: false, code: 'illegal_action' };
      last = rr * COLS + action.c;
      board[last] = mark;
      var st = connect4.status({ b: board, turn: mark, last: last, plies: state.plies + 1 });
      over = !!st.over;
      if (st.winner) winner = st.winner === 1 ? 'p1' : 'p2';
      draw = !!st.draw;
    }

    return {
      ok: true,
      action: action,
      state: {
        game: state.game,
        board: board,
        turn: otherSeat(seat),
        last: last,
        plies: state.plies + 1,
        over: over,
        winner: winner,
        draw: draw,
      },
    };
  }

  // Canonical, fixed-key-order serialisation of the state after move n.
  // Only this string is hashed; replay reconstructs the same state from moves.
  function canonicalState(state, n) {
    return JSON.stringify({
      v: HASH_VERSION,
      n: n,
      game: state.game,
      board: state.board,
      turn: state.turn,
      last: state.last,
      plies: state.plies,
      over: state.over ? 1 : 0,
      winner: state.winner || null,
      draw: state.draw ? 1 : 0,
    });
  }

  function genesisHash(game, seed) {
    return sha256Hex(JSON.stringify({ v: HASH_VERSION, game: game, seed: String(seed) }));
  }

  function chainNext(prevHash, state, n) {
    return sha256Hex(String(prevHash) + canonicalState(state, n));
  }

  function logPayload(log) {
    var moves = Array.isArray(log.moves) ? log.moves : [];
    var result = log.result || null;
    return JSON.stringify({
      v: HASH_VERSION,
      game: log.game,
      seed: String(log.seed),
      matchId: log.matchId,
      moves: moves.map(function (m) { return [m.n, m.seat, m.id]; }),
      hashChain: Array.isArray(log.hashChain) ? log.hashChain : [],
      result: {
        winner: result ? (result.winner || null) : null,
        byTimeout: !!(result && result.byTimeout),
        draw: !!(result && result.draw),
      },
    });
  }

  function computeLogHash(log) {
    return sha256Hex(logPayload(log));
  }

  // Pure timeout decision: the player to move loses when the deadline passes.
  function timeoutResult(state, now, deadline) {
    if (!state || state.over || !deadline) return null;
    if (state.turn !== 'p1' && state.turn !== 'p2') return null;
    if (!(now >= deadline)) return null;
    return { winner: otherSeat(state.turn), loser: state.turn, byTimeout: true };
  }

  // Replays a log with the server rule copy and recomputes both hash chain and
  // log digest. Independent of any live room: this is what any third party can
  // run against GET /api/match/:id/log.
  async function verifyLog(log) {
    var errors = [];
    if (!log || !isGame(log.game)) {
      return { ok: false, errors: ['bad_game'], finalHash: null, logHash: null, finalState: null };
    }
    var state = createGame(log.game);
    var seedHash = await genesisHash(log.game, log.seed);
    var prev = seedHash;
    var hashes = [];
    var moves = Array.isArray(log.moves) ? log.moves : [];

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var n = i + 1;
      if (!m || m.n !== n) errors.push('move_' + n + '_bad_n');
      if (!m || (m.seat !== 'p1' && m.seat !== 'p2')) errors.push('move_' + n + '_bad_seat');
      else if (m.seat !== state.turn) errors.push('move_' + n + '_wrong_seat');
      var res = applyMove(state, m && m.id);
      if (!res.ok) {
        errors.push('move_' + n + '_' + res.code);
        break;
      }
      state = res.state;
      prev = await chainNext(prev, state, n);
      hashes.push(prev);
    }

    var chain = Array.isArray(log.hashChain) ? log.hashChain : [];
    if (chain.length !== hashes.length) errors.push('chain_length');
    var check = Math.min(chain.length, hashes.length);
    for (var j = 0; j < check; j++) {
      if (chain[j] !== hashes[j]) errors.push('chain_mismatch_' + (j + 1));
    }

    var finalHash = hashes.length ? hashes[hashes.length - 1] : seedHash;
    if (log.finalHash !== undefined && log.finalHash !== finalHash) errors.push('final_hash');

    var wantLogHash = await computeLogHash(log);
    if (log.logHash !== undefined && log.logHash !== null && log.logHash !== wantLogHash) {
      errors.push('log_hash');
    }

    if (log.result) {
      if (log.result.byTimeout) {
        if (state.over) errors.push('timeout_after_over');
        if ((log.result.winner || null) !== otherSeat(state.turn)) errors.push('result_winner');
        if (log.result.draw) errors.push('result_draw');
      } else {
        if (!state.over) errors.push('result_before_over');
        if ((log.result.winner || null) !== (state.winner || null)) errors.push('result_winner');
        if (!!log.result.draw !== !!state.draw) errors.push('result_draw');
      }
    } else if (state.over) {
      errors.push('missing_result');
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      finalHash: finalHash,
      genesisHash: seedHash,
      logHash: wantLogHash,
      finalState: state,
    };
  }

  return {
    GAMES: GAMES,
    HASH_VERSION: HASH_VERSION,
    gomoku: gomoku,
    connect4: connect4,
    isGame: isGame,
    createGame: createGame,
    legalActions: legalActions,
    applyMove: applyMove,
    canonicalState: canonicalState,
    genesisHash: genesisHash,
    chainNext: chainNext,
    logPayload: logPayload,
    computeLogHash: computeLogHash,
    timeoutResult: timeoutResult,
    verifyLog: verifyLog,
    sha256Hex: sha256Hex,
    otherSeat: otherSeat,
    markOf: markOf,
  };
});
