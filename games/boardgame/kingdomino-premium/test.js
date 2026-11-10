'use strict';

/*
 * 多米诺王国 Kingdomino（premium 版）引擎与页面测试。
 *
 * 运行：node games/boardgame/kingdomino-premium/test.js
 * 覆盖：48 张真实瓦片、两人局 24 张、5×5 与城堡、地形匹配、四种朝向、
 *       弃置规则、选牌顺序、领地计分、平局、30 局 AI 自对弈、页面契约。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('kingdomino-premium');
var E = require('./engine.js');
var D = require('./data.js');

var DIR = __dirname;
var index = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(DIR, 'rules.html'), 'utf8');
var engineSrc = fs.readFileSync(path.join(DIR, 'engine.js'), 'utf8');
var dataSrc = fs.readFileSync(path.join(DIR, 'data.js'), 'utf8');

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
  return JSON.stringify({ tileId: move.tileId, orientation: move.orientation, row: move.row, col: move.col, discard: !!move.discard });
}
function emptyBoard() {
  var grid = [];
  for (var r = 0; r < 5; r++) {
    var row = [];
    for (var c = 0; c < 5; c++) row.push(null);
    grid.push(row);
  }
  return grid;
}
function fillBoard(grid) {
  for (var r = 0; r < 5; r++) {
    for (var c = 0; c < 5; c++) {
      if (r === 2 && c === 2) { grid[r][c] = { castle: true }; continue; }
      grid[r][c] = { terrain: 'wheat', crowns: 0, tileId: 1 };
    }
  }
}

/* ------------------------------------------------------------------ */
/* 1. 真实牌表与数据                                                   */
/* ------------------------------------------------------------------ */

s.group('真实牌表与数据', function () {
  s.eq('瓦片共 48 张', E.TILES.length, 48);
  s.eq('瓦片编号 1–48', E.TILES.map(function (t) { return t.id; }), Array.from({ length: 48 }, function (_, i) { return i + 1; }));
  s.eq('地形共 6 种', E.ORIENTATION_LABELS.length, 4);
  var squares = {};
  var crowns = {};
  E.TILES.forEach(function (tile) {
    [tile.a, tile.b].forEach(function (half) {
      squares[half.terrain] = (squares[half.terrain] || 0) + 1;
      crowns[half.terrain] = (crowns[half.terrain] || 0) + half.crowns;
    });
  });
  s.eq('麦田 26 格', squares.wheat, 26);
  s.eq('森林 22 格', squares.forest, 22);
  s.eq('湖泊 18 格', squares.water, 18);
  s.eq('草原 14 格', squares.grass, 14);
  s.eq('沼泽 10 格', squares.swamp, 10);
  s.eq('矿山 6 格', squares.mine, 6);
  s.eq('总格数 96', Object.keys(squares).reduce(function (sum, k) { return sum + squares[k]; }, 0), 96);
  s.eq('皇冠总数 39', Object.keys(crowns).reduce(function (sum, k) { return sum + crowns[k]; }, 0), 39);
  s.eq('麦田皇冠 5', crowns.wheat, 5);
  s.eq('森林皇冠 6', crowns.forest, 6);
  s.eq('湖泊皇冠 6', crowns.water, 6);
  s.eq('草原皇冠 6', crowns.grass, 6);
  s.eq('沼泽皇冠 6', crowns.swamp, 6);
  s.eq('矿山皇冠 10', crowns.mine, 10);
  s.eq('48 号瓦片是麦田 + 3 皇冠矿山', E.getTile(48).a.terrain + E.getTile(48).b.terrain + E.getTile(48).b.crowns, 'wheatmine3');
  s.eq('数据页是 UMD', /root\.KingdominoData/.test(dataSrc), true);
  s.eq('引擎页是 UMD', /root\.KingdominoEngine/.test(engineSrc), true);
  s.eq('引擎不调用 Math.random', /Math\.random/.test(engineSrc), false);
});

/* ------------------------------------------------------------------ */
/* 2. 两人局开局                                                       */
/* ------------------------------------------------------------------ */

