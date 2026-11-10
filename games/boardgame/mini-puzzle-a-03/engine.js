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
var ROWS = VARIANT === 'b' ? 2 : 3;
var COLS = VARIANT === 'b' ? 3 : 3;
var N = ROWS * COLS;
function labels() {
  var arr = [];
  for (var i = 0; i < N - 1; i++) arr.push(VARIANT === 'b' ? String.fromCharCode(65 + i) : String(i + 1));
  arr.push('');
  return arr;
}
function adjacent(a, b) {
  var ra = Math.floor(a / COLS), ca = a % COLS, rb = Math.floor(b / COLS), cb = b % COLS;
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}
function solvedArr(arr) {
  for (var i = 0; i < N - 1; i++) if (arr[i] !== i + 1) return false;
  return arr[N - 1] === 0;
}
function create(seed) {
  var r = rng(seed);
  var arr = [];
  for (var i = 1; i < N; i++) arr.push(i);
  arr.push(0);
  var blank = N - 1, last = -1, depth = VARIANT === 'b' ? 10 : 16;
  for (var k = 0; k < depth; k++) {
    var ns = [];
    var rr = Math.floor(blank / COLS), cc = blank % COLS;
    if (rr > 0) ns.push(blank - COLS);
    if (rr < ROWS - 1) ns.push(blank + COLS);
    if (cc > 0) ns.push(blank - 1);
    if (cc < COLS - 1) ns.push(blank + 1);
    ns = ns.filter(function (x) { return x !== last; });
    var pick = ns[Math.floor(r() * ns.length)];
    arr[blank] = arr[pick]; arr[pick] = 0; last = blank; blank = pick;
  }
  if (solvedArr(arr)) { var t = arr[0]; arr[0] = arr[1]; arr[1] = t; }
  return { tiles: arr, rows: ROWS, cols: COLS, moves: 0, message: '点击空格旁的数字滑动。' };
}
function solved(s) { return solvedArr(s.tiles); }
function act(s, a) {
  if (!a || a.type !== 'cell') return s;
  var id = a.id, blank = s.tiles.indexOf(0);
  if (id < 0 || id >= N || !adjacent(id, blank)) { s.message = '只能滑动空格旁边的块。'; return s; }
  s.tiles[blank] = s.tiles[id]; s.tiles[id] = 0; s.moves++;
  s.message = solved(s) ? '归位完成！' : '继续滑动。';
  return s;
}
function solve(s) {
  var start = s.tiles.join(',');
  var goal = [];
  for (var i = 1; i < N; i++) goal.push(i);
  goal.push(0); goal = goal.join(',');
  if (start === goal) return [];
  var q = [start], prev = {}, move = {};
  prev[start] = null;
  for (var qi = 0; qi < q.length; qi++) {
    var cur = q[qi], arr = cur.split(',').map(Number), blank = arr.indexOf(0);
    var br = Math.floor(blank / COLS), bc = blank % COLS, ns = [];
    if (br > 0) ns.push(blank - COLS);
    if (br < ROWS - 1) ns.push(blank + COLS);
    if (bc > 0) ns.push(blank - 1);
    if (bc < COLS - 1) ns.push(blank + 1);
    for (var ni = 0; ni < ns.length; ni++) {
      var id = ns[ni], next = arr.slice();
      next[blank] = next[id]; next[id] = 0;
      var key = next.join(',');
      if (prev[key] !== undefined) continue;
      prev[key] = cur; move[key] = id;
      if (key === goal) {
        var path = [], node = key;
        while (prev[node] !== null) { path.push(move[node]); node = prev[node]; }
        return path.reverse();
      }
      q.push(key);
    }
  }
  return [];
}
function view(s) {
  var L = labels();
  var cells = s.tiles.map(function (v, i) { return { id: i, label: L[v], tone: v === 0 ? 'blank' : '', state: v === 0 ? 'blank' : '' }; });
  return {
    cols: COLS, prompt: '把滑块按顺序归位，空格在最后。', cells: cells, actions: [],
    notes: ['步数：' + s.moves, '目标顺序：' + L.slice(0, N - 1).join(' ')],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
