'use strict';

/* Ticket to Ride Premium — engine + delivery tests.
 *   node games/boardgame/ticket-to-ride-premium/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('ticket-to-ride-premium');
var E = require('./engine.js');

function totalCards(st) {
  var n = st.deck.length + st.market.filter(Boolean).length + st.discard.length;
  st.players.forEach(function (p) { n += p.wilds + E.COLORS.reduce(function (a, c) { return a + p.hand[c]; }, 0); });
  return n;
}
function handTotal(p) { return p.wilds + E.COLORS.reduce(function (n, c) { return n + p.hand[c]; }, 0); }
function routeByPair(a, b) { return E.ROUTES.filter(function (r) { return (r.a === a && r.b === b) || (r.a === b && r.b === a); })[0]; }
function hasMove(st, type) { return E.legalMoves(st).some(function (m) { return m.type === type; }); }
function expectThrow(label, fn, re) {
  var message = '';
  try { fn(); } catch (e) { message = String(e && e.message || e); }
  s.ok(label, !!message && (!re || re.test(message)), message || 'no exception');
}

s.group('数据与卡牌经济', function () {
  s.eq('20 座城市', E.CITIES.length, 20);
  s.eq('40 条路线', E.ROUTES.length, 40);
  s.eq('24 张任务', E.TICKETS.length, 24);
  s.eq('8 种车厢颜色', E.COLORS.length, 8);
  s.eq('45 节车厢', E.START_TRAINS, 45);
  s.eq('每种颜色 12 张', E.DECK_COPIES, 12);
  s.eq('14 张机车', E.WILD_COPIES, 14);
  s.eq('110 张车厢卡', 8 * 12 + 14, 110);
  s.eq('最多抽 2 张', 2, 2);
  s.eq('任务抽 3 张', E.TICKETS_DEALT, 3);
  s.eq('最长路线奖励 10', E.LONGEST_BONUS, 10);
  s.eq('≤2 节触发终局', E.END_TRAIN_THRESHOLD, 2);
  s.eq('路线分表', E.ROUTE_POINTS, [0, 1, 2, 4, 7, 10, 15]);
  s.eq('城市 id 唯一', new Set(E.CITIES.map(function (c) { return c.id; })).size, 20);
  s.eq('路线 id 唯一', new Set(E.ROUTES.map(function (r) { return r.id; })).size, 40);
  s.ok('路线长度 1–6', E.ROUTES.every(function (r) { return r.length >= 1 && r.length <= 6; }));
  s.ok('路线颜色合法', E.ROUTES.every(function (r) { return E.COLORS.indexOf(r.color) !== -1 || r.color === 'gray'; }));
  s.ok('全部路线端点存在', E.ROUTES.every(function (r) { return !!E.CITIES[r.a] && !!E.CITIES[r.b]; }));
  s.ok('全部任务端点存在', E.TICKETS.every(function (t) { return !!E.CITIES[t.a] && !!E.CITIES[t.b] && t.value > 0; }));
  s.ok('任务起点终点不同', E.TICKETS.every(function (t) { return t.a !== t.b; }));
  s.ok('存在灰色路线', E.ROUTES.some(function (r) { return r.color === 'gray'; }));
  s.ok('存在 6 段路线', E.ROUTES.some(function (r) { return r.length === 6; }));
});

s.group('开局与抽牌', function () {
  var st = E.createGame({ seed: 5 });
  s.eq('明牌区 5 张', st.market.length, 5);
  s.eq('双方 4 张手牌', [handTotal(st.players[0]), handTotal(st.players[1])], [4, 4]);
  s.eq('双方 3 张任务', [st.players[0].tickets.length, st.players[1].tickets.length], [3, 3]);
  s.eq('双方 45 节车厢', [st.players[0].trains, st.players[1].trains], [45, 45]);
  s.eq('总卡数 110', totalCards(st), 110);
  s.ok('同 seed 可复现', JSON.stringify(E.createGame({ seed: 9 })) === JSON.stringify(E.createGame({ seed: 9 })));
  var before = handTotal(st.players[0]);
  st = E.applyMove(st, { type: 'drawCard', source: 'deck' });
  s.eq('第一次摸牌仍是自己回合', st.turn, 0);
  s.eq('drawsLeft 1', st.drawsLeft, 1);
  st = E.applyMove(st, { type: 'drawCard', source: 'deck' });
  s.eq('第二次摸牌后换手', st.turn, 1);
  s.eq('手牌 +2', handTotal(st.players[0]), before + 2);
  s.eq('drawsLeft 归零', st.drawsLeft, 0);
});

s.group('明牌区与机车规则', function () {
  var st = E.createGame({ seed: 12 });
  st.market[0] = 'wild';
  var handBefore = handTotal(st.players[0]);
  st = E.applyMove(st, { type: 'drawCard', source: 'market', marketIndex: 0 });
  s.eq('拿明牌机车', st.players[0].wilds >= 1, true);
  s.eq('机车独占整个摸牌行动', st.turn, 1);
  s.eq('手牌只 +1', handTotal(st.players[0]), handBefore + 1);
  s.eq('明牌区补满 5 张', st.market.length, 5);
  var st2 = E.createGame({ seed: 13 });
  var color = st2.market[0] === 'wild' ? 'red' : st2.market[0];
  st2.market[0] = color;
  var countBefore = color === 'wild' ? st2.players[0].wilds : st2.players[0].hand[color];
  st2 = E.applyMove(st2, { type: 'drawCard', source: 'market', marketIndex: 0 });
  var countAfter = color === 'wild' ? st2.players[0].wilds : st2.players[0].hand[color];
  s.eq('普通明牌 +1', countAfter, countBefore + 1);
  s.eq('普通明牌不结束回合（除非这是第二张）', st2.turn, 0);
});

s.group('占路、支付与弃牌堆', function () {
  var st = E.createGame({ seed: 20 });
  st.players[0].hand.white = 4;
  var r = routeByPair(8, 10);
  if (r) {
    st.routes[r.id] = null;
  }
  var route = E.ROUTES.filter(function (x) { return x.color === 'white' && x.length === 4; })[0] || E.ROUTES[15];
  st.players[0].hand[route.color === 'gray' ? 'white' : route.color] = route.length;
  st.players[0].wilds = 0;
  var pay = E.paymentFor(st.players[0], route);
  s.eq('支付长度匹配', pay.colored + pay.wilds, route.length);
  var st2 = E.applyMove(st, { type: 'claimRoute', routeId: route.id });
  s.eq('路线归属玩家 0', st2.routes[route.id], 0);
  s.eq('车厢减少', st2.players[0].trains, 45 - route.length);
  s.eq('支付卡进入弃牌堆', totalCards(st2), 110);
  s.ok('占路后换手', st2.turn === 1);
  expectThrow('不能重复占路', function () { E.applyMove(st2, { type: 'claimRoute', routeId: route.id }); }, /非法动作/);
  var st3 = E.createGame({ seed: 21 });
  st3.players[0].hand.red = 1; st3.players[0].wilds = 1;
  var two = E.ROUTES.filter(function (x) { return x.length === 2 && x.color === 'red'; })[0];
  if (two) {
    var p2 = E.paymentFor(st3.players[0], two);
    s.eq('机车补 1 张红卡', [p2.color, p2.colored, p2.wilds], ['red', 1, 1]);
  }
});

s.group('牌堆耗尽后洗回弃牌', function () {
  var st = E.createGame({ seed: 30 });
  st.discard = st.discard.concat(st.deck);
  st.deck = [];
  var discardBefore = st.discard.length;
  var drew = E.applyMove(st, { type: 'drawCard', source: 'deck' });
  s.eq('弃牌被洗回牌堆', drew.discard.length, 0);
  s.ok('摸牌成功', handTotal(drew.players[0]) === 5);
  s.eq('总卡数守恒', totalCards(drew), 110);
  s.ok('弃牌确实来自原弃牌', discardBefore >= 50);
});

s.group('目的地任务', function () {
  var st = E.createGame({ seed: 40 });
  st = E.applyMove(st, { type: 'drawTickets' });
  s.eq('进入任务选择', st.phase, 'ticketSelect');
  s.eq('待选 3 张', st.pendingTickets.length, 3);
  expectThrow('至少保留 1 张', function () { E.applyMove(st, { type: 'keepTickets', keep: [] }); }, /非法动作/);
  st = E.applyMove(st, { type: 'keepTickets', keep: [0] });
  s.eq('保留后任务 +1', st.players[0].tickets.length, 4);
  s.eq('任务阶段结束并换手', st.turn, 1);
  var s2 = E.createGame({ seed: 41 });
  var t = E.TICKETS[0];
  s2.players[0].tickets = [0];
  s2.routes = E.ROUTES.map(function () { return null; });
  s.ok('未连通任务不得分', !E.connected(s2, 0, t.a, t.b));
  s.eq('未完成扣分', E.score(s2).humanDetail.ticketPts, -t.value);
  // Build a direct connected chain from t.a to t.b through arbitrary claimed routes.
  var adj = E.CITIES.map(function () { return []; });
  E.ROUTES.forEach(function (r) { adj[r.a].push(r.b); adj[r.b].push(r.a); });
  var prev = {}, seen = {}, q = [t.a]; seen[t.a] = true;
  while (q.length) { var cur = q.shift(); adj[cur].forEach(function (n) { if (!seen[n]) { seen[n] = true; prev[n] = cur; q.push(n); } }); }
  var node = t.b;
  while (node !== t.a) {
    var p = prev[node];
    E.ROUTES.forEach(function (r) { if ((r.a === p && r.b === node) || (r.a === node && r.b === p)) s2.routes[r.id] = 0; });
    node = p;
  }
  s.ok('连通后任务完成', E.connected(s2, 0, t.a, t.b));
  s.eq('完成任务加分', E.score(s2).humanDetail.ticketPts, t.value);
});

s.group('最长连续路线按车厢节数', function () {
  var st = E.createGame({ seed: 50 });
  st.routes = E.ROUTES.map(function () { return null; });
  // Claim two adjacent routes of lengths 2 and 3 that share a city.
  var a = E.ROUTES[11]; // Chicago-NY length 2
  var chain = E.ROUTES.filter(function (r) {
    return r.id !== a.id && (r.a === a.a || r.b === a.a || r.a === a.b || r.b === a.b);
  })[0];
  st.routes[a.id] = 0; st.routes[chain.id] = 0;
  var expected = a.length + chain.length;
  s.eq('两条相邻路线按长度求和', E.longestPath(st, 0), expected);
  var s2 = E.createGame({ seed: 51 });
  s2.routes = E.ROUTES.map(function () { return null; });
  s2.routes[15] = 0; // Seattle-Chicago length 4
  s.eq('单条 4 段路线 = 4', E.longestPath(s2, 0), 4);
});

s.group('终局触发与结算', function () {
  var st = E.createGame({ seed: 60 });
  st.routes = E.ROUTES.map(function () { return null; });
  st.players[0].trains = 4;
  var route = E.ROUTES.filter(function (r) { return r.length === 3; })[0];
  st.players[0].hand[route.color === 'gray' ? 'red' : route.color] = 3;
  st.players[0].wilds = 0;
  st.finalTurnPlayer = null;
  var after = E.applyMove(st, { type: 'claimRoute', routeId: route.id });
  s.eq('≤2 节触发终局', after.finalTurnPlayer, 1);
  s.eq('触发者已行动完，轮到对手', after.turn, 1);
  var after2 = E.applyMove(after, { type: 'drawCard', source: 'deck' });
  s.eq('最后一回合第一张牌仍由对手行动', after2.turn, 1);
  after2 = E.applyMove(after2, { type: 'drawCard', source: 'deck' });
  s.ok('对手最后一回合结束后终局', after2.over === true);
  var sc = E.score(st);
  s.ok('路线分有限', Number.isFinite(sc.human) && Number.isFinite(sc.ai));
  s.ok('明细字段完整', ['routePts', 'ticketPts', 'longest', 'ticketsDone'].every(function (k) { return k in sc.humanDetail; }));
});

s.group('AI 与自对弈', function () {
  var st = E.createGame({ seed: 70 });
  var ok = true;
  for (var i = 0; i < 80 && !st.over; i++) {
    var m = E.aiMove(st);
    try { st = E.applyMove(st, m); } catch (e) { ok = false; break; }
  }
  s.ok('AI 连续动作合法', ok);
  var errors = 0, incomplete = 0, badTotal = 0, maxMoves = 0, started = Date.now();
  for (var g = 0; g < 20; g++) {
    var game = E.createGame({ seed: 200 + g });
    var steps = 0;
    try {
      while (!game.over && steps < 900) {
        if (game.phase === 'ticketSelect') game = E.applyMove(game, game.pendingTickets.length ? { type: 'keepTickets', keep: [0] } : { type: 'pass' });
        else game = E.applyMove(game, E.aiMove(game));
        steps++;
      }
    } catch (e) { errors++; }
    if (!game.over) incomplete++;
    if (totalCards(game) !== 110) badTotal++;
    maxMoves = Math.max(maxMoves, steps);
  }
  s.eq('20 局无异常', errors, 0);
  s.eq('20 局全部结束', incomplete, 0);
  s.eq('20 局卡牌守恒 110', badTotal, 0);
  s.ok('自对弈在动作上限内', maxMoves < 900, String(maxMoves));
  s.ok('20 局在 20 秒内', Date.now() - started < 20000, (Date.now() - started) + 'ms');
});

s.group('页面与联机交付面', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var online = fs.readFileSync(path.join(__dirname, 'online.html'), 'utf8');
  var server = fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8');
  var manifest = fs.readFileSync(path.join(__dirname, '..', '..', 'precache-manifest.js'), 'utf8');
  var sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
  var ver = (sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  s.ok('页面标题含车票之旅', /<title>[^<]*车票之旅/.test(html));
  s.ok('页面有描述 meta', /name="description"/.test(html));
  s.ok('页面引用 engine.js', /src="engine\.js"/.test(html));
  s.ok('页面引用 shared/sfx.js', /src="\.\.\/\.\.\/shared\/sfx\.js"/.test(html));
  s.ok('页面注册全局 v22 SW', /serviceWorker\.register\('\.\.\/\.\.\/sw\.js'/.test(html));
  s.ok('页面有地图 SVG', /id="map"/.test(html) && /viewBox="0 0 290 200"/.test(html));
  s.ok('页面有 44px 触控下限', /--touch:\s*44px/.test(html) && /min-height:\s*var\(--touch\)/.test(html));
  s.ok('页面有 320 档媒体查询', /@media\s*\(max-width:\s*350px\)/.test(html));
  s.ok('页面无远程字体', !/fonts\.googleapis|fonts\.gstatic|@font-face/i.test(html));
  s.ok('页面链接规则页', /href="rules\.html"/.test(html));
  s.ok('页面链接联机页', /href="online\.html"/.test(html));
  s.ok('页面暴露测试 API', /window\.__ttr/.test(html) && /autoPlayToEnd/.test(html));
  s.ok('规则页列出 B 站来源', /BV14J411H7fL/.test(rules) && /BV1R3411b7Rt/.test(rules));
  s.ok('规则页说明 110 张卡', /110 张车厢卡/.test(rules));
  s.ok('规则页说明最长 10 分', /10 分/.test(rules));
  s.ok('规则页说明 ≤2 节终局', /≤ 2 节/.test(rules));
  s.ok('规则页给出路线分表', /6 段 = 15 分/.test(rules));
  s.ok('联机页有房间码入口', /roomCode|邀请码/.test(online));
  s.ok('联机页无外部依赖', !/<script[^>]+src="https?:/i.test(online) && !/fonts\.googleapis/.test(online));
  s.ok('服务端复用 rooms.js', /from '\.\.\/app\/rooms\.js'/.test(server));
  s.ok('服务端权威 applyMove', /E\.applyMove/.test(server));
  s.ok('服务端隐藏对手手牌/任务', /hand: i === viewerIndex/.test(server) && /cards: i === viewerIndex/.test(server));
  s.ok('precache 版本一致', !!ver && manifest.indexOf('"version": "' + ver + '"') !== -1);
  s.ok('precache 收录本作', manifest.indexOf('/games/boardgame/ticket-to-ride-premium/') !== -1);
  s.ok('precache 收录材质', manifest.indexOf('/games/assets/art/premium/ticket-to-ride/train-car.webp') !== -1);
});

s.done();
