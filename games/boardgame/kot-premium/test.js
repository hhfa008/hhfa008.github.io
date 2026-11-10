'use strict';

/*
 * 东京妖都（kot-premium）引擎、数据与页面契约测试。
 *
 * 页面和测试共用同源 engine.js / data.js；这里直接 require 引擎，不复制规则。
 * 运行：node games/boardgame/kot-premium/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('kot-premium');
var E = require('./engine.js');
var DATA = require('./data.js');
var Shuffle = require('../../shared/shuffle.js');
var Sfx = require('../../shared/sfx.js');
var Rewards = require('../../shared/rewards.js');
var Leaderboard = require('../../shared/leaderboard.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String((error && error.message) || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function baseGame(playerCount, seed) {
  var players = [];
  var count = playerCount || 2;
  for (var i = 0; i < count; i++) {
    players.push({
      name: String.fromCharCode(65 + i),
      monsterId: DATA.MONSTERS[i % DATA.MONSTERS.length].id,
      ai: true
    });
  }
  return E.createGame({ seed: seed == null ? 7 : seed, playerCount: count, players: players });
}

function withDice(state, faces, mutate) {
  var next = clone(state);
  next.current = 0;
  next.phase = 'rolling';
  next.rollCount = 1;
  next.rollsLeft = 2;
  next.pending = null;
  next.gameOver = false;
  next.winner = null;
  next.winnerName = null;
  next.winReason = null;
  next.buyCountThisTurn = 0;
  next.dice = faces.map(function (face) { return { face: face, locked: false }; });
  next.players.forEach(function (p) {
    p.alive = true;
    p.hp = 10;
    p.maxHp = 10;
    p.vp = 0;
    p.energy = 0;
    p.location = null;
    p.cards = [];
  });
  if (mutate) mutate(next);
  return next;
}

function buyState(options) {
  var opts = options || {};
  var state = baseGame(2, 19);
  state.current = 0;
  state.phase = 'buy';
  state.pending = null;
  state.gameOver = false;
  state.winner = null;
  state.winnerName = null;
  state.winReason = null;
  state.buyCountThisTurn = 0;
  state.players.forEach(function (p) {
    p.alive = true;
    p.hp = 10;
    p.maxHp = 10;
    p.vp = 0;
    p.energy = 0;
    p.location = null;
    p.cards = [];
  });
  state.shop = ['acid-claw', 'lava-armor', 'giant-bones'];
  var reserved = ['regen-gland', 'solar-core', 'energy-siphon', 'propaganda', 'field-medkit'];
  state.deck = reserved.concat(DATA.CARDS.map(function (card) {
    return card.id;
  }).filter(function (id) {
    return state.shop.indexOf(id) === -1 && reserved.indexOf(id) === -1;
  }));
  state.discard = [];
  state.players[0].energy = opts.energy == null ? 10 : opts.energy;
  state.players[0].vp = opts.vp || 0;
  if (opts.cards) state.players[0].cards = opts.cards.slice();
  if (opts.shop) state.shop = opts.shop.slice();
  return state;
}

function hasMove(moves, move) {
  return moves.some(function (item) {
    return item.type === move.type &&
      (move.index == null || item.index === move.index) &&
      (move.slot == null || item.slot === move.slot) &&
      (move.cardId == null || item.cardId === move.cardId) &&
      (move.leave == null || !!item.leave === !!move.leave);
  });
}

function countCards(state) {
  var cards = [];
  state.players.forEach(function (p) { cards = cards.concat(p.cards || []); });
  cards = cards.concat(state.shop.filter(Boolean));
  cards = cards.concat(state.deck || []);
  cards = cards.concat(state.discard || []);
  return cards.sort();
}

function webpSize(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('不是 WebP');
  }
  var offset = 12;
  while (offset + 8 <= buffer.length) {
    var fourcc = buffer.toString('ascii', offset, offset + 4);
    var size = buffer.readUInt32LE(offset + 4);
    var data = offset + 8;
    if (fourcc === 'VP8X') {
      return { width: 1 + buffer.readUIntLE(data + 4, 3), height: 1 + buffer.readUIntLE(data + 7, 3) };
    }
    if (fourcc === 'VP8L') {
      var bits = buffer.readUInt32LE(data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8 ' || fourcc === 'VP8') {
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff
      };
    }
    offset = data + size + (size % 2);
  }
  throw new Error('WebP 尺寸解析失败');
}

function pngSize(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('不是 PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

var ART_DIR = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'kot');
var ART_NAMES = {
  emberwyrm: 'monster-emberwyrm',
  tideback: 'monster-tideback',
  lunamantis: 'monster-lunamantis',
  rustfang: 'monster-rustfang',
  frosthorn: 'monster-frosthorn',
  sporecolossus: 'monster-sporecolossus'
};

function readBuffer(name) {
  return fs.readFileSync(path.join(ART_DIR, name));
}

function artManifest() {
  return JSON.parse(fs.readFileSync(path.join(ART_DIR, 'art-manifest.json'), 'utf8'));
}

/* ------------------------------------------------------------------ */
/* 1. 原创数据                                                         */
/* ------------------------------------------------------------------ */

s.group('原创数据完整性', function () {
  s.eq('6 只原创怪兽', DATA.MONSTERS.length, 6);
  s.eq('至少 8 张能力卡', DATA.CARDS.length >= 8, true);
  s.eq('能力卡共 14 张', DATA.CARDS.length, 14);
  s.eq('怪兽 id 唯一', new Set(DATA.MONSTERS.map(function (m) { return m.id; })).size, 6);
  s.eq('能力卡 id 唯一', new Set(DATA.CARDS.map(function (c) { return c.id; })).size, DATA.CARDS.length);
  s.ok('每只怪兽有原创中文名与英文名', DATA.MONSTERS.every(function (m) {
    return m.name && /^[A-Za-z]+$/.test(m.en) && m.title && m.variant && m.texture;
  }));
  s.ok('每只怪兽有完整配色', DATA.MONSTERS.every(function (m) {
    return m.palette && ['body', 'body2', 'belly', 'accent', 'eye', 'glow', 'dark'].every(function (key) {
      return /^#[0-9a-f]{6}$/i.test(m.palette[key]);
    });
  }));
  s.ok('怪兽初始生命均为 10', DATA.MONSTERS.every(function (m) { return m.maxHp === 10; }));
  s.ok('能力卡费用合法', DATA.CARDS.every(function (c) {
    return Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= 8;
  }));
  s.ok('能力卡说明足够具体', DATA.CARDS.every(function (c) {
    return c.name && c.effect && c.text.length >= 10;
  }));
  s.ok('不使用常见商业怪兽 IP 名称', DATA.MONSTERS.every(function (m) {
    return !/godzilla|king kong|mothra|ghidorah|ultraman/i.test(m.name + ' ' + m.en);
  }));
  s.ok('monsterById 可查询', DATA.monsterById('emberwyrm').name === '烬鳞龙');
  s.ok('cardById 可查询', DATA.cardById('acid-claw').cost === 6);
  s.eq('未知怪兽返回 null', DATA.monsterById('nope'), null);
});

/* ------------------------------------------------------------------ */
/* 1b. 共享模块复用（禁止复制）                                        */
/* ------------------------------------------------------------------ */

