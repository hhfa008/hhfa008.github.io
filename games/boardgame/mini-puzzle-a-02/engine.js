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
var N = VARIANT === 'b' ? 7 : 6;
var DESC = VARIANT === 'b';
function create(seed) {
  var r = rng(seed);
  var tiles = [];
  for (var i = 1; i <= N; i++) tiles.push(i);
  shuffle(tiles, r);
  var target = tiles.slice().sort(function (a, b) { return DESC ? b - a : a - b; });
  if (tiles.join(',') === target.join(',')) { var t = tiles[0]; tiles[0] = tiles[1]; tiles[1] = t; }
  return { tiles: tiles, target: target, moves: 0, sel: null, message: '点击两块相邻数字交换位置。' };
}
function solved(s) { return s.tiles.join(',') === s.target.join(','); }
function swap(s, i, j) {
  if (solved(s)) return s;
  if (i < 0 || j < 0 || i >= s.tiles.length || j >= s.tiles.length || Math.abs(i - j) !== 1) {
    s.message = '只能交换相邻的两块。'; return s;
  }
  var t = s.tiles[i]; s.tiles[i] = s.tiles[j]; s.tiles[j] = t;
  s.moves++; s.sel = null;
  s.message = solved(s) ? '排序完成！' : '继续调整。';
  return s;
}
function act(s, a) {
  if (!a) return s;
  if (a.type === 'swap') return swap(s, a.i, a.j);
  if (a.type !== 'cell') return s;
  if (s.sel === null) { s.sel = a.id; s.message = '再点相邻的一块交换。'; return s; }
  if (s.sel === a.id) { s.sel = null; s.message = '已取消选择。'; return s; }
  return swap(s, s.sel, a.id);
}
function solve(s) {
  var work = s.tiles.slice(), out = [];
  for (var pos = 0; pos < work.length; pos++) {
    var want = s.target[pos];
    var at = work.indexOf(want);
    while (at > pos) { out.push([at - 1, at]); var t = work[at - 1]; work[at - 1] = work[at]; work[at] = t; at--; }
  }
  return out;
}
function view(s) {
  var cells = s.tiles.map(function (v, i) {
    return { id: i, label: String(v), tone: v === s.target[i] ? 'ok' : '', state: s.sel === i ? 'sel' : '' };
  });
  return {
    cols: 3, prompt: DESC ? '把数字从大到小排好（只能交换相邻两块）。' : '把数字从小到大排好（只能交换相邻两块）。',
    cells: cells, actions: [], notes: ['目标：' + s.target.join(' → '), '步数：' + s.moves],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve, legal: function (s, i, j) { return Math.abs(i - j) === 1; } };
});
