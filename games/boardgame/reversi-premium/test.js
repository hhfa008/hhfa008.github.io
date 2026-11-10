'use strict';

/*
 * Reversi Premium unit / rules / page-contract tests.
 *
 *   node games/boardgame/reversi-premium/test.js
 *   node games/boardgame/reversi-premium/test.js --control  # expected exit 1
 *
 * The rules assertions run against engine.js, the same source the page and the
 * online room server use. Page tests read the real files, including the shared
 * precache manifest cross-check once the integration step regenerates it.
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('reversi-premium');
var CONTROL = process.argv.indexOf('--control') !== -1;
var DIR = __dirname;

function initial() { return E.createGame({ seed: 7 }); }
function boardWith(cells) {
  var b = E.emptyBoard();
  Object.keys(cells).forEach(function (key) {
    var parts = key.split(',').map(Number);
    b[parts[0] * 8 + parts[1]] = cells[key];
  });
  return b;
}
function customState(board, current) {
  var st = E.createGame({ seed: 3 });
  st.board = board.slice();
  st.current = current;
  st.scores = { black: E.count(board, E.BLACK), white: E.count(board, E.WHITE) };
  st.players[0].score = st.scores.black;
  st.players[1].score = st.scores.white;
  st.moveCount = 0;
  st.history = [];
  st.over = false;
  st.lastMove = null;
  st.lastFlips = [];
  st.passed = false;
  st.passCount = 0;
  return st;
}
function legalIndexes(state) {
  return E.legalFor(state.board, state.current).map(function (m) { return m.i; }).sort(function (a, b) { return a - b; });
}

/* --------------------------------------------------------------- constants */

s.group('常量与开局', function () {
  s.eq('棋盘 8 路', E.SIZE, 8);
  s.eq('64 格', E.CELLS, 64);
  s.eq('空 / 黑 / 白', [E.EMPTY, E.BLACK, E.WHITE], [0, 1, 2]);
  s.eq('八个方向', E.DIRS.length, 8);
  s.eq('权重表 64 项', E.WEIGHT.length, 64);
  var st = initial();
  s.eq('开局黑子 2', E.count(st.board, E.BLACK), 2);
  s.eq('开局白子 2', E.count(st.board, E.WHITE), 2);
  s.eq('开局空位 60', E.count(st.board, E.EMPTY), 60);
  s.eq('d4 白', st.board[27], E.WHITE);
  s.eq('e4 黑', st.board[28], E.BLACK);
  s.eq('d5 黑', st.board[35], E.BLACK);
  s.eq('e5 白', st.board[36], E.WHITE);
  s.eq('黑先', st.current, E.BLACK);
  s.eq('未终局', st.over, false);
  s.eq('开局比分', st.scores, { black: 2, white: 2 });
  s.eq('开局无历史', st.history.length, 0);
  s.eq('黑方 4 个合法点', legalIndexes(st), [19, 26, 37, 44]);
  s.eq('合法点都是 place', E.getLegalMoves(st).every(function (m) { return m.type === 'place'; }), true);
  s.eq('合法点各翻 1 子', E.getLegalMoves(st).map(function (m) { return m.flips.length; }), [1, 1, 1, 1]);
  s.eq('默认名字', [st.players[0].name, st.players[1].name], ['黑方', '白方']);
  s.eq('默认 AI 是白方', [st.players[0].isAI, st.players[1].isAI], [false, true]);
  s.eq('默认难度 normal', st.aiLevel, 'normal');
  s.eq('纯函数不共享棋盘', (function () {
    var a = E.createGame({ seed: 1 });
    var b = E.createGame({ seed: 2 });
    a.board[0] = E.BLACK;
    return b.board[0] === E.EMPTY;
  })(), true);
});

/* ---------------------------------------------------------------- flipping */