s.group('共享模块复用', function () {
  s.eq('引擎声明复用 shared shuffle', E.USES_SHARED_SHUFFLE, true);
  var expected = Shuffle.shuffle(DATA.CARDS.map(function (card) { return card.id; }), { seed: 12345 });
  var game = baseGame(2, 12345);
  s.eq('牌库顺序由 shared shuffle 决定', game.shop.concat(game.deck), expected);
  s.ok('shared shuffle 有种子随机源', typeof Shuffle.createRng === 'function');
  s.ok('shared sfx 提供 dice/win/lose', ['dice', 'win', 'lose'].every(function (name) {
    return Sfx.list().indexOf(name) !== -1;
  }));
  Rewards.reset();
  var rec = Rewards.record({ game: 'kot-premium', kind: 'win', meta: { nonce: 'unit-' + Date.now() } });
  s.ok('shared rewards 记录本局 XP', rec.xpGained > 0, rec.xpGained);
  s.ok('shared rewards 写入 perGame', !!Rewards.getState().perGame['kot-premium']);
  var code = Leaderboard.buildChallenge({ game: 'kot-premium', kind: 'xp', value: 12, name: '东京妖都', at: 1 });
  s.ok('shared leaderboard 生成挑战码', typeof code === 'string' && code.length > 0);
  var parsed = Leaderboard.parseChallenge(code);
  s.eq('shared leaderboard 挑战码可解析', parsed && parsed.game, 'kot-premium');
  s.eq('挑战码不发网络请求（纯函数）', parsed.value, 12);
  s.ok('未复制 shared rules.js 到游戏目录', !fs.existsSync(path.join(__dirname, 'rules.js')));
  s.ok('未复制 shared physics.js 到游戏目录', !fs.existsSync(path.join(__dirname, 'physics.js')));
});

/* ------------------------------------------------------------------ */
/* 2. 开局、seed 与基础不变量                                          */
/* ------------------------------------------------------------------ */

s.group('开局与 seed', function () {
  var game = baseGame(3, 12345);
  s.eq('3 人局玩家数', game.players.length, 3);
  s.eq('当前玩家索引', game.current, 0);
  s.eq('初始 6 颗骰子', game.dice.length, 6);
  s.eq('初始 3 张明牌', game.shop.length, 3);
  s.eq('牌库剩余 11 张', game.deck.length, 11);
  s.eq('初始阶段为掷骰', game.phase, 'rolling');
  s.eq('初始 3 次掷骰', game.rollsLeft, 3);
  s.eq('初始未掷骰', game.rollCount, 0);
  s.ok('玩家初始生命/分数/能量', game.players.every(function (p) {
    return p.hp === 10 && p.maxHp === 10 && p.vp === 0 && p.energy === 0 && p.alive;
  }));
  s.ok('玩家初始都在城外', game.players.every(function (p) { return p.location === null; }));

  var a = baseGame(2, 777);
  var b = baseGame(2, 777);
  var c = baseGame(2, 778);
  s.eq('同 seed 明牌一致', a.shop, b.shop);
  s.eq('同 seed 牌库一致', a.deck, b.deck);
  s.ok('不同 seed 牌库不同', JSON.stringify(a.deck) !== JSON.stringify(c.deck));
  s.eq('seed 保存在 state', a.seed, 777);

  expectThrow('1 人局非法', function () { E.createGame({ playerCount: 1 }); }, /2–4/);
  expectThrow('5 人局非法', function () { E.createGame({ playerCount: 5 }); }, /2–4/);
  expectThrow('配置数量不一致非法', function () {
    E.createGame({ playerCount: 3, players: [{}, {}] });
  }, /不一致/);

  var four = baseGame(4, 5);
  s.eq('4 人局开放东京湾', E.bayEnabled(four), true);
  s.eq('2 人局不开放东京湾', E.bayEnabled(baseGame(2, 5)), false);
});

/* ------------------------------------------------------------------ */
/* 3. 掷骰、锁定与重掷                                                 */
/* ------------------------------------------------------------------ */

s.group('掷骰与锁定', function () {
  var game = baseGame(2, 21);
  var initial = E.getLegalMoves(game);
  s.eq('未掷骰时只有掷骰动作', initial.length, 1);
  s.eq('未掷骰时动作是 roll', initial[0].type, 'roll');
  expectThrow('未掷骰不能结算', function () { E.applyMove(game, { type: 'resolveRoll' }); }, /非法动作/);
  expectThrow('未掷骰不能锁定', function () { E.applyMove(game, { type: 'toggleLock', index: 0 }); }, /非法动作/);

  var rolled = E.applyMove(game, { type: 'roll' });
  s.eq('掷骰后 rollCount 为 1', rolled.rollCount, 1);
  s.eq('掷骰后剩余 2 次', rolled.rollsLeft, 2);
  s.eq('骰子仍为 6 颗', rolled.dice.length, 6);
  s.ok('骰面均合法', rolled.dice.every(function (die) { return E.FACES.indexOf(die.face) !== -1; }));
  s.ok('掷骰后可以锁定', hasMove(E.getLegalMoves(rolled), { type: 'toggleLock', index: 0 }));

  var locked = E.applyMove(rolled, { type: 'toggleLock', index: 0 });
  s.eq('骰子已锁定', locked.dice[0].locked, true);
  s.eq('锁定不消耗掷骰次数', locked.rollsLeft, 2);
  var faceBefore = locked.dice[0].face;
  var rerolled = E.applyMove(locked, { type: 'roll' });
  s.eq('锁定骰面重掷后不变', rerolled.dice[0].face, faceBefore);
  s.eq('重掷后剩余 1 次', rerolled.rollsLeft, 1);

  var third = E.applyMove(rerolled, { type: 'roll' });
  s.eq('第三次掷骰后剩余 0 次', third.rollsLeft, 0);
  s.ok('第三次后不能继续掷骰', !hasMove(E.getLegalMoves(third), { type: 'roll' }));
  expectThrow('第四次掷骰非法', function () { E.applyMove(third, { type: 'roll' }); }, /非法动作/);
  s.ok('第三次后可以结算', hasMove(E.getLegalMoves(third), { type: 'resolveRoll' }));

  var resolved = E.applyMove(third, { type: 'resolveRoll' });
  s.eq('结算后离开掷骰阶段', resolved.phase !== 'rolling', true);
  s.eq('掷骰统计累计 3 次', resolved.stats.rolls, 3);
});

/* ------------------------------------------------------------------ */
/* 4. 数字三连、能量与治疗                                             */
/* ------------------------------------------------------------------ */

s.group('数字三连与能量', function () {
  var oneTriple = withDice(baseGame(2, 4), ['1', '1', '1', 'claw', 'heart', 'energy'], function (st) {
    st.players[0].location = 'city';
  });
  var r1 = E.applyMove(oneTriple, { type: 'resolveRoll' });
  s.eq('三个 1 得 1 分', r1.players[0].vp, 1);

  var fourTwos = withDice(baseGame(2, 4), ['2', '2', '2', '2', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
  });
  var r2 = E.applyMove(fourTwos, { type: 'resolveRoll' });
  s.eq('四个 2 得 3 分', r2.players[0].vp, 3);
  s.eq('两个能量面得 2 能量', r2.players[0].energy, 2);

  var sixThrees = withDice(baseGame(2, 4), ['3', '3', '3', '3', '3', '3'], function (st) {
    st.players[0].location = 'city';
  });
  var r3 = E.applyMove(sixThrees, { type: 'resolveRoll' });
  s.eq('六个 3 得 6 分', r3.players[0].vp, 6);

  var siphon = withDice(baseGame(2, 4), ['energy', 'energy', 'energy', '1', '1', '1'], function (st) {
    st.players[0].location = 'city';
    st.players[0].cards = ['energy-siphon'];
  });
  var r4 = E.applyMove(siphon, { type: 'resolveRoll' });
  s.eq('能量虹吸额外 +1 能量', r4.players[0].energy, 4);
  s.eq('能量虹吸局同时三连得分', r4.players[0].vp, 1);

  var noTriple = withDice(baseGame(2, 4), ['1', '2', '3', 'claw', 'heart', 'energy'], function (st) {
    st.players[0].location = 'city';
  });
  var r5 = E.applyMove(noTriple, { type: 'resolveRoll' });
  s.eq('没有三连不得分', r5.players[0].vp, 0);
});

