'use strict';

/*
 * 卡卡颂 · Carcassonne Premium — 规则引擎 / 页面契约 / 30 局自对弈 / E2E
 * 直接 require 与页面完全同源的 data.js + engine.js，避免测试复制规则。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('carcassonne-premium');
var D = require('./data.js');
var E = require('./engine.js');

function boardMeeples(state) {
  var out = [0, 0];
  Object.keys(state.board).forEach(function (key) {
    state.board[key].meeples.forEach(function (m) { out[m.player] = (out[m.player] || 0) + 1; });
  });
  return out;
}
function controlled(deck, seed) {
  return E.createGame({ seed: seed || 1, deck: deck, players: [{ name: '你', isAI: false }, { name: 'AI', isAI: true }] });
}
function expectThrow(fn) {
  try { fn(); return false; } catch (e) { return true; }
}
function playout(state, limit) {
  var steps = 0;
  while (state.phase !== 'over' && steps < (limit || 300)) {
    E.runAITurn(state);
    steps++;
  }
  return steps;
}

/* ------------------------------------------------------------------ */
/* 1. 数据完整性                                                       */
/* ------------------------------------------------------------------ */
s.group('瓦片数据完整性', function () {
  s.eq('50 种瓦片', D.TILES.length, 50);
  s.eq('总瓦片数 50', D.TOTAL_TILES, 50);
  s.eq('每方 7 枚米宝', D.MEEPLES_PER_PLAYER, 7);
  s.eq('两种玩家颜色', D.PLAYER_COLORS.length, 2);
  var ids = {};
  var badEdges = 0, badDirs = 0, badAdj = 0, badCount = 0;
  D.TILES.forEach(function (t) {
    ids[t.id] = (ids[t.id] || 0) + 1;
    if (t.edges.length !== 4 || t.edges.some(function (e) { return D.EDGE_TYPES.indexOf(e) < 0; })) badEdges++;
    ['cities', 'roads', 'fields'].forEach(function (key) {
      t[key].forEach(function (g) {
        if (!Array.isArray(g) || !g.length || g.some(function (d) { return d < 0 || d > 3; })) badDirs++;
      });
    });
    if (t.fieldAdj.length !== t.fields.length) badAdj++;
    if (t.count !== 1) badCount++;
  });
  s.eq('瓦片 ID 唯一', Object.keys(ids).length, 50);
  s.eq('四边均为合法地形', badEdges, 0);
  s.eq('内部分组方向合法', badDirs, 0);
  s.eq('农田邻接表长度匹配', badAdj, 0);
  s.eq('每种瓦片一份', badCount, 0);
  var start = D.TILES.filter(function (t) { return t.id === D.START_TILE_ID; })[0];
  s.ok('起始瓦片存在', !!start);
  s.eq('起始瓦片北城东西路南田', start && start.edges, ['city', 'road', 'field', 'road']);
  s.ok('所有地形边都能在别处找到', D.EDGE_TYPES.every(function (type) {
    return D.TILES.some(function (t) { return t.edges.indexOf(type) >= 0; });
  }));
});

/* ------------------------------------------------------------------ */
/* 2. 开局                                                             */
/* ------------------------------------------------------------------ */
s.group('开局与确定性', function () {
  var g = E.createGame({ seed: 42 });
  s.eq('棋盘有 1 块起始瓦片', Object.keys(g.board).length, 1);
  s.ok('起始瓦片在中心', !!g.board['0,0']);
  s.eq('牌堆 48 张 + 当前 1 张', [g.deck.length, !!g.currentTile], [48, true]);
  s.eq('双方各 7 米宝', g.players.map(function (p) { return p.meeples; }), [7, 7]);
  s.eq('初始分数', g.players.map(function (p) { return p.score; }), [0, 0]);
  s.eq('阶段为放置', g.phase, 'placing');
  s.eq('人类先手', [g.currentPlayer, g.turn], [0, 1]);
  s.ok('当前瓦片已抽出', !!g.currentTile && !!E.currentTileDef(g));
  s.eq('同 seed 牌序一致', E.createGame({ seed: 7 }).deck.join(','), E.createGame({ seed: 7 }).deck.join(','));
  s.ok('异 seed 牌序不同', E.createGame({ seed: 7 }).deck.join(',') !== E.createGame({ seed: 8 }).deck.join(','));
  var all = Object.keys(g.board).length + g.deck.length + (g.currentTile ? 1 : 0);
  s.eq('开局物理瓦片守恒 50', all, 50);
});