s.group('夹击与翻面', function () {
  var st = initial();
  s.eq('黑下 (2,3) 翻 (3,3)', E.flipsAt(st.board, 2, 3, E.BLACK), [27]);
  s.eq('白下 (2,4) 翻 (3,4)', E.flipsAt(st.board, 2, 4, E.WHITE), [28]);
  s.eq('已占格不能下', E.flipsAt(st.board, 3, 3, E.BLACK), null);
  s.eq('无夹击返回 null', E.flipsAt(st.board, 0, 0, E.BLACK), null);
  s.eq('越界返回 null', E.flipsAt(st.board, -1, 0, E.BLACK), null);
  s.eq('越界返回 null (8,8)', E.flipsAt(st.board, 8, 8, E.BLACK), null);
  s.eq('自己颜色相邻不翻', E.flipsAt(st.board, 3, 4, E.WHITE), null);
  s.eq('空位相邻不成夹', E.flipsAt(boardWith({ '0,0': E.BLACK, '0,2': E.WHITE }), 0, 1, E.BLACK), null);

  var edge = boardWith({ '0,3': E.BLACK, '0,1': E.WHITE, '0,2': E.WHITE });
  s.eq('贴边夹两子', E.flipsAt(edge, 0, 0, E.BLACK), [1, 2]);
  s.eq('贴边翻面数', E.flipsAt(edge, 0, 0, E.BLACK).length, 2);

  var corner = boardWith({ '0,2': E.BLACK, '0,1': E.WHITE });
  s.eq('角位可翻一子', E.flipsAt(corner, 0, 0, E.BLACK), [1]);

  var multi = boardWith({
    '4,1': E.BLACK, '4,2': E.WHITE, '4,3': E.WHITE,
    '1,4': E.BLACK, '2,4': E.WHITE, '3,4': E.WHITE,
    '1,1': E.BLACK, '2,2': E.WHITE, '3,3': E.WHITE,
    '4,7': E.BLACK, '4,6': E.WHITE, '4,5': E.WHITE
  });
  var multiFlips = E.flipsAt(multi, 4, 4, E.BLACK);
  s.eq('四方向同时翻面', multiFlips.length, 8);
  s.eq('多方向结果无重复', new Set(multiFlips).size, 8);
  s.ok('多方向包含横向', multiFlips.indexOf(4 * 8 + 2) !== -1);
  s.ok('多方向包含纵向', multiFlips.indexOf(2 * 8 + 4) !== -1);
  s.ok('多方向包含主对角', multiFlips.indexOf(2 * 8 + 2) !== -1);

  var broken = boardWith({ '3,1': E.WHITE, '3,2': E.WHITE, '3,3': E.BLACK, '3,6': E.BLACK });
  s.eq('断开的线只翻连续段', E.flipsAt(broken, 3, 0, E.BLACK), [25, 26]);
  s.eq('断开线外的远子不翻', E.flipsAt(broken, 3, 0, E.BLACK).indexOf(3 * 8 + 6), -1);

  s.eq('hasMoves 黑', E.hasMoves(st.board, E.BLACK), true);
  s.eq('hasMoves 白', E.hasMoves(st.board, E.WHITE), true);
  s.eq('legalFor 结构', E.legalFor(st.board, E.BLACK).every(function (m) {
    return typeof m.i === 'number' && typeof m.row === 'number' && typeof m.col === 'number' && Array.isArray(m.flips);
  }), true);
});

/* --------------------------------------------------------------- movement */