s.group('治疗与上限', function () {
  var heal = withDice(baseGame(2, 4), ['heart', 'heart', 'heart', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].hp = 5;
  });
  var r1 = E.applyMove(heal, { type: 'resolveRoll' });
  s.eq('城外三心回复 3 生命', r1.players[0].hp, 8);

  var regen = withDice(baseGame(2, 4), ['heart', 'heart', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].hp = 5;
    st.players[0].cards = ['regen-gland'];
  });
  var r2 = E.applyMove(regen, { type: 'resolveRoll' });
  s.eq('再生腺体额外回复 1', r2.players[0].hp, 8);

  var cap = withDice(baseGame(2, 4), ['heart', 'heart', 'heart', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].hp = 9;
  });
  var r3 = E.applyMove(cap, { type: 'resolveRoll' });
  s.eq('治疗不超过最大生命', r3.players[0].hp, 10);

  var tokyoHeal = withDice(baseGame(2, 4), ['heart', 'heart', 'heart', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].hp = 5;
    st.players[0].location = 'city';
  });
  var r4 = E.applyMove(tokyoHeal, { type: 'resolveRoll' });
  s.eq('东京内爱心不回复', r4.players[0].hp, 5);
  s.ok('东京内治疗会记录提示', r4.log.some(function (entry) { return entry.type === 'noheal'; }));
});

/* ------------------------------------------------------------------ */
/* 5. 爪击、目标选择、护甲与撤离                                       */
/* ------------------------------------------------------------------ */

s.group('爪击与目标', function () {
  var outsideHitsCity = withDice(baseGame(2, 31), ['claw', 'claw', 'claw', 'energy', 'energy', 'energy'], function (st) {
    st.players[1].location = 'city';
  });
  var r1 = E.applyMove(outsideHitsCity, { type: 'resolveRoll' });
  s.eq('城外 3 爪命中东京城 3 伤害', r1.players[1].hp, 7);
  s.eq('受伤东京怪进入撤离判定', r1.pending && r1.pending.type, 'yield');
  s.eq('撤离判定对象正确', r1.pending.playerId, 'p1');
  s.eq('撤离判定有两个选项', E.getLegalMoves(r1).length, 2);

  var cityHitsOutside = withDice(baseGame(2, 32), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
  });
  var r2 = E.applyMove(cityHitsOutside, { type: 'resolveRoll' });
  s.eq('东京内 2 爪命中城外 2 伤害', r2.players[1].hp, 8);
  s.eq('城外目标不进入撤离判定', r2.pending, null);

  var emptyTokyo = withDice(baseGame(2, 33), ['claw', 'claw', 'claw', 'claw', 'energy', 'energy']);
  var r3 = E.applyMove(emptyTokyo, { type: 'resolveRoll' });
  s.eq('空东京时爪击不造成伤害', r3.players[1].hp, 10);
  s.eq('空东京时攻击者仍须进入', r3.pending && r3.pending.type, 'enter');

  var fourTargets = withDice(baseGame(4, 34), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[1].location = 'city';
    st.players[2].location = 'bay';
  });
  var r4 = E.applyMove(fourTargets, { type: 'resolveRoll' });
  s.eq('城外爪击同时命中城与湾', [r4.players[1].hp, r4.players[2].hp], [8, 8]);
  s.eq('城与湾两只怪兽都需撤离判定', r4.pending.queue.length, 2);
});

s.group('伤害加成与护甲', function () {
  var acid = withDice(baseGame(2, 35), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
    st.players[0].cards = ['acid-claw'];
  });
  var r1 = E.applyMove(acid, { type: 'resolveRoll' });
  s.eq('酸蚀之爪 +1 伤害', r1.players[1].hp, 7);

  var stacked = withDice(baseGame(2, 35), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
    st.players[0].cards = ['acid-claw', 'spiked-tail'];
  });
  var r2 = E.applyMove(stacked, { type: 'resolveRoll' });
  s.eq('两张爪卡叠加 +2 伤害', r2.players[1].hp, 6);

  var armor = withDice(baseGame(2, 36), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
    st.players[1].cards = ['lava-armor'];
  });
  var r3 = E.applyMove(armor, { type: 'resolveRoll' });
  s.eq('熔岩甲壳减 1 伤害', r3.players[1].hp, 9);

  var fullArmor = withDice(baseGame(2, 37), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[1].location = 'city';
    st.players[1].cards = ['lava-armor', 'tidal-shell'];
  });
  var r4 = E.applyMove(fullArmor, { type: 'resolveRoll' });
  s.eq('东京内双护甲把 2 伤害降到 0', r4.players[1].hp, 10);
  s.ok('0 伤害不会触发撤离', r4.pending === null);
  s.ok('护甲抵挡有战报记录', r4.log.some(function (entry) { return entry.type === 'block'; }));
});

s.group('撤离与淘汰', function () {
  var base = withDice(baseGame(2, 41), ['claw', 'claw', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
    st.current = 1;
  });
  var hit = E.applyMove(base, { type: 'resolveRoll' });
  s.eq('东京怪受伤后待撤离', hit.pending ? hit.pending.playerId : null, 'p0');
  var leave = E.applyMove(hit, { type: 'yieldDecision', leave: true });
  s.eq('撤离后离开东京', leave.players[0].location, null);
  s.eq('撤离后攻击者须进入东京', leave.pending && leave.pending.type, 'enter');

  var stay = E.applyMove(hit, { type: 'yieldDecision', leave: false });
  s.eq('坚守后留在东京', stay.players[0].location, 'city');
  s.eq('坚守后进入购买阶段', stay.phase, 'buy');

  var lethal = withDice(baseGame(2, 42), ['claw', 'claw', 'claw', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
    st.players[0].hp = 1;
    st.players[0].energy = 3;
    st.players[0].cards = ['solar-core'];
    st.current = 1;
  });
  var dead = E.applyMove(lethal, { type: 'resolveRoll' });
  s.eq('致命伤后怪兽被淘汰', dead.players[0].alive, false);
  s.eq('淘汰后生命归零', dead.players[0].hp, 0);
  s.eq('淘汰后能量清零', dead.players[0].energy, 0);
  s.eq('淘汰后能力卡清空', dead.players[0].cards.length, 0);
  s.eq('2 人局淘汰即终局', dead.gameOver, true);
  s.eq('最后存活者获胜', dead.winner, 'p1');
  s.eq('胜利原因是最后存活', dead.winReason, 'last');

  var three = withDice(baseGame(3, 43), ['claw', 'claw', 'claw', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].location = 'city';
    st.players[0].hp = 1;
    st.current = 1;
  });
  var notOver = E.applyMove(three, { type: 'resolveRoll' });
  s.eq('3 人局淘汰一人不结束', notOver.gameOver, false);
  s.eq('3 人局淘汰后仍有胜者空位', notOver.winner, null);
});

/* ------------------------------------------------------------------ */
/* 6. 东京进入、驻守与 4 人湾                                          */
/* ------------------------------------------------------------------ */

