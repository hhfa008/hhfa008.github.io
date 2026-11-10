/* 6 Nimmt! / 谁是牛头王 — premium UMD rules engine.
 * Node: require('./engine.js'); browser: window.SixNimmtPremiumEngine
 *
 * Official rules implemented:
 *  - Cards 1..104. Bull heads: 55 = 7; multiples of 11 = 5; multiples of 10 = 3;
 *    multiples of 5 = 2; every other card = 1.
 *  - 2..10 players. Every player receives 10 cards; four rows each start with
 *    one card. Remaining cards are out of play (hidden until settlement).
 *  - All players choose one card simultaneously. The chosen cards are revealed
 *    and resolved in ascending order.
 *  - A card joins the row whose end is the highest end lower than the card.
 *    If it is lower than every row end, its owner chooses a row, takes all
 *    cards in it, and the played card becomes the new row.
 *  - If the target row already has five cards, the owner takes those five and
 *    the played card starts the row.
 *  - Taken cards score their bull heads. After ten rounds, lowest total wins.
 *
 * The whole state is plain JSON (arrays, numbers, strings) so online rooms can
 * clone and replay it. Hidden information (other hands, unused cards) never
 * enters publicView().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SixNimmtPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Reuse the repo-wide seeded Fisher-Yates; never copy the shuffle.
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('SixNimmtPremiumEngine requires games/shared/shuffle.js');
  }

  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 10;
  var HAND_SIZE = 10;
  var ROWS = 4;
  var ROUNDS = 10;
  var DEFAULT_NAMES = ['你', '牛头猎手', '接龙赌徒', '黄铜公牛的守望者', '牧场主', '夜行牛仔', '绿呢术士', '计数员', '红丝绒客', '最后的牛仔'];

  function fullDeck() {
    var d = [];
    for (var c = 1; c <= 104; c++) d.push(c);
    return d;
  }

  // Official bull-head value. 55 is checked before the divisibility rules.
  function bull(card) {
    if (card === 55) return 7;
    if (card % 11 === 0) return 5;
    if (card % 10 === 0) return 3;
    if (card % 5 === 0) return 2;
    return 1;
  }

  function rowPoints(row) {
    var total = 0;
    for (var i = 0; i < row.length; i++) total += bull(row[i]);
    return total;
  }

  function makePlayers(count, names) {
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        id: i,
        name: (names && names[i]) || DEFAULT_NAMES[i] || ('玩家' + (i + 1)),
        human: i === 0,
        hand: [],
        taken: []
      });
    }
    return out;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 70) state.log.shift();
  }

  function emit(state, event) {
    state.events.push(event);
    if (state.events.length > 90) state.events.shift();
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var count = opts.players == null ? 3 : opts.players;
    if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
      throw new Error('players must be ' + MIN_PLAYERS + '..' + MAX_PLAYERS);
    }
    var deck = ShuffleApi.shuffle(fullDeck(), { seed: seed });
    var players = makePlayers(count, opts.names);
    for (var i = 0; i < count; i++) {
      players[i].hand = deck.splice(0, HAND_SIZE).sort(function (a, b) { return a - b; });
    }
    // Four starting cards, then the rest is out of play. Keep it in state (so
    // tests can prove card conservation) but never show it in a live view.
    var rows = [];
    for (var r = 0; r < ROWS; r++) rows.push([deck.shift()]);
    var state = {
      version: 1,
      seed: seed,
      players: players,
      rows: rows,
      unused: deck.slice(),          // hidden until game over
      round: 1,
      rounds: ROUNDS,
      picks: players.map(function () { return null; }),
      phase: 'pick',                 // pick | chooseRow | over
      resolving: null,               // { entries, idx } while a round resolves
      pending: null,                 // { player, card } for a row choice
      turnCount: 0,
      winner: null,
      winnerIds: [],
      tied: false,
      log: [],
      events: []
    };
    emit(state, { type: 'start', rows: rows.map(function (row) { return row[0]; }) });
    log(state, '洗好 104 张牌，' + count + ' 人各拿 10 张；四行起始牌为 ' + rows.map(function (row) { return row[0]; }).join(' / '));
    log(state, '第 1 轮：所有人同时暗出一张牌');
    return state;
  }

  function totalCards(state) {
    var n = state.unused.length + state.picks.filter(function (p) { return p != null; }).length;
    state.players.forEach(function (p) { n += p.hand.length + p.taken.length; });
    state.rows.forEach(function (row) { n += row.length; });
    if (state.resolving) {
      state.resolving.entries.forEach(function (entry, i) {
        if (i >= state.resolving.idx) n += 1; // not yet placed
      });
    }
    return n;
  }

  function legalPick(state, player, card) {
    if (!state || state.phase !== 'pick') return false;
    if (player < 0 || player >= state.players.length) return false;
    if (state.picks[player] != null) return false;
    return state.players[player].hand.indexOf(card) >= 0;
  }

  // Highest row end strictly below the card, or -1 when the card is lower than
  // every row end.
  function targetRow(rows, card) {
    var best = -1;
    var bestEnd = -1;
    for (var i = 0; i < rows.length; i++) {
      var end = rows[i][rows[i].length - 1];
      if (end < card && end > bestEnd) { bestEnd = end; best = i; }
    }
    return best;
  }

  function pickCard(state, player, card) {
    if (!legalPick(state, player, card)) throw new Error('illegal card');
    var hand = state.players[player].hand;
    hand.splice(hand.indexOf(card), 1);
    state.picks[player] = card;
    state.turnCount++;
    emit(state, { type: 'pick', player: player, card: card, hidden: true });
    if (state.picks.every(function (p) { return p != null; })) resolveRound(state);
    return state;
  }

  function resolveRound(state) {
    var entries = [];
    for (var i = 0; i < state.players.length; i++) {
      entries.push({ player: i, card: state.picks[i] });
    }
    entries.sort(function (a, b) { return a.card - b.card; });
    state.picks = state.players.map(function () { return null; });
    state.resolving = { entries: entries, idx: 0 };
    state.phase = 'pick';
    emit(state, { type: 'reveal', cards: entries.map(function (e) { return { player: e.player, card: e.card }; }) });
    continueResolve(state);
  }

  function continueResolve(state) {
    var res = state.resolving;
    if (!res) return;
    while (res.idx < res.entries.length) {
      var entry = res.entries[res.idx];
      var trow = targetRow(state.rows, entry.card);
      if (trow < 0) {
        // Lower than every row end: the owner must choose a row. Humans pause;
        // AI chooses immediately and play continues in the same loop.
        if (isHumanSeat(state, entry.player)) {
          state.pending = { player: entry.player, card: entry.card };
          state.phase = 'chooseRow';
          log(state, state.players[entry.player].name + ' 的 ' + entry.card + ' 小于所有行尾，需要选择吃哪一行');
          return;
        }
        var aiRow = aiRowChoice(state, entry.player);
        takeRow(state, entry.player, aiRow, entry.card, true);
        res.idx++;
        continue;
      }
      placeOnRow(state, entry.player, trow, entry.card);
      res.idx++;
    }
    finishResolve(state);
  }

  function isHumanSeat(state, player) {
    return !!(state.players[player] && state.players[player].human);
  }

  function placeOnRow(state, player, rowIndex, card) {
    var row = state.rows[rowIndex];
    if (row.length >= 5) {
      takeRow(state, player, rowIndex, card, false);
      return;
    }
    row.push(card);
    emit(state, { type: 'place', player: player, card: card, row: rowIndex });
    log(state, state.players[player].name + ' 的 ' + card + ' 接到第 ' + (rowIndex + 1) + ' 行');
  }

  function takeRow(state, player, rowIndex, card, chose) {
    var row = state.rows[rowIndex];
    var points = rowPoints(row);
    state.players[player].taken = state.players[player].taken.concat(row);
    state.players[player].taken.sort(function (a, b) { return a - b; });
    state.rows[rowIndex] = [card];
    emit(state, { type: 'takeRow', player: player, row: rowIndex, cards: row.slice(), points: points, chose: !!chose });
    log(state, state.players[player].name + (chose ? ' 选择' : ' 被迫') + '吃下第 ' + (rowIndex + 1) +
      ' 行 ' + row.join('/') + '（+' + points + ' 牛头）');
  }

  function legalRow(state, player, rowIndex) {
    return !!(state && state.phase === 'chooseRow' && state.pending &&
      state.pending.player === player && rowIndex >= 0 && rowIndex < state.rows.length);
  }

  function chooseRow(state, player, rowIndex) {
    if (!legalRow(state, player, rowIndex)) throw new Error('illegal row choice');
    var card = state.pending.card;
    takeRow(state, player, rowIndex, card, true);
    state.pending = null;
    state.phase = 'pick';
    if (!state.resolving) {
      // Defensive: a row choice only exists while resolving.
      finishResolve(state);
      return state;
    }
    state.resolving.idx++;
    continueResolve(state);
    return state;
  }

  function finishResolve(state) {
    state.resolving = null;
    state.pending = null;
    state.phase = 'pick';
    var empty = state.players.every(function (p) { return p.hand.length === 0; });
    if (empty) {
      state.phase = 'over';
      finish(state);
      return;
    }
    state.round++;
    emit(state, { type: 'round', round: state.round });
    log(state, '第 ' + state.round + ' 轮：所有人同时暗出一张牌');
  }

  function score(state, player) {
    var total = 0;
    var cards = state.players[player].taken;
    for (var i = 0; i < cards.length; i++) total += bull(cards[i]);
    return total;
  }

  function finish(state) {
    var best = Infinity;
    state.players.forEach(function (_, i) {
      var s = score(state, i);
      if (s < best) best = s;
    });
    state.winnerIds = [];
    state.players.forEach(function (_, i) {
      if (score(state, i) === best) state.winnerIds.push(i);
    });
    state.winner = state.winnerIds.length ? state.winnerIds[0] : null;
    state.tied = state.winnerIds.length !== 1;
    emit(state, {
      type: 'over',
      winner: state.winner,
      winnerIds: state.winnerIds.slice(),
      scores: state.players.map(function (_, i) { return score(state, i); })
    });
    log(state, '十轮结束：' + state.winnerIds.map(function (i) { return state.players[i].name; }).join('、') +
      ' 以 ' + best + ' 牛头获胜（低分者胜）');
  }

  // ------------------------------------------------------------------ AI ----
  // Decisions are PURE: they read the state and return an action. The caller
  // applies exactly one action, so online replay cannot double-mutate. Variety
  // comes from a deterministic hash of {seed, round, player, card}, not from
  // mutating a shared RNG.
  function hash32(x) {
    x = (x | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
  }

  function aiJitter(state, player, card, salt) {
    var h = (state.seed | 0) ^ 0x7f4a7c15;
    h = hash32(h ^ Math.imul(state.round, 2654435761));
    h = hash32(h ^ Math.imul(player + 1, 40503));
    h = hash32(h ^ Math.imul(card, 2246822519));
    h = hash32(h ^ Math.imul(salt || 0, 3266489917));
    return (h >>> 0) / 4294967296;
  }

  // Estimated cost of playing `card` now. Lower is better. Taking a row is
  // expensive; making a five-card row is a liability; a close gap to the row
  // end is safer. The estimate deliberately looks only at public information.
  function pickCost(state, player, card) {
    var rows = state.rows;
    var trow = targetRow(rows, card);
    var jitter = aiJitter(state, player, card, 11);
    if (trow < 0) {
      var cheapest = Infinity;
      for (var i = 0; i < rows.length; i++) cheapest = Math.min(cheapest, rowPoints(rows[i]));
      return cheapest + 7 + jitter * 1.6;
    }
    var row = rows[trow];
    var pts = rowPoints(row);
    var end = row[row.length - 1];
    var gap = card - end;
    var cost = card * 0.045 + pts * 0.075 + jitter * 1.5 - Math.min(gap, 20) * 0.06;
    if (row.length >= 5) cost += pts * 1.15 + 5;
    else if (row.length === 4) cost += pts * 0.6 + 2.4;
    return cost;
  }

  function aiPick(state, player) {
    var hand = state.players[player].hand;
    if (!hand.length) return null;
    var best = hand[0];
    var bestCost = Infinity;
    for (var i = 0; i < hand.length; i++) {
      var cost = pickCost(state, player, hand[i]);
      if (cost < bestCost - 1e-9) { bestCost = cost; best = hand[i]; }
    }
    return best;
  }

  function aiRowChoice(state, player) {
    var best = 0;
    var bestPts = Infinity;
    for (var i = 0; i < state.rows.length; i++) {
      var pts = rowPoints(state.rows[i]);
      // Prefer the cheapest row; among equals take the shortest one so fewer
      // cards are eaten (this also breaks symmetry deterministically).
      if (pts < bestPts || (pts === bestPts && state.rows[i].length < state.rows[best].length)) {
        bestPts = pts;
        best = i;
      }
    }
    return best;
  }

  function aiDecision(state, player) {
    if (!state || state.phase === 'over') return null;
    if (state.phase === 'chooseRow') {
      if (!state.pending || state.pending.player !== player) return null;
      return { type: 'row', player: player, row: aiRowChoice(state, player), card: state.pending.card };
    }
    if (state.phase !== 'pick' || state.picks[player] != null) return null;
    var card = aiPick(state, player);
    if (card == null) return null;
    return { type: 'pick', player: player, card: card };
  }

  function applyDecision(state, decision) {
    if (!decision) return null;
    if (decision.type === 'pick') pickCard(state, decision.player, decision.card);
    else if (decision.type === 'row') chooseRow(state, decision.player, decision.row);
    else throw new Error('unknown decision: ' + decision.type);
    return decision;
  }

  function aiAct(state, player) {
    return applyDecision(state, aiDecision(state, player));
  }

  // Fill every empty AI pick (used by the single-player page). Human seats are
  // left alone; if a human row choice is pending, stop.
  function aiFill(state) {
    var acted = [];
    if (state.phase !== 'pick') return acted;
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.human || state.picks[i] != null) continue;
      var decision = aiDecision(state, i);
      if (!decision) continue;
      applyDecision(state, decision);
      acted.push(decision);
      if (state.phase !== 'pick') break;
    }
    return acted;
  }

  // Local test convenience: one AI-heavy step.
  function step(state) {
    if (state.phase === 'over') return { over: true };
    if (state.phase === 'chooseRow') {
      var pending = state.pending;
      if (pending && !isHumanSeat(state, pending.player)) {
        aiAct(state, pending.player);
        return { type: 'row', player: pending.player };
      }
      return { needsHuman: true, phase: 'chooseRow' };
    }
    var filled = aiFill(state);
    if (filled.length) return { type: 'ai-fill', count: filled.length };
    return { needsHuman: true, phase: 'pick' };
  }

  function selfPlay(seed, players, names) {
    var state = createGame({ seed: seed, players: players || 3, names: names });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 40000) throw new Error('no progress');
      if (state.phase === 'chooseRow') {
        aiAct(state, state.pending.player);
        continue;
      }
      var acted = false;
      for (var i = 0; i < state.players.length; i++) {
        if (state.picks[i] == null) {
          aiAct(state, i);
          acted = true;
          if (state.phase !== 'pick') break;
        }
      }
      if (!acted && state.phase === 'pick') throw new Error('no picks made');
    }
    return state;
  }

  // ---------------------------------------------------------------- views ---
  function scoreBreakdown(state, player) {
    var taken = state.players[player].taken.slice().sort(function (a, b) { return a - b; });
    var byBull = { 1: 0, 2: 0, 3: 0, 5: 0, 7: 0 };
    taken.forEach(function (c) { byBull[bull(c)] += 1; });
    return {
      cards: taken,
      count: taken.length,
      total: score(state, player),
      byBull: byBull,
      highest: taken.length ? taken[taken.length - 1] : null
    };
  }

  function publicView(state, viewer) {
    var v = viewer == null ? 0 : viewer;
    return {
      phase: state.phase,
      round: state.round,
      rounds: state.rounds,
      rows: state.rows.map(function (row) { return row.slice(); }),
      rowPoints: state.rows.map(function (row) { return rowPoints(row); }),
      pending: state.pending ? { player: state.pending.player, card: state.pending.card } : null,
      resolving: state.resolving ? { total: state.resolving.entries.length, done: state.resolving.idx } : null,
      myPick: state.picks[v] == null ? null : state.picks[v],
      players: state.players.map(function (p, i) {
        return {
          name: p.name,
          human: i === v,
          hand: i === v ? p.hand.slice() : null,
          handCount: p.hand.length,
          taken: p.taken.slice(),
          score: score(state, i),
          breakdown: scoreBreakdown(state, i),
          picked: state.picks[i] != null,
          pickedCard: i === v ? (state.picks[i] == null ? null : state.picks[i]) : null
        };
      }),
      winner: state.winner,
      winnerIds: state.winnerIds.slice(),
      tied: state.tied,
      turnCount: state.turnCount,
      log: state.log.slice(),
      // Cards out of play stay hidden until the game is over.
      unused: state.phase === 'over' ? state.unused.slice() : undefined
    };
  }

  return {
    createGame: createGame,
    pickCard: pickCard,
    chooseRow: chooseRow,
    legalPick: legalPick,
    legalRow: legalRow,
    targetRow: targetRow,
    resolveRound: resolveRound,
    score: score,
    scoreBreakdown: scoreBreakdown,
    publicView: publicView,
    aiPick: aiPick,
    aiRowChoice: aiRowChoice,
    aiDecision: aiDecision,
    applyDecision: applyDecision,
    aiAct: aiAct,
    aiFill: aiFill,
    step: step,
    selfPlay: selfPlay,
    pickCost: pickCost,
    bull: bull,
    rowPoints: rowPoints,
    fullDeck: fullDeck,
    totalCards: totalCards,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    HAND_SIZE: HAND_SIZE,
    ROWS: ROWS,
    ROUNDS: ROUNDS,
    DEFAULT_NAMES: DEFAULT_NAMES
  };
});
