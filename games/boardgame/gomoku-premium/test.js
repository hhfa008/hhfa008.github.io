'use strict';

/*
 * Gomoku Premium unit tests.
 *
 *   node games/boardgame/gomoku-premium/test.js
 *   node games/boardgame/gomoku-premium/test.js --control   # intentional failure
 *
 * The engine is the same file the page and the online server use. Tests never
 * need a DOM. run-all.js discovers this file because it starts with "test".
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');
var D = require('./data.js');

var s = lib.suite('gomoku-premium');
var CONTROL = process.argv.indexOf('--control') !== -1;

var N = E.N, NN = E.NN, BLACK = E.BLACK, WHITE = E.WHITE, EMPTY = E.EMPTY;

function at(r, c) { return r * N + c; }
function fresh(opts) {
  return E.createGame(Object.assign({ seed: 20261110, names: ['黑方', '白方'], isAI: [false, true], aiLevel: 'normal' }, opts || {}));
}
function play(state, moves) {
  var next = state;
  for (var i = 0; i < moves.length; i++) next = E.applyMove(next, { type: 'place', row: moves[i][0], col: moves[i][1] });
  return next;
}
function midgame() {
  // A quiet 24-stone position built from the 2/2 period pattern: no five and
  // no immediate win for either side, so the AI must actually search.
  var cells = [[7, 7], [7, 8], [8, 7], [6, 6], [8, 8], [6, 8], [8, 6], [9, 9], [5, 5],
    [7, 6], [6, 7], [5, 7], [9, 7], [5, 6], [8, 5], [6, 9], [10, 10], [4, 4], [9, 5],
    [5, 9], [6, 10], [10, 6], [4, 6], [6, 4]];
  var state = fresh();
  for (var i = 0; i < cells.length; i++) {
    var r = cells[i][0], c = cells[i][1];
    state.board[at(r, c)] = ((r + 2 * c) % 4) < 2 ? BLACK : WHITE;
  }
  state.moveCount = cells.length;
  state.current = BLACK;
  state.history = [];
  return { state: state, used: cells.length };
}

s.group('常量与创建', function () {
  s.eq('棋盘 15 路', N, 15);
  s.eq('225 个交叉点', NN, 225);
  s.eq('空/黑/白常量', [EMPTY, BLACK, WHITE], [0, 1, 2]);
  s.eq('五个星位', D.starPoints.length, 5);
  var g = fresh();
  s.eq('初始棋盘 225 格', g.board.length, 225);
  s.eq('初始全空', g.board.filter(function (v) { return v !== EMPTY; }).length, 0);
  s.eq('黑先', g.current, BLACK);
  s.eq('初始未结束', g.over, false);
  s.eq('初始 0 手', g.moveCount, 0);
  s.eq('两名玩家', g.players.length, 2);
  s.eq('玩家颜色', [g.players[0].color, g.players[1].color], [BLACK, WHITE]);
  s.eq('名字写入', [g.players[0].name, g.players[1].name], ['黑方', '白方']);
  s.eq('AI 标记写入', [g.players[0].isAI, g.players[1].isAI], [false, true]);
  s.eq('seed 保留', g.seed, 20261110);
  s.eq('状态字符串', E.status(g), 'black-to-move');
  s.eq('初始比分', E.score(g), { black: 0, white: 0, moves: 0 });
});

s.group('落子、轮转与不可变', function () {
  var g = fresh();
  var before = JSON.stringify(g);
  var n1 = E.applyMove(g, { type: 'place', row: 7, col: 7 });
  s.eq('原状态未被修改', JSON.stringify(g), before);
  s.eq('新状态落子', n1.board[at(7, 7)], BLACK);
  s.eq('手数 +1', n1.moveCount, 1);
  s.eq('轮到白棋', n1.current, WHITE);
  s.eq('最后一步记录', n1.lastMove, { row: 7, col: 7, player: BLACK });
  s.eq('历史记录 1 条', n1.history.length, 1);
  s.eq('记录索引', n1.history[0].index, at(7, 7));
  s.eq('状态字符串转白', E.status(n1), 'white-to-move');
  var n2 = E.applyMove(n1, { type: 'place', row: 0, col: 0 });
  s.eq('白棋落子', n2.board[0], WHITE);
  s.eq('轮到黑棋', n2.current, BLACK);
  s.eq('手数 2', n2.moveCount, 2);
  s.ok('非法类型抛错', (function () { try { E.applyMove(n2, { type: 'pass' }); return false; } catch (e) { return /unsupported move type/.test(e.message); } })());
  s.ok('越界抛错', (function () { try { E.applyMove(n2, { row: -1, col: 0 }); return false; } catch (e) { return /outside/.test(e.message); } })());
  s.ok('非整数抛错', (function () { try { E.applyMove(n2, { row: 1.5, col: 0 }); return false; } catch (e) { return /integer/.test(e.message); } })());
  s.ok('已占位抛错', (function () { try { E.applyMove(n2, { row: 7, col: 7 }); return false; } catch (e) { return /occupied/.test(e.message); } })());
  var overState = { over: true, board: n2.board, current: BLACK, moveCount: 2 };
  s.ok('结束后落子抛错', (function () { try { E.applyMove(overState, { row: 1, col: 1 }); return false; } catch (e) { return /already over/.test(e.message); } })());
  s.eq('合法点数量', E.getLegalMoves(fresh()).length, NN);
  s.eq('合法点字段', Object.keys(E.getLegalMoves(fresh())[0]).sort(), ['col', 'row', 'type']);
});

s.group('胜负判定（四方向 / 贴边 / 长连 / 断线）', function () {
  var b = new Array(NN).fill(EMPTY);
  for (var c = 3; c < 8; c++) b[at(7, c)] = BLACK;
  s.ok('横向连五', E.checkWinAt(b, 7, 5, BLACK));
  s.ok('横向白方不成立', !E.checkWinAt(b, 7, 5, WHITE));
  b = new Array(NN).fill(EMPTY);
  for (var r = 2; r < 7; r++) b[at(r, 6)] = WHITE;
  s.ok('纵向连五', E.checkWinAt(b, 4, 6, WHITE));
  b = new Array(NN).fill(EMPTY);
  for (var k = 0; k < 5; k++) b[at(k, k)] = BLACK;
  s.ok('主对角线连五', E.checkWinAt(b, 2, 2, BLACK));
  b = new Array(NN).fill(EMPTY);
  for (k = 0; k < 5; k++) b[at(k, 10 - k)] = WHITE;
  s.ok('副对角线连五', E.checkWinAt(b, 2, 8, WHITE));
  b = new Array(NN).fill(EMPTY);
  for (c = 0; c < 5; c++) b[at(0, c)] = BLACK;
  s.ok('贴边横向连五', E.checkWinAt(b, 0, 4, BLACK));
  b = new Array(NN).fill(EMPTY);
  for (c = 0; c < 4; c++) b[at(5, c)] = BLACK;
  s.ok('四子不算胜', !E.checkWinAt(b, 5, 3, BLACK));
  b = new Array(NN).fill(EMPTY);
  for (c = 0; c < 2; c++) b[at(5, c)] = BLACK;
  for (c = 3; c < 6; c++) b[at(5, c)] = BLACK;
  s.ok('断开五子不算胜', !E.checkWinAt(b, 5, 4, BLACK));
  b = new Array(NN).fill(EMPTY);
  for (c = 2; c < 8; c++) b[at(3, c)] = BLACK;
  s.ok('长连六子也算胜', E.checkWinAt(b, 3, 5, BLACK));
  s.eq('长连连线至少 6 点', E.lineAt(b, 3, 5, BLACK).length >= 6, true);
  s.eq('空格无连线', E.lineAt(new Array(NN).fill(EMPTY), 3, 3, BLACK), null);
});

s.group('实战胜负与平局', function () {
  var g = fresh();
  g = play(g, [[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]]);
  s.eq('五连后结束', g.over, true);
  s.eq('黑棋获胜', g.winner, BLACK);
  s.eq('结束原因 five', g.result.reason, 'five');
  s.eq('结束比分', g.result.scores, [5, 4]);
  s.eq('胜利线长度', g.result.line.length, 5);
  s.eq('状态字符串 black', E.status(g), 'black');
  s.ok('结束后 AI 不再走', E.chooseAIMove(g, 'hard') === null);
  s.ok('结束后无合法点', E.getLegalMoves(g).length === 0);

  // A 15x15 2/2-period board has no five anywhere; remove one cell to test draw.
  var full = new Array(NN);
  for (var rr = 0; rr < N; rr++) for (var cc = 0; cc < N; cc++) full[at(rr, cc)] = ((rr + 2 * cc) % 4) < 2 ? BLACK : WHITE;
  var draw = fresh();
  draw.board = full.slice();
  draw.board[0] = EMPTY;
  draw.moveCount = NN - 1;
  draw.current = BLACK;
  draw.history = [];
  var drawn = E.applyMove(draw, { type: 'place', row: 0, col: 0 });
  s.eq('最后一个交叉点填满', drawn.moveCount, NN);
  s.eq('满盘平局结束', drawn.over, true);
  s.eq('平局无胜者', drawn.winner, 0);
  s.eq('平局原因 full', drawn.result.reason, 'full');
  s.eq('平局状态字符串', E.status(drawn), 'draw');
});

s.group('AI 三档', function () {
  var win = fresh();
  win = play(win, [[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3]]);
  s.eq('轮到黑棋', win.current, BLACK);
  var wm = E.chooseAIMove(win, 'normal');
  var wnext = E.applyMove(win, wm);
  s.eq('AI 抓住成五', wnext.over, true);
  s.eq('成五胜者为黑', wnext.winner, BLACK);

  var block = fresh();
  block = play(block, [[0, 0], [7, 3], [2, 2], [7, 4], [4, 4], [7, 5], [6, 6], [7, 6]]);
  s.eq('轮到黑棋防守', block.current, BLACK);
  var bm = E.chooseAIMove(block, 'normal');
  s.ok('AI 堵住白棋成五', (bm.row === 7 && (bm.col === 2 || bm.col === 7)), JSON.stringify(bm));
  var bnext = E.applyMove(block, bm);
  s.eq('堵住后未结束', bnext.over, false);

  var mid = midgame();
  s.ok('中局至少 12 手', mid.used >= 12, 'used=' + mid.used);
  ['easy', 'normal', 'hard'].forEach(function (level) {
    var m = E.chooseAIMove(mid.state, level);
    s.ok(level + ' 返回合法点', !!m && m.type === 'place' && m.row >= 0 && m.row < N && m.col >= 0 && m.col < N &&
      mid.state.board[at(m.row, m.col)] === EMPTY, JSON.stringify(m));
    var again = E.chooseAIMove(mid.state, level);
    s.eq(level + ' 同局面确定性', again, m);
    var copy = JSON.parse(JSON.stringify(mid.state));
    s.eq(level + ' 不修改入参', JSON.stringify(mid.state), JSON.stringify(copy));
  });
  var empty = fresh();
  s.eq('空盘 AI 走天元', E.chooseAIMove(empty, 'hard'), { type: 'place', row: 7, col: 7 });
  var full = E.createGame({ seed: 1 });
  for (var i = 0; i < NN; i++) full.board[i] = (i % 2) ? BLACK : WHITE;
  full.over = true;
  s.eq('满盘 AI 返回 null', E.chooseAIMove(full, 'normal'), null);
});

s.group('布局与提示函数', function () {
  var mid = midgame();
  var moves = E.getLegalMoves(mid.state);
  s.eq('合法点数量 = 225 - 手数', moves.length, NN - mid.state.moveCount);
  var freshMoves = E.getLegalMoves(fresh());
  s.ok('空盘合法点按中心排序', freshMoves[0].row === 7 && freshMoves[0].col === 7, JSON.stringify(freshMoves[0]));
  var b = new Array(NN).fill(EMPTY);
  b[at(7, 3)] = BLACK; b[at(7, 4)] = BLACK; b[at(7, 5)] = BLACK; b[at(7, 6)] = BLACK;
  var wins = E.immediateWins(b, BLACK);
  s.ok('立即成五点包含 (7,2) 与 (7,7)', wins.indexOf(at(7, 2)) >= 0 && wins.indexOf(at(7, 7)) >= 0,
    JSON.stringify(wins));
  s.ok('进攻点分高于边角', E.pointScore(b, at(7, 6), BLACK) > E.pointScore(b, at(0, 14), BLACK));
  s.ok('候选人只围绕已有棋子', E.candidates(b).every(function (i) {
    var r = (i / N) | 0, c = i % N;
    for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
      var rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr * N + cc] !== EMPTY) return true;
    }
    return false;
  }));
});

s.group('静态契约与文档', function () {
  ['index.html', 'engine.js', 'data.js', 'rules.html', 'test.js', 'DESIGN.md', 'ACCEPTANCE.md',
    'E2E.md', 'realism.json', 'perf.json', 'meta.json', 'online.html', 'online-server.mjs',
    'test-online.js', 'online-e2e.json', 'art-render.html'].forEach(function (name) {
    s.ok(name + ' 存在', fs.existsSync(path.join(__dirname, name)));
  });

  var index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  s.ok('index 有 viewport-fit=cover', /viewport-fit=cover/i.test(index));
  s.ok('index 使用 100dvh', /100dvh/i.test(index));
  s.ok('index 有 44px 触控', /min-height:\s*44px/i.test(index));
  s.ok('index 引用共享规则', index.indexOf('../../shared/rules.js') >= 0);
  s.ok('index 引用共享音效', index.indexOf('../../shared/sfx.js') >= 0);
  s.ok('index 引用 data/engine', index.indexOf('./data.js') >= 0 && index.indexOf('./engine.js') >= 0);
  s.ok('index 引用联机桥', index.indexOf('../app/online-bridge.js') >= 0);
  s.ok('index 有 OG 图', /og:image/.test(index) && index.indexOf('og.webp') >= 0);
  s.ok('index 引用封面', index.indexOf('cover.webp') >= 0);
  s.ok('index 引用详情图', index.indexOf('detail.webp') >= 0);
  s.ok('index 无远程脚本', !/<script[^>]+src=["']https?:/i.test(index));
  s.ok('index 无 emoji 棋子', index.indexOf('⚫') < 0 && index.indexOf('⚪') < 0);

  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('规则页写 15×15', /15\s*[×x]\s*15/.test(rules));
  s.ok('规则页写五连', rules.indexOf('五') >= 0 && rules.indexOf('连') >= 0);
  s.ok('规则页解释无禁手', rules.indexOf('禁手') >= 0);
  s.ok('规则页列 B站来源', rules.indexOf('bilibili.com/video/BV1wS4y1D7uT') >= 0);

  var onlineSrc = fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8');
  s.ok('联机服务器复用共享 server', onlineSrc.indexOf("from '../app/online-game.mjs'") >= 0);
  s.ok('联机服务器 game=gomoku', /game:\s*'gomoku'/.test(onlineSrc));
  var testOnlineSrc = fs.readFileSync(path.join(__dirname, 'test-online.js'), 'utf8');
  s.ok('双客户端测试标记', /clients:\s*2/.test(testOnlineSrc) && /sameGame:\s*true/.test(testOnlineSrc));
  s.ok('双客户端测试有 --control', /--control/.test(testOnlineSrc));
  var onlinePage = fs.readFileSync(path.join(__dirname, 'online.html'), 'utf8');
  s.ok('联机页使用共享大厅', onlinePage.indexOf('app/online-lobby.js') >= 0);
  s.ok('联机页设置 ONLINE_GAME', /window\.ONLINE_GAME\s*=/.test(onlinePage));

  var meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
  s.eq('meta slug', meta.slug, 'gomoku-premium');
  s.eq('meta gameType', meta.gameType || meta.mode, 'multiplayer');
  s.ok('meta 联机字段完整', meta.online && meta.online.reconnect === true && meta.online.timeoutTakeover === true &&
    meta.online.leaderboard === true && meta.online.rematch === true);
  s.ok('meta 引用 test-online', meta.online && meta.online.twoClientE2E === 'test-online.js');

  var realism = JSON.parse(fs.readFileSync(path.join(__dirname, 'realism.json'), 'utf8'));
  var kinds = {};
  realism.checks.forEach(function (c) { kinds[c.kind] = true; });
  s.eq('realism pass', realism.pass, true);
  s.ok('realism ≥6 项', realism.checks.length >= 6, 'checks=' + realism.checks.length);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.ok('realism ≥3 类', Object.keys(kinds).length >= 3, Object.keys(kinds).join(','));
  s.ok('realism 引用 ART-GUIDE', realism.sources.join(' ').indexOf('ART-GUIDE') >= 0);
  s.ok('realism 引用 B站', realism.sources.join(' ').indexOf('bilibili.com') >= 0);

  var perf = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf.json'), 'utf8'));
  s.ok('perf 有 budgets 与 measured', !!perf.budgets && !!perf.measured);

  // Service worker manifest cross-check. After integration runs gen-precache,
  // the game paths must appear; before that the version equality still holds.
  var swPath = path.join(__dirname, '../../sw.js');
  var manifestPath = path.join(__dirname, '../../precache-manifest.js');
  var swSrc = fs.readFileSync(swPath, 'utf8');
  var manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  var swVersion = (swSrc.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  var manifestVersion = (manifestSrc.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
  s.ok('sw 与 precache manifest 版本一致且 ≥v20', !!swVersion && swVersion === manifestVersion &&
    Number(swVersion.replace('v', '')) >= 20, swVersion + ' / ' + manifestVersion);
  if (manifestSrc.indexOf('/games/boardgame/gomoku-premium/') >= 0) {
    s.ok('manifest 含本游戏入口/引擎/材质', manifestSrc.indexOf('/games/boardgame/gomoku-premium/') >= 0 &&
      manifestSrc.indexOf('/games/boardgame/gomoku-premium/engine.js') >= 0 &&
      manifestSrc.indexOf('/games/assets/art/premium/gomoku/cover.webp') >= 0);
  } else {
    console.log('  PENDING: precache manifest 尚未包含 gomoku-premium（集成方 gen-precache 后自动校验）');
  }
});

s.group('性能预算 PERF_BUDGET', function () {
  function nowMs() { return Number(process.hrtime.bigint()) / 1e6; }
  var t0 = nowMs();
  for (var i = 0; i < 500; i++) E.createGame({ seed: i + 1 });
  var createMs = Math.round((nowMs() - t0) * 1000) / 1000;

  var g = fresh();
  t0 = nowMs();
  var moves = [[7, 7], [7, 8], [8, 7], [6, 6], [8, 8], [6, 8], [8, 6], [9, 9], [5, 5], [7, 6]];
  for (var m = 0; m < moves.length; m++) g = E.applyMove(g, { type: 'place', row: moves[m][0], col: moves[m][1] });
  var applyMs = Math.round((nowMs() - t0) * 1000) / 1000;

  t0 = nowMs();
  for (var l = 0; l < 1000; l++) E.getLegalMoves(g);
  var legalMs = Math.round((nowMs() - t0) * 1000) / 1000;

  var mid = midgame();
  var aiTime = { easy: 0, normal: 0, hard: 0 };
  ['easy', 'normal', 'hard'].forEach(function (level) {
    var start = nowMs();
    for (var k = 0; k < (level === 'hard' ? 5 : 20); k++) E.chooseAIMove(mid.state, level);
    aiTime[level] = Math.round((nowMs() - start) * 1000) / 1000;
  });

  s.ok('创建 500 局 < 1000ms', createMs < 1000, createMs + 'ms');
  s.ok('10 手落子 < 300ms', applyMs < 300, applyMs + 'ms');
  s.ok('1000 次合法点 < 400ms', legalMs < 400, legalMs + 'ms');
  s.ok('easy 20 步 < 500ms', aiTime.easy < 500, aiTime.easy + 'ms');
  s.ok('normal 20 步 < 900ms', aiTime.normal < 900, aiTime.normal + 'ms');
  s.ok('hard 5 步 < 900ms', aiTime.hard < 900, aiTime.hard + 'ms');
  console.log('PERF_BUDGET measured: create500=' + createMs + 'ms apply10=' + applyMs +
    'ms legal1000=' + legalMs + 'ms ai=' + JSON.stringify(aiTime));
});

if (CONTROL) {
  s.group('故意失败对照（--control）', function () {
    s.ok('这是验收对照，正常运行时不会加 --control', false);
  });
}

s.done();