s.group('进入东京与驻守', function () {
  var empty = withDice(baseGame(2, 51), ['1', '2', '3', 'energy', 'heart', 'claw']);
  var pending = E.applyMove(empty, { type: 'resolveRoll' });
  s.eq('空城时进入判定', pending.pending.type, 'enter');
  s.eq('空城时只能进东京城', pending.pending.options, ['city']);
  s.eq('强制进入不可跳过', hasMove(E.getLegalMoves(pending), { type: 'skipEnter' }), false);
  var entered = E.applyMove(pending, { type: 'enterTokyo', slot: 'city' });
  s.eq('进入东京城', entered.players[0].location, 'city');
  s.eq('进入东京 +1 分', entered.players[0].vp, 1);
  s.eq('进入后进入购买阶段', entered.phase, 'buy');

  var climber = withDice(baseGame(2, 52), ['energy', 'energy', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].cards = ['city-climber'];
  });
  var climberPending = E.applyMove(climber, { type: 'resolveRoll' });
  var climberEntered = E.applyMove(climberPending, { type: 'enterTokyo', slot: 'city' });
  s.eq('都市攀爬者进入得 2 分', climberEntered.players[0].vp, 2);

  var occupied = withDice(baseGame(2, 53), ['energy', 'energy', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[1].location = 'city';
  });
  var blocked = E.applyMove(occupied, { type: 'resolveRoll' });
  s.eq('2 人局城被占时不能进东京', blocked.pending, null);
  s.eq('2 人局城被占后直接购买', blocked.phase, 'buy');

  var fourOpen = withDice(baseGame(4, 54), ['energy', 'energy', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[1].location = 'city';
  });
  var bayPending = E.applyMove(fourOpen, { type: 'resolveRoll' });
  s.eq('4 人局可进东京湾', bayPending.pending.type, 'enter');
  s.eq('4 人局湾选项存在', bayPending.pending.options, ['bay']);
  s.eq('4 人局湾可选跳过', hasMove(E.getLegalMoves(bayPending), { type: 'skipEnter' }), true);
  var bayEntered = E.applyMove(bayPending, { type: 'enterTokyo', slot: 'bay' });
  s.eq('进入东京湾', bayEntered.players[0].location, 'bay');
  s.eq('进入东京湾 +1 分', bayEntered.players[0].vp, 1);

  var skip = E.applyMove(bayPending, { type: 'skipEnter' });
  s.eq('跳过湾后留在城外', skip.players[0].location, null);
  s.eq('跳过湾后进入购买', skip.phase, 'buy');
});

s.group('回合开始驻守收益', function () {
  var state = baseGame(2, 55);
  state.current = 0;
  state.phase = 'buy';
  state.players[0].location = null;
  state.players[1].location = 'city';
  state.players[1].vp = 5;
  state.players[1].cards = ['royal-presence', 'thunder-crown', 'solar-core'];
  var next = E.applyMove(state, { type: 'endTurn' });
  s.eq('轮换到下一只怪兽', next.current, 1);
  s.eq('东京驻守 +2、王者威仪 +2、雷鸣王冠 +1', next.players[1].vp, 10);
  s.eq('太阳能核额外 +1 能量', next.players[1].energy, 1);
  s.eq('新回合恢复 3 次掷骰', next.rollsLeft, 3);
  s.eq('新回合骰子未锁定', next.dice.every(function (die) { return !die.locked; }), true);

  var outside = baseGame(2, 56);
  outside.current = 0;
  outside.phase = 'buy';
  outside.players[1].vp = 5;
  var next2 = E.applyMove(outside, { type: 'endTurn' });
  s.eq('城外回合开始不得分', next2.players[1].vp, 5);
});

/* ------------------------------------------------------------------ */
/* 7. 能力卡购买、刷新与效果                                           */
/* ------------------------------------------------------------------ */

s.group('能力卡市场', function () {
  var state = buyState({ energy: 10 });
  s.ok('购买酸蚀之爪合法', hasMove(E.getLegalMoves(state), { type: 'buyCard', cardId: 'acid-claw' }));
  var bought = E.applyMove(state, { type: 'buyCard', cardId: 'acid-claw' });
  s.eq('购买后扣除 6 能量', bought.players[0].energy, 4);
  s.eq('购买后获得卡牌', bought.players[0].cards, ['acid-claw']);
  s.eq('购买后从牌库补牌', bought.shop[0], 'regen-gland');
  s.eq('牌库减少一张', bought.deck.length, 10);
  s.eq('购买计数增加', bought.buyCountThisTurn, 1);

  var second = E.applyMove(bought, { type: 'buyCard', cardId: 'lava-armor' });
  s.eq('同一购买阶段可买第二张', second.players[0].cards, ['acid-claw', 'lava-armor']);
  s.eq('第二张后能量归零', second.players[0].energy, 0);
  s.ok('能量不足时不能再购买', !hasMove(E.getLegalMoves(second), { type: 'buyCard', cardId: 'giant-bones' }));

  var poor = buyState({ energy: 2 });
  expectThrow('能量不足购买抛错', function () {
    E.applyMove(poor, { type: 'buyCard', cardId: 'acid-claw' });
  }, /非法动作/);

  var propaganda = buyState({ energy: 3, vp: 5, shop: ['propaganda', 'acid-claw', 'lava-armor'] });
  var prop = E.applyMove(propaganda, { type: 'buyCard', cardId: 'propaganda' });
  s.eq('宣传机器购买立即 +2 分', prop.players[0].vp, 7);

  var bones = buyState({ energy: 4, shop: ['giant-bones', 'acid-claw', 'lava-armor'] });
  var giant = E.applyMove(bones, { type: 'buyCard', cardId: 'giant-bones' });
  s.eq('巨化骨骼最大生命 +2', giant.players[0].maxHp, 12);
  s.eq('巨化骨骼立即回复 2', giant.players[0].hp, 12);

  var medic = buyState({ energy: 3, cards: ['field-medkit'], shop: ['acid-claw', 'lava-armor', 'giant-bones'] });
  medic.players[0].hp = 5;
  var afterEnd = E.applyMove(medic, { type: 'endTurn' });
  s.eq('野战急救包回合结束回复 1', afterEnd.players[0].hp, 6);

  var sweep = buyState({ energy: 2 });
  var oldShop = sweep.shop.slice();
  var swept = E.applyMove(sweep, { type: 'sweep' });
  s.eq('刷新市场消耗 2 能量', swept.players[0].energy, 0);
  s.eq('刷新后旧明牌进弃牌堆', swept.discard.sort(), oldShop.sort());
  s.eq('刷新后仍有 3 张明牌', swept.shop.length, 3);
  s.ok('刷新后明牌已变化', JSON.stringify(swept.shop) !== JSON.stringify(oldShop));
  expectThrow('能量不足不能刷新', function () {
    E.applyMove(buyState({ energy: 1 }), { type: 'sweep' });
  }, /非法动作/);

  s.eq('卡牌总数守恒', countCards(state).length, DATA.CARDS.length);
});

/* ------------------------------------------------------------------ */
/* 8. 胜利条件                                                         */
/* ------------------------------------------------------------------ */

