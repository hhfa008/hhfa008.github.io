/* Skull (骷髅) — pure 2-player engine (you + AI).
 * Each player has 4 discs (3 flowers, 1 skull). Place face down, bid, then the
 * highest bidder reveals that many flowers; a skull costs a disc.
 * First to 2 points, or last player with discs, wins. UMD for tests/browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkullEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 100) state.log.shift();
  }
  function other(id) { return id === 0 ? 1 : 0; }
  function nameOf(state, id) { return state.players[id].name; }
  function totalPlaced(state) {
    return state.players.reduce(function (n, p) { return n + p.placed.length; }, 0);
  }
  function discCount(p) { return p.hand.length + p.placed.length; }

  function makeDiscs(rng, id) {
    var discs = [];
    for (var i = 0; i < 3; i++) discs.push({ type: 'flower', uid: id + '-' + i });
    discs.push({ type: 'skull', uid: id + '-s' });
    return shuffle(discs, rng);
  }

  function createGame(opts) {
    opts = opts || {};
    var rng = opts.rng || mulberry32(opts.seed == null ? 1 : opts.seed);
    var state = {
      players: [
        { id: 0, name: '你', hand: makeDiscs(rng, 0), placed: [], points: 0, eliminated: false },
        { id: 1, name: 'AI', hand: makeDiscs(rng, 1), placed: [], points: 0, eliminated: false }
      ],
      turn: 0,
      starter: 0,
      round: 1,
      phase: 'place',
      bid: 0,
      bidder: null,
      revealNeed: 0,
      revealed: [],
      winner: null,
      log: [],
      rng: rng,
      seat: 0,
      aiAll: !!opts.aiAll
    };
    log(state, '第 1 回合：先暗放圆片，再下注；翻开骷髅的人要失去一枚圆片。');
    return state;
  }

  function isOver(state) { return state.phase === 'over' || state.winner !== null; }

  function needsHuman(state) {
    if (state.aiAll || isOver(state)) return false;
    return state.turn === state.seat;
  }

  function allowedOwner(state) {
    var bidder = state.players[state.bidder];
    var ownLeft = bidder.placed.some(function (d) { return !d.revealed; });
    return ownLeft ? state.bidder : other(state.bidder);
  }

  function legalActions(state) {
    if (isOver(state)) return [];
    var a = [];
    if (state.phase === 'place') {
      var p = state.players[state.turn];
      p.hand.forEach(function (d, i) { a.push({ type: 'place', index: i }); });
      var n = totalPlaced(state);
      for (var amt = 1; amt <= n; amt++) a.push({ type: 'bid', amount: amt });
    } else if (state.phase === 'bid') {
      var max = totalPlaced(state);
      for (var x = state.bid + 1; x <= max; x++) a.push({ type: 'raise', amount: x });
      if (state.bid > 0) a.push({ type: 'pass' });
    } else if (state.phase === 'reveal') {
      var owner = allowedOwner(state);
      state.players[owner].placed.forEach(function (d, i) {
        if (!d.revealed) a.push({ type: 'reveal', owner: owner, index: i });
      });
    }
    return a;
  }

  function returnDiscs(state) {
    state.players.forEach(function (p) {
      p.hand = p.hand.concat(p.placed);
      p.placed = [];
    });
  }

  function endRound(state, starterId, text) {
    if (isOver(state)) return;
    returnDiscs(state);
    state.phase = 'place';
    state.turn = starterId;
    state.starter = starterId;
    state.bid = 0;
    state.bidder = null;
    state.revealNeed = 0;
    state.revealed = [];
    state.round++;
    if (state.round > 40) {
      var a = state.players[0].points, b = state.players[1].points;
      state.winner = a === b ? -1 : (a > b ? 0 : 1);
      state.phase = 'over';
      log(state, '回合上限到达，按积分判定。');
      return;
    }
    log(state, text + ' 新回合开始，' + nameOf(state, starterId) + '先行动。');
  }

  function checkElimination(state) {
    var alive = state.players.filter(function (p) { return discCount(p) > 0; });
    state.players.forEach(function (p) { p.eliminated = discCount(p) === 0; });
    if (alive.length <= 1) {
      state.winner = alive.length ? alive[0].id : -1;
      state.phase = 'over';
      state.revealed = [];
      log(state, state.winner >= 0 ? nameOf(state, state.winner) + '的对手失去全部圆片，获胜！' : '双方同时出局。');
      return true;
    }
    return false;
  }

  function loseDisc(state, id) {
    var p = state.players[id];
    var pool = p.hand.concat(p.placed);
    var victim = null;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].type === 'flower') { victim = pool[i]; break; }
    }
    if (!victim) victim = pool[0];
    if (!victim) return;
    var at = p.hand.indexOf(victim);
    if (at >= 0) p.hand.splice(at, 1);
    else {
      at = p.placed.indexOf(victim);
      if (at >= 0) p.placed.splice(at, 1);
    }
    log(state, nameOf(state, id) + '失去一枚圆片（剩余 ' + discCount(p) + ' 枚）。');
    checkElimination(state);
  }

  function beginReveal(state) {
    state.phase = 'reveal';
    state.turn = state.bidder;
    state.revealNeed = state.bid;
    state.revealed = [];
    log(state, nameOf(state, state.bidder) + '以 ' + state.bid + ' 注成为最高出价者，开始翻片。');
  }

  function applyAction(state, action) {
    if (!action || isOver(state)) return { ok: false, error: '对局已结束' };
    if (state.phase === 'place') {
      if (action.type === 'place') {
        var p = state.players[state.turn];
        if (!Number.isInteger(action.index) || !p.hand[action.index]) return { ok: false, error: '无效的圆片' };
        var disc = p.hand.splice(action.index, 1)[0];
        p.placed.push({ type: disc.type, uid: disc.uid, revealed: false });
        log(state, nameOf(state, state.turn) + '暗放了一枚圆片。');
        state.turn = other(state.turn);
        if (state.players[0].hand.length === 0 && state.players[1].hand.length === 0) {
          state.phase = 'bid';
          state.turn = state.starter;
          state.bid = 0;
          state.bidder = null;
          log(state, '所有圆片已放好，开始下注。');
        }
        return { ok: true };
      }
      if (action.type === 'bid') {
        var max = totalPlaced(state);
        if (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > max) {
          return { ok: false, error: '下注必须为 1 到 ' + max };
        }
        state.phase = 'bid';
        state.bid = action.amount;
        state.bidder = state.turn;
        log(state, nameOf(state, state.turn) + '下注 ' + action.amount + '。');
        state.turn = other(state.turn);
        return { ok: true };
      }
      return { ok: false, error: '请放置圆片或下注' };
    }
    if (state.phase === 'bid') {
      if (action.type === 'raise') {
        var top = totalPlaced(state);
        if (!Number.isInteger(action.amount) || action.amount <= state.bid || action.amount > top) {
          return { ok: false, error: '加注必须高于当前注且不超过 ' + top };
        }
        state.bid = action.amount;
        state.bidder = state.turn;
        log(state, nameOf(state, state.turn) + '加注到 ' + action.amount + '。');
        state.turn = other(state.turn);
        return { ok: true };
      }
      if (action.type === 'pass') {
        if (state.bid <= 0) return { ok: false, error: '当前没有注可放弃' };
        log(state, nameOf(state, state.turn) + '放弃加注。');
        beginReveal(state);
        return { ok: true };
      }
      return { ok: false, error: '请加注或放弃' };
    }
    if (state.phase === 'reveal') {
      if (action.type !== 'reveal') return { ok: false, error: '请翻开圆片' };
      var owner = allowedOwner(state);
      if (action.owner !== owner) return { ok: false, error: '必须先翻自己的圆片，再翻对手的' };
      var target = state.players[owner];
      var d = target.placed[action.index];
      if (!d || d.revealed) return { ok: false, error: '该圆片已翻开或不存在' };
      d.revealed = true;
      state.revealed.push({ owner: owner, index: action.index, type: d.type });
      state.revealNeed--;
      if (d.type === 'skull') {
        log(state, '翻到骷髅！' + nameOf(state, state.bidder) + '挑战失败。');
        var bidder = state.bidder;
        loseDisc(state, bidder);
        if (checkElimination(state)) return { ok: true };
        endRound(state, bidder, nameOf(state, bidder) + '输掉本回合。');
        return { ok: true };
      }
      log(state, '翻到一枚花朵（还需 ' + state.revealNeed + ' 枚）。');
      if (state.revealNeed === 0) {
        var winner = state.bidder;
        state.players[winner].points++;
        log(state, nameOf(state, winner) + '成功翻出 ' + state.bid + ' 枚花朵，得 1 分。');
        if (state.players[winner].points >= 2) {
          state.winner = winner;
          state.phase = 'over';
          log(state, nameOf(state, winner) + '率先获得 2 分，获胜！');
          return { ok: true };
        }
        var next = other(winner);
        endRound(state, next, nameOf(state, winner) + '赢下本回合。');
      }
      return { ok: true };
    }
    return { ok: false, error: '当前不能行动' };
  }

  function aiAction(state) {
    if (isOver(state)) return null;
    var p = state.players[state.turn];
    if (state.phase === 'place') {
      var n = totalPlaced(state);
      var flowers = p.hand.filter(function (d) { return d.type === 'flower'; }).length;
      if (p.hand.length === 0) {
        var forced = p.placed.filter(function (d) { return d.type === 'flower'; }).length;
        var need = forced + (n - p.placed.length) * 0.75;
        var bidAmt = Math.max(1, Math.min(n, Math.round(need * (0.75 + state.rng() * 0.4))));
        return { type: 'bid', amount: bidAmt };
      }
      var wantBid = n >= 2 && (n >= 5 || state.rng() < 0.5);
      if (wantBid) {
        var flowersPlaced = p.placed.filter(function (d) { return d.type === 'flower'; }).length;
        var expected = flowersPlaced + (n - p.placed.length) * 0.75;
        var amount = Math.max(1, Math.min(n, Math.round(expected * (0.75 + state.rng() * 0.4))));
        if (state.rng() < 0.25) amount = Math.max(1, amount - 1);
        return { type: 'bid', amount: amount };
      }
      var idx = state.rng() < 0.8 ? p.hand.findIndex(function (d) { return d.type === 'flower'; }) : -1;
      if (idx < 0) idx = Math.floor(state.rng() * p.hand.length);
      return { type: 'place', index: idx };
    }
    if (state.phase === 'bid') {
      var max = totalPlaced(state);
      if (state.bid >= max) return { type: 'pass' };
      var mine = p.placed.filter(function (d) { return d.type === 'flower'; }).length;
      var oppPlaced = state.players[other(state.turn)].placed.length;
      var estimate = mine + oppPlaced * 0.75;
      var target = Math.max(state.bid + 1, Math.min(max, Math.round(estimate)));
      var raiseChance = target > state.bid ? 0.62 : 0.1;
      if (state.bid === 0 || state.rng() < raiseChance) return { type: 'raise', amount: target };
      return { type: 'pass' };
    }
    if (state.phase === 'reveal') {
      var owner = allowedOwner(state);
      var opts = [];
      state.players[owner].placed.forEach(function (d, i) { if (!d.revealed) opts.push(i); });
      if (!opts.length) return null;
      return { type: 'reveal', owner: owner, index: opts[Math.floor(state.rng() * opts.length)] };
    }
    return null;
  }

  function autoRun(state, limit) {
    var n = 0;
    limit = limit || 1000;
    while (!isOver(state) && !needsHuman(state) && n++ < limit) {
      var a = aiAction(state);
      if (!a) break;
      var r = applyAction(state, a);
      if (!r.ok) break;
    }
    return n;
  }

  function viewFor(state, seat) {
    return {
      seat: seat,
      turn: state.turn,
      starter: state.starter,
      round: state.round,
      phase: state.phase,
      bid: state.bid,
      bidder: state.bidder,
      revealNeed: state.revealNeed,
      revealed: state.revealed.map(function (r) { return { owner: r.owner, type: r.type }; }),
      winner: state.winner,
      log: state.log.slice(),
      players: state.players.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          points: p.points,
          eliminated: p.eliminated,
          handCount: p.hand.length,
          hand: p.hand.map(function (d) { return p.id === seat ? d.type : 'hidden'; }),
          placed: p.placed.map(function (d) {
            var visible = d.revealed || p.id === seat;
            return { type: visible ? d.type : 'hidden', revealed: d.revealed };
          })
        };
      })
    };
  }

  return {
    createGame: createGame,
    viewFor: viewFor,
    needsHuman: needsHuman,
    legalActions: legalActions,
    aiAction: aiAction,
    applyAction: applyAction,
    autoRun: autoRun,
    isOver: isOver,
    allowedOwner: allowedOwner
  };
}));
