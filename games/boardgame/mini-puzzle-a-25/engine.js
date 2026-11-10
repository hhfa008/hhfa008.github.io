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
var CAP = 3;
var COLORS = ['A', 'B', 'C'];
var TUBES = 4;
function solvedTubes(tubes) {
  for (var i = 0; i < tubes.length; i++) {
    var t = tubes[i];
    if (!t.length) continue;
    for (var j = 1; j < t.length; j++) if (t[j] !== t[0]) return false;
  }
  return true;
}
function clone(tubes) { return tubes.map(function (t) { return t.slice(); }); }
function pourOk(tubes, from, to) {
  if (from === to) return false;
  var src = tubes[from], dst = tubes[to];
  if (!src || !src.length) return false;
  if (dst.length >= CAP) return false;
  if (dst.length && dst[dst.length - 1] !== src[src.length - 1]) return false;
  return true;
}
function doPour(tubes, from, to) {
  if (!pourOk(tubes, from, to)) return tubes;
  var src = tubes[from], dst = tubes[to], color = src[src.length - 1], moved = 0;
  while (src.length && src[src.length - 1] === color && dst.length < CAP) { dst.push(src.pop()); moved++; }
  return tubes;
}
function key(tubes) { return tubes.map(function (t) { return t.join(''); }).join('|'); }
function solve(s) {
  var start = clone(s.tubes);
  if (solvedTubes(start)) return [];
  var q = [start], prev = {}, via = {}, seen = {}; seen[key(start)] = 1; prev[key(start)] = null;
  for (var qi = 0; qi < q.length; qi++) {
    var cur = q[qi];
    for (var from = 0; from < cur.length; from++) {
      for (var to = 0; to < cur.length; to++) {
        if (!pourOk(cur, from, to)) continue;
        var next = clone(cur); doPour(next, from, to);
        var k = key(next);
        if (seen[k]) continue;
        seen[k] = 1; prev[k] = key(cur); via[k] = [from, to]; q.push(next);
        if (solvedTubes(next)) {
          var path = [], node = k;
          while (prev[node] !== null) { path.push(via[node]); node = prev[node]; }
          return path.reverse();
        }
      }
    }
  }
  return [];
}
function build(seed) {
  var r = rng(seed);
  for (var attempt = 0; attempt < 100; attempt++) {
    var bag = [];
    for (var c = 0; c < COLORS.length; c++) { bag.push(COLORS[c]); bag.push(COLORS[c]); }
    shuffle(bag, r);
    var tubes = [[], [], [], []];
    for (var i = 0; i < bag.length; i++) tubes[Math.floor(i / CAP)].push(bag[i]);
    if (solvedTubes(tubes)) continue;
    var st = { tubes: tubes, cap: CAP, sel: null, moves: 0, message: '点击一管液体，再点目标管倒过去。' };
    if (solve(st).length) return st;
  }
  return null;
}
function create(seed) { var s = build(seed); if (!s) throw new Error('无法生成液体谜题'); return s; }
function solved(s) { return solvedTubes(s.tubes); }
function act(s, a) {
  if (solved(s) || !a) return s;
  if (a.type === 'pour') {
    if (pourOk(s.tubes, a.from, a.to)) { doPour(s.tubes, a.from, a.to); s.sel = null; s.moves++; s.message = solved(s) ? '颜色全部分层！' : '继续倒液。'; }
    else s.message = '只能倒到空管或相同颜色的顶部，且不能超过容量。';
    return s;
  }
  if (a.type !== 'cell') return s;
  var id = a.id;
  if (s.sel === null) {
    if (!s.tubes[id].length) { s.message = '这一管是空的。'; return s; }
    s.sel = id; s.message = '已选中第 ' + (id + 1) + ' 管，再点目标管。'; return s;
  }
  if (s.sel === id) { s.sel = null; s.message = '已取消选择。'; return s; }
  var from = s.sel;
  if (!pourOk(s.tubes, from, id)) { s.message = '倒不过去：颜色不同或目标已满。'; s.sel = null; return s; }
  doPour(s.tubes, from, id); s.sel = null; s.moves++;
  s.message = solved(s) ? '颜色全部分层！' : '继续倒液。';
  return s;
}
function view(s) {
  var cells = s.tubes.map(function (t, i) {
    return { id: i, label: t.slice().reverse().join('\n') || '空', tone: 'tube', state: s.sel === i ? 'sel' : '' };
  });
  return {
    cols: 4, prompt: '把同色液体都倒进同一根试管。', cells: cells, actions: [],
    notes: ['每管容量 ' + s.cap + ' 格', '步数：' + s.moves],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