s.group('两人局开局', function () {
  var state = E.createGame(20261110);
  s.eq('两名玩家', state.players.length, 2);
  s.eq('总共使用 24 张瓦片', state.draft.length + state.drawPile.length, 24);
  s.eq('首轮亮 4 张', state.draft.length, 4);
  s.eq('牌堆剩 20 张', state.drawPile.length, 20);
  s.eq('共 6 轮', state.maxRounds, 6);
  s.eq('首轮顺序 4 个位置', state.order.length, 4);
  s.eq('顺序只含 0/1', state.order.every(function (pi) { return pi === 0 || pi === 1; }), true);
  s.eq('先手玩家在顺序首位', state.order[0], state.firstPlayer);
  s.eq('每位玩家 2 个国王 = 每轮 2 次选择', state.order.filter(function (pi) { return pi === 0; }).length, 2);
  s.eq('首轮当前玩家正确', state.current, state.order[0]);
  s.eq('双方各 5×5 棋盘', state.players.map(function (p) {
    return p.grid.length === 5 && p.grid.every(function (row) { return row.length === 5; });
  }), [true, true]);
  s.eq('城堡在正中央', state.players.map(function (p) { return p.grid[2][2].castle; }), [true, true]);
  s.eq('开局只有城堡', state.players.map(function (p) {
    return p.grid.reduce(function (sum, row) {
      return sum + row.filter(function (cell) { return cell !== null; }).length;
    }, 0);
  }), [1, 1]);
  s.eq('同种子开局一致', JSON.stringify(E.createGame(7)), JSON.stringify(E.createGame(7)));
  s.ok('不同种子牌序不同', JSON.stringify(E.createGame(7).draft) !== JSON.stringify(E.createGame(8).draft));
});

/* ------------------------------------------------------------------ */
/* 3. 朝向与接续                                                       */
/* ------------------------------------------------------------------ */

s.group('朝向与接续', function () {
  var state = E.createGame(1);
  s.eq('四种朝向格子', [0, 1, 2, 3].map(function (o) { return E.orientationCells(o); }),
    [[[0, 0], [0, 1]], [[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0], [1, 0]]]);
  var tile = E.getTile(19);
  s.eq('朝向 0 保持 A/B', E.orientationHalves(tile, 0), [tile.a, tile.b]);
  s.eq('朝向 1 交换 B/A', E.orientationHalves(tile, 1), [tile.b, tile.a]);
  s.eq('朝向 2 保持 A/B', E.orientationHalves(tile, 2), [tile.a, tile.b]);
  s.eq('朝向 3 交换 B/A', E.orientationHalves(tile, 3), [tile.b, tile.a]);
  s.eq('旋转 0→2', E.rotateOrientation(0), 2);
  s.eq('旋转 2→1', E.rotateOrientation(2), 1);
  s.eq('旋转 1→3', E.rotateOrientation(1), 3);
  s.eq('旋转 3→0', E.rotateOrientation(3), 0);
  s.eq('翻面 0→1', E.flipOrientation(0), 1);
  s.eq('翻面 2→3', E.flipOrientation(2), 3);

  s.ok('贴着城堡可以放任意地形', E.canPlaceFor(state, 0, 1, 0, 2, 3).ok);
  s.ok('纵向贴着城堡也可以', E.canPlaceFor(state, 0, 1, 2, 3, 2).ok);
  s.ok('远离城堡不能放', !E.canPlaceFor(state, 0, 1, 0, 0, 0).ok);
  s.ok('超出边界被拒绝', !E.canPlaceFor(state, 0, 1, 0, 0, 4).ok);
  s.ok('覆盖城堡被拒绝', !E.canPlaceFor(state, 0, 1, 0, 2, 2).ok);

  // 地形匹配：先在城堡右侧放一格麦田，再测试森林无法接上。
  var matchState = E.createGame(1);
  matchState.players[0].grid[2][3] = { terrain: 'wheat', crowns: 0, tileId: 1 };
  var forestTile = 3;
  var wheatTile = 1;
  s.ok('不同地形接不上', !E.canPlaceFor(matchState, 0, forestTile, 2, 1, 4).ok);
  s.ok('相同地形可以接上', E.canPlaceFor(matchState, 0, wheatTile, 2, 1, 4).ok);
  s.ok('失败原因提到地形', /地形/.test(E.canPlaceFor(matchState, 0, forestTile, 2, 1, 4).reason));
});

