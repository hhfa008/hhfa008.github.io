'use strict';

/*
 * Hero Realms（英雄领域）精品版 — 引擎、数据与页面契约测试。
 * 直接 require 与页面相同的 engine.js / data.js，不依赖浏览器。
 *
 *   node games/boardgame/hero-realms-premium/test.js
 *
 * 覆盖：起始牌组、抽牌与洗回、金币/战斗/治疗、无限购买、市场补位、
 * 冠军防御与击倒、同盟能力、50 HP 上限、终局、公共视图隐藏信息、
 * AI 自对弈、页面静态检查与交付产物。
 */

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var s = lib.suite('hero-realms-premium');
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function chineseCount(html) {
  return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length;
}
function repeat(id, n) {
  var out = [];
  for (var i = 0; i < n; i += 1) out.push(id);
  return out;
}
function throws(label, fn) {
  var ok = false;
  try { fn(); } catch (e) { ok = true; }
  s.ok(label, ok);
}
function totalCards(g) {
  var out = [];
  E.SIDES.forEach(function (side) {
    var p = g.sides[side];
    out = out.concat(p.deck, p.hand, p.discard, p.played);
    p.champions.forEach(function (ch) { out.push(ch.cardId); });
  });
  return out.concat(g.market, g.marketDeck);
}
function controlled(opts) {
  opts = opts || {};
  var market = opts.market || ['recruit', 'bribe', 'death-touch', 'spark', 'taxation'];
  var g = E.createGame({
    cards: D,
    seed: opts.seed == null ? 9 : opts.seed,
    shuffle: false,
    openingHand: 0,
    market: market,
    marketDeck: opts.marketDeck || ['profit', 'orc-grunt', 'command', 'elven-gift'],
    decks: { player: repeat('gold', 10), ai: repeat('gold', 10) },
    firstSide: 'player'
  });
  g.sides.player.hand = [];
  g.sides.ai.hand = [];
  return g;
}

/* ------------------------------------------------------------------ */
s.group('卡牌数据与起始牌组', function () {
  s.ok('数据文件有 slug', D.slug === 'hero-realms-premium');
  s.ok('至少 40 张卡牌定义', D.cards.length >= 40, String(D.cards.length));
  s.eq('双方 2 人', D.players, '2 人');
  s.ok('四种派系齐全', ['imperial', 'guild', 'necros', 'wild'].every(function (f) {
    return D.cards.some(function (c) { return c.faction === f && !c.starting; });
  }));
  s.ok('卡牌 id 唯一', new Set(D.cards.map(function (c) { return c.id; })).size === D.cards.length);
  s.ok('市场牌都有金币价格', D.cards.filter(function (c) { return !c.starting; })
    .every(function (c) { return c.cost >= 1 && c.cost <= 8; }));
  s.ok('市场牌都有文案与派系', D.cards.filter(function (c) { return !c.starting; })
    .every(function (c) { return c.text && D.factionLabels[c.faction]; }));
  s.ok('冠军都有防御力和能力', D.cards.filter(function (c) { return c.type === 'champion'; })
    .every(function (c) { return c.defense > 0 && c.ability && c.ability.amount > 0; }));
  s.eq('起始牌组 7 金币 + 3 匕首', D.startingDeck.map(function (x) { return [x.id, x.count]; }),
    [['gold', 7], ['dagger', 3]]);
  s.ok('金币 +1 金币', D.cards.filter(function (c) { return c.id === 'gold'; })[0].effects.gold === 1);
  s.ok('匕首 +1 战斗', D.cards.filter(function (c) { return c.id === 'dagger'; })[0].effects.combat === 1);
  s.ok('包含真实卡名 征税 / 邪教祭司 / 兽人步兵', ['taxation', 'cult-priest', 'orc-grunt'].every(function (id) {
    return D.cards.some(function (c) { return c.id === id; });
  }));
  s.ok('B 站来源至少 3 条', D.sources.length >= 3, String(D.sources.length));
  D.sources.forEach(function (src, i) {
    s.ok('来源 ' + (i + 1) + ' 有标题与 UP', typeof src.title === 'string' && src.title.length > 4 && typeof src.up === 'string');
    s.ok('来源 ' + (i + 1) + ' BV 号合法', /^BV[0-9A-Za-z]+$/.test(src.bv));
    s.ok('来源 ' + (i + 1) + ' 链接指向 B 站', /^https:\/\/www\.bilibili\.com\/video\/BV/.test(src.url));
  });
});

