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
var MODE = VARIANT === 'c' ? 'fib' : (VARIANT === 'b' ? 'mul' : 'add');
function create(seed) {
  var r = rng(seed), seq = [], i;
  if (MODE === 'add') {
    var a = 2 + Math.floor(r() * 8), d = 2 + Math.floor(r() * 6);
    for (i = 0; i < 5; i++) seq.push(a + d * i);
  } else if (MODE === 'mul') {
    var b = 1 + Math.floor(r() * 4), q = 2 + Math.floor(r() * 2);
    for (i = 0; i < 5; i++) seq.push(b * Math.pow(q, i));
  } else {
    var f0 = 1 + Math.floor(r() * 4), f1 = f0 + 1 + Math.floor(r() * 3);
    seq.push(f0); seq.push(f1);
    for (i = 2; i < 5; i++) seq.push(seq[i - 1] + seq[i - 2]);
  }
  var answer = seq[4], opts = [answer];
  var deltas = [answer + 1, answer - 1, answer + 2, answer * 2, answer - 3];
  var di = 0;
  while (opts.length < 4 && di < deltas.length) {
    if (opts.indexOf(deltas[di]) < 0 && deltas[di] > 0) opts.push(deltas[di]);
    di++;
  }
  while (opts.length < 4) opts.push(answer + opts.length + 1);
  shuffle(opts, r);
  var names = { add: '等差', mul: '等比', fib: '递推' };
  return { seq: seq, mode: MODE, modeName: names[MODE], options: opts, answer: answer, picked: null, moves: 0, message: '找出规律，选择下一项。' };
}
function solved(s) { return s.picked === s.answer; }
function act(s, a) {
  if (solved(s) || !a || (a.type !== 'choice' && a.type !== 'cell')) return s;
  if (a.id < 0 || a.id >= s.options.length) return s;
  s.picked = s.options[a.id]; s.moves++;
  s.message = s.picked === s.answer ? '规律找对了！' : '不对，再观察相邻项的差或倍数。';
  return s;
}
function solve(s) { return s.answer; }
function view(s) {
  var cells = s.options.map(function (v, i) {
    return { id: i, label: String(v), tone: s.picked === null ? '' : (v === s.answer ? 'ok' : (s.picked === v ? 'bad' : '')), state: '' };
  });
  return {
    cols: 2, prompt: '数列：' + s.seq.slice(0, 4).join('，') + '，？', cells: cells, actions: [],
    notes: ['题型：' + s.modeName + '规律', '选择下一项'],
    status: solved(s) ? 'win' : (s.picked === null ? 'playing' : 'lose')
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