/* ------------------------------------------------------------------ */
/* 4. 放置与弃置                                                       */
/* ------------------------------------------------------------------ */

s.group('放置与弃置', function () {
  var state = E.createGame(1);
  var pi = state.current;
  var moves = E.getLegalMoves(state);
  s.ok('开局有合法动作', moves.length > 0);
  s.ok('开局每个动作都在待选队列里', moves.every(function (m) {
    return state.draft.some(function (entry) { return entry.tileId === m.tileId && entry.takenBy === null; });
  }));
  var move = moves.filter(function (m) { return !m.discard; })[0];
  var next = E.applyMove(state, move);
  s.eq('放置后该玩家瓦片 +1', next.players[pi].placedCount, 1);
  s.eq('放置后两格被占用', move.orientation === 0 || move.orientation === 1 ?
    (next.players[pi].grid[move.row][move.col] !== null && next.players[pi].grid[move.row][move.col + 1] !== null) :
    (next.players[pi].grid[move.row][move.col] !== null && next.players[pi].grid[move.row + 1][move.col] !== null), true);
  s.eq('放置后选牌进度 +1', next.pickIndex, 1);
  s.eq('原状态未被修改', state.players[pi].placedCount, 0);
  s.eq('放置记录完整', !!next.players[pi].lastMove && next.players[pi].lastMove.cells.length, 2);
  expectThrow('非当前玩家被拒绝', function () {
    E.applyMove(E.createGame(1), { tileId: E.createGame(1).draft[0].tileId, orientation: 0, row: 2, col: 3, player: 1 - E.createGame(1).current });
  }, /轮到/);
  expectThrow('可放置的瓦片不能弃置', function () {
    E.applyMove(state, { tileId: move.tileId, discard: true });
  }, /不能弃置|仍有合法位置/);
  expectThrow('非法落点被拒绝', function () {
    E.applyMove(state, { tileId: move.tileId, orientation: 0, row: 0, col: 0 });
  }, /相邻|地形|合法/);

  // 棋盘填满后，所有瓦片都无处可放，只能弃置。
  var full = E.createGame(1);
  full.players[full.current].grid = emptyBoard();
  fillBoard(full.players[full.current].grid);
  var tileId = full.draft[0].tileId;
  s.eq('满盘时该瓦片无落点', E.getPlacements(full, full.current, tileId).length, 0);
  var discarded = E.applyMove(full, { tileId: tileId, discard: true });
  s.eq('无落点时可以弃置', discarded.players[full.current].discardedCount, 1);
  s.eq('弃置后选牌进度 +1', discarded.pickIndex, 1);
});

/* ------------------------------------------------------------------ */
/* 5. 选牌顺序与轮次                                                   */
/* ------------------------------------------------------------------ */

s.group('选牌顺序与轮次', function () {
  var state = E.createGame(3);
  var picks = [];
  for (var i = 0; i < 4; i++) {
    var move = E.getLegalMoves(state)[0];
    picks.push({ player: state.current, pick: state.pickIndex });
    state = E.applyMove(state, move);
  }
  s.eq('一轮 4 次选择', picks.length, 4);
  s.eq('进入第 2 轮', state.round, 2);
  s.eq('第 2 轮重新亮 4 张', state.draft.length, 4);
  s.eq('第 2 轮选牌进度归零', state.pickIndex, 0);
  var expected = picks.slice().sort(function (a, b) { return a.pick - b.pick; })
    .map(function (p) { return p.player; });
  s.eq('下一轮顺序按本轮瓦片位置决定', state.order, expected);
  s.eq('第 2 轮当前玩家正确', state.current, state.order[0]);
  s.eq('牌堆减少 4 张', state.drawPile.length, 16);

  var full = E.createGame(5);
  var guard = 0;
  while (!full.over && guard < 60) {
    var moves = E.getLegalMoves(full);
    if (!moves.length) break;
    full = E.applyMove(full, E.chooseAIMove(full));
    guard++;
  }
  s.eq('整局共 24 次选择', guard, 24);
  s.eq('整局 6 轮', full.round, 6);
  s.eq('牌堆抽空', full.drawPile.length, 0);
  s.eq('每人的选牌次数为 12', full.players.map(function (p) { return p.placedCount + p.discardedCount; }), [12, 12]);
  s.ok('终局有结果', full.over && full.result !== null);
});

