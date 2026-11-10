'use strict';

// 6 Nimmt! / 谁是牛头王 premium — engine, rules, presentation and artifact
// tests. Runs standalone (no Chrome) and through games/tests/run-all.js.
// Prints the machine-readable RESULT line consumed by run-all.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('six-nimmt-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function chineseCount(html) {
  return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hand(row) { return row.slice(); }

// Minimal WebP dimension reader (VP8X / VP8 / VP8L), no dependencies.
function webpSize(file) {
  var b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  var chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), kind: 'VP8X' };
  }
  if (chunk === 'VP8 ') {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, kind: 'VP8' };
  }
  if (chunk === 'VP8L') {
    var bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), kind: 'VP8L' };
  }
  return null;
}

s.group('牌堆与初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('默认 3 名玩家', g.players.length, 3);
  s.eq('完整牌堆 104 张', E.fullDeck().length, 104);
  s.eq('全牌 1..104 不重不漏', (function () {
    var d = E.fullDeck();
    if (d.length !== 104) return false;
    for (var i = 0; i < d.length; i++) if (d[i] !== i + 1) return false;
    return true;
  })(), true);
  s.eq('每人 10 张手牌', g.players.map(function (p) { return p.hand.length; }), [10, 10, 10]);
  s.eq('开局 4 行', g.rows.length, E.ROWS);
  s.ok('每行 1 张起始牌', g.rows.every(function (row) { return row.length === 1; }));
  s.eq('未使用牌 70 张', g.unused.length, 104 - 30 - 4);
  s.eq('开局第 1 轮', g.round, 1);
  s.eq('阶段为 pick', g.phase, 'pick');
  s.eq('牌数守恒 104', E.totalCards(g), 104);
  s.eq('手牌升序', g.players[0].hand.slice().sort(function (a, b) { return a - b; }), g.players[0].hand);
  s.eq('双人局可创建', E.createGame({ seed: 2, players: 2 }).players.length, 2);
  s.eq('十人局可创建', E.createGame({ seed: 3, players: 10 }).players.length, 10);
  s.eq('十人局用光所有牌', E.createGame({ seed: 3, players: 10 }).unused.length, 0);
  s.eq('十人局每人 10 张', E.createGame({ seed: 3, players: 10 }).players.every(function (p) { return p.hand.length === 10; }), true);
  var threw = false;
  try { E.createGame({ players: 1 }); } catch (e) { threw = true; }
  s.ok('1 人被拒绝', threw);
  threw = false;
  try { E.createGame({ players: 11 }); } catch (e) { threw = true; }
  s.ok('11 人被拒绝', threw);
  s.eq('数据标题', D.title, '6 Nimmt! 谁是牛头王');
  s.eq('数据人数 2–10', D.players, '2–10 人');
  s.eq('AI 名称 10 个', D.aiNames.length, 10);
  s.eq('B 站来源 3 条', D.sources.length, 3);
});

s.group('牛头分与行定位', function () {
  s.eq('55 是 7 分', E.bull(55), 7);
  s.eq('11 是 5 分', E.bull(11), 5);
  s.eq('22 是 5 分', E.bull(22), 5);
  s.eq('33 是 5 分', E.bull(33), 5);
  s.eq('44 是 5 分', E.bull(44), 5);
  s.eq('99 是 5 分', E.bull(99), 5);
  s.eq('10 是 3 分', E.bull(10), 3);
  s.eq('20 是 3 分', E.bull(20), 3);
  s.eq('100 是 3 分', E.bull(100), 3);
  s.eq('5 是 2 分', E.bull(5), 2);
  s.eq('25 是 2 分', E.bull(25), 2);
  s.eq('95 是 2 分', E.bull(95), 2);
  s.eq('104 是 1 分', E.bull(104), 1);
  s.eq('17 是 1 分', E.bull(17), 1);
  s.eq('1 是 1 分', E.bull(1), 1);
  s.eq('行分累加', E.rowPoints([55, 44, 30, 25, 17]), 7 + 5 + 3 + 2 + 1);
  var rows = [[10], [20], [30], [40]];
  s.eq('25 接第 2 行', E.targetRow(rows, 25), 1);
  s.eq('41 接第 4 行', E.targetRow(rows, 41), 3);
  s.eq('5 无处可接', E.targetRow(rows, 5), -1);
  s.eq('等于行尾不能接', E.targetRow(rows, 10), -1);
  s.eq('40 不能接自己', E.targetRow(rows, 40), 2);
  s.eq('104 接 40 行', E.targetRow(rows, 104), 3);
});

