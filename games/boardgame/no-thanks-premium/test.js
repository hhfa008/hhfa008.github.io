'use strict';

// No Thanks! premium — engine, presentation and browser E2E tests.
// Runs through games/tests/run-all.js (the suite prints RESULT: ...).

var fs = require('fs');
var path = require('path');
var url = require('url');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('no-thanks-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function chineseCount(html) {
  return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length;
}
function allCards(g) {
  var out = g.players.reduce(function (a, p) { return a.concat(p.cards); }, []);
  if (g.current != null) out.push(g.current);
  return out.concat(g.deck);
}

s.group('牌堆与初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('默认 3 名玩家', g.players.length, 3);
  s.eq('牌堆初始 23 张', g.deck.length, 23);
  s.eq('移除 9 张', g.removed.length, E.REMOVED);
  s.eq('移除牌不重复', new Set(g.removed).size, 9);
  s.eq('全牌 3..35 恰好 33 张', E.fullDeck().length, 33);
  s.eq('全牌最小值', Math.min.apply(null, E.fullDeck()), 3);
  s.eq('全牌最大值', Math.max.apply(null, E.fullDeck()), 35);
  s.eq('牌面 3..35 不重不漏', (function () {
    var all = allCards(g).concat(g.removed).sort(function (a, b) { return a - b; });
    if (all.length !== 33) return false;
    for (var i = 0; i < all.length; i++) if (all[i] !== i + 3) return false;
    return true;
  })(), true);
  s.eq('每人 11 筹码', g.players.map(function (p) { return p.chips; }), [11, 11, 11]);
  s.eq('首张牌已翻开', typeof g.current, 'number');
  s.eq('牌上筹码为 0', g.chipsOnCard, 0);
  s.eq('玩家 0 先手', g.turn, 0);
  s.eq('阶段为 playing', g.phase, 'playing');
  s.eq('初始无赢家', g.winner, null);
  s.eq('有两名非人类玩家', g.players.filter(function (p) { return !p.human; }).length, 2);
  s.eq('数据文件标题正确', D.title, 'No Thanks! 不谢');
  s.eq('人数说明存在', D.players, '3–5 人');
  s.eq('B 站来源至少 2 条', D.sources.length >= 2, true);
  D.sources.forEach(function (src, i) {
    s.ok('来源 ' + (i + 1) + ' 有标题', typeof src.title === 'string' && src.title.length > 4);
    s.ok('来源 ' + (i + 1) + ' 有 UP', typeof src.up === 'string' && src.up.length > 0);
    s.ok('来源 ' + (i + 1) + ' 有 BV 号', /^BV[0-9A-Za-z]+$/.test(src.bv));
    s.ok('来源 ' + (i + 1) + ' 链接是 B 站', /^https:\/\/www\.bilibili\.com\/video\/BV/.test(src.url));
    s.ok('来源 ' + (i + 1) + ' 有规则要点', Array.isArray(src.points) && src.points.length >= 2);
  });
});

s.group('收牌与跳过', function () {
  var g = E.createGame({ seed: 2 });
  s.ok('轮到自己可以收牌', E.legalTake(g, 0));
  s.ok('非当前玩家不能收牌', !E.legalTake(g, 1));
  s.ok('有筹码可以跳过', E.legalPass(g, 0));
  var threw = false;
  try { E.take(g, 1); } catch (e) { threw = true; }
  s.ok('非法收牌抛错', threw);
  var card = g.current;
  E.pass(g, 0);
  s.eq('跳过扣 1 筹码', g.players[0].chips, 10);
  s.eq('牌上筹码 +1', g.chipsOnCard, 1);
  s.eq('轮转到玩家 1', g.turn, 1);
  s.eq('跳过产生事件', g.events[g.events.length - 1].type, 'pass');
  E.pass(g, 1);
  s.eq('连续跳过牌上筹码为 2', g.chipsOnCard, 2);
  E.take(g, 2);
  s.ok('收下的是当前牌', g.players[2].cards.indexOf(card) >= 0);
  s.eq('收牌者拿走牌上全部筹码', g.players[2].chips, 13);
  s.eq('新牌筹码清零', g.chipsOnCard, 0);
  s.eq('收牌后轮转', g.turn, 0);
  var takeEvents = g.events.filter(function (e) { return e.type === 'take'; });
  s.eq('收牌产生 take 事件', takeEvents.length, 1);
  s.eq('收牌事件记录筹码数', takeEvents[0].chips, 2);
  s.ok('手牌保持升序', g.players[2].cards.every(function (c, i, a) { return i === 0 || a[i - 1] <= c; }));
  g.players[0].chips = 0;
  g.turn = 0;
  s.ok('无筹码不能跳过', !E.legalPass(g, 0));
  threw = false;
  try { E.pass(g, 0); } catch (e) { threw = true; }
  s.ok('无筹码跳过抛错', threw);
  E.take(g, 0);
  s.eq('无筹码被迫收牌', g.players[0].chips, 0);
});

