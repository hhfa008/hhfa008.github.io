'use strict';

// Tap Match test.
//
// The page's newBoard/tapTile are DOM-bound (they touch $('score'), tiles,
// classList), so they cannot be imported as-is. The rules below are copied
// from index.html's newBoard/tapTile and operate on the same SYMBOLS/SIZE/
// ROUND_MS constants, which are read from the page. Static checks then pin
// the copied rules to the source text so the two cannot drift silently.

var lib = require('../tests/lib.js');
var s = lib.suite('tap-match');

var html = lib.page(__dirname);

function constFromPage(name) {
  var m = html.match(new RegExp('var ' + name + ' = ([^;]+);'));
  if (!m) throw new Error('constant not found: ' + name);
  return new Function('return (' + m[1] + ');')();
}

var SYMBOLS = constFromPage('SYMBOLS');
var SIZE = constFromPage('SIZE');
var ROUND_MS = constFromPage('ROUND_MS');

// ---- 与页面同源的纯逻辑（见 index.html newBoard / tapTile） ----
function symbol(rng) { return SYMBOLS[Math.floor(rng() * SYMBOLS.length)]; }
function makeBoard(rng) {
  var target = symbol(rng);
  var cells = [];
  for (var i = 0; i < SIZE; i++) cells.push(symbol(rng));
  if (cells.indexOf(target) === -1) cells[Math.floor(rng() * SIZE)] = target;
  return { target: target, cells: cells, score: 0 };
}
function tap(state, i, rng) {
  if (state.cells[i] === state.target) {
    state.score++;
    state.cells[i] = symbol(rng);
    if (state.cells.indexOf(state.target) === -1) {
      state.cells[Math.floor(rng() * SIZE)] = state.target;
    }
    return true;
  }
  state.score = Math.max(0, state.score - 1);
  return false;
}

s.group('页面常量', function () {
  s.eq('8 种符号', SYMBOLS.length, 8);
  s.eq('16 个格子', SIZE, 16);
  s.eq('30 秒一局', ROUND_MS, 30000);
  s.eq('符号无重复', new Set(SYMBOLS).size, 8);
  s.ok('符号均为非空字符串', SYMBOLS.every(function (x) { return typeof x === 'string' && x.length > 0; }));
});

s.group('计分规则与源码一致', function () {
  s.ok('源码：命中 +1', /score\+\+;/.test(html));
  s.ok('源码：误点 -1 且下限 0', /score = Math\.max\(0, score - 1\);/.test(html));
  s.ok('源码：以格子是否等于目标判定', /cells\[i\] === target/.test(html));
  s.ok('源码：目标被点掉后补一个', /cells\.indexOf\(target\) === -1/.test(html) && /cells\[j\] = target;/.test(html));
  s.ok('源码：计时使用 performance.now + ROUND_MS', /endAt = performance\.now\(\) \+ ROUND_MS;/.test(html));
});

s.group('棋盘生成', function () {
  var rng = lib.mulberry32(2026);
  var badTarget = 0, badSize = 0, badSymbol = 0;
  for (var i = 0; i < 100; i++) {
    var st = makeBoard(rng);
    if (st.cells.length !== SIZE) badSize++;
    if (st.cells.indexOf(st.target) === -1) badTarget++;
    if (!st.cells.every(function (c) { return SYMBOLS.indexOf(c) >= 0; })) badSymbol++;
  }
  s.eq('100 次生成均为 16 格', badSize, 0);
  s.eq('100 次生成都含目标符号', badTarget, 0);
  s.eq('格子内容都来自 SYMBOLS', badSymbol, 0);
  s.eq('初始分数为 0', makeBoard(rng).score, 0);
});

s.group('点击计分', function () {
  var rng = lib.mulberry32(7);
  var st = makeBoard(rng);
  var hit = st.cells.indexOf(st.target);
  s.eq('点中目标得 1 分', tap(st, hit, rng), true);
  s.eq('分数为 1', st.score, 1);
  s.ok('点中的格子换成合法符号', SYMBOLS.indexOf(st.cells[hit]) >= 0);
  s.ok('点掉后盘面仍有目标', st.cells.indexOf(st.target) >= 0);
  var miss = st.cells.findIndex(function (c) { return c !== st.target; });
  s.eq('点错不得分', tap(st, miss, rng), false);
  s.eq('点错扣 1 分', st.score, 0);
  for (var i = 0; i < 10; i++) {
    var j = st.cells.findIndex(function (c) { return c !== st.target; });
    if (j < 0) break;
    tap(st, j, rng);
  }
  s.eq('连续点错分数不会变负', st.score, 0);
  var seq = makeBoard(rng);
  var neverNegative = true, hits = 0;
  for (i = 0; i < 200; i++) {
    var k = Math.floor(rng() * SIZE);
    tap(seq, k, rng);
    if (seq.score < 0) neverNegative = false;
    if (seq.cells.indexOf(seq.target) >= 0) hits++;
  }
  s.ok('200 次随机点击分数始终非负', neverNegative);
  s.eq('200 次随机点击目标始终在场', hits, 200);
});

s.done();
