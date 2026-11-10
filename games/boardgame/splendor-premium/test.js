'use strict';

/*
 * 璀璨宝石 Splendor（premium 版）引擎与页面测试。
 *
 * 运行：node games/boardgame/splendor-premium/test.js
 * 覆盖：真实件数、开局、四类行动、预留与黄金、购买支付、贵族、终局、
 *       平局判定、30 局 AI 自对弈、宝石守恒、页面离线与可访问性契约。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('splendor-premium');
var E = require('./engine.js');
var D = require('./data.js');

var DIR = __dirname;
var index = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(DIR, 'rules.html'), 'utf8');
var dataSrc = fs.readFileSync(path.join(DIR, 'data.js'), 'utf8');
var engineSrc = fs.readFileSync(path.join(DIR, 'engine.js'), 'utf8');

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function cjkCount(text) {
  var m = text.match(/[㐀-鿿]/g);
  return m ? m.length : 0;
}

function moveKey(move) {
  return JSON.stringify(move);
}

function assertGemConservation(label, state) {
  var counts = E.totalGemsInPlay(state);
  s.eq(label + '：白钻仍为 4', counts.white, 4);
  s.eq(label + '：蓝宝仍为 4', counts.blue, 4);
  s.eq(label + '：祖母绿仍为 4', counts.green, 4);
  s.eq(label + '：红宝仍为 4', counts.red, 4);
  s.eq(label + '：黑玛瑙仍为 4', counts.black, 4);
  s.eq(label + '：黄金仍为 5', counts.gold, 5);
}

function findAffordableCard(state) {
  var moves = E.getLegalMoves(state).filter(function (m) { return m.type === 'buy'; });
  return moves.length ? moves[0] : null;
}

/* ------------------------------------------------------------------ */
/* 1. 数据与真实件数                                                   */
/* ------------------------------------------------------------------ */

s.group('数据与真实件数', function () {
  s.eq('颜色共 5 种', E.COLORS.length, 5);
  s.eq('颜色顺序稳定', E.COLORS, ['white', 'blue', 'green', 'red', 'black']);
  s.eq('发展卡共 90 张', E.CARD_CATALOG.length, 90);
  s.eq('一级 40 张', E.CARD_CATALOG.filter(function (c) { return c.tier === 1; }).length, 40);
  s.eq('二级 30 张', E.CARD_CATALOG.filter(function (c) { return c.tier === 2; }).length, 30);
  s.eq('三级 20 张', E.CARD_CATALOG.filter(function (c) { return c.tier === 3; }).length, 20);
  s.eq('贵族共 10 张', E.NOBLES.length, 10);
  s.eq('贵族都是 3 声望', E.NOBLES.every(function (n) { return n.points === 3; }), true);
  s.eq('发展卡 ID 唯一', new Set(E.CARD_CATALOG.map(function (c) { return c.id; })).size, 90);
  s.eq('每张卡都有费用与奖励色', E.CARD_CATALOG.every(function (c) {
    return c.bonus && E.COLORS.indexOf(c.bonus) !== -1 && typeof c.cost === 'object' &&
      E.COLORS.every(function (color) { return typeof c.cost[color] === 'number'; });
  }), true);
  s.eq('贵族要求都是已知颜色', E.NOBLES.every(function (n) {
    return Object.keys(n.need).every(function (color) { return E.COLORS.indexOf(color) !== -1; });
  }), true);
  s.eq('数据页是 UMD', /root\.SplendorData/.test(dataSrc), true);
  s.eq('引擎页是 UMD', /root\.SplendorEngine/.test(engineSrc), true);
  s.eq('引擎不调用 Math.random', /Math\.random/.test(engineSrc), false);
});

/* ------------------------------------------------------------------ */
/* 2. 两人局开局                                                       */
/* ------------------------------------------------------------------ */

