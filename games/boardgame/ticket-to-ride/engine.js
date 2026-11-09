/*
 * Ticket to Ride（车票之旅）简化版纯规则引擎 — UMD
 * 浏览器：globalThis.TicketToRideEngine；Node：require('./engine.js')
 * 12 城 21 路线、8 色车厢卡 + 万能机车、目的地任务、最长连续路线。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketToRideEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'orange', 'pink'];
  var COLOR_NAMES = {
    red: '红', blue: '蓝', green: '绿', yellow: '黄', black: '黑',
    white: '白', orange: '橙', pink: '粉', gray: '灰', wild: '机车'
  };
  var ROUTE_POINTS = [0, 1, 2, 4, 7, 10, 15];
  var START_TRAINS = 45;
  var HAND_SIZE = 4;
  var DECK_COPIES = 9;
  var WILD_COPIES = 6;
  var MARKET_SIZE = 5;

  var CITIES = [
    { id: 0, name: '西雅图', x: 42, y: 24 },
    { id: 1, name: '波特兰', x: 42, y: 52 },
    { id: 2, name: '旧金山', x: 30, y: 100 },
    { id: 3, name: '洛杉矶', x: 48, y: 134 },
    { id: 4, name: '凤凰城', x: 88, y: 142 },
    { id: 5, name: '丹佛', x: 122, y: 104 },
    { id: 6, name: '达拉斯', x: 154, y: 146 },
    { id: 7, name: '芝加哥', x: 184, y: 78 },
    { id: 8, name: '纽约', x: 248, y: 66 },
    { id: 9, name: '亚特兰大', x: 202, y: 136 },
    { id: 10, name: '迈阿密', x: 240, y: 184 },
    { id: 11, name: '盐湖城', x: 82, y: 76 }
  ];

  var ROUTES = [
    { id: 0, a: 0, b: 1, color: 'blue', length: 1 },
    { id: 1, a: 0, b: 11, color: 'yellow', length: 2 },
    { id: 2, a: 1, b: 2, color: 'green', length: 3 },
    { id: 3, a: 2, b: 3, color: 'pink', length: 2 },
    { id: 4, a: 3, b: 4, color: 'orange', length: 2 },
    { id: 5, a: 4, b: 5, color: 'gray', length: 3 },
    { id: 6, a: 5, b: 11, color: 'gray', length: 2 },
    { id: 7, a: 5, b: 6, color: 'red', length: 2 },
    { id: 8, a: 6, b: 9, color: 'gray', length: 2 },
    { id: 9, a: 9, b: 10, color: 'yellow', length: 3 },
    { id: 10, a: 9, b: 8, color: 'orange', length: 2 },
    { id: 11, a: 7, b: 8, color: 'black', length: 2 },
    { id: 12, a: 7, b: 6, color: 'green', length: 3 },
    { id: 13, a: 7, b: 11, color: 'red', length: 3 },
    { id: 14, a: 1, b: 11, color: 'white', length: 2 },
    { id: 15, a: 0, b: 7, color: 'white', length: 4 },
    { id: 16, a: 3, b: 6, color: 'blue', length: 3 },
    { id: 17, a: 8, b: 10, color: 'green', length: 4 },
    { id: 18, a: 2, b: 5, color: 'yellow', length: 4 },
    { id: 19, a: 7, b: 9, color: 'black', length: 2 },
    { id: 20, a: 4, b: 6, color: 'orange', length: 3 }
  ];

  var TICKETS = [
    { a: 0, b: 8, value: 20 }, { a: 3, b: 8, value: 21 }, { a: 2, b: 7, value: 16 },
    { a: 10, b: 0, value: 22 }, { a: 6, b: 2, value: 12 }, { a: 9, b: 0, value: 18 },
    { a: 4, b: 7, value: 11 }, { a: 10, b: 7, value: 13 }, { a: 1, b: 8, value: 17 },
    { a: 3, b: 11, value: 9 }, { a: 5, b: 10, value: 15 }, { a: 4, b: 8, value: 14 }
  ];

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function nextRandom(st) {
    st.rng = (Math.imul(st.rng, 1664525) + 1013904223) >>> 0;
    return st.rng / 4294967296;
  }
  function shuffle(arr, st) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(nextRandom(st) * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function emptyHand() {
    var h = {};
    COLORS.forEach(function (c) { h[c] = 0; });
    return h;
  }
  function routeById(id) {
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].id === id) return ROUTES[i];
    return null;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed >>> 0;
    var st = {
      seed: seed, rng: seed >>> 0, deck: [], market: [], discard: [],
      routes: ROUTES.map(function () { return null; }),
      players: [
        { name: '你', hand: emptyHand(), wilds: 0, tickets: [], trains: START_TRAINS },
        { name: 'AI', hand: emptyHand(), wilds: 0, tickets: [], trains: START_TRAINS }
      ],
      turn: 0, drawsLeft: 0, phase: 'main', pendingTickets: [],
      finalTurnPlayer: null, over: false, moves: 0, log: []
    };
    COLORS.forEach(function (c) { for (var i = 0; i < DECK_COPIES; i++) st.deck.push(c); });
    for (var w = 0; w < WILD_COPIES; w++) st.deck.push('wild');
    shuffle(st.deck, st);
    for (var m = 0; m < MARKET_SIZE; m++) st.market.push(st.deck.pop() || null);
    for (var p = 0; p < 2; p++) {
      for (var k = 0; k < HAND_SIZE; k++) drawFromDeck(st, st.players[p]);
    }
    var tickets = shuffle(TICKETS.map(function (t, i) { return i; }), st);
    st.ticketDeck = tickets;
    for (p = 0; p < 2; p++) {
      for (k = 0; k < 3; k++) st.players[p].tickets.push(st.ticketDeck.pop());
    }
    st.turn = opts.humanFirst === false ? 1 : 0;
    st.log.push('开局：双方各 ' + START_TRAINS + ' 节车厢、4 张车厢卡、3 张任务。' + (st.turn === 0 ? '你先手。' : 'AI 先手。'));
    return st;
  }

  function addCard(player, card) {
    if (card === 'wild') player.wilds += 1;
    else player.hand[card] += 1;
  }
  function drawFromDeck(st, player) {
    var card = st.deck.pop();
    if (card) addCard(player, card);
    return card;
  }
  function refillMarket(st) {
    while (st.deck.length && st.market.length < MARKET_SIZE) st.market.push(st.deck.pop());
  }

  function paymentFor(player, route) {
    var options = route.color === 'gray' ? COLORS : [route.color];
    var best = null;
    options.forEach(function (color) {
      var colored = Math.min(player.hand[color], route.length);
      var wilds = route.length - colored;
      if (player.wilds >= wilds) {
        var cand = { color: color, colored: colored, wilds: wilds };
        if (!best || cand.wilds < best.wilds) best = cand;
      }
    });
    return best;
  }

  function legalMoves(state) {
    if (state.over) return [];
    if (state.phase === 'ticketSelect') {
      if (!state.pendingTickets.length) return [{ type: 'pass' }];
      var idx = state.pendingTickets.map(function (_, i) { return i; });
      var out = [];
      for (var mask = 1; mask < (1 << idx.length); mask++) {
        var keep = [];
        for (var b = 0; b < idx.length; b++) if (mask & (1 << b)) keep.push(b);
        out.push({ type: 'keepTickets', keep: keep });
      }
      return out;
    }
    var moves = [];
    var p = state.players[state.turn];
    if (state.drawsLeft > 0) {
      state.market.forEach(function (card, i) {
        if (card) moves.push({ type: 'drawCard', source: 'market', marketIndex: i });
      });
      if (state.deck.length) moves.push({ type: 'drawCard', source: 'deck' });
      if (!moves.length) moves.push({ type: 'pass' });
      return moves;
    }
    if (state.deck.length) moves.push({ type: 'drawCard', source: 'deck' });
    state.market.forEach(function (card, i) {
      if (card) moves.push({ type: 'drawCard', source: 'market', marketIndex: i });
    });
    moves.push({ type: 'drawTickets' });
    if (!state.ticketDeck.length) moves.pop();
    ROUTES.forEach(function (route) {
      if (state.routes[route.id] !== null) return;
      if (paymentFor(p, route)) moves.push({ type: 'claimRoute', routeId: route.id });
    });
    if (!moves.length) moves.push({ type: 'pass' });
    return moves;
  }

  function endTurn(s) {
    s.drawsLeft = 0;
    s.phase = 'main';
    s.pendingTickets = [];
    if (s.finalTurnPlayer === null && !s.deck.length && !s.market.length) {
      s.finalTurnPlayer = 1 - s.turn;
      s.log.push('车厢卡耗尽，进入最后回合。');
    }
    if (s.finalTurnPlayer !== null && s.turn === s.finalTurnPlayer) {
      s.over = true;
      s.log.push('终局回合结束，开始结算。');
      return;
    }
    s.turn = 1 - s.turn;
  }

  function applyMove(state, move) {
    if (state.over) throw new Error('游戏已结束');
    if (state.moves >= 800) throw new Error('动作数超限');
    var legal = legalMoves(state).some(function (m) {
      if (m.type !== move.type) return false;
      if (m.type === 'drawCard') return m.source === move.source && m.marketIndex === move.marketIndex;
      if (m.type === 'claimRoute') return m.routeId === move.routeId;
      if (m.type === 'keepTickets') return JSON.stringify(m.keep) === JSON.stringify(move.keep);
      return true;
    });
    if (!legal) throw new Error('非法动作: ' + JSON.stringify(move));

    var s = clone(state);
    var p = s.players[s.turn];
    s.moves += 1;

    if (move.type === 'drawCard') {
      if (s.drawsLeft === 0) s.drawsLeft = 2;
      if (move.source === 'market') {
        var card = s.market[move.marketIndex];
        s.market[move.marketIndex] = null;
        addCard(p, card);
        s.log.push(p.name + ' 从明牌区拿走 ' + COLOR_NAMES[card] + ' 卡。');
        if (s.deck.length) s.market[move.marketIndex] = s.deck.pop();
        refillMarket(s);
        var compact = s.market.filter(function (c) { return c !== null; });
        s.market = compact;
      } else {
        var c2 = s.deck.pop();
        if (!c2) throw new Error('牌堆为空');
        addCard(p, c2);
        s.log.push(p.name + ' 从牌堆摸了一张牌。');
      }
      s.drawsLeft -= 1;
      if (s.drawsLeft <= 0) endTurn(s);
      return s;
    }

    if (move.type === 'drawTickets') {
      var drawn = [];
      for (var i = 0; i < 3 && s.ticketDeck.length; i++) drawn.push(s.ticketDeck.pop());
      s.pendingTickets = drawn;
      s.phase = 'ticketSelect';
      s.log.push(p.name + ' 抽取了 ' + drawn.length + ' 张目的地任务。');
      return s;
    }

    if (move.type === 'keepTickets') {
      var kept = move.keep.map(function (i) { return s.pendingTickets[i]; }).filter(function (x) { return x != null; });
      kept.forEach(function (t) { p.tickets.push(t); });
      s.log.push(p.name + ' 保留了 ' + kept.length + ' 张任务。');
      endTurn(s);
      return s;
    }

    if (move.type === 'claimRoute') {
      var route = routeById(move.routeId);
      var pay = paymentFor(p, route);
      p.hand[pay.color] -= pay.colored;
      p.wilds -= pay.wilds;
      s.routes[route.id] = s.turn;
      p.trains -= route.length;
      var pts = ROUTE_POINTS[route.length];
      s.log.push(p.name + ' 占领 ' + CITIES[route.a].name + '–' + CITIES[route.b].name + '（' + route.length + ' 段，' + pts + ' 分）。');
      if (s.trains <= 2 && s.finalTurnPlayer === null) {
        s.finalTurnPlayer = 1 - s.turn;
        s.log.push(p.name + ' 车厢不足 3 节，触发终局。');
      }
      endTurn(s);
      return s;
    }

    if (move.type === 'pass') {
      s.log.push(p.name + ' 无可用行动，跳过。');
      endTurn(s);
      return s;
    }
    throw new Error('未知动作');
  }

  function adjacency(state, playerIndex) {
    var adj = CITIES.map(function () { return []; });
    ROUTES.forEach(function (r) {
      if (state.routes[r.id] === playerIndex) {
        adj[r.a].push(r.b);
        adj[r.b].push(r.a);
      }
    });
    return adj;
  }

  function connected(state, playerIndex, a, b) {
    var adj = adjacency(state, playerIndex);
    var seen = {}, queue = [a];
    seen[a] = true;
    while (queue.length) {
      var cur = queue.shift();
      if (cur === b) return true;
      adj[cur].forEach(function (n) {
        if (!seen[n]) { seen[n] = true; queue.push(n); }
      });
    }
    return false;
  }

  function longestPath(state, playerIndex) {
    var adj = adjacency(state, playerIndex);
    var best = 0;
    function dfs(node, seen, depth) {
      if (depth > best) best = depth;
      adj[node].forEach(function (n) {
        if (!seen[n]) { seen[n] = true; dfs(n, seen, depth + 1); seen[n] = false; }
      });
    }
    for (var i = 0; i < CITIES.length; i++) {
      var seen = {}; seen[i] = true; dfs(i, seen, 0);
    }
    return best;
  }

  function score(state) {
    function one(idx) {
      var p = state.players[idx];
      var routePts = 0;
      ROUTES.forEach(function (r) { if (state.routes[r.id] === idx) routePts += ROUTE_POINTS[r.length]; });
      var ticketPts = 0, done = 0;
      p.tickets.forEach(function (ti) {
        var t = TICKETS[ti];
        if (connected(state, idx, t.a, t.b)) { ticketPts += t.value; done++; }
        else ticketPts -= t.value;
      });
      return { total: routePts + ticketPts, routePts: routePts, ticketPts: ticketPts, ticketsDone: done, longest: longestPath(state, idx) };
    }
    var h = one(0), a = one(1);
    var bonus = 10;
    var maxLen = Math.max(h.longest, a.longest);
    if (maxLen > 0) {
      if (h.longest === maxLen) h.total += bonus;
      if (a.longest === maxLen) a.total += bonus;
    }
    h.total += 0; a.total += 0;
    return { human: h.total, ai: a.total, humanDetail: h, aiDetail: a };
  }

  function isOver(state) { return !!state.over; }
  function winner(state) {
    var sc = score(state);
    if (sc.human === sc.ai) return 'tie';
    return sc.human > sc.ai ? 'human' : 'ai';
  }

  function aiMove(state) {
    var legal = legalMoves(state);
    if (!legal.length) throw new Error('无合法动作');
    if (state.phase === 'ticketSelect') {
      var pending = state.pendingTickets;
      var bestIdx = 0;
      for (var i = 1; i < pending.length; i++) {
        if (TICKETS[pending[i]].value > TICKETS[pending[bestIdx]].value) bestIdx = i;
      }
      return { type: 'keepTickets', keep: [bestIdx] };
    }
    var p = state.players[state.turn];
    var draws = legal.filter(function (m) { return m.type === 'drawCard'; });
    if (state.drawsLeft > 0) {
      var wildMarket = draws.filter(function (m) { return m.source === 'market' && state.market[m.marketIndex] === 'wild'; })[0];
      if (wildMarket) return wildMarket;
      var marketDraws = draws.filter(function (m) { return m.source === 'market'; });
      if (marketDraws.length) {
        /* 优先补手牌最多的颜色，便于占路。 */
        marketDraws.sort(function (x, y) {
          return p.hand[state.market[y.marketIndex]] - p.hand[state.market[x.marketIndex]];
        });
        return marketDraws[0];
      }
      return draws[0] || legal[0];
    }
    var claims = legal.filter(function (m) { return m.type === 'claimRoute'; });
    claims.sort(function (x, y) {
      var rx = routeById(x.routeId), ry = routeById(y.routeId);
      return ROUTE_POINTS[ry.length] - ROUTE_POINTS[rx.length];
    });
    if (claims.length) {
      /* 短路线也值得占；优先分数高者。 */
      return claims[0];
    }
    if (p.tickets.length < 4 && state.ticketDeck.length && state.turn === 1 && state.moves % 9 === 0) {
      return { type: 'drawTickets' };
    }
    var wm = draws.filter(function (m) { return m.source === 'market' && state.market[m.marketIndex] === 'wild'; })[0];
    if (wm) return wm;
    var md = draws.filter(function (m) { return m.source === 'market'; });
    if (md.length) {
      md.sort(function (x, y) {
        return p.hand[state.market[y.marketIndex]] - p.hand[state.market[x.marketIndex]];
      });
      return md[0];
    }
    return draws[0] || legal[0];
  }

  return {
    COLORS: COLORS, COLOR_NAMES: COLOR_NAMES, CITIES: CITIES, ROUTES: ROUTES,
    TICKETS: TICKETS, ROUTE_POINTS: ROUTE_POINTS, START_TRAINS: START_TRAINS,
    createGame: createGame, legalMoves: legalMoves, applyMove: applyMove,
    aiMove: aiMove, isOver: isOver, score: score, winner: winner,
    paymentFor: paymentFor, connected: connected, longestPath: longestPath,
    routeById: routeById
  };
});
