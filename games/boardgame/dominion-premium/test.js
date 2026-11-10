'use strict';

/*
 * 领土 · Dominion Premium — 规则引擎 / 页面契约 / 30 局自对弈 / E2E
 * 直接 require 与页面同源的 data.js + engine.js。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('dominion-premium');
var D = require('./data.js');
var E = require('./engine.js');

function setState(g, pi, hand, deck, discard) {
  var p = g.players[pi];
  p.hand = (hand || []).slice();
  p.deck = (deck || []).slice();
  p.discard = (discard || []).slice();
  p.playArea = [];
  return g;
}
function playFull(g, cap) {
  var steps = 0;
  while (!g.over && steps < (cap || 1500)) {
    g = E.applyMove(g, E.aiMove(g));
    steps++;
  }
  return { state: g, steps: steps };
}
function totalCards(g) {
  return E.allCards(g.players[0]).length + E.allCards(g.players[1]).length +
    Object.keys(g.supply).reduce(function (n, id) { return n + g.supply[id]; }, 0);
}
function expectThrow(fn) {
  try { fn(); return false; } catch (e) { return true; }
}

/* ------------------------------------------------------------------ */
/* 1. 卡牌数据                                                         */
/* ------------------------------------------------------------------ */
s.group('卡牌与公共牌堆数据', function () {
  s.eq('14 种卡牌', D.CARDS.length, 14);
  s.eq('初始牌库 10 张', D.STARTING_DECK.length, 10);
  s.eq('初始 7 铜币', D.STARTING_DECK.filter(function (x) { return x === 'copper'; }).length, 7);
  s.eq('初始 3 庄园', D.STARTING_DECK.filter(function (x) { return x === 'estate'; }).length, 3);
  s.eq('起手 5 张', D.STARTING_HAND, 5);
  var ids = {};
  var badType = 0, badCost = 0;
  D.CARDS.forEach(function (c) {
    ids[c.id] = (ids[c.id] || 0) + 1;
    if (!D.TYPES[c.type]) badType++;
    if (!Number.isInteger(c.cost) || c.cost < 0) badCost++;
  });
  s.eq('卡牌 ID 唯一', Object.keys(ids).length, 14);
  s.eq('类型全部合法', badType, 0);
  s.eq('费用全部为非负整数', badCost, 0);
  s.ok('公共牌堆包含全部卡牌', D.CARDS.every(function (c) { return D.SUPPLY[c.id] > 0; }));
  s.ok('CARD_BY_ID 与 CARDS 对齐', D.CARDS.every(function (c) { return D.CARD_BY_ID[c.id] === c; }));
  s.eq('行省堆 12 张', D.SUPPLY.province, 12);
  s.eq('铜币堆 60 张', D.SUPPLY.copper, 60);
  s.ok('胜利卡有分值', D.CARDS.filter(function (c) { return c.type === 'victory'; }).every(function (c) { return c.vp > 0; }));
  s.ok('行动卡有效果', D.CARDS.filter(function (c) { return c.type === 'action'; }).every(function (c) {
    return c.cards || c.actions || c.buys || c.coins || c.gain || c.attack;
  }));
});

/* ------------------------------------------------------------------ */
/* 2. 开局                                                             */
/* ------------------------------------------------------------------ */
s.group('开局与确定性', function () {
  var g = E.createGame({ seed: 42 });
  s.eq('公共牌堆数量复制正确', g.supply, D.SUPPLY);
  s.eq('双方各抽 5 张', g.players.map(function (p) { return p.hand.length; }), [5, 5]);
  s.eq('双方牌库各剩 5 张', g.players.map(function (p) { return p.deck.length; }), [5, 5]);
  s.eq('双方起手无弃牌', g.players.map(function (p) { return p.discard.length; }), [0, 0]);
  s.eq('初始胜利卡 6 分（3 庄园）', E.score(g), { human: 6, ai: 6 });
  s.eq('阶段为行动', g.phase, 'action');
  s.eq('人类先手', g.turn, 0);
  s.eq('初始行动/购买/金币', [g.actions, g.buys, g.coins], [1, 1, 0]);
  s.eq('同 seed 抽牌一致', E.createGame({ seed: 9 }).players[0].hand.join(','), E.createGame({ seed: 9 }).players[0].hand.join(','));
  s.ok('异 seed 抽牌不同', E.createGame({ seed: 9 }).players[0].hand.join(',') !== E.createGame({ seed: 10 }).players[0].hand.join(','));
  s.eq('开局总牌数守恒', totalCards(g), Object.keys(D.SUPPLY).reduce(function (n, id) { return n + D.SUPPLY[id]; }, 0) + 20);
});