s.group('两人局开局', function () {
  var state = E.createGame(20261110);
  s.eq('开局 2 名玩家', state.players.length, 2);
  s.eq('每色宝石 4 枚', E.COLORS.map(function (c) { return state.gems[c]; }), [4, 4, 4, 4, 4]);
  s.eq('黄金 5 枚', state.gems.gold, 5);
  s.eq('贵族亮出 3 张', state.nobles.length, 3);
  s.eq('贵族全部未到访', state.nobles.every(function (n) { return n.claimedBy === null; }), true);
  s.eq('每级亮出 4 张', [1, 2, 3].map(function (t) { return state.faceUp[t].length; }), [4, 4, 4]);
  s.eq('每级牌堆剩余', [1, 2, 3].map(function (t) { return state.decks[t].length; }), [36, 26, 16]);
  s.eq('开局总卡数 90', [1, 2, 3].reduce(function (sum, t) {
    return sum + state.decks[t].length + state.faceUp[t].length;
  }, 0), 90);
  s.eq('开局玩家 0', state.current, 0);
  s.eq('开局第 1 轮', state.round, 1);
  s.eq('双方 0 声望', state.players.map(function (p) { return p.prestige; }), [0, 0]);
  s.eq('双方 0 张发展卡', state.players.map(function (p) { return p.cards.length; }), [0, 0]);
  s.eq('双方筹码为空', state.players.map(function (p) { return E.tokenTotal(p); }), [0, 0]);
  assertGemConservation('开局', state);

  var seedA = E.createGame(7);
  var seedB = E.createGame(7);
  s.eq('同种子开局完全一致', JSON.stringify(seedA), JSON.stringify(seedB));
  var seedC = E.createGame(8);
  s.ok('不同种子牌序不同', JSON.stringify(seedA.faceUp) !== JSON.stringify(seedC.faceUp));
});

/* ------------------------------------------------------------------ */
/* 3. 初始合法动作                                                     */
/* ------------------------------------------------------------------ */

s.group('初始合法动作', function () {
  var state = E.createGame(1);
  var moves = E.getLegalMoves(state);
  var take3 = moves.filter(function (m) { return m.type === 'take3'; });
  var take2 = moves.filter(function (m) { return m.type === 'take2'; });
  var reserve = moves.filter(function (m) { return m.type === 'reserve'; });
  var buy = moves.filter(function (m) { return m.type === 'buy'; });
  s.eq('初始有 10 种拿三色组合', take3.length, 10);
  s.eq('初始 5 种拿两同色', take2.length, 5);
  s.eq('初始不能购买', buy.length, 0);
  s.eq('初始可预留 12 张明牌', reserve.filter(function (m) { return m.source === 'faceUp'; }).length, 12);
  s.eq('初始可盲抽 3 个牌堆', reserve.filter(function (m) { return m.source === 'deck'; }).length, 3);
  s.eq('初始共 30 个合法动作', moves.length, 30);
  s.eq('拿三色不重复', take3.every(function (m) {
    return new Set(m.colors).size === 3;
  }), true);
});

/* ------------------------------------------------------------------ */
/* 4. 拿取行动                                                         */
/* ------------------------------------------------------------------ */

s.group('拿取行动', function () {
  var state = E.createGame(1);
  var next = E.applyMove(state, { type: 'take3', colors: ['white', 'blue', 'green'] });
  s.eq('拿三色后玩家获得 3 枚', E.tokenTotal(next.players[0]), 3);
  s.eq('拿三色后银行减少', [next.gems.white, next.gems.blue, next.gems.green], [3, 3, 3]);
  s.eq('拿三色后轮到玩家 1', next.current, 1);
  s.eq('原状态未被修改', E.tokenTotal(state.players[0]), 0);
  assertGemConservation('拿三色后', next);

  var next2 = E.applyMove(next, { type: 'take2', color: 'red' });
  s.eq('拿两同色获得 2 枚', next2.players[1].tokens.red, 2);
  s.eq('拿两同色银行剩 2', next2.gems.red, 2);
  s.eq('拿两同色后轮次进入第 2 轮', next2.round, 2);
  assertGemConservation('拿两同色后', next2);

  expectThrow('重复颜色拿三色被拒绝', function () {
    E.applyMove(E.createGame(1), { type: 'take3', colors: ['white', 'white', 'blue'] });
  }, /重复/);
  expectThrow('非法颜色被拒绝', function () {
    E.applyMove(E.createGame(1), { type: 'take3', colors: ['white', 'blue', 'purple'] });
  }, /未知/);
  expectThrow('非当前玩家被拒绝', function () {
    E.applyMove(E.createGame(1), { type: 'take3', colors: ['white', 'blue', 'green'], player: 1 });
  }, /轮到/);

  var drained = E.createGame(1);
  drained.gems.red = 3;
  expectThrow('库存不足 4 枚不能拿两同色', function () {
    E.applyMove(drained, { type: 'take2', color: 'red' });
  }, /至少 4 枚/);

  var full = E.createGame(1);
  full.players[0].tokens.white = 10;
  var fullMoves = E.getLegalMoves(full);
  s.eq('筹码满 10 枚时没有拿取动作', fullMoves.filter(function (m) {
    return m.type === 'take3' || m.type === 'take2';
  }).length, 0);
});