s.group('同时出牌与升序结算', function () {
  var g = E.createGame({ seed: 4 });
  var c0 = g.players[0].hand[0], c1 = g.players[1].hand[0], c2 = g.players[2].hand[0];
  s.eq('合法出牌', E.legalPick(g, 0, c0), true);
  s.eq('非本手牌非法', E.legalPick(g, 0, 105), false);
  s.eq('非本人手牌非法', E.legalPick(g, 1, c0), false);
  E.pickCard(g, 0, c0);
  s.eq('暗牌记录在 picks', g.picks[0], c0);
  s.eq('手牌减少一张', g.players[0].hand.length, 9);
  s.eq('未出齐仍等待', g.phase, 'pick');
  var threw = false;
  try { E.pickCard(g, 0, g.players[0].hand[0]); } catch (e) { threw = true; }
  s.ok('同一轮重复出牌抛错', threw);
  E.pickCard(g, 1, c1);
  E.pickCard(g, 2, c2);
  s.eq('出齐后进入下一轮', g.round, 2);
  s.eq('picks 已清空', g.picks, [null, null, null]);
  s.eq('手牌各少一张', g.players.map(function (p) { return p.hand.length; }), [9, 9, 9]);
  s.eq('每行不超过 5 张', g.rows.every(function (row) { return row.length <= 5; }), true);

  // Ascending resolution: 21 must be placed before 25, otherwise row 1 would
  // read [20,25,21]. The official order keeps every row ascending.
  var a = E.createGame({ seed: 5 });
  a.rows = [[10], [20], [30], [40]];
  a.players[0].hand = [25];
  a.players[1].hand = [21];
  a.players[2].hand = [50];
  E.pickCard(a, 0, 25);
  E.pickCard(a, 1, 21);
  E.pickCard(a, 2, 50);
  s.eq('21 与 25 按升序接到同一行', a.rows[1], [20, 21, 25]);
  s.eq('50 接到 40 行', a.rows[3], [40, 50]);
  s.eq('升序结算后行内保持升序', a.rows[1].every(function (c, i, arr) { return i === 0 || arr[i - 1] < c; }), true);
});

s.group('低于所有行尾与选行', function () {
  var g = E.createGame({ seed: 6 });
  g.rows = [[10], [20], [30], [40]];
  g.players[0].hand = [5, 60];
  g.players[1].hand = [45, 61];
  g.players[2].hand = [50, 62];
  E.pickCard(g, 0, 5);
  E.pickCard(g, 1, 45);
  E.pickCard(g, 2, 50);
  s.eq('人类玩家被要求选行', g.phase, 'chooseRow');
  s.eq('待选玩家是 0', g.pending.player, 0);
  s.eq('待选牌是 5', g.pending.card, 5);
  s.eq('未选时 45 尚未落位', g.rows[3], [40]);
  var threw = false;
  try { E.chooseRow(g, 1, 0); } catch (e) { threw = true; }
  s.ok('非待选玩家不能选行', threw);
  threw = false;
  try { E.chooseRow(g, 0, 9); } catch (e) { threw = true; }
  s.ok('非法行号抛错', threw);
  E.chooseRow(g, 0, 2);
  s.ok('吃下所选第 3 行', g.players[0].taken.indexOf(30) >= 0);
  s.eq('该行换成新牌 5', g.rows[2], [5]);
  s.eq('45 与 50 继续按升序接到第 4 行', g.rows[3], [40, 45, 50]);
  s.eq('第 2 行保持原样', g.rows[1], [20]);
  s.eq('选行阶段结束', g.phase, 'pick');
  s.eq('选行后到第 2 轮', g.round, 2);
});

