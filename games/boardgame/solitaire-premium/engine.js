/*
 * Solitaire (Klondike) premium — pure rules engine, UMD.
 *
 *   browser: globalThis.SolitaireEngine
 *   Node:    require('./engine.js')
 *
 * Rules implemented (standard Klondike):
 *   - one 52-card deck; 7 tableau columns of 1..7 cards, only the top is face up
 *   - remaining 24 cards form the stock; draw 1 or draw 3 to the waste
 *   - when the stock is empty the waste is recycled (unlimited passes)
 *   - tableau builds downward in alternating colours; only a face-up run may move
 *   - an empty tableau column accepts a King (a run led by a King)
 *   - foundations build upward in suit, A -> K
 *   - a newly exposed tableau card is flipped face up automatically
 *   - the game is won when all four foundations hold 13 cards
 *
 * Design contract:
 *   - createGame/applyMove never mutate their input; illegal moves throw Error.
 *   - deals reuse games/shared/shuffle.js seeded Fisher-Yates (no Math.random).
 *   - cards are plain objects and are conserved exactly once at every point.
 *   - scoring is the classic Windows-style tally documented in SCORE_RULES.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SolitaireEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffleDeck !== 'function') {
    throw new Error('SolitaireEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var SUITS = Object.freeze([
    Object.freeze({ key: 'spade', symbol: '♠', name: '黑桃', red: false }),
    Object.freeze({ key: 'heart', symbol: '♥', name: '红桃', red: true }),
    Object.freeze({ key: 'diamond', symbol: '♦', name: '方块', red: true }),
    Object.freeze({ key: 'club', symbol: '♣', name: '梅花', red: false })
  ]);
  var RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_VALUE = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
  var DRAW_MODES = Object.freeze([1, 3]);
  var HISTORY_LIMIT = 400;
  var SCORE_RULES = Object.freeze({
    wasteToTableau: 5,
    wasteToFoundation: 10,
    tableauToFoundation: 10,
    flip: 5,
    foundationToTableau: -15,
    recycleDraw1: 0,
    recycleDraw3: -20
  });

  function fail(message) { throw new Error(message); }
  function isObject(v) { return !!v && typeof v === 'object'; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function suitIndex(symbol) {
    for (var i = 0; i < SUITS.length; i += 1) if (SUITS[i].symbol === symbol) return i;
    return -1;
  }
  function normalizeDrawMode(value) {
    var n = Number(value);
    return DRAW_MODES.indexOf(n) === -1 ? 1 : n;
  }

  /* ------------------------------------------------------------------ *
   * Deck / deal                                                        *
   * ------------------------------------------------------------------ */

  function makeDeck(seed) {
    return ShuffleApi.shuffleDeck({ seed: seed }).map(function (card) {
      var value = RANK_VALUE[card.rank];
      if (!value) fail('unknown rank: ' + card.rank);
      if (suitIndex(card.suit) === -1) fail('unknown suit: ' + card.suit);
      return {
        id: card.id,
        rank: card.rank,
        value: value,
        suit: card.suit,
        suitIndex: suitIndex(card.suit),
        red: !!card.red,
        faceUp: false
      };
    });
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? undefined : opts.seed;
    var drawMode = normalizeDrawMode(opts.drawMode);
    var deck = makeDeck(seed);
    var tableau = [];
    var i;
    for (i = 0; i < 7; i += 1) tableau.push([]);
    // Classic row deal: round 0 puts one card in every column, round 1 in
    // columns 1..6, ... so column i ends up with i+1 cards.
    for (var round = 0; round < 7; round += 1) {
      for (var col = round; col < 7; col += 1) {
        var card = deck.pop();
        card.faceUp = false;
        tableau[col].push(card);
      }
    }
    tableau.forEach(function (pile) {
      if (pile.length) pile[pile.length - 1].faceUp = true;
    });
    var game = {
      version: VERSION,
      seed: seed == null ? null : seed,
      drawMode: drawMode,
      status: 'playing',
      stock: deck.map(function (c) { c.faceUp = false; return c; }),
      waste: [],
      foundations: [[], [], [], []],
      tableau: tableau,
      moves: 0,
      score: 0,
      recycles: 0,
      wonAt: null,
      history: []
    };
    return game;
  }

  function snapshot(state) {
    var copy = clone(state);
    delete copy.history;
    return copy;
  }

  function pushHistory(next, previous) {
    next.history = previous.history.slice();
    next.history.push(snapshot(previous));
    if (next.history.length > HISTORY_LIMIT) next.history.shift();
  }

  /* ------------------------------------------------------------------ *
   * Card helpers / invariants                                          *
   * ------------------------------------------------------------------ */

  function allCards(state) {
    var out = state.stock.concat(state.waste);
    state.foundations.forEach(function (pile) { out = out.concat(pile); });
    state.tableau.forEach(function (pile) { out = out.concat(pile); });
    return out;
  }

  function cardCount(state) { return allCards(state).length; }

  function top(pile) { return pile.length ? pile[pile.length - 1] : null; }

  function cardKey(card) { return card ? card.id : null; }

  function isValidRun(cards) {
    if (!Array.isArray(cards) || !cards.length) return false;
    for (var i = 0; i < cards.length; i += 1) {
      if (!cards[i].faceUp) return false;
      if (i > 0) {
        var prev = cards[i - 1];
        var cur = cards[i];
        if (prev.value !== cur.value + 1) return false;
        if (prev.red === cur.red) return false;
      }
    }
    return true;
  }

  function canPlaceOnTableau(pile, cards) {
    if (!Array.isArray(cards) || !cards.length) return false;
    if (!pile.length) return cards[0].value === 13;
    var target = top(pile);
    if (!target.faceUp) return false;
    return cards[0].value === target.value - 1 && cards[0].red !== target.red;
  }

  function canPlaceOnFoundation(foundation, card, foundationIndex) {
    if (!card) return false;
    if (card.suitIndex !== foundationIndex) return false;
    if (!foundation.length) return card.value === 1;
    return top(foundation).value + 1 === card.value;
  }

  /* ------------------------------------------------------------------ *
   * Move enumeration                                                   *
   * ------------------------------------------------------------------ */

  function makeMove(type, fromPile, fromIndex, cardIndex, toPile, toIndex) {
    return {
      type: type,
      from: fromPile == null ? null : { pile: fromPile, index: fromIndex },
      cardIndex: cardIndex == null ? 0 : cardIndex,
      to: toPile == null ? null : { pile: toPile, index: toIndex }
    };
  }

  function moveKey(move) {
    if (!move) return 'null';
    if (move.type === 'draw' || move.type === 'recycle') return move.type;
    return [move.type, move.from ? move.from.pile : '-', move.from ? move.from.index : '-',
      move.cardIndex, move.to ? move.to.pile : '-', move.to ? move.to.index : '-'].join(':');
  }

  function getLegalMoves(state) {
    if (!state || state.status !== 'playing') return [];
    var moves = [];

    if (state.stock.length || state.waste.length) {
      moves.push(makeMove(state.stock.length ? 'draw' : 'recycle'));
    }

    // Waste top -> foundations / tableau.
    var wasteTop = top(state.waste);
    if (wasteTop) {
      for (var f = 0; f < 4; f += 1) {
        if (canPlaceOnFoundation(state.foundations[f], wasteTop, f)) {
          moves.push(makeMove('move', 'waste', 0, 0, 'foundation', f));
        }
      }
      for (var t = 0; t < 7; t += 1) {
        if (canPlaceOnTableau(state.tableau[t], [wasteTop])) {
          moves.push(makeMove('move', 'waste', 0, 0, 'tableau', t));
        }
      }
    }

    // Tableau runs -> foundations / other tableau columns.
    for (var ti = 0; ti < 7; ti += 1) {
      var pile = state.tableau[ti];
      var firstFaceUp = -1;
      for (var ci = 0; ci < pile.length; ci += 1) {
        if (pile[ci].faceUp) { firstFaceUp = ci; break; }
      }
      if (firstFaceUp === -1) continue;
      for (var start = firstFaceUp; start < pile.length; start += 1) {
        var run = pile.slice(start);
        if (!isValidRun(run)) continue;
        // Foundation only takes the very top card, alone.
        if (start === pile.length - 1) {
          for (var ff = 0; ff < 4; ff += 1) {
            if (canPlaceOnFoundation(state.foundations[ff], run[0], ff)) {
              moves.push(makeMove('move', 'tableau', ti, start, 'foundation', ff));
            }
          }
        }
        for (var tt = 0; tt < 7; tt += 1) {
          if (tt === ti) continue;
          if (canPlaceOnTableau(state.tableau[tt], run)) {
            moves.push(makeMove('move', 'tableau', ti, start, 'tableau', tt));
          }
        }
      }
    }

    // Foundation top -> tableau (allowed, costs points).
    for (var fi = 0; fi < 4; fi += 1) {
      var fcard = top(state.foundations[fi]);
      if (!fcard) continue;
      for (var ft = 0; ft < 7; ft += 1) {
        if (canPlaceOnTableau(state.tableau[ft], [fcard])) {
          moves.push(makeMove('move', 'foundation', fi, 0, 'tableau', ft));
        }
      }
    }

    return moves;
  }

  function isWon(state) {
    if (!state) return false;
    for (var i = 0; i < 4; i += 1) if (state.foundations[i].length !== 13) return false;
    return true;
  }

  function checkWin(next) {
    if (isWon(next)) {
      next.status = 'won';
      next.wonAt = Date.now();
    }
    return next;
  }

  function applyMove(state, move) {
    if (!isObject(state)) fail('state required');
    if (!isObject(move)) fail('move required');
    if (state.status !== 'playing') fail('game is not playing');
    var next = clone(state);
    var points = 0;
    var flipped = false;

    if (move.type === 'draw') {
      if (!next.stock.length) fail('stock is empty; recycle instead');
      var take = Math.min(next.drawMode, next.stock.length);
      for (var d = 0; d < take; d += 1) {
        var card = next.stock.pop();
        card.faceUp = true;
        next.waste.push(card);
      }
      next.moves += 1;
      pushHistory(next, state);
      return next;
    }

    if (move.type === 'recycle') {
      if (next.stock.length) fail('stock still has cards');
      if (!next.waste.length) fail('waste is empty');
      next.stock = next.waste.slice().reverse();
      next.stock.forEach(function (c) { c.faceUp = false; });
      next.waste = [];
      next.recycles += 1;
      points = next.drawMode === 3 ? SCORE_RULES.recycleDraw3 : SCORE_RULES.recycleDraw1;
      next.score += points;
      next.moves += 1;
      pushHistory(next, state);
      return next;
    }

    if (move.type !== 'move') fail('unknown move type: ' + move.type);
    if (!move.from || !move.to) fail('move needs from/to');
    if (move.from.pile === move.to.pile && move.from.index === move.to.index) fail('source and target are the same pile');

    var cards = [];
    var fromPile;
    if (move.from.pile === 'waste') {
      if (!next.waste.length) fail('waste is empty');
      cards = [top(next.waste)];
      fromPile = next.waste;
      if (move.to.pile === 'tableau') points += SCORE_RULES.wasteToTableau;
      if (move.to.pile === 'foundation') points += SCORE_RULES.wasteToFoundation;
    } else if (move.from.pile === 'tableau') {
      var pile = next.tableau[move.from.index];
      if (!pile) fail('unknown tableau column');
      var start = move.cardIndex == null ? pile.length - 1 : move.cardIndex;
      if (start < 0 || start >= pile.length) fail('bad card index');
      cards = pile.slice(start);
      if (!isValidRun(cards)) fail('that run cannot move (must be descending alternating colours, face up)');
      fromPile = pile;
      if (move.to.pile === 'foundation') {
        if (cards.length !== 1) fail('foundation takes one card at a time');
        points += SCORE_RULES.tableauToFoundation;
      }
    } else if (move.from.pile === 'foundation') {
      var f = next.foundations[move.from.index];
      if (!f || !f.length) fail('foundation is empty');
      cards = [top(f)];
      fromPile = f;
      if (move.to.pile === 'tableau') points += SCORE_RULES.foundationToTableau;
      else fail('foundation can only move back to the tableau');
    } else {
      fail('unknown source pile');
    }
    if (!cards.length || !cards.every(function (c) { return c.faceUp; })) fail('only face-up cards can move');

    if (move.to.pile === 'tableau') {
      var target = next.tableau[move.to.index];
      if (!target) fail('unknown tableau column');
      if (!canPlaceOnTableau(target, cards)) fail('illegal tableau placement');
      fromPile.splice(fromPile.length - cards.length, cards.length);
      target.push.apply(target, cards);
    } else if (move.to.pile === 'foundation') {
      if (cards.length !== 1) fail('foundation takes one card at a time');
      var found = next.foundations[move.to.index];
      if (!found) fail('unknown foundation');
      if (!canPlaceOnFoundation(found, cards[0], move.to.index)) fail('illegal foundation placement');
      fromPile.splice(fromPile.length - 1, 1);
      found.push(cards[0]);
    } else {
      fail('unknown target pile');
    }

    if (move.from.pile === 'tableau') {
      var after = next.tableau[move.from.index];
      if (after.length && !top(after).faceUp) {
        top(after).faceUp = true;
        flipped = true;
        points += SCORE_RULES.flip;
      }
    }

    next.moves += 1;
    next.score += points;
    checkWin(next);
    pushHistory(next, state);
    return next;
  }

  function undo(state) {
    if (!state || !Array.isArray(state.history) || !state.history.length) fail('nothing to undo');
    var history = state.history.slice(0, -1);
    var prev = clone(state.history[state.history.length - 1]);
    prev.history = history;
    return prev;
  }

  /* ------------------------------------------------------------------ *
   * Hint / auto-send                                                   *
   * ------------------------------------------------------------------ */

  function topRunsFrom(state, pileIndex) {
    var pile = state.tableau[pileIndex];
    var out = [];
    for (var start = pile.length - 1; start >= 0; start -= 1) {
      if (!pile[start].faceUp) break;
      var run = pile.slice(start);
      if (!isValidRun(run)) break;
      out.push({ start: start, cards: run });
    }
    return out;
  }

  function hint(state) {
    if (!state || state.status !== 'playing') return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var scored = moves.map(function (move) {
      var score = 0;
      var reason = '';
      if (move.type === 'recycle') { score = 1; reason = '回收弃牌堆，重新发牌'; }
      else if (move.type === 'draw') { score = 2; reason = '从牌堆翻牌'; }
      else if (move.to.pile === 'foundation') {
        score = 100;
        reason = '把 ' + cardLabel(move.from.pile === 'waste' ? top(state.waste) : top(state.tableau[move.from.index])) + ' 送上基础堆';
      } else {
        var cards;
        if (move.from.pile === 'waste') cards = [top(state.waste)];
        else if (move.from.pile === 'tableau') cards = state.tableau[move.from.index].slice(move.cardIndex);
        else cards = [top(state.foundations[move.from.index])];
        score = 40;
        reason = '把 ' + cardLabel(cards[0]) + ' 移到牌列';
        if (move.from.pile === 'tableau') {
          var pile = state.tableau[move.from.index];
          if (move.cardIndex > 0 && !pile[move.cardIndex - 1].faceUp) { score = 80; reason = '移走后可以翻开隐藏牌'; }
          if (!state.tableau[move.to.index].length) { score = 70; reason = '用 K 打开一个空列'; }
        }
        if (move.from.pile === 'foundation') score = 5;
      }
      return { move: move, score: score, reason: reason };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0];
  }

  function autoSend(state) {
    if (!state || state.status !== 'playing') return { state: state, count: 0 };
    var next = state;
    var count = 0;
    var guard = 0;
    while (guard < 60) {
      guard += 1;
      var moves = getLegalMoves(next).filter(function (m) {
        return m.type === 'move' && m.to.pile === 'foundation';
      });
      if (!moves.length) break;
      next = applyMove(next, moves[0]);
      count += 1;
      if (next.status === 'won') break;
    }
    return { state: next, count: count };
  }

  function autoFinish(state) {
    var current = state;
    var guard = 0;
    var sent = 0;
    while (current && current.status === 'playing' && guard < 300) {
      guard += 1;
      var auto = autoSend(current);
      current = auto.state;
      sent += auto.count;
      if (current.status === 'won') break;
      var moves = getLegalMoves(current);
      if (!moves.length) break;
      // Prefer moves that reveal a hidden tableau card; then drawing; never
      // cannibalise a foundation in the auto-finish helper.
      var reveal = moves.filter(function (m) {
        return m.type === 'move' && m.from.pile === 'tableau' && m.to.pile === 'tableau' &&
          m.cardIndex > 0 && !current.tableau[m.from.index][m.cardIndex - 1].faceUp;
      })[0];
      var openColumn = moves.filter(function (m) {
        return m.type === 'move' && m.from.pile === 'tableau' && m.to.pile === 'tableau' &&
          !current.tableau[m.to.index].length;
      })[0];
      var draw = moves.filter(function (m) { return m.type === 'draw' || m.type === 'recycle'; })[0];
      var safeMove = moves.filter(function (m) { return m.type === 'move' && m.from.pile !== 'foundation'; })[0];
      var pick = reveal || openColumn || draw || safeMove || null;
      if (!pick) break;
      var before = JSON.stringify(snapshot(current));
      try { current = applyMove(current, pick); } catch (err) { break; }
      if (JSON.stringify(snapshot(current)) === before) break;
    }
    return { state: current, sent: sent };
  }

  /* ------------------------------------------------------------------ *
   * Labels / serialization                                             *
   * ------------------------------------------------------------------ */

  function cardLabel(card) {
    return card ? card.rank + card.suit : '-';
  }

  function serialize(state) {
    return JSON.stringify(snapshot(state));
  }

  function deserialize(text) {
    var raw;
    try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch (err) { fail('invalid saved game JSON'); }
    if (!isObject(raw)) fail('invalid saved game');
    if (raw.version !== VERSION) fail('unsupported saved game version');
    if (!Array.isArray(raw.tableau) || raw.tableau.length !== 7) fail('invalid tableau');
    if (!Array.isArray(raw.foundations) || raw.foundations.length !== 4) fail('invalid foundations');
    if (!Array.isArray(raw.stock) || !Array.isArray(raw.waste)) fail('invalid piles');
    var state = {
      version: VERSION,
      seed: raw.seed == null ? null : raw.seed,
      drawMode: normalizeDrawMode(raw.drawMode),
      status: raw.status === 'won' ? 'won' : 'playing',
      stock: raw.stock,
      waste: raw.waste,
      foundations: raw.foundations,
      tableau: raw.tableau,
      moves: Number(raw.moves) || 0,
      score: Number(raw.score) || 0,
      recycles: Number(raw.recycles) || 0,
      wonAt: raw.wonAt || null,
      history: []
    };
    if (cardCount(state) !== 52) fail('saved game does not contain 52 cards');
    var ids = {};
    allCards(state).forEach(function (c) {
      if (!c || !c.id || !c.suit || !c.rank) fail('invalid card');
      if (ids[c.id]) fail('duplicate card ' + c.id);
      ids[c.id] = true;
      if (typeof c.faceUp !== 'boolean') fail('card missing faceUp');
      if (typeof c.value !== 'number' || c.value < 1 || c.value > 13) fail('card missing value');
      if (typeof c.suitIndex !== 'number' || c.suitIndex < 0 || c.suitIndex > 3) fail('card missing suitIndex');
    });
    return state;
  }

  function scoreSummary(state) {
    return {
      score: state.score,
      moves: state.moves,
      recycles: state.recycles,
      foundations: state.foundations.map(function (p) { return p.length; }),
      tableauHidden: state.tableau.map(function (p) {
        return p.filter(function (c) { return !c.faceUp; }).length;
      }),
      won: state.status === 'won'
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    SUITS: SUITS,
    RANK_LABEL: RANK_LABEL,
    DRAW_MODES: DRAW_MODES,
    SCORE_RULES: SCORE_RULES,
    createGame: createGame,
    makeDeck: makeDeck,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    undo: undo,
    hint: hint,
    autoSend: autoSend,
    autoFinish: autoFinish,
    isWon: isWon,
    allCards: allCards,
    cardCount: cardCount,
    canPlaceOnTableau: canPlaceOnTableau,
    canPlaceOnFoundation: canPlaceOnFoundation,
    isValidRun: isValidRun,
    moveKey: moveKey,
    cardLabel: cardLabel,
    serialize: serialize,
    deserialize: deserialize,
    scoreSummary: scoreSummary,
    snapshot: snapshot
  });
});
