/* For Sale (拍卖) — pure UMD rules engine.
 * Node: require('./engine.js'); browser: window.ForSaleEngine
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForSaleEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var START_MONEY = 18;
  var PLAYER_NAMES = ['你', '小拍卖师', '老精算'];

  // Property values 1..30 (the "0-30" range, 0 used as a legal opening bid).
  var PROPERTY_VALUES = [];
  for (var v = 1; v <= 30; v++) PROPERTY_VALUES.push(v);

  // 30 cheques: 0, 2..15 each twice — mirrors the real deck's shape.
  var CHECK_VALUES = (function () {
    var out = [0, 0];
    for (var c = 2; c <= 15; c++) out.push(c, c);
    return out;
  })();

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function createGame(opts) {
    opts = opts || {};
    var rng = mulberry32(opts.seed == null ? 20261110 : opts.seed);
    var count = opts.players == null ? 3 : opts.players;
    if (count < 2 || count > 5) throw new Error('players must be 2..5');
    var names = opts.names || PLAYER_NAMES;
    var players = [];
    for (var i = 0; i < count; i++) {
      players.push({
        name: names[i] || ('玩家' + (i + 1)),
        human: i === 0,
        money: START_MONEY,
        props: [],
        checks: [],
        cash: START_MONEY
      });
    }
    var state = {
      seed: opts.seed == null ? 20261110 : opts.seed,
      rng: rng,
      players: players,
      propertyDeck: shuffle(PROPERTY_VALUES, rng),
      checkDeck: shuffle(CHECK_VALUES, rng),
      phase: 'auction',
      round: 0,
      totalRounds: PROPERTY_VALUES.length,
      auction: null,
      sell: null,
      log: [],
      winner: null,
      stepCount: 0
    };
    startAuction(state, 0);
    return state;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 40) state.log.shift();
  }

  function activePlayers(state) {
    var a = state.auction;
    return state.players.filter(function (p, i) { return a.passed.indexOf(i) < 0; });
  }

  function startAuction(state, start) {
    if (!state.propertyDeck.length) {
      startSell(state);
      return;
    }
    var card = state.propertyDeck.pop();
    state.round++;
    state.auction = {
      card: card,
      currentBid: -1,
      highBidder: -1,
      turn: start % state.players.length,
      passed: [],
      bids: state.players.map(function () { return null; })
    };
    state.phase = 'auction';
    log(state, '第 ' + state.round + ' 轮：拍卖房产 ' + card);
  }

  function legalBid(state, player) {
    var a = state.auction;
    if (state.phase !== 'auction' || !a) return false;
    if (player !== a.turn || a.passed.indexOf(player) >= 0) return false;
    var min = a.highBidder < 0 ? 0 : a.currentBid + 1;
    return state.players[player].money >= min;
  }

  function maxBid(state, player) {
    return state.players[player].money;
  }

  function bid(state, player, amount) {
    var a = state.auction;
    if (!legalBid(state, player)) throw new Error('illegal bid: wrong turn or passed');
    var min = a.highBidder < 0 ? 0 : a.currentBid + 1;
    if (typeof amount !== 'number' || Math.floor(amount) !== amount) throw new Error('bid must be integer');
    if (amount < min) throw new Error('bid must be >= ' + min);
    if (amount > maxBid(state, player)) throw new Error('bid exceeds cash');
    a.currentBid = amount;
    a.highBidder = player;
    a.bids[player] = amount;
    log(state, state.players[player].name + ' 出价 ' + amount);
    advanceAuction(state);
    return state;
  }

  function legalPass(state, player) {
    var a = state.auction;
    if (state.phase !== 'auction' || !a) return false;
    if (player !== a.turn || a.passed.indexOf(player) >= 0) return false;
    return a.highBidder >= 0;
  }

  function pass(state, player) {
    var a = state.auction;
    if (!legalPass(state, player)) throw new Error('illegal pass: wrong turn or passed');
    if (a.highBidder < 0) throw new Error('opening player must bid');
    a.passed.push(player);
    log(state, state.players[player].name + ' 放弃');
    advanceAuction(state);
    return state;
  }

  function advanceAuction(state) {
    var a = state.auction;
    var active = [];
    for (var i = 0; i < state.players.length; i++) if (a.passed.indexOf(i) < 0) active.push(i);
    if (active.length === 1) {
      var winner = active[0];
      if (a.highBidder < 0) a.highBidder = winner;
      var paid = a.currentBid < 0 ? 0 : a.currentBid;
      if (state.players[winner].money < paid) throw new Error('winner cannot pay');
      state.players[winner].money -= paid;
      state.players[winner].props.push(a.card);
      log(state, state.players[winner].name + ' 以 ' + paid + ' 拍得 ' + a.card);
      if (!state.propertyDeck.length) startSell(state);
      else startAuction(state, winner);
      return;
    }
    var turn = a.turn;
    do {
      turn = (turn + 1) % state.players.length;
    } while (a.passed.indexOf(turn) >= 0);
    a.turn = turn;
  }

  function startSell(state) {
    state.phase = 'sell';
    state.round = 0;
    state.totalRounds = state.players.reduce(function (m, p) { return Math.max(m, p.props.length); }, 0);
    // Cheques are laid out high-to-low; the highest property takes the top one.
    state.checkDeck.sort(function (a, b) { return b - a; });
    state.sell = { picks: state.players.map(function () { return null; }), round: 0, reveal: null };
    log(state, '拍卖结束，进入同时出牌换支票阶段');
    maybeResolveSell(state);
  }

  function legalSellCard(state, player, card) {
    if (state.phase !== 'sell' || !state.sell) return false;
    if (state.sell.picks[player] != null) return false;
    return state.players[player].props.indexOf(card) >= 0;
  }

  function chooseSellCard(state, player, card) {
    if (!legalSellCard(state, player, card)) throw new Error('illegal sell card');
    state.sell.picks[player] = card;
    maybeResolveSell(state);
    return state;
  }

  // Players who ran out of properties simply sit the round out.
  function maybeResolveSell(state) {
    var ready = state.players.every(function (p, i) {
      return p.props.length === 0 || state.sell.picks[i] != null;
    });
    if (ready) resolveSell(state);
  }

  function resolveSell(state) {
    var picks = state.sell.picks;
    var order = [];
    for (var i = 0; i < state.players.length; i++) {
      if (picks[i] != null) order.push(i);
    }
    order.sort(function (a, b) {
      if (picks[b] !== picks[a]) return picks[b] - picks[a];
      return a - b;
    });
    var awarded = [];
    order.forEach(function (idx) {
      var cheque = state.checkDeck.pop();
      state.players[idx].checks.push(cheque);
      state.players[idx].props.splice(state.players[idx].props.indexOf(picks[idx]), 1);
      awarded.push({ player: idx, card: picks[idx], check: cheque });
    });
    state.sell.reveal = { picks: picks.slice(), awarded: awarded };
    state.sell.round++;
    state.round = state.sell.round;
    log(state, '第 ' + state.round + ' 次出牌：' + awarded.map(function (x) {
      return state.players[x.player].name + '[' + x.card + '→' + x.check + ']';
    }).join('，'));
    if (state.sell.round >= state.totalRounds || !state.checkDeck.length ||
      state.players.every(function (p) { return p.props.length === 0; })) finish(state);
    else {
      state.sell.picks = state.players.map(function () { return null; });
      state.sell.reveal = null;
    }
  }

  function totalMoney(state, player) {
    var p = state.players[player];
    return p.money + p.checks.reduce(function (a, b) { return a + b; }, 0);
  }

  function finish(state) {
    state.phase = 'over';
    state.sell = state.sell;
    var best = 0;
    state.players.forEach(function (p, i) {
      if (totalMoney(state, i) > totalMoney(state, best)) best = i;
    });
    state.winner = best;
    log(state, '游戏结束：' + state.players[best].name + ' 以 $' + totalMoney(state, best) + ' 获胜');
  }

  // --- AI -----------------------------------------------------------------

  function aiAuction(state, player) {
    var a = state.auction;
    var p = state.players[player];
    var min = a.highBidder < 0 ? 0 : a.currentBid + 1;
    var card = a.card;
    if (a.highBidder < 0) { bid(state, player, 0); return { type: 'bid', player: player, amount: 0 }; }
    // Property cards converge to 30; bidding later is more valuable. Keep a
    // cash reserve so the AI is not broke for the final lots.
    var remaining = state.propertyDeck.length + 1;
    var reserve = Math.min(6, Math.floor(remaining / 5));
    var appetite = card * 0.85 + 1.5 + state.rng() * 3.5;
    var cap = Math.min(p.money - (remaining > 3 ? reserve : 0), Math.round(appetite));
    if (min <= cap && p.money >= min) {
      var raise = min;
      if (min + 2 <= cap && state.rng() < 0.35) raise = min + 2;
      bid(state, player, raise);
      return { type: 'bid', player: player, amount: raise };
    }
    pass(state, player);
    return { type: 'pass', player: player };
  }

  function aiSellCard(state, player) {
    var p = state.players[player];
    var avail = p.props.slice();
    if (!avail.length) return null;
    // Prefer a strong card but keep some randomness so rounds differ.
    avail.sort(function (a, b) {
      return (b + state.rng() * 3) - (a + state.rng() * 3);
    });
    return avail[0];
  }

  function aiSell(state) {
    var picks = state.sell.picks;
    var me = -1;
    for (var i = 0; i < picks.length; i++) {
      if (picks[i] == null && state.players[i].props.length > 0) { me = i; break; }
    }
    if (me < 0) return null;
    var card = aiSellCard(state, me);
    chooseSellCard(state, me, card);
    return { type: 'sell', player: me, card: card };
  }

  // Advance one automatic step. Returns {needsHuman:true, ...} when index 0
  // must act through bid/pass/chooseSellCard.
  function step(state) {
    if (state.phase === 'over') return { over: true };
    state.stepCount++;
    if (state.stepCount > 5000) throw new Error('step limit: possible loop');
    if (state.phase === 'auction') {
      if (state.auction.turn === 0) return { needsHuman: true, phase: 'auction' };
      return aiAuction(state, state.auction.turn);
    }
    if (state.phase === 'sell') {
      if (state.sell.picks[0] == null && state.players[0].props.length > 0) {
        return { needsHuman: true, phase: 'sell' };
      }
      var acted = null;
      while (state.phase === 'sell') {
        var next = aiSell(state);
        if (!next) break;
        acted = next;
      }
      return acted || { needsHuman: false, phase: 'sell' };
    }
    return { over: true };
  }

  function selfPlay(seed, players) {
    var state = createGame({ seed: seed, players: players || 3 });
    var guard = 0;
    while (state.phase !== 'over') {
      if (++guard > 5000) throw new Error('no progress');
      if (state.phase === 'auction') aiAuction(state, state.auction.turn);
      else if (state.phase === 'sell') aiSell(state);
    }
    return state;
  }

  // Hide other players' pending sell picks and the undrawn deck order.
  function publicView(state, viewer) {
    var sell = null;
    if (state.sell) {
      var picks = state.sell.picks.map(function (p, i) {
        if (p == null) return null;
        if (i === viewer || (state.sell.reveal && state.sell.reveal.picks[i] != null)) return p;
        return 'hidden';
      });
      sell = { picks: picks, round: state.sell.round, reveal: state.sell.reveal };
    }
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      auction: state.auction ? {
        card: state.auction.card,
        currentBid: state.auction.currentBid,
        highBidder: state.auction.highBidder,
        turn: state.auction.turn,
        passed: state.auction.passed.slice()
      } : null,
      sell: sell,
      players: state.players.map(function (p, i) {
        return {
          name: p.name, money: p.money, props: p.props.slice(), checks: p.checks.slice(),
          total: totalMoney(state, i)
        };
      }),
      winner: state.winner,
      log: state.log.slice()
    };
  }

  return {
    createGame: createGame,
    bid: bid,
    pass: pass,
    chooseSellCard: chooseSellCard,
    legalBid: legalBid,
    legalSellCard: legalSellCard,
    totalMoney: totalMoney,
    publicView: publicView,
    step: step,
    aiAuction: aiAuction,
    aiSellCard: aiSellCard,
    selfPlay: selfPlay,
    PROPERTY_VALUES: PROPERTY_VALUES,
    CHECK_VALUES: CHECK_VALUES,
    START_MONEY: START_MONEY,
    mulberry32: mulberry32,
    shuffle: shuffle
  };
});