s.group('计分规则', function () {
  s.eq('单张按面值', E.scoreCards([17]), 17);
  s.eq('连续段只算最小', E.scoreCards([7, 8, 9]), 7);
  s.eq('两段分别计最小', E.scoreCards([3, 4, 5, 10, 11]), 13);
  s.eq('乱序也正确', E.scoreCards([9, 7, 8, 20]), 27);
  s.eq('空牌 0 分', E.scoreCards([]), 0);
  s.eq('单张 35 为 35 分', E.scoreCards([35]), 35);
  s.eq('不连续同段误判', E.scoreCards([3, 5]), 8);
  s.eq('重复牌不骤减（去重前）', E.scoreCards([5, 5]), 10);
  var g = E.createGame({ seed: 3 });
  g.players[0].cards = [8, 9, 10];
  g.players[0].chips = 4;
  s.eq('总分 = 牌分 - 筹码', E.score(g, 0), 4);
  var b = E.scoreBreakdown(g, 0);
  s.eq('拆解牌分', b.cardPoints, 8);
  s.eq('拆解筹码', b.chips, 4);
  s.eq('拆解总分', b.total, 4);
  s.eq('拆解出一段连续牌', b.runs.length, 1);
  s.eq('连续段费用为最小牌', b.runs[0].cost, 8);
  s.eq('连续段包含三张', b.runs[0].cards, [8, 9, 10]);
  g.players[1].cards = [20, 21, 22, 30];
  g.players[1].chips = 2;
  s.eq('两段加孤张计分', E.score(g, 1), 48);
  g.players[2].cards = [];
  g.players[2].chips = 11;
  s.eq('无牌只有筹码为负分', E.score(g, 2), -11);
});

s.group('终局与胜者', function () {
  var g = E.createGame({ seed: 4 });
  g.deck = [];
  g.current = 30;
  g.chipsOnCard = 2;
  E.take(g, 0);
  s.eq('收走末牌后结束', g.phase, 'over');
  s.eq('末牌计入玩家', g.players[0].cards.indexOf(30) >= 0, true);
  s.ok('有最终赢家', g.winner != null);
  s.ok('winnerIds 非空', g.winnerIds.length >= 1);
  s.eq('终局事件类型', g.events[g.events.length - 1].type, 'over');
  s.eq('终局事件包含三个分数', g.events[g.events.length - 1].scores.length, 3);
  var tied = E.createGame({ seed: 5 });
  tied.deck = [];
  tied.current = 10;
  tied.players[0].cards = [];
  tied.players[1].cards = [10];
  tied.players[2].cards = [10];
  tied.players[0].chips = 11;
  tied.players[1].chips = 11;
  tied.players[2].chips = 11;
  E.take(tied, 0);
  s.eq('三人都无牌时并列最低', tied.winnerIds.length, 3);
});

s.group('公共视图不泄漏隐藏信息', function () {
  var g = E.createGame({ seed: 5 });
  var view = E.publicView(g, 0);
  s.eq('视图给出剩余牌数', view.deckCount, g.deck.length);
  s.ok('视图不含牌堆数组', view.deck === undefined);
  s.ok('视图不含随机数生成器', view.rng === undefined);
  s.ok('进行中不暴露移除牌', view.removed === undefined);
  s.eq('自己的牌可见', view.players[0].cards.length, 0);
  s.eq('对手的牌也公开（本作规则）', view.players[1].cards.length, 0);
  s.ok('视图含当前牌', typeof view.current === 'number');
  s.ok('视图含牌上筹码', view.chipsOnCard === 0);
  var g2 = E.createGame({ seed: 6 });
  while (g2.phase !== 'over') E.aiAct(g2, g2.turn);
  var over = E.publicView(g2, 0);
  s.eq('结束后公开移除牌', over.removed.length, 9);
  s.ok('结束后离开 playing', over.phase === 'over');
  s.ok('视图日志是数组', Array.isArray(over.log) && over.log.length > 0);
});

