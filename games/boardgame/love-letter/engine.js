/* Love Letter (情书) — pure 2-player engine (you + AI).
 * 16-card deck, draw one / play one, Guard, Priest, Baron, Handmaid, Prince,
 * King, Countess, Princess. UMD for node tests and browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LoveLetterEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CARDS = [
    { id: 1, name: '卫兵', count: 5, text: '猜对手手牌（不能猜卫兵），猜中则对手出局。' },
    { id: 2, name: '神父', count: 2, text: '查看对手手牌。' },
    { id: 3, name: '男爵', count: 2, text: '与对手比较手牌，点数低者出局。' },
    { id: 4, name: '侍女', count: 2, text: '保护自己，直到你的下个回合。' },
    { id: 5, name: '王子', count: 2, text: '指定一名玩家弃掉手牌并补一张。' },
    { id: 6, name: '国王', count: 1, text: '与对手交换手牌。' },
    { id: 7, name: '女伯爵', count: 1, text: '若手中同时有国王或王子，必须打出女伯爵。' },
    { id: 8, name: '公主', count: 1, text: '弃掉公主的玩家立即出局。' }
  ];
  var BY_ID = {};
  CARDS.forEach(function (c) { BY_ID[c.id] = c; });

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
    if (state.log.length > 80) state.log.shift();
  }
  function nameOf(state, id) { return state.players[id].name; }
  function otherOf(id) { return id === 0 ? 1 : 0; }
  function value(state, id) {
    var p = state.players[id];
    return p.hand.length ? p.hand[0] : 0;
  }
  function discardSum(p) {
    return p.discard.reduce(function (n, id) { return n + id; }, 0);
  }

  function createGame(opts) {
    opts = opts || {};
    var rng = opts.rng || mulberry32(opts.seed == null ? 1 : opts.seed);
    var deck = [];
    CARDS.forEach(function (c) {
      for (var i = 0; i < c.count; i++) deck.push(c.id);
    });
    shuffle(deck, rng);
    var burn = deck.pop();
    var players = [
      { id: 0, name: '你', hand: [deck.pop()], discard: [], protected: false, out: false },
      { id: 1, name: 'AI', hand: [deck.pop()], discard: [], protected: false, out: false }
    ];
    var state = {
      players: players,
      deck: deck,
      burn: burn,
      turn: 0,
      phase: 'play',
      winner: null,
      log: [],
      known: { 0: {}, 1: {} },
      rng: rng,
      seat: 0,
      aiAll: !!opts.aiAll
    };
    log(state, '新对局：16 张角色牌，25 张里只有 8 种角色；抽 1 打 1。');
    startTurn(state);
    return state;
  }

  function isOver(state) { return state.phase === 'over' || state.winner !== null; }

  function checkEnd(state) {
    var alive = state.players.filter(function (p) { return !p.out; });
    if (alive.length <= 1) {
      state.winner = alive.length ? alive[0].id : -1;
      state.phase = 'over';
      log(state, state.winner >= 0 ? nameOf(state, state.winner) + '获胜！' : '平局。');
      return true;
    }
    return false;
  }

  function eliminate(state, id, reason) {
    var p = state.players[id];
    if (p.out) return;
    p.out = true;
    p.hand.forEach(function (c) { p.discard.push(c); });
    p.hand = [];
    log(state, nameOf(state, id) + '出局（' + reason + '）。');
  }

  function startTurn(state) {
    if (checkEnd(state)) return;
    var p = state.players[state.turn];
    p.protected = false;
    if (!state.deck.length) {
      endByCompare(state);
      return;
    }
    p.hand.push(state.deck.pop());
    p.hand.sort(function (a, b) { return a - b; });
    state.phase = 'play';
    log(state, '轮到' + nameOf(state, state.turn) + '，抽一张牌。');
  }

  function endByCompare(state) {
    var a = value(state, 0), b = value(state, 1);
    var win;
    if (a !== b) win = a > b ? 0 : 1;
    else {
      var da = discardSum(state.players[0]), db = discardSum(state.players[1]);
      win = da === db ? -1 : (da > db ? 0 : 1);
    }
    state.winner = win;
    state.phase = 'over';
    log(state, '牌堆已空，比拼手牌：' + a + ' 对 ' + b + '。');
    if (win >= 0) log(state, nameOf(state, win) + '获胜！');
    else log(state, '平局。');
  }

  function nextPlayer(state) {
    if (checkEnd(state)) return;
    state.turn = otherOf(state.turn);
    startTurn(state);
  }

  function countessForced(p) {
    return p.hand.indexOf(7) >= 0 && (p.hand.indexOf(6) >= 0 || p.hand.indexOf(5) >= 0);
  }

  function legalActions(state) {
    if (isOver(state) || state.phase !== 'play') return [];
    var p = state.players[state.turn];
    var opp = otherOf(state.turn);
    var forced = countessForced(p);
    var actions = [];
    p.hand.forEach(function (card) {
      if (forced && card !== 7) return;
      if (card === 1) {
        for (var g = 2; g <= 8; g++) actions.push({ type: 'play', card: 1, target: opp, guess: g });
      } else if (card === 2 || card === 3 || card === 6) {
        actions.push({ type: 'play', card: card, target: opp });
      } else if (card === 5) {
        actions.push({ type: 'play', card: 5, target: opp });
        actions.push({ type: 'play', card: 5, target: state.turn });
      } else {
        actions.push({ type: 'play', card: card });
      }
    });
    return actions;
  }

  function applyAction(state, action) {
    if (!action || isOver(state)) return { ok: false, error: '对局已结束' };
    if (state.phase !== 'play') return { ok: false, error: '当前不能出牌' };
    var p = state.players[state.turn];
    var idx = p.hand.indexOf(action.card);
    if (idx < 0) return { ok: false, error: '手中没有这张牌' };
    if (countessForced(p) && action.card !== 7) return { ok: false, error: '有女伯爵时必须打出女伯爵' };
    var opp = otherOf(state.turn);
    if ([1, 2, 3, 6].indexOf(action.card) >= 0 && action.target !== opp) {
      return { ok: false, error: '该牌需要选择对手' };
    }
    if (action.card === 5 && action.target !== opp && action.target !== state.turn) {
      return { ok: false, error: '王子的目标不合法' };
    }
    if (action.card === 1 && (!Number.isInteger(action.guess) || action.guess < 2 || action.guess > 8)) {
      return { ok: false, error: '卫兵只能猜 2–8' };
    }
    p.hand.splice(idx, 1);
    var me = state.turn;
    var target = action.target;
    log(state, nameOf(state, me) + '打出「' + BY_ID[action.card].name + '」' +
      (target != null ? '，目标 ' + nameOf(state, target) : '') + '。');

    if (action.card === 1) {
      if (state.players[target].protected) log(state, nameOf(state, target) + '受侍女保护，无效。');
      else if (state.players[target].hand[0] === action.guess) {
        eliminate(state, target, '被卫兵猜中');
      } else log(state, '猜错了。');
    } else if (action.card === 2) {
      if (state.players[target].protected) log(state, nameOf(state, target) + '受侍女保护，无效。');
      else {
        state.known[me][target] = state.players[target].hand[0];
        log(state, nameOf(state, me) + '看到' + nameOf(state, target) + '的手牌。');
      }
    } else if (action.card === 3) {
      if (state.players[target].protected) log(state, nameOf(state, target) + '受侍女保护，无效。');
      else {
        var mine = value(state, me), theirs = value(state, target);
        log(state, '男爵比较：' + mine + ' 对 ' + theirs + '。');
        if (mine < theirs) eliminate(state, me, '男爵落败');
        else if (theirs < mine) eliminate(state, target, '男爵落败');
        else log(state, '平手，无人出局。');
      }
    } else if (action.card === 4) {
      p.protected = true;
      log(state, nameOf(state, me) + '进入侍女保护。');
    } else if (action.card === 5) {
      var tp = state.players[target];
      if (target !== me && tp.protected) {
        log(state, nameOf(state, target) + '受侍女保护，无效。');
      } else if (tp.hand.length) {
        var dropped = tp.hand.shift();
        tp.discard.push(dropped);
        log(state, nameOf(state, target) + '弃掉手牌。');
        if (dropped === 8) eliminate(state, target, '弃掉公主');
        else if (state.deck.length) tp.hand.push(state.deck.pop());
        else log(state, '牌堆已空，无法补牌。');
      }
    } else if (action.card === 6) {
      if (state.players[target].protected) log(state, nameOf(state, target) + '受侍女保护，无效。');
      else {
        var tmp = p.hand;
        p.hand = state.players[target].hand;
        state.players[target].hand = tmp;
        log(state, '双方交换手牌。');
      }
    } else if (action.card === 7) {
      log(state, '女伯爵没有额外效果。');
    } else if (action.card === 8) {
      eliminate(state, me, '打出公主');
    }

    if (!checkEnd(state)) {
      if (!p.out) p.discard.push(action.card);
      else p.discard.push(action.card);
      nextPlayer(state);
    } else {
      p.discard.push(action.card);
    }
    return { ok: true };
  }

  function aiAction(state) {
    if (isOver(state)) return null;
    var acts = legalActions(state);
    if (!acts.length) return null;
    var me = state.turn;
    var p = state.players[me];
    var opp = otherOf(me);
    var knownOpp = state.known[me][opp];
    var myOther = p.hand.filter(function (c, i) {
      return !(acts[0] && acts[0].card === c && i === p.hand.indexOf(c));
    });

    function pick(card, target, guess) {
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        if (a.card === card && (target == null || a.target === target) &&
          (guess == null || a.guess === guess)) return a;
      }
      return null;
    }

    var forced = countessForced(p);
    if (forced) return pick(7);
    var myCards = p.hand.slice();
    // Guard: use known information if possible.
    if (myCards.indexOf(1) >= 0) {
      if (knownOpp && knownOpp !== 1) return pick(1, opp, knownOpp);
      var pool = [2, 3, 4, 5, 6, 7, 8];
      return pick(1, opp, pool[Math.floor(state.rng() * pool.length)]);
    }
    // Baron when own remaining card is high.
    if (myCards.indexOf(3) >= 0) {
      var keep = myCards.filter(function (c) { return c !== 3; })[0];
      if (keep >= 5) return pick(3, opp);
    }
    // Prince the opponent, unless protected.
    if (myCards.indexOf(5) >= 0) {
      var target = state.players[opp].protected ? me : opp;
      if (target === me) {
        var otherCard = myCards.filter(function (c) { return c !== 5; })[0];
        if (otherCard === 8) target = opp;
      }
      return pick(5, target);
    }
    // King when own card is low.
    if (myCards.indexOf(6) >= 0) {
      var own = myCards.filter(function (c) { return c !== 6; })[0];
      if (own <= 3) return pick(6, opp);
    }
    // Priest for information.
    if (myCards.indexOf(2) >= 0 && !knownOpp) return pick(2, opp);
    // Handmaid defensively.
    if (myCards.indexOf(4) >= 0) return pick(4);
    // Prefer any non-Princess play.
    var safe = acts.filter(function (a) { return a.card !== 8; });
    if (safe.length) {
      var best = safe[0];
      safe.forEach(function (a) { if (a.card > best.card && a.card !== 7) best = a; });
      return best;
    }
    return acts[0];
  }

  function autoRun(state, limit) {
    var n = 0;
    limit = limit || 500;
    while (!isOver(state) && !needsHuman(state) && n++ < limit) {
      var a = aiAction(state);
      if (!a) break;
      var r = applyAction(state, a);
      if (!r.ok) break;
    }
    return n;
  }

  function needsHuman(state) {
    if (state.aiAll || isOver(state)) return false;
    return state.turn === state.seat && state.phase === 'play';
  }

  function viewFor(state, seat) {
    return {
      seat: seat,
      aiAll: state.aiAll,
      turn: state.turn,
      phase: state.phase,
      winner: state.winner,
      deckLeft: state.deck.length,
      log: state.log.slice(),
      known: JSON.parse(JSON.stringify(state.known[seat] || {})),
      players: state.players.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          out: p.out,
          protected: p.protected,
          discard: p.discard.slice(),
          hand: p.hand.map(function (c) {
            if (p.id === seat) return c;
            var known = state.known[seat] && state.known[seat][p.id];
            return (known === c || isOver(state)) ? c : 'hidden';
          })
        };
      })
    };
  }

  return {
    CARDS: CARDS,
    CARD_BY_ID: BY_ID,
    createGame: createGame,
    viewFor: viewFor,
    needsHuman: needsHuman,
    legalActions: legalActions,
    aiAction: aiAction,
    applyAction: applyAction,
    autoRun: autoRun,
    isOver: isOver
  };
}));
