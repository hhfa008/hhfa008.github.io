'use strict';

/*
 * 卡牌对战最小闭环测试（C 角色维护）。
 *
 *   node games/boardgame/tests/card-battle.test.js
 *
 * 覆盖：数据契约、页面静态约束、洗牌/开局、每回合动作限制、能量与弱点、
 * 击倒计分、先到 3 分获胜、AI 动作合法性、50 局 AI 自对弈。
 *
 * 对比备注：origin/boardgame/50bdc849 的 pokemon-sample.json 采用官方 TCG
 * 契约（60 张牌库 / 7 张起手 / 6 张奖赏卡），与本任务指定的简化规则
 * （20 张牌库 / 5 张起手 / 先到 3 分）不同，因此这里沿用本任务的契约；
 * 仅借鉴其“固定 seed 洗牌、动作来自 legalActions、自对弈不变量”的测试思路。
 */

var fs = require('fs');
var path = require('path');
var t = require('../../tests/lib.js');
var CB = require('../engine/card-battle.js');

var ROOT = path.resolve(__dirname, '..');
var DATA_FILE = path.join(ROOT, 'data', 'cards.json');
var SCHEMA_FILE = path.join(ROOT, 'schema', 'card.schema.json');
var ENGINE_FILE = path.join(ROOT, 'engine', 'card-battle.js');
var PAGE_FILE = path.join(ROOT, 'card-battle', 'index.html');

var cards = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
var schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
var engineSrc = fs.readFileSync(ENGINE_FILE, 'utf8');
var pageHtml = fs.readFileSync(PAGE_FILE, 'utf8');

var BY_ID = {};
cards.forEach(function (card) { BY_ID[card.id] = card; });

var SUBTYPES = ['grass', 'fire', 'water', 'electric', 'psychic', 'fighting'];
var RARITIES = ['common', 'uncommon', 'rare'];
var TYPES = ['pokemon', 'energy', 'item'];

var s = t.suite('boardgame-card-battle');
var uidSeq = 1000;

function byId(id) {
  if (!BY_ID[id]) throw new Error('fixture 中不存在卡牌：' + id);
  return BY_ID[id];
}

function mon(id, energy, hp) {
  var def = byId(id);
  return {
    uid: uidSeq++,
    id: id,
    hp: hp == null ? def.hp : hp,
    maxHp: def.hp,
    energy: energy || 0
  };
}

// A blank, fully controlled state. Engine functions clone before mutating, so
// tests can safely edit this object to build a scenario.
function scenario(side) {
  var st = CB.createGame({
    cards: cards,
    seed: 99,
    firstSide: side || 'player',
    drawOnStart: false
  });
  ['player', 'ai'].forEach(function (name) {
    st.sides[name].hand = [];
    st.sides[name].deck = [];
    st.sides[name].discard = [];
    st.sides[name].field = [];
    st.sides[name].score = 0;
    st.sides[name].usedEnergy = false;
    st.sides[name].playedPokemon = false;
    st.sides[name].usedItem = false;
    st.sides[name].attacked = false;
  });
  st.turn = side || 'player';
  st.turnNumber = 1;
  st.winner = null;
  st.uidCounter = 1000;
  st.log = [];
  return st;
}

function throws(label, fn, pattern) {
  try {
    fn();
    s.ok(label, false, '未抛出异常');
  } catch (err) {
    var message = err && err.message ? err.message : String(err);
    s.ok(label, !pattern || message.indexOf(pattern) >= 0, '错误信息：' + message);
  }
}

function countTypes(ids) {
  var counts = { pokemon: 0, energy: 0, item: 0 };
  ids.forEach(function (id) { counts[byId(id).type]++; });
  return counts;
}

function legalHas(state, side, action) {
  var key = JSON.stringify(action);
  return CB.legalActions(state, side).some(function (candidate) {
    return JSON.stringify(candidate) === key;
  });
}