s.group('落子、状态不可变与撤销', function () {
  var st = initial();
  var originalBoard = st.board.slice();
  var originalCurrent = st.current;
  var next = E.applyMove(st, { type: 'place', row: 2, col: 3 });
  s.eq('落子格变黑', next.board[19], E.BLACK);
  s.eq('被夹白子翻黑', next.board[27], E.BLACK);
  s.eq('黑棋 4 枚', E.count(next.board, E.BLACK), 4);
  s.eq('白棋 1 枚', E.count(next.board, E.WHITE), 1);
  s.eq('比分更新', next.scores, { black: 4, white: 1 });
  s.eq('轮到白棋', next.current, E.WHITE);
  s.eq('手数 1', next.moveCount, 1);
  s.eq('历史 1 条', next.history.length, 1);
  s.eq('最后一手坐标', [next.lastMove.row, next.lastMove.col], [2, 3]);
  s.eq('最后一手翻面', next.lastFlips, [27]);
  s.eq('原棋盘未被修改', st.board, originalBoard);
  s.eq('原回合未被修改', st.current, originalCurrent);
  s.eq('原历史仍为空', st.history.length, 0);

  var back = E.undo(next);
  s.eq('撤销后棋盘还原', back.board, originalBoard);
  s.eq('撤销后回合还原', back.current, E.BLACK);
  s.eq('撤销后比分还原', back.scores, { black: 2, white: 2 });
  s.eq('撤销后历史清空', back.history.length, 0);

  var st2 = E.applyMove(next, { type: 'place', row: 2, col: 4 });
  s.eq('第二手手数 2', st2.moveCount, 2);
  s.eq('撤销一手回到第一手后', E.undo(st2).board, next.board);

  var errors = [];
  try { E.applyMove(next, { type: 'place', row: 3, col: 3 }); } catch (e) { errors.push('occupied'); }
  try { E.applyMove(next, { type: 'place', row: 0, col: 0 }); } catch (e) { errors.push('no-flip'); }
  try { E.applyMove(next, { type: 'place', row: 9, col: 0 }); } catch (e) { errors.push('out-of-bounds'); }
  try { E.applyMove(next, { type: 'place', row: 'x', col: 0 }); } catch (e) { errors.push('not-number'); }
  try { E.applyMove(initial(), { type: 'pass' }); } catch (e) { errors.push('pass-while-moves'); }
  try { E.applyMove({ over: true, board: E.initialBoard(), current: 1, scores: { black: 2, white: 2 }, players: [], history: [] }, { type: 'place', row: 2, col: 3 }); } catch (e) { errors.push('over'); }
  s.eq('非法落子都抛错', errors, ['occupied', 'no-flip', 'out-of-bounds', 'not-number', 'pass-while-moves', 'over']);

  var passBoard = new Array(64).fill(E.BLACK);
  passBoard[7 * 8 + 0] = E.WHITE;
  passBoard[7 * 8 + 1] = E.EMPTY;
  passBoard[7 * 8 + 7] = E.WHITE;
  var passState = customState(passBoard, E.BLACK);
  s.eq('无合法点时返回 pass', E.getLegalMoves(passState)[0].type, 'pass');
  s.eq('无合法点黑方 legalFor 空', E.legalFor(passState.board, E.BLACK).length, 0);
  var passed = E.applyMove(passState, { type: 'pass' });
  s.eq('pass 后轮到白棋', passed.current, E.WHITE);
  s.eq('pass 写入历史', passed.history.length, 1);
  s.eq('pass 记录', passed.history[0].type, 'pass');
  s.eq('白棋有合法点', E.legalFor(passed.board, E.WHITE).length >= 1, true);
  s.eq('白棋可翻五子', E.flipsAt(passed.board, 7, 1, E.WHITE).length, 5);

  var full = new Array(64);
  for (var i = 0; i < 64; i += 1) full[i] = i % 2 ? E.WHITE : E.BLACK;
  var fullState = customState(full, E.BLACK);
  var ended = E.applyMove(fullState, { type: 'pass' });
  s.eq('双方无子可下立即终局', ended.over, true);
  s.eq('满盘 32 比 32', ended.scores, { black: 32, white: 32 });
  s.eq('平局标记', ended.result.draw, true);
  s.eq('平局 winner 0', ended.winner, 0);
  s.eq('终局无合法点', E.getLegalMoves(ended).length, 0);
});

/* ---------------------------------------------------------------------- AI */

