'use strict';

/*
 * Hero Realms（英雄领域）简化版 — 引擎与页面契约测试。
 * 直接 require 与页面相同的 engine.js / data.js，不依赖浏览器。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('hero-realms');
var E = require('./engine.js');
var D = require('./data.js');

function fresh(opts) {
  opts = opts || {};
  if (!opts.cards) opts.cards = D;
  if (opts.seed == null) opts.seed = 21;
  return E.createGame(opts);
}

function repeat(id, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(id);
  return out;
}

function throws(label, fn) {
  var ok = false;
  try { fn(); } catch (e) { ok = true; }
  s.ok(label, ok);
}

function validState(g) {
  if (!g || !g.sides || !g.cards) return false;
  if (E.SIDES.indexOf(g.turn) < 0) return false;
  var ok = true;
  E.SIDES.forEach(function (side) {
    var p = g.sides[side];
    if (!(p.hp >= 0 && p.hp <= p.maxHp)) ok = false;
    if (!(p.armor >= 0)) ok = false;
    if (!(p.gold >= 0)) ok = false;
    if (!Array.isArray(p.deck) || !Array.isArray(p.hand) ||
        !Array.isArray(p.discard) || !Array.isArray(p.played) ||
        !Array.isArray(p.champions)) ok = false;
    p.deck.concat(p.hand, p.discard, p.played).forEach(function (id) {
      if (!g.cards[id]) ok = false;
    });
    p.champions.forEach(function (ch) {
      if (!g.cards[ch.cardId]) ok = false;
      if (!(ch.hp > 0 && ch.hp <= ch.maxHp)) ok = false;
    });
  });
  g.market.forEach(function (id) { if (!g.cards[id]) ok = false; });
  g.marketDeck.forEach(function (id) { if (!g.cards[id]) ok = false; });
  if (g.winner) {
    var loser = E.otherSide(g.winner);
    if (g.sides[loser].hp !== 0) ok = false;
  }
  return ok;
}

/* ------------------------------------------------------------------ */
s.group('卡牌数据', function () {
  s.eq('共 28 张卡牌定义', D.cards.length, 28);
  var market = D.cards.filter(function (c) { return !c.starting; });
  s.eq('市场牌 26 张', market.length, 26);
  s.ok('市场牌数量在 20–30 之间', market.length >= 20 && market.length <= 30);
  var ids = {};
  var dup = false;
  D.cards.forEach(function (c) { if (ids[c.id]) dup = true; ids[c.id] = true; });
  s.ok('卡牌 id 唯一', !dup);
  s.eq('起始牌组为 7 金币 + 3 匕首', D.startingDeck.map(function (x) { return [x.id, x.count]; }),
    [['gold', 7], ['dagger', 3]]);
  s.eq('金币与匕首不在市场', market.filter(function (c) {
    return c.id === 'gold' || c.id === 'dagger';
  }).length, 0);

  var types = {};
  D.cards.forEach(function (c) { types[c.type] = true; });
  ['gold', 'gem', 'weapon', 'spell', 'champion'].forEach(function (t) {
    s.ok('包含类型 ' + t, !!types[t]);
  });
  var champs = D.cards.filter(function (c) { return c.type === 'champion'; });
  s.ok('至少 5 名冠军', champs.length >= 5);
  s.ok('冠军都有防御力', champs.every(function (c) { return c.defense > 0; }));
  s.ok('冠军都有能力', champs.every(function (c) {
    return c.ability && typeof c.ability.type === 'string' && c.ability.amount > 0;
  }));
  s.ok('市场牌都有价格与文案', market.every(function (c) {
    return c.cost >= 2 && typeof c.text === 'string' && c.text.length > 0;
  }));
  s.ok('卡面都有双色渐变', D.cards.every(function (c) {
    return Array.isArray(c.gradient) && c.gradient.length === 2 &&
      c.gradient.every(function (x) { return /^#[0-9a-f]{6}$/i.test(x); });
  }));
  s.ok('五种类型都有中文标签', ['gold', 'gem', 'weapon', 'spell', 'champion'].every(function (t) {
    return typeof D.typeLabels[t] === 'string' && D.typeLabels[t].length > 0;
  }));
});

/* ------------------------------------------------------------------ */
s.group('开局与确定性', function () {
  var g = fresh({ seed: 42 });
  s.eq('两名玩家', Object.keys(g.sides).length, 2);
  s.eq('双方 50 HP', [g.sides.player.hp, g.sides.ai.hp], [50, 50]);
  s.eq('最大生命 50', g.sides.player.maxHp, 50);
  s.eq('玩家先手', g.turn, 'player');
  s.eq('第 1 回合', g.turnNumber, 1);
  s.eq('起始手牌 5 张', g.sides.player.hand.length, 5);
  s.eq('玩家牌库剩 5 张', g.sides.player.deck.length, 5);
  s.eq('玩家弃牌堆为空', g.sides.player.discard.length, 0);
  s.eq('玩家出牌区为空', g.sides.player.played.length, 0);
  s.eq('玩家金币为 0', g.sides.player.gold, 0);
  s.eq('玩家护甲为 0', g.sides.player.armor, 0);
  s.eq('AI 尚未抽手牌', g.sides.ai.hand.length, 0);
  s.eq('AI 牌库 10 张', g.sides.ai.deck.length, 10);
  s.eq('市场 5 张', g.market.length, 5);
  s.eq('补牌堆 21 张', g.marketDeck.length, 21);
  s.eq('市场与补牌堆无交集', g.market.filter(function (id) {
    return g.marketDeck.indexOf(id) >= 0;
  }).length, 0);
  s.ok('state 可 JSON 序列化', (function () {
    try { JSON.parse(JSON.stringify(g)); return true; } catch (e) { return false; }
  })());

  var a = fresh({ seed: 9 });
  var b = fresh({ seed: 9 });
  s.eq('同种子市场一致', a.market, b.market);
  s.eq('同种子玩家手牌一致', a.sides.player.hand, b.sides.player.hand);
  s.eq('同种子玩家牌库一致', a.sides.player.deck, b.sides.player.deck);
  s.eq('同种子 AI 牌库一致', a.sides.ai.deck, b.sides.ai.deck);
  var c = fresh({ seed: 10 });
  s.ok('不同种子洗牌结果不同',
    JSON.stringify([a.market, a.sides.player.hand, a.sides.player.deck]) !==
    JSON.stringify([c.market, c.sides.player.hand, c.sides.player.deck]));

  var before = JSON.stringify(g);
  E.legalActions(g, 'player');
  E.aiAction(g, 'player');
  s.eq('查询合法动作不修改 state', JSON.stringify(g), before);

  var aiFirst = fresh({ firstSide: 'ai', seed: 5 });
  s.eq('AI 先手时 AI 抽 5 张', aiFirst.sides.ai.hand.length, 5);
  s.eq('AI 先手时玩家不抽牌', aiFirst.sides.player.hand.length, 0);
  s.eq('AI 先手时回合属于 AI', aiFirst.turn, 'ai');

  var low = fresh({ hp: 20 });
  s.eq('可覆盖初始生命', [low.sides.player.hp, low.sides.ai.hp], [20, 20]);
});

/* ------------------------------------------------------------------ */
s.group('抽牌与洗回', function () {
  var g = fresh({
    seed: 3,
    decks: { player: repeat('gold', 6), ai: ['dagger'] },
    shuffle: false
  });
  s.eq('自定义牌库起手 5', g.sides.player.hand.length, 5);
  s.eq('自定义牌库剩 1', g.sides.player.deck.length, 1);
  for (var i = 0; i < 5; i++) g = E.playCard(g, 'player', 0);
  s.eq('5 张金币全部打出', [g.sides.player.hand.length, g.sides.player.played.length], [0, 5]);
  s.eq('金币累计 5', g.sides.player.gold, 5);
  g = E.endTurn(g, 'player');
  s.eq('结束回合后金币清零', g.sides.player.gold, 0);
  s.eq('结束回合后手牌入弃牌堆', g.sides.player.discard.length, 5);
  s.eq('轮到 AI', g.turn, 'ai');
  s.eq('AI 抽到唯一一张牌', g.sides.ai.hand.length, 1);
  g = E.endTurn(g, 'ai');
  s.eq('回到玩家回合', g.turn, 'player');
  s.eq('洗回后抽满 5 张', g.sides.player.hand.length, 5);
  s.eq('洗回后牌库剩 1', g.sides.player.deck.length, 1);
  s.eq('洗回后弃牌堆清空', g.sides.player.discard.length, 0);
  s.ok('日志记录弃牌堆洗回', g.log.some(function (l) {
    return l.text.indexOf('弃牌堆洗回') >= 0;
  }));

  var empty = fresh({ seed: 4, decks: { player: [], ai: [] } });
  s.eq('空牌库起手 0', empty.sides.player.hand.length, 0);
  empty = E.endTurn(empty, 'player');
  empty = E.endTurn(empty, 'ai');
  s.eq('牌库与弃牌堆都空时不抽牌', empty.sides.player.hand.length, 0);
  s.ok('日志记录无牌可抽', empty.log.some(function (l) {
    return l.text.indexOf('没有可抽的牌') >= 0;
  }));
});

/* ------------------------------------------------------------------ */
s.group('金币与护甲', function () {
  var g = fresh({ seed: 5, decks: { player: repeat('gold', 5), ai: [] }, shuffle: false });
  g = E.playCard(g, 'player', 0);
  s.eq('打出一张金币得 1 金币', g.sides.player.gold, 1);
  g = E.playCard(g, 'player', 0);
  s.eq('两张金币累计 2', g.sides.player.gold, 2);

  var armor = fresh({ seed: 6, decks: { player: ['shield-wall'], ai: ['short-sword'] }, shuffle: false });
  armor = E.playCard(armor, 'player', 0);
  s.eq('盾墙提供 4 护甲', armor.sides.player.armor, 4);
  armor = E.endTurn(armor, 'player');
  s.eq('护甲在对手回合仍保留', armor.sides.player.armor, 4);
  armor = E.playCard(armor, 'ai', 0);
  s.eq('护甲吸收 2 点伤害后剩 2', armor.sides.player.armor, 2);
  s.eq('护甲完全吸收时 HP 不变', armor.sides.player.hp, 50);
  armor = E.endTurn(armor, 'ai');
  s.eq('自己回合开始时护甲重置', armor.sides.player.armor, 0);
});

/* ------------------------------------------------------------------ */
s.group('伤害与治疗', function () {
  var g = fresh({ seed: 7, decks: { player: repeat('dagger', 5), ai: [] }, shuffle: false });
  g = E.playCard(g, 'player', 0);
  s.eq('匕首造成 1 点伤害', g.sides.ai.hp, 49);

  var ruby = fresh({ seed: 8, decks: { player: ['ruby'], ai: [] }, shuffle: false });
  ruby = E.playCard(ruby, 'player', 0);
  s.eq('红宝石同时给金币和伤害', [ruby.sides.player.gold, ruby.sides.ai.hp], [2, 49]);

  var heal = fresh({ seed: 9, decks: { player: repeat('heal-prayer', 2), ai: [] }, shuffle: false });
  heal.sides.player.hp = 47;
  heal = E.playCard(heal, 'player', 0);
  s.eq('治疗恢复 3 点（不超过上限）', heal.sides.player.hp, 50);
  heal.sides.player.hp = 50;
  heal = E.playCard(heal, 'player', 0);
  s.eq('满血时治疗不会溢出', heal.sides.player.hp, 50);
  s.ok('日志记录实际治疗量', heal.log.some(function (l) {
    return l.text.indexOf('恢复 1 点生命') >= 0 || l.text.indexOf('恢复 0 点生命') >= 0;
  }));

  var lethal = fresh({ seed: 10, decks: { player: ['wrath'], ai: [] }, shuffle: false });
  lethal.sides.ai.hp = 5;
  lethal = E.playCard(lethal, 'player', 0);
  s.eq('致命伤害将 HP 压到 0', lethal.sides.ai.hp, 0);
  s.eq('HP 归零判负', lethal.winner, 'player');
  s.eq('winner() 返回胜者', E.winner(lethal), 'player');

  // 冠军作为伤害目标
  var ch = fresh({
    seed: 11, firstSide: 'ai',
    decks: { player: repeat('fireball', 5), ai: ['shield-bearer'] },
    shuffle: false
  });
  ch = E.playCard(ch, 'ai', 0);
  ch = E.endTurn(ch, 'ai');
  s.eq('AI 冠军在场上', ch.sides.ai.champions.length, 1);
  var uid = ch.sides.ai.champions[0].uid;
  ch = E.playCard(ch, 'player', 0, { kind: 'champion', uid: uid });
  s.eq('火球命中冠军：5 防御剩 1', ch.sides.ai.champions[0].hp, 1);
  s.eq('冠军受伤不影响玩家 HP', [ch.sides.ai.hp, ch.sides.player.hp], [50, 50]);
  ch = E.playCard(ch, 'player', 0, { kind: 'champion', uid: uid });
  s.eq('冠军被击杀后离场', ch.sides.ai.champions.length, 0);
  s.ok('被击杀的冠军进入其主人弃牌堆', ch.sides.ai.discard.indexOf('shield-bearer') >= 0);

  throws('不存在冠军目标时报错', function () {
    E.playCard(ch, 'player', 0, { kind: 'champion', uid: 99999 });
  });
});

/* ------------------------------------------------------------------ */
s.group('市场购买', function () {
  var market = ['silver', 'short-sword', 'longbow', 'fireball', 'wrath'];
  var g = fresh({
    seed: 12,
    decks: { player: repeat('gold', 5), ai: [] },
    market: market,
    marketDeck: ['diamond'],
    shuffle: false
  });
  s.eq('市场初始 5 张', g.market, market);
  g = E.playCard(g, 'player', 0);
  g = E.playCard(g, 'player', 0);
  s.eq('购买前有 2 金币', g.sides.player.gold, 2);
  g = E.buyCard(g, 'player', 0);
  s.eq('购买银币扣除 2 金币', g.sides.player.gold, 0);
  s.ok('购买的牌进入弃牌堆', g.sides.player.discard.indexOf('silver') >= 0);
  s.eq('购买的牌不在手牌', g.sides.player.hand.indexOf('silver'), -1);
  s.eq('市场补入钻石', g.market[0], 'diamond');
  s.eq('市场保持 5 张', g.market.length, 5);
  s.eq('补牌堆减少到 0', g.marketDeck.length, 0);
  s.ok('本回合已购买标记', g.sides.player.boughtThisTurn === true);
  throws('每回合只能购买一次', function () { E.buyCard(g, 'player', 1); });
  g = E.endTurn(g, 'player');
  g = E.endTurn(g, 'ai');
  s.ok('新回合可以再次购买', g.sides.player.boughtThisTurn === false);

  var poor = fresh({
    seed: 13, decks: { player: ['gold'], ai: [] },
    market: ['silver'], marketDeck: [], shuffle: false
  });
  poor = E.playCard(poor, 'player', 0);
  s.eq('只有 1 金币', poor.sides.player.gold, 1);
  throws('金币不足不能购买', function () { E.buyCard(poor, 'player', 0); });
  throws('非法市场位置报错', function () { E.buyCard(poor, 'player', 9); });

  var champBuy = fresh({
    seed: 14, decks: { player: repeat('gold', 5), ai: [] },
    market: ['guard-captain'], marketDeck: [], shuffle: false
  });
  champBuy = E.playCard(champBuy, 'player', 0);
  champBuy = E.playCard(champBuy, 'player', 0);
  champBuy = E.playCard(champBuy, 'player', 0);
  champBuy = E.buyCard(champBuy, 'player', 0);
  s.ok('购买冠军牌先进入弃牌堆', champBuy.sides.player.discard.indexOf('guard-captain') >= 0);
  s.eq('购买不会直接上场', champBuy.sides.player.champions.length, 0);
  s.eq('补牌堆为空时市场变短', champBuy.market.length, 0);
});

/* ------------------------------------------------------------------ */
s.group('冠军逻辑', function () {
  var g = fresh({ seed: 15, decks: { player: ['guard-captain'], ai: [] }, shuffle: false });
  g = E.playCard(g, 'player', 0);
  s.eq('冠军进入冠军区', g.sides.player.champions.length, 1);
  s.eq('冠军防御为 4', g.sides.player.champions[0].hp, 4);
  s.eq('冠军牌不进入本回合弃牌循环', [g.sides.player.hand.length, g.sides.player.played.length], [0, 0]);
  var uid = g.sides.player.champions[0].uid;
  g = E.activateChampion(g, 'player', uid);
  s.eq('冠军能力造成 2 点伤害', g.sides.ai.hp, 48);
  s.ok('激活后标记已使用', g.sides.player.champions[0].used === true);
  throws('同一回合不能重复激活', function () { E.activateChampion(g, 'player', uid); });
  g = E.endTurn(g, 'player');
  g = E.endTurn(g, 'ai');
  s.ok('新回合重置冠军激活状态', g.sides.player.champions[0].used === false);

  var maxed = fresh({ seed: 16, decks: { player: repeat('shield-bearer', 5), ai: [] }, shuffle: false });
  for (var i = 0; i < 4; i++) maxed = E.playCard(maxed, 'player', 0);
  s.eq('冠军区上限 4 名', maxed.sides.player.champions.length, 4);
  throws('冠军区满时不能继续打出', function () { E.playCard(maxed, 'player', 0); });
  s.ok('合法动作不再包含冠军牌', E.legalActions(maxed, 'player').every(function (a) {
    return a.type !== 'play';
  }));

  var merchant = fresh({ seed: 17, decks: { player: ['merchant'], ai: [] }, shuffle: false });
  merchant = E.playCard(merchant, 'player', 0);
  merchant = E.activateChampion(merchant, 'player', merchant.sides.player.champions[0].uid);
  s.eq('商人能力 +2 金币', merchant.sides.player.gold, 2);

  var priest = fresh({ seed: 18, decks: { player: ['priestess'], ai: [] }, shuffle: false });
  priest = E.playCard(priest, 'player', 0);
  priest.sides.player.hp = 40;
  priest = E.activateChampion(priest, 'player', priest.sides.player.champions[0].uid);
  s.eq('女祭司能力恢复 3 点', priest.sides.player.hp, 43);

  var two = fresh({ seed: 19, decks: { player: repeat('shield-bearer', 2), ai: [] }, shuffle: false });
  two = E.playCard(two, 'player', 0);
  two = E.playCard(two, 'player', 0);
  var uids = two.sides.player.champions.map(function (c) { return c.uid; });
  two = E.activateChampion(two, 'player', uids[0]);
  two = E.activateChampion(two, 'player', uids[1]);
  s.eq('两名冠军可以分别激活', two.sides.player.armor, 4);
});

/* ------------------------------------------------------------------ */
s.group('合法动作与 AI', function () {
  var g = fresh({ seed: 20 });
  var actions = E.legalActions(g, 'player');
  s.ok('玩家有合法动作', actions.length > 0);
  s.ok('合法动作包含结束回合', actions.some(function (a) { return a.type === 'endTurn'; }));
  s.eq('非当前回合没有合法动作', E.legalActions(g, 'ai').length, 0);
  s.eq('非当前回合 AI 不行动', E.aiAction(g, 'ai'), null);

  var bad = 0;
  actions.forEach(function (a) {
    try { E.applyAction(g, a); } catch (e) { bad++; }
  });
  s.eq('所有玩家合法动作都能执行', bad, 0);
  s.eq('查询合法动作不会改动原 state', g.sides.player.hand.length, 5);

  var aiGame = fresh({ seed: 21, firstSide: 'ai' });
  var aiActions = E.legalActions(aiGame, 'ai');
  s.ok('AI 回合有合法动作', aiActions.length > 0);
  var aiBad = 0;
  aiActions.forEach(function (a) {
    try { E.applyAction(aiGame, a); } catch (e) { aiBad++; }
  });
  s.eq('所有 AI 合法动作都能执行', aiBad, 0);

  var one = E.aiAction(aiGame, 'ai');
  s.ok('aiAction 返回动作', !!one && typeof one.type === 'string');
  var after = E.applyAction(aiGame, one);
  s.ok('AI 动作执行后状态合法', validState(after));

  var done = fresh({ seed: 22 });
  done.winner = 'player';
  s.eq('游戏结束后 AI 不行动', E.aiAction(done, 'ai'), null);
  s.eq('游戏结束后没有合法动作', E.legalActions(done, 'player').length, 0);
  throws('游戏结束后不能再出牌', function () { E.playCard(done, 'player', 0); });

  var aiWin = fresh({ seed: 23, firstSide: 'ai', decks: { player: ['gold'], ai: ['dagger'] }, shuffle: false });
  aiWin.sides.player.hp = 1;
  aiWin = E.playCard(aiWin, 'ai', 0);
  s.eq('AI 也能获胜', aiWin.winner, 'ai');
});

/* ------------------------------------------------------------------ */
s.group('50 局 AI 自对弈', function () {
  var noWinner = 0;
  var invalid = 0;
  var maxActions = 0;
  var wins = { player: 0, ai: 0 };
  for (var seed = 1; seed <= 50; seed++) {
    var g = fresh({ seed: seed });
    var steps = 0;
    while (!g.winner && steps < 1200) {
      var action = E.aiAction(g, g.turn);
      if (!action) break;
      g = E.applyAction(g, action);
      steps++;
      if (!validState(g)) invalid++;
    }
    if (!g.winner) noWinner++;
    else wins[g.winner]++;
    if (steps > maxActions) maxActions = steps;
    s.ok('种子 ' + seed + ' 分出胜负', !!g.winner);
    s.ok('种子 ' + seed + ' 终局状态合法', validState(g));
  }
  s.eq('50 局全部分出胜负', noWinner, 0);
  s.eq('50 局过程中没有非法状态', invalid, 0);
  s.ok('单局动作数有界（<1200）', maxActions < 1200);
  s.eq('胜者统计覆盖 50 局', wins.player + wins.ai, 50);
  s.ok('AI 对 AI 双方都能获胜', wins.player > 0 && wins.ai > 0);
});

/* ------------------------------------------------------------------ */
s.group('页面契约', function () {
  var html = lib.page(__dirname);
  s.ok('index.html 存在且非空', html.length > 2000);
  s.ok('加载本地 data.js', /<script[^>]+src="data\.js"/.test(html));
  s.ok('加载本地 engine.js', /<script[^>]+src="engine\.js"/.test(html));
  s.ok('不引用远程脚本/样式', !/(?:src|href)\s*=\s*["']https?:/i.test(html));
  s.ok('不使用 fetch/XHR', !/\bfetch\s*\(/.test(html) && !/XMLHttpRequest/.test(html));
  s.ok('包含 viewport 元信息', /name="viewport"/.test(html));
  s.ok('包含多个 aria-label', (html.match(/aria-label=/g) || []).length >= 5);
  s.ok('支持 prefers-reduced-motion', /prefers-reduced-motion/.test(html));
  s.ok('提供规则页链接', /href="rules\.html"/.test(html));
  s.ok('使用 CSS 渐变绘制卡面', /linear-gradient/.test(html));
  s.ok('触控目标至少 44px', /44px/.test(html));

  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('rules.html 存在且非空', rules.length > 1000);
  s.ok('规则页写明 50 点生命', /50/.test(rules));
  s.ok('规则页返回游戏', /href="index\.html"/.test(rules));
  s.ok('规则页无远程依赖', !/(?:src|href)\s*=\s*["']https?:/i.test(rules));
});

s.done();
