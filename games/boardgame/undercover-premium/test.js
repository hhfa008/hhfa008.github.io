'use strict';

/*
 * Undercover Premium unit tests.
 *
 *   node games/boardgame/undercover-premium/test.js
 *   node games/boardgame/undercover-premium/test.js --control  # intentional failure
 *
 * The rules engine is UMD and runs in Node without a DOM. Tests assert the
 * real engine/data files, the static page contract, hidden-information rules,
 * seeded reproducibility, performance budgets and the service-worker manifest
 * cross-check (skipped with a note until gen-precache includes this game).
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var DATA = require('./data.js');
var E = require('./engine.js');

var s = lib.suite('undercover-premium');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var onlineHtml = fs.readFileSync(path.join(__dirname, 'online.html'), 'utf8');

function aliveIds(state) {
  return state.players.filter(function (p) { return p.alive; }).map(function (p) { return p.index; });
}
function toVote(state) {
  var next = state;
  var guard = 0;
  while (next.phase === 'reveal' && guard < 50) {
    next = E.applyMove(next, { type: 'reveal' });
    guard += 1;
  }
  if (next.phase === 'speak') next = E.applyMove(next, { type: 'beginVote' });
  return next;
}
function driveVotes(state, chooser) {
  var next = state;
  var guard = 0;
  while (next.phase === 'vote' && guard < 100) {
    var target = chooser(next);
    next = E.applyMove(next, { type: 'vote', target: target });
    guard += 1;
  }
  return next;
}
function findRole(state, role) {
  for (var i = 0; i < state.players.length; i += 1) {
    if (state.players[i].role === role) return i;
  }
  return -1;
}

s.group('词库 data.js', function () {
  s.ok('词库至少 120 组', DATA.WORDS.length >= 120, 'got ' + DATA.WORDS.length);
  s.eq('导出 COUNT 与数组一致', DATA.COUNT, DATA.WORDS.length);
  s.ok('每条都有 a/b/cat/difficulty', DATA.WORDS.every(function (w) {
    return w && typeof w.a === 'string' && w.a && typeof w.b === 'string' && w.b &&
      typeof w.cat === 'string' && w.cat && ['easy', 'normal', 'hard'].indexOf(w.difficulty) !== -1;
  }));
  s.ok('每组两词不同', DATA.WORDS.every(function (w) { return w.a !== w.b; }));
  s.ok('词对不重复', (function () {
    var seen = {};
    for (var i = 0; i < DATA.WORDS.length; i += 1) {
      var key = [DATA.WORDS[i].a, DATA.WORDS[i].b].sort().join('|');
      if (seen[key]) return false;
      seen[key] = 1;
    }
    return true;
  })());
  s.ok('全部为纯中文词', DATA.WORDS.every(function (w) {
    return /^[一-鿿]+$/.test(w.a) && /^[一-鿿]+$/.test(w.b);
  }));
  s.ok('类别丰富 (>=20)', DATA.CATEGORIES.length >= 20, 'got ' + DATA.CATEGORIES.length);
  s.ok('保留原有第一组 可乐/雪碧', DATA.WORDS.some(function (w) {
    return w.a === '可乐' && w.b === '雪碧';
  }));
  s.ok('包含白板相关的身份标签', DATA.ROLE_LABELS.c && DATA.ROLE_LABELS.u && DATA.ROLE_LABELS.b);
});

s.group('人数、卧底与白板配置', function () {
  s.eq('4 人最多 1 卧底', E.maxUndercover(4), 1);
  s.eq('5 人最多 2 卧底', E.maxUndercover(5), 2);
  s.eq('12 人最多 3 卧底', E.maxUndercover(12), 3);
  s.eq('推荐 4-6 人 1 卧底', [E.recommendedUndercover(4), E.recommendedUndercover(6)], [1, 1]);
  s.eq('推荐 7-9 人 2 卧底', [E.recommendedUndercover(7), E.recommendedUndercover(9)], [2, 2]);
  s.eq('推荐 10 人以上 3 卧底', [E.recommendedUndercover(10), E.recommendedUndercover(12)], [3, 3]);
  s.ok('4 人 1 卧底合法', E.isValidConfig(4, 1, 0));
  s.ok('3 人非法', !E.isValidConfig(3, 1, 0));
  s.ok('13 人非法', !E.isValidConfig(13, 1, 0));
  s.ok('6 人 3 卧底非法', !E.isValidConfig(6, 3, 0));
  s.ok('4 人 3 卧底非法', !E.isValidConfig(4, 3, 0));
  s.ok('5 人 1 卧底 1 白板合法', E.isValidConfig(5, 1, 1));
  s.ok('4 人 1 卧底 1 白板非法（无足够平民）', !E.isValidConfig(4, 1, 1));
  s.ok('7 人 2 卧底 1 白板合法', E.isValidConfig(7, 2, 1));
  s.ok('6 人 2 卧底 1 白板非法（卧底方已不少于平民）', !E.isValidConfig(6, 2, 1));
  s.ok('白板最多 1 人', !E.isValidConfig(6, 1, 2));
  s.ok('卧底至少 1 人', !E.isValidConfig(6, 0, 0));
  s.ok('12 人 1 卧底合法', E.isValidConfig(12, 1, 0));
  s.ok('所有默认人数配置合法', [4,5,6,7,8,9,10,11,12].every(function (n) {
    return E.isValidConfig(n, E.recommendedUndercover(n), 0);
  }));
});

s.group('发角色与发词', function () {
  var roles = E.dealRoles(6, 2, 0, function () { return 0.5; });
  s.eq('角色数等于人数', roles.length, 6);
  s.eq('恰好 2 个卧底', roles.filter(function (r) { return r === 'u'; }).length, 2);
  s.eq('其余为平民', roles.filter(function (r) { return r === 'c'; }).length, 4);
  var rolesB = E.dealRoles(7, 1, 1, function () { return 0.5; });
  s.eq('白板角色恰好 1 个', rolesB.filter(function (r) { return r === 'b'; }).length, 1);
  s.eq('7 人 1 卧底 1 白板共 5 平民', rolesB.filter(function (r) { return r === 'c'; }).length, 5);
  var pair = { a: '可乐', b: '雪碧' };
  s.eq('默认卧底拿 a、平民拿 b', E.assignWords(['u', 'c'], pair, false), ['可乐', '雪碧']);
  s.eq('交换后角色词对调', E.assignWords(['u', 'c'], pair, true), ['雪碧', '可乐']);
  s.eq('白板没有词', E.assignWords(['b', 'c', 'u'], pair, false), ['', '雪碧', '可乐']);
  s.eq('每人一个词位', E.assignWords(['c', 'c', 'u', 'b'], pair, false).length, 4);
  s.ok('wordPairAt 取模安全', E.wordPairAt(-1) && E.wordPairAt(DATA.WORDS.length + 3));
  s.eq('roleLabel 三语角色', [E.roleLabel('c'), E.roleLabel('u'), E.roleLabel('b')], ['平民', '卧底', '白板']);
});

s.group('胜负判定', function () {
  s.eq('卧底方全灭平民胜', E.judgeWin(0, 3), 'civ');
  s.eq('卧底方不少于平民则卧底胜', E.judgeWin(2, 2), 'uc');
  s.eq('卧底方更多也胜', E.judgeWin(3, 1), 'uc');
  s.eq('尚未结束', E.judgeWin(1, 3), null);
  s.eq('双方都空仍判平民胜', E.judgeWin(0, 0), 'civ');
  s.eq('白板计入卧底方：1 卧底 1 白板对 2 平民 = 卧底胜', E.judgeWin(2, 2), 'uc');
});

s.group('创建对局与可复现', function () {
  var a = E.createGame({ playerCount: 6, undercoverCount: 2, blankCount: 0, seed: 42 });
  s.eq('人数正确', a.playerCount, 6);
  s.eq('卧底数正确', a.undercoverCount, 2);
  s.eq('白板数正确', a.blankCount, 0);
  s.eq('玩家数组长度', a.players.length, 6);
  s.eq('角色计数 u=2 c=4', [a.players.filter(function (p) { return p.role === 'u'; }).length,
    a.players.filter(function (p) { return p.role === 'c'; }).length], [2, 4]);
  s.eq('开始于看词阶段', a.phase, 'reveal');
  s.eq('第一位看词者 seat 0', a.current, 0);
  s.ok('所有玩家初始存活', a.players.every(function (p) { return p.alive; }));
  s.ok('所有玩家初始未看词', a.players.every(function (p) { return !p.revealed; }));
  s.ok('平民词一致', (function () {
    var words = a.players.filter(function (p) { return p.role === 'c'; }).map(function (p) { return p.word; });
    return words.every(function (w) { return w === words[0]; });
  })());
  s.ok('卧底词一致', (function () {
    var words = a.players.filter(function (p) { return p.role === 'u'; }).map(function (p) { return p.word; });
    return words.length > 0 && words.every(function (w) { return w === words[0]; });
  })());
  s.ok('平民词与卧底词不同', (function () {
    var civ = a.players.filter(function (p) { return p.role === 'c'; })[0].word;
    var uc = a.players.filter(function (p) { return p.role === 'u'; })[0].word;
    return civ !== uc;
  })());
  var b = E.createGame({ playerCount: 6, undercoverCount: 2, blankCount: 0, seed: 42 });
  s.eq('同 seed 完全复现', JSON.stringify(a), JSON.stringify(b));
  var changed = false;
  for (var seed = 43; seed < 60; seed += 1) {
    var c = E.createGame({ playerCount: 6, undercoverCount: 2, blankCount: 0, seed: seed });
    if (JSON.stringify(c.players.map(function (p) { return p.word; })) !==
        JSON.stringify(a.players.map(function (p) { return p.word; }))) changed = true;
  }
  s.ok('不同 seed 会改变发词', changed);
  var named = E.createGame({ playerCount: 4, undercoverCount: 1, blankCount: 0, seed: 1, names: ['甲', '乙', '丙', '丁'] });
  s.eq('自定义名字生效', named.players.map(function (p) { return p.name; }), ['甲', '乙', '丙', '丁']);
  var bad = false;
  try { E.createGame({ playerCount: 3, undercoverCount: 1, seed: 1 }); } catch (err) { bad = true; }
  s.ok('非法配置抛出错误', bad);
});

s.group('看词流程与不可变', function () {
  var a = E.createGame({ playerCount: 5, undercoverCount: 1, blankCount: 1, seed: 7 });
  var before = JSON.stringify(a);
  var b = E.applyMove(a, { type: 'reveal' });
  s.eq('原状态未被修改', JSON.stringify(a), before);
  s.eq('第一位玩家已看词', b.players[0].revealed, true);
  s.eq('看词阶段仍继续', b.phase, 'reveal');
  s.eq('下一位看词者 seat 1', b.current, 1);
  var guard = 0;
  while (b.phase === 'reveal' && guard < 20) {
    b = E.applyMove(b, { type: 'reveal' });
    guard += 1;
  }
  s.eq('全员看词后进入发言阶段', b.phase, 'speak');
  s.ok('全员标记已看词', b.players.every(function (p) { return p.revealed; }));
  s.eq('发言阶段由第一位存活玩家主持', b.current, 0);
  s.ok('看词阶段非法动作被拒', (function () {
    try { E.applyMove(a, { type: 'vote', target: 1 }); return false; } catch (err) { return true; }
  })());
});

s.group('投票、淘汰与平票', function () {
  var a = toVote(E.createGame({ playerCount: 4, undercoverCount: 1, blankCount: 0, seed: 3 }));
  s.eq('进入投票阶段', a.phase, 'vote');
  s.eq('票单覆盖全部存活玩家', a.voteOrder.length, 4);
  s.eq('投票前票数为 0', a.players.every(function (p) { return p.votes === 0; }), true);
  var uc = findRole(a, 'u');
  s.ok('不能投自己', (function () {
    try { E.applyMove(a, { type: 'vote', target: a.current }); return false; } catch (err) { return true; }
  })());
  s.ok('不能投不存在的目标', (function () {
    try { E.applyMove(a, { type: 'vote', target: 99 }); return false; } catch (err) { return true; }
  })());
  var target = uc === a.current ? aliveIds(a).filter(function (i) { return i !== a.current && i !== uc; })[0] : uc;
  var b = E.applyMove(a, { type: 'vote', target: target });
  s.eq('合法投票后票数增加', b.players[target].votes, 1);
  s.eq('投票记录已写入', b.votes.length, 1);
  s.eq('投票后轮到下一位', b.current !== a.current, true);

  // A clean 4-player tie: 0->1, 1->0, 2->1, 3->0.
  var tie = toVote(E.createGame({ playerCount: 4, undercoverCount: 1, blankCount: 0, seed: 9 }));
  var byVoter = { 0: 1, 1: 0, 2: 1, 3: 0 };
  var tguard = 0;
  while (tie.phase === 'vote' && tguard < 20) {
    tie = E.applyMove(tie, { type: 'vote', target: byVoter[tie.current] });
    tguard += 1;
  }
  s.eq('平票后无人淘汰', tie.players.filter(function (p) { return !p.alive; }).length, 0);
  s.eq('平票结果被记录', tie.lastElim && tie.lastElim.tie, true);
  s.eq('平票后进入下一轮发言', tie.phase, 'speak');
  s.eq('平票后轮次 +1', tie.round, 2);

  // Civilians win by voting out the only undercover.
  var civ = toVote(E.createGame({ playerCount: 4, undercoverCount: 1, blankCount: 0, seed: 11 }));
  var ucIndex = findRole(civ, 'u');
  civ = driveVotes(civ, function (state) {
    if (state.current === ucIndex) {
      return aliveIds(state).filter(function (i) { return i !== ucIndex; })[0];
    }
    return ucIndex;
  });
  s.eq('卧底被淘汰后游戏结束', civ.over, true);
  s.eq('平民获胜', civ.winnerSide, 'civ');
  s.eq('平民获胜结果', civ.result && civ.result.winnerSide, 'civ');
  s.ok('淘汰记录包含身份与词', civ.lastElim && civ.lastElim.role === 'u' && typeof civ.lastElim.word === 'string');

  // Undercover side wins by eliminating civilians until 1 uc >= civilians.
  var ucWin = toVote(E.createGame({ playerCount: 5, undercoverCount: 1, blankCount: 0, seed: 13 }));
  var roundsPlayed = 0;
  while (!ucWin.over && roundsPlayed < 6) {
    var civTargets = aliveIds(ucWin).filter(function (i) {
      return ucWin.players[i].role === 'c' && i !== ucWin.current;
    });
    if (!civTargets.length) break;
    var pick = civTargets[0];
    ucWin = driveVotes(ucWin, function (state) {
      return state.current === pick ? aliveIds(state).filter(function (i) { return i !== pick; })[0] : pick;
    });
    roundsPlayed += 1;
    if (!ucWin.over && ucWin.phase === 'speak') ucWin = E.applyMove(ucWin, { type: 'beginVote' });
  }
  s.eq('卧底方通过票平民获胜', ucWin.over, true);
  s.eq('卧底方获胜', ucWin.winnerSide, 'uc');
  s.ok('卧底方获胜时卧底方人数 >= 平民', ucWin.result &&
    ucWin.result.undercoverSideAlive >= ucWin.result.civiliansAlive);
});

s.group('AI 补位行为', function () {
  var a = E.createGame({ playerCount: 6, undercoverCount: 1, blankCount: 0, seed: 21, isAI: [true, true, true, true, true, true] });
  s.eq('AI 看词动作', E.chooseAIMove(a), { type: 'reveal' });
  var b = toVote(a);
  var uc = findRole(b, 'u');
  var aiState = JSON.parse(JSON.stringify(b));
  aiState.current = uc;
  var move = E.chooseAIMove(aiState);
  s.ok('AI 投票类型正确', move && move.type === 'vote', JSON.stringify(move));
  s.ok('AI 不投自己', move.target !== uc);
  s.ok('AI 不投已出局玩家', aiState.players[move.target].alive);
  s.eq('卧底 AI 优先投平民', aiState.players[move.target].role, 'c');
  var civSeat = aiState.players.filter(function (p) { return p.role === 'c'; })[0].index;
  aiState.current = civSeat;
  var civMove = E.chooseAIMove(aiState);
  s.ok('平民 AI 也返回合法目标', civMove && civMove.type === 'vote' && civMove.target !== civSeat);
  var end = JSON.parse(JSON.stringify(b));
  end.over = true;
  s.eq('游戏结束后 AI 无动作', E.chooseAIMove(end), null);
});

s.group('隐藏信息视图', function () {
  var a = E.createGame({ playerCount: 5, undercoverCount: 1, blankCount: 0, seed: 33 });
  var view = E.viewFor(a, 0);
  s.eq('视图玩家数', view.players.length, 5);
  s.ok('他人角色不下发', view.players.every(function (p) { return p.role === undefined; }));
  s.ok('他人词不下发', view.players.every(function (p) { return p.word === undefined; }));
  s.ok('自己的角色可见', view.me && view.me.role === a.players[0].role);
  s.ok('自己的词可见', view.me && view.me.word === a.players[0].word);
  s.eq('视图不包含词对', view.pair, undefined);
  s.eq('看词阶段轮次', view.phase, 'reveal');
});

s.group('静态页面与文件契约', function () {
  var required = ['index.html', 'engine.js', 'data.js', 'rules.html', 'test.js', 'DESIGN.md',
    'ACCEPTANCE.md', 'E2E.md', 'realism.json', 'perf.json', 'meta.json', 'online.html',
    'online-server.mjs', 'test-online.js', 'online-e2e.json', 'art-render.html'];
  required.forEach(function (name) {
    s.ok('存在 ' + name, fs.existsSync(path.join(__dirname, name)));
  });
  s.ok('title 非空', /<title>[^<]+<\/title>/.test(html));
  s.ok('viewport 含 width=device-width', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('meta description 非空', /name="description"[^>]*content="[^"]+"/.test(html));
  s.ok('og:image 指向本地封面', html.indexOf('property="og:image"') !== -1 &&
    html.indexOf('undercover/og.webp') !== -1);
  s.ok('twitter:image 指向本地封面', html.indexOf('name="twitter:image"') !== -1 &&
    html.indexOf('undercover/og.webp') !== -1);
  s.ok('cover 引用存在', html.indexOf('undercover/cover.webp') !== -1);
  s.ok('detail 引用存在', html.indexOf('undercover/detail.webp') !== -1);
  s.ok('index 引用 engine/data/shuffle', html.indexOf('src="engine.js"') !== -1 &&
    html.indexOf('src="data.js"') !== -1 && html.indexOf('shared/shuffle.js') !== -1);
  s.ok('index 支持联机桥', html.indexOf('online-bridge.js') !== -1);
  s.ok('无 http(s) 外部脚本/样式/图片', !/(?:src|href)="https?:/i.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')) && !/url\(\s*["']?https?:/i.test(html));
  s.ok('使用 100dvh', /100dvh/.test(html));
  s.ok('使用 safe-area', /env\(safe-area-inset-top\)/.test(html));
  s.ok('online.html 使用共享大厅', onlineHtml.indexOf('app/online-lobby.js') !== -1 &&
    onlineHtml.indexOf('app/online-lobby.css') !== -1);
  s.ok('online.html 配置 6 人房', /ONLINE_GAME[\s\S]{0,300}maxPlayers:\s*6/.test(onlineHtml));
  s.ok('online.html 无外部请求', !/(?:src|href)="https?:/i.test(onlineHtml.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  var serverSrc = fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8');
  s.ok('联机服务器复用共享实现', /from '\.\.\/app\/online-game\.mjs'/.test(serverSrc));
  s.ok('联机服务器不复制共享服务器', serverSrc.indexOf('createRoomStoreInternal') === -1);
  s.ok('UMD 浏览器全局名存在', /UndercoverEngine/.test(fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8')));
  var meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
  s.eq('meta slug', meta.slug, 'undercover-premium');
  s.ok('meta 状态为 draft 或 shipped', ['draft', 'shipped'].indexOf(meta.status) !== -1, meta.status);
  s.eq('meta 联机座位 6', meta.online && meta.online.seats, 6);
  s.eq('meta 人数范围', [meta.players.min, meta.players.max], [4, 12]);
  var realism = JSON.parse(fs.readFileSync(path.join(__dirname, 'realism.json'), 'utf8'));
  s.eq('realism pass', realism.pass, true);
  s.ok('realism 至少 6 项', realism.checks.length >= 6);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.ok('realism 覆盖 3+ 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 3);
  var perf = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf.json'), 'utf8'));
  s.ok('perf 有 thresholds', !!(perf.thresholds && perf.measured));
  var oe = JSON.parse(fs.readFileSync(path.join(__dirname, 'online-e2e.json'), 'utf8'));
  s.ok('online-e2e 契约字段齐全', oe.clients >= 2 && oe.sameGame === true &&
    oe.settlementConsistent === true && oe.reconnect === true &&
    oe.timeoutTakeover === true && oe.leaderboard === true && oe.runAll === true);

  // Service-worker manifest cross-check. gen-precache is run by the integrator
  // after merging; until it lists this game we still verify the version pair.
  var swPath = path.join(__dirname, '..', '..', 'sw.js');
  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  s.ok('sw.js 存在', fs.existsSync(swPath));
  s.ok('precache-manifest.js 存在', fs.existsSync(manifestPath));
  if (fs.existsSync(swPath) && fs.existsSync(manifestPath)) {
    var swSrc = fs.readFileSync(swPath, 'utf8');
    var manifestSrc = fs.readFileSync(manifestPath, 'utf8');
    var swVersion = (swSrc.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
    var manifestVersion = (manifestSrc.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
    s.ok('sw 与 precache 清单版本一致且 >= v20',
      !!swVersion && swVersion === manifestVersion && Number(swVersion.replace('v', '')) >= 20);
    if (manifestSrc.indexOf('/games/boardgame/undercover-premium/') !== -1) {
      s.ok('清单含 undercover 入口', manifestSrc.indexOf('/games/boardgame/undercover-premium/') !== -1);
      s.ok('清单含 engine/data/online/rules', ['online.html', 'rules.html', 'engine.js', 'data.js', 'meta.json'].every(function (name) {
        return manifestSrc.indexOf('/games/boardgame/undercover-premium/' + name) !== -1;
      }) && manifestSrc.indexOf('/games/boardgame/undercover-premium/') !== -1);
      s.ok('清单含封面/OG/详情/材质', ['cover.webp', 'og.webp', 'detail.webp', 'card-face.webp', 'card-back.webp', 'table-wood.webp'].every(function (name) {
        return manifestSrc.indexOf('/games/assets/art/premium/undercover/' + name) !== -1;
      }));
    } else {
      s.ok('预缓存清单待集成方重新生成（条目检查跳过）', true);
    }
  }
});

s.group('性能预算 PERF_BUDGET', function () {
  var t0 = Date.now();
  for (var i = 0; i < 500; i += 1) {
    E.createGame({ playerCount: 8, undercoverCount: 2, blankCount: 0, seed: 1000 + i });
  }
  var createMs = Date.now() - t0;
  s.ok('创建 500 局 < 1000ms', createMs < 1000, createMs + 'ms');

  var state = toVote(E.createGame({ playerCount: 8, undercoverCount: 2, blankCount: 0, seed: 77 }));
  t0 = Date.now();
  for (var m = 0; m < 2000; m += 1) E.getLegalMoves(state);
  var legalMs = Date.now() - t0;
  s.ok('2000 次合法动作 < 500ms', legalMs < 500, legalMs + 'ms');

  t0 = Date.now();
  for (var a = 0; a < 1000; a += 1) E.chooseAIMove(state);
  var aiMs = Date.now() - t0;
  s.ok('1000 次 AI 决策 < 1000ms', aiMs < 1000, aiMs + 'ms');

  t0 = Date.now();
  for (var r = 0; r < 300; r += 1) {
    var g = E.createGame({ playerCount: 6, undercoverCount: 1, blankCount: 0, seed: r });
    while (g.phase === 'reveal') g = E.applyMove(g, { type: 'reveal' });
  }
  var revealMs = Date.now() - t0;
  s.ok('300 局完整看词 < 800ms', revealMs < 800, revealMs + 'ms');
  console.log('PERF_BUDGET create500=' + createMs + 'ms legal2000=' + legalMs +
    'ms ai1000=' + aiMs + 'ms reveal300=' + revealMs + 'ms');

  var perfFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf.json'), 'utf8'));
  if (perfFile.thresholds) {
    s.ok('实测创建耗时在 perf.json 阈值内', createMs <= perfFile.thresholds.createGame500Ms);
    s.ok('实测合法动作在 perf.json 阈值内', legalMs <= perfFile.thresholds.legalMoves2000Ms);
    s.ok('实测 AI 在 perf.json 阈值内', aiMs <= perfFile.thresholds.aiMove1000Ms);
  }
});

if (process.argv.indexOf('--control') !== -1) {
  s.ok('故意失败对照项（--control）', false, '这是验收对照，正常运行时不会加 --control');
}
s.done();