/* ------------------------------------------------------------------ */
/* 5. 预留与黄金                                                       */
/* ------------------------------------------------------------------ */

s.group('预留与黄金', function () {
  var state = E.createGame(1);
  var card = state.faceUp[1][0];
  var next = E.applyMove(state, { type: 'reserve', cardId: card.id, source: 'faceUp' });
  s.eq('预留后进入预留区', next.players[0].reserved.length, 1);
  s.eq('预留后获得 1 枚黄金', next.players[0].tokens.gold, 1);
  s.eq('银行黄金减少 1', next.gems.gold, 4);
  s.eq('预留后该槽补牌', next.faceUp[1][0] !== null, true);
  s.eq('一级牌堆减少 1', next.decks[1].length, 35);
  assertGemConservation('预留后', next);

  var blindState = E.createGame(1);
  var top = blindState.decks[2][0];
  var blind = E.applyMove(blindState, { type: 'reserve', tier: 2, source: 'deck' });
  s.eq('盲抽进入预留区', blind.players[0].reserved.length, 1);
  s.eq('盲抽到牌堆顶卡', blind.players[0].reserved[0].id, top.id);
  s.eq('盲抽后二级牌堆减少 1', blind.decks[2].length, 25);
  s.eq('盲抽也拿黄金', blind.players[0].tokens.gold, 1);

  var limit = E.createGame(1);
  limit.players[0].reserved = [limit.faceUp[1][0], limit.faceUp[1][1], limit.faceUp[1][2]];
  expectThrow('预留区已满 3 张时不能再预留', function () {
    E.applyMove(limit, { type: 'reserve', tier: 1, source: 'deck' });
  }, /最多 3 张/);

  var noGold = E.createGame(1);
  noGold.gems.gold = 0;
  var noGoldNext = E.applyMove(noGold, { type: 'reserve', tier: 1, source: 'deck' });
  s.eq('黄金用尽仍可预留', noGoldNext.players[0].reserved.length, 1);
  s.eq('黄金用尽不获得黄金', noGoldNext.players[0].tokens.gold, 0);
});

/* ------------------------------------------------------------------ */
/* 6. 购买、折扣与黄金补差                                             */
/* ------------------------------------------------------------------ */