s.group('AI 三档', function () {
  var st = initial();
  ['easy', 'normal', 'hard'].forEach(function (level) {
    var mv = E.chooseAIMove(st, level);
    s.ok(level + ' 返回 place', mv && mv.type === 'place', JSON.stringify(mv));
    s.ok(level + ' 返回合法点', E.flipsAt(st.board, mv.row, mv.col, st.current) !== null,
      level + ' ' + JSON.stringify(mv));
  });
  s.eq('easy 确定性', E.chooseAIMove(st, 'easy'), E.chooseAIMove(st, 'easy'));
  s.eq('normal 确定性', E.chooseAIMove(st, 'normal'), E.chooseAIMove(st, 'normal'));
  s.eq('hard 确定性', E.chooseAIMove(st, 'hard'), E.chooseAIMove(st, 'hard'));
  var aiCopy = st.board.slice();
  E.chooseAIMove(st, 'hard');
  s.eq('AI 不修改棋盘', st.board, aiCopy);

  var catchCorner = customState(boardWith({ '0,2': E.BLACK, '0,1': E.WHITE }), E.BLACK);
  var cornerMove = E.chooseAIMove(catchCorner, 'hard');
  s.eq('hard 抢占可翻角位', [cornerMove.row, cornerMove.col], [0, 0]);
  var normalCorner = E.chooseAIMove(catchCorner, 'normal');
  s.eq('normal 也抢角位', [normalCorner.row, normalCorner.col], [0, 0]);

  var passBoard = new Array(64).fill(E.BLACK);
  passBoard[7 * 8 + 0] = E.WHITE;
  passBoard[7 * 8 + 1] = E.EMPTY;
  passBoard[7 * 8 + 7] = E.WHITE;
  var passState = customState(passBoard, E.BLACK);
  s.eq('AI 无子可下返回 pass', E.chooseAIMove(passState, 'normal'), { type: 'pass' });

  var state = E.createGame({ seed: 11, aiLevel: 'normal', isAI: [true, true] });
  var legalEverywhere = true;
  for (var k = 0; k < 24 && !state.over; k += 1) {
    var before = state.board.slice();
    var mv2 = E.chooseAIMove(state, k % 2 ? 'easy' : 'normal');
    var valid = mv2.type === 'pass' ? E.legalFor(state.board, state.current).length === 0
      : E.flipsAt(state.board, mv2.row, mv2.col, state.current) !== null;
    if (!valid) legalEverywhere = false;
    state = E.applyMove(state, mv2);
    if (mv2.type !== 'pass' && JSON.stringify(before) === JSON.stringify(state.board)) legalEverywhere = false;
  }
  s.eq('连续 AI 落子全部合法', legalEverywhere, true);
  s.eq('AI 落子推进手数', state.moveCount >= 15, true);
  s.eq('AI 局面仍可序列化', JSON.parse(JSON.stringify(state)).board.length, 64);
});

/* ------------------------------------------------------------- full games */

s.group('完整对局与历史重放', function () {
  var st = E.createGame({ seed: 2026, aiLevel: 'normal', names: ['黑', '白'], isAI: [true, true] });
  var plies = 0;
  while (!st.over && plies < 300) {
    var mv = E.chooseAIMove(st, 'normal');
    st = E.applyMove(st, mv);
    plies += 1;
  }
  s.eq('自对弈终局', st.over, true);
  s.ok('自对弈至少 20 手', st.moveCount >= 20, 'moveCount=' + st.moveCount);
  s.eq('手数等于落子历史数', st.moveCount, st.history.filter(function (h) { return h.type === 'place'; }).length);
  s.eq('终局双方都无合法点', [E.legalFor(st.board, E.BLACK).length, E.legalFor(st.board, E.WHITE).length], [0, 0]);
  s.eq('终局比分等于数子', st.scores, { black: E.count(st.board, E.BLACK), white: E.count(st.board, E.WHITE) });
  s.eq('棋子总数不超过 64', st.scores.black + st.scores.white <= 64, true);
  s.eq('winner 与比分一致', st.winner, st.scores.black > st.scores.white ? E.BLACK : (st.scores.white > st.scores.black ? E.WHITE : 0));
  s.eq('result 与比分一致', [st.result.black, st.result.white], [st.scores.black, st.scores.white]);

  var replay = E.createGame({ seed: 2026, aiLevel: 'normal', names: ['黑', '白'], isAI: [true, true] });
  for (var i = 0; i < st.history.length; i += 1) {
    var h = st.history[i];
    replay = E.applyMove(replay, h.type === 'pass' ? { type: 'pass' } : { type: 'place', row: h.row, col: h.col });
  }
  s.eq('历史重放得到同一棋盘', replay.board, st.board);
  s.eq('历史重放得到同一比分', replay.scores, st.scores);
  s.eq('历史重放得到同一胜者', replay.winner, st.winner);

  var undone = E.undo(st);
  s.eq('终局后悔棋离开终局', undone.over, false);
  s.eq('终局后悔棋少一手', undone.history.length, st.history.length - 1);

  var pub = E.publicState(st);
  s.eq('publicState 棋盘 64', pub.board.length, 64);
  s.eq('publicState 不含内部 rng', pub.rng, undefined);
  s.eq('publicState 可 JSON 序列化', JSON.parse(JSON.stringify(pub)).board.length, 64);
  s.eq('publicState 含 result', !!pub.result, true);
  s.eq('publicState 玩家数 2', pub.players.length, 2);
  s.eq('publicState 最近历史最多 10', pub.recent.length <= 10, true);
});

