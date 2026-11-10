(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
var VARIANT = 'a';
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
var ROWS = VARIANT === 'b' ? 7 : 5;
var COLS = VARIANT === 'b' ? 7 : 5;
function create(seed) {
  var r = rng(seed);
  var grid = [];
  for (var i = 0; i < ROWS * COLS; i++) grid.push(0);
  var stack = [[1, 1]];
  grid[1 * COLS + 1] = 1;
  while (stack.length) {
    var cur = stack[stack.length - 1], cr = cur[0], cc = cur[1];
    var cand = [];
    if (cr > 2 && !grid[(cr - 2) * COLS + cc]) cand.push([cr - 2, cc, cr - 1, cc]);
    if (cr < ROWS - 3 && !grid[(cr + 2) * COLS + cc]) cand.push([cr + 2, cc, cr + 1, cc]);
    if (cc > 2 && !grid[cr * COLS + cc - 2]) cand.push([cr, cc - 2, cr, cc - 1]);
    if (cc < COLS - 3 && !grid[cr * COLS + cc + 2]) cand.push([cr, cc + 2, cr, cc + 1]);
    if (!cand.length) { stack.pop(); continue; }
    var pick = cand[Math.floor(r() * cand.length)];
    grid[pick[0] * COLS + pick[1]] = 1;
    grid[pick[2] * COLS + pick[3]] = 1;
    stack.push([pick[0], pick[1]]);
  }
  var start = 1 * COLS + 1, goal = (ROWS - 2) * COLS + (COLS - 2);
  return { rows: ROWS, cols: COLS, grid: grid, pos: start, start: start, goal: goal, moves: 0, message: '从左上走到右下，只能走通道。' };
}
function neighbors(id, cols) {
  var r = Math.floor(id / cols), c = id % cols, out = [];
  if (r > 0) out.push(id - cols);
  if (c < cols - 1) out.push(id + 1);
  if (r < 99) out.push(id + cols);
  if (c > 0) out.push(id - 1);
  return out;
}
function solved(s) { return s.pos === s.goal; }
function act(s, a) {
  if (solved(s) || !a || a.type !== 'cell') return s;
  var id = a.id;
  if (id < 0 || id >= s.rows * s.cols) return s;
  if (!s.grid[id]) { s.message = '这里是墙。'; return s; }
  var r = Math.floor(id / s.cols), pr = Math.floor(s.pos / s.cols);
  var c = id % s.cols, pc = s.pos % s.cols;
  if (Math.abs(r - pr) + Math.abs(c - pc) !== 1) { s.message = '只能上下左右走一格。'; return s; }
  s.pos = id; s.moves++;
  s.message = solved(s) ? '走出迷宫！' : '继续找路。';
  return s;
}
function solve(s) {
  var q = [s.pos], prev = {}, seen = {}; seen[s.pos] = 1; prev[s.pos] = null;
  for (var qi = 0; qi < q.length; qi++) {
    var cur = q[qi], r = Math.floor(cur / s.cols), c = cur % s.cols, ns = [];
    if (r > 0) ns.push(cur - s.cols);
    if (r < s.rows - 1) ns.push(cur + s.cols);
    if (c > 0) ns.push(cur - 1);
    if (c < s.cols - 1) ns.push(cur + 1);
    for (var i = 0; i < ns.length; i++) {
      var nx = ns[i];
      if (!s.grid[nx] || seen[nx]) continue;
      seen[nx] = 1; prev[nx] = cur; q.push(nx);
      if (nx === s.goal) {
        var path = [], node = nx;
        while (node !== s.pos) { path.push(node); node = prev[node]; }
        return path.reverse();
      }
    }
  }
  return [];
}
function view(s) {
  var cells = [];
  for (var id = 0; id < s.rows * s.cols; id++) {
    var label = s.grid[id] ? '' : '▨', tone = s.grid[id] ? 'open' : 'wall';
    if (id === s.pos) { label = '你'; tone = 'player'; }
    else if (id === s.goal) { label = '终'; tone = 'goal'; }
    cells.push({ id: id, label: label, tone: tone, state: '' });
  }
  return {
    cols: s.cols, prompt: '从起点走到终点。', cells: cells, actions: [],
    notes: ['步数：' + s.moves], status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