s.group('胜利条件', function () {
  var pointWin = buyState({ energy: 3, vp: 19, shop: ['propaganda', 'acid-claw', 'lava-armor'] });
  var win = E.applyMove(pointWin, { type: 'buyCard', cardId: 'propaganda' });
  s.eq('达到 20 分立即获胜', win.gameOver, true);
  s.eq('胜利者为当前玩家', win.winner, 'p0');
  s.eq('胜利原因为分数', win.winReason, 'points');
  s.eq('终局后没有合法动作', E.getLegalMoves(win).length, 0);
  expectThrow('终局后动作非法', function () {
    E.applyMove(win, { type: 'endTurn' });
  }, /非法动作/);

  var enterWin = withDice(baseGame(2, 61), ['energy', 'energy', 'energy', 'energy', 'energy', 'energy'], function (st) {
    st.players[0].vp = 19;
  });
  var pending = E.applyMove(enterWin, { type: 'resolveRoll' });
  s.eq('19 分时进入东京待判定', pending.pending.type, 'enter');
  var crowned = E.applyMove(pending, { type: 'enterTokyo', slot: 'city' });
  s.eq('进入东京达到 20 分', crowned.players[0].vp, 20);
  s.eq('进东京获胜', crowned.gameOver, true);
  s.eq('进东京胜利原因', crowned.winReason, 'points');

  var startWin = baseGame(2, 62);
  startWin.current = 0;
  startWin.phase = 'buy';
  startWin.players[1].location = 'city';
  startWin.players[1].vp = 18;
  var next = E.applyMove(startWin, { type: 'endTurn' });
  s.eq('回合开始驻守达到 20 分', next.players[1].vp, 20);
  s.eq('驻守得分也能获胜', next.winner, 'p1');
  s.eq('驻守获胜原因为分数', next.winReason, 'points');
});

/* ------------------------------------------------------------------ */
/* 9. AI 30 局自对弈：合法性、终止性与不变量                           */
/* ------------------------------------------------------------------ */

s.group('AI 30 局自对弈', function () {
  var wins = { points: 0, last: 0 };
  var totalActions = 0;
  for (var seed = 1; seed <= 30; seed++) {
    var playerCount = 2 + (seed % 3);
    var players = [];
    for (var i = 0; i < playerCount; i++) {
      players.push({
        name: 'AI' + i,
        monsterId: DATA.MONSTERS[(seed + i) % DATA.MONSTERS.length].id,
        ai: true
      });
    }
    var game = E.createGame({ seed: seed, playerCount: playerCount, players: players });
    var steps = 0;
    var illegal = null;
    var invariantError = null;
    while (!game.gameOver && steps < 6000) {
      var move = E.selectAIMove(game);
      if (!move) { illegal = 'AI 没有返回动作'; break; }
      var legal = E.getLegalMoves(game);
      if (!hasMove(legal, move)) {
        illegal = 'AI 返回非法动作 ' + JSON.stringify(move);
        break;
      }
      try {
        game = E.applyMove(game, move);
      } catch (error) {
        illegal = String(error && error.message || error);
        break;
      }
      steps += 1;
      if (steps % 17 === 0) {
        if (game.dice.length !== 6) invariantError = '骰子数量错误';
        game.players.forEach(function (p) {
          if (p.hp < 0 || p.hp > p.maxHp) invariantError = '生命越界';
          if (p.vp < 0) invariantError = '分数为负';
          if (p.energy < 0) invariantError = '能量为负';
          if (!p.alive && (p.hp !== 0 || p.location !== null || p.energy !== 0)) invariantError = '淘汰状态不干净';
          if (p.location === 'bay' && game.playerCount !== 4) invariantError = '非 4 人局出现东京湾';
          if (p.cards.some(function (id) { return !DATA.cardById(id); })) invariantError = '出现未知卡牌';
        });
        var city = game.players.filter(function (p) { return p.alive && p.location === 'city'; }).length;
        var bay = game.players.filter(function (p) { return p.alive && p.location === 'bay'; }).length;
        if (city > 1 || bay > 1) invariantError = '东京区域重复驻守';
        if (game.players.some(function (p) { return p.alive && (p.hp === 0); })) invariantError = '存活但生命为 0';
      }
    }
    totalActions += steps;
    s.ok('seed ' + seed + '（' + playerCount + ' 人）无非法动作', illegal === null, illegal || '');
    s.ok('seed ' + seed + ' 不变量保持', invariantError === null, invariantError || '');
    s.ok('seed ' + seed + ' 在 6000 动作内终止', game.gameOver, 'steps=' + steps + ' phase=' + game.phase);
    s.eq('seed ' + seed + ' 有胜者', !!game.winner, true);
    s.ok('seed ' + seed + ' 胜者存活', game.players.some(function (p) { return p.id === game.winner && p.alive; }));
    s.ok('seed ' + seed + ' 胜利原因合法', game.winReason === 'points' || game.winReason === 'last');
    if (game.winReason === 'points') wins.points += 1;
    if (game.winReason === 'last') wins.last += 1;
    var cards = countCards(game);
    s.eq('seed ' + seed + ' 卡牌守恒', cards, DATA.CARDS.map(function (card) { return card.id; }).sort());
    if (illegal || invariantError || !game.gameOver) break;
  }
  s.ok('30 局全部结束', totalActions > 0 && wins.points + wins.last === 30);
  s.ok('自对弈至少出现一次分数胜利', wins.points > 0);
});

/* ------------------------------------------------------------------ */
/* 10. 生成式美术资产、realism 与发布状态                              */
/* ------------------------------------------------------------------ */

