/*
 * Lost Cities（失落之城）精品版纯规则引擎 — UMD
 *
 * 浏览器：globalThis.LostCitiesEngine；Node：require('./engine.js')
 *
 * 规则口径（官方 3 局赛制）：
 *   - 60 张牌：5 色 × (数字 2–10 九张 + 赌注牌三张)。
 *   - 每人 8 张手牌，余下 44 张为牌堆；每色独立弃牌堆。
 *   - 每回合先打出一张牌（放入自己同色探险列或弃到同色弃牌堆），
 *     再从牌堆顶或任一弃牌堆顶抽一张；不能抽自己本回合刚弃的牌。
 *   - 数字必须严格递增；赌注牌只能在数字牌之前连续打出。
 *   - 任一玩家从牌堆抽走最后一张牌的瞬间本局结束。
 *   - 每色：无牌 0；只有赌注 每张 -20；有数字 (数字和 - 20) × (1 + 赌注数)；
 *     该列数字 + 赌注总数 ≥ 8 额外 +20。
 *   - 三局累计总分，高者胜；平局共享胜利；每局由上一局高分者先手
 *     （局分平手时沿用上一局先手）。
 *
 * 设计约束：
 *   - applyMove 不修改入参，返回全新 state；非法动作抛 Error。
 *   - 牌堆洗牌复用 games/shared/shuffle.js 的 seeded Fisher-Yates。
 *   - AI 只从 getLegalMoves 中选动作，且不读取暗牌身份来作弊。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.LostCitiesEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('LostCitiesEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var ROUNDS = 3;
  var HAND_SIZE = 8;
  var TOTAL_CARDS = 60;
  var MAX_TURNS = 500;
  var START_PENALTY = 20;
  var EIGHT_CARD_BONUS = 20;

  var COLORS = Object.freeze([
    Object.freeze({ index: 0, key: 'yellow', name: '黄', zh: '黄色', hex: '#c9a227', light: '#f4dc8c', dark: '#6d5208' }),
    Object.freeze({ index: 1, key: 'blue', name: '蓝', zh: '蓝色', hex: '#2f6fa8', light: '#9fc9e8', dark: '#123b5e' }),
    Object.freeze({ index: 2, key: 'white', name: '白', zh: '白色', hex: '#ded3ba', light: '#fffaf0', dark: '#8f8064' }),
    Object.freeze({ index: 3, key: 'green', name: '绿', zh: '绿色', hex: '#486b46', light: '#a8c49a', dark: '#20361f' }),
    Object.freeze({ index: 4, key: 'red', name: '红', zh: '红色', hex: '#a9473d', light: '#e79a8e', dark: '#641f18' })
  ]);
  var COLOR_KEYS = COLORS.map(function (c) { return c.key; });
  var COLOR_BY_KEY = {};
  COLORS.forEach(function (c) { COLOR_BY_KEY[c.key] = c; });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function nextRandomFactory(seedText) {
    // Deterministic tie-break only; real card randomness comes from Shuffle.
    var state = 2166136261;
    var text = String(seedText);
    for (var i = 0; i < text.length; i++) {
      state ^= text.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    return function () {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function makeDeck() {
    var deck = [];
    COLORS.forEach(function (color) {
      for (var value = 2; value <= 10; value++) {
        deck.push({ id: color.key + '-' + value, color: color.key, kind: 'number', value: value });
      }
      for (var w = 1; w <= 3; w++) {
        deck.push({ id: color.key + '-w' + w, color: color.key, kind: 'wager', value: 0 });
      }
    });
    return deck;
  }

  function emptyExpeditions() {
    var exp = {};
    COLOR_KEYS.forEach(function (key) { exp[key] = { wagers: [], nums: [] }; });
    return exp;
  }

  function emptyDiscards() {
    var discards = {};
    COLOR_KEYS.forEach(function (key) { discards[key] = []; });
    return discards;
  }

  function createPlayer(index, name, isAI) {
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      hand: [],
      exp: emptyExpeditions(),
      roundScores: [],
      totalScore: 0
    };
  }

  function appendLog(state, playerIndex, type, text, data) {
    var player = playerIndex == null ? null : state.players[playerIndex];
    state.log.push({
      turn: state.turn,
      round: state.round,
      player: playerIndex,
      playerName: player ? player.name : null,
      type: type,
      text: text,
      data: data || null
    });
    if (state.log.length > 260) state.log.splice(0, state.log.length - 260);
  }

  function expeditionCardCount(exp) {
    return exp.wagers.length + exp.nums.length;
  }

  function expeditionScore(exp) {
    if (!exp) throw new Error('缺少探险列');
    var counts = expeditionCardCount(exp);
    if (exp.nums.length === 0) {
      return exp.wagers.length === 0 ? 0 : -START_PENALTY * exp.wagers.length;
    }
    var sum = 0;
    exp.nums.forEach(function (card) { sum += card.value; });
    var score = (sum - START_PENALTY) * (1 + exp.wagers.length);
    if (counts >= 8) score += EIGHT_CARD_BONUS;
    return score;
  }

  function expeditionBreakdown(exp) {
    var sum = 0;
    exp.nums.forEach(function (card) { sum += card.value; });
    var counts = expeditionCardCount(exp);
    var base = exp.nums.length ? (sum - START_PENALTY) * (1 + exp.wagers.length)
      : -START_PENALTY * exp.wagers.length;
    var bonus = exp.nums.length && counts >= 8 ? EIGHT_CARD_BONUS : 0;
    return {
      color: exp.color || null,
      wagers: exp.wagers.length,
      nums: exp.nums.map(function (card) { return card.value; }),
      cards: counts,
      sum: sum,
      base: base,
      bonus: bonus,
      total: base + bonus
    };
  }

  function playerRoundScore(player) {
    var total = 0;
    var lines = [];
    COLORS.forEach(function (color) {
      var exp = player.exp[color.key];
      var row = expeditionBreakdown(exp);
      row.color = color.key;
      row.colorName = color.zh;
      total += row.total;
      lines.push(row);
    });
    return { total: total, expeditions: lines };
  }

  function expectedScore(row) {
    // 仅用于 AI 估值：不改变正式计分。
    if (!row.nums.length) return row.wagers ? -20 * row.wagers : 0;
    var sum = row.nums.reduce(function (a, b) { return a + b; }, 0);
    var total = (sum - 20) * (1 + row.wagers);
    if (row.cards >= 8) total += 20;
    return total;
  }

  function cardLabel(card) {
    if (!card) return '';
    var color = COLOR_BY_KEY[card.color];
    return (color ? color.zh : card.color) + (card.kind === 'wager' ? '赌注' : card.value);
  }

  function buildDeckForRound(seed, roundNumber) {
    return ShuffleApi.shuffle(makeDeck(), { seed: String(seed) + ':lost-cities:round:' + roundNumber });
  }

  function resetRound(state, roundNumber, starter) {
    state.round = roundNumber;
    state.starter = starter;
    state.current = starter;
    state.phase = 'play';
    state.pendingDiscard = null;
    state.turn = 0;
    state.drawStreak = 0;
    state.discards = emptyDiscards();
    state.deck = buildDeckForRound(state.seed, roundNumber);
    state.players.forEach(function (player) {
      player.hand = [];
      player.exp = emptyExpeditions();
    });
    for (var i = 0; i < HAND_SIZE; i++) {
      state.players[0].hand.push(state.deck.pop());
      state.players[1].hand.push(state.deck.pop());
    }
    state.players.forEach(function (player) { sortHand(player); });
    appendLog(state, null, 'round',
      '第 ' + roundNumber + ' 局开始，' + state.players[starter].name + ' 先手；牌堆 ' + state.deck.length + ' 张。');
  }

  function sortHand(player) {
    player.hand.sort(function (a, b) {
      var ca = COLOR_KEYS.indexOf(a.color);
      var cb = COLOR_KEYS.indexOf(b.color);
      if (ca !== cb) return ca - cb;
      // 赌注排在数字前，方便看出可先押注。
      if (a.kind !== b.kind) return a.kind === 'wager' ? -1 : 1;
      return a.value - b.value;
    });
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object'
      ? seedOrOptions : { seed: seedOrOptions };
    var seed = opts.seed == null ? 1 : opts.seed;
    var humanFirst = opts.humanFirst !== false;
    var names = opts.names && opts.names.length === 2 ? opts.names.slice() : ['你', 'AI · 苔原学者'];
    var aiFlags = opts.isAI && opts.isAI.length === 2 ? opts.isAI.slice() : [false, true];

    var state = {
      version: VERSION,
      seed: seed,
      round: 1,
      rounds: ROUNDS,
      turn: 0,
      actionCount: 0,
      drawStreak: 0,
      phase: 'play',
      current: humanFirst ? 0 : 1,
      starter: humanFirst ? 0 : 1,
      deck: [],
      discards: emptyDiscards(),
      pendingDiscard: null,
      players: [
        createPlayer(0, names[0], !!aiFlags[0]),
        createPlayer(1, names[1], !!aiFlags[1])
      ],
      lastAction: null,
      lastRound: null,
      roundResults: [],
      over: false,
      result: null,
      log: []
    };
    appendLog(state, null, 'start', '失落之城 3 局赛开始，共 60 张牌。');
    resetRound(state, 1, state.starter);
    return state;
  }

  function currentPlayer(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    return state.players[state.current];
  }

  function canPlayCard(exp, card) {
    if (!exp || !card) return false;
    if (card.kind === 'wager') return exp.nums.length === 0;
    if (card.kind !== 'number') return false;
    if (exp.nums.length === 0) return true;
    return exp.nums[exp.nums.length - 1].value < card.value;
  }

  function canPlayInState(state, card) {
    if (!state || state.over || state.phase !== 'play') return false;
    var player = currentPlayer(state);
    return canPlayCard(player.exp[card.color], card);
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = currentPlayer(state);
    var moves = [];
    if (state.phase === 'play') {
      player.hand.forEach(function (card, handIndex) {
        if (canPlayCard(player.exp[card.color], card)) {
          moves.push({ type: 'play', handIndex: handIndex, cardId: card.id, color: card.color,
            kind: card.kind, value: card.value });
        }
        moves.push({ type: 'discard', handIndex: handIndex, cardId: card.id, color: card.color,
          kind: card.kind, value: card.value });
      });
      return moves;
    }
    if (state.phase === 'draw') {
      if (state.deck.length > 0) moves.push({ type: 'draw', source: 'deck' });
      COLORS.forEach(function (color) {
        var pile = state.discards[color.key];
        var top = pile.length ? pile[pile.length - 1] : null;
        if (!top || top.id === state.pendingDiscard) return;
        moves.push({ type: 'draw', source: 'discard', color: color.key, cardId: top.id,
          kind: top.kind, value: top.value });
      });
      return moves;
    }
    return moves;
  }

  function completeTurn(state) {
    // 一次打出/弃牌 + 一次抽牌算一个完整回合。
    state.turn += 1;
    state.phase = 'play';
    state.pendingDiscard = null;
    if (state.turn > MAX_TURNS && !state.over) {
      endRound(state, '达到安全回合上限');
      return;
    }
    state.current = 1 - state.current;
  }

  function finishMatch(state) {
    state.over = true;
    state.phase = 'over';
    var scores = state.players.map(function (player) {
      return {
        index: player.index,
        name: player.name,
        isAI: player.isAI,
        total: player.totalScore,
        roundScores: player.roundScores.slice()
      };
    });
    var best = Math.max(scores[0].total, scores[1].total);
    var winners = scores.filter(function (row) { return row.total === best; }).map(function (row) { return row.index; });
    state.result = {
      reason: '三局累计总分',
      round: ROUNDS,
      scores: scores,
      winner: winners.length === 1 ? winners[0] : null,
      winners: winners,
      tied: winners.length > 1,
      roundResults: state.roundResults.map(function (r) { return clone(r); })
    };
    appendLog(state, null, 'end', '比赛结束：' + scores.map(function (row) {
      return row.name + ' 累计 ' + row.total + ' 分';
    }).join('，') + '。' + (winners.length > 1 ? '双方共享胜利。' : ''));
    return state;
  }

  function endRound(state, reason) {
    var results = state.players.map(function (player) {
      var breakdown = playerRoundScore(player);
      return {
        index: player.index,
        name: player.name,
        expeditions: breakdown.expeditions,
        total: breakdown.total
      };
    });
    var best = Math.max(results[0].total, results[1].total);
    var winners = results.filter(function (row) { return row.total === best; }).map(function (row) { return row.index; });
    state.players.forEach(function (player, i) {
      player.roundScores.push(results[i].total);
      player.totalScore += results[i].total;
    });
    var record = {
      round: state.round,
      reason: reason,
      scores: results,
      winner: winners.length === 1 ? winners[0] : null,
      winners: winners,
      tied: winners.length > 1,
      totals: state.players.map(function (player) { return player.totalScore; })
    };
    state.roundResults.push(record);
    state.lastRound = record;
    appendLog(state, null, 'round-end',
      '第 ' + state.round + ' 局结束（' + reason + '）：' +
      results.map(function (row) { return row.name + ' ' + row.total + ' 分'; }).join('，') +
      '；累计 ' + state.players.map(function (p) { return p.name + ' ' + p.totalScore; }).join('，') + '。',
      { roundScores: results.map(function (r) { return r.total; }) });
    if (state.round >= ROUNDS) return finishMatch(state);
    var nextStarter = winners.length === 1 ? winners[0] : state.starter;
    resetRound(state, state.round + 1, nextStarter);
    return state;
  }

  function validateMove(state, move) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    if (state.over) throw new Error('比赛已结束');
    var player = currentPlayer(state);
    if (state.phase === 'play') {
      if (move.type !== 'play' && move.type !== 'discard') throw new Error('当前必须打出一张牌或弃牌');
      var index = move.handIndex;
      if (!Number.isInteger(index) || index < 0 || index >= player.hand.length) throw new Error('手牌编号非法');
      var card = player.hand[index];
      if (move.cardId != null && move.cardId !== card.id) throw new Error('手牌已变化');
      if (move.type === 'play' && !canPlayCard(player.exp[card.color], card)) {
        if (card.kind === 'wager') throw new Error('该探险列已有数字牌，不能再加赌注');
        throw new Error('数字必须严格递增');
      }
      return { type: move.type, handIndex: index, card: card };
    }
    if (state.phase === 'draw') {
      if (move.type !== 'draw') throw new Error('当前必须抽一张牌');
      if (move.source === 'deck') {
        if (state.deck.length === 0) throw new Error('牌堆已空');
        return { type: 'draw', source: 'deck', card: null };
      }
      if (move.source === 'discard' || move.source === 'pile') {
        if (!COLOR_BY_KEY[move.color]) throw new Error('弃牌堆颜色非法');
        var pile = state.discards[move.color];
        if (!pile.length) throw new Error('该弃牌堆为空');
        var top = pile[pile.length - 1];
        if (top.id === state.pendingDiscard) throw new Error('不能抽回自己本回合刚弃的牌');
        if (move.cardId != null && move.cardId !== top.id) throw new Error('弃牌堆顶已变化');
        return { type: 'draw', source: 'discard', color: move.color, card: top };
      }
      throw new Error('抽牌来源非法');
    }
    throw new Error('当前阶段不能行动');
  }

  function applyMove(state, move) {
    var checked = validateMove(state, move);
    var next = clone(state);
    var player = next.players[next.current];
    next.actionCount += 1;

    if (checked.type === 'play') {
      var card = player.hand.splice(checked.handIndex, 1)[0];
      var exp = player.exp[card.color];
      if (card.kind === 'wager') exp.wagers.push(card);
      else exp.nums.push(card);
      next.pendingDiscard = null;
      next.phase = 'draw';
      next.lastAction = {
        player: next.current, type: 'play', card: card, color: card.color,
        handIndex: checked.handIndex, phase: 'draw'
      };
      appendLog(next, next.current, 'play',
        player.name + ' 将 ' + cardLabel(card) + ' 放入' + COLOR_BY_KEY[card.color].zh + '探险列。');
      return next;
    }

    if (checked.type === 'discard') {
      var discarded = player.hand.splice(checked.handIndex, 1)[0];
      next.discards[discarded.color].push(discarded);
      next.pendingDiscard = discarded.id;
      next.phase = 'draw';
      next.lastAction = {
        player: next.current, type: 'discard', card: discarded, color: discarded.color,
        handIndex: checked.handIndex, phase: 'draw'
      };
      appendLog(next, next.current, 'discard',
        player.name + ' 弃掉 ' + cardLabel(discarded) + ' 到' + COLOR_BY_KEY[discarded.color].zh + '弃牌堆。');
      return next;
    }

    if (checked.source === 'deck') {
      var dealt = next.deck.pop();
      player.hand.push(dealt);
      sortHand(player);
      next.drawStreak = 0;
      next.lastAction = {
        player: next.current, type: 'draw', source: 'deck', card: null, deckCount: next.deck.length
      };
      appendLog(next, next.current, 'draw',
        player.name + ' 从牌堆抽了一张牌（剩余 ' + next.deck.length + ' 张）。');
      // 官方规则：最后一张牌被抽走的瞬间本局结束，对手不再获得回合。
      if (next.deck.length === 0) {
        endRound(next, '牌堆最后一张牌被抽走');
        return next;
      }
    } else {
      var taken = next.discards[checked.color].pop();
      player.hand.push(taken);
      sortHand(player);
      next.drawStreak = (next.drawStreak || 0) + 1;
      next.lastAction = {
        player: next.current, type: 'draw', source: 'discard', color: checked.color,
        card: taken, deckCount: next.deck.length
      };
      appendLog(next, next.current, 'draw',
        player.name + ' 从' + COLOR_BY_KEY[checked.color].zh + '弃牌堆拿走 ' + cardLabel(taken) + '。');
    }
    completeTurn(next);
    return next;
  }

  function isGameOver(state) { return !!(state && state.over); }

  function getResults(state) {
    if (!state) throw new Error('缺少对局状态');
    if (state.over && state.result) return state.result;
    var current = state.players.map(function (player) {
      var breakdown = playerRoundScore(player);
      return {
        index: player.index,
        name: player.name,
        isAI: player.isAI,
        roundScore: breakdown.total,
        totalSoFar: player.totalScore + breakdown.total,
        expeditions: breakdown.expeditions,
        roundScores: player.roundScores.slice()
      };
    });
    return {
      over: false,
      reason: null,
      round: state.round,
      scores: current,
      winner: null,
      winners: [],
      tied: false
    };
  }

  function winner(state) {
    if (!state || !state.over || !state.result) return null;
    if (state.result.tied) return 'tie';
    return state.result.winner;
  }

  function allCards(state) {
    var cards = state.deck.slice();
    COLORS.forEach(function (color) {
      cards = cards.concat(state.discards[color.key]);
    });
    state.players.forEach(function (player) {
      cards = cards.concat(player.hand);
      COLORS.forEach(function (color) {
        cards = cards.concat(player.exp[color.key].wagers);
        cards = cards.concat(player.exp[color.key].nums);
      });
    });
    return cards;
  }

  function hashString(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function handColorCount(player, color) {
    var n = 0;
    player.hand.forEach(function (card) { if (card.color === color) n += 1; });
    return n;
  }

  function handColorNumbers(player, color) {
    var n = 0;
    player.hand.forEach(function (card) { if (card.color === color && card.kind === 'number') n += 1; });
    return n;
  }

  function keepValue(player, card) {
    var exp = player.exp[card.color];
    var same = handColorNumbers(player, card.color);
    if (card.kind === 'wager') {
      if (exp.nums.length > 0) return 0;
      if (same >= 4) return 26;
      if (same >= 2) return 15 + same * 2;
      if (exp.wagers.length > 0) return 7;
      return 3;
    }
    if (exp.nums.length > 0) {
      var last = exp.nums[exp.nums.length - 1].value;
      if (last < card.value) return 19 + (card.value - last);
      return 0;
    }
    var value = 7 + card.value * 0.55 + same * 1.6 + exp.wagers.length * 6;
    if (card.value <= 4) value -= 3;
    if (exp.wagers.length && same === 0) value -= 2;
    return value;
  }

  function playHeuristic(state, move) {
    var player = currentPlayer(state);
    var card = player.hand[move.handIndex];
    if (!card) return -999;
    var exp = player.exp[card.color];
    if (move.type === 'discard') return 22 - keepValue(player, card);
    var same = handColorNumbers(player, card.color);
    if (card.kind === 'wager') {
      if (same >= 4) return 42 + exp.wagers.length * 2;
      if (same >= 3) return 31;
      if (same >= 2) return 19;
      if (same === 1) return 5;
      return -12;
    }
    if (exp.nums.length === 0) {
      var start = 14 + card.value * 0.8 + same * 2.2 + exp.wagers.length * 7;
      // 2/3 起手风险高，通常不如先弃掉。
      if (card.value <= 3 && same <= 1) start -= 10;
      return start;
    }
    var last = exp.nums[exp.nums.length - 1].value;
    var gap = card.value - last;
    var score = 24 + card.value * 0.7 + exp.wagers.length * 4;
    if (gap <= 2) score += 7;
    if (capstonePotential(exp, card.value)) score += 5;
    return score;
  }

  function capstonePotential(exp, value) {
    return value >= 8 && exp.nums.length >= 4;
  }

  function drawDiscardHeuristic(state, move) {
    if (move.source !== 'discard') return 10;
    var player = currentPlayer(state);
    var card = state.discards[move.color][state.discards[move.color].length - 1];
    return keepValue(player, card) + (card.kind === 'wager' ? 2 : 4);
  }

  function expeditionPotential(player) {
    var value = 0;
    COLORS.forEach(function (color) {
      var exp = player.exp[color.key];
      var sum = exp.nums.reduce(function (a, c) { return a + c.value; }, 0);
      var n = expeditionCardCount(exp);
      var base = exp.nums.length ? (sum - 20) * (1 + exp.wagers.length) : -20 * exp.wagers.length;
      if (n >= 8) base += 20;
      value += base;
      if (exp.nums.length) {
        var last = exp.nums[exp.nums.length - 1].value;
        var future = 0;
        player.hand.forEach(function (card) {
          if (card.color === color.key && card.kind === 'number' && card.value > last) {
            future += (1 + exp.wagers.length) * (card.value - last > 0 ? 1.6 : 0);
          }
        });
        value += future;
      } else if (exp.wagers.length) {
        player.hand.forEach(function (card) {
          if (card.color === color.key && card.kind === 'number') future += 1.2;
        });
        value += future;
      }
    });
    return value;
  }

  function evaluateState(state, perspective) {
    if (state.over && state.result) {
      var me = state.result.scores[perspective].total;
      var them = state.result.scores[1 - perspective].total;
      var win = state.result.tied ? 7 : (state.result.winner === perspective ? 26 : -26);
      return (me - them) * 3 + win;
    }
    var p = state.players[perspective];
    var o = state.players[1 - perspective];
    var pRound = playerRoundScore(p);
    var oRound = playerRoundScore(o);
    var score = (p.totalScore + pRound.total) - (o.totalScore + oRound.total);
    score += expeditionPotential(p) * 0.45 - expeditionPotential(o) * 0.4;
    var hand = 0;
    p.hand.forEach(function (card) { hand += keepValue(p, card); });
    score += hand * 0.16;
    // 牌堆越少，当前局分越确定；领先者更愿意加速结束。
    score += (44 - state.deck.length) * (score >= 0 ? 0.03 : -0.03);
    return score;
  }

  function isSafeMoveForAI(state, move) {
    try { validateMove(state, move); return true; } catch (err) { return false; }
  }

  function rankPlayMoves(state, level) {
    var moves = getLegalMoves(state).filter(function (m) { return m.type === 'play' || m.type === 'discard'; });
    var salt = String(state.seed) + ':' + state.round + ':' + state.turn + ':' + state.current + ':' + state.actionCount;
    var rng = nextRandomFactory(salt + ':' + level);
    return moves.map(function (move, index) {
      var score = playHeuristic(state, move);
      if (level === 'easy') score = rng() * 100;
      return { move: move, score: score, index: index, tie: (hashString(move.type + ':' + move.handIndex + ':' + state.actionCount) % 997) / 100000 };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.tie - b.tie;
    });
  }

  function chooseDrawMove(state, level) {
    var moves = getLegalMoves(state);
    if (!moves.length) throw new Error('没有合法抽牌动作');
    if (moves.length === 1) return moves[0];
    if (level === 'easy') {
      var salt = String(state.seed) + ':' + state.round + ':' + state.turn + ':' + state.actionCount + ':draw';
      var rng = nextRandomFactory(salt);
      return moves[Math.floor(rng() * moves.length) % moves.length];
    }
    var player = currentPlayer(state);
    // 连续拿弃牌会让牌堆永不减少；AI 每两回合必须摸牌堆，避免自对弈停滞。
    if ((state.drawStreak || 0) >= 2) {
      var forced = moves.find(function (m) { return m.source === 'deck'; });
      if (forced) return forced;
    }
    var best = moves[0];
    var bestScore = -Infinity;
    moves.forEach(function (move, index) {
      var score;
      if (move.source === 'deck') {
        score = 11.5;
      } else {
        var card = state.discards[move.color][state.discards[move.color].length - 1];
        score = keepValue(player, card);
        if (level === 'hard') {
          // 能立刻接上或凑齐 8 张时提高价值。
          var exp = player.exp[move.color];
          if (card.kind === 'number' && exp.nums.length) {
            var last = exp.nums[exp.nums.length - 1].value;
            if (last < card.value && card.value - last <= 2) score += 6;
          }
          if (expeditionCardCount(exp) + 1 >= 8) score += 9;
          if (card.kind === 'wager' && exp.nums.length === 0 && handColorNumbers(player, card.color) >= 2) score += 8;
        }
      }
      score += (hashString('draw:' + index + ':' + state.actionCount) % 97) / 10000;
      if (score > bestScore) { bestScore = score; best = move; }
    });
    if (level === 'normal' && best.source === 'discard' && bestScore < 9) return moves.find(function (m) { return m.source === 'deck'; }) || best;
    return best;
  }

  function choosePlayMoveHard(state) {
    var ranked = rankPlayMoves(state, 'hard').slice(0, 9);
    var perspective = state.current;
    var best = ranked[0].move;
    var bestValue = -Infinity;
    ranked.forEach(function (entry) {
      var after;
      try { after = applyMove(state, entry.move); } catch (err) { return; }
      if (!after || after.over) {
        var terminal = after ? evaluateState(after, perspective) : -Infinity;
        if (terminal > bestValue) { bestValue = terminal; best = entry.move; }
        return;
      }
      // 不偷看牌堆：牌堆抽牌按平均收益估值；弃牌堆抽牌使用公开牌。
      var drawCandidates = getLegalMoves(after).filter(function (m) {
        return m.source === 'discard' && drawDiscardHeuristic(after, m) >= 12;
      });
      if (drawCandidates.length) {
        drawCandidates.sort(function (a, b) { return drawDiscardHeuristic(after, b) - drawDiscardHeuristic(after, a); });
        for (var d = 0; d < Math.min(2, drawCandidates.length); d++) {
          var afterDraw;
          try { afterDraw = applyMove(after, drawCandidates[d]); } catch (err) { continue; }
          var value = evaluateState(afterDraw, perspective) + entry.score * 0.34 + 1.5;
          if (value > bestValue) { bestValue = value; best = entry.move; }
        }
      } else {
        var base = evaluateState(after, perspective) + entry.score * 0.34;
        if (base > bestValue) { bestValue = base; best = entry.move; }
      }
    });
    // 纯估值可能把“全部弃光”当成最优；保留一点进取性，避免三局 0:0。
    if (best.type === 'discard') {
      var attacking = ranked.filter(function (entry) {
        return entry.move.type === 'play' && entry.score >= 19;
      })[0];
      if (attacking) best = attacking.move;
    }
    return best;
  }

  function chooseAIMove(state, level) {
    if (!state || state.over) throw new Error('比赛已结束');
    var difficulty = level || state.aiLevel || 'normal';
    if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') difficulty = 'normal';
    var moves = getLegalMoves(state);
    if (!moves.length) throw new Error('没有合法动作');
    if (state.phase === 'draw') return chooseDrawMove(state, difficulty);
    if (difficulty === 'easy') return rankPlayMoves(state, 'easy')[0].move;
    if (difficulty === 'hard') return choosePlayMoveHard(state);
    return rankPlayMoves(state, 'normal')[0].move;
  }

  // 兼容旧调用名。
  function aiMove(state, level) { return chooseAIMove(state, level); }

  function moveKey(move) {
    if (!move) return '';
    if (move.type === 'draw') return 'draw:' + move.source + ':' + (move.color || '');
    return move.type + ':' + move.handIndex + ':' + (move.cardId || '');
  }

  return Object.freeze({
    VERSION: VERSION,
    ROUNDS: ROUNDS,
    HAND_SIZE: HAND_SIZE,
    TOTAL_CARDS: TOTAL_CARDS,
    START_PENALTY: START_PENALTY,
    EIGHT_CARD_BONUS: EIGHT_CARD_BONUS,
    MAX_TURNS: MAX_TURNS,
    COLORS: COLORS,
    COLOR_KEYS: COLOR_KEYS,
    COLOR_BY_KEY: COLOR_BY_KEY,
    AI_LEVELS: Object.freeze(['easy', 'normal', 'hard']),
    createGame: createGame,
    makeDeck: makeDeck,
    getLegalMoves: getLegalMoves,
    legalMoves: getLegalMoves,
    validateMove: validateMove,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    aiMove: aiMove,
    isGameOver: isGameOver,
    getResults: getResults,
    winner: winner,
    scorePlayer: playerRoundScore,
    expeditionScore: expeditionScore,
    expeditionBreakdown: expeditionBreakdown,
    canPlayCard: canPlayCard,
    canPlayInState: canPlayInState,
    currentPlayer: currentPlayer,
    allCards: allCards,
    cardLabel: cardLabel,
    moveKey: moveKey,
    evaluateState: evaluateState
  });
});