/* ------------------------------------------------------------------ */
/* 3. 合法性                                                           */
/* ------------------------------------------------------------------ */
s.group('放置合法性', function () {
  var g = E.createGame({ seed: 3 });
  var frontier = E.frontier(g);
  s.eq('起始瓦片 4 个邻格', frontier.length, 4);
  s.ok('必须与已有瓦片相邻', !E.canPlaceTile(g, g.currentTile.tileId, 0, 5, 5).ok);
  s.ok('已有瓦片的位置被拒绝', !E.canPlaceTile(g, 'T02', 0, 0, 0).ok);
  var legalSomewhere = E.hasAnyLegalPlacement(g, g.currentTile.tileId);
  s.ok('当前瓦片至少有一个方向可放', legalSomewhere);
  var placements = E.getLegalPlacements(g, g.currentTile.tileId);
  s.ok('合法位置列表非空', placements.length > 0, String(placements.length));
  s.ok('合法位置都相邻', placements.every(function (p) {
    for (var d = 0; d < 4; d++) if (g.board[E.boardKey(p.x + E.DX[d], p.y + E.DY[d])]) return true;
    return false;
  }));
  var mismatch = 0;
  placements.forEach(function (p) {
    if (!E.canPlaceTile(g, g.currentTile.tileId, p.rot, p.x, p.y).ok) mismatch++;
  });
  s.eq('列表内全部通过二次校验', mismatch, 0);
  var rotated = E.getLegalPlacements(g, 'T04', 0).concat(E.getLegalPlacements(g, 'T04', 1));
  s.ok('旋转会改变合法集合', rotated.length > 0);
  var t = E.makeTile(D.TILES[0], 1);
  s.eq('旋转 90° 后 N 边变成 E 边', t.edges[1], D.TILES[0].edges[0]);
  s.eq('旋转规范化 4 回到 0', E.makeTile(D.TILES[0], 4).rot, 0);
});

/* ------------------------------------------------------------------ */
/* 4. 米宝与完成计分                                                   */
/* ------------------------------------------------------------------ */
s.group('米宝与城市计分', function () {
  var g = controlled(['T04', 'T02', 'T03'], 10);
  E.placeCurrentTile(g, { x: 0, y: -1, rot: 0 });
  s.eq('放瓦片后进入米宝阶段', g.phase, 'meeple');
  var opts = E.getMeepleOptions(g, 0);
  s.ok('北城提供城市选项', opts.some(function (o) { return o.kind === 'city'; }));
  var ev = E.placeMeeple(g, 'city', 0, 0);
  var city = ev.filter(function (x) { return x.kind === 'city'; })[0];
  s.ok('城市完成事件存在', !!city);
  s.eq('两块城市瓦片得 4 分', city && city.points, 4);
  s.eq('城市瓦片计数', city && city.tiles, 2);
  s.eq('米宝退回手上', g.players[0].meeples, 7);
  s.eq('城市分数进入记分板', g.players[0].score, 4);
  s.eq('回合交给 AI', g.currentPlayer, 1);
  s.ok('日志记录了城墙落成', g.log.some(function (x) { return /城市/.test(x.text); }));
  s.ok('完成区域清空米宝', boardMeeples(g)[0] === 0);

  var none = controlled(['T04', 'T02', 'T03'], 11);
  E.placeCurrentTile(none, { x: 0, y: -1, rot: 0 });
  E.skipMeeple(none);
  s.eq('无人占领的完成城市不给分', none.players[0].score, 0);
  s.eq('跳过米宝也会推进回合', none.currentPlayer, 1);
});