/* ------------------------------------------------------------------ */
/* 3. 阶段与合法动作                                                   */
/* ------------------------------------------------------------------ */
s.group('阶段与合法动作', function () {
  var g = E.createGame({ seed: 3 });
  var moves = E.legalMoves(g);
  s.ok('初始只有结束阶段动作', moves.every(function (m) { return m.type === 'endPhase'; }));
  s.eq('初始动作数 1', moves.length, 1);
  var buy1 = E.applyMove(g, { type: 'endPhase' });
  s.eq('结束行动进入购买', buy1.phase, 'buy');
  s.ok('财宝自动打出', buy1.players[0].playArea.every(function (id) { return E.cardOf(id).type === 'treasure'; }));
  s.eq('金币等于铜币数', buy1.coins, buy1.players[0].playArea.length);
  s.ok('购买阶段有买入或结束动作', E.legalMoves(buy1).some(function (m) { return m.type === 'endPhase'; }));
  s.ok('买不起行省时不可选', !E.legalMoves(buy1).some(function (m) { return m.type === 'buy' && m.cardId === 'province'; }));
  var buy2 = E.applyMove(buy1, { type: 'endPhase' });
  s.eq('结束购买后换手', buy2.turn, 1);
  s.eq('结束购买后回行动阶段', buy2.phase, 'action');
  s.eq('新回合重置资源', [buy2.actions, buy2.buys, buy2.coins], [1, 1, 0]);
  s.eq('新回合抽 5 张', buy2.players[0].hand.length, 5);
});

/* ------------------------------------------------------------------ */
/* 4. 行动牌效果                                                       */
/* ------------------------------------------------------------------ */
s.group('行动牌效果', function () {
  var v = E.createGame({ seed: 10 });
  setState(v, 0, ['village', 'copper', 'estate'], ['silver', 'gold', 'copper']);
  v = E.applyMove(v, { type: 'playAction', cardId: 'village' });
  s.eq('村庄 +2 行动（净 +1）', v.actions, 2);
  s.eq('村庄抽 1 张', v.players[0].hand.length, 3);
  s.eq('村庄进入已打出区', v.players[0].playArea, ['village']);

  var sm = E.createGame({ seed: 11 });
  setState(sm, 0, ['smithy'], ['copper', 'silver', 'gold', 'estate']);
  sm = E.applyMove(sm, { type: 'playAction', cardId: 'smithy' });
  s.eq('铁匠抽 3 张', sm.players[0].hand.length, 3);
  s.eq('铁匠不增加行动', sm.actions, 0);

  var mk = E.createGame({ seed: 12 });
  setState(mk, 0, ['market'], ['copper']);
  mk = E.applyMove(mk, { type: 'playAction', cardId: 'market' });
  s.eq('市场净行动仍为 1', mk.actions, 1);
  s.eq('市场 +1 购买', mk.buys, 2);
  s.eq('市场 +1 金币', mk.coins, 1);
  s.eq('市场抽 1 张', mk.players[0].hand.length, 1);

  var ml = E.createGame({ seed: 13 });
  setState(ml, 0, ['militia'], ['copper']);
  setState(ml, 1, ['gold', 'silver', 'copper', 'estate', 'province'], [], []);
  ml = E.applyMove(ml, { type: 'playAction', cardId: 'militia' });
  s.eq('民兵 +2 金币', ml.coins, 2);
  s.eq('对手被弃到 3 张', ml.players[1].hand.length, 3);
  s.eq('对手弃掉 2 张', ml.players[1].discard.length, 2);
  s.ok('对手保留高价值牌', ml.players[1].hand.indexOf('gold') >= 0 && ml.players[1].hand.indexOf('estate') < 0);

  var wk = E.createGame({ seed: 14 });
  var silverBefore = wk.supply.silver;
  setState(wk, 0, ['workshop'], []);
  wk = E.applyMove(wk, { type: 'playAction', cardId: 'workshop' });
  s.eq('工坊消耗一张银币堆', wk.supply.silver, silverBefore - 1);
  s.eq('工坊把银币放入弃牌堆', wk.players[0].discard, ['silver']);

  var fe = E.createGame({ seed: 15 });
  setState(fe, 0, ['festival'], []);
  fe = E.applyMove(fe, { type: 'playAction', cardId: 'festival' });
  s.eq('节庆净 +1 行动', fe.actions, 2);
  s.eq('节庆 +1 购买', fe.buys, 2);
  s.eq('节庆 +2 金币', fe.coins, 2);

  var lb = E.createGame({ seed: 16 });
  setState(lb, 0, ['laboratory'], ['copper', 'silver', 'gold']);
  lb = E.applyMove(lb, { type: 'playAction', cardId: 'laboratory' });
  s.eq('实验室抽 2 张', lb.players[0].hand.length, 2);
  s.eq('实验室净行动 1', lb.actions, 1);

  var ce = E.createGame({ seed: 17 });
  setState(ce, 0, ['cellar'], ['copper', 'silver']);
  ce = E.applyMove(ce, { type: 'playAction', cardId: 'cellar' });
  s.eq('地窖抽 1 张', ce.players[0].hand.length, 1);
  s.eq('地窖净行动 1', ce.actions, 1);
});