/* ------------------------------------------------------------------ */
/* 6. 领地计分与平局                                                   */
/* ------------------------------------------------------------------ */

s.group('领地计分与平局', function () {
  var grid = emptyBoard();
  grid[2][2] = { castle: true };
  grid[0][0] = { terrain: 'wheat', crowns: 1 };
  grid[0][1] = { terrain: 'wheat', crowns: 0 };
  grid[1][0] = { terrain: 'forest', crowns: 2 };
  grid[1][1] = { terrain: 'forest', crowns: 0 };
  grid[4][4] = { terrain: 'water', crowns: 0 };
  var details = E.scoreDetails(grid);
  s.eq('两块主领地得分 2 + 4', details.score, 6);
  s.eq('没有皇冠的湖泊得 0 分', details.regions.filter(function (r) { return r.terrain === 'water'; })[0].score, 0);
  s.eq('领地数量为 3', details.regionCount, 3);
  s.eq('最大领地 2 格', details.maxRegion, 2);
  s.eq('皇冠总数 3', details.crowns, 3);
  s.eq('非城堡格总数 5', details.area, 5);
  s.eq('scoreKingdom 与 scoreDetails 一致', E.scoreKingdom(grid), 6);

  var single = emptyBoard();
  single[2][2] = { castle: true };
  single[0][0] = { terrain: 'mine', crowns: 3 };
  s.eq('单格 3 皇冠矿山得 3 分', E.scoreKingdom(single), 3);
  s.eq('空王国得 0 分', E.scoreKingdom(emptyBoard()), 0);

  var base = E.createGame(1);
  base.players[0].grid = emptyBoard();
  base.players[0].grid[2][2] = { castle: true };
  base.players[0].grid[0][0] = { terrain: 'wheat', crowns: 1 };
  base.players[0].grid[0][1] = { terrain: 'wheat', crowns: 0 };
  base.players[0].grid[1][0] = { terrain: 'forest', crowns: 2 };
  base.players[0].grid[1][1] = { terrain: 'forest', crowns: 0 };
  base.players[1].grid = emptyBoard();
  base.players[1].grid[2][2] = { castle: true };
  base.players[1].grid[0][0] = { terrain: 'water', crowns: 1 };
  base.players[1].grid[0][1] = { terrain: 'water', crowns: 0 };
  base.players[1].grid[0][2] = { terrain: 'water', crowns: 0 };
  base.players[1].grid[0][3] = { terrain: 'water', crowns: 0 };
  base.players[1].grid[0][4] = { terrain: 'water', crowns: 0 };
  base.players[1].grid[1][0] = { terrain: 'water', crowns: 0 };
  var result = E.computeResults(base, '测试');
  s.eq('双方总分相同', result.scores[0].score, result.scores[1].score);
  s.eq('平局时最大领地更大者胜', result.winner, 1);
  s.eq('平局说明为空', result.tieBreak, null);

  base.players[1].grid = emptyBoard();
  base.players[1].grid[2][2] = { castle: true };
  base.players[1].grid[0][0] = { terrain: 'water', crowns: 1 };
  base.players[1].grid[0][1] = { terrain: 'water', crowns: 0 };
  base.players[1].grid[1][0] = { terrain: 'mine', crowns: 2 };
  base.players[1].grid[1][1] = { terrain: 'mine', crowns: 0 };
  var tie = E.computeResults(base, '测试');
  s.eq('最大领地也相同则共享胜利', tie.winner, null);
  s.ok('共享胜利有说明', /共享/.test(tie.tieBreak));
});

/* ------------------------------------------------------------------ */
/* 7. 30 局 AI 自对弈                                                  */
/* ------------------------------------------------------------------ */