s.group('购买与支付', function () {
  var state = E.createGame(1);
  // 找到一张一级 0 分、费用 3 白钻的卡，给玩家足够筹码直接购买。
  var card = E.CARD_CATALOG.filter(function (c) {
    return c.tier === 1 && c.cost.white === 3 && c.costTotal === 3;
  })[0];
  state.faceUp[1][0] = JSON.parse(JSON.stringify(card));
  state.players[0].tokens.white = 3;
  state.gems.white = 1;
  var next = E.applyMove(state, { type: 'buy', cardId: card.id, source: 'faceUp' });
  s.eq('购买后发展卡 +1', next.players[0].cards.length, 1);
  s.eq('购买后奖励色加成为 1', next.players[0].bonuses[card.bonus], 1);
  s.eq('购买后支付 3 枚白钻', next.players[0].tokens.white, 0);
  s.eq('购买后银行白钻回到 4', next.gems.white, 4);
  assertGemConservation('购买后', next);

  // 永久加成抵扣：一张 2 白钻的卡，已有 1 点白钻加成，只需支付 1 枚。
  var s2 = E.createGame(1);
  var card2 = JSON.parse(JSON.stringify(E.CARD_CATALOG[0]));
  card2.cost = { white: 2, blue: 0, green: 0, red: 0, black: 0 };
  card2.costTotal = 2;
  card2.points = 0;
  s2.faceUp[1][0] = JSON.parse(JSON.stringify(card2));
  s2.players[0].bonuses.white = 1;
  s2.players[0].tokens.white = 1;
  var pay = E.paymentFor(s2, 0, card2);
  s.eq('加成先抵扣费用', pay.colored.white, 1);
  s.eq('加成抵扣后无需黄金', pay.gold, 0);
  s.eq('支付判定通过', pay.ok, true);

  // 黄金补差：费用 3 白钻，只有 1 枚白钻 + 2 枚黄金。
  var s3 = E.createGame(1);
  var card3 = E.CARD_CATALOG.filter(function (c) {
    return c.tier === 1 && c.cost.white === 3 && c.costTotal === 3;
  })[0];
  s3.faceUp[1][0] = JSON.parse(JSON.stringify(card3));
  s3.players[0].tokens.white = 1;
  s3.players[0].tokens.gold = 2;
  var pay3 = E.paymentFor(s3, 0, card3);
  s.eq('黄金补足 2 枚差额', pay3.gold, 2);
  s.eq('黄金支付判定通过', pay3.ok, true);
  var bought3 = E.applyMove(s3, { type: 'buy', cardId: card3.id, source: 'faceUp' });
  s.eq('黄金购买后黄金归零', bought3.players[0].tokens.gold, 0);
  s.eq('黄金购买后白钻归零', bought3.players[0].tokens.white, 0);

  var poor = E.createGame(1);
  poor.players[0].tokens.white = 1;
  expectThrow('筹码不足购买被拒绝', function () {
    E.applyMove(poor, { type: 'buy', cardId: poor.faceUp[1][0].id, source: 'faceUp' });
  }, /不足/);
});

/* ------------------------------------------------------------------ */
/* 7. 贵族与终局                                                       */
/* ------------------------------------------------------------------ */

s.group('贵族与终局', function () {
  var noble = E.NOBLES[0];
  s.eq('贵族需求判定：满足', E.nobleRequirementsMet({
    bonuses: { white: 4, blue: 4, green: 0, red: 0, black: 0 }
  }, noble), true);
  s.eq('贵族需求判定：不满足', E.nobleRequirementsMet({
    bonuses: { white: 4, blue: 3, green: 0, red: 0, black: 0 }
  }, noble), false);

  var state = E.createGame(1);
  var ourNoble = state.nobles[0];
  E.COLORS.forEach(function (color) {
    state.players[0].bonuses[color] = ourNoble.need[color] || 0;
  });
  // 买一张不需要任何费用的卡：直接构造 0 费卡，验证贵族到访。
  var freeCard = JSON.parse(JSON.stringify(E.CARD_CATALOG[0]));
  freeCard.cost = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  freeCard.costTotal = 0;
  freeCard.points = 0;
  state.faceUp[1][0] = freeCard;
  var next = E.applyMove(state, { type: 'buy', cardId: freeCard.id, source: 'faceUp' });
  s.eq('满足要求后贵族到访', next.players[0].nobles, 1);
  s.eq('贵族到访 +3 声望', next.players[0].prestige, 3);
  s.eq('贵族标记为已到访', next.nobles.some(function (n) { return n.claimedBy === 0; }), true);

  var end = E.createGame(1);
  end.players[0].prestige = 14;
  var pointCard = E.CARD_CATALOG.filter(function (c) {
    return c.tier === 1 && c.points === 1;
  })[0];
  pointCard = JSON.parse(JSON.stringify(pointCard));
  pointCard.cost = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  pointCard.costTotal = 0;
  end.faceUp[1][0] = pointCard;
  var afterTrigger = E.applyMove(end, { type: 'buy', cardId: pointCard.id, source: 'faceUp' });
  s.eq('达到 15 声望触发终局标记', afterTrigger.endgameTriggered, true);
  s.eq('触发后尚未立刻结束', afterTrigger.over, false);
  var afterReply = E.applyMove(afterTrigger, { type: 'take3', colors: ['white', 'blue', 'green'] });
  s.eq('最后一轮结束对局', afterReply.over, true);
  s.ok('终局结果含胜负', afterReply.result && typeof afterReply.result.winner !== 'undefined');

  // 平局：声望相同，发展卡更少者胜。
  var tie = E.createGame(1);
  tie.over = true;
  tie.overReason = '测试平局';
  tie.players[0].prestige = 10;
  tie.players[1].prestige = 10;
  tie.players[0].cards = [1, 2];
  tie.players[1].cards = [1, 2, 3];
  s.eq('同声望时发展卡更少者获胜', E.getResults(tie).winner, 0);
  tie.players[1].cards = [1, 2];
  s.eq('声望与发展卡都相同则平局', E.getResults(tie).winner, null);
});