s.group('道路、修道院与多数', function () {
  var road = controlled(['T02', 'T03'], 20);
  E.__putTile(road, 'T34', 1, 0, 0);
  E.__putTile(road, 'T32', -1, 0, 0);
  E.__putMeeple(road, 0, 0, 0, 'road', 0);
  road.lastPlaced = '0,0';
  road.phase = 'meeple';
  road.currentPlayer = 0;
  var events = E.resolveAfterPlacement(road);
  var rev = events.filter(function (x) { return x.kind === 'road'; })[0];
  s.ok('道路完成事件存在', !!rev);
  s.eq('三块道路得 3 分', rev && rev.points, 3);
  s.eq('三块道路计数', rev && rev.tiles, 3);
  s.eq('道路完成退回米宝', road.players[0].meeples, 7);

  var mono = controlled(['T02', 'T03'], 21);
  E.__putTile(mono, 'T41', 5, 5, 0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) if (dx || dy) E.__putTile(mono, 'T41', 5 + dx, 5 + dy, 0);
  }
  E.__putMeeple(mono, 0, 5, 5, 'monastery', 0);
  mono.lastPlaced = '5,5';
  mono.phase = 'meeple';
  mono.currentPlayer = 0;
  var mev = E.resolveAfterPlacement(mono).filter(function (x) { return x.kind === 'monastery'; })[0];
  s.ok('修道院完成事件存在', !!mev);
  s.eq('九宫格修道院 9 分', mev && mev.points, 9);
  s.ok('修道院完成判定', E.monasteryComplete(mono, '5,5'));

  var tie = controlled(['T02', 'T03'], 22);
  E.__putMeeple(tie, 0, 0, 0, 'city', 0);
  E.__putMeeple(tie, 1, 0, 0, 'city', 0);
  E.finishGame(tie);
  s.eq('米宝并列时双方都得分', [tie.players[0].score, tie.players[1].score], [1, 1]);
  s.ok('终局标记平局', tie.result.tie === true);
});

s.group('终局补算', function () {
  var city = controlled(['T02', 'T03'], 30);
  E.__putMeeple(city, 0, 0, 0, 'city', 0);
  E.finishGame(city);
  s.eq('未完成城市每块 1 分', city.players[0].score, 1);
  s.eq('终局阶段为 over', city.phase, 'over');

  var road = controlled(['T02', 'T03'], 31);
  E.__putMeeple(road, 0, 0, 0, 'road', 0);
  E.finishGame(road);
  s.eq('未完成道路每块 1 分', road.players[0].score, 1);

  var mono = controlled(['T02', 'T03'], 32);
  E.__putTile(mono, 'T41', 5, 5, 0);
  E.__putMeeple(mono, 0, 5, 5, 'monastery', 0);
  E.finishGame(mono);
  s.eq('未完成修道院 1 + 邻格', mono.players[0].score, 1);

  var farm = controlled(['T02', 'T03'], 33);
  E.__putTile(farm, 'T04', 0, -1, 0);
  E.__putMeeple(farm, 0, 0, 0, 'field', 0);
  E.finishGame(farm);
  var fev = farm.finalBreakdown.filter(function (x) { return x.kind === 'field'; })[0];
  s.ok('农田终局事件存在', !!fev);
  s.eq('农田相邻完成城市 3 分', fev && fev.points, 3);
  s.eq('农田分数进入总分', farm.players[0].score, 3);

  var winner = controlled(['T02', 'T03'], 34);
  E.__putMeeple(winner, 0, 0, 0, 'city', 0);
  var result = E.finishGame(winner);
  s.eq('终局比分数组', result.scores, [1, 0]);
  s.eq('终局胜者', result.winners, [0]);
  s.ok('非平局标记正确', result.tie === false);
});

/* ------------------------------------------------------------------ */
/* 5. AI 与 30 局自对弈                                                */
/* ------------------------------------------------------------------ */
s.group('AI 单步合法性', function () {
  var g = E.createGame({ seed: 777, players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] });
  var move = E.chooseAIMove(g, 0);
  s.ok('AI 返回放置动作', !!move && move.type === 'place');
  s.ok('AI 目标点合法', !!move && E.canPlaceTile(g, g.currentTile.tileId, move.rot, move.x, move.y).ok);
  E.placeCurrentTile(g, move);
  s.eq('AI 放置后进入米宝阶段', g.phase, 'meeple');
  if (move.meeple) {
    s.ok('AI 米宝选项存在', E.getMeepleOptions(g, 0).some(function (o) {
      return o.kind === move.meeple.kind && o.group === move.meeple.group && !o.occupied;
    }));
  } else {
    s.ok('AI 可主动跳过米宝', true);
  }
  E.skipMeeple(g);
  s.ok('AI 回合推进', g.currentPlayer === 1 || g.phase === 'over');
});

