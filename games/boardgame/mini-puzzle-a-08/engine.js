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
var ROWS = VARIANT === 'b' ? 6 : 5;
var COLS = VARIANT === 'b' ? 6 : 5;
var KEYCOUNT = VARIANT === 'b' ? 4 : 3;
var WALLRATE = VARIANT === 'b' ? 0.16 : 0.14;
function neighbors(id) {
  var r = Math.floor(id / COLS), c = id % COLS, out = [];
  if (r > 0) out.push(id - COLS);
  if (r < ROWS - 1) out.push(id + COLS);
  if (c > 0) out.push(id - 1);
  if (c < COLS - 1) out.push(id + 1);
  return out;
}
function bfs(walls, from, to) {
  if (from === to) return [];
  var q = [from], prev = {}, seen = {}; seen[from] = 1; prev[from] = null;
  for (var qi = 0; qi < q.length; qi++) {
    var cur = q[qi], ns = neighbors(cur);
    for (var i = 0; i < ns.length; i++) {
      var nx = ns[i];
      if (walls[nx] || seen[nx]) continue;
      seen[nx] = 1; prev[nx] = cur; q.push(nx);
      if (nx === to) {
        var path = [], node = nx;
        while (node !== from) { path.push(node); node = prev[node]; }
        return path.reverse();
      }
    }
  }
  return null;
}
function build(seed) {
  var r = rng(seed);
  for (var attempt = 0; attempt < 200; attempt++) {
    var walls = {};
    var start = 0, end = ROWS * COLS - 1;
    var used = {}; used[start] = 1; used[end] = 1;
    for (var c = 0; c < ROWS * COLS; c++) {
      if (used[c]) continue;
      if (r() < WALLRATE) walls[c] = 1;
    }
    walls[start] = 0; walls[end] = 0;
    var keys = [];
    var guard = 0;
    while (keys.length < KEYCOUNT && guard++ < 500) {
      var k = Math.floor(r() * ROWS * COLS);
      if (used[k] || walls[k]) continue;
      used[k] = 1; keys.push(k);
    }
    if (keys.length !== KEYCOUNT) continue;
    var cur = start, route = [], ok = true;
    for (var ki = 0; ki < keys.length; ki++) {
      var seg = bfs(walls, cur, keys[ki]);
      if (!seg) { ok = false; break; }
      route = route.concat(seg); cur = keys[ki];
    }
    if (!ok) continue;
    var lastSeg = bfs(walls, cur, end);
    if (!lastSeg) continue;
    route = route.concat(lastSeg);
    var keyOrder = {};
    keys.forEach(function (k, i) { keyOrder[k] = i + 1; });
    return { rows: ROWS, cols: COLS, walls: walls, keys: keyOrder, keyCount: KEYCOUNT, start: start, end: end, pos: start, collected: 0, moves: 0, message: '按 1→' + KEYCOUNT + ' 的顺序收集钥匙，再走到终点。', route: route };
  }
  return null;
}
function create(seed) { var s = build(seed); if (!s) throw new Error('无法生成地图'); return s; }
function solved(s) { return s.pos === s.end && s.collected === s.keyCount; }
function act(s, a) {
  if (solved(s)) return s;
  if (!a || a.type !== 'cell') return s;
  var id = a.id;
  if (s.walls[id]) { s.message = '墙不能走。'; return s; }
  if (neighbors(s.pos).indexOf(id) < 0) { s.message = '只能上下左右走一格。'; return s; }
  s.pos = id; s.moves++;
  var order = s.keys[id];
  if (order && order === s.collected + 1) { s.collected++; s.message = '捡到第 ' + order + ' 把钥匙。'; }
  else if (order && order > s.collected + 1) { s.message = '还得先找第 ' + (s.collected + 1) + ' 把钥匙。'; }
  else if (id === s.end && s.collected < s.keyCount) { s.message = '门还没开，先去集齐钥匙。'; }
  else { s.message = '继续探路。'; }
  if (solved(s)) s.message = '钥匙集齐，顺利送达！';
  return s;
}
function solve(s) {
  var cur = s.pos, out = [];
  for (var order = s.collected + 1; order <= s.keyCount; order++) {
    var target = null;
    for (var k in s.keys) if (s.keys[k] === order) target = Number(k);
    var seg = bfs(s.walls, cur, target);
    if (!seg) return [];
    out = out.concat(seg); cur = target;
  }
  var tail = bfs(s.walls, cur, s.end);
  if (!tail) return [];
  return out.concat(tail);
}
function view(s) {
  var cells = [];
  for (var id = 0; id < s.rows * s.cols; id++) {
    var label = '', tone = '', state = '';
    if (s.walls[id]) { label = '▨'; tone = 'wall'; }
    else if (id === s.pos) { label = '你'; tone = 'player'; state = 'sel'; }
    else if (id === s.end) { label = '终'; tone = 'goal'; }
    else if (s.keys[id]) { label = String(s.keys[id]); tone = s.keys[id] <= s.collected ? 'done' : 'key'; }
    cells.push({ id: id, label: label, tone: tone, state: state });
  }
  return {
    cols: s.cols, prompt: '按数字顺序捡钥匙，再去终点。', cells: cells, actions: [],
    notes: ['钥匙：' + s.collected + '/' + s.keyCount, '步数：' + s.moves],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