/* ------------------------------------------------------------------ */
/* 5. 购买、弃牌与终局                                                 */
/* ------------------------------------------------------------------ */
s.group('购买与结算', function () {
  var g = E.createGame({ seed: 20 });
  g.phase = 'buy'; g.turn = 0; g.coins = 10; g.buys = 1;
  var silverBefore = g.supply.silver;
  var b = E.applyMove(g, { type: 'buy', cardId: 'silver' });
  s.eq('买银币扣 3 金币', b.coins, 7);
  s.eq('买入消耗购买次数', b.buys, 0);
  s.eq('公共银币堆减一', b.supply.silver, silverBefore - 1);
  s.ok('银币进入弃牌堆', b.players[0].discard.indexOf('silver') >= 0);
  s.ok('没有购买次数后不能再买', !E.legalMoves(b).some(function (m) { return m.type === 'buy'; }));

  var poor = E.createGame({ seed: 21 });
  poor.phase = 'buy'; poor.coins = 2; poor.buys = 1;
  s.ok('金币不足买银币被拒绝', expectThrow(function () { E.applyMove(poor, { type: 'buy', cardId: 'silver' }); }));

  var prov = E.createGame({ seed: 22 });
  prov.phase = 'buy'; prov.coins = 8; prov.buys = 1;
  var pBefore = prov.supply.province;
  prov = E.applyMove(prov, { type: 'buy', cardId: 'province' });
  s.eq('买行省扣 8 金币', prov.coins, 0);
  s.eq('行省堆减一', prov.supply.province, pBefore - 1);

  var end = E.createGame({ seed: 23 });
  setState(end, 0, ['copper', 'copper', 'estate'], []);
  end = E.applyMove(end, { type: 'endPhase' });
  s.eq('结束行动自动结算两张铜币', end.coins, 2);
  s.eq('财宝进入已打出区', end.players[0].playArea.length, 2);
  s.eq('庄园留在手中', end.players[0].hand, ['estate']);

  var clean = E.createGame({ seed: 24 });
  clean.phase = 'buy'; clean.turn = 0;
  clean.players[0].hand = ['copper']; clean.players[0].discard = ['silver'];
  var c = E.applyMove(clean, { type: 'endPhase' });
  s.eq('回合结束抽满 5 张', c.players[0].hand.length, 5);
  s.eq('回合结束进入 AI 行动', c.turn, 1);
  s.eq('回合结束重置阶段', c.phase, 'action');
});

