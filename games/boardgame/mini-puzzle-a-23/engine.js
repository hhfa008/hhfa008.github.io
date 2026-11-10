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
var TARGET = 24;
var OPS = VARIANT === 'b' ? ['+', '-', '*'] : ['+', '-', '*', '/'];
function calc(a, b, op) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b !== 0 && a % b === 0 ? a / b : null;
  return null;
}
function search(nums, ops, target, depth) {
  if (nums.length === 1) return nums[0].value === target ? [] : null;
  for (var i = 0; i < nums.length; i++) {
    for (var j = 0; j < nums.length; j++) {
      if (i === j) continue;
      for (var oi = 0; oi < ops.length; oi++) {
        var op = ops[oi], val = calc(nums[i].value, nums[j].value, op);
        if (val === null) continue;
        var rest = [], newId = 100 + depth;
        for (var k = 0; k < nums.length; k++) if (k !== i && k !== j) rest.push(nums[k]);
        rest.push({ id: newId, value: val });
        var sub = search(rest, ops, target, depth + 1);
        if (sub) return [[nums[i].id, nums[j].id, op]].concat(sub);
      }
    }
  }
  return null;
}
function create(seed) {
  var r = rng(seed);
  for (var attempt = 0; attempt < 200; attempt++) {
    var nums = [];
    for (var i = 0; i < 4; i++) nums.push({ id: i, value: 1 + Math.floor(r() * 9) });
    var steps = search(nums, OPS, TARGET, 0);
    if (steps && steps.length === 3) {
      return { nums: nums, target: TARGET, ops: OPS.slice(), selected: [], history: [], moves: 0, message: '选两个数字，再选运算符合成新数。' };
    }
  }
  return { nums: [{ id: 0, value: 6 }, { id: 1, value: 6 }, { id: 2, value: 6 }, { id: 3, value: 6 }], target: TARGET, ops: OPS.slice(), selected: [], history: [], moves: 0, message: '选两个数字，再选运算符。' };
}
function solved(s) { return s.nums.length === 1 && s.nums[0].value === s.target; }
function find(s, id) { for (var i = 0; i < s.nums.length; i++) if (s.nums[i].id === id) return s.nums[i]; return null; }
function act(s, a) {
  if (solved(s) || !a) return s;
  if (a.type === 'cell') {
    if (!find(s, a.id)) return s;
    var at = s.selected.indexOf(a.id);
    if (at >= 0) s.selected.splice(at, 1);
    else if (s.selected.length < 2) s.selected.push(a.id);
    else { s.selected = [s.selected[1], a.id]; }
    s.message = s.selected.length === 2 ? '再选一个运算符。' : '再选一个数字。';
    return s;
  }
  if (a.type === 'action' && s.ops.indexOf(a.id) >= 0) {
    if (s.selected.length !== 2) { s.message = '先选两个数字。'; return s; }
    var x = find(s, s.selected[0]), y = find(s, s.selected[1]);
    var val = calc(x.value, y.value, a.id);
    if (val === null) { s.message = '这个除法不整除，换一种。'; return s; }
    var rest = s.nums.filter(function (n) { return n.id !== x.id && n.id !== y.id; });
    rest.push({ id: 100 + s.history.length, value: val });
    s.history.push(x.value + ' ' + a.id + ' ' + y.value + ' = ' + val);
    s.nums = rest; s.selected = []; s.moves++;
    s.message = solved(s) ? '正好凑出 ' + s.target + '！' : '继续合成。';
    return s;
  }
  return s;
}
function solve(s) { return search(s.nums.slice(), s.ops.slice(), s.target, s.history.length) || []; }
function view(s) {
  var cells = s.nums.map(function (n) {
    return { id: n.id, label: String(n.value), tone: 'num', state: s.selected.indexOf(n.id) >= 0 ? 'sel' : '' };
  });
  var actions = s.ops.map(function (op) { return { id: op, label: op }; });
  return {
    cols: 4, prompt: '用四个数合成 ' + s.target + '，每步任选两数。', cells: cells, actions: actions,
    notes: s.history.concat(['可用运算：' + s.ops.join(' '), '所选：' + s.selected.map(function (id) { var n = find(s, id); return n ? n.value : '?'; }).join(' 和 ')]),
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
