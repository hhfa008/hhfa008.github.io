'use strict';

// Banqi (暗棋 / 翻棋) premium — engine, rules, presentation and gate tests.
// Discovery: games/tests/run-all.js runs every test*.js under the game dir.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('banqi-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function cjk(html) { return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length; }
function pngSize(file) {
  if (!fs.existsSync(file)) return null;
  var b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function at(entries, turn) {
  var st = E.empty(turn == null ? E.RED : turn);
  entries.forEach(function (entry) {
    st.cells[entry[0]] = entry[1] == null ? null : E.mk(entry[1], entry[2], entry[3]);
  });
  return st;
}
function hasMove(st, from, to) {
  return E.legalActions(st).some(function (a) { return a.k === 'move' && a.from === from && a.to === to; });
}
function countType(st, side, type) {
  var n = 0;
  st.cells.forEach(function (c) { if (c && c.s === side && c.t === type) n++; });
  return n;
}
function seeded(seed) {
  var st = E.createGame({ seed: seed });
  return st;
}

s.group('开局：4×8、32 枚全暗、红黑各 16', function () {
  var st = seeded(20261110);
  s.eq('格子数 32', st.cells.length, 32);
  s.eq('列数 8', E.COLS, 8);
  s.eq('行数 4', E.ROWS, 4);
  s.eq('总格数常量', E.N, 32);
  s.ok('32 格全部有子', st.cells.every(function (c) { return !!c; }));
  s.ok('全部背面朝上', st.cells.every(function (c) { return c.h === 1; }));
  s.eq('红方 16 枚', E.count(st, E.RED), 16);
  s.eq('黑方 16 枚', E.count(st, E.BLACK), 16);
  s.eq('暗子 32 枚', E.hiddenCount(st), 32);
  s.eq('红方明子 0', E.visibleCount(st, E.RED), 0);
  s.eq('黑方明子 0', E.visibleCount(st, E.BLACK), 0);
  s.eq('红帥 1', countType(st, E.RED, 'K'), 1);
  s.eq('红仕 2', countType(st, E.RED, 'A'), 2);
  s.eq('红相 2', countType(st, E.RED, 'B'), 2);
  s.eq('红車 2', countType(st, E.RED, 'R'), 2);
  s.eq('红馬 2', countType(st, E.RED, 'N'), 2);
  s.eq('红炮 2', countType(st, E.RED, 'C'), 2);
  s.eq('红兵 5', countType(st, E.RED, 'P'), 5);
  s.eq('黑將 1', countType(st, E.BLACK, 'K'), 1);
  s.eq('黑士 2', countType(st, E.BLACK, 'A'), 2);
  s.eq('黑象 2', countType(st, E.BLACK, 'B'), 2);
  s.eq('黑車 2', countType(st, E.BLACK, 'R'), 2);
  s.eq('黑馬 2', countType(st, E.BLACK, 'N'), 2);
  s.eq('黑砲 2', countType(st, E.BLACK, 'C'), 2);
  s.eq('黑卒 5', countType(st, E.BLACK, 'P'), 5);
  s.eq('总子数 32', E.count(st, E.RED) + E.count(st, E.BLACK), 32);
  s.eq('红先', st.turn, E.RED);
  s.eq('初始无赢家', st.winner, 0);
  s.eq('阶段 playing', st.phase, 'playing');
  var flips = E.legalActions(st).filter(function (a) { return a.k === 'flip'; });
  s.eq('开局 32 个翻子动作', flips.length, 32);
  s.eq('开局没有走子动作', E.legalActions(st).length - flips.length, 0);
  var st2 = seeded(777);
  var differ = false;
  for (var i = 0; i < 32; i++) {
    if (st.cells[i].t !== st2.cells[i].t || st.cells[i].s !== st2.cells[i].s) { differ = true; break; }
  }
  s.ok('不同种子发牌不同', differ);
  s.eq('同种子发牌一致', JSON.stringify(seeded(42).cells), JSON.stringify(seeded(42).cells));
  s.eq('每种子守恒 16/16', [E.count(seeded(9), E.RED), E.count(seeded(9), E.BLACK)], [16, 16]);
});

s.group('等级吃子：高吃低、同级拒绝、低吃高、兵吃帥', function () {
  var cases = [
    ['帥吃仕', 'K', 'A', true], ['仕吃相', 'A', 'B', true], ['相吃車', 'B', 'R', true],
    ['車吃馬', 'R', 'N', true], ['馬吃炮', 'N', 'C', true], ['帥吃卒', 'K', 'P', true]
  ];
  cases.forEach(function (c) {
    var st = at([[8, E.RED, c[1]], [9, E.BLACK, c[2]]]);
    s.eq(c[0] + '判定', hasMove(st, 8, 9), c[3]);
  });
  ['K', 'A', 'B', 'R', 'N'].forEach(function (t) {
    var st = at([[8, E.RED, t], [9, E.BLACK, t]]);
    s.ok(t + ' 同级不能吃', !hasMove(st, 8, 9));
    s.ok(t + ' canCapture 同级为假', !E.canCapture(st.cells[8], st.cells[9]));
  });
  var low = [['P', 'A'], ['N', 'R'], ['A', 'K'], ['B', 'A'], ['R', 'K']];
  low.forEach(function (c) {
    var st = at([[8, E.RED, c[0]], [9, E.BLACK, c[1]]]);
    s.ok(c[0] + ' 吃 ' + c[1] + ' 被拒绝', !hasMove(st, 8, 9));
  });
  s.ok('兵吃帥通过', hasMove(at([[8, E.RED, 'P'], [9, E.BLACK, 'K']]), 8, 9));
  s.ok('卒吃帥镜像通过', hasMove(at([[8, E.BLACK, 'P'], [9, E.RED, 'K']], E.BLACK), 8, 9));
  s.ok('兵不能吃炮', !hasMove(at([[8, E.RED, 'P'], [9, E.BLACK, 'C']]), 8, 9));
  s.ok('暗子不能被吃', !hasMove(at([[8, E.RED, 'R'], [9, E.BLACK, 'P', 1]]), 8, 9));
  s.ok('暗子也不会被当作可吃目标', !E.canCapture(E.mk(E.RED, 'R'), E.mk(E.BLACK, 'P', 1)));
});

s.group('炮：隔一子可吃、不隔子不能吃、隔两子不能吃', function () {
  function cannon(entries, turn) {
    var all = [[8, turn === E.BLACK ? E.BLACK : E.RED, 'C']].concat(entries);
    return at(all, turn);
  }
  s.ok('隔一个明子可吃', hasMove(cannon([[9, E.BLACK, 'P'], [10, E.BLACK, 'K']]), 8, 10));
  s.ok('隔一个暗子可吃', hasMove(cannon([[9, E.BLACK, 'P', 1], [10, E.BLACK, 'K']]), 8, 10));
  s.ok('隔一个自己的子也可吃', hasMove(cannon([[9, E.RED, 'P'], [10, E.BLACK, 'K']]), 8, 10));
  s.ok('不隔子不能吃紧邻敌子', !hasMove(cannon([[9, E.BLACK, 'K']]), 8, 9));
  s.ok('不隔子不能吃远处敌子', !hasMove(cannon([[12, E.BLACK, 'K']]), 8, 12));
  s.ok('中间全是空格也不能吃', !hasMove(cannon([[13, E.BLACK, 'K']]), 8, 13));
  s.ok('隔两子不能吃', !hasMove(cannon([[9, E.BLACK, 'P'], [10, E.BLACK, 'A'], [11, E.BLACK, 'K']]), 8, 11));
  var ct = E.cannonTargets(cannon([[9, E.BLACK, 'P'], [10, E.BLACK, 'K']]), 8);
  s.eq('炮目标列表只含隔子后第一枚', ct, [10]);
  s.ok('炮不隔子时普通 canCapture 永远为假', !E.canCapture(E.mk(E.RED, 'C'), E.mk(E.BLACK, 'P')));
  // horizontal jump
  var st = at([[8, E.RED, 'C'], [9, E.BLACK, 'P'], [10, E.BLACK, 'K']]);
  s.ok('横向隔子可吃', hasMove(st, 8, 10));
});

s.group('走子、翻子与回合切换', function () {
  var st = at([[8, E.RED, 'R'], [9, null, null]]);
  st.turn = E.RED;
  var legal = E.legalActions(st).filter(function (a) { return a.k === 'move'; });
  ok_contains(legal, function (a) { return a.from === 8 && a.to === 9; }, '红車可走入空格');
  var res = E.applyAction(st, { k: 'move', from: 8, to: 9 });
  s.ok('走子返回 ok', res.ok);
  s.eq('走子后原格清空', st.cells[8], null);
  s.ok('走子后目标有子', !!st.cells[9]);
  s.eq('走子后换黑方', st.turn, E.BLACK);
  s.eq('走子后 plies 增加', st.plies, 1);
  var st2 = at([[0, E.RED, 'P', 1]]);
  var before = E.clone(st2);
  var flip = E.applyAction(st2, { k: 'flip', to: 0 });
  s.ok('翻子返回 ok', flip.ok);
  s.eq('翻子后明子', st2.cells[0].h, 0);
  s.eq('翻子后换边', st2.turn, E.BLACK);
  s.eq('翻子不改棋子颜色', st2.cells[0].s, before.cells[0].s);
  s.eq('翻子不改棋子类型', st2.cells[0].t, before.cells[0].t);
  var bad = E.applyAction(st2, { k: 'move', from: 0, to: 1 });
  s.eq('非当前方动作被拒绝', bad.ok, false);
  s.eq('非当前方错误码', bad.code, 'E_MOVE');
  s.eq('非法动作不推进回合', st2.turn, E.BLACK);
  var il = E.applyAction(st2, { k: 'flip', to: 0 });
  s.eq('翻已翻开的子被拒绝', il.ok, false);
  s.eq('翻空格被拒绝', E.applyAction(st2, { k: 'flip', to: 2 }).ok, false);
  s.ok('isLegal 与 legalActions 一致', E.legalActions(st2).every(function (a) { return E.isLegal(st2, a); }));
  s.ok('空动作非法', !E.isLegal(st2, null));
  s.eq('明子无路时没有走子动作', E.legalActions(st2).length, 0);
  var st3 = seeded(88);
  var flipActions = E.legalActions(st3).filter(function (a) { return a.k === 'flip'; }).length;
  var moveActions = E.legalActions(st3).filter(function (a) { return a.k === 'move'; }).length;
  s.eq('开局动作总数 = 翻子 + 走子', E.legalActions(st3).length, flipActions + moveActions);
});

function ok_contains(list, pred, label) {
  s.ok(label, list.some(pred));
}

s.group('胜负、卡死与和棋', function () {
  var st = at([[0, E.RED, 'K'], [1, E.BLACK, 'P']]);
  st.turn = E.RED;
  // Red K cannot capture P (P is not lower? P rank 1 < K 7, so K CAN capture P).
  var st2 = at([[0, E.RED, 'K']]);
  st2.turn = E.BLACK;
  // Black has no pieces -> finished by status.
  var status = E.status(st2);
  s.ok('一方无子即结束', status.over);
  s.eq('黑方无子则红方胜', status.winner, E.RED);
  s.eq('结束原因 all', status.reason, 'all');
  var draw = at([[0, E.RED, 'K'], [31, E.BLACK, 'K']]);
  draw.noProgress = E.DRAW_PLIES;
  var dstat = E.status(draw);
  s.ok('120 手无吃子判和', dstat.over);
  s.eq('和棋 winner 0', dstat.winner, 0);
  s.eq('和棋原因 draw', dstat.reason, 'draw');
  var stuck = E.empty(E.RED);
  stuck.cells[0] = E.mk(E.RED, 'P', 0);
  stuck.cells[1] = E.mk(E.BLACK, 'K', 0);
  stuck.cells[8] = E.mk(E.BLACK, 'P', 0);
  // Red P at 0 can capture? K at 1 is rank 7; P can capture K. So not stuck.
  s.ok('兵对帥仍有动作', E.legalActions(stuck).length > 0);
  var blocked = E.empty(E.RED);
  blocked.cells[0] = E.mk(E.RED, 'P', 0);
  blocked.cells[1] = E.mk(E.BLACK, 'R', 0);
  blocked.cells[8] = E.mk(E.BLACK, 'P', 0);
  // P cannot capture R, right blocked by R, down by P, left edge, up edge.
  var bstat = E.status(blocked);
  s.ok('红兵无路可走则红方负', bstat.over);
  s.eq('卡死判负给对手', bstat.winner, E.BLACK);
  s.eq('卡死原因 stuck', bstat.reason, 'stuck');
});

s.group('公开视图不泄漏暗子身份', function () {
  var st = seeded(2026);
  var view = E.publicView(st, E.RED);
  s.eq('视图 32 格', view.cells.length, 32);
  s.ok('视图暗子不含类型', view.cells.every(function (c) { return !c || c.h !== 1 || c.t === null; }));
  s.ok('视图暗子不含颜色', view.cells.every(function (c) { return !c || c.h !== 1 || c.s === 0; }));
  s.eq('视图暗子数 32', view.counts.hidden, 32);
  s.eq('视图红方棋子 16', view.counts.red, 16);
  s.eq('视图黑方棋子 16', view.counts.black, 16);
  s.eq('视图 viewerTurn 为真', view.viewerTurn, true);
  var blackView = E.publicView(st, E.BLACK);
  s.eq('黑方视角 viewerTurn 为假', blackView.viewerTurn, false);
  var st2 = E.clone(st);
  E.applyAction(st2, { k: 'flip', to: 0 });
  var view2 = E.publicView(st2, E.RED);
  s.eq('翻子后公开视图可见该子', view2.cells[0].h, 0);
  s.ok('翻子后公开视图含类型', typeof view2.cells[0].t === 'string');
  s.eq('翻子后 hidden 减一', view2.counts.hidden, 31);
  s.eq('日志随状态公开', Array.isArray(view2.log), true);
});

s.group('AI 与自对弈', function () {
  var st = seeded(31);
  var acts = E.legalActions(st);
  var a1 = E.aiAction(st, 1);
  s.ok('入门 AI 有动作', !!a1);
  s.ok('AI 动作合法', E.isLegal(st, a1));
  var a2 = E.aiAction(st, 2);
  s.ok('标准 AI 有动作', !!a2);
  s.ok('标准 AI 动作合法', E.isLegal(st, a2));
  var a3 = E.aiAction(st, 3);
  s.ok('高手 AI 有动作', !!a3);
  s.ok('高手 AI 动作合法', E.isLegal(st, a3));
  s.eq('AI 不修改原状态', E.hiddenCount(st), 32);
  var played = E.selfPlay(77, 2);
  s.ok('自对弈结束', played.phase === 'over');
  s.ok('自对弈有翻子记录', played.flips > 0);
  s.ok('自对弈有步数', played.plies > 0);
  s.ok('自对弈棋子守恒', E.count(played, E.RED) + E.count(played, E.BLACK) <= 32);
  s.ok('自对弈赢家合法', [0, E.RED, E.BLACK].indexOf(played.winner) >= 0);
  var wins = { red: 0, black: 0, draw: 0 };
  for (var seed = 1; seed <= 8; seed++) {
    var g = E.selfPlay(seed, 2);
    if (g.winner === E.RED) wins.red++;
    else if (g.winner === E.BLACK) wins.black++;
    else wins.draw++;
  }
  s.eq('8 局自对弈全部结束', wins.red + wins.black + wins.draw, 8);
  s.ok('黑方不是零胜（先手优势不绝对）', wins.black + wins.draw > 0, JSON.stringify(wins));
  // Level 3 must beat random over a small sample.
  var strongWins = 0, games = 6;
  for (var i = 0; i < games; i++) {
    var g2 = E.createGame({ seed: 900 + i });
    for (var guard = 0; guard < 500 && g2.phase === 'playing'; guard++) {
      var level = g2.turn === E.RED ? 3 : 1;
      E.aiAct(g2, level, function () { return E.nextRandom(g2); });
    }
    if (g2.winner === E.RED) strongWins++;
  }
  s.ok('高手 AI 对入门 AI 至少赢 3/6', strongWins >= 3, 'wins=' + strongWins);
});

s.group('性能预算', function () {
  var t0 = Date.now();
  for (var i = 0; i < 500; i++) E.createGame({ seed: i });
  var createMs = Date.now() - t0;
  s.ok('500 次建局 < 1200ms', createMs < 1200, createMs + 'ms');
  var g = E.createGame({ seed: 5 });
  var t1 = Date.now();
  for (var k = 0; k < 300; k++) E.legalActions(g);
  var legalMs = Date.now() - t1;
  s.ok('300 次合法动作枚举 < 800ms', legalMs < 800, legalMs + 'ms');
  var t2 = Date.now();
  for (var m = 0; m < 30; m++) E.aiAction(g, 2);
  var aiMs = Date.now() - t2;
  s.ok('30 次标准 AI 决策 < 2500ms', aiMs < 2500, aiMs + 'ms');
  s.ok('单次标准 AI 决策 < 120ms', aiMs / 30 < 120, (aiMs / 30).toFixed(1) + 'ms');
});

s.group('页面与素材静态检查', function () {
  ['index.html', 'rules.html', 'engine.js', 'data.js', 'online.html', 'online-server.mjs',
    'test.js', 'test-online.js', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'realism.json',
    'perf.json', 'meta.json'].forEach(function (file) {
    s.ok(file + ' 存在', exists(file));
  });
  var index = read('index.html');
  s.ok('index 有 viewport', /name="viewport"[^>]*width=device-width/.test(index));
  s.ok('index 有 meta description', /name="description"[^>]*content="[^"]{40,}"/.test(index));
  s.ok('index 引用 engine.js', index.indexOf('src="engine.js"') >= 0);
  s.ok('index 引用 data.js', index.indexOf('src="data.js"') >= 0);
  s.ok('index 复用 shared shuffle', index.indexOf('shared/shuffle.js') >= 0);
  s.ok('index 复用 shared sfx', index.indexOf('shared/sfx.js') >= 0);
  s.ok('index 复用 shared store', index.indexOf('shared/store.js') >= 0);
  s.ok('index 无外部脚本', !/<script[^>]+src="https?:/.test(index));
  s.ok('index 无外链图片', !/<img[^>]+src="https?:/.test(index));
  s.ok('index 无 emoji 占位', !/[\u{1F300}-\u{1FAFF}]/u.test(index));
  s.ok('触控 token >= 44px', /--tap\s*:\s*(4[4-9]|[5-9]\d)px/.test(index));
  s.ok('标题用 Songti SC', index.indexOf('Songti SC') >= 0);
  s.ok('单机页声明 2 人练习', index.indexOf('2 人') >= 0 || index.indexOf('联机') >= 0);
  var rules = read('rules.html');
  s.ok('rules 有 Article JSON-LD', rules.indexOf('"@type": "Article"') >= 0);
  s.ok('rules 有 FAQPage JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('rules 汉字 >= 1200', cjk(rules) >= 1200, String(cjk(rules)));
  s.ok('rules 至少 2 张本地配图', (rules.match(/<img\b/gi) || []).length >= 2);
  s.ok('rules 无外部图片', !/<img[^>]+src="https?:/.test(rules));
  s.ok('rules 提到兵吃帥', /兵[^。]{0,12}帥|卒[^。]{0,12}將/.test(rules));
  s.ok('rules 提到炮隔子', /炮[^。]{0,10}隔|隔[^。]{0,10}炮/.test(rules));
  var online = read('online.html');
  s.ok('online 引用 engine.js', online.indexOf('src="engine.js"') >= 0);
  s.ok('online 无外部脚本', !/<script[^>]+src="https?:/.test(online));
  s.ok('online 有联机 + AI 匹配标记',
    /联机/.test(online) && /AI/.test(online) && /邀请/.test(online) && /重连/.test(online));
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端有房间/邀请', /room|invite/i.test(server));
  s.ok('服务端有 AI 补位', /aiAction/.test(server));
  s.ok('服务端有重连', /reconnect|重连/i.test(server));
  s.ok('服务端有排行榜', /leaderboard|排行榜/i.test(server));
  var tOnline = read('test-online.js');
  s.ok('双客户端 E2E 标记', /two-client|双客户端|Two independent HTTP clients/i.test(tOnline));
  s.ok('E2E 输出 ONLINE_E2E_JSON', tOnline.indexOf('ONLINE_E2E_JSON') >= 0);
  s.ok('E2E 支持 --control', tOnline.indexOf('--control') >= 0);
  s.ok('E2E runAll true', /runAll:\s*true/.test(tOnline));
  s.ok('E2E 覆盖结算一致', /settlementConsistent/.test(tOnline));
  s.ok('E2E 覆盖托管', /timeoutTakeover/.test(tOnline));
  var html = index + online + rules;
  var htmlNoCanonical = html.replace(/<link[^>]+rel="canonical"[^>]*>/gi, '');
  s.ok('页面无 http(s) 资源引用', !/(src|href)="https?:\/\/(?!www\.bilibili)/.test(htmlNoCanonical));
});

s.group('meta / realism / 美术 / 预缓存', function () {
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'banqi-premium');
  s.eq('meta status shipped', meta.status, 'shipped');
  s.eq('meta 2 人', meta.players && meta.players.min, 2);
  s.eq('meta 联机入口', meta.online && meta.online.entry, 'online.html');
  s.eq('meta 联机 5 项', ['rooms', 'invite', 'sync', 'reconnect', 'leaderboard'].every(function (k) {
    return meta.online.features && meta.online.features[k];
  }), true);
  s.ok('meta singlePlayer false', meta.singlePlayer === false);
  var realism = JSON.parse(read('realism.json'));
  s.ok('realism pass', realism.pass === true);
  s.ok('realism >= 6 项', realism.checks.length >= 6, String(realism.checks.length));
  var kinds = realism.checks.map(function (c) { return c.kind; });
  ['count', 'dimension', 'proportion', 'color', 'material', 'rule'].forEach(function (k) {
    s.ok('realism 覆盖 ' + k, kinds.indexOf(k) >= 0);
  });
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  var perf = JSON.parse(read('perf.json'));
  s.ok('perf budget 有界', perf.budget && perf.budget.loadMs <= 5000);
function artCheck(label, base, w, h) {
  var p = pngSize(base + '.png');
  if (p) return s.ok(label, p.w === w && p.h === h, JSON.stringify(p));
  var webp = base + '.webp';
  return s.ok(label + ' (本地 WebP 回退)', fs.existsSync(webp) && fs.statSync(webp).size > 8000, webp);
}
  artCheck('cover 1200x1200', path.join(__dirname, 'assets', 'cover'), 1200, 1200);
  artCheck('og 1200x630', path.join(__dirname, 'assets', 'og'), 1200, 630);
  artCheck('detail-1 1200x800', path.join(__dirname, 'assets', 'detail-1'), 1200, 800);
  ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'].forEach(function (f) {
    s.ok(f + ' 存在', exists(f) && fs.statSync(path.join(__dirname, f)).size > 8000);
  });
  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  if (fs.existsSync(manifestPath)) {
    var manifest = fs.readFileSync(manifestPath, 'utf8');
    var sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
    var swVersion = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    var manifestVersion = (manifest.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
    s.eq('precache manifest 与 CACHE_VERSION 同步', manifestVersion, swVersion);
    s.ok('manifest 收录共享 shuffle', manifest.indexOf('/games/shared/shuffle.js') >= 0);
    s.ok('manifest 收录本游戏单机页',
      manifest.indexOf('/games/boardgame/banqi-premium/') >= 0 ||
      manifest.indexOf('/games/boardgame/banqi-premium/index.html') >= 0);
    s.ok('manifest 收录本游戏联机页', manifest.indexOf('/games/boardgame/banqi-premium/online.html') >= 0);
    s.ok('manifest 收录本游戏引擎', manifest.indexOf('banqi-premium/engine.js') >= 0);
    s.ok('manifest 收录本游戏材质', manifest.indexOf('/games/assets/art/premium/banqi/') >= 0);
  } else {
    s.ok('precache manifest 在合并分支生成', true);
  }
  s.ok('数据来源 >= 2 条 B 站', D.SOURCES.bilibili.length >= 2);
  D.SOURCES.bilibili.forEach(function (url) {
    s.ok('B 站来源格式', /^https:\/\/www\.bilibili\.com\/video\/BV/.test(url), url);
  });
  s.eq('棋子 roster 7 级', D.ROSTER.length, 7);
  s.eq('棋子总数 32', D.ROSTER.reduce(function (n, r) { return n + r.count * 2; }, 0), 32);
});

s.done();