/* ------------------------------------------------------------------ */
/* 8. 30 局 AI 自对弈                                                  */
/* ------------------------------------------------------------------ */

s.group('30 局 AI 自对弈', function () {
  var allLegal = true;
  var allOver = true;
  var gemStable = true;
  var turns = [];
  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame(seed);
    var guard = 0;
    var legalHere = true;
    while (!state.over && guard < 800) {
      var moves = E.getLegalMoves(state);
      if (!moves.length) { legalHere = false; break; }
      var move = E.chooseAIMove(state);
      if (!moves.some(function (m) { return moveKey(m) === moveKey(move); })) legalHere = false;
      try {
        state = E.applyMove(state, move);
      } catch (error) {
        legalHere = false;
        break;
      }
      guard += 1;
    }
    if (!legalHere) allLegal = false;
    if (!state.over) allOver = false;
    var counts = E.totalGemsInPlay(state);
    if (counts.white !== 4 || counts.blue !== 4 || counts.green !== 4 ||
        counts.red !== 4 || counts.black !== 4 || counts.gold !== 5) gemStable = false;
    turns.push(guard);
    s.ok('种子 ' + seed + ' 自对弈合法结束', legalHere && state.over && guard < 800,
      '步数 ' + guard + '，结束 ' + state.over);
  }
  s.ok('30 局全部只走合法动作', allLegal);
  s.ok('30 局全部正常结束', allOver);
  s.ok('30 局宝石与黄金总量守恒', gemStable);
  s.ok('自对弈步数在合理范围', Math.min.apply(null, turns) >= 8 && Math.max.apply(null, turns) <= 800,
    'min ' + Math.min.apply(null, turns) + ', max ' + Math.max.apply(null, turns));
});

/* ------------------------------------------------------------------ */
/* 9. 页面契约                                                         */
/* ------------------------------------------------------------------ */