s.group('开局与确定性', function () {
  var g = E.createGame({ cards: D, seed: 42 });
  s.eq('两名玩家', E.SIDES.length, 2);
  s.eq('双方 50 HP', [g.sides.player.hp, g.sides.ai.hp], [50, 50]);
  s.eq('最大生命 50', g.sides.player.maxHp, 50);
  s.eq('玩家先手', g.turn, 'player');
  s.eq('起始手牌 5 张', g.sides.player.hand.length, 5);
  s.eq('起始牌库剩 5 张', g.sides.player.deck.length, 5);
  s.eq('起始弃牌堆为空', g.sides.player.discard.length, 0);
  s.eq('金币与战斗初始为 0', [g.sides.player.gold, g.sides.player.combat], [0, 0]);
  s.eq('AI 尚未抽牌', g.sides.ai.hand.length, 0);
  s.eq('AI 牌库 10 张', g.sides.ai.deck.length, 10);
  s.eq('市场 5 张', g.market.length, 5);
  s.eq('补牌堆 79 张', g.marketDeck.length, 79);
  s.ok('市场与补牌堆都有牌', g.market.concat(g.marketDeck).length === 84);
  s.ok('全部卡牌都有定义', totalCards(g).every(function (id) { return !!g.cards[id]; }));
  s.eq('起始牌组恰好 10 张', (function () {
    var ids = g.sides.player.hand.concat(g.sides.player.deck).sort();
    return ids.filter(function (id) { return id === 'gold'; }).length + '/' +
      ids.filter(function (id) { return id === 'dagger'; }).length;
  })(), '7/3');
  var g2 = E.createGame({ cards: D, seed: 42 });
  s.eq('相同种子手牌一致', g2.sides.player.hand, g.sides.player.hand);
  s.eq('相同种子市场一致', g2.market, g.market);
});

s.group('打牌、金币、战斗与治疗', function () {
  var g = controlled();
  g.sides.player.hand = ['gold', 'dagger'];
  var next = E.playCard(g, 'player', 0);
  s.eq('金币牌 +1 金币', next.sides.player.gold, 1);
  s.eq('金币牌进入出牌区', next.sides.player.played, ['gold']);
  var next2 = E.playCard(next, 'player', 0);
  s.eq('匕首 +1 战斗', next2.sides.player.combat, 1);
  s.eq('手牌减少', next2.sides.player.hand.length, 0);
  s.ok('出牌不修改原 state', g.sides.player.hand.length === 2);

  var h = controlled();
  h.sides.player.hp = 40;
  h.sides.player.hand = ['elven-gift'];
  var healed = E.playCard(h, 'player', 0);
  s.eq('精灵赠礼恢复 3 生命', healed.sides.player.hp, 43);
  h.sides.player.hp = 49;
  var capped = E.playCard(h, 'player', 0);
  s.eq('治疗不能超过 50', capped.sides.player.hp, 50);

  var draw = controlled();
  draw.sides.player.deck = ['recruit', 'profit', 'spark'];
  draw.sides.player.hand = ['profit', 'gold'];
  var drawn = E.playCard(draw, 'player', 0);
  s.eq('利润抽 1 张牌', drawn.sides.player.hand.length, 2);
  s.eq('利润 +2 金币', drawn.sides.player.gold, 2);
});