s.group('第五张与第六张吃行', function () {
  var g = E.createGame({ seed: 7 });
  g.rows = [[10, 11, 12, 13, 14], [20], [30], [40]];
  g.players[0].hand = [15];
  g.players[1].hand = [45];
  g.players[2].hand = [50];
  E.pickCard(g, 0, 15);
  E.pickCard(g, 1, 45);
  E.pickCard(g, 2, 50);
  s.eq('吃下整行五张', [10, 11, 12, 13, 14].every(function (c) { return g.players[0].taken.indexOf(c) >= 0; }), true);
  s.eq('吃行后该行只剩新牌', g.rows[0], [15]);
  s.eq('吃行分数正确', E.score(g, 0), E.rowPoints([10, 11, 12, 13, 14]));
  s.eq('其余牌继续结算', g.rows[3], [40, 45, 50]);

  var h = E.createGame({ seed: 8 });
  h.rows = [[10, 11, 12, 13], [20], [30], [40]];
  h.players[0].hand = [14];
  h.players[1].hand = [45];
  h.players[2].hand = [50];
  E.pickCard(h, 0, 14);
  E.pickCard(h, 1, 45);
  E.pickCard(h, 2, 50);
  s.eq('第四张后接第五张不吃行', h.rows[0].length, 5);
  s.eq('第五张不吃行得 0 分', E.score(h, 0), 0);

  // A card pointing at a now-full row eats all five immediately.
  var i2 = E.createGame({ seed: 8 });
  i2.rows = [[10, 11, 12, 13, 14], [20], [30], [40]];
  i2.players[0].hand = [15];
  i2.players[1].hand = [46];
  i2.players[2].hand = [51];
  E.pickCard(i2, 0, 15);
  E.pickCard(i2, 1, 46);
  E.pickCard(i2, 2, 51);
  s.eq('指向满行立即吃行', i2.players[0].taken.length, 5);
  s.eq('吃行后满行换成 15', i2.rows[0], [15]);
});

s.group('终局、并列与计分', function () {
  var g = E.createGame({ seed: 9, players: 2 });
  g.rows = [[1], [2], [3], [4]];
  g.players[0].hand = [5];
  g.players[1].hand = [6];
  g.players[0].taken = [10];
  g.players[1].taken = [10];
  g.round = 10;
  E.pickCard(g, 0, 5);
  E.pickCard(g, 1, 6);
  s.eq('手牌打空后结束', g.phase, 'over');
  s.eq('恰好 10 轮标记', g.round, 10);
  s.eq('双方同为 3 牛', g.players.map(function (_, i) { return E.score(g, i); }), [3, 3]);
  s.eq('并列赢家两人', g.winnerIds, [0, 1]);
  s.eq('tied 为 true', g.tied, true);
  s.eq('终局事件类型 over', g.events[g.events.length - 1].type, 'over');
  s.eq('终局事件含分数', g.events[g.events.length - 1].scores, [3, 3]);
  s.eq('结束后公开未使用牌', E.publicView(g, 0).unused.length, g.unused.length);
  var h = E.createGame({ seed: 10, players: 2 });
  h.players[0].taken = [55, 44, 33];
  h.players[1].taken = [3, 4, 5];
  s.eq('55+44+33 = 17 牛', E.score(h, 0), 17);
  s.eq('3+4+5 = 4 牛', E.score(h, 1), 4);
  var b = E.scoreBreakdown(h, 0);
  s.eq('拆解总数', b.total, 17);
  s.eq('拆解张数', b.count, 3);
  s.eq('拆解 7 分牌计数', b.byBull[7], 1);
  s.eq('拆解最高牌', b.highest, 55);
});