// ---------------------------------------------------------------------------
s.group('数据契约', function () {
  s.ok('卡牌总数在 20–30 之间', cards.length >= 20 && cards.length <= 30, 'got ' + cards.length);
  s.eq('schema 顶层为数组', schema.type, 'array');
  s.eq('schema minItems', schema.minItems, 20);
  s.eq('schema maxItems', schema.maxItems, 30);
  s.eq('schema 定义了宝可梦/能量/道具三个分支', schema.items.allOf.length, 3);

  var ids = cards.map(function (card) { return card.id; });
  s.eq('卡牌 id 唯一', new Set(ids).size, cards.length);

  s.ok('每张卡都有中英文名', cards.every(function (card) {
    return card.name && typeof card.name.zh === 'string' && card.name.zh.length > 0 &&
      typeof card.name.en === 'string' && card.name.en.length > 0;
  }));
  s.ok('每张卡 type 合法', cards.every(function (card) { return TYPES.indexOf(card.type) !== -1; }));
  s.ok('每张卡 rarity 合法', cards.every(function (card) { return RARITIES.indexOf(card.rarity) !== -1; }));
  s.ok('每张卡 color 为 #RRGGBB', cards.every(function (card) {
    return /^#[0-9a-fA-F]{6}$/.test(card.color);
  }));

  var counts = countTypes(ids);
  s.eq('12 张宝可梦', counts.pokemon, 12);
  s.eq('6 张能量', counts.energy, 6);
  s.eq('2 张道具', counts.item, 2);

  var pokemon = cards.filter(function (card) { return card.type === 'pokemon'; });
  var energy = cards.filter(function (card) { return card.type === 'energy'; });
  var items = cards.filter(function (card) { return card.type === 'item'; });

  s.ok('宝可梦属性合法', pokemon.every(function (card) {
    return SUBTYPES.indexOf(card.subtype) !== -1;
  }));
  s.ok('宝可梦 HP 在 30–150', pokemon.every(function (card) {
    return Number.isInteger(card.hp) && card.hp >= 30 && card.hp <= 150;
  }));
  s.ok('宝可梦有 1–2 个招式', pokemon.every(function (card) {
    return Array.isArray(card.attacks) && card.attacks.length >= 1 && card.attacks.length <= 2;
  }));
  s.ok('招式字段与数值合法', pokemon.every(function (card) {
    return card.attacks.every(function (move) {
      return typeof move.name === 'string' && move.name.length > 0 &&
        Number.isInteger(move.cost) && move.cost >= 0 && move.cost <= 3 &&
        Number.isInteger(move.damage) && move.damage >= 10 && move.damage <= 150;
    });
  }));
  s.ok('宝可梦弱点属性合法', pokemon.every(function (card) {
    return SUBTYPES.indexOf(card.weakness) !== -1;
  }));
  s.ok('能量属性合法', energy.every(function (card) {
    return SUBTYPES.indexOf(card.subtype) !== -1;
  }));
  s.ok('道具效果为 draw2', items.every(function (card) { return card.effect === 'draw2'; }));

  s.ok('引擎是 UMD（浏览器挂 window.CardBattle）', /root\.CardBattle\s*=/.test(engineSrc));
  s.ok('引擎可由 node require', /module\.exports\s*=/.test(engineSrc));
});