s.group('终局条件与计分', function () {
  var prov = E.createGame({ seed: 30 });
  prov.supply.province = 0; prov.phase = 'buy'; prov.turn = 0;
  prov = E.applyMove(prov, { type: 'endPhase' });
  s.ok('行省堆空触发终局', prov.over);
  s.eq('终局原因', prov.result.reason, '行省堆耗尽');
  s.ok('终局后无合法动作', E.legalMoves(prov).length === 0);

  var three = E.createGame({ seed: 31 });
  three.supply.village = 0; three.supply.smithy = 0; three.supply.market = 0;
  three.phase = 'buy'; three.turn = 0;
  three = E.applyMove(three, { type: 'endPhase' });
  s.ok('三个牌堆空触发终局', three.over);
  s.eq('三堆终局原因', three.result.reason, '三个牌堆耗尽');

  var sc = E.createGame({ seed: 32 });
  sc.players[0].hand = ['province', 'duchy', 'estate'];
  sc.players[0].deck = ['estate', 'copper'];
  sc.players[0].discard = ['province'];
  sc.players[1].hand = ['estate'];
  sc.players[1].deck = [];
  sc.players[1].discard = [];
  sc.players[1].playArea = [];
  s.eq('胜利卡跨区域计分', E.score(sc), { human: 19, ai: 2 });
  var bd = E.breakdown(sc, 0);
  s.eq('庄园明细 2 张', bd.estate, 2);
  s.eq('公国明细 1 张', bd.duchy, 1);
  s.eq('行省明细 2 张', bd.province, 2);
  sc.over = true;
  s.eq('分数高者获胜', E.winner(sc), 'human');

  var tie = E.createGame({ seed: 33 });
  [0, 1].forEach(function (pi) {
    tie.players[pi].hand = ['estate'];
    tie.players[pi].deck = [];
    tie.players[pi].discard = [];
    tie.players[pi].playArea = [];
  });
  tie.over = true;
  s.eq('同分平局', E.winner(tie), 'tie');
  s.ok('未结束时 winner 为 null', E.winner(E.createGame({ seed: 34 })) === null);
});

/* ------------------------------------------------------------------ */
/* 6. AI 与 30 局自对弈                                                */
/* ------------------------------------------------------------------ */
s.group('AI 单步合法性', function () {
  var g = E.createGame({ seed: 40 });
  var ok = true, steps = 0;
  try {
    for (var i = 0; i < 60 && !g.over; i++) {
      g = E.applyMove(g, E.aiMove(g));
      steps++;
    }
  } catch (e) { ok = false; }
  s.ok('AI 连续 60 个动作合法', ok);
  s.ok('AI 能推进对局', steps >= 10, String(steps));
  s.ok('AI 行动后状态自洽', g.actions >= 0 && g.buys >= 0 && g.coins >= 0);
  s.ok('AI 不产生负牌堆', Object.keys(g.supply).every(function (id) { return g.supply[id] >= 0; }));
});

s.group('30 局 AI 自对弈', function () {
  var started = Date.now();
  var ended = 0, errors = 0, badScores = 0, badSupply = 0, badTotal = 0, badResult = 0, slow = 0;
  var initialTotal = Object.keys(D.SUPPLY).reduce(function (n, id) { return n + D.SUPPLY[id]; }, 0) + 20;
  for (var i = 0; i < 30; i++) {
    var g = E.createGame({ seed: 7000 + i * 13 });
    var steps = 0;
    try {
      var run = playFull(g, 1500);
      g = run.state;
      steps = run.steps;
      if (g.over) ended++; else slow++;
      var sc = E.score(g);
      if (!Number.isInteger(sc.human) || !Number.isInteger(sc.ai) || sc.human < 0 || sc.ai < 0) badScores++;
      if (Object.keys(g.supply).some(function (id) { return g.supply[id] < 0 || !Number.isInteger(g.supply[id]); })) badSupply++;
      if (totalCards(g) !== initialTotal) badTotal++;
      if (!g.result || !['human', 'ai', 'tie'].includes(g.result.winner) || typeof g.result.reason !== 'string') badResult++;
    } catch (e) { errors++; }
  }
  s.eq('30 局无异常', errors, 0);
  s.eq('30 局全部终局', ended, 30);
  s.eq('30 局无死循环', slow, 0);
  s.eq('30 局分数为非负整数', badScores, 0);
  s.eq('30 局公共牌堆非负', badSupply, 0);
  s.eq('30 局总牌数守恒', badTotal, 0);
  s.eq('30 局终局结果合法', badResult, 0);
  var ms = Date.now() - started;
  s.ok('30 局在 100 秒内完成', ms < 100000, ms + 'ms');
});