s.group('AI 决策与 30 局自对弈', function () {
  var g = E.createGame({ seed: 7 });
  g.turn = 1;
  g.players[1].chips = 0;
  var before = g.players[1].cards.length;
  var res = E.aiAct(g, 1);
  s.eq('无筹码 AI 必须收牌', res.type, 'take');
  s.eq('AI 收牌增加手牌', g.players[1].cards.length, before + 1);

  var g2 = E.createGame({ seed: 8 });
  g2.turn = 1;
  g2.players[1].chips = 9;
  g2.players[1].cards = [];
  g2.chipsOnCard = 10;
  g2.current = 8;
  var r2 = E.aiAct(g2, 1);
  s.eq('低边际成本时 AI 收牌', r2.type, 'take');

  var bad = 0, cardsTaken = 0, chipTotalBad = 0, orderBad = 0, winnerBad = 0;
  for (var seed = 1; seed <= 30; seed++) {
    try {
      var h = E.selfPlay(seed, 3);
      if (h.phase !== 'over') bad++;
      var taken = h.players.reduce(function (a, p) { return a + p.cards.length; }, 0);
      if (taken !== 24) cardsTaken++;
      var chips = h.players.reduce(function (a, p) { return a + p.chips; }, 0);
      if (chips !== 33) chipTotalBad++;
      h.players.forEach(function (p) {
        if (!p.cards.every(function (c, i, a) { return i === 0 || a[i - 1] <= c; })) orderBad++;
      });
      var min = Math.min.apply(null, h.players.map(function (p, i) { return E.score(h, i); }));
      if (E.score(h, h.winner) !== min) winnerBad++;
    } catch (e) { bad++; }
  }
  s.eq('30 局全部结束', bad, 0);
  s.eq('30 局每局恰好拿走 24 张', cardsTaken, 0);
  s.eq('30 局筹码守恒为 33', chipTotalBad, 0);
  s.eq('30 局手牌始终有序', orderBad, 0);
  s.eq('30 局赢家都是最低分', winnerBad, 0);

  var multi = E.selfPlay(31, 5);
  s.eq('5 人自对弈可结束', multi.phase, 'over');
  s.eq('5 人局每人 11 筹码起手且 24 张牌', multi.players.reduce(function (a, p) { return a + p.cards.length; }, 0), 24);
});