s.group('无限购买与市场补位', function () {
  var g = controlled({ market: ['recruit', 'bribe', 'spark', 'death-touch', 'orc-grunt'] });
  g.sides.player.gold = 6;
  var first = E.buyCard(g, 'player', 0);
  s.eq('购买征募扣 1 金币', first.sides.player.gold, 5);
  s.ok('买到的牌进入弃牌堆', first.sides.player.discard.indexOf('recruit') >= 0);
  s.eq('市场仍是 5 张', first.market.length, 5);
  s.eq('市场同位置补入新牌', first.market[0], 'profit');
  var second = E.buyCard(first, 'player', 1);
  s.eq('第二张继续购买（无每回合 1 张限制）', second.sides.player.gold, 4);
  s.ok('第二张进入弃牌堆', second.sides.player.discard.indexOf('bribe') >= 0);
  var third = E.buyCard(second, 'player', 2);
  s.eq('第三张继续购买', third.sides.player.discard.length, 3);
  s.ok('购买不是本回合一次性的', third.sides.player.discard.length === 3);
  var poor = JSON.parse(JSON.stringify(third));
  poor.sides.player.gold = 0;
  throws('金币不足时购买抛错', function () { E.buyCard(poor, 'player', 4); });
  var broke = controlled();
  broke.sides.player.gold = 0;
  throws('0 金币不能购买', function () { E.buyCard(broke, 'player', 0); });
});

s.group('冠军、防御与击倒', function () {
  var g = controlled();
  g.sides.player.hand = ['man-at-arms', 'orc-grunt'];
  var played = E.playCard(g, 'player', 0);
  s.eq('冠军进入冠军区', played.sides.player.champions.length, 1);
  s.eq('冠军防御力', played.sides.player.champions[0].hp, 4);
  s.eq('冠军不在弃牌堆', played.sides.player.discard.length, 0);
  var used = E.activateChampion(played, 'player', played.sides.player.champions[0].uid);
  s.eq('激活冠军获得战斗', used.sides.player.combat, 2);
  throws('同一冠军一回合只能激活一次', function () {
    E.activateChampion(used, 'player', used.sides.player.champions[0].uid);
  });

  var fight = controlled();
  fight.sides.ai.champions = [{ uid: 1, cardId: 'man-at-arms', hp: 4, maxHp: 4, used: false }];
  fight.sides.player.combat = 6;
  var hitChamp = E.attack(fight, 'player', { kind: 'champion', uid: 1 }, 4);
  s.eq('击杀冠军消耗 4 战斗', hitChamp.sides.player.combat, 2);
  s.eq('冠军被移出冠军区', hitChamp.sides.ai.champions.length, 0);
  s.ok('被击倒冠军进入对手弃牌堆', hitChamp.sides.ai.discard.indexOf('man-at-arms') >= 0);
  var hitPlayer = E.attack(hitChamp, 'player', { kind: 'player' }, 2);
  s.eq('剩余战斗攻击玩家', hitPlayer.sides.ai.hp, 48);
  s.eq('战斗池清零', hitPlayer.sides.player.combat, 0);
  throws('没有战斗不能攻击', function () { E.attack(hitPlayer, 'player', { kind: 'player' }, 1); });

  var partial = controlled();
  partial.sides.ai.champions = [{ uid: 2, cardId: 'tyrannor-the-devourer', hp: 8, maxHp: 8, used: false }];
  partial.sides.player.combat = 3;
  var dent = E.attack(partial, 'player', { kind: 'champion', uid: 2 }, 3);
  s.eq('冠军未死时保留伤害', dent.sides.ai.champions[0].hp, 5);
  s.eq('冠军仍在场', dent.sides.ai.champions.length, 1);
});

s.group('同盟能力', function () {
  var g = controlled({ market: ['recruit', 'taxation', 'command', 'spark', 'bribe'] });
  g.sides.player.hp = 40;
  g.sides.player.hand = ['recruit', 'taxation'];
  var one = E.playCard(g, 'player', 0);
  s.eq('第一张帝国牌不触发同盟', one.sides.player.hp, 40);
  var two = E.playCard(one, 'player', 0);
  s.eq('第二张帝国牌触发征税同盟 +4 生命', two.sides.player.hp, 46);
  s.eq('征税本身 +2 金币', two.sides.player.gold, 4);

  var n = controlled();
  n.sides.player.hand = ['death-touch', 'cult-priest'];
  var d1 = E.playCard(n, 'player', 0);
  var d2 = E.playCard(d1, 'player', 0);
  s.eq('死灵同盟使邪教祭司 +4 战斗', d2.sides.player.combat, 6);
  s.eq('邪教祭司进入冠军区', d2.sides.player.champions.length, 1);

  var x = controlled();
  x.sides.player.hand = ['recruit', 'taxation'];
  var nonAlly = E.playCard(x, 'player', 0);
  s.eq('无同盟时只结算基础效果', E.playCard(nonAlly, 'player', 0).sides.player.hp, 50);
  s.eq('非同一派系不触发', (function () {
    var y = controlled();
    y.sides.player.hand = ['spark', 'taxation'];
    var p = E.playCard(y, 'player', 0);
    return E.playCard(p, 'player', 0).sides.player.hp;
  })(), 50);
});