/* ------------------------------------------------------------------ */
/* 7. E2E 完整一局                                                     */
/* ------------------------------------------------------------------ */
s.group('E2E 完整一局', function () {
  var g = E.createGame({ seed: 987654 });
  var run = playFull(g, 1500);
  g = run.state;
  var steps = run.steps;
  s.eq('E2E 走到终局', g.over, true);
  s.ok('E2E 终局有原因', !!g.result && typeof g.result.reason === 'string');
  s.ok('E2E 总分非负且有限', E.score(g).human >= 0 && E.score(g).ai >= 0);
  s.ok('E2E 空堆达到触发条件', g.supply.province <= 0 || E.emptyPileCount(g) >= 3);
  s.ok('E2E 日志记录终局', g.log.some(function (x) { return x.type === 'over'; }));
  s.ok('E2E 步数有界', steps > 20 && steps < 1500, String(steps));
  var again = E.createGame({ seed: 987654 });
  again = playFull(again, 1500).state;
  s.eq('E2E 同 seed 可复现', E.score(again), E.score(g));
  s.eq('E2E 双方总牌数不变', totalCards(g), Object.keys(D.SUPPLY).reduce(function (n, id) { return n + D.SUPPLY[id]; }, 0) + 20);
  s.ok('E2E 胜者与分数一致', g.result.winner === (E.score(g).human > E.score(g).ai ? 'human' : E.score(g).human < E.score(g).ai ? 'ai' : 'tie'));
});

/* ------------------------------------------------------------------ */
/* 8. 页面与规则静态契约                                               */
/* ------------------------------------------------------------------ */
s.group('页面静态契约', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
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
  s.ok('触控目标至少 44px', /min-height:44px/.test(html) && /min-width:44px/.test(html));
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
  s.ok('音效覆盖出牌/购买/胜利', /name === 'play'/.test(html) && /name === 'buy'/.test(html) && /name === 'win'/.test(html));
  s.ok('渲染全部 14 张公共牌', /E\.CARDS\.map/.test(html));
  s.ok('有阶段、金币、行动、购买显示', /phase-action/.test(html) && /id="coins"/.test(html) && /id="actions"/.test(html) && /id="buys"/.test(html));
  s.ok('有 AI 回合提示', /AI 正在构筑牌库/.test(html));
  s.ok('卡面使用内联 SVG 图标', /function icon\(/.test(html) && /<svg viewBox="0 0 40 32"/.test(html));
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
  s.ok('规则页说明行动/购买两阶段', /行动阶段/.test(body) && /购买阶段/.test(body));
  s.ok('规则页说明三堆终局', /三个牌堆/.test(body));
  s.ok('规则页列出 B 站来源', /bilibili\.com\/video\/BV/.test(body));
  var bvs = body.match(/BV[0-9A-Za-z]{10}/g) || [];
  s.ok('至少 2 个 B 站 BV 号', bvs.length >= 2, String(bvs.length));
  s.ok('记录标题与 UP 主', /桌游怎么玩/.test(body) && /第九艺术搬运工/.test(body));
  s.ok('说明简化点', /简化/.test(body));
  s.ok('CTA 返回游戏', /href="index.html"/.test(html));
});

s.done();