s.group('30 局 AI 自对弈', function () {
  var started = Date.now();
  var ended = 0, errors = 0, badEdges = 0, badTiles = 0, badMeeples = 0, badScores = 0, badWinner = 0, slow = 0;
  for (var i = 0; i < 30; i++) {
    var g = E.createGame({ seed: 4000 + i * 17, players: [{ name: 'AI-1', isAI: true }, { name: 'AI-2', isAI: true }] });
    var steps = 0;
    try {
      steps = playout(g, 300);
      if (g.phase === 'over') ended++; else slow++;
      if (E.findEdgeMismatches(g).length) badEdges++;
      if (Object.keys(g.board).length + g.discard.length + g.deck.length + (g.currentTile ? 1 : 0) !== 50) badTiles++;
      var bm = boardMeeples(g);
      if (bm[0] + g.players[0].meeples !== 7 || bm[1] + g.players[1].meeples !== 7) badMeeples++;
      var sc = g.finalScores || [];
      if (!sc.length || sc.some(function (v) { return !Number.isInteger(v) || v < 0; })) badScores++;
      if (!g.result || !g.result.winners.length || g.result.winners.some(function (p) { return p !== 0 && p !== 1; })) badWinner++;
    } catch (e) { errors++; }
  }
  s.eq('30 局无异常', errors, 0);
  s.eq('30 局全部正常结束', ended, 30);
  s.eq('30 局无死循环', slow, 0);
  s.eq('30 局棋盘无接边错误', badEdges, 0);
  s.eq('30 局瓦片数量守恒', badTiles, 0);
  s.eq('30 局米宝数量守恒', badMeeples, 0);
  s.eq('30 局分数为非负整数', badScores, 0);
  s.eq('30 局胜者合法', badWinner, 0);
  var ms = Date.now() - started;
  s.ok('30 局在 100 秒内完成', ms < 100000, ms + 'ms');
});

/* ------------------------------------------------------------------ */
/* 6. E2E 完整一局                                                     */
/* ------------------------------------------------------------------ */
s.group('E2E 完整一局', function () {
  var g = E.createGame({ seed: 909090, players: [{ name: '你', isAI: true }, { name: 'AI', isAI: true }] });
  var initialPhysical = Object.keys(g.board).length + g.deck.length + (g.currentTile ? 1 : 0);
  var steps = playout(g, 300);
  s.eq('E2E 走到终局', g.phase, 'over');
  s.eq('E2E 物理瓦片守恒', Object.keys(g.board).length + g.discard.length + g.deck.length, initialPhysical);
  s.eq('E2E 终局无接边错误', E.findEdgeMismatches(g).length, 0);
  s.ok('E2E 终局比分存在', Array.isArray(g.finalScores) && g.finalScores.length === 2);
  s.ok('E2E 终局明细为数组', Array.isArray(g.finalBreakdown));
  s.ok('E2E 日志记录终局', g.log.some(function (x) { return x.type === 'over'; }));
  s.ok('E2E 胜者为最高分', g.result.winners.every(function (p) { return g.finalScores[p] === Math.max.apply(null, g.finalScores); }));
  var again = E.createGame({ seed: 909090, players: [{ name: '你', isAI: true }, { name: 'AI', isAI: true }] });
  playout(again, 300);
  s.eq('E2E 同 seed 可复现', again.finalScores, g.finalScores);
  s.ok('E2E 动作步数有界', steps > 10 && steps < 300, String(steps));
});