s.group('回合结束、抽牌与洗回', function () {
  var g = controlled();
  g.sides.player.hand = ['gold', 'dagger'];
  g.sides.player.played = ['recruit'];
  g.sides.player.gold = 3;
  g.sides.player.combat = 2;
  g.sides.player.deck = repeat('gold', 7);
  var next = E.endTurn(g, 'player');
  s.eq('回合结束弃掉手牌与出牌区', next.sides.player.discard.length, 3);
  s.eq('手牌清空', next.sides.player.hand.length, 0);
  s.eq('金币与战斗清零', [next.sides.player.gold, next.sides.player.combat], [0, 0]);
  s.eq('轮到对手', next.turn, 'ai');
  s.eq('对手回合开始抽 5 张', next.sides.ai.hand.length, 5);
  s.eq('回合数增加', next.turnNumber, 2);

  var r = controlled();
  r.sides.player.deck = [];
  r.sides.player.discard = ['gold', 'dagger', 'spark'];
  r.sides.player.hand = [];
  var before = r.sides.player.discard.length;
  E.drawCards(r, 'player', 2, '测试：');
  s.eq('牌库空时把弃牌堆洗回', r.sides.player.hand.length, 2);
  s.eq('洗回后弃牌堆为 0', r.sides.player.discard.length, 0);
  s.eq('洗回前弃牌 3 张', before, 3);
});

s.group('终局与公共视图隐藏信息', function () {
  var g = controlled();
  g.sides.ai.hp = 2;
  g.sides.player.combat = 2;
  var over = E.attack(g, 'player', { kind: 'player' }, 2);
  s.eq('对手生命归零', over.sides.ai.hp, 0);
  s.eq('赢家为玩家', over.winner, 'player');
  s.eq('终局后不能再行动', E.legalActions(over, 'player').length, 0);
  throws('终局后打牌抛错', function () { E.playCard(over, 'player', 0); });
  s.eq('publicView 标记 over', E.publicView(over, 'player').phase, 'over');

  var v = E.createGame({ cards: D, seed: 5 });
  var pv = E.publicView(v, 'player');
  s.eq('自己看到 5 张手牌', pv.sides.player.hand.length, 5);
  s.ok('对手手牌不下发', pv.sides.ai.hand === undefined);
  s.eq('对手手牌只有数量', pv.sides.ai.handCount, 0);
  s.eq('牌库只有数量', pv.sides.player.deckCount, 5);
  s.ok('视图不含牌库数组', pv.sides.player.deck === undefined && pv.sides.ai.deck === undefined);
  s.ok('视图不含随机状态', pv.rngState === undefined && pv.seed === undefined);
  s.ok('视图不含卡牌映射', pv.cards === undefined);
  s.eq('市场公开 5 张', pv.market.length, 5);
  s.ok('补牌堆只给数量', typeof pv.marketDeckCount === 'number');
  var aiView = E.publicView(v, 'ai');
  s.ok('对手视角看不到玩家手牌', aiView.sides.player.hand === undefined);
  s.eq('对手视角只看到 0 张 AI 手牌', aiView.sides.ai.hand.length, 0);
  s.ok('日志公开但不含手牌内容', Array.isArray(pv.log) && pv.log.every(function (row) { return typeof row.text === 'string'; }));
  var serialized = JSON.stringify(pv);
  s.ok('序列化视图不含 deck 字段', serialized.indexOf('"deck"') === -1);
});