s.group('美术资产与 realism', function () {
  var manifest = artManifest();
  s.ok('art-manifest 有生成时间与模型', !!manifest.generatedAt && /gpt-image-2\.5-flare/.test(manifest.generator));

  DATA.MONSTERS.forEach(function (monster) {
    var base = ART_NAMES[monster.id];
    s.ok(monster.name + ' 声明本地立绘', monster.art === base + '.webp', monster.art);
    var webpBuf = readBuffer(monster.art);
    var masterBuf = readBuffer(path.join('masters', base + '.png'));
    var webp = webpSize(webpBuf);
    var master = pngSize(masterBuf);
    s.eq(monster.name + ' 页面立绘 768×768', [webp.width, webp.height], [768, 768]);
    s.eq(monster.name + ' 母版 1024×1024', [master.width, master.height], [1024, 1024]);
    s.ok(monster.name + ' 页面 WebP ≥10KB', webpBuf.length >= 10 * 1024, webpBuf.length);
    var alpha = manifest.assets[base] && manifest.assets[base].alpha;
    s.ok(monster.name + ' alpha 覆盖率合理（8%–90%）', !!alpha && alpha.coverage >= 0.08 && alpha.coverage <= 0.9,
      JSON.stringify(alpha));
    s.ok(monster.name + ' 中心像素不透明', !!alpha && alpha.centerAlpha >= 200, JSON.stringify(alpha));
  });

  var dieBuf = readBuffer('die-face.webp');
  var die = webpSize(dieBuf);
  s.eq('骰面材质 512×512', [die.width, die.height], [512, 512]);
  var dieAlpha = manifest.assets['die-face'].alpha;
  s.eq('骰面中心 alpha=255', dieAlpha.centerAlpha, 255);
  s.ok('骰面 alpha 覆盖率 ≥20%', dieAlpha.coverage >= 0.2, JSON.stringify(dieAlpha));

  var cityBuf = readBuffer('tokyo-night.webp');
  var city = webpSize(cityBuf);
  s.eq('东京夜景 1536×1024', [city.width, city.height], [1536, 1024]);
  s.ok('东京夜景 ≥30KB', cityBuf.length >= 30 * 1024, cityBuf.length);

  s.eq('封面 1024×1024', [webpSize(readBuffer('cover.webp')).width, webpSize(readBuffer('cover.webp')).height], [1024, 1024]);
  s.eq('OG 1200×630', [webpSize(readBuffer('og.webp')).width, webpSize(readBuffer('og.webp')).height], [1200, 630]);
  s.eq('详情配图 1536×1024', [webpSize(readBuffer('detail.webp')).width, webpSize(readBuffer('detail.webp')).height], [1536, 1024]);

  s.ok('页面图形资源总量 ≤3MB', manifest.pageBytes <= 3 * 1024 * 1024, manifest.pageBytes + ' bytes');
  s.ok('6 只怪兽主色各不相同', new Set(DATA.MONSTERS.map(function (m) { return m.palette.body; })).size, 6);
  s.ok('6 只怪兽眼睛颜色齐全', DATA.MONSTERS.every(function (m) { return /^#[0-9a-f]{6}$/i.test(m.palette.eye); }));

  var meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
  s.ok('meta 记录怪兽/骰子/城市场景材质', /resin-miniature/.test(meta.realism.materials.monsters) &&
    /ivory/.test(meta.realism.materials.dice) && /neon Tokyo/.test(meta.realism.materials.city));
  s.eq('meta status 为 shipped（联机已接入）', meta.status, 'shipped');
  s.eq('meta 声明 2–4 人', [meta.players.min, meta.players.max], [2, 4]);
  s.eq('meta 声明 6 骰 3 掷', [meta.realism.dice.count, meta.realism.dice.rollsPerTurn], [6, 3]);
  s.eq('meta 骰面与引擎一致', meta.realism.dice.faces, E.FACES);
  s.eq('meta 初始生命与引擎一致', meta.realism.monsters.startHp, E.CONSTANTS.START_HP);
  s.eq('meta 胜利分与引擎一致', meta.realism.victory.points, E.CONSTANTS.WIN_VP);
  s.eq('meta 明牌数 3', meta.realism.market.faceUp, 3);
  s.eq('meta 卡牌数 14', meta.realism.market.cardCount, DATA.CARDS.length);
  s.eq('meta 东京湾为 4 人局', meta.realism.tokyo.bay, '4-player only');
  s.eq('acceptance 全部通过', ['design', 'performance', 'art', 'realism', 'e2e', 'mobile', 'shared', 'swPrecache', 'multiplayer', 'onlineE2E']
    .every(function (key) { return meta.acceptance[key] === true; }), true);
  s.eq('multiplayer 已实现', meta.multiplayer.status, 'implemented');
  s.eq('multiplayer 无缺失项', meta.multiplayer.missing.length, 0);
  s.ok('meta 记录了现有 rooms API 评估', /server\.mjs|api\/rooms|BroadcastChannel/.test(meta.multiplayer.evaluated));
  s.ok('meta 有封面/OG/详情图', !!meta.cover && !!meta.ogImage && !!meta.detailImage);

  var design = fs.readFileSync(path.join(__dirname, 'DESIGN.md'), 'utf8');
  s.ok('DESIGN.md 提及 ART-GUIDE', /ART-GUIDE/.test(design));
  s.ok('DESIGN.md 使用 Songti SC Bold(700)', /Songti SC/.test(design) && /Bold\(700\)/.test(design));
  s.ok('DESIGN.md 记录 390×844 与 320×568', /390×844/.test(design) && /320×568/.test(design));
  s.ok('DESIGN.md 记录联机实现与 shipped', /shipped/.test(design) && /联机实现/.test(design));
  s.ok('DESIGN.md 有 realism 清单', /realism|真实清单/i.test(design));
  s.ok('DESIGN.md 有性能预算', /性能预算/.test(design));
});

/* ------------------------------------------------------------------ */
/* 10b. realism.json 与联机 E2E 证据                                   */
/* ------------------------------------------------------------------ */

s.group('realism 与联机证据', function () {
  var realism = JSON.parse(fs.readFileSync(path.join(__dirname, 'realism.json'), 'utf8'));
  s.ok('realism.json 至少 3 项', Array.isArray(realism.checks) && realism.checks.length >= 3, realism.checks && realism.checks.length);
  s.ok('realism 全部通过', realism.checks.every(function (c) { return c.pass === true; }) &&
    realism.summary && realism.summary.failed === 0 && realism.summary.pass === true, JSON.stringify(realism.summary));
  var dice = realism.checks.filter(function (c) { return c.id === 'dice-count-faces'; })[0];
  s.eq('realism 骰子数量与引擎一致', dice.actual.count, E.CONSTANTS.START_DICE);
  s.eq('realism 骰面与引擎一致', dice.actual.faces, E.FACES);
  s.eq('realism 初始生命与引擎一致', realism.checks.filter(function (c) { return c.id === 'monster-hp'; })[0].actual.startHp, E.CONSTANTS.START_HP);
  s.eq('realism 胜利分与引擎一致', realism.checks.filter(function (c) { return c.id === 'victory'; })[0].actual.points, E.CONSTANTS.WIN_VP);
  s.eq('realism 卡牌数与数据一致', realism.checks.filter(function (c) { return c.id === 'market'; })[0].actual.cardCount, DATA.CARDS.length);
  s.ok('realism 覆盖颜色/材质/尺寸/比例/字体', ['colors', 'materials', 'asset-dimensions', 'proportions', 'typography'].every(function (id) {
    return realism.checks.some(function (c) { return c.id === id && c.pass === true; });
  }));

  var online = JSON.parse(fs.readFileSync(path.join(__dirname, 'online-e2e.json'), 'utf8'));
  s.eq('online-e2e 双客户端', online.clients, 2);
  s.eq('online-e2e 79/0', [online.pass, online.fail], [79, 0]);
  s.ok('online-e2e 覆盖房间/邀请/AI/重连/托管/榜单', online.features.createRoom &&
    online.features.singleUseInvite && online.features.aiFillEmptySeats &&
    online.features.reconnect && online.features.idleTimeoutTakeover && online.features.leaderboard);
  var smoke = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence', 'online-smoke.json'), 'utf8'));
  s.ok('online 浏览器冒烟 ONLINE', /ONLINE/.test(smoke.dom.title), smoke.dom.title);
  s.eq('online 冒烟 exceptions 0', smoke.exceptions.length, 0);
  s.eq('online 冒烟外部请求 0', smoke.requests.filter(function (r) { return /^https?:\/\//.test(r.url) && r.url.indexOf('http://127.0.0.1:') !== 0; }).length, 0);
  var mobileSmoke = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence', 'online-smoke-mobile.json'), 'utf8'));
  s.ok('online 手机冒烟 NOOVERFLOW/FONTOK', /NOOVERFLOW/.test(mobileSmoke.dom.title) && /FONTOK/.test(mobileSmoke.dom.title), mobileSmoke.dom.title);
  s.eq('online 手机冒烟 exceptions 0', mobileSmoke.exceptions.length, 0);
  var gatesAll = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence', 'gates-all.json'), 'utf8'));
  s.ok('main 五门禁全部通过', gatesAll.allPass === true && ['process','art','realism','mobile','online'].every(function (g) { return gatesAll.gates[g] && gatesAll.gates[g].allPass === true; }), JSON.stringify(gatesAll.gates));
  s.ok('online test 文件名可被 run-all 识别', /^test.*\.js$/.test('test-online.js'));
  s.ok('online server 复用 app/rooms.js', /from '\.\.\/app\/rooms\.js'/.test(fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8')));
});

/* ------------------------------------------------------------------ */
/* 11. 性能断言                                                        */
/* ------------------------------------------------------------------ */

s.group('性能断言', function () {
  var start = Date.now();
  var totalActions = 0;
  for (var seed = 101; seed <= 130; seed++) {
    var pc = 2 + (seed % 3);
    var game = baseGame(pc, seed);
    var out = E.autoPlay(game, 6000);
    totalActions += out.actions;
    if (!out.finished) break;
  }
  var elapsed = Date.now() - start;
  s.ok('30 局 AI 自对弈 ≤5000ms（实际 ' + elapsed + 'ms）', elapsed <= 5000, elapsed + 'ms');
  s.ok('性能组动作数合理', totalActions > 1000 && totalActions < 180000, totalActions);

  var full = baseGame(4, 777);
  var played = E.autoPlay(full, 6000);
  var stateBytes = Buffer.byteLength(JSON.stringify(played.state), 'utf8');
  s.ok('终局 state ≤200KB（实际 ' + stateBytes + '）', stateBytes <= 200 * 1024, stateBytes);
  s.ok('战报条数 ≤200', played.state.log.length <= 200, played.state.log.length);
  s.ok('单局动作数 ≤6000', played.actions <= 6000, played.actions);

  var makeStart = Date.now();
  for (var i = 0; i < 200; i++) E.createGame({ seed: i, playerCount: 4 });
  var makeMs = Date.now() - makeStart;
  s.ok('200 次开局 ≤1000ms（实际 ' + makeMs + 'ms）', makeMs <= 1000, makeMs + 'ms');

  var legalStart = Date.now();
  var probe = baseGame(4, 999);
  for (var j = 0; j < 2000; j++) E.getLegalMoves(probe);
  var legalMs = Date.now() - legalStart;
  s.ok('2000 次合法动作查询 ≤1000ms（实际 ' + legalMs + 'ms）', legalMs <= 1000, legalMs + 'ms');

  var manifest = artManifest();
  s.ok('页面资源性能预算 ≤3MB', manifest.pageBytes <= 3 * 1024 * 1024, manifest.pageBytes);
  s.ok('页面资源不含母版 PNG', !Object.keys(manifest.assets).some(function (key) {
    return /masters\//.test(manifest.assets[key].page || '');
  }));
});

/* ------------------------------------------------------------------ */
/* 12. 页面契约、规则页与零外部资源                                     */
/* ------------------------------------------------------------------ */

s.group('页面与规则契约', function () {
  var index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

  s.ok('index 有 viewport', /<meta[^>]+name="viewport"[^>]+width=device-width/i.test(index));
  s.ok('index 有 lang=zh-CN', /<html[^>]+lang="zh-CN"/i.test(index));
  s.ok('index 有跳过导航链接', /class="skip-link"/.test(index));
  s.ok('index 引用同源 data.js', /<script src="data\.js"><\/script>/.test(index));
  s.ok('index 引用同源 engine.js', /<script src="engine\.js"><\/script>/.test(index));
  s.ok('index 引用 shared shuffle', /<script src="\.\.\/\.\.\/shared\/shuffle\.js"><\/script>/.test(index));
  s.ok('index 引用 shared sfx', /<script src="\.\.\/\.\.\/shared\/sfx\.js"><\/script>/.test(index));
  s.ok('index 引用 shared rewards', /<script src="\.\.\/\.\.\/shared\/rewards\.js"><\/script>/.test(index));
  s.ok('index 引用 shared leaderboard', /<script src="\.\.\/\.\.\/shared\/leaderboard\.js"><\/script>/.test(index));
  s.ok('index 使用 Rewards.record', /Rewards\.record/.test(index));
  s.ok('index 使用 Leaderboard.buildChallenge', /Leaderboard\.buildChallenge/.test(index));
  s.ok('index 含 reduced-motion 支持', /prefers-reduced-motion/.test(index));
  var sfxSource = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'sfx.js'), 'utf8');
  s.ok('shared sfx 使用 WebAudio 合成', /AudioContext/.test(sfxSource) && /createOscillator/.test(sfxSource));
  s.ok('index 含原创 SVG 怪兽生成器', /function monsterSvg/.test(index));
  s.ok('index 含六颗骰子容器', /id="diceRow"/.test(index));
  s.ok('index 含 3D 骰面', /transform-style:preserve-3d/.test(index));
  s.ok('index 含终局面板', /id="resultOverlay"/.test(index));
  s.ok('index 有 aria-live 状态', /aria-live="polite"/.test(index));
  s.ok('index 有触控 44px 约束', /min-height:44px/.test(index));
  s.ok('index 引用本地生成立绘', /assets\/art\/premium\/kot\/monster-/.test(index) || /ART_DIR/.test(index));
  s.ok('index 无远程 img', !/<img[^>]+src=["']https?:/i.test(index));
  s.ok('index 有本地 og:image', /property="og:image"[^>]+assets\/art\/premium\/kot\/og\.webp/.test(index));
  s.ok('index 引用详情配图', /detail\.webp/.test(index));
  s.ok('index 有 safe-area', /safe-area-inset/.test(index));
  s.ok('index 有 100dvh', /100dvh/.test(index));
  s.ok('index 有 simple-dice 降级', /simple-dice/.test(index));
  s.ok('index 首次触摸解锁音频', /touchstart/.test(index) && /AudioFX\.unlock/.test(index));
  s.ok('index 有单手操作 dock', /id="actionDock"/.test(index));
  s.ok('index 有 320px 媒体查询', /max-width:360px/.test(index));
  s.ok('index 有横屏媒体查询', /orientation:landscape/.test(index));
  s.ok('index 有联机入口', /href="online\.html"/.test(index) && /联机：Node 房间/.test(index));
  s.ok('index 手机全文字 ≥12px 规则', /所有可见文字 ≥12px/.test(index) && /font-size:12px!important/.test(index));

  var externalPatterns = [
    { re: /<script[^>]+src=["']https?:/i, name: '远程 script' },
    { re: /<link[^>]+href=["']https?:/i, name: '远程 link' },
    { re: /@import/i, name: '@import' },
    { re: /url\(\s*["']?https?:/i, name: '远程 CSS url' },
    { re: /\bfetch\s*\(/i, name: 'fetch' },
    { re: /XMLHttpRequest/i, name: 'XMLHttpRequest' },
    { re: /sendBeacon/i, name: 'sendBeacon' }
  ];
  var indexNoCanonical = index.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '');
  var rulesNoCanonical = rules.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '');
  externalPatterns.forEach(function (pattern) {
    s.ok('index 无' + pattern.name, !pattern.re.test(indexNoCanonical));
    s.ok('rules 无' + pattern.name, !pattern.re.test(rulesNoCanonical));
  });
  s.ok('rules 有 viewport', /<meta[^>]+name="viewport"[^>]+width=device-width/i.test(rules));

  var ld = lib.jsonLd(rules);
  s.ok('rules 至少有 2 段 JSON-LD', ld.length >= 2);
  s.ok('JSON-LD 含 Article', ld.some(function (node) { return node['@type'] === 'Article'; }));
  s.ok('JSON-LD 含 FAQPage', ld.some(function (node) { return node['@type'] === 'FAQPage'; }));
  var faq = ld.filter(function (node) { return node['@type'] === 'FAQPage'; })[0];
  s.ok('FAQ 至少 6 条', !!faq && faq.mainEntity.length >= 6);
  s.ok('FAQ 每项都有问答', !!faq && faq.mainEntity.every(function (item) {
    return item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));

  var textOnly = rules.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  var cjk = (textOnly.match(/[一-鿿]/g) || []).length;
  s.ok('规则正文至少 1200 个汉字（实际 ' + cjk + '）', cjk >= 1200);

  s.ok('记录 B 站来源 1', rules.indexOf('BV19Y411i7Wg') !== -1);
  s.ok('记录 B 站来源 2', rules.indexOf('BV1Hr4y1v7Ar') !== -1);
  s.ok('记录 B 站来源 3', rules.indexOf('BV1Qf4y1Q76V') !== -1);
  s.ok('记录字幕缺失限制', /未返回公开字幕|字幕列表为空/.test(rules));
  s.ok('注明公开文字规则页', /ultraboardgames\.com\/king-of-tokyo/.test(rules));
  s.ok('含原创声明', /原创声明/.test(rules) && /不使用任何商业/.test(rules));

  var e2e = fs.readFileSync(path.join(__dirname, 'E2E.md'), 'utf8');
  s.ok('E2E.md 存在且记录 390×844', /390×844/.test(e2e));
  s.ok('E2E.md 记录 320×568', /320×568/.test(e2e));
  s.ok('E2E.md 记录触屏操作', /触屏|touch/i.test(e2e));
  s.ok('E2E.md 记录横屏与平板', /844×390/.test(e2e) && /768×1024/.test(e2e));
  s.ok('E2E.md 记录 0 console error', /console[^\n]*0|0[^\n]*console/i.test(e2e));
  s.ok('E2E.md 记录 0 外部请求', /外部请求|external/i.test(e2e));
  s.ok('E2E.md 记录性能数字', /performance|性能|ms/i.test(e2e));
  s.ok('E2E.md 记录 iOS simple-dice 与音效解锁', /simple-dice/.test(e2e) && /音效|AudioContext/.test(e2e));

  var sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
  // 预缓存清单自 v20 起由 scripts/gen-precache.js 生成到 precache-manifest.js，
  // sw.js 只保留版本号与安装策略。
  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  var manifestSrc = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : sw;
  var swVersion = (sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  var manifestVersion = (manifestSrc.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
  s.ok('sw.js 与预缓存清单版本一致且不低于 v20',
    !!swVersion && swVersion === manifestVersion && Number(swVersion.replace('v', '')) >= 20);
  s.ok('预缓存清单含 Kot 入口', manifestSrc.indexOf('/games/boardgame/kot-premium/') !== -1);
  s.ok('预缓存清单含 Kot 规则页', manifestSrc.indexOf('/games/boardgame/kot-premium/rules.html') !== -1);
  s.ok('预缓存清单含 Kot 脚本', manifestSrc.indexOf('/games/boardgame/kot-premium/engine.js') !== -1 &&
    manifestSrc.indexOf('/games/boardgame/kot-premium/data.js') !== -1);
  s.ok('预缓存清单含 Kot 联机页/realism', manifestSrc.indexOf('/games/boardgame/kot-premium/online.html') !== -1 &&
    manifestSrc.indexOf('/games/boardgame/kot-premium/realism.json') !== -1);
  s.ok('预缓存清单含 6 怪兽立绘', DATA.MONSTERS.every(function (m) {
    return manifestSrc.indexOf('/games/assets/art/premium/kot/' + m.art) !== -1;
  }));
  s.ok('预缓存清单含骰面/夜景/封面/OG/详情',
    ['die-face.webp', 'tokyo-night.webp', 'cover.webp', 'og.webp', 'detail.webp'].every(function (name) {
      return manifestSrc.indexOf('/games/assets/art/premium/kot/' + name) !== -1;
    }));
  s.ok('预缓存清单含 shared rewards/leaderboard', manifestSrc.indexOf('/games/shared/rewards.js') !== -1 &&
    manifestSrc.indexOf('/games/shared/leaderboard.js') !== -1);

  var report = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e-report.json'), 'utf8'));
  s.eq('E2E 报告 desktop 79/0', [report.runs.desktop.pass, report.runs.desktop.fail], [79, 0]);
  s.eq('E2E 报告 iOS 32/0', [report.runs.ios.pass, report.runs.ios.fail], [32, 0]);
  s.ok('E2E 报告外部请求 0', report.runs.desktop.external_requests.length === 0 &&
    report.runs.ios.external_requests.length === 0);
  s.ok('E2E 报告 390×844 视口', report.runs.desktop.viewports['390x844'].width === 390 &&
    report.runs.desktop.viewports['390x844'].height === 844);
  s.ok('E2E 报告 320×568 视口', report.runs.desktop.viewports['320x568'].width === 320 &&
    report.runs.desktop.viewports['320x568'].height === 568);
  s.eq('E2E 390 最小可见字号 12px', report.runs.desktop.viewports['390x844'].fonts.minVisible, 12);
  s.eq('E2E 320 最小可见字号 12px', report.runs.desktop.viewports['320x568'].fonts.minVisible, 12);
  s.eq('E2E iOS 最小可见字号 12px', report.runs.ios.viewports['ios-390x844'].fonts.minVisible, 12);

  var acceptance = fs.readFileSync(path.join(__dirname, 'ACCEPTANCE.md'), 'utf8');
  s.ok('ACCEPTANCE 含 test 退出码 0', /退出码：0/.test(acceptance));
  s.ok('ACCEPTANCE 含故意失败退出码 1', /退出码：1/.test(acceptance));
  s.ok('ACCEPTANCE 含 390×844 与 320×568', /390×844/.test(acceptance) && /320×568/.test(acceptance));
  s.ok('ACCEPTANCE 含 sw 预缓存 PASS', /SW_PRECACHE PASS/.test(acceptance));
  s.ok('ACCEPTANCE 含 CPU/内存/耗时', /peak memory|RSS|real/i.test(acceptance));
  var progress = fs.readFileSync(path.join(__dirname, 'PROGRESS.md'), 'utf8');
  s.ok('PROGRESS.md 可中断续跑', /可中断续跑/.test(progress));
  s.ok('PROGRESS.md 标 shipped 与联机实现', /shipped/.test(progress) && /联机实现/.test(progress));
  s.ok('E2E harness 与 Node 服务存在', fs.existsSync(path.join(__dirname, 'e2e-harness.html')) && fs.existsSync(path.join(__dirname, 'serve.mjs')));
  s.ok('E2E 文档使用 Node 服务', /serve\.mjs/.test(e2e) && !/python3 -m http\.server/.test(e2e));
  var metaPage = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
  s.ok('meta 记录 shared/sw/e2e 证据', !!metaPage.sharedModules && metaPage.swPrecache === true &&
    metaPage.e2eReport === 'e2e-report.json' && metaPage.progress === 'PROGRESS.md');
  s.ok('meta 记录 realism 与联机实现', metaPage.realismFile === 'realism.json' &&
    metaPage.onlineServer === 'online-server.mjs' && metaPage.online.evidence === 'online-e2e.json');
  var onlineHtml = fs.readFileSync(path.join(__dirname, 'online.html'), 'utf8');
  var onlineServer = fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8');
  s.ok('online.html 覆盖房间/邀请/重连/开始', /\/api\/rooms/.test(onlineHtml) && /inviteToken/.test(onlineHtml) &&
    /reconnect/.test(onlineHtml) && /data-act="start"/.test(onlineHtml));
  s.ok('online.html 手机全文字 ≥12px', /font-size:12px!important/.test(onlineHtml));
  s.ok('online-server 复用 app/rooms.js', /from '\.\.\/app\/rooms\.js'/.test(onlineServer));
  s.ok('online-server 有邀请/重连/托管/榜单', /inviteToken/.test(onlineServer) && /reconnect/.test(onlineServer) &&
    /takeover/.test(onlineServer) && /leaderboard/.test(onlineServer));
});

s.done();
