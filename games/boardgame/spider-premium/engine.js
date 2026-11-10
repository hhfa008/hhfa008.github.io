/*
 * Spider Solitaire 精品版纯规则引擎 — UMD
 *
 * 浏览器：globalThis.SpiderEngine；Node：require('./engine.js')
 *
 * 规则口径（Microsoft Spider / 104 张双副牌）：
 *   - 104 张牌：1 花色 = 8 组黑桃 A–K；2 花色 = 4 组黑桃 + 4 组红心；
 *     4 花色 = 两副标准 52 张牌。
 *   - 10 列：前 4 列 6 张，后 6 列 5 张，每列顶端一张正面朝上；
 *     发完 54 张后余下 50 张为牌堆，共 5 次发牌、每次 10 张。
 *   - 列内按点数递减排布（花色不限）；可整段移动的牌必须同花色且连续递减。
 *   - 发牌时每列各加一张正面牌；只要存在空列就不允许发牌。
 *   - 同花色 K→A 连续 13 张自动收走，集齐 8 组即获胜。
 *   - 计分：初始 500，每次移动/发牌 −1，每收走一组 +100；同时记录步数与发牌次数。
 *
 * 设计约束：
 *   - applyMove 不修改入参，返回全新 state；非法动作抛 Error。
 *   - 洗牌复用 games/shared/shuffle.js 的 seeded Fisher-Yates，不用 Math.random。
 *   - 全部 104 张牌在任何时刻都恰好存在一次（列 + 牌堆 + 已完成组）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SpiderEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('SpiderEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var TOTAL_CARDS = 104;
  var COLUMN_COUNT = 10;
  var STOCK_DEALS = 5;
  var DEAL_SIZE = 10;
  var TABLEAU_CARDS = 54;
  var START_SCORE = 500;
  var COMPLETE_RUN = 13;
  var WIN_RUNS = 8;
  var MOVE_PENALTY = 1;
  var RUN_BONUS = 100;

  var SUITS = Object.freeze([
    Object.freeze({ key: 'spades', zh: '黑桃', symbol: '♠', red: false }),
    Object.freeze({ key: 'hearts', zh: '红心', symbol: '♥', red: true }),
    Object.freeze({ key: 'diamonds', zh: '方块', symbol: '♦', red: true }),
    Object.freeze({ key: 'clubs', zh: '梅花', symbol: '♣', red: false })
  ]);
  var SUIT_BY_KEY = {};
  SUITS.forEach(function (s) { SUIT_BY_KEY[s.key] = s; });

  var DIFFICULTIES = Object.freeze([
    Object.freeze({ value: 1, key: 'one', label: '一色 · 简单', zh: '一色', suits: ['spades'], copies: 8 }),
    Object.freeze({ value: 2, key: 'two', label: '二色 · 普通', zh: '二色', suits: ['spades', 'hearts'], copies: 4 }),
    Object.freeze({ value: 4, key: 'four', label: '四色 · 困难', zh: '四色', suits: ['spades', 'hearts', 'diamonds', 'clubs'], copies: 2 })
  ]);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function normalizeDifficulty(value) {
    if (value == null) return 1;
    if (typeof value === 'string') {
      var text = value.trim().toLowerCase();
      if (text === 'one' || text === 'easy' || text === '1' || text === '1-suit' || text === '一色') return 1;
      if (text === 'two' || text === 'normal' || text === '2' || text === '2-suit' || text === '二色') return 2;
      if (text === 'four' || text === 'hard' || text === '4' || text === '4-suit' || text === '四色') return 4;
    }
    var n = Number(value);
    if (n === 1 || n === 2 || n === 4) return n;
    throw new Error('难度必须是 1、2 或 4 花色');
  }

  function difficultyInfo(value) {
    var d = normalizeDifficulty(value);
    for (var i = 0; i < DIFFICULTIES.length; i++) {
      if (DIFFICULTIES[i].value === d) return DIFFICULTIES[i];
    }
    return DIFFICULTIES[0];
  }

  function rankLabel(rank) {
    if (rank === 1) return 'A';
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    return String(rank);
  }

  function suitInfo(key) {
    return SUIT_BY_KEY[key] || { key: key, zh: key, symbol: '?', red: false };
  }

  function cardLabel(card) {
    if (!card) return '';
    return suitInfo(card.suit).zh + rankLabel(card.rank);
  }

  function makeDeck(difficulty) {
    var d = normalizeDifficulty(difficulty);
    var groups = [];
    if (d === 1) groups = [['spades', 8]];
    else if (d === 2) groups = [['spades', 4], ['hearts', 4]];
    else groups = [['spades', 2], ['hearts', 2], ['diamonds', 2], ['clubs', 2]];
    var deck = [];
    groups.forEach(function (group) {
      var suit = group[0];
      var copies = group[1];
      for (var copy = 0; copy < copies; copy++) {
        for (var rank = 1; rank <= 13; rank++) {
          deck.push({
            id: suit + '-' + rank + '-c' + copy,
            suit: suit,
            rank: rank,
            faceUp: false
          });
        }
      }
    });
    return deck;
  }

  function allCards(state) {
    if (!state) return [];
    var cards = [];
    (state.columns || []).forEach(function (col) { cards = cards.concat(col); });
    cards = cards.concat(state.stock || []);
    (state.foundations || []).forEach(function (run) { cards = cards.concat(run.cards || []); });
    return cards;
  }

  function cardCounts(state) {
    var counts = { columns: 0, stock: 0, foundations: 0, total: 0, unique: 0 };
    var ids = {};
    allCards(state).forEach(function (card) {
      counts.total += 1;
      ids[card.id] = true;
    });
    counts.unique = Object.keys(ids).length;
    (state.columns || []).forEach(function (col) { counts.columns += col.length; });
    counts.stock = (state.stock || []).length;
    (state.foundations || []).forEach(function (run) { counts.foundations += (run.cards || []).length; });
    return counts;
  }

  function createGame(opts) {
    var options = opts && typeof opts === 'object' ? opts : { seed: opts };
    var seed = options.seed == null ? 1 : options.seed;
    var difficulty = normalizeDifficulty(
      options.difficulty != null ? options.difficulty : options.drawMode
    );
    var deck = ShuffleApi.shuffle(makeDeck(difficulty), {
      seed: 'spider:' + String(seed) + ':' + difficulty
    });
    var columns = [];
    for (var c = 0; c < COLUMN_COUNT; c++) columns.push([]);
    var cursor = 0;
    // 5 轮每列各一张，第 6 轮只发给前 4 列 → 6,6,6,6,5,5,5,5,5,5。
    for (var round = 0; round < 6; round++) {
      var count = round < 5 ? COLUMN_COUNT : 4;
      for (var col = 0; col < count; col++) columns[col].push(deck[cursor++]);
    }
    columns.forEach(function (column) {
      if (column.length) column[column.length - 1].faceUp = true;
    });
    var stock = deck.slice(cursor);
    var state = {
      version: VERSION,
      seed: seed,
      difficulty: difficulty,
      columns: columns,
      stock: stock,
      foundations: [],
      completedRuns: 0,
      score: START_SCORE,
      moves: 0,
      deals: 0,
      actionCount: 0,
      over: false,
      result: null,
      lastAction: null,
      log: []
    };
    appendLog(state, 'start',
      '蜘蛛纸牌开局：' + difficultyInfo(difficulty).label + '，104 张牌，牌堆 ' + stock.length + ' 张。');
    return state;
  }

  function appendLog(state, type, text, data) {
    state.log.push({
      turn: state.actionCount,
      type: type,
      text: text,
      data: data || null
    });
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  }

  function movableFrom(column, index) {
    if (!Array.isArray(column)) return false;
    if (!Number.isInteger(index) || index < 0 || index >= column.length) return false;
    if (!column[index].faceUp) return false;
    for (var i = index; i < column.length - 1; i++) {
      if (!column[i].faceUp || !column[i + 1].faceUp) return false;
      if (column[i].suit !== column[i + 1].suit) return false;
      if (column[i].rank !== column[i + 1].rank + 1) return false;
    }
    return true;
  }

  function isMovableRun(state, colIndex, index) {
    if (!state || !state.columns) return false;
    if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= state.columns.length) return false;
    return movableFrom(state.columns[colIndex], index);
  }

  function canPlaceOn(column, runTopCard) {
    if (!Array.isArray(column) || !runTopCard) return false;
    if (column.length === 0) return true;
    var top = column[column.length - 1];
    if (!top.faceUp) return false;
    return top.rank === runTopCard.rank + 1;
  }

  function canPlaceRun(state, fromCol, toCol, index) {
    if (!state || !state.columns) return false;
    if (!Number.isInteger(fromCol) || !Number.isInteger(toCol)) return false;
    if (fromCol === toCol) return false;
    if (fromCol < 0 || fromCol >= state.columns.length) return false;
    if (toCol < 0 || toCol >= state.columns.length) return false;
    var source = state.columns[fromCol];
    if (!movableFrom(source, index)) return false;
    return canPlaceOn(state.columns[toCol], source[index]);
  }

  function canDeal(state) {
    if (!state || state.over) return false;
    if (!Array.isArray(state.stock) || state.stock.length < DEAL_SIZE) return false;
    if (!Array.isArray(state.columns) || state.columns.length !== COLUMN_COUNT) return false;
    return state.columns.every(function (column) { return column.length > 0; });
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var moves = [];
    for (var from = 0; from < state.columns.length; from++) {
      var source = state.columns[from];
      for (var index = 0; index < source.length; index++) {
        if (!movableFrom(source, index)) continue;
        for (var to = 0; to < state.columns.length; to++) {
          if (to === from) continue;
          if (!canPlaceOn(state.columns[to], source[index])) continue;
          moves.push({
            type: 'move',
            fromCol: from,
            toCol: to,
            index: index,
            runLength: source.length - index,
            key: 'move:' + from + ':' + to + ':' + index
          });
        }
      }
    }
    if (canDeal(state)) moves.push({ type: 'deal', key: 'deal' });
    return moves;
  }

  function isCompletedTail(cards) {
    if (!Array.isArray(cards) || cards.length < COMPLETE_RUN) return false;
    var tail = cards.slice(cards.length - COMPLETE_RUN);
    var suit = tail[0].suit;
    for (var i = 0; i < COMPLETE_RUN; i++) {
      var card = tail[i];
      if (!card.faceUp) return false;
      if (card.suit !== suit) return false;
      if (card.rank !== COMPLETE_RUN - i) return false;
    }
    return true;
  }

  function findCompletedTail(state, colIndex) {
    if (!state || !state.columns) return -1;
    var column = state.columns[colIndex];
    if (!column || column.length < COMPLETE_RUN) return -1;
    return isCompletedTail(column) ? column.length - COMPLETE_RUN : -1;
  }

  function removeCompletedRuns(state) {
    var removed = 0;
    state.columns.forEach(function (column, colIndex) {
      while (column.length >= COMPLETE_RUN && isCompletedTail(column)) {
        var cards = column.splice(column.length - COMPLETE_RUN, COMPLETE_RUN);
        state.foundations.push({ suit: cards[0].suit, cards: cards });
        removed += 1;
        state.score += RUN_BONUS;
        appendLog(state, 'complete',
          '收走第 ' + state.foundations.length + ' 组 ' + suitInfo(cards[0].suit).symbol +
          ' K→A（+' + RUN_BONUS + ' 分）。');
        if (column.length && !column[column.length - 1].faceUp) {
          column[column.length - 1].faceUp = true;
        }
      }
    });
    state.completedRuns = state.foundations.length;
    return removed;
  }

  function finish(state, win, reason) {
    state.over = true;
    state.completedRuns = state.foundations.length;
    state.result = {
      win: !!win,
      reason: reason,
      score: state.score,
      moves: state.moves,
      deals: state.deals,
      completedRuns: state.completedRuns
    };
    appendLog(state, 'end', (win ? '胜利：' + reason : '无棋可走：' + reason) +
      '；得分 ' + state.score + '，步数 ' + state.moves + '，发牌 ' + state.deals + ' 次。');
    return state;
  }

  function validateMove(state, move) {
    if (!state || !state.columns) throw new Error('缺少对局状态');
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    if (state.over) throw new Error('对局已结束');
    if (move.type === 'deal' || move.type === 'draw') {
      if (state.stock.length < DEAL_SIZE) throw new Error('牌堆已空，无法发牌');
      if (!state.columns.every(function (column) { return column.length > 0; })) {
        throw new Error('存在空列时不能发牌');
      }
      return { type: 'deal' };
    }
    if (move.type !== 'move') throw new Error('未知动作类型');
    var from = move.fromCol;
    var to = move.toCol;
    var index = move.index;
    if (!Number.isInteger(from) || from < 0 || from >= state.columns.length) throw new Error('来源列非法');
    if (!Number.isInteger(to) || to < 0 || to >= state.columns.length) throw new Error('目标列非法');
    if (from === to) throw new Error('不能移动到同一列');
    var source = state.columns[from];
    if (!Number.isInteger(index) || index < 0 || index >= source.length) throw new Error('牌的起始位置非法');
    if (!source[index].faceUp) throw new Error('背面牌不能移动');
    if (!movableFrom(source, index)) throw new Error('只能移动同花色连续递减的整段牌');
    if (!canPlaceOn(state.columns[to], source[index])) {
      throw new Error('目标列顶牌必须比移动牌大 1 点');
    }
    return { type: 'move', fromCol: from, toCol: to, index: index };
  }

  function applyMove(state, move) {
    var checked = validateMove(state, move);
    var next = clone(state);
    next.actionCount += 1;

    if (checked.type === 'deal') {
      var dealt = 0;
      for (var col = 0; col < COLUMN_COUNT; col++) {
        var card = next.stock.pop();
        card.faceUp = true;
        next.columns[col].push(card);
        dealt += 1;
      }
      next.deals += 1;
      next.score -= MOVE_PENALTY;
      next.lastAction = { type: 'deal', cards: dealt, stock: next.stock.length };
      appendLog(next, 'deal', '发牌：每列一张，共 ' + dealt + ' 张；牌堆剩 ' + next.stock.length + ' 张。');
    } else {
      var run = next.columns[checked.fromCol].splice(checked.index);
      next.columns[checked.toCol] = next.columns[checked.toCol].concat(run);
      var source = next.columns[checked.fromCol];
      var exposed = source.length ? source[source.length - 1] : null;
      var flipped = !!(exposed && !exposed.faceUp);
      if (flipped) exposed.faceUp = true;
      next.moves += 1;
      next.score -= MOVE_PENALTY;
      next.lastAction = {
        type: 'move',
        fromCol: checked.fromCol,
        toCol: checked.toCol,
        index: checked.index,
        runLength: run.length,
        card: run[0],
        flipped: flipped
      };
      appendLog(next, 'move',
        '移动 ' + cardLabel(run[0]) + ' 起的 ' + run.length + ' 张：第 ' +
        (checked.fromCol + 1) + ' 列 → 第 ' + (checked.toCol + 1) + ' 列。');
    }

    removeCompletedRuns(next);

    if (next.foundations.length >= WIN_RUNS) {
      finish(next, true, '集齐 8 组同花 K→A');
      return next;
    }
    if (getLegalMoves(next).length === 0) {
      finish(next, false, next.stock.length >= DEAL_SIZE ? '存在空列且无牌可动' : '没有合法动作');
      return next;
    }
    return next;
  }

  function isWon(state) {
    if (!state) return false;
    return (state.foundations && state.foundations.length >= WIN_RUNS) ||
      !!(state.result && state.result.win);
  }

  function isGameOver(state) {
    return !!(state && state.over);
  }

  function score(state) {
    if (!state) throw new Error('缺少对局状态');
    return state.score;
  }

  function hint(state) {
    if (!state || state.over) return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var tableau = moves.filter(function (move) { return move.type === 'move'; });
    if (!tableau.length) return clone(moves[0]);

    var best = null;
    var bestValue = -Infinity;
    tableau.forEach(function (move) {
      var source = state.columns[move.fromCol];
      var dest = state.columns[move.toCol];
      var run = source.slice(move.index);
      var value = run.length * 2;
      var combinedTail = dest.concat(run);
      if (isCompletedTail(combinedTail)) value += 1000;
      if (move.index > 0 && !source[move.index - 1].faceUp) value += 45;
      if (dest.length && dest[dest.length - 1].suit === run[0].suit) value += 30;
      if (dest.length && dest[dest.length - 1].rank === run[0].rank + 1) value += 8;
      if (dest.length === 0) value -= 30;
      if (run[0].rank === 13) value -= 6;
      value += (run.length * 3);
      if (value > bestValue || (value === bestValue && best && move.key < best.key)) {
        bestValue = value;
        best = move;
      }
    });
    if (best) return clone(best);
    var deal = moves.filter(function (move) { return move.type === 'deal'; })[0];
    return deal ? clone(deal) : null;
  }

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(text) {
    var state = typeof text === 'string' ? JSON.parse(text) : clone(text);
    if (!state || !Array.isArray(state.columns) || state.columns.length !== COLUMN_COUNT) {
      throw new Error('存档格式非法：列数必须为 10');
    }
    if (!Array.isArray(state.stock) || !Array.isArray(state.foundations)) {
      throw new Error('存档格式非法：缺少牌堆或完成组');
    }
    if (allCards(state).length !== TOTAL_CARDS) {
      throw new Error('存档格式非法：牌数不是 104');
    }
    return state;
  }

  function describeMove(state, move) {
    if (!move) return '';
    if (move.type === 'deal') return '发牌';
    var source = state && state.columns ? state.columns[move.fromCol] : null;
    var card = source && source[move.index];
    return '第 ' + (move.fromCol + 1) + ' 列 → 第 ' + (move.toCol + 1) + ' 列' +
      (card ? '（' + cardLabel(card) + '）' : '');
  }

  function scoreBreakdown(state) {
    if (!state) throw new Error('缺少对局状态');
    return {
      start: START_SCORE,
      movePenalty: state.moves * MOVE_PENALTY,
      dealPenalty: state.deals * MOVE_PENALTY,
      runBonus: state.foundations.length * RUN_BONUS,
      total: START_SCORE - (state.moves + state.deals) * MOVE_PENALTY + state.foundations.length * RUN_BONUS
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    TOTAL_CARDS: TOTAL_CARDS,
    COLUMN_COUNT: COLUMN_COUNT,
    STOCK_DEALS: STOCK_DEALS,
    DEAL_SIZE: DEAL_SIZE,
    TABLEAU_CARDS: TABLEAU_CARDS,
    START_SCORE: START_SCORE,
    COMPLETE_RUN: COMPLETE_RUN,
    WIN_RUNS: WIN_RUNS,
    MOVE_PENALTY: MOVE_PENALTY,
    RUN_BONUS: RUN_BONUS,
    SUITS: SUITS,
    DIFFICULTIES: DIFFICULTIES,
    normalizeDifficulty: normalizeDifficulty,
    difficultyInfo: difficultyInfo,
    rankLabel: rankLabel,
    suitInfo: suitInfo,
    cardLabel: cardLabel,
    makeDeck: makeDeck,
    createGame: createGame,
    newGame: createGame,
    allCards: allCards,
    cardCounts: cardCounts,
    movableFrom: movableFrom,
    isMovableRun: isMovableRun,
    canPlaceOn: canPlaceOn,
    canPlaceRun: canPlaceRun,
    canDeal: canDeal,
    getLegalMoves: getLegalMoves,
    legalMoves: getLegalMoves,
    isCompletedTail: isCompletedTail,
    findCompletedTail: findCompletedTail,
    validateMove: validateMove,
    applyMove: applyMove,
    move: applyMove,
    isWon: isWon,
    isGameOver: isGameOver,
    score: score,
    scoreBreakdown: scoreBreakdown,
    hint: hint,
    describeMove: describeMove,
    serialize: serialize,
    deserialize: deserialize
  });
});