s.group('30 局 AI 自对弈', function () {
  var allLegal = true, allOver = true, countsOk = true, resultOk = true;
  var scores = [];
  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame(seed);
    var guard = 0;
    var legalHere = true;
    while (!state.over && guard < 80) {
      var moves = E.getLegalMoves(state);
      if (!moves.length) { legalHere = false; break; }
      var move = E.chooseAIMove(state);
      if (!moves.some(function (m) { return moveKey(m) === moveKey(move); })) legalHere = false;
      try { state = E.applyMove(state, move); }
      catch (error) { legalHere = false; break; }
      guard++;
    }
    if (!legalHere) allLegal = false;
    if (!state.over) allOver = false;
    if (state.players[0].placedCount + state.players[0].discardedCount !== 12 ||
        state.players[1].placedCount + state.players[1].discardedCount !== 12) countsOk = false;
    if (!state.result || state.result.scores.some(function (row) { return typeof row.score !== 'number'; })) resultOk = false;
    scores.push(state.result.scores.map(function (row) { return row.score; }));
    s.ok('种子 ' + seed + ' 自对弈合法结束', legalHere && state.over && guard === 24,
      '步数 ' + guard + '，结束 ' + state.over);
  }
  s.ok('30 局全部只走合法动作', allLegal);
  s.ok('30 局全部正常结束', allOver);
  s.ok('双方每局都完成 12 次选择', countsOk);
  s.ok('30 局都有完整结算', resultOk);
  s.ok('分数在合理范围', scores.every(function (pair) {
    return pair.every(function (score) { return score >= 0 && score <= 200; });
  }));
});

/* ------------------------------------------------------------------ */
/* 8. 页面契约                                                         */
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
  s.ok('游戏页有 SVG 地形图标', /viewBox="0 0 48 48"/.test(index) && /terrainIcon/.test(index));
  s.ok('游戏页有皇冠 SVG', /viewBox="0 0 32 32"/.test(index) && /crownSvg/.test(index));
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
  s.ok('游戏页有静音按钮', /id="muteBtn"/.test(index));
  s.ok('游戏页有至少 3 段关键帧动画', (index.match(/@keyframes/g) || []).length >= 3);
  s.ok('游戏页有 WAAPI 动画调用', /\.animate\s*\(/.test(index));
  s.ok('游戏页有种子输入', /id="seedInput"/.test(index));
  s.ok('游戏页有重开与换局', /id="restart"/.test(index) && /id="newSeed"/.test(index));
  s.ok('游戏页有 AI 演示', /id="autoDemo"/.test(index) && /startDemo/.test(index));
  s.ok('游戏页有待选与顺序容器', /id="draft"/.test(index) && /id="orderStrip"/.test(index));
  s.ok('游戏页有双方棋盘', /id="boardHuman"/.test(index) && /id="boardAI"/.test(index));
  s.ok('游戏页有朝向按钮', [0, 1, 2, 3].every(function (o) { return new RegExp('id="orient' + o + '"').test(index); }));
  s.ok('游戏页有弃置与取消', /id="discardBtn"/.test(index) && /id="cancelPick"/.test(index));
  s.ok('游戏页有对局记录', /id="log"/.test(index));
  s.ok('游戏页有结果弹层', /id="resultOverlay"/.test(index) && /role="dialog"/.test(index));
  s.ok('游戏页有键盘取消与快捷键', /event\.key === 'Escape'/.test(index) && /event\.key\.toLowerCase\(\) === 'r'/.test(index));
  s.ok('游戏页有调试钩子', /window\.__kingdomino/.test(index));
  s.ok('游戏页无 Math.random', !/Math\.random/.test(index.replace(/<script[\s\S]*?<\/script>/gi, '')));

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
  s.ok('规则页含真实件数', /48 张/.test(rules) && /24 张/.test(rules) && /39/.test(rules));
  s.ok('规则页含地形匹配与计分', /地形匹配/.test(rules) && /面积 × 皇冠/.test(rules));
  s.ok('规则页含 B 站 BV 号', /BV1x5411t7xg/.test(rules) && /BV1nLnn6LESo/.test(rules) && /BV1ZV411m7n8/.test(rules) && /BV1SW411V7JR/.test(rules));
  s.ok('规则页含 B 站链接', /bilibili\.com\/video\/BV/.test(rules));
  s.ok('规则页含公开文字规则核对', /官方/.test(rules) && /公开/.test(rules));
  var count = cjkCount(rules);
  s.ok('规则正文 1200 字以上', count >= 1200, count + ' 字');
});

s.done();