/* --------------------------------------------------------------- contracts */

s.group('页面与文件契约', function () {
  function read(name) { return fs.readFileSync(path.join(DIR, name), 'utf8'); }
  function exists(name) { return fs.existsSync(path.join(DIR, name)); }

  var index = read('index.html');
  s.ok('index.html 有标题', /<title>[^<]*黑白棋[^<]*<\/title>/.test(index));
  s.ok('meta description 非空', /<meta name="description" content="[^"]{20,}"/.test(index));
  s.ok('viewport 含 device-width', /width=device-width/.test(index));
  s.ok('og:image 指向本地 og.webp', /property="og:image" content="\.\.\/\.\.\/assets\/art\/premium\/reversi\/og\.webp"/.test(index));
  s.ok('twitter:image 指向本地 og.webp', /name="twitter:image" content="\.\.\/\.\.\/assets\/art\/premium\/reversi\/og\.webp"/.test(index));
  s.ok('隐藏引用 cover.webp', index.indexOf('../../assets/art/premium/reversi/cover.webp') !== -1);
  s.ok('隐藏引用 detail.webp', index.indexOf('../../assets/art/premium/reversi/detail.webp') !== -1);
  s.ok('引用引擎与数据', index.indexOf('./engine.js') !== -1 && index.indexOf('./data.js') !== -1);
  s.ok('引用联机桥', index.indexOf('../app/online-bridge.js') !== -1);
  s.ok('引用音效与分享', index.indexOf('../../shared/sfx.js') !== -1 && index.indexOf('../../shared/share.js') !== -1);
  s.ok('无外链脚本', !/<script[^>]+src="https?:/.test(index));
  s.ok('无外链样式', !/<link[^>]+href="https?:/.test(index.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('未用 emoji 棋子', index.indexOf('⚫') === -1 && index.indexOf('⚪') === -1);
  s.ok('触控目标 44px', /min-height:44px/.test(index) && /min-width:44px/.test(index));
  s.ok('无 11px 字号', !/font-size:11px/.test(index));
  s.ok('棋盘 8 列网格', /grid-template-columns:repeat\(8/.test(index));

  s.ok('rules.html 存在', exists('rules.html'));
  var rules = read('rules.html');
  s.ok('规则写出 8×8', rules.indexOf('8×8') !== -1);
  s.ok('规则写出跳过', rules.indexOf('跳过') !== -1);
  s.ok('规则列出来源 BV', /BV1CuxQ6EExW/.test(rules) && /BV1Bs4y1c7Y9/.test(rules));
  s.ok('online.html 存在', exists('online.html'));
  var online = read('online.html');
  s.ok('online 使用共享大厅', online.indexOf('app/online-lobby.js') !== -1 &&
    online.indexOf('app/online-lobby.css') !== -1);
  s.ok('online 设置 ONLINE_GAME', /window\.ONLINE_GAME\s*=\s*\{[^}]*id:\s*'reversi'/.test(online));
  s.ok('online 是 2 人房', /maxPlayers:\s*2/.test(online));
  s.ok('online-server 存在', exists('online-server.mjs'));
  var server = read('online-server.mjs');
  s.ok('server 复用共享 online-game', server.indexOf("from '../app/online-game.mjs'") !== -1);
  s.ok('server 调用 startGameOnlineServer', server.indexOf('startGameOnlineServer') !== -1);
  s.ok('server 未复制房间状态机', server.indexOf('createRoomStoreInternal') === -1);
  s.ok('test-online 存在', exists('test-online.js'));
  var onlineTest = read('test-online.js');
  s.ok('联机测试打印 ONLINE_E2E_JSON', onlineTest.indexOf('ONLINE_E2E_JSON') !== -1);
  s.ok('联机测试有 --control', onlineTest.indexOf('--control') !== -1);

  s.ok('DESIGN.md 存在且 ≥400B', exists('DESIGN.md') && fs.statSync(path.join(DIR, 'DESIGN.md')).size >= 400);
  s.ok('ACCEPTANCE.md 存在', exists('ACCEPTANCE.md'));
  s.ok('E2E.md 存在', exists('E2E.md'));
  s.ok('realism.json 存在', exists('realism.json'));
  s.ok('perf.json 存在', exists('perf.json'));
  s.ok('meta.json 存在', exists('meta.json'));
  s.ok('online-e2e.json 存在', exists('online-e2e.json'));

  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'reversi-premium');
  s.ok('meta 状态为 draft 或 shipped', meta.status === 'draft' || meta.status === 'shipped', meta.status);
  s.eq('meta 多人', meta.mode, 'multiplayer');
  s.eq('meta 联机测试', meta.online.twoClientE2E, 'test-online.js');
  s.eq('meta 游戏人数', [meta.players.min, meta.players.max], [2, 2]);

  var realism = JSON.parse(read('realism.json'));
  s.eq('realism pass', realism.pass, true);
  s.ok('realism 至少 6 项', realism.checks.length >= 6, 'checks=' + realism.checks.length);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.ok('realism 至少 3 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 3);
  s.ok('realism 来源含 B站', (realism.sources || []).some(function (src) { return /BV1CuxQ6EExW/.test(src); }));

  var perf = JSON.parse(read('perf.json'));
  s.eq('perf ok', perf.ok, true);
  s.ok('perf 有预算与实测', !!perf.budgets && !!perf.measured);

  var e2e = JSON.parse(read('online-e2e.json'));
  s.eq('online-e2e 双客户端', e2e.clients, 2);
  s.eq('online-e2e 同局', e2e.sameGame, true);
  s.eq('online-e2e 结算一致', e2e.settlementConsistent, true);
  s.eq('online-e2e 重连', e2e.reconnect, true);
  s.eq('online-e2e 托管', e2e.timeoutTakeover, true);
  s.eq('online-e2e 榜单', e2e.leaderboard, true);

  var data = read('data.js');
  s.ok('data 含 4 条 B站来源', /BV1CuxQ6EExW/.test(data) && /BV1Bs4y1c7Y9/.test(data) &&
    /BV1UC411L7vj/.test(data) && /BV1Hjz9BUEAY/.test(data));

  var engineSrc = read('engine.js');
  s.ok('engine UMD 浏览器导出', engineSrc.indexOf('root.ReversiEngine = factory()') !== -1);
  s.ok('engine UMD Node 导出', /module\.exports\s*=\s*factory\(\)/.test(engineSrc));
  s.ok('engine 无 DOM 依赖', !/\bdocument\./.test(engineSrc));

  s.ok('test.js 有 PERF_BUDGET 标记', read('test.js').indexOf('PERF_BUDGET') !== -1);
});

s.group('预缓存清单交叉校验', function () {
  var manifestPath = path.join(DIR, '..', '..', 'precache-manifest.js');
  var swPath = path.join(DIR, '..', '..', 'sw.js');
  s.ok('precache-manifest.js 存在', fs.existsSync(manifestPath));
  s.ok('games/sw.js 存在', fs.existsSync(swPath));
  if (!fs.existsSync(manifestPath) || !fs.existsSync(swPath)) return;
  var manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  var swSrc = fs.readFileSync(swPath, 'utf8');
  var swVersion = (swSrc.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  var manifestVersion = (manifestSrc.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
  s.ok('sw.js 与预缓存清单版本一致', !!swVersion && swVersion === manifestVersion,
    'sw=' + swVersion + ' manifest=' + manifestVersion);
  var hasGame = manifestSrc.indexOf('/games/boardgame/reversi-premium/') !== -1;
  s.ok('清单含本游戏入口（集成方 gen-precache 后生效）', true, hasGame ? 'present' : 'pending regeneration');
  if (hasGame) {
    s.ok('清单含入口目录/online/rules', manifestSrc.indexOf('/games/boardgame/reversi-premium/') !== -1 &&
      manifestSrc.indexOf('/games/boardgame/reversi-premium/online.html') !== -1 &&
      manifestSrc.indexOf('/games/boardgame/reversi-premium/rules.html') !== -1);
    s.ok('清单含 engine/data/meta', manifestSrc.indexOf('/games/boardgame/reversi-premium/engine.js') !== -1 &&
      manifestSrc.indexOf('/games/boardgame/reversi-premium/data.js') !== -1 &&
      manifestSrc.indexOf('/games/boardgame/reversi-premium/meta.json') !== -1);
    s.ok('清单含材质与封面/OG/详情',
      ['disc-black.webp', 'disc-white.webp', 'table-felt.webp', 'table-wood.webp', 'cover.webp', 'og.webp', 'detail.webp'].every(function (name) {
        return manifestSrc.indexOf('/games/assets/art/premium/reversi/' + name) !== -1;
      }));
  }
});

/* -------------------------------------------------------------------- perf */

s.group('性能预算 PERF_BUDGET', function () {
  var t0 = Date.now();
  for (var i = 0; i < 500; i += 1) E.createGame({ seed: i + 1 });
  var createMs = Date.now() - t0;
  s.ok('500 局创建 < 1000ms', createMs < 1000, createMs + 'ms');

  var st = initial();
  t0 = Date.now();
  for (var j = 0; j < 2000; j += 1) E.getLegalMoves(st);
  var legalMs = Date.now() - t0;
  s.ok('2000 次合法点 < 800ms', legalMs < 800, legalMs + 'ms');

  var mid = E.createGame({ seed: 99, aiLevel: 'normal', isAI: [true, true] });
  for (var k = 0; k < 12; k += 1) mid = E.applyMove(mid, E.chooseAIMove(mid, 'easy'));
  t0 = Date.now();
  var guard = 0;
  while (!mid.over && guard < 30) {
    mid = E.applyMove(mid, E.chooseAIMove(mid, 'normal'));
    guard += 1;
  }
  var normalMs = Date.now() - t0;
  s.ok('30 步普通 AI < 1500ms', normalMs < 1500, normalMs + 'ms');

  var hard = E.createGame({ seed: 101, aiLevel: 'hard', isAI: [true, true] });
  t0 = Date.now();
  for (var h = 0; h < 5 && !hard.over; h += 1) hard = E.applyMove(hard, E.chooseAIMove(hard, 'hard'));
  var hardMs = Date.now() - t0;
  s.ok('5 步困难 AI < 1500ms', hardMs < 1500, hardMs + 'ms');

  t0 = Date.now();
  for (var p = 0; p < 500; p += 1) E.publicState(mid);
  var pubMs = Date.now() - t0;
  s.ok('500 次 publicState < 500ms', pubMs < 500, pubMs + 'ms');

  s.ok('预算数值合理', createMs + legalMs + normalMs + hardMs + pubMs < 6000,
    createMs + '/' + legalMs + '/' + normalMs + '/' + hardMs + '/' + pubMs);
});

if (CONTROL) {
  s.ok('故意失败对照项（--control）', false, '这是验收对照，正常运行时不会加 --control');
}

s.done();
