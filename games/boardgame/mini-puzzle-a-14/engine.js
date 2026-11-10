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
var DISKS = VARIANT === 'b' ? 4 : 3;
function create(seed) {
  var pegs = [[], [], []];
  for (var d = DISKS; d >= 1; d--) pegs[0].push(d);
  return { pegs: pegs, disks: DISKS, sel: null, moves: 0, message: '每次移动最上面的一块，大盘不能压小盘。' };
}
function solved(s) { return s.pegs[2].length === s.disks; }
function top(peg) { return peg.length ? peg[peg.length - 1] : 0; }
function act(s, a) {
  if (solved(s) || !a || a.type !== 'cell') return s;
  var id = a.id;
  if (id < 0 || id > 2) return s;
  if (s.sel === null) {
    if (!s.pegs[id].length) { s.message = '这根柱子是空的。'; return s; }
    s.sel = id; s.message = '已拿起第 ' + id + ' 根柱子顶端的盘，再点目标柱。'; return s;
  }
  if (s.sel === id) { s.sel = null; s.message = '已放回。'; return s; }
  var from = s.sel, disk = top(s.pegs[from]);
  if (s.pegs[id].length && top(s.pegs[id]) < disk) {
    s.message = '小盘不能放在大盘上面。'; s.sel = null; return s;
  }
  s.pegs[from].pop(); s.pegs[id].push(disk); s.sel = null; s.moves++;
  s.message = solved(s) ? '高塔搬完！' : '继续搬盘。';
  return s;
}
function solve(s) {
  var out = [];
  function rec(n, from, to, via) {
    if (!n) return;
    rec(n - 1, from, via, to);
    out.push([from, to]);
    rec(n - 1, via, to, from);
  }
  rec(s.disks, 0, 2, 1);
  return out;
}
function view(s) {
  var cells = s.pegs.map(function (peg, i) {
    return { id: i, label: peg.length ? peg.join('') : '空', tone: 'peg', state: s.sel === i ? 'sel' : '' };
  });
  return {
    cols: 3, prompt: '把全部圆盘从最左柱移到最右柱。', cells: cells, actions: [],
    notes: ['步数：' + s.moves + ' / 最少 ' + (Math.pow(2, s.disks) - 1) + ' 步', '盘号越大越宽'],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