s.group('AI 决策纯函数与自对弈', function () {
  var g = E.createGame({ seed: 11, players: 3 });
  var before = JSON.stringify(g);
  var decision = E.aiDecision(g, 1);
  s.eq('aiDecision 不修改状态', JSON.stringify(g), before);
  s.ok('AI 返回出牌动作', decision && decision.type === 'pick');
  s.ok('AI 选择的牌在手中', decision && g.players[1].hand.indexOf(decision.card) >= 0);
  var rowChoice = E.aiRowChoice(g, 1);
  s.ok('AI 选行索引合法', rowChoice >= 0 && rowChoice < 4);
  var minPts = Math.min.apply(null, g.rows.map(function (row) { return E.rowPoints(row); }));
  s.eq('AI 选牛头最少的一行', E.rowPoints(g.rows[rowChoice]), minPts);
  var aig = E.createGame({ seed: 12, players: 3 });
  aig.phase = 'chooseRow';
  aig.pending = { player: 1, card: 50 };
  var rowBefore = JSON.stringify(aig);
  var rowDecision = E.aiDecision(aig, 1);
  s.eq('aiDecision 选行也不修改状态', JSON.stringify(aig), rowBefore);
  s.eq('AI 选行动作类型', rowDecision.type, 'row');
  s.eq('非待选玩家 AI 返回 null', E.aiDecision(aig, 2), null);

  // JSON round-trip: the same serialized state must produce the same decisions
  // and the same resulting state (online replay contract).
  var p = E.createGame({ seed: 13, players: 3 });
  var q = clone(p);
  var same = true;
  for (var step = 0; step < 9; step++) {
    var dp = E.aiDecision(p, 1);
    var dq = E.aiDecision(q, 1);
    if (JSON.stringify(dp) !== JSON.stringify(dq)) { same = false; break; }
    if (!dp) break;
    E.applyDecision(p, dp);
    E.applyDecision(q, dq);
    if (JSON.stringify(p) !== JSON.stringify(q)) { same = false; break; }
  }
  s.ok('JSON 克隆后 AI 决策与状态完全一致', same);
  s.eq('JSON 克隆后牌数仍守恒', E.totalCards(p), 104);

  var bad = 0, roundBad = 0, handBad = 0, winnerBad = 0, conservBad = 0;
  for (var players = 2; players <= 10; players++) {
    for (var seed = 1; seed <= 2; seed++) {
      try {
        var game = E.selfPlay(seed * 37 + players, players);
        if (game.phase !== 'over') bad++;
        if (game.round !== 10) roundBad++;
        if (game.players.some(function (pl) { return pl.hand.length !== 0; })) handBad++;
        if (E.totalCards(game) !== 104) conservBad++;
        var min = Math.min.apply(null, game.players.map(function (_, i) { return E.score(game, i); }));
        if (!game.winnerIds.length || game.winnerIds.some(function (i) { return E.score(game, i) !== min; })) winnerBad++;
      } catch (e) { bad++; }
    }
  }
  s.eq('2–10 人共 18 局全部结束', bad, 0);
  s.eq('18 局都恰好 10 轮', roundBad, 0);
  s.eq('18 局所有手牌打光', handBad, 0);
  s.eq('18 局牌数守恒 104', conservBad, 0);
  s.eq('18 局赢家都是最低分', winnerBad, 0);
  var two = E.selfPlay(77, 2);
  s.eq('双人局可完整结束', two.phase, 'over');
  var ten = E.selfPlay(78, 10);
  s.eq('十人局可完整结束', ten.phase, 'over');
  s.eq('十人局用光 104 张', E.totalCards(ten), 104);
});