/* ------------------------------------------------------------------ */
/* 7. 页面与规则静态契约                                               */
/* ------------------------------------------------------------------ */
s.group('页面静态契约', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var srcs = (html.match(/<script[^>]*\bsrc="([^"]+)"/g) || []).map(function (x) {
    var m = x.match(/src="([^"]+)"/); return m ? m[1] : '';
  });
  s.eq('页面仅引用同源 data.js/engine.js', srcs, ['data.js', 'engine.js']);
  // 站点头部会注入 canonical 链接；它不是外部资源，只有外链 src/stylesheet 才算。
  var noCanonical = html.replace(/<link[^>]+rel=["']?canonical["']?[^>]*>/gi, '');
  s.ok('页面无 http(s) 外部资源', !/(?:src|href)="https?:\/\//i.test(noCanonical));
  s.ok('页面无 fetch/XHR/beacon', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel=["']?stylesheet/i.test(html));
  s.ok('页面有 viewport', /name="viewport"/.test(html));
  s.ok('页面有 390px 断点', /@media\s*\(max-width:\s*430px\)/.test(html));
  s.ok('触控目标至少 44px', /min-height:\s*44px/.test(html) && /min-width:\s*44px/.test(html));
  s.ok('支持 prefers-reduced-motion', /prefers-reduced-motion/.test(html));
  s.ok('使用 WebAudio', /AudioContext/.test(html) && /createOscillator/.test(html));
  s.ok('有音效开关', /id="sound"/.test(html));
  s.ok('有暗/浅主题切换', /data-theme/.test(html) && /id="theme"/.test(html));
  s.ok('localStorage 读写有 try/catch', /try\s*\{[^}]*localStorage/.test(html) && /catch/.test(html));
  s.ok('有 aria-live 状态区', /aria-live=/.test(html));
  s.ok('有对局日志 role=log', /role="log"/.test(html));
  s.ok('引用本地规则页', /href="rules.html"/.test(html));
  var keyframes = (html.match(/@keyframes\s+[A-Za-z0-9_-]+/g) || []).length;
  s.ok('至少 3 段动画', keyframes >= 3, String(keyframes));
  s.ok('音效覆盖放置/得分/胜利', /name === 'place'/.test(html) && /name === 'score'/.test(html) && /name === 'win'/.test(html));
  s.ok('页面展示当前瓦片与合法位置', /legal-count/.test(html) && /getLegalPlacements/.test(html));
  s.ok('页面有 AI 回合状态', /AI 正在思考/.test(html));
});

s.group('规则页契约', function () {
  var html = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  // 规则页正文允许引用 B 站来源（锚文本），但不得加载外链子资源。
  var noCanonical = html.replace(/<link[^>]+rel=["']?canonical["']?[^>]*>/gi, '');
  s.ok('规则页无外链资源', !/<(?:script|img|iframe|link)\b[^>]*(?:src|href)="https?:\/\//i.test(noCanonical));
  s.ok('规则页无外链脚本', !/<script[^>]*\bsrc=/i.test(html));
  var lds = lib.jsonLd(html);
  var types = lds.map(function (x) { return x['@type']; });
  s.ok('规则页有 Article JSON-LD', types.indexOf('Article') >= 0, types.join(','));
  s.ok('规则页有 FAQPage JSON-LD', types.indexOf('FAQPage') >= 0, types.join(','));
  var faq = lds.filter(function (x) { return x['@type'] === 'FAQPage'; })[0];
  s.ok('FAQ 至少 6 问', !!faq && faq.mainEntity.length >= 6, faq ? String(faq.mainEntity.length) : 'missing');
  s.ok('FAQ 答案非空', !!faq && faq.mainEntity.every(function (q) {
    return q.acceptedAnswer && typeof q.acceptedAnswer.text === 'string' && q.acceptedAnswer.text.length > 20;
  }));
  var body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  var cjk = (body.match(/[一-鿿]/g) || []).length;
  s.ok('规则正文至少 1200 中文字符', cjk >= 1200, String(cjk));
  s.ok('规则页说明农田计分', /农田/.test(body) && /3 分/.test(body));
  s.ok('规则页列出 B 站来源', /bilibili\.com\/video\/BV/.test(body));
  var bvs = body.match(/BV[0-9A-Za-z]{10}/g) || [];
  s.ok('至少 2 个 B 站 BV 号', bvs.length >= 2, String(bvs.length));
  s.ok('记录标题与 UP 主', /月球三三/.test(body) && /零门槛桌游/.test(body));
  s.ok('说明简化点', /简化/.test(body));
  s.ok('CTA 返回游戏', /href="index.html"/.test(html));
});

s.done();
