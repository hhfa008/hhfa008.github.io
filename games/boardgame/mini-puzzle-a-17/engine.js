(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
var VARIANT = 'b';
function rng(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(r() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
var ROWS = 3;
var COLS = VARIANT === 'b' ? 4 : 3;
var N = ROWS * COLS;
function create(seed) {
  var r = rng(seed), grid = [];
  for (var i = 0; i < N; i++) grid.push(0);
  var clicks = 2 + Math.floor(r() * (N - 3));
  var used = {};
  for (var k = 0; k < clicks; k++) {
    var id = Math.floor(r() * N);
    if (used[id]) { k--; continue; }
    used[id] = 1; toggle(grid, id);
  }
  if (grid.indexOf(1) < 0) { toggle(grid, 0); }
  return { grid: grid, rows: ROWS, cols: COLS, moves: 0, message: '点击会翻转自己和上下左右的灯。' };
}
function toggle(grid, id) {
  var r = Math.floor(id / COLS), c = id % COLS;
  var ids = [id];
  if (r > 0) ids.push(id - COLS);
  if (r < ROWS - 1) ids.push(id + COLS);
  if (c > 0) ids.push(id - 1);
  if (c < COLS - 1) ids.push(id + 1);
  ids.forEach(function (x) { grid[x] = grid[x] ? 0 : 1; });
}
function solved(s) { return s.grid.indexOf(1) < 0; }
function act(s, a) {
  if (solved(s) || !a || a.type !== 'cell') return s;
  if (a.id < 0 || a.id >= N) return s;
  toggle(s.grid, a.id); s.moves++;
  s.message = solved(s) ? '全部熄灭！' : '继续熄灯。';
  return s;
}
function solve(s) {
  for (var mask = 0; mask < (1 << s.cols); mask++) {
    var grid = s.grid.slice(), clicks = [];
    for (var c = 0; c < s.cols; c++) if (mask & (1 << c)) { toggle(grid, c); clicks.push(c); }
    for (var r = 1; r < s.rows; r++) {
      for (c = 0; c < s.cols; c++) {
        if (grid[(r - 1) * s.cols + c]) { var id = r * s.cols + c; toggle(grid, id); clicks.push(id); }
      }
    }
    if (grid.indexOf(1) < 0) return clicks;
  }
  return [];
}
function view(s) {
  var cells = s.grid.map(function (v, i) {
    return { id: i, label: v ? '●' : '○', tone: v ? 'on' : 'off', state: '' };
  });
  return {
    cols: s.cols, prompt: '把所有灯都熄灭。', cells: cells, actions: [],
    notes: ['亮灯：' + s.grid.filter(function (x) { return x; }).length + ' 盏', '步数：' + s.moves],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
