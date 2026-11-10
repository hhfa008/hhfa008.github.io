/*
 * For Sale（房地产拍卖）premium rules engine — UMD.
 *
 *   Browser: <script src="../../shared/shuffle.js"></script>
 *              <script src="data.js"></script>
 *              <script src="engine.js"></script>  -> globalThis.ForSaleEngine
 *   Node:    const Engine = require('./engine.js')
 *
 * 3–6 players, each starts with 18 coins.
 *
 * Phase 1 — property auction (30 cards, values 1–30):
 *   One card at a time. Starting with the auction winner of the previous lot,
 *   players bid ascending or pass. The last remaining bidder pays their bid,
 *   takes the card, and starts the next auction.
 *
 * Phase 2 — sell for cheques (30 cheques: 0,0,2,2,...,15,15):
 *   Each round reveals one cheque per seller. Sellers simultaneously choose
 *   one property; the highest property takes the highest cheque. Repeat until
 *   every property is sold (or the cheque deck is empty).
 *
 * Winner: most cash (unspent coins + cheques). Tie: most unspent coins; still
 * tied: shared victory.
 *
 * Design:
 *   - applyMove never mutates its input; illegal moves throw Error.
 *   - getView hides other players' pending sell picks and cheque values until
 *     the game is over, while money and property cards are public.
 *   - Both decks use games/shared/shuffle.js, so a seed reproduces the match.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ForSaleEngine = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var Data = null;
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { Data = require('./data.js'); } catch (err) { Data = null; }
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!Data && root && root.ForSaleData) Data = root.ForSaleData;
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!Data) throw new Error('ForSaleEngine requires data.js');
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('ForSaleEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var START_MONEY = Data.START_MONEY;
  var MIN_PLAYERS = Data.MIN_PLAYERS;
  var MAX_PLAYERS = Data.MAX_PLAYERS;
  var MAX_LOG = 160;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function assertPlayerCount(n) {
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('玩家人数必须是 3–6');
  }
  function pushLog(state, text, data) {
    state.log.push({ turn: state.turn, round: state.round, text: text, data: data || null });
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }
  function totalCash(state, player) {
    return player.money + player.checks.reduce(function (sum, c) { return sum + c; }, 0);
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var playerCount = opts.playerCount == null ? 4 : Number(opts.playerCount);
    assertPlayerCount(playerCount);
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var names = opts.names && opts.names.length === playerCount ? opts.names.slice() : Data.NAMES.slice(0, playerCount);
    var aiFlags = opts.isAI && opts.isAI.length === playerCount ? opts.isAI.slice() : names.map(function (_, i) { return i > 0; });
    var players = [];
    for (var i = 0; i < playerCount; i++) {
      players.push({
        index: i, name: names[i], isAI: !!aiFlags[i],
        money: START_MONEY, props: [], checks: []
      });
    }
    var propertyDeck = ShuffleApi.shuffle(Data.PROPERTY_VALUES.slice(), { seed: String(seed) + ':properties' });
    var chequeDeck = ShuffleApi.shuffle(Data.CHEQUE_VALUES.slice(), { seed: String(seed) + ':cheques' });
    var state = {
      version: VERSION,
      seed: seed,
      playerCount: playerCount,
      players: players,
      propertyDeck: propertyDeck,
      chequeDeck: chequeDeck,
      phase: 'auction',
      round: 0,
      turn: 1,
      auction: null,
      sell: null,
      over: false,
      winners: [],
      winner: null,
      log: [],
      lastAction: null,
      lastAuction: null,
      lastSell: null,
      result: null
    };
    startAuction(state, 0);
    return state;
  }

  function startAuction(state, first) {
    if (!state.propertyDeck.length) { startSell(state); return; }
    var card = state.propertyDeck.pop();
    state.round += 1;
    state.phase = 'auction';
    state.auction = {
      card: card,
      currentBid: -1,
      highBidder: -1,
      turn: first % state.playerCount,
      passed: [],
      bids: state.players.map(function () { return null; })
    };
    state.sell = null;
    state.turn += 1;
    pushLog(state, '第 ' + state.round + ' 场拍卖：房产 ' + card + '，由 ' + state.players[state.auction.turn].name + ' 开叫。');
  }

  function auctionMin(state) {
    return state.auction.highBidder < 0 ? 0 : state.auction.currentBid + 1;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = state.players[state.phase === 'auction' ? state.auction.turn : (state.sell ? state.sell.current : null)];
    if (!player) return [];
    if (state.phase === 'auction') {
      var min = auctionMin(state);
      var moves = [];
      for (var amount = min; amount <= player.money; amount++) {
        moves.push({ type: 'bid', amount: amount });
      }
      if (state.auction.highBidder >= 0) moves.push({ type: 'pass' });
      return moves;
    }
    if (state.phase === 'sell') {
      return player.props.map(function (card) { return { type: 'sell', card: card }; });
    }
    return [];
  }

  function validateMove(state, move) {
    if (!state || state.over) return '对局已结束';
    if (!move || !move.type) return '动作格式不正确';
    var player = state.phase === 'auction' ? state.players[state.auction.turn]
      : state.players[state.sell.current];
    if (state.phase === 'auction') {
      if (move.type === 'bid') {
        var amount = Number(move.amount);
        if (!Number.isInteger(amount)) return '出价必须是整数';
        if (amount < auctionMin(state)) return '出价必须不低于 ' + auctionMin(state);
        if (amount > player.money) return '出价不能超过现金';
        return null;
      }
      if (move.type === 'pass') {
        if (state.auction.highBidder < 0) return '开叫玩家必须出价';
        return null;
      }
      return '动作不合法';
    }
    if (state.phase === 'sell') {
      if (move.type !== 'sell') return '动作不合法';
      if (player.props.indexOf(Number(move.card)) < 0) return '手中没有这张房产';
      return null;
    }
    return '动作不合法';
  }

  function nextAuctionTurn(state, from) {
    for (var step = 1; step <= state.playerCount; step++) {
      var idx = (from + step) % state.playerCount;
      if (state.auction.passed.indexOf(idx) < 0) return idx;
    }
    return -1;
  }

  function resolveAuction(state) {
    var a = state.auction;
    var active = [];
    for (var i = 0; i < state.playerCount; i++) {
      if (a.passed.indexOf(i) < 0) active.push(i);
    }
    var winner = active.length === 1 ? active[0] : a.highBidder;
    var paid = a.currentBid < 0 ? 0 : a.currentBid;
    if (paid > state.players[winner].money) throw new Error('winner cannot pay');
    state.players[winner].money -= paid;
    state.players[winner].props.push(a.card);
    state.lastAuction = {
      round: state.round,
      card: a.card,
      winner: winner,
      winnerName: state.players[winner].name,
      paid: paid,
      bids: a.bids.slice(),
      passed: a.passed.slice()
    };
    pushLog(state, state.players[winner].name + '以 ' + paid + ' 枚金币拍得房产 ' + a.card + '。');
    if (!state.propertyDeck.length) { startSell(state); return; }
    startAuction(state, winner);
  }

  function advanceAuction(state) {
    var active = [];
    for (var i = 0; i < state.playerCount; i++) {
      if (state.auction.passed.indexOf(i) < 0) active.push(i);
    }
    if (active.length <= 1) { resolveAuction(state); return; }
    var next = nextAuctionTurn(state, state.auction.turn);
    state.auction.turn = next;
    state.turn += 1;
  }

  function resolveBid(state, move) {
    var player = state.players[state.auction.turn];
    var amount = Number(move.amount);
    state.auction.currentBid = amount;
    state.auction.highBidder = player.index;
    state.auction.bids[player.index] = amount;
    state.lastAction = { type: 'bid', player: player.index, name: player.name, amount: amount };
    pushLog(state, player.name + '出价 ' + amount + '。');
    advanceAuction(state);
  }

  function resolvePass(state) {
    var player = state.players[state.auction.turn];
    state.auction.passed.push(player.index);
    state.lastAction = { type: 'pass', player: player.index, name: player.name };
    pushLog(state, player.name + '放弃本场拍卖。');
    advanceAuction(state);
  }

  function startSell(state) {
    state.phase = 'sell';
    state.auctionCount = state.round;
    state.round = 0;
    state.auction = null;
    state.sell = {
      round: 0,
      totalRounds: state.players.reduce(function (m, p) { return Math.max(m, p.props.length); }, 0),
      cheques: [],
      sellers: [],
      current: -1,
      picks: state.players.map(function () { return null; }),
      reveal: null
    };
    pushLog(state, '拍卖结束，进入同时出售阶段。');
    prepareSellRound(state);
  }

  function prepareSellRound(state) {
    var sellers = [];
    state.players.forEach(function (p) { if (p.props.length) sellers.push(p.index); });
    if (!sellers.length || !state.chequeDeck.length) { finish(state); return; }
    var count = Math.min(sellers.length, state.chequeDeck.length);
    var cheques = [];
    for (var i = 0; i < count; i++) cheques.push(state.chequeDeck.pop());
    cheques.sort(function (a, b) { return b - a; });
    state.sell.cheques = cheques;
    state.sell.sellers = sellers;
    state.sell.picks = state.players.map(function () { return null; });
    state.sell.reveal = null;
    state.sell.current = sellers[0];
    state.sell.round += 1;
    state.round = state.sell.round;
    state.phase = 'sell';
    state.turn += 1;
    pushLog(state, '出售第 ' + state.sell.round + ' 轮：本轮支票 ' + cheques.join('、') + '。');
  }

  function nextSeller(state, from) {
    for (var step = 1; step <= state.playerCount; step++) {
      var idx = (from + step) % state.playerCount;
      if (state.sell.sellers.indexOf(idx) >= 0 && state.sell.picks[idx] == null) return idx;
    }
    return -1;
  }

  function resolveSell(state) {
    var sellers = state.sell.sellers.slice();
    var picks = state.sell.picks;
    sellers.sort(function (a, b) {
      if (picks[b] !== picks[a]) return picks[b] - picks[a];
      return a - b;
    });
    var cheques = state.sell.cheques.slice().sort(function (a, b) { return b - a; });
    var awarded = [];
    sellers.forEach(function (idx, rank) {
      var cheque = cheques[rank] == null ? 0 : cheques[rank];
      var card = picks[idx];
      state.players[idx].props.splice(state.players[idx].props.indexOf(card), 1);
      state.players[idx].checks.push(cheque);
      awarded.push({ player: idx, card: card, cheque: cheque });
    });
    state.lastSell = {
      round: state.sell.round,
      cheques: state.sell.cheques.slice(),
      picks: picks.slice(),
      awarded: awarded
    };
    state.lastAction = { type: 'sell-resolve', awarded: awarded };
    pushLog(state, '第 ' + state.sell.round + ' 轮出售：' + awarded.map(function (x) {
      return state.players[x.player].name + ' 的 ' + x.card + ' → ' + x.cheque;
    }).join('，') + '。');
    var anyProps = state.players.some(function (p) { return p.props.length; });
    if (!anyProps || !state.chequeDeck.length || state.sell.round >= state.sell.totalRounds) {
      finish(state);
      return;
    }
    prepareSellRound(state);
  }

  function resolveSellPick(state, move) {
    var player = state.players[state.sell.current];
    var card = Number(move.card);
    state.sell.picks[player.index] = card;
    state.lastAction = { type: 'sell-pick', player: player.index, name: player.name };
    pushLog(state, player.name + '选择出售房产 ' + card + '。');
    var next = nextSeller(state, state.sell.current);
    if (next < 0) { resolveSell(state); return; }
    state.sell.current = next;
    state.turn += 1;
  }

  function applyMove(state, move) {
    var error = validateMove(state, move);
    if (error) throw new Error(error);
    var next = clone(state);
    if (next.phase === 'auction') {
      if (move.type === 'bid') resolveBid(next, move);
      else resolvePass(next);
    } else if (next.phase === 'sell') {
      resolveSellPick(next, move);
    }
    return next;
  }

  function finish(state) {
    state.phase = 'over';
    state.over = true;
    state.winner = null;
    state.winners = [];
    var best = -1;
    state.players.forEach(function (p) {
      var total = totalCash(state, p);
      if (total > best) best = total;
    });
    var leaders = state.players.filter(function (p) { return totalCash(state, p) === best; });
    if (leaders.length > 1) {
      var bestMoney = Math.max.apply(null, leaders.map(function (p) { return p.money; }));
      var moneyLeaders = leaders.filter(function (p) { return p.money === bestMoney; });
      leaders = moneyLeaders;
    }
    state.winners = leaders.map(function (p) { return p.index; });
    state.winner = state.winners.length === 1 ? state.winners[0] : -1;
    state.result = makeResult(state);
    pushLog(state, state.winner >= 0
      ? state.players[state.winner].name + '以 $' + totalCash(state, state.players[state.winner]) + ' 获胜！'
      : '最高现金并列，共享胜利。');
  }

  function makeResult(state) {
    return {
      over: state.over,
      winners: state.winners.slice(),
      winner: state.winner,
      shared: state.winners.length > 1,
      rows: state.players.map(function (p) {
        return {
          index: p.index, name: p.name, isAI: p.isAI,
          money: p.money,
          cheques: p.checks.slice(),
          chequeTotal: p.checks.reduce(function (a, b) { return a + b; }, 0),
          total: totalCash(state, p)
        };
      }),
      auctions: state.auctionCount || 0
    };
  }

  function rngFor(state) {
    var seed = (state.seed ^ (state.turn * 2654435761) ^ (state.round * 40503) ^ ((state.auction ? state.auction.turn : 0) * 97)) >>> 0;
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(list, rng) { return list.length ? list[Math.floor(rng() * list.length) % list.length] : null; }

  function chooseAIMove(state) {
    if (!state || state.over) return null;
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var rng = rngFor(state);
    if (state.phase === 'auction') {
      var player = state.players[state.auction.turn];
      var a = state.auction;
      var min = auctionMin(state);
      if (a.highBidder < 0) return { type: 'bid', amount: 0 };
      if (player.money < min) return { type: 'pass' };
      var remaining = state.propertyDeck.length + 1;
      var maxProps = state.players.reduce(function (m, p) { return Math.max(m, p.props.length); }, 0);
      var behind = Math.max(0, maxProps - player.props.length);
      var expectedProps = Math.max(1, Math.ceil(remaining / state.playerCount));
      var budget = player.money / expectedProps;
      var appetite = budget * (0.45 + a.card / 30) * 1.7 + rng() * 1.2 + behind * 0.6;
      var cap = Math.min(player.money, Math.round(appetite));
      if (min <= cap) {
        var raise = min;
        if (min + 1 <= cap && rng() < 0.32) raise = min + 1;
        return { type: 'bid', amount: raise };
      }
      return { type: 'pass' };
    }
    if (state.phase === 'sell') {
      var seller = state.players[state.sell.current];
      var props = seller.props.slice().sort(function (a, b) { return b - a; });
      if (props.length === 1) return { type: 'sell', card: props[0] };
      var topCheque = state.sell.cheques[0] == null ? 0 : state.sell.cheques[0];
      // When the top cheque is rich, spend a strong property; otherwise save
      // the strong card for a later, potentially richer round.
      var card = topCheque >= 10 ? props[0] : props[props.length - 1];
      if (rng() < 0.18) card = pick(props, rng);
      return { type: 'sell', card: card };
    }
    return moves[0];
  }

  function isGameOver(state) { return !!(state && state.over); }
  function getResults(state) { return state ? makeResult(state) : null; }

  function getView(state, seat) {
    if (!state) return null;
    var viewer = seat != null && state.players[seat] ? seat : null;
    var revealCheques = state.over;
    return {
      version: state.version,
      playerCount: state.playerCount,
      phase: state.phase,
      round: state.round,
      auctionCount: state.auctionCount || 0,
      turn: state.turn,
      over: state.over,
      winner: state.winner,
      winners: state.winners ? state.winners.slice() : [],
      deckLeft: state.propertyDeck.length,
      chequeDeckLeft: state.chequeDeck.length,
      auction: state.auction ? {
        card: state.auction.card,
        currentBid: state.auction.currentBid,
        highBidder: state.auction.highBidder,
        turn: state.auction.turn,
        passed: state.auction.passed.slice()
      } : null,
      sell: state.sell ? {
        round: state.sell.round,
        totalRounds: state.sell.totalRounds,
        cheques: state.sell.cheques.slice(),
        sellers: state.sell.sellers.slice(),
        current: state.sell.current,
        picks: state.sell.picks.map(function (pick, i) {
          if (pick == null) return null;
          if (i === viewer || state.over || (state.sell.reveal && state.sell.reveal.picks[i] != null)) return pick;
          return 'hidden';
        }),
        reveal: state.sell.reveal ? clone(state.sell.reveal) : null
      } : null,
      players: state.players.map(function (p) {
        var own = viewer === p.index;
        return {
          index: p.index,
          name: p.name,
          isAI: p.isAI,
          money: p.money,
          props: p.props.slice(),
          propCount: p.props.length,
          checkCount: p.checks.length,
          checks: (own || revealCheques) ? p.checks.slice() : p.checks.map(function () { return 'hidden'; }),
          total: (own || revealCheques) ? totalCash(state, p) : null,
          passed: state.auction ? state.auction.passed.indexOf(p.index) >= 0 : false,
          seller: state.sell ? state.sell.sellers.indexOf(p.index) >= 0 : false,
          picked: state.sell ? state.sell.picks[p.index] != null : false
        };
      }),
      log: state.log.slice(-50),
      lastAction: state.lastAction ? clone(state.lastAction) : null,
      lastAuction: state.lastAuction ? clone(state.lastAuction) : null,
      lastSell: state.lastSell ? clone(state.lastSell) : null,
      result: state.over ? makeResult(state) : null
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    START_MONEY: START_MONEY,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    PROPERTY_VALUES: Data.PROPERTY_VALUES,
    CHEQUE_VALUES: Data.CHEQUE_VALUES,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    getView: getView,
    totalCash: totalCash
  });
}));