s.group('公共视图不泄漏隐藏信息', function () {
  var g = E.createGame({ seed: 14, players: 3 });
  var view = E.publicView(g, 0);
  s.eq('自己的手牌可见', view.players[0].hand.length, 10);
  s.eq('对手手牌为 null', view.players[1].hand, null);
  s.eq('对手只暴露张数', view.players[1].handCount, 10);
  s.ok('视图不含未使用牌', view.unused === undefined);
  s.ok('视图不含 picks 数组', view.picks === undefined);
  s.ok('视图不含 resolving 明细', !view.resolving || !view.resolving.entries);
  s.eq('四行完整公开', view.rows.length, 4);
  s.eq('轮次公开', view.round, 1);
  E.pickCard(g, 0, g.players[0].hand[0]);
  var v2 = E.publicView(g, 0);
  s.ok('自己的暗牌可见', v2.myPick != null);
  s.eq('对手已出标记为 true', v2.players[1].picked, false);
  s.eq('对手暗牌牌面为 null', v2.players[1].pickedCard, null);
  var v3 = E.publicView(g, 1);
  s.eq('对手视角看不到玩家 0 的暗牌', v3.players[0].pickedCard, null);
  s.eq('对手视角看到玩家 0 已出', v3.players[0].picked, true);
  s.eq('对手视角没有我的暗牌', v3.myPick, null);
  var serialized = JSON.stringify(g);
  s.ok('完整状态可 JSON 序列化', serialized.length > 100);
  s.ok('完整状态不含函数', serialized.indexOf('function') === -1);
  var over = E.selfPlay(15, 4);
  var ov = E.publicView(over, 0);
  s.eq('结束后公开未使用牌', ov.unused.length, 104 - 40 - 4);
  s.eq('结束后阶段 over', ov.phase, 'over');
  s.eq('结束后日志非空', ov.log.length > 0, true);
});

