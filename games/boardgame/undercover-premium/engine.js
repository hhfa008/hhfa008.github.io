/*
 * Undercover（谁是卧底）premium rules engine — UMD.
 *
 * Browser: globalThis.UndercoverEngine
 * Node:    require('./engine.js')  -> requires ./data.js + ../../shared/shuffle.js
 *
 * The engine is pure: applyMove never mutates its input and returns a fresh
 * state. All randomness is seeded, so the same seed reproduces the deal, the
 * speaking/vote order, and the AI choices.
 *
 * Roles
 *   c  civilian   gets the civilian word
 *   u  undercover gets the undercover word
 *   b  blank      gets no word (may lie freely)
 *
 * Phases
 *   reveal  seat order: each player acknowledges their private card
 *   speak   discussion; the first alive player starts the vote
 *   vote    alive players vote clockwise (the engine's seeded order)
 *   over    a side has won; all roles/words are public
 *
 * Win rule
 *   undercover + blank alive === 0           -> civilians win
 *   undercover + blank alive >= civilians    -> undercover side wins
 *   otherwise the game continues. A tie vote eliminates nobody.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('../../shared/shuffle.js'));
  } else {
    root.UndercoverEngine = factory(root.UndercoverData, root.Shuffle);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA, ShuffleApi) {
  'use strict';

  if (!DATA || !Array.isArray(DATA.WORDS)) throw new Error('UndercoverEngine requires data.js');
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('UndercoverEngine requires games/shared/shuffle.js');
  }

  var VERSION = '2.0.0';
  var MIN_PLAYERS = 4;
  var MAX_PLAYERS = 12;
  var MAX_UNDERCOVER = 3;
  var PHASES = ['reveal', 'speak', 'vote', 'over'];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function asInt(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  }

  function maxUndercover(n) {
    return Math.min(MAX_UNDERCOVER, Math.ceil(n / 2) - 1);
  }

  function recommendedUndercover(n) {
    if (n <= 6) return 1;
    if (n <= 9) return 2;
    return 3;
  }

  function isValidConfig(n, uc, blank) {
    n = asInt(n, 0);
    uc = asInt(uc, 0);
    blank = blank == null ? 0 : asInt(blank, 0);
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) return false;
    if (uc < 1 || uc > maxUndercover(n)) return false;
    if (blank < 0 || blank > 1) return false;
    var civilians = n - uc - blank;
    if (civilians < 2) return false;
    return uc + blank < civilians;
  }

  function judgeWin(undercoverSideAlive, civiliansAlive) {
    if (undercoverSideAlive <= 0) return 'civ';
    if (undercoverSideAlive >= civiliansAlive) return 'uc';
    return null;
  }

  function dealRoles(n, uc, blank, rng) {
    var arr = [];
    var i;
    for (i = 0; i < uc; i += 1) arr.push('u');
    for (i = 0; i < (blank || 0); i += 1) arr.push('b');
    while (arr.length < n) arr.push('c');
    if (typeof rng === 'function') {
      for (i = n - 1; i > 0; i -= 1) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    }
    return ShuffleApi.shuffle(arr, { seed: String(rng == null ? 'roles' : rng) });
  }

  // Existing simple-version semantics: undercover gets pair.a, civilians pair.b;
  // swap flips the two. The pair labels are arbitrary, the swap keeps it fair.
  function assignWords(roles, pair, swap) {
    var undercoverWord = swap ? pair.b : pair.a;
    var civilianWord = swap ? pair.a : pair.b;
    return roles.map(function (role) {
      if (role === 'u') return undercoverWord;
      if (role === 'b') return '';
      return civilianWord;
    });
  }

  function wordPairAt(index) {
    var list = DATA.WORDS;
    var n = ((index % list.length) + list.length) % list.length;
    return list[n];
  }

  function roleLabel(role) {
    return DATA.ROLE_LABELS[role] || role;
  }

  function aliveIndices(state) {
    var out = [];
    state.players.forEach(function (p) { if (p.alive) out.push(p.index); });
    return out;
  }

  function countAlive(state, role) {
    var n = 0;
    state.players.forEach(function (p) {
      if (!p.alive) return;
      if (role === 'u' || role === 'b') {
        if (p.role === 'u' || p.role === 'b') {
          if (role === 'u' && p.role !== 'u') return;
          if (role === 'b' && p.role !== 'b') return;
          n += 1;
        }
      } else if (p.role === role) n += 1;
    });
    return n;
  }

  function undercoverSideAlive(state) {
    return state.players.filter(function (p) {
      return p.alive && (p.role === 'u' || p.role === 'b');
    }).length;
  }

  function civilianAlive(state) {
    return state.players.filter(function (p) { return p.alive && p.role === 'c'; }).length;
  }

  function currentPlayer(state) {
    return state.current == null ? null : state.players[state.current] || null;
  }

  function pushHistory(state, event) {
    state.history.push(event);
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
  }

  function resetVotes(state) {
    state.players.forEach(function (p) { p.votes = 0; });
    state.votes = [];
    state.votedCount = 0;
  }

  function beginVote(state) {
    resetVotes(state);
    state.phase = 'vote';
    state.voteOrder = ShuffleApi.shuffle(aliveIndices(state), {
      seed: state.seed + ':vote:' + state.round
    });
    state.current = state.voteOrder.length ? state.voteOrder[0] : null;
    pushHistory(state, { type: 'beginVote', round: state.round, order: state.voteOrder.slice() });
  }

  function resolveVote(state) {
    var alive = aliveIndices(state);
    var tally = alive.map(function (index) {
      return { index: index, votes: state.players[index].votes };
    }).sort(function (a, b) { return b.votes - a.votes || a.index - b.index; });
    var max = tally.length ? tally[0].votes : 0;
    var top = tally.filter(function (row) { return row.votes === max && max > 0; });

    if (top.length === 1) {
      var pid = top[0].index;
      var player = state.players[pid];
      player.alive = false;
      state.votes.forEach(function (v) { if (v.to === pid) v.hit = true; });
      state.lastElim = {
        pid: pid,
        tie: false,
        round: state.round,
        role: player.role,
        word: player.word,
        tally: tally
      };
      state.eliminated.push(pid);
      pushHistory(state, { type: 'eliminate', round: state.round, pid: pid, role: player.role, tally: tally });
    } else {
      state.lastElim = {
        pid: null,
        tie: true,
        round: state.round,
        role: null,
        word: '',
        tally: tally
      };
      pushHistory(state, { type: 'tie', round: state.round, tally: tally });
    }

    var ucAlive = undercoverSideAlive(state);
    var civAlive = civilianAlive(state);
    var win = judgeWin(ucAlive, civAlive);
    if (win) {
      finish(state, win);
      return;
    }

    state.round += 1;
    state.phase = 'speak';
    state.current = aliveIndices(state)[0];
    resetVotes(state);
    pushHistory(state, { type: 'nextRound', round: state.round });
  }

  function finish(state, winnerSide) {
    state.over = true;
    state.phase = 'over';
    state.current = null;
    state.winnerSide = winnerSide;
    state.result = {
      winnerSide: winnerSide,
      rounds: state.round,
      undercoverSideAlive: undercoverSideAlive(state),
      civiliansAlive: civilianAlive(state),
      eliminated: state.eliminated.slice(),
      votes: state.votes.length,
      players: state.players.map(function (p) {
        return { index: p.index, name: p.name, role: p.role, word: p.word, alive: p.alive };
      })
    };
    pushHistory(state, { type: 'gameOver', winnerSide: winnerSide, round: state.round });
  }

  function createGame(options) {
    var opts = options || {};
    var playerCount = asInt(opts.playerCount, 6);
    var undercoverCount = asInt(opts.undercoverCount, recommendedUndercover(playerCount));
    var blankCount = opts.blankCount == null ? 0 : asInt(opts.blankCount, 0);
    if (!isValidConfig(playerCount, undercoverCount, blankCount)) {
      throw new Error('invalid config: players 4-12, undercover 1-3, blank 0-1, at least 2 civilians');
    }
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var names = Array.isArray(opts.names) && opts.names.length === playerCount
      ? opts.names.slice()
      : null;

    var pairOrder = ShuffleApi.shuffle(DATA.WORDS.map(function (_, i) { return i; }), {
      seed: seed + ':pair'
    });
    var pair = wordPairAt(pairOrder[0]);
    var swapRng = ShuffleApi.createRng(seed + ':swap');
    var swap = swapRng() < 0.5;
    var roles = dealRoles(playerCount, undercoverCount, blankCount, seed + ':roles');
    var words = assignWords(roles, pair, swap);

    var players = [];
    for (var i = 0; i < playerCount; i += 1) {
      players.push({
        index: i,
        name: names ? (String(names[i] || '').trim() || ('玩家 ' + (i + 1))) : ('玩家 ' + (i + 1)),
        role: roles[i],
        word: words[i],
        alive: true,
        revealed: false,
        votes: 0,
        isAI: !!(opts.isAI && opts.isAI[i])
      });
    }

    var state = {
      version: VERSION,
      seed: seed,
      hint: !!opts.hint,
      playerCount: playerCount,
      undercoverCount: undercoverCount,
      blankCount: blankCount,
      pair: { a: pair.a, b: pair.b, cat: pair.cat, difficulty: pair.difficulty },
      swap: swap,
      phase: 'reveal',
      round: 1,
      current: 0,
      revealOrder: players.map(function (p) { return p.index; }),
      revealIndex: 0,
      voteOrder: [],
      votedCount: 0,
      votes: [],
      players: players,
      eliminated: [],
      lastElim: null,
      winnerSide: null,
      over: false,
      result: null,
      history: []
    };
    pushHistory(state, {
      type: 'deal',
      round: 1,
      players: playerCount,
      undercover: undercoverCount,
      blank: blankCount,
      category: pair.cat
    });
    return state;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    if (state.phase === 'reveal') {
      return currentPlayer(state) && currentPlayer(state).alive ? [{ type: 'reveal' }] : [];
    }
    if (state.phase === 'speak') {
      return [{ type: 'beginVote' }];
    }
    if (state.phase === 'vote') {
      var me = state.current;
      return aliveIndices(state)
        .filter(function (i) { return i !== me; })
        .map(function (i) { return { type: 'vote', target: i }; });
    }
    return [];
  }

  function applyMove(state, move) {
    if (!state) throw new Error('state is required');
    if (!move || typeof move !== 'object') throw new Error('move is required');
    if (state.over) throw new Error('game is over');
    var next = clone(state);

    if (next.phase === 'reveal') {
      if (move.type !== 'reveal') throw new Error('expected reveal');
      var p = currentPlayer(next);
      if (!p || !p.alive) throw new Error('no player to reveal');
      p.revealed = true;
      next.revealIndex += 1;
      pushHistory(next, { type: 'reveal', round: next.round, pid: p.index });
      if (next.revealIndex >= next.revealOrder.length) {
        next.phase = 'speak';
        next.current = aliveIndices(next)[0];
      } else {
        next.current = next.revealOrder[next.revealIndex];
      }
      return next;
    }

    if (next.phase === 'speak') {
      if (move.type !== 'beginVote') throw new Error('expected beginVote');
      beginVote(next);
      return next;
    }

    if (next.phase === 'vote') {
      if (move.type !== 'vote') throw new Error('expected vote');
      var from = next.current;
      var target = asInt(move.target, -1);
      if (from == null || !next.players[from] || !next.players[from].alive) {
        throw new Error('current voter is not alive');
      }
      if (target < 0 || target >= next.playerCount) throw new Error('target out of range');
      if (target === from) throw new Error('cannot vote for yourself');
      if (!next.players[target].alive) throw new Error('target is not alive');
      next.players[target].votes += 1;
      next.votes.push({ from: from, to: target, round: next.round });
      next.votedCount += 1;
      pushHistory(next, { type: 'vote', round: next.round, from: from, to: target });

      var order = next.voteOrder.filter(function (i) { return next.players[i].alive; });
      var pos = order.indexOf(from);
      if (pos === -1) throw new Error('voter not in vote order');
      if (pos + 1 < order.length) {
        next.current = order[pos + 1];
        return next;
      }
      resolveVote(next);
      return next;
    }

    throw new Error('unknown phase: ' + next.phase);
  }

  function chooseAIMove(state, level) {
    if (!state || state.over) return null;
    if (state.phase === 'reveal') return { type: 'reveal' };
    if (state.phase === 'speak') return { type: 'beginVote' };
    if (state.phase !== 'vote') return null;
    var me = currentPlayer(state);
    if (!me || !me.alive) return null;
    var targets = aliveIndices(state).filter(function (i) { return i !== me.index; });
    if (!targets.length) return null;

    var rng = ShuffleApi.createRng(
      String(state.seed) + ':ai:' + state.round + ':' + me.index + ':' + state.votedCount
    );
    if (me.role === 'u' || me.role === 'b') {
      var civilians = targets.filter(function (i) { return state.players[i].role === 'c'; });
      if (civilians.length) return { type: 'vote', target: civilians[Math.floor(rng() * civilians.length)] };
    }
    return { type: 'vote', target: targets[Math.floor(rng() * targets.length)] };
  }

  function viewFor(state, viewerIndex) {
    var viewer = viewerIndex == null ? null : state.players[viewerIndex] || null;
    return {
      phase: state.phase,
      round: state.round,
      current: state.current,
      over: state.over,
      winnerSide: state.winnerSide,
      result: state.result,
      players: state.players.map(function (p) {
        return {
          index: p.index,
          name: p.name,
          alive: p.alive,
          revealed: p.revealed,
          votes: p.votes
        };
      }),
      lastElim: state.lastElim,
      me: viewer ? { index: viewer.index, name: viewer.name, role: viewer.role, word: viewer.word, alive: viewer.alive } : null,
      hint: state.hint ? state.pair.cat : null
    };
  }

  return {
    VERSION: VERSION,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    MAX_UNDERCOVER: MAX_UNDERCOVER,
    PHASES: PHASES,
    WORDS: DATA.WORDS,
    CATEGORIES: DATA.CATEGORIES,
    maxUndercover: maxUndercover,
    recommendedUndercover: recommendedUndercover,
    isValidConfig: isValidConfig,
    judgeWin: judgeWin,
    dealRoles: dealRoles,
    assignWords: assignWords,
    wordPairAt: wordPairAt,
    roleLabel: roleLabel,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    viewFor: viewFor,
    aliveIndices: aliveIndices,
    countAlive: countAlive,
    undercoverSideAlive: undercoverSideAlive,
    civilianAlive: civilianAlive,
    currentPlayer: currentPlayer
  };
});