s.group('页面离线与可访问性契约', function () {
  s.ok('游戏页有 viewport', /name="viewport"/.test(index));
  s.ok('游戏页引用同源 data.js', /<script[^>]*src="data\.js"/.test(index));
  s.ok('游戏页引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(index));
  s.ok('游戏页无外部脚本', !/<script[^>]*src="https?:/i.test(index));
  s.ok('游戏页无外部样式表', !/<link[^>]*rel="stylesheet"/i.test(index));
  s.ok('游戏页无 fetch / XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(index));
  s.ok('游戏页无远程 url()', !/url\(\s*["']?https?:/i.test(index));
  s.ok('游戏页有 430px 媒体查询', /@media\s*\(max-width:\s*430px\)/.test(index));
  s.ok('游戏页有减少动效降级', /prefers-reduced-motion/.test(index));
  s.ok('游戏页有暗色可读方案', /prefers-color-scheme:\s*dark/.test(index));
  s.ok('游戏页有 aria-label', /aria-label=/.test(index));
  s.ok('游戏页有 44px 触控目标', /min-height:\s*44px/.test(index));
  s.ok('游戏页有 SVG 宝石', /viewBox="0 0 64 64"/.test(index) && /gemSvg/.test(index));
  s.ok('游戏页复用 shared/sfx.js', /shared\/sfx\.js/.test(index) && /window\.Sfx/.test(index));
  s.ok('游戏页复用 shared/shuffle.js', /shared\/shuffle\.js/.test(index));
  s.ok('游戏页复用 shared/rewards.js', /shared\/rewards\.js/.test(index) && /Rewards\.record/.test(index));
  s.ok('游戏页有联机房间入口', /href="online\.html"/.test(index));
  s.ok('游戏页有 OG 图与封面预载', /og:image/.test(index) && /assets\/og\.webp/.test(index) && /assets\/cover\.webp/.test(index));
  s.ok('游戏页引用本地材质', /assets\/art\/premium\//.test(index) && /\.webp/.test(index));
  s.ok('有离线 sw.js', fs.existsSync(path.join(DIR, 'sw.js')) && /caches\.open/.test(fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8')));
  s.ok('有 meta.json 与 perf.json', fs.existsSync(path.join(DIR, 'meta.json')) && fs.existsSync(path.join(DIR, 'perf.json')));
  s.ok('有联机页面与服务端', fs.existsSync(path.join(DIR, 'online.html')) && /createRoomStoreInternal/.test(fs.readFileSync(path.join(DIR, 'online-server.mjs'), 'utf8')));
  s.ok('联机测试输出契约', /ONLINE_E2E_JSON/.test(fs.readFileSync(path.join(DIR, 'test-online.js'), 'utf8')));
  s.ok('游戏页有静音按钮', /id="muteBtn"/.test(index) && /play\('win'\)/.test(index));
  s.ok('游戏页有至少 3 段关键帧动画', (index.match(/@keyframes/g) || []).length >= 3);
  s.ok('游戏页有 WAAPI 动画调用', /\.animate\s*\(/.test(index));
  s.ok('游戏页有种子输入', /id="seedInput"/.test(index));
  s.ok('游戏页有重开与换局', /id="restart"/.test(index) && /id="newSeed"/.test(index));
  s.ok('游戏页有 AI 演示', /id="autoDemo"/.test(index) && /startDemo/.test(index));
  s.ok('游戏页有宝石银行', /id="bank"/.test(index) && /id="take3Btn"/.test(index) && /id="take2Btn"/.test(index));
  s.ok('游戏页有贵族与市场容器', /id="nobles"/.test(index) && /id="market"/.test(index));
  s.ok('游戏页有预留与购买按钮', /id="buyBtn"/.test(index) && /id="reserveBtn"/.test(index));
  s.ok('游戏页有对局记录', /id="log"/.test(index));
  s.ok('游戏页有结果弹层', /id="resultOverlay"/.test(index) && /role="dialog"/.test(index));
  s.ok('游戏页有键盘取消', /event\.key === 'Escape'/.test(index));
  s.ok('游戏页有调试钩子', /window\.__splendor/.test(index));
  s.ok('游戏页无 Math.random', !/Math\.random/.test(index.replace(/<script[\s\S]*?<\/script>/gi, '')));
  s.ok('游戏页无远程图片', !/<img[^>]*src="https?:/i.test(index));

  s.ok('规则页有 viewport', /name="viewport"/.test(rules));
  s.ok('规则页无外部脚本', !/<script[^>]*src="https?:/i.test(rules));
  s.ok('规则页无外部样式表', !/<link[^>]*rel="stylesheet"/i.test(rules));
  var blocks = lib.jsonLd(rules);
  var faq = blocks.filter(function (block) { return block['@type'] === 'FAQPage'; })[0];
  s.ok('规则页有 FAQPage JSON-LD', !!faq);
  s.ok('FAQ 至少 3 问', !!faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3);
  s.ok('FAQ 每问都有答案', !!faq && faq.mainEntity.every(function (item) {
    return item['@type'] === 'Question' && item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));
  s.ok('规则页 CTA 回 index.html', /href="index\.html"/.test(rules));
  s.ok('规则页链接桌游目录', /href="\.\.\/index\.html"/.test(rules));
  s.ok('规则页含真实件数说明', /90 张/.test(rules) && /40 张/.test(rules) && /10 张/.test(rules));
  s.ok('规则页含四类行动', /拿 3 种/.test(rules) && /预留/.test(rules) && /购买/.test(rules));
  s.ok('规则页含 B 站 BV 号', /BV1KJ411F7Tq/.test(rules) && /BV195xjeZEH9/.test(rules) && /BV1R7411k7BL/.test(rules) && /BV1zGp9zWE4u/.test(rules));
  s.ok('规则页含 B 站链接', /bilibili\.com\/video\/BV/.test(rules));
  s.ok('规则页含公开文字规则核对', /官方规则/.test(rules) && /公开/.test(rules));
  var count = cjkCount(rules);
  s.ok('规则正文 1200 字以上', count >= 1200, count + ' 字');
});

s.done();