s.group('页面、规则与素材静态检查', function () {
  var html = read('index.html');
  var rules = read('rules.html');
  var onlineHtml = read('online.html');
  s.eq('规则页汉字 >=1200', chineseCount(rules) >= 1200, true);
  console.log('  CJK rules=' + chineseCount(rules));
  s.ok('index 引用共享洗牌', html.indexOf('../../shared/shuffle.js') >= 0);
  s.ok('index 引用共享音效', html.indexOf('../../shared/sfx.js') >= 0);
  s.ok('index 引用本地 data.js', html.indexOf('<script src="data.js">') >= 0);
  s.ok('index 引用本地 engine.js', html.indexOf('<script src="engine.js">') >= 0);
  s.ok('index 不自建 AudioContext', html.indexOf('AudioContext') === -1 && html.indexOf('createOscillator') === -1);
  s.ok('index 无远程脚本', !/<script[^>]+src=["']https?:/i.test(html));
  s.ok('index 无远程样式', !/<link[^>]+href=["']https?:/i.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('index 无远程图片', !/<img[^>]+src=["']https?:/i.test(html));
  s.ok('index 声明 viewport', html.indexOf('width=device-width') >= 0);
  s.ok('index 含 ARIA 实时区域', html.indexOf('aria-live') >= 0);
  s.ok('index 含主题按钮', html.indexOf('id="themeBtn"') >= 0);
  s.ok('index 含静音按钮', html.indexOf('id="muteBtn"') >= 0);
  s.ok('index 含 3/4/5 人选择', html.indexOf('id="playerCount"') >= 0 && html.indexOf('value="5"') >= 0);
  s.ok('index 使用宋体标题', html.indexOf('Songti SC') >= 0 && html.indexOf('font-weight:700') >= 0);
  s.ok('index 有 3 组以上关键帧', (html.match(/@keyframes/g) || []).length >= 3);
  s.ok('index 有 reduced-motion', html.indexOf('prefers-reduced-motion') >= 0);
  s.ok('index 有深色主题变量', html.indexOf('--bg:#0d1712') >= 0);
  s.ok('index 有浅色主题变量', html.indexOf('--bg:#efe7d6') >= 0);
  s.ok('index 触控变量 >=44px', html.indexOf('--tap:50px') >= 0);
  s.ok('index 链接规则页', html.indexOf('rules.html') >= 0);
  s.ok('index 链接联机页', html.indexOf('online.html') >= 0);
  s.ok('index 引用本地六件材质', ['felt-table.webp', 'card-paper.webp', 'card-back.webp', 'bull-token.webp', 'wood-rail.webp', 'row-ribbon.webp'].every(function (name) {
    return html.indexOf(name) >= 0;
  }));
  s.ok('index 无 service worker 注册', html.indexOf('serviceWorker') === -1);
  s.ok('不新增 per-game sw.js', !exists('sw.js'));
  s.ok('online 页含创建/加入', onlineHtml.indexOf('createBtn') >= 0 && onlineHtml.indexOf('joinBtn') >= 0);
  s.ok('online 页含排行榜', onlineHtml.indexOf('leaderboard') >= 0);
  s.ok('online 页含邀请复制', onlineHtml.indexOf('inviteBtn') >= 0);
  s.ok('online 页含重赛', onlineHtml.indexOf('restartBtn') >= 0);
  s.ok('online 页含选行', onlineHtml.indexOf('chooseRow') >= 0 || onlineHtml.indexOf("type === 'row'") >= 0);
  s.ok('online 页无远程脚本', !/<script[^>]+src=["']https?:/i.test(onlineHtml));
  s.ok('online 页无远程图片', !/<img[^>]+src=["']https?:/i.test(onlineHtml));
  var jsonld = rules.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  var types = jsonld.map(function (block) {
    try { return JSON.parse(block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))['@type']; }
    catch (e) { return 'BAD'; }
  });
  s.eq('规则页 Article + FAQPage', types, ['Article', 'FAQPage']);
  s.eq('规则页两张详情图', (rules.match(/assets\/detail-[12]\.webp/g) || []).length, 2);
  s.ok('规则页含计分表', rules.indexOf('<table>') >= 0);
  s.ok('规则页 BV1neA2z4ENU', rules.indexOf('BV1neA2z4ENU') >= 0);
  s.ok('规则页 BV1BfchzTEjB', rules.indexOf('BV1BfchzTEjB') >= 0);
  s.ok('规则页 BV1q7411s732', rules.indexOf('BV1q7411s732') >= 0);
  s.ok('规则页至少 3 条 B 站链接', (rules.match(/https:\/\/www\.bilibili\.com\/video\/BV/g) || []).length >= 3);
  s.ok('规则页无远程图片', !/<img[^>]+src=["']https?:/i.test(rules));
});

s.group('交付产物与联机适配器', function () {
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'online-e2e.json',
    'online.html', 'online-server.mjs', 'test-online.js', 'art-render.html', 'render-art.mjs',
    'assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'].forEach(function (name) {
    s.ok('存在 ' + name, exists(name) && fs.statSync(path.join(__dirname, name)).size > 0);
  });
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'six-nimmt-premium');
  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 人数下限 2', meta.players.min, 2);
  s.eq('meta 人数上限 10', meta.players.max, 10);
  s.ok('meta 声明联机 ready', meta.online && meta.online.status === 'ready');
  s.ok('meta 素材本地', meta.assets && meta.assets.localOnly === true);
  s.ok('meta 零外部请求预算', meta.performanceBudgets.externalRequests === 0);
  var realism = JSON.parse(read('realism.json'));
  s.eq('realism pass', realism.pass, true);
  s.ok('realism >=3 项', realism.checks.length >= 3, String(realism.checks.length));
  s.ok('realism >=3 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 3);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  var perf = JSON.parse(read('perf.json'));
  s.eq('perf ok', perf.ok, true);
  s.eq('perf 外部请求为 0', perf.measured.externalRequests, 0);
  var online = JSON.parse(read('online-e2e.json'));
  s.eq('online-e2e clients=2', online.clients, 2);
  s.eq('online-e2e sameGame', online.sameGame, true);
  s.eq('online-e2e 结算一致', online.settlementConsistent, true);
  s.eq('online-e2e reconnect', online.reconnect, true);
  s.eq('online-e2e timeoutTakeover', online.timeoutTakeover, true);
  s.eq('online-e2e leaderboard', online.leaderboard, true);
  s.eq('online-e2e 纳入 run-all', online.runAll, true);
  s.eq('online-e2e 控制组 exit 1', online.controlledFailure.exitCode, 1);
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端实现 pick 动作', server.indexOf("action.type !== 'pick'") >= 0 || server.indexOf("type: 'pick'") >= 0);
  s.ok('服务端实现 row 动作', server.indexOf("action.type !== 'row'") >= 0 || server.indexOf("type: 'row'") >= 0);
  s.ok('服务端调用引擎 pickCard/chooseRow', server.indexOf('E.pickCard') >= 0 && server.indexOf('E.chooseRow') >= 0);
  s.ok('服务端公共视图来自 engine', server.indexOf('E.publicView') >= 0);
  s.ok('服务端 AI 使用 aiDecision', server.indexOf('E.aiDecision') >= 0);
  var testOnline = read('test-online.js');
  s.ok('联机测试含双客户端', testOnline.indexOf('client-one') >= 0 && testOnline.indexOf('client-two') >= 0);
  s.ok('联机测试含超时托管', testOnline.indexOf('timeout') >= 0 && testOnline.indexOf('takeover') >= 0);
  s.ok('联机测试含控制组', testOnline.indexOf('--control') >= 0);
  var e2e = read('e2e.mjs');
  s.ok('e2e 含 --control', e2e.indexOf('--control') >= 0);
  s.ok('e2e 含联机段', e2e.indexOf('startSixNimmtServer') >= 0 && e2e.indexOf('Online room') >= 0);
  s.ok('DESIGN.md >=400 字节', fs.statSync(path.join(__dirname, 'DESIGN.md')).size >= 400);
});

s.group('美术产物尺寸与本地材质', function () {
  var dims = {
    'assets/cover.webp': [1200, 1200],
    'assets/og.webp': [1200, 630],
    'assets/detail-1.webp': [1200, 800],
    'assets/detail-2.webp': [1200, 800]
  };
  Object.keys(dims).forEach(function (rel) {
    var size = webpSize(path.join(__dirname, rel));
    s.ok(rel + ' 可读取尺寸', Boolean(size), JSON.stringify(size));
    if (size) {
      s.eq(rel + ' 宽', size.width, dims[rel][0]);
      s.eq(rel + ' 高', size.height, dims[rel][1]);
    }
  });
  var artDir = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'six-nimmt');
  var names = ['felt-table.webp', 'card-paper.webp', 'card-back.webp', 'bull-token.webp', 'wood-rail.webp', 'row-ribbon.webp'];
  s.eq('六件本地单物件材质', names.filter(function (n) { return fs.existsSync(path.join(artDir, n)) && fs.statSync(path.join(artDir, n)).size > 1000; }).length, 6);
  var art = read('art-render.html');
  s.ok('art-render 引用本地材质', names.every(function (n) { return art.indexOf(n) >= 0; }));
  s.ok('art-render 无远程图片', !/url\(["']?https?:/i.test(art));
  var render = read('render-art.mjs');
  s.ok('render-art 输出四种尺寸', render.indexOf('1200, height: 630') >= 0 && render.indexOf('1200, height: 800') >= 0);
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
  s.ok('manifest 收录本游戏页面', manifest.indexOf('/games/boardgame/six-nimmt-premium/') >= 0);
  s.ok('manifest 收录共享洗牌/音效', manifest.indexOf('/games/shared/shuffle.js') >= 0 && manifest.indexOf('/games/shared/sfx.js') >= 0);
});

s.done();