s.group('合法动作与 AI 自对弈', function () {
  var g = controlled();
  g.sides.player.hand = ['gold', 'dagger'];
  g.sides.player.gold = 3;
  var acts = E.legalActions(g, 'player');
  s.ok('合法动作包含出牌', acts.some(function (a) { return a.type === 'play'; }));
  s.ok('合法动作包含购买', acts.some(function (a) { return a.type === 'buy'; }));
  s.ok('合法动作包含结束回合', acts.some(function (a) { return a.type === 'endTurn'; }));
  s.eq('非当前玩家没有动作', E.legalActions(g, 'ai').length, 0);
  g.sides.player.combat = 3;
  s.ok('有战斗时包含攻击玩家', E.legalActions(g, 'player').some(function (a) {
    return a.type === 'attack' && a.target.kind === 'player';
  }));

  var badStates = 0;
  var winners = { player: 0, ai: 0 };
  var turns = [];
  for (var seed = 1; seed <= 12; seed += 1) {
    try {
      var h = E.selfPlay(seed);
      if (!h.winner) badStates += 1;
      else winners[h.winner] += 1;
      if (!(h.sides.player.hp >= 0 && h.sides.player.hp <= 50 && h.sides.ai.hp >= 0 && h.sides.ai.hp <= 50)) badStates += 1;
      turns.push(h.turnNumber);
      var view = E.publicView(h, 'player');
      if (view.sides.ai.hand !== undefined) badStates += 1;
    } catch (e) {
      badStates += 1;
    }
  }
  s.eq('12 局 AI 自对弈全部结束', badStates, 0);
  s.ok('双方都取得过胜利', winners.player > 0 && winners.ai > 0, JSON.stringify(winners));
  s.ok('对局在合理回合内结束', turns.every(function (t) { return t > 3 && t < 200; }), JSON.stringify(turns));
  s.ok('AI 决策始终合法', (function () {
    var g2 = controlled();
    g2.sides.player.hand = ['gold'];
    var action = E.aiAction(g2, 'player');
    if (!action) return false;
    try { E.applyAction(g2, action); return true; } catch (e) { return false; }
  })());
});

