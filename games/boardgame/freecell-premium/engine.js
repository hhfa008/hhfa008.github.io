/*
 * FreeCell（空当接龙）精品版纯规则引擎 — UMD
 *
 * 浏览器：globalThis.FreeCellEngine；Node：require('./engine.js')
 *
 * 规则口径（微软 FreeCell / Microsoft FreeCell）：
 *   - 一副 52 张扑克，全部明牌。
 *   - 8 列牌桌：第 1–4 列 7 张，第 5–8 列 6 张（按行发牌）。
 *   - 4 个自由空位（free cell），每格最多一张牌。
 *   - 4 个基础堆（foundation），按花色从 A 到 K 升序收牌。
 *   - 牌桌按点数降序、红黑交替叠放；空列可放任意牌。
 *   - 超级搬运：一次可搬 (空位+1) × 2^(空列数) 张。
 *     搬到空列时，目标空列不计入空列数；整列搬运总是合法。
 *   - 基础堆的牌可以移回牌桌或空位（微软版规则）。
 *   - 四堆基础堆都到 K 时胜利。
 *   - 计分同时记录步数与用时。
 *
 * 局号算法（微软 deal number，1–1000000）：
 *   state = n
 *   state = (state * 214013 + 2531011) % 2147483648
 *   rand  = floor(state / 65536) % 32768
 *   deck  = 0..51（rank = card % 13 → A..K，suit = floor(card / 13) → ♣♦♥♠）
 *   for i = 0..51:
 *     j = rand() % (52 - i)
 *     out.push(deck[j]); deck[j] = deck[51 - i]
 *   按行发到 8 列（out[0..7] 是第一轮）。
 *   同局号在任何设备上给出完全相同的牌局。
 *
 * 设计约束：
 *   - 纯函数、无 DOM；applyMove / autoSafeSend 不修改入参，返回全新 state。
 *   - 非法动作抛 Error。
 *   - 发牌只在 Node/浏览器都使用游戏共享的 seeded shuffle（自由种子模式）
 *     或上述微软算法（局号模式），绝不使用 Math.random。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.FreeCellEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffleDeck !== 'function' || typeof ShuffleApi.createRng !== 'function') {
    throw new Error('FreeCellEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var COLUMN_COUNT = 8;
  var FREE_CELL_COUNT = 4;
  var FOUNDATION_COUNT = 4;
  var DECK_SIZE = 52;
  var MAX_DEAL_NUMBER = 1000000;
  var CARD_RATIO = 63 / 88; // 真实扑克 63 × 88 mm
  var RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

  var SUITS = Object.freeze([
    Object.freeze({ index: 0, key: 'clubs', symbol: '♣', color: 'black', red: false, zh: '梅花', label: '梅花' }),
    Object.freeze({ index: 1, key: 'diamonds', symbol: '♦', color: 'red', red: true, zh: '方块', label: '方块' }),
    Object.freeze({ index: 2, key: 'hearts', symbol: '♥', color: 'red', red: true, zh: '红桃', label: '红桃' }),
    Object.freeze({ index: 3, key: 'spades', symbol: '♠', color: 'black', red: false, zh: '黑桃', label: '黑桃' })
  ]);
  var SUIT_BY_INDEX = SUITS;
  var SUIT_BY_KEY = {};
  SUITS.forEach(function (s) { SUIT_BY_KEY[s.key] = s; });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function rankLabel(rank) {
    var n = Number(rank);
    if (!isFinite(n) || n % 1 !== 0 || n < 1 || n > 13) throw new Error('非法点数: ' + rank);
    return RANKS[n - 1];
  }

  /* ---------------------------------------------------------------- cards */

  // Microsoft card order: rank = index % 13 (A..K), suit = floor(index / 13)
  // with suits ordered ♣ ♦ ♥ ♠.
  function cardFromIndex(index) {
    if (!isFinite(index) || index % 1 !== 0 || index < 0 || index > 51) {
      throw new Error('非法牌序号: ' + index);
    }
    var suit = Math.floor(index / 13);
    var rank = (index % 13) + 1;
    return makeCard(suit, rank);
  }

  function makeCard(suit, rank) {
    var s = typeof suit === 'number' ? SUIT_BY_INDEX[suit] : SUIT_BY_KEY[String(suit)];
    if (!s) throw new Error('非法花色: ' + suit);
    var r = Number(rank);
    if (!isFinite(r) || r % 1 !== 0 || r < 1 || r > 13) throw new Error('非法点数: ' + rank);
    return {
      id: s.key + '-' + r,
      rank: r,
      suit: s.index,
      suitKey: s.key,
      color: s.color,
      label: s.label + rankLabel(r),
      symbol: s.symbol
    };
  }

  // Normalise a card produced by games/shared/shuffle.js (rank 'A'..'K',
  // suit '♠♥♦♣') into the engine card model.
  var SHARE_SUIT_INDEX = { '♣': 0, '♦': 1, '♥': 2, '♠': 3 };
  var SHARE_RANK = {};
  RANKS.forEach(function (label, i) { SHARE_RANK[label] = i + 1; });

  function normalizeSharedCard(card) {
    if (!card || card.joker) throw new Error('FreeCell 不接受 Joker');
    var suitIndex = SHARE_SUIT_INDEX[card.suit];
    var rank = SHARE_RANK[String(card.rank)];
    if (suitIndex === undefined || rank === undefined) {
      throw new Error('无法识别的共享牌: ' + JSON.stringify(card));
    }
    return makeCard(suitIndex, rank);
  }

  function suitOf(card) {
    if (!card) throw new Error('缺少牌');
    return SUIT_BY_INDEX[card.suit];
  }

  function isRed(card) { return suitOf(card).red; }

  function canStack(card, onto) {
    if (!card) throw new Error('缺少待叠放的牌');
    if (!onto) return true; // 空列
    if (!card || !onto) return false;
    return card.rank + 1 === onto.rank && card.color !== onto.color;
  }

  function canFoundation(card, pile) {
    if (!card || !Array.isArray(pile)) return false;
    return pile.length < 13 && card.rank === pile.length + 1;
  }

  // Every card in a column from `index` to the top must be a legal run:
  // descending by one, alternating red/black.
  function isValidRun(column, index) {
    if (!Array.isArray(column)) return false;
    if (!isFinite(index) || index % 1 !== 0 || index < 0 || index >= column.length) return false;
    for (var i = index; i < column.length - 1; i++) {
      if (!canStack(column[i + 1], column[i])) return false;
    }
    return true;
  }

  /* --------------------------------------------------- Microsoft deal math */

  function normalizeDealNumber(value) {
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!isFinite(n) || n % 1 !== 0 || n < 1 || n > MAX_DEAL_NUMBER) {
      throw new Error('局号必须是 1–' + MAX_DEAL_NUMBER + ' 的整数');
    }
    return n;
  }

  // Exposed for tests: the raw Microsoft RNG sequence for a deal number.
  function msRandomSequence(dealNumber, count) {
    var state = normalizeDealNumber(dealNumber);
    var out = [];
    var n = count == null ? 8 : count;
    for (var i = 0; i < n; i++) {
      state = (state * 214013 + 2531011) % 2147483648;
      out.push(Math.floor(state / 65536) % 32768);
    }
    return out;
  }

  // Returns the 52 cards in Microsoft deal order (row-major: out[0..7] is the
  // first card of each of the 8 columns).
  function dealOrder(dealNumber) {
    var state = normalizeDealNumber(dealNumber);
    function rand() {
      state = (state * 214013 + 2531011) % 2147483648;
      return Math.floor(state / 65536) % 32768;
    }
    var deck = [];
    for (var i = 0; i < DECK_SIZE; i++) deck.push(i);
    var out = [];
    for (var k = 0; k < DECK_SIZE; k++) {
      var j = rand() % (DECK_SIZE - k);
      out.push(deck[j]);
      deck[j] = deck[DECK_SIZE - 1 - k];
    }
    return out.map(cardFromIndex);
  }

  // Alias used by the page and tests.
  function dealDeck(dealNumber) { return dealOrder(dealNumber); }

  function dealTableau(deck) {
    var cols = [];
    for (var c = 0; c < COLUMN_COUNT; c++) cols.push([]);
    for (var i = 0; i < deck.length; i++) cols[i % COLUMN_COUNT].push(deck[i]);
    return cols;
  }

  /* ------------------------------------------------------------- game state */

  function createGame(opts) {
    opts = opts || {};
    var dealNumber = null;
    var seed = null;
    var deck;
    if (opts.dealNumber != null) {
      dealNumber = normalizeDealNumber(opts.dealNumber);
      deck = dealOrder(dealNumber);
    } else if (opts.seed != null) {
      seed = String(opts.seed);
      deck = ShuffleApi.shuffleDeck({ seed: seed }).map(normalizeSharedCard);
    } else {
      // A random Microsoft deal number, drawn from the shared CSPRNG.
      var rng = ShuffleApi.createRng();
      dealNumber = 1 + Math.floor(rng() * MAX_DEAL_NUMBER);
      deck = dealOrder(dealNumber);
    }
    if (deck.length !== DECK_SIZE) throw new Error('发牌数量错误');
    var state = {
      version: VERSION,
      dealNumber: dealNumber,
      seed: seed,
      tableau: dealTableau(deck),
      freeCells: [null, null, null, null],
      foundations: [[], [], [], []],
      moves: 0,
      autoMoves: 0,
      status: 'playing',
      startedAt: opts.now != null ? Number(opts.now) : 0,
      finishedAt: null,
      lastMove: null
    };
    if (countAllCards(state) !== DECK_SIZE) throw new Error('发牌后牌张不守恒');
    return state;
  }

  function countAllCards(state) { return allCards(state).length; }

  function allCards(state) {
    if (!state) throw new Error('缺少 state');
    var out = [];
    state.tableau.forEach(function (col) { col.forEach(function (card) { out.push(card); }); });
    state.freeCells.forEach(function (card) { if (card) out.push(card); });
    state.foundations.forEach(function (pile) { pile.forEach(function (card) { out.push(card); }); });
    return out;
  }

  function emptyColumnCount(state) {
    var n = 0;
    state.tableau.forEach(function (col) { if (col.length === 0) n++; });
    return n;
  }

  function emptyFreeCellCount(state) {
    var n = 0;
    state.freeCells.forEach(function (card) { if (!card) n++; });
    return n;
  }

  // Standard supermove limit. When the destination is empty, that column is
  // not available as a temporary holding area, so it is excluded.
  function maxMove(state, toEmpty) {
    var free = emptyFreeCellCount(state);
    var empty = emptyColumnCount(state);
    var usable = toEmpty ? Math.max(0, empty - 1) : empty;
    return (free + 1) * Math.pow(2, usable);
  }

  function topOf(column) { return column.length ? column[column.length - 1] : null; }

  function cardAt(state, zone) {
    if (!zone) return null;
    if (zone.zone === 'tableau') {
      var col = state.tableau[zone.col];
      return col && zone.index != null ? col[zone.index] : topOf(col || []);
    }
    if (zone.zone === 'free') return state.freeCells[zone.cell] || null;
    if (zone.zone === 'foundation') {
      var pile = state.foundations[zone.suit];
      return pile && pile.length ? pile[pile.length - 1] : null;
    }
    return null;
  }

  function moveKeyFor(from, to) {
    var f;
    if (from.zone === 'tableau') f = 'T' + from.col + (from.index != null ? ':' + from.index : '');
    else if (from.zone === 'free') f = 'C' + from.cell;
    else f = 'F' + from.suit;
    var t;
    if (to.zone === 'tableau') t = 'T' + to.col;
    else if (to.zone === 'free') t = 'C' + to.cell;
    else t = 'F' + to.suit;
    return f + '>' + t;
  }

  function pushMove(out, state, from, to, count) {
    var card = cardAt(state, from);
    if (!card) return;
    var move = {
      key: moveKeyFor(from, to),
      from: from,
      to: to,
      count: count == null ? 1 : count,
      cardId: card.id,
      cardLabel: card.label,
      toEmpty: to.zone === 'tableau' && state.tableau[to.col].length === 0
    };
    out.push(move);
  }

  function getLegalMoves(state) {
    if (!state || !Array.isArray(state.tableau)) throw new Error('缺少 state');
    var out = [];
    var c;
    var to;

    for (var colIndex = 0; colIndex < COLUMN_COUNT; colIndex++) {
      var column = state.tableau[colIndex];
      for (var idx = 0; idx < column.length; idx++) {
        if (!isValidRun(column, idx)) continue;
        var seqLen = column.length - idx;
        var first = column[idx];
        var wholeColumn = idx === 0;

        for (var destIndex = 0; destIndex < COLUMN_COUNT; destIndex++) {
          if (destIndex === colIndex) continue;
          var dest = state.tableau[destIndex];
          var limit = maxMove(state, dest.length === 0);
          if (dest.length === 0) {
            if (wholeColumn || seqLen <= limit) {
              pushMove(out, state, { zone: 'tableau', col: colIndex, index: idx }, { zone: 'tableau', col: destIndex }, seqLen);
            }
          } else if (canStack(first, topOf(dest)) && seqLen <= limit) {
            pushMove(out, state, { zone: 'tableau', col: colIndex, index: idx }, { zone: 'tableau', col: destIndex }, seqLen);
          }
        }

        // Only the top card may leave the column for a free cell or foundation.
        if (idx === column.length - 1) {
          for (c = 0; c < FREE_CELL_COUNT; c++) {
            if (!state.freeCells[c]) {
              pushMove(out, state, { zone: 'tableau', col: colIndex, index: idx }, { zone: 'free', cell: c }, 1);
            }
          }
          var foundation = state.foundations[first.suit];
          if (canFoundation(first, foundation)) {
            pushMove(out, state, { zone: 'tableau', col: colIndex, index: idx }, { zone: 'foundation', suit: first.suit }, 1);
          }
        }
      }
    }

    // Free cells → tableau / foundation.
    for (c = 0; c < FREE_CELL_COUNT; c++) {
      var freeCard = state.freeCells[c];
      if (!freeCard) continue;
      for (to = 0; to < COLUMN_COUNT; to++) {
        if (canStack(freeCard, topOf(state.tableau[to]))) {
          pushMove(out, state, { zone: 'free', cell: c }, { zone: 'tableau', col: to }, 1);
        }
      }
      if (canFoundation(freeCard, state.foundations[freeCard.suit])) {
        pushMove(out, state, { zone: 'free', cell: c }, { zone: 'foundation', suit: freeCard.suit }, 1);
      }
    }

    // Foundations → tableau / free cell (Microsoft FreeCell allows this).
    for (var s = 0; s < FOUNDATION_COUNT; s++) {
      var pile = state.foundations[s];
      if (!pile.length) continue;
      var top = pile[pile.length - 1];
      for (to = 0; to < COLUMN_COUNT; to++) {
        if (canStack(top, topOf(state.tableau[to]))) {
          pushMove(out, state, { zone: 'foundation', suit: s }, { zone: 'tableau', col: to }, 1);
        }
      }
      for (c = 0; c < FREE_CELL_COUNT; c++) {
        if (!state.freeCells[c]) {
          pushMove(out, state, { zone: 'foundation', suit: s }, { zone: 'free', cell: c }, 1);
        }
      }
    }

    out.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
    return out;
  }

  function removeTop(state, zone, count) {
    var removed = [];
    var i;
    if (zone.zone === 'tableau') {
      var col = state.tableau[zone.col];
      var start = zone.index != null ? zone.index : col.length - count;
      removed = col.splice(start, count);
    } else if (zone.zone === 'free') {
      removed = [state.freeCells[zone.cell]];
      state.freeCells[zone.cell] = null;
    } else if (zone.zone === 'foundation') {
      removed = [state.foundations[zone.suit].pop()];
    }
    if (removed.length !== count) throw new Error('移动牌数与来源不符');
    return removed;
  }

  function placeCards(state, to, cards) {
    if (to.zone === 'tableau') {
      var col = state.tableau[to.col];
      for (var i = 0; i < cards.length; i++) col.push(cards[i]);
    } else if (to.zone === 'free') {
      if (state.freeCells[to.cell]) throw new Error('空位已被占用');
      state.freeCells[to.cell] = cards[0];
    } else if (to.zone === 'foundation') {
      var pile = state.foundations[to.suit];
      if (cards[0].suit !== to.suit) throw new Error('花色与基础堆不符');
      if (!canFoundation(cards[0], pile)) throw new Error('基础堆必须从 A 开始升序');
      pile.push(cards[0]);
    }
  }

  function applyMove(state, move, opts) {
    if (!state) throw new Error('缺少 state');
    var key = typeof move === 'string' ? move : (move && move.key);
    if (!key) throw new Error('缺少移动 key');
    var legal = getLegalMoves(state);
    var found = null;
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].key === key) { found = legal[i]; break; }
    }
    if (!found) throw new Error('非法移动: ' + key);

    var next = clone(state);
    var cards = removeTop(next, found.from, found.count);
    placeCards(next, found.to, cards);
    next.moves += 1;
    next.autoMoves = state.autoMoves || 0;
    next.lastMove = {
      key: found.key,
      from: clone(found.from),
      to: clone(found.to),
      count: found.count,
      cardId: found.cardId,
      cardLabel: found.cardLabel
    };
    if (isWon(next)) {
      next.status = 'won';
      next.finishedAt = opts && opts.now != null ? Number(opts.now) : state.finishedAt || null;
    }
    return next;
  }

  /* --------------------------------------------------------------- scoring */

  function isWon(state) {
    if (!state || !Array.isArray(state.foundations)) return false;
    for (var i = 0; i < FOUNDATION_COUNT; i++) {
      if (!state.foundations[i] || state.foundations[i].length !== 13) return false;
    }
    return true;
  }

  function foundationCards(state) {
    return state.foundations.reduce(function (n, pile) { return n + pile.length; }, 0);
  }

  function score(state, opts) {
    var now = opts && opts.now != null ? Number(opts.now) : null;
    var elapsedMs = 0;
    if (now != null && state.startedAt) elapsedMs = Math.max(0, now - state.startedAt);
    return {
      moves: state.moves,
      autoMoves: state.autoMoves || 0,
      cardsHome: foundationCards(state),
      foundation: foundationCards(state),
      total: foundationCards(state),
      elapsedMs: elapsedMs,
      won: isWon(state)
    };
  }

  /* ------------------------------------------------------- auto-safe-send */

  function isSafeCard(state, card) {
    if (!card) return false;
    if (card.rank === 1) return true;
    var redSuits = [1, 2];
    var blackSuits = [0, 3];
    var checks = card.color === 'red' ? blackSuits : redSuits;
    var need = card.rank - 1;
    for (var i = 0; i < checks.length; i++) {
      if (state.foundations[checks[i]].length < need) return false;
    }
    return true;
  }

  function autoSafeSend(state, opts) {
    if (!state) throw new Error('缺少 state');
    var work = clone(state);
    var sent = [];
    for (var guard = 0; guard < DECK_SIZE; guard++) {
      var moves = getLegalMoves(work);
      var pick = null;
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        if (m.to.zone !== 'foundation') continue;
        var card = cardAt(work, m.from);
        if (card && isSafeCard(work, card)) { pick = m; break; }
      }
      if (!pick) break;
      work = applyMove(work, pick, opts);
      work.autoMoves = (work.autoMoves || 0) + 1;
      sent.push(pick.cardId);
    }
    return { state: work, sent: sent };
  }

  function autoFinish(state, opts) { return autoSafeSend(state, opts); }

  /* ------------------------------------------------------------------ hint */

  function describeMove(state, move) {
    var card = cardAt(state, move.from);
    var name = card ? card.label : '';
    if (move.to.zone === 'foundation') return '把 ' + name + ' 送上基础堆';
    if (move.to.zone === 'free') return '把 ' + name + ' 移到空位 ' + (move.to.cell + 1);
    if (move.to.zone === 'tableau') {
      if (move.toEmpty) return '把 ' + name + ' 移到空列 ' + (move.to.col + 1);
      var dest = topOf(state.tableau[move.to.col]);
      return '把 ' + name + ' 叠到 ' + (dest ? dest.label : '空列') + ' 上';
    }
    return '移动 ' + name;
  }

  function hint(state) {
    if (isWon(state)) return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var card = cardAt(state, m.from);
      var value = 0;
      if (m.to.zone === 'foundation') value += 110;
      if (m.from.zone === 'foundation') value -= 60;
      if (m.to.zone === 'tableau') {
        value += m.toEmpty ? 35 : 55;
        if (m.from.zone === 'tableau') {
          if (m.from.index > 0) {
            var below = state.tableau[m.from.col][m.from.index - 1];
            if (below && canFoundation(below, state.foundations[below.suit])) value += 75;
          }
          if (m.from.index === 0) value += 45;
        }
      }
      if (m.to.zone === 'free') value += 15;
      if (m.from.zone === 'free' && m.to.zone === 'tableau') value += 25;
      if (m.to.zone === 'foundation' && card && card.rank <= 2) value += 30;
      if (value > bestScore || (value === bestScore && (!best || m.key < best.key))) {
        best = m;
        bestScore = value;
      }
    }
    if (!best) return null;
    var out = clone(best);
    out.reason = describeMove(state, best);
    out.text = out.reason;
    out.value = bestScore;
    return out;
  }

  /* ------------------------------------------------------------- serialise */

  function serialize(state) { return JSON.stringify(state); }

  function deserialize(input) {
    var raw = input;
    if (typeof input === 'string') {
      try { raw = JSON.parse(input); }
      catch (err) { throw new Error('无法解析局面 JSON'); }
    }
    if (!raw || typeof raw !== 'object') throw new Error('局面必须是对象');
    var state = clone(raw);
    if (!Array.isArray(state.tableau) || state.tableau.length !== COLUMN_COUNT) throw new Error('牌桌必须是 8 列');
    if (!Array.isArray(state.freeCells) || state.freeCells.length !== FREE_CELL_COUNT) throw new Error('空位必须是 4 格');
    if (!Array.isArray(state.foundations) || state.foundations.length !== FOUNDATION_COUNT) throw new Error('基础堆必须是 4 堆');
    state.tableau.forEach(function (col) { if (!Array.isArray(col)) throw new Error('牌桌列必须是数组'); });
    state.foundations.forEach(function (pile, i) {
      if (!Array.isArray(pile)) throw new Error('基础堆必须是数组');
      for (var r = 0; r < pile.length; r++) {
        if (!pile[r] || pile[r].suit !== i || pile[r].rank !== r + 1) {
          throw new Error('基础堆必须同花色 A→K 升序');
        }
      }
    });
    var cards = allCards(state);
    if (cards.length !== DECK_SIZE) throw new Error('牌张不守恒: ' + cards.length);
    var seen = {};
    cards.forEach(function (card) {
      if (!card || !card.id) throw new Error('存在空牌');
      if (seen[card.id]) throw new Error('重复牌: ' + card.id);
      seen[card.id] = true;
      if (card.rank < 1 || card.rank > 13) throw new Error('点数越界');
      if (card.suit < 0 || card.suit > 3) throw new Error('花色越界');
    });
    if (!state.status) state.status = isWon(state) ? 'won' : 'playing';
    if (typeof state.moves !== 'number') state.moves = 0;
    return state;
  }

  function moveKey(move) {
    if (!move) return null;
    return move.key || moveKeyFor(move.from, move.to);
  }

  function findMove(state, key) {
    var moves = getLegalMoves(state);
    for (var i = 0; i < moves.length; i++) if (moves[i].key === key) return moves[i];
    return null;
  }

  return {
    VERSION: VERSION,
    COLUMN_COUNT: COLUMN_COUNT,
    FREE_CELL_COUNT: FREE_CELL_COUNT,
    FOUNDATION_COUNT: FOUNDATION_COUNT,
    DECK_SIZE: DECK_SIZE,
    MAX_DEAL_NUMBER: MAX_DEAL_NUMBER,
    CARD_RATIO: CARD_RATIO,
    RANKS: RANKS,
    SUITS: SUITS,
    rankLabel: rankLabel,
    makeCard: makeCard,
    cardFromIndex: cardFromIndex,
    suitOf: suitOf,
    isRed: isRed,
    canStack: canStack,
    canFoundation: canFoundation,
    isValidRun: isValidRun,
    normalizeDealNumber: normalizeDealNumber,
    msRandomSequence: msRandomSequence,
    dealOrder: dealOrder,
    dealDeck: dealDeck,
    createGame: createGame,
    allCards: allCards,
    emptyColumnCount: emptyColumnCount,
    emptyFreeCellCount: emptyFreeCellCount,
    maxMove: maxMove,
    supermoveLimit: maxMove,
    getLegalMoves: getLegalMoves,
    findMove: findMove,
    applyMove: applyMove,
    cardAt: cardAt,
    isWon: isWon,
    foundationCards: foundationCards,
    score: score,
    isSafeCard: isSafeCard,
    autoSafeSend: autoSafeSend,
    autoFinish: autoFinish,
    hint: hint,
    serialize: serialize,
    deserialize: deserialize,
    moveKey: moveKey,
    topOf: topOf
  };
});
