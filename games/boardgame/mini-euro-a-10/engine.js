/*
 * 原创极简德式桌游引擎 — UMD
 * 浏览器：<script src="engine.js"></script> 后使用 globalThis.MiniEuroEngine
 * Node：  const Engine = require('./engine.js')
 *
 * 纯规则引擎：不依赖 DOM；applyMove 返回全新 state，不修改入参；
 * 随机性只来自 createGame(seed)，AI 确定，便于测试与复现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEuroEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CONFIG = {
  "slug": "mini-euro-a-10",
  "title": "遗物密窖",
  "en": "RELIC VAULT",
  "mode": "auction",
  "res": [],
  "startCoins": 22,
  "accent": "#b08fc9",
  "tagline": "尘封密窖开启，十件遗物依次落槌。",
  "flavor": "遗物分数跨度大，宁可漏掉中段，也不要为一件普通遗物透支。",
  "lots": [
    {
      "name": "星尘沙漏",
      "points": 5
    },
    {
      "name": "龙鳞残片",
      "points": 6
    },
    {
      "name": "符文石",
      "points": 6
    },
    {
      "name": "深海珍珠",
      "points": 7
    },
    {
      "name": "古代齿轮",
      "points": 8
    },
    {
      "name": "银月吊坠",
      "points": 9
    },
    {
      "name": "凤凰羽",
      "points": 10
    },
    {
      "name": "虚空棱镜",
      "points": 11
    },
    {
      "name": "王冠碎片",
      "points": 13
    },
    {
      "name": "不朽之心",
      "points": 15
    }
  ]
};
  var MODE = CONFIG.mode;
  var RES = CONFIG.res || [];
  var WPR = CONFIG.workersPerRound || 3;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rngFactory(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function next(st) {
    st.rngState = (st.rngState + 0x6D2B79F5) | 0;
    var t = st.rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(arr, rng) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }
  function log(st, msg) {
    st.log.push(String(msg));
    while (st.log.length > 40) st.log.shift();
  }
  function resText(arr) {
    var parts = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i]) parts.push(arr[i] + RES[i].n);
    }
    return parts.join(' + ') || '无';
  }
  function resValue(arr) {
    var v = 0;
    for (var i = 0; i < arr.length; i++) v += (arr[i] || 0) * (i + 1);
    return v;
  }
  function affordable(p, need) {
    for (var i = 0; i < need.length; i++) if ((p.res[i] || 0) < need[i]) return false;
    return true;
  }
  function pay(p, need) {
    for (var i = 0; i < need.length; i++) p.res[i] -= need[i];
  }
  function earn(p, gain) {
    for (var i = 0; i < gain.length; i++) p.res[i] = (p.res[i] || 0) + gain[i];
  }
  function makePlayers() {
    return [0, 1].map(function (i) {
      var p = {
        name: i === 0 ? '你' : 'AI',
        score: 0,
        coins: CONFIG.startCoins || 0,
        res: RES.map(function () { return 0; }),
        hand: [],
        workers: 0
      };
      if (CONFIG.mode === 'market') {
        p.inv = (CONFIG.goods || []).map(function () { return 0; });
      }
      return p;
    });
  }

  function drawOrders(st, rng) {
    var deck = shuffle(CONFIG.orders.map(function (o, i) {
      return { name: o.name, need: o.need.slice(), points: o.points, coins: o.coins || 0, id: i };
    }), rng);
    return deck;
  }

  function createGame(seed) {
    seed = seed == null ? 1 : (seed >>> 0);
    var rng = rngFactory(seed);
    var st = {
      slug: CONFIG.slug,
      mode: MODE,
      seed: seed,
      rngState: seed || 1,
      turn: 0,
      round: 1,
      plies: 0,
      actions: [0, 0],
      roundActions: [0, 0],
      over: false,
      winner: -1,
      players: makePlayers(),
      log: []
    };
    log(st, '开局：' + CONFIG.title + '。你先行。');

    if (MODE === 'convert') {
      st.recipes = CONFIG.recipes;
      st.orderDeck = drawOrders(st, rng);
      st.orders = st.orderDeck.splice(0, 3);
    } else if (MODE === 'orders') {
      st.recipes = CONFIG.recipes;
      st.orderDeck = drawOrders(st, rng);
      st.orderMarket = st.orderDeck.splice(0, 3);
    } else if (MODE === 'worker') {
      st.players.forEach(function (p) { p.workers = WPR; });
      st.spots = CONFIG.spots.map(function (s) {
        return { id: s.id, name: s.name, desc: s.desc, effect: clone(s.effect), taken: null };
      });
      st.round = 1;
      log(st, '共 ' + CONFIG.rounds + ' 轮，每轮每个工位只能派一名工人。');
    } else if (MODE === 'auction') {
      st.players.forEach(function (p) { p.coins = CONFIG.startCoins; });
      st.lots = shuffle(CONFIG.lots.map(function (l) { return { name: l.name, points: l.points }; }), rng);
      st.lotIndex = 0;
      st.currentLot = st.lots[0];
      st.round = 1;
      log(st, '共 ' + st.lots.length + ' 件拍品，密封出价，同价你优先。');
    } else if (MODE === 'market') {
      st.goods = CONFIG.goods.map(function (g) { return { name: g.n, price: g.price, base: g.price }; });
      st.players.forEach(function (p) {
        p.coins = CONFIG.startCoins;
        p.inv = st.goods.map(function () { return 0; });
      });
      log(st, '市场开市，双方各行动 ' + CONFIG.actions + ' 次。');
    }
    return st;
  }

  function getLegalMoves(st) {
    if (!st || st.over) return [];
    var p = st.players[st.turn];
    var moves = [];
    var i;
    if (MODE === 'convert' || MODE === 'orders') {
      if (MODE === 'orders') {
        RES.forEach(function (r, idx) {
          moves.push({ type: 'gather', res: idx, key: 'g' + idx, label: '采集 ' + r.n, hint: '+2 ' + r.n });
        });
      } else {
        RES.forEach(function (r, idx) {
          moves.push({ type: 'harvest', res: idx, key: 'h' + idx, label: '采集 ' + r.n, hint: '+2 ' + r.n });
        });
      }
      CONFIG.recipes.forEach(function (r, idx) {
        if (!affordable(p, r.in)) return;
        moves.push({
          type: 'convert', index: idx, key: 'c' + idx,
          label: '转化：' + resText(r.in) + ' → ' + resText(r.out),
          hint: '配方 ' + (idx + 1)
        });
      });
      if (MODE === 'convert') {
        st.orders.forEach(function (o, idx) {
          if (!affordable(p, o.need)) return;
          moves.push({
            type: 'fulfill', index: idx, key: 'f' + idx,
            label: '交付：' + o.name,
            hint: '+' + o.points + ' 分 · +' + o.coins + ' 币'
          });
        });
      } else {
        if (p.hand.length < 3) {
          st.orderMarket.forEach(function (o, idx) {
            moves.push({ type: 'take', index: idx, key: 't' + idx, label: '接单：' + o.name, hint: '放入手牌（上限 3）' });
          });
        }
        p.hand.forEach(function (o, idx) {
          if (!affordable(p, o.need)) return;
          moves.push({
            type: 'deliver', index: idx, key: 'd' + idx,
            label: '交付手牌：' + o.name,
            hint: '+' + o.points + ' 分 · +' + o.coins + ' 币'
          });
        });
      }
    } else if (MODE === 'worker') {
      if (p.workers <= 0) return moves;
      st.spots.forEach(function (s) {
        if (s.taken !== null) return;
        if (s.effect.convert && !affordable(p, s.effect.convert.cost)) return;
        moves.push({ type: 'place', spot: s.id, key: 'p' + s.id, label: '派遣：' + s.name, hint: s.desc });
      });
      moves.push({ type: 'rest', key: 'rest', label: '休整', hint: '+1 金币' });
    } else if (MODE === 'auction') {
      for (var b = 0; b <= p.coins; b++) {
        moves.push({
          type: 'bid', amount: b, key: 'b' + b,
          label: b === 0 ? '放弃本件' : '出价 ' + b,
          hint: b === 0 ? '保留银币' : '现有 ' + p.coins + ' 银币'
        });
      }
    } else if (MODE === 'market') {
      st.goods.forEach(function (g, idx) {
        if (p.coins >= g.price) {
          moves.push({ type: 'buy', index: idx, key: 'B' + idx, label: '买入 ' + g.name, hint: '支付 ' + g.price + ' 币' });
        }
        if ((p.inv[idx] || 0) > 0) {
          moves.push({ type: 'sell', index: idx, key: 'S' + idx, label: '卖出 ' + g.name, hint: '获得 ' + g.price + ' 币' });
        }
      });
      moves.push({ type: 'pass', key: 'P', label: '观望', hint: '+1 金币' });
    }
    return moves;
  }

  function findMove(st, move) {
    if (!move || typeof move.key !== 'string') return null;
    var legal = getLegalMoves(st);
    for (var i = 0; i < legal.length; i++) if (legal[i].key === move.key) return legal[i];
    return null;
  }

  function finish(st) {
    if (st.over) return;
    if (MODE === 'convert' || MODE === 'orders') {
      st.players.forEach(function (p) { p.score += p.coins; });
    } else if (MODE === 'worker') {
      st.players.forEach(function (p) {
        p.score += Math.floor(p.res.reduce(function (a, b) { return a + b; }, 0) / 2);
      });
    } else if (MODE === 'auction') {
      st.players.forEach(function (p) { p.score += p.coins; });
    } else if (MODE === 'market') {
      st.players.forEach(function (p) {
        var total = p.coins;
        for (var i = 0; i < st.goods.length; i++) total += (p.inv[i] || 0) * st.goods[i].price;
        p.score = total;
      });
    }
    st.over = true;
    var a = st.players[0].score, b = st.players[1].score;
    st.winner = a === b ? -1 : (a > b ? 0 : 1);
    log(st, '终局结算：你 ' + a + ' 分，AI ' + b + ' 分。' + (st.winner === -1 ? '平局。' : (st.winner === 0 ? '你获胜！' : 'AI 获胜。')));
  }

  function endTurn(st, actor) {
    st.plies += 1;
    st.actions[actor] += 1;
    st.roundActions[actor] += 1;
    st.turn = 1 - actor;
    if (MODE === 'worker') {
      if (st.roundActions[0] >= WPR && st.roundActions[1] >= WPR) {
        st.round += 1;
        if (st.round > CONFIG.rounds) {
          finish(st);
        } else {
          st.spots.forEach(function (s) { s.taken = null; });
          st.roundActions = [0, 0];
          st.players.forEach(function (p) { p.workers = WPR; });
          st.turn = 0;
          log(st, '第 ' + st.round + ' 轮开始，工位刷新。');
        }
      }
    } else if (st.actions[0] >= CONFIG.actions && st.actions[1] >= CONFIG.actions) {
      finish(st);
    }
  }

  function driftMarket(st) {
    st.goods.forEach(function (g) {
      if (next(st) < 0.32) {
        g.price = clamp(g.price + (next(st) < 0.5 ? -1 : 1), 2, 12);
      }
    });
  }

  function applyMove(oldState, move) {
    if (!oldState || oldState.over) throw new Error('对局已结束，不能继续行动');
    var chosen = findMove(oldState, move);
    if (!chosen) throw new Error('非法行动：' + (move && move.key));
    var st = clone(oldState);
    var actor = st.turn;
    var p = st.players[actor];
    var i, o, s;

    if (MODE === 'convert' || MODE === 'orders') {
      if (chosen.type === 'harvest' || chosen.type === 'gather') {
        p.res[chosen.res] += 2;
        log(st, p.name + ' 采集 ' + RES[chosen.res].n + ' +2。');
      } else if (chosen.type === 'convert') {
        var r = CONFIG.recipes[chosen.index];
        pay(p, r.in); earn(p, r.out);
        log(st, p.name + ' 转化 ' + resText(r.in) + ' → ' + resText(r.out) + '。');
      } else if (chosen.type === 'fulfill') {
        o = st.orders[chosen.index];
        pay(p, o.need); p.score += o.points; p.coins += o.coins;
        st.orders.splice(chosen.index, 1);
        if (st.orderDeck.length) st.orders.push(st.orderDeck.shift());
        log(st, p.name + ' 交付「' + o.name + '」，+' + o.points + ' 分，+' + o.coins + ' 币。');
      } else if (chosen.type === 'take') {
        o = st.orderMarket.splice(chosen.index, 1)[0];
        p.hand.push(o);
        if (st.orderDeck.length) st.orderMarket.push(st.orderDeck.shift());
        log(st, p.name + ' 接下订单「' + o.name + '」。');
      } else if (chosen.type === 'deliver') {
        o = p.hand.splice(chosen.index, 1)[0];
        pay(p, o.need); p.score += o.points; p.coins += o.coins;
        log(st, p.name + ' 交付手牌「' + o.name + '」，+' + o.points + ' 分，+' + o.coins + ' 币。');
      }
      endTurn(st, actor);
    } else if (MODE === 'worker') {
      if (chosen.type === 'rest') {
        p.coins += 1;
        p.workers -= 1;
        log(st, p.name + ' 选择休整，获得 1 金币。');
        endTurn(st, actor);
      } else {
        s = null;
        for (i = 0; i < st.spots.length; i++) if (st.spots[i].id === chosen.spot) s = st.spots[i];
        var e = s.effect;
        if (e.convert) { pay(p, e.convert.cost); earn(p, e.convert.gain); }
        if (e.gain) earn(p, e.gain);
        if (e.coins) p.coins += e.coins;
        if (e.points) p.score += e.points;
        s.taken = actor;
        p.workers -= 1;
        log(st, p.name + ' 派遣至「' + s.name + '」：' + s.desc + '。');
        endTurn(st, actor);
      }
    } else if (MODE === 'auction') {
      var playerBid = chosen.amount;
      var aiP = st.players[1];
      var aiBid = Math.floor(st.currentLot.points * (0.45 + next(st) * 0.5));
      aiBid = clamp(aiBid, 0, aiP.coins);
      var winner = -1, winningBid = 0;
      if (playerBid > 0 || aiBid > 0) {
        if (playerBid >= aiBid) { winner = 0; winningBid = playerBid; }
        else { winner = 1; winningBid = aiBid; }
      }
      if (winner >= 0) {
        st.players[winner].coins -= winningBid;
        st.players[winner].score += st.currentLot.points;
        log(st, '拍品「' + st.currentLot.name + '」：你出价 ' + playerBid + '，AI 出价 ' + aiBid +
          '，' + st.players[winner].name + ' 以 ' + winningBid + ' 币得标，+' + st.currentLot.points + ' 分。');
      } else {
        log(st, '拍品「' + st.currentLot.name + '」双方放弃，流拍。');
      }
      st.plies += 1;
      st.actions[0] += 1;
      st.roundActions[0] += 1;
      st.lotIndex += 1;
      if (st.lotIndex >= st.lots.length) {
        finish(st);
      } else {
        st.currentLot = st.lots[st.lotIndex];
        st.round = st.lotIndex + 1;
        st.turn = 0;
      }
    } else if (MODE === 'market') {
      var g = st.goods[chosen.index];
      if (chosen.type === 'buy') {
        p.coins -= g.price; p.inv[chosen.index] += 1;
        g.price = clamp(g.price + 1, 2, 12);
        log(st, p.name + ' 买入 ' + g.name + '，价格被推高至 ' + g.price + '。');
      } else if (chosen.type === 'sell') {
        p.coins += g.price; p.inv[chosen.index] -= 1;
        g.price = clamp(g.price - 1, 2, 12);
        log(st, p.name + ' 卖出 ' + g.name + '，价格回落至 ' + g.price + '。');
      } else {
        p.coins += 1;
        log(st, p.name + ' 观望，获得 1 金币。');
      }
      driftMarket(st);
      endTurn(st, actor);
    }
    return st;
  }

  function noise(st, i) {
    var x = (st.rngState ^ Math.imul(st.plies + 1, 2654435761) ^ Math.imul(i + 7, 40503)) >>> 0;
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return (x % 1000) / 1000;
  }

  function moveValue(st, m, idx) {
    var p = st.players[st.turn];
    var v = 0, i, j, r, o, s, g;
    if (m.type === 'harvest') v = 1.15 + m.res * 0.22;
    else if (m.type === 'gather') v = 0.95 + m.res * 0.18;
    else if (m.type === 'convert') {
      r = CONFIG.recipes[m.index];
      v = (resValue(r.out) - resValue(r.in)) * 0.55 + 0.7;
    } else if (m.type === 'fulfill') {
      o = st.orders[m.index];
      v = o.points * 1.25 + o.coins * 0.9 + 1.5;
    } else if (m.type === 'take') {
      v = p.hand.length === 0 ? 2.2 : 0.9;
    } else if (m.type === 'deliver') {
      o = p.hand[m.index];
      v = o.points * 1.25 + o.coins * 0.9 + 1.2;
    } else if (m.type === 'place') {
      for (i = 0; i < st.spots.length; i++) if (st.spots[i].id === m.spot) s = st.spots[i];
      v = 1.1;
      if (s.effect.points) v += s.effect.points * 1.2;
      if (s.effect.coins) v += s.effect.coins * 0.8;
      if (s.effect.gain) v += resValue(s.effect.gain) * 0.6;
      if (s.effect.convert) v += (resValue(s.effect.convert.gain) - resValue(s.effect.convert.cost)) * 0.55;
    } else if (m.type === 'buy') {
      g = st.goods[m.index];
      v = (g.base - g.price + 0.9) * 0.75;
    } else if (m.type === 'sell') {
      g = st.goods[m.index];
      v = (g.price - g.base + 0.9) * 0.75;
    } else if (m.type === 'pass') {
      v = 0.62;
    }
    return v + noise(st, idx) * 0.35;
  }

  function aiMove(st) {
    var legal = getLegalMoves(st);
    if (!legal.length) return null;
    if (MODE === 'auction') {
      var p = st.players[st.turn];
      var maxBid = Math.min(p.coins, st.currentLot.points);
      var want = Math.floor(st.currentLot.points * (0.58 + noise(st, 2) * 0.42));
      want = clamp(want, 0, maxBid);
      for (var i = 0; i < legal.length; i++) if (legal[i].amount === want) return legal[i];
      return legal[0];
    }
    var best = legal[0], bestV = -Infinity;
    for (var j = 0; j < legal.length; j++) {
      var v = moveValue(st, legal[j], j);
      if (v > bestV) { bestV = v; best = legal[j]; }
    }
    return best;
  }

  function getScores(st) {
    return st.players.map(function (p) { return p.score; });
  }

  function netWorth(st, i) {
    var p = st.players[i];
    if (MODE === 'market') {
      var total = p.coins;
      for (var k = 0; k < st.goods.length; k++) total += (p.inv[k] || 0) * st.goods[k].price;
      return total;
    }
    if (MODE === 'worker') {
      return p.score + Math.floor(p.res.reduce(function (a, b) { return a + b; }, 0) / 2);
    }
    return p.score + p.coins;
  }

  return {
    config: CONFIG,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    aiMove: aiMove,
    getScores: getScores,
    netWorth: netWorth
  };
});