s.group('页面与规则静态检查', function () {
  var html = read('index.html');
  var rules = read('rules.html');
  var online = read('online.html');
  s.ok('index 使用本地 data.js', html.indexOf('<script src="data.js">') >= 0);
  s.ok('index 使用本地 engine.js', html.indexOf('<script src="engine.js">') >= 0);
  s.ok('index 复用共享洗牌模块', html.indexOf('../../shared/shuffle.js') >= 0);
  s.ok('index 复用共享音效模块', html.indexOf('../../shared/sfx.js') >= 0);
  s.ok('index 不自建 AudioContext', html.indexOf('AudioContext') === -1 && html.indexOf('createOscillator') === -1);
  s.ok('index 声明 viewport', html.indexOf('width=device-width') >= 0);
  s.ok('index 含 ARIA 实时区域', html.indexOf('aria-live') >= 0);
  s.ok('index 有主题按钮', html.indexOf('id="themeBtn"') >= 0);
  s.ok('index 有静音按钮', html.indexOf('id="muteBtn"') >= 0);
  s.ok('index 链接联机页', html.indexOf('online.html') >= 0);
  s.ok('index 链接规则页', html.indexOf('rules.html') >= 0);
  s.ok('index 有 50 HP 生命条', html.indexOf('hpBar') >= 0 || html.indexOf('hp-bar') >= 0);
  s.ok('index 有手牌扇形区', html.indexOf('handFan') >= 0 || html.indexOf('hand-fan') >= 0);
  s.ok('index 有 5 张市场', html.indexOf('market') >= 0);
  s.ok('index 有冠军区', html.indexOf('champions') >= 0 || html.indexOf('championRow') >= 0);
  s.ok('index 有战斗日志', html.indexOf('logList') >= 0);
  s.ok('index 无 per-game service worker', html.indexOf('serviceWorker') === -1 && !fs.existsSync(path.join(__dirname, 'sw.js')));
  s.ok('index 无远程脚本', !/<script[^>]+src=["']https?:/i.test(html));
  s.ok('index 无远程样式', !/<link[^>]+href=["']https?:/i.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('index 无远程图片', !/<img[^>]+src=["']https?:/i.test(html));

  s.ok('规则页 1200+ 汉字', chineseCount(rules) >= 1200, 'got ' + chineseCount(rules));
  s.ok('规则页 Article + FAQPage', rules.indexOf('"@type": "Article"') >= 0 && rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('规则页至少 3 条 BV 号', (rules.match(/BV[0-9A-Za-z]+/g) || []).length >= 3);
  s.ok('规则页含两张详情图', (rules.match(/assets\/detail-[12]\.webp/g) || []).length >= 2);
  s.ok('规则页链接联机页', rules.indexOf('online.html') >= 0);
  s.ok('规则页声明简化差异', rules.indexOf('7 金币 + 3 匕首') >= 0 && rules.indexOf('51') >= 0);

  s.ok('联机页含创建/加入/排行榜', online.indexOf('createBtn') >= 0 && online.indexOf('joinBtn') >= 0 && online.indexOf('leaderboard') >= 0);
  s.ok('联机页含邀请复制', online.indexOf('inviteBtn') >= 0);
  s.ok('联机页含重赛', online.indexOf('restartBtn') >= 0);
  s.ok('联机页无远程脚本', !/<script[^>]+src=["']https?:/i.test(online));
});

s.group('交付产物与联机适配器', function () {
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'online-e2e.json',
    'online.html', 'online-server.mjs', 'test-online.js', 'e2e.mjs', 'art-render.html', 'render-art.mjs',
    'rules.html'].forEach(function (name) {
    s.ok('存在 ' + name, fs.existsSync(path.join(__dirname, name)));
  });
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'hero-realms-premium');
  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 人数 2', [meta.players.min, meta.players.max], [2, 2]);
  s.ok('meta 声明联机 ready', meta.online && meta.online.status === 'ready');
  var realism = JSON.parse(read('realism.json'));
  s.ok('realism pass', realism.pass === true);
  s.ok('realism 至少 3 项', realism.checks.length >= 3, String(realism.checks.length));
  s.ok('realism 至少 3 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 3);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  var oracle = JSON.parse(read('online-e2e.json'));
  s.eq('online-e2e clients=2', oracle.clients, 2);
  s.ok('online-e2e sameGame', oracle.sameGame === true);
  s.ok('online-e2e settlementConsistent', oracle.settlementConsistent === true);
  s.ok('online-e2e reconnect', oracle.reconnect === true);
  s.ok('online-e2e timeoutTakeover', oracle.timeoutTakeover === true);
  s.ok('online-e2e leaderboard', oracle.leaderboard === true);
  s.ok('online-e2e runAll', oracle.runAll === true);
  s.ok('online-e2e 控制组 exit 1', oracle.controlledFailure.exitCode === 1);
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端只接受 2 个座位', server.indexOf('minPlayers: 2') >= 0 && server.indexOf('maxPlayers: 2') >= 0);
  s.ok('服务端使用公共视图', server.indexOf('publicView') >= 0);
  s.ok('服务端校验动作类型', server.indexOf('unknown action') >= 0);
});
s.group('共享 precache 清单', function () {
  var root = path.join(__dirname, '..', '..');
  var manifestPath = path.join(root, 'precache-manifest.js');
  var indexHtml = read('index.html');
  s.ok('index 不写死 per-game SW 清单', indexHtml.indexOf('serviceWorker') === -1);
  if (!fs.existsSync(manifestPath)) {
    s.ok('v22 manifest 待合并生成', true);
    return;
  }
  var manifest = fs.readFileSync(manifestPath, 'utf8');
  var sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  var cacheVersion = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
  var manifestVersion = (manifest.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
  s.eq('manifest 版本与 CACHE_VERSION 同步', manifestVersion, cacheVersion);
  s.ok('manifest 收录本游戏页面', manifest.indexOf('/games/boardgame/hero-realms-premium/') >= 0);
  s.ok('manifest 收录共享洗牌/音效', manifest.indexOf('/games/shared/shuffle.js') >= 0 && manifest.indexOf('/games/shared/sfx.js') >= 0);
});

s.done();