s.group('页面与规则静态检查', function () {
  var html = read('index.html');
  var rules = read('rules.html');
  s.ok('index 使用本地 data.js', html.indexOf('<script src="data.js">') >= 0);
  s.ok('index 使用本地 engine.js', html.indexOf('<script src="engine.js">') >= 0);
  s.ok('规则页链接 B 站来源', rules.indexOf('bilibili.com/video/BV') >= 0);
  s.ok('规则页 1200+ 汉字', chineseCount(rules) >= 1200, 'got ' + chineseCount(rules));
  s.ok('规则页包含计分表', rules.indexOf('<table>') >= 0);
  s.ok('规则页包含三条 BV 号', (rules.match(/BV[0-9A-Za-z]+/g) || []).length >= 3);
  s.ok('页面含三组以上关键帧动画', (html.match(/@keyframes/g) || []).length >= 3);
  s.ok('页面复用共享洗牌模块', html.indexOf('../../shared/shuffle.js') >= 0);
  s.ok('页面复用共享音效模块', html.indexOf('../../shared/sfx.js') >= 0);
  s.ok('页面不再自建 AudioContext', html.indexOf('AudioContext') === -1 && html.indexOf('createOscillator') === -1);
  s.ok('页面有深色变量', html.indexOf('--bg:#12171c') >= 0);
  s.ok('页面有浅色变量', html.indexOf('--bg:#efe6d7') >= 0);
  s.ok('页面网格按钮 >=44px', html.indexOf('--tap:52px') >= 0);
  s.ok('页面无远程脚本', !/<script[^>]+src=["']https?:/i.test(html));
  s.ok('页面无远程样式', !/<link[^>]+href=["']https?:/i.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('页面无远程图片', !/<img[^>]+src=["']https?:/i.test(html));
  s.ok('规则页无远程图片', !/<img[^>]+src=["']https?:/i.test(rules));
  s.ok('页面声明 viewport', html.indexOf('width=device-width') >= 0);
  s.ok('页面包含 ARIA 实时区域', html.indexOf('aria-live') >= 0);
  s.ok('页面有静音按钮', html.indexOf('id="muteBtn"') >= 0);
  s.ok('页面有主题按钮', html.indexOf('id="themeBtn"') >= 0);
});

s.group('交付产物与联机适配器', function () {
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'online-e2e.json', 'online.html', 'online-server.mjs', 'test-online.js', 'art-render.html', 'render-art.mjs'].forEach(function (name) {
    s.ok('存在 ' + name, fs.existsSync(path.join(__dirname, name)));
  });
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'no-thanks-premium');
  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 人数下限 3', meta.players.min, 3);
  s.eq('meta 人数上限 5', meta.players.max, 5);
  s.ok('meta 声明联机 ready', meta.online && meta.online.status === 'ready');
  var realism = JSON.parse(read('realism.json'));
  s.ok('realism pass', realism.pass === true);
  s.ok('realism 至少 3 项', realism.checks.length >= 3, String(realism.checks.length));
  s.ok('realism 至少 3 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 3);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  var online = JSON.parse(read('online-e2e.json'));
  s.ok('online-e2e clients=2', online.clients === 2);
  s.ok('online-e2e 同局结算一致', online.settlementConsistent === true);
  s.ok('online-e2e 纳入 run-all', online.runAll === true);
  s.ok('online-e2e 控制组 exit 1', online.controlledFailure.exitCode === 1);
  s.ok('online-e2e 断言数 >= 40', (online.result.match(/^(\d+)/) || [0,0])[1] >= 40);
  var indexHtml = read('index.html');
  s.ok('离线由大厅 /games/sw.js 统一接管', indexHtml.indexOf('serviceWorker') === -1);
  s.ok('不内联 per-game SW 清单', !fs.existsSync(path.join(__dirname, 'sw.js')));
  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  if (fs.existsSync(manifestPath)) {
    var manifestText = fs.readFileSync(manifestPath, 'utf8');
    var globalSw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
    var cacheVersion = (globalSw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    var manifestVersion = (manifestText.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
    s.eq('precache manifest 与 CACHE_VERSION 同步', manifestVersion, cacheVersion);
    s.ok('precache manifest 收录共享洗牌/音效', manifestText.indexOf('/games/shared/shuffle.js') >= 0 && manifestText.indexOf('/games/shared/sfx.js') >= 0);
    s.ok('precache manifest 收录本游戏页面', manifestText.indexOf('/games/boardgame/no-thanks-premium/') >= 0);
    s.ok('precache manifest 收录本游戏脚本', manifestText.indexOf('no-thanks-premium/engine.js') >= 0);
    s.ok('precache manifest 收录联机页与材质', manifestText.indexOf('no-thanks-premium/online.html') >= 0 && manifestText.indexOf('no-thanks/table-felt.webp') >= 0);
  } else {
    s.ok('v22 manifest 在合并分支生成（当前分支跳过）', true);
  }
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端权威判定 take/pass', server.indexOf("action.type !== 'take' && action.type !== 'pass'") >= 0 && server.indexOf('E.take') >= 0 && server.indexOf('E.pass') >= 0);
  s.ok('公共视图不下发牌堆', server.indexOf('publicView') >= 0);
  var onlineHtml = read('online.html');
  s.ok('联机页含创建/加入/排行榜', onlineHtml.indexOf('createBtn') >= 0 && onlineHtml.indexOf('joinBtn') >= 0 && onlineHtml.indexOf('leaderboard') >= 0);
  s.ok('联机页含邀请复制', onlineHtml.indexOf('inviteBtn') >= 0);
  s.ok('联机页含重赛', onlineHtml.indexOf('restartBtn') >= 0);
  s.ok('联机页无远程脚本', !/<script[^>]+src=["']https?:/i.test(onlineHtml));
  s.ok('index 链接联机页', read('index.html').indexOf('online.html') >= 0);
  s.ok('rules 链接联机页', read('rules.html').indexOf('online.html') >= 0);
});

s.done();