s.group('页面静态约束', function () {
  var match = pageHtml.match(/<script[^>]*id="cards-data"[^>]*>([\s\S]*?)<\/script>/);
  s.ok('页面内嵌 cards-data JSON', !!match);
  var embedded = match ? JSON.parse(match[1]) : null;
  s.eq('内嵌数据与 data/cards.json 完全一致', embedded, cards);

  // Metadata (canonical/og) is allowed to carry absolute URLs; the intent of
  // this assertion is "no external resource URLs in the page body".
  var pageBody = pageHtml
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["']?canonical["']?[^>]*>/gi, '');
  s.ok('页面除元数据外无任何 http(s) URL', !/https?:\/\//i.test(pageBody));
  s.ok('页面无外部资源引用', !/\b(?:src|href)="(?:https?:)?\/\//i.test(pageBody) &&
    !/url\(\s*['"]?(?:https?:)?\/\//i.test(pageBody));
  s.ok('页面不发起网络请求', !/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|new\s+Image\s*\(/.test(pageHtml));

  var scriptSrcs = [];
  pageHtml.replace(/<script[^>]*\bsrc="([^"]+)"[^>]*>/g, function (_, src) { scriptSrcs.push(src); return _; });
  s.eq('只引用同源引擎脚本', scriptSrcs, ['../engine/card-battle.js']);

  ['player-field', 'ai-field', 'hand', 'log', 'end-turn', 'score-player', 'score-ai',
    'overlay', 'restart', 'turn-chip'].forEach(function (id) {
    s.ok('页面包含 #' + id, pageHtml.indexOf('id="' + id + '"') !== -1);
  });

  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(pageHtml));
  s.ok('中文结束回合按钮', /结束回合/.test(pageHtml));
  s.ok('战斗日志区域', /战斗日志/.test(pageHtml));
  s.ok('规则含 3 分制', /先得 3 分获胜/.test(pageHtml));
  s.ok('390px 无横向溢出约束', /overflow-x:hidden/.test(pageHtml) &&
    /repeat\(3,minmax\(0,1fr\)\)/.test(pageHtml));
  s.ok('触控目标 ≥44px', /min-height:(?:4[4-9]|5\d)px/.test(pageHtml));
  s.ok('没有 href="#" 占位按钮', pageHtml.indexOf('href="#"') === -1);
});

s.group('洗牌与开局', function () {
  var a = CB.createGame({ cards: cards, seed: 123, firstSide: 'player', drawOnStart: false });
  s.eq('玩家起手 5 张', a.sides.player.hand.length, 5);
  s.eq('AI 起手 5 张', a.sides.ai.hand.length, 5);

  var pool = a.sides.player.deck.concat(a.sides.player.hand);
  s.eq('玩家牌库 20 张', pool.length, 20);
  s.eq('玩家牌库构成 12/6/2', countTypes(pool), { pokemon: 12, energy: 6, item: 2 });

  var aiPool = a.sides.ai.deck.concat(a.sides.ai.hand);
  s.eq('AI 牌库 20 张', aiPool.length, 20);
  s.eq('AI 牌库构成 12/6/2', countTypes(aiPool), { pokemon: 12, energy: 6, item: 2 });

  var b = CB.createGame({ cards: cards, seed: 123, firstSide: 'player' });
  s.eq('先手回合开始抽 1 张', b.sides.player.hand.length, 6);
  s.eq('先手抽牌后牌库 14 张', b.sides.player.deck.length, 14);
  s.eq('后手仍为 5 张', b.sides.ai.hand.length, 5);

  var c = CB.createGame({ cards: cards, seed: 123, firstSide: 'player', drawOnStart: false });
  s.eq('同一 seed 洗牌结果一致', c.sides.player.hand, a.sides.player.hand);
  s.eq('同一 seed 先手一致', c.turn, a.turn);

  var d = CB.createGame({ cards: cards, seed: 124, firstSide: 'player', drawOnStart: false });
  s.ok('不同 seed 手牌不同', JSON.stringify(d.sides.player.hand) !== JSON.stringify(a.sides.player.hand));

  var e = CB.createGame({ cards: cards, seed: 7, firstSide: 'ai', drawOnStart: false });
  s.eq('可指定先手', e.turn, 'ai');
  s.eq('指定先手时对方仍 5 张', e.sides.player.hand.length, 5);

  var roundTrip = JSON.parse(JSON.stringify(a));
  s.eq('state 可 JSON 序列化并深拷贝', roundTrip, a);
  s.eq('state 不含函数', typeof roundTrip.sides.player.field, 'object');
});

s.group('每回合动作限制', function () {
  var base = scenario();
  base.sides.player.hand = ['mon-emberfox', 'mon-vinebud', 'energy-fire'];

  var played = CB.playCard(base, 'player', 'mon-emberfox');
  s.eq('放置宝可梦后场上 1 只', played.sides.player.field.length, 1);
  s.eq('放置后手牌减少 1', played.sides.player.hand.length, 2);
  s.ok('放置标记已置位', played.sides.player.playedPokemon);
  s.eq('原 state 未被修改', base.sides.player.field.length, 0);
  throws('同一回合不能放置第二只', function () {
    CB.playCard(played, 'player', 'mon-vinebud');
  }, '已经放置');

  var full = scenario();
  full.sides.player.field = [mon('mon-emberfox'), mon('mon-vinebud'), mon('mon-bubble-otter')];
  full.sides.player.hand = ['mon-starmew'];
  throws('场上最多 3 只', function () {
    CB.playCard(full, 'player', 'mon-starmew');
  }, '最多 3 只');

  var wrong = scenario();
  wrong.sides.player.hand = ['energy-fire'];
  throws('非宝可梦不能放到场上', function () {
    CB.playCard(wrong, 'player', 'energy-fire');
  }, '只有宝可梦');

  var energyState = scenario();
  energyState.sides.player.field = [mon('mon-emberfox', 0)];
  energyState.sides.player.hand = ['energy-fire', 'energy-water'];
  var attached = CB.attachEnergy(energyState, 'player', 'energy-fire', 0);
  s.eq('附着后能量 +1', attached.sides.player.field[0].energy, 1);
  s.eq('附着后手牌减少 1', attached.sides.player.hand.length, 1);
  s.ok('能量标记已置位', attached.sides.player.usedEnergy);
  throws('每回合只能附着 1 张能量', function () {
    CB.attachEnergy(attached, 'player', 'energy-water', 0);
  }, '已经附着');

  throws('不能附着到不存在的宝可梦', function () {
    CB.attachEnergy(energyState, 'player', 'energy-fire', 9);
  }, '宝可梦不存在');

  var noField = scenario();
  noField.sides.player.hand = ['energy-fire'];
  var noFieldActions = CB.legalActions(noField, 'player').filter(function (action) {
    return action.type === 'attachEnergy';
  });
  s.eq('场上无宝可梦时没有附着动作', noFieldActions.length, 0);

  var itemState = scenario();
  itemState.sides.player.hand = ['item-research-notes'];
  itemState.sides.player.deck = ['mon-vinebud', 'energy-fire', 'mon-bloomfawn'];
  var used = CB.useItem(itemState, 'player', 'item-research-notes');
  s.eq('道具抽 2 张', used.sides.player.hand.length, 2);
  s.eq('道具进入弃牌堆', used.sides.player.discard, ['item-research-notes']);
  s.ok('道具标记已置位', used.sides.player.usedItem);
  s.eq('道具使用后剩余牌库 1 张', used.sides.player.deck.length, 1);

  used.sides.player.hand = ['item-supply-crate', 'mon-emberfox'];
  throws('每回合只能使用 1 张道具', function () {
    CB.useItem(used, 'player', 'item-supply-crate');
  }, '已经使用');

  var notItem = scenario();
  notItem.sides.player.hand = ['mon-emberfox'];
  throws('非道具不能使用道具效果', function () {
    CB.useItem(notItem, 'player', 'mon-emberfox');
  }, '只有道具');

  var turn = scenario();
  turn.sides.player.usedEnergy = true;
  turn.sides.ai.deck = ['energy-water'];
  var next = CB.endTurn(turn, 'player');
  s.eq('结束回合切换到对手', next.turn, 'ai');
  s.eq('回合数 +1', next.turnNumber, 2);
  s.eq('下一方回合开始抽 1 张', next.sides.ai.hand.length, 1);
  s.ok('下一方动作标记被重置', !next.sides.ai.usedEnergy && !next.sides.ai.playedPokemon &&
    !next.sides.ai.usedItem && !next.sides.ai.attacked);

  var back = CB.endTurn(next, 'ai');
  s.eq('再次结束回合切回玩家', back.turn, 'player');
  s.ok('玩家新回合标记被重置', !back.sides.player.usedEnergy);

  var over = scenario();
  over.winner = 'player';
  throws('游戏结束后不能继续行动', function () { CB.endTurn(over, 'player'); }, '已经结束');

  var outOfTurn = scenario('ai');
  outOfTurn.sides.player.hand = ['mon-emberfox'];
  throws('非自己回合不能放置', function () {
    CB.playCard(outOfTurn, 'player', 'mon-emberfox');
  }, '不是');

  var emptyDeck = CB.createGame({ cards: cards, seed: 3, firstSide: 'ai', drawOnStart: false });
  emptyDeck.sides.ai.hand = [];
  emptyDeck.sides.player.deck = [];
  emptyDeck.sides.player.hand = ['mon-emberfox'];
  var skipped = CB.endTurn(emptyDeck, 'ai');
  s.eq('牌库空时跳过抽牌', skipped.sides.player.hand.length, 1);
  s.eq('牌库空不判负', CB.winner(skipped), null);
  s.ok('日志记录跳过抽牌', skipped.log.some(function (entry) {
    return entry.text.indexOf('牌库已空') !== -1;
  }));
});

s.group('攻击、弱点与计分', function () {
  var weak = scenario();
  weak.sides.player.field = [mon('mon-emberfox', 2)];
  weak.sides.ai.field = [mon('mon-bloomfawn')];
  var beforeEnergy = weak.sides.player.field[0].energy;
  var hit = CB.attack(weak, 'player', 0, 1, 0);
  s.eq('火属性攻击草系弱点造成双倍伤害并击倒', hit.sides.ai.field.length, 0);
  s.eq('击倒得 1 分', CB.score(hit, 'player'), 1);
  s.ok('被击倒的宝可梦进入弃牌堆', hit.sides.ai.discard.indexOf('mon-bloomfawn') !== -1);
  s.eq('能量不会因攻击消耗', hit.sides.player.field[0].energy, beforeEnergy);
  s.ok('日志标明弱点 ×2', hit.log.some(function (entry) {
    return entry.text.indexOf('弱点 ×2') !== -1;
  }));

  var normal = scenario();
  normal.sides.player.field = [mon('mon-bubble-otter', 1)];
  normal.sides.ai.field = [mon('mon-ironhide-rhino')];
  var normalHit = CB.attack(normal, 'player', 0, 0, 0);
  s.eq('非弱点攻击只扣基础伤害', normalHit.sides.ai.field[0].hp, 100);
  s.eq('未击倒不得分', CB.score(normalHit, 'player'), 0);

  var short = scenario();
  short.sides.player.field = [mon('mon-emberfox', 0)];
  short.sides.ai.field = [mon('mon-bloomfawn')];
  throws('能量不足禁止攻击', function () {
    CB.attack(short, 'player', 0, 1, 0);
  }, '能量不足');
  s.eq('能量不足时 legalActions 不含攻击', CB.legalActions(short, 'player').filter(function (action) {
    return action.type === 'attack';
  }).length, 0);

  var enough = scenario();
  enough.sides.player.field = [mon('mon-emberfox', 2)];
  enough.sides.ai.field = [mon('mon-tidewhale')];
  s.ok('能量足够时 legalActions 含攻击', CB.legalActions(enough, 'player').some(function (action) {
    return action.type === 'attack';
  }));

  var twice = scenario();
  twice.sides.player.field = [mon('mon-emberfox', 2)];
  twice.sides.ai.field = [mon('mon-tidewhale')];
  var firstAttack = CB.attack(twice, 'player', 0, 1, 0);
  s.eq('第一次攻击生效', firstAttack.sides.ai.field[0].hp, 70);
  throws('每回合只能攻击 1 次', function () {
    CB.attack(firstAttack, 'player', 0, 1, 0);
  }, '已经攻击');

  var emptyFoe = scenario();
  emptyFoe.sides.player.field = [mon('mon-emberfox', 2)];
  s.eq('对手空场时没有攻击动作', CB.legalActions(emptyFoe, 'player').filter(function (action) {
    return action.type === 'attack';
  }).length, 0);
  throws('对手空场时攻击报错', function () {
    CB.attack(emptyFoe, 'player', 0, 1, 0);
  }, '对方宝可梦不存在');

  var winning = scenario();
  winning.sides.player.score = 2;
  winning.sides.player.field = [mon('mon-emberfox', 2)];
  winning.sides.ai.field = [mon('mon-bloomfawn', 0, 50)];
  var win = CB.attack(winning, 'player', 0, 1, 0);
  s.eq('先到 3 分获胜', CB.winner(win), 'player');
  s.eq('获胜方分数为 3', CB.score(win, 'player'), 3);
  throws('获胜后不能继续结束回合', function () { CB.endTurn(win, 'player'); }, '已经结束');

  var replace = scenario();
  replace.sides.player.field = [mon('mon-emberfox', 2)];
  replace.sides.ai.field = [mon('mon-bloomfawn', 0, 50)];
  var ko = CB.attack(replace, 'player', 0, 1, 0);
  s.eq('击倒后对手场上为空', ko.sides.ai.field.length, 0);
  ko.turn = 'ai';
  ko.sides.ai.hand = ['mon-vinebud'];
  var rebuilt = CB.playCard(ko, 'ai', 'mon-vinebud');
  s.eq('空场时可以放置新宝可梦', rebuilt.sides.ai.field.length, 1);

  var aiAttack = scenario('ai');
  aiAttack.sides.ai.field = [mon('mon-emberfox', 2)];
  aiAttack.sides.player.field = [mon('mon-bloomfawn')];
  var aiHit = CB.attack(aiAttack, 'ai', 0, 1, 0);
  s.eq('AI 攻击同样能击倒计分', CB.score(aiHit, 'ai'), 1);

  var outOfTurnAttack = scenario('ai');
  outOfTurnAttack.sides.player.field = [mon('mon-emberfox', 2)];
  outOfTurnAttack.sides.ai.field = [mon('mon-bloomfawn')];
  throws('非自己回合不能攻击', function () {
    CB.attack(outOfTurnAttack, 'player', 0, 1, 0);
  }, '不是');
});

s.group('AI 启发式', function () {
  var noTurn = scenario('player');
  s.eq('非 AI 回合返回 null', CB.aiAction(noTurn, 'ai'), null);

  var attachState = scenario('ai');
  attachState.sides.ai.field = [mon('mon-emberfox', 0), mon('mon-tidewhale', 0)];
  attachState.sides.ai.hand = ['energy-fire'];
  var attachAction = CB.aiAction(attachState, 'ai');
  s.eq('有能量时优先附着', attachAction.type, 'attachEnergy');
  s.eq('能量给攻击力最高的宝可梦', attachAction.target, 1);
  s.ok('附着动作合法', legalHas(attachState, 'ai', attachAction));

  var attackState = scenario('ai');
  attackState.sides.ai.field = [mon('mon-emberfox', 2)];
  attackState.sides.ai.hand = [];
  attackState.sides.player.field = [mon('mon-bloomfawn'), mon('mon-tidewhale')];
  var attackAction = CB.aiAction(attackState, 'ai');
  s.eq('无法附着时选择攻击', attackAction.type, 'attack');
  s.eq('攻击伤害最高的目标', attackAction.target, 0);
  s.ok('攻击动作合法', legalHas(attackState, 'ai', attackAction));

  var playState = scenario('ai');
  playState.sides.ai.hand = ['mon-sparkmouse', 'item-research-notes'];
  var playAction = CB.aiAction(playState, 'ai');
  s.eq('空场时先放置宝可梦', playAction.type, 'playCard');
  s.ok('放置动作合法', legalHas(playState, 'ai', playAction));

  var itemState = scenario('ai');
  itemState.sides.ai.hand = ['item-research-notes'];
  itemState.sides.ai.deck = ['mon-vinebud', 'mon-bloomfawn', 'energy-fire'];
  var itemAction = CB.aiAction(itemState, 'ai');
  s.eq('无事可做时使用道具', itemAction.type, 'useItem');
  s.ok('道具动作合法', legalHas(itemState, 'ai', itemAction));

  var endState = scenario('ai');
  var endAction = CB.aiAction(endState, 'ai');
  s.eq('无事可做时结束回合', endAction.type, 'endTurn');
  s.ok('结束回合动作合法', legalHas(endState, 'ai', endAction));
});

s.group('50 局 AI 自对弈', function () {
  var games = 0;
  var actions = 0;
  var illegal = 0;
  var crashed = 0;
  var unfinished = 0;
  var maxActions = 0;
  var winners = { player: 0, ai: 0 };
  var serializable = true;

  for (var seed = 1; seed <= 50; seed++) {
    var state;
    var guard = 0;
    try {
      state = CB.createGame({ cards: cards, seed: seed });
      while (!CB.winner(state) && guard < 2000) {
        var side = state.turn;
        var action = CB.aiAction(state, side);
        if (!action) { illegal++; break; }
        if (!legalHas(state, side, action)) illegal++;

        state = CB.applyAction(state, action);
        guard++;
        actions++;

        ['player', 'ai'].forEach(function (name) {
          if (state.sides[name].field.length > 3) illegal++;
          if (state.sides[name].score < 0 || state.sides[name].score > 3) illegal++;
          state.sides[name].field.forEach(function (monster) {
            if (monster.hp > monster.maxHp || monster.energy < 0) illegal++;
          });
        });

        var roundTrip = JSON.stringify(JSON.parse(JSON.stringify(state)));
        if (roundTrip !== JSON.stringify(state)) serializable = false;
      }
      if (guard >= 2000) unfinished++;
      if (state.turn !== 'player' && state.turn !== 'ai') illegal++;
    } catch (err) {
      crashed++;
      illegal++;
    }

    var gameWinner = state ? CB.winner(state) : null;
    if (gameWinner === 'player' || gameWinner === 'ai') winners[gameWinner]++;
    if (guard > maxActions) maxActions = guard;
    games++;
  }

  s.eq('完成 50 局', games, 50);
  s.eq('50 局均无非法动作', illegal, 0);
  s.eq('50 局均无异常', crashed, 0);
  s.eq('50 局均在有限步内结束', unfinished, 0);
  s.ok('每局大约 100 步以内结束', maxActions < 200, 'maxActions=' + maxActions);
  s.eq('每局都有胜者', winners.player + winners.ai, 50);
  s.ok('双方 AI 都能获胜（非单边）', winners.player > 0 && winners.ai > 0,
    JSON.stringify(winners));
  s.ok('自对弈状态始终 JSON 可序列化', serializable);
  s.ok('自对弈产生了大量动作', actions > 500, 'actions=' + actions);
});

s.done();
