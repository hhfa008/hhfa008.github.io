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
var N = VARIANT === 'b' ? 4 : 3;
var PEOPLE = VARIANT === 'b' ? ['阿禾', '小满', '阿澈', '青岚'] : ['阿禾', '小满', '阿澈'];
var ITEMS = VARIANT === 'b' ? ['红茶', '青团', '纸鸢', '木梳'] : ['红茶', '青团', '纸鸢'];
function perms(n) {
  var out = [];
  (function rec(arr) {
    if (arr.length === n) { out.push(arr.slice()); return; }
    for (var i = 0; i < n; i++) if (arr.indexOf(i) < 0) { arr.push(i); rec(arr); arr.pop(); }
  })([]);
  return out;
}
function labelOf(clue, assign) {
  if (clue.type === 'is') return PEOPLE[clue.p] + '拿的是' + ITEMS[clue.item];
  if (clue.type === 'not') return PEOPLE[clue.p] + '拿的不是' + ITEMS[clue.item];
  return PEOPLE[clue.p1] + '和' + PEOPLE[clue.p2] + '拿的是' + ITEMS[clue.i1] + '和' + ITEMS[clue.i2] + '（顺序未知）';
}
function checkClues(s, assign) {
  for (var i = 0; i < s.clues.length; i++) {
    var c = s.clues[i];
    if (c.type === 'is' && assign[c.p] !== c.item) return false;
    if (c.type === 'not' && assign[c.p] === c.item) return false;
    if (c.type === 'pair') {
      var a = assign[c.p1], b = assign[c.p2];
      if (!((a === c.i1 && b === c.i2) || (a === c.i2 && b === c.i1))) return false;
    }
  }
  return true;
}
function build(seed) {
  var r = rng(seed);
  var sol = shuffle([], r);
  sol = [];
  for (var i = 0; i < N; i++) sol.push(i);
  shuffle(sol, r);
  var pool = [];
  for (var p = 0; p < N; p++) pool.push({ type: 'is', p: p, item: sol[p] });
  for (p = 0; p < N; p++) for (var it = 0; it < N; it++) if (sol[p] !== it) pool.push({ type: 'not', p: p, item: it });
  for (var a = 0; a < N; a++) for (var b = a + 1; b < N; b++) {
    pool.push({ type: 'pair', p1: a, p2: b, i1: sol[a], i2: sol[b] });
  }
  shuffle(pool, r);
  var all = perms(N), clues = [], count = all.length;
  for (var ci = 0; ci < pool.length && count > 1; ci++) {
    var trial = clues.concat([pool[ci]]);
    var left = all.filter(function (asg) { return checkClues({ clues: trial }, asg); }).length;
    if (left < count) { clues = trial; count = left; }
  }
  for (p = 0; p < N && count > 1; p++) {
    var direct = { type: 'is', p: p, item: sol[p] };
    var trial2 = clues.concat([direct]);
    var left2 = all.filter(function (asg) { return checkClues({ clues: trial2 }, asg); }).length;
    if (left2 < count) { clues = trial2; count = left2; }
  }
  var state = { people: PEOPLE, items: ITEMS, clues: clues, solution: sol, assign: [], moves: 0, message: '轮换每个人的物品，让所有线索成立。' };
  for (i = 0; i < N; i++) state.assign.push((i + 1) % N);
  return state;
}
function create(seed) { return build(seed); }
function solved(s) {
  for (var i = 0; i < N; i++) if (s.assign[i] !== s.solution[i]) return false;
  return s.checked === true;
}
function act(s, a) {
  if (!a) return s;
  if (a.type === 'cell') {
    if (a.id < 0 || a.id >= N) return s;
    s.assign[a.id] = (s.assign[a.id] + 1) % N; s.moves++; s.checked = false;
    s.message = PEOPLE[a.id] + '现在拿' + ITEMS[s.assign[a.id]] + '。';
    return s;
  }
  if (a.type === 'action' && a.id === 'check') {
    if (checkClues(s, s.assign) && s.assign.join(',') === s.solution.join(',')) {
      s.checked = true; s.message = '全部线索成立，推理成功！';
    } else {
      s.checked = false; s.message = '还有线索不成立，再想想。';
    }
  }
  return s;
}
function solve(s) { return s.solution.slice(); }
function view(s) {
  var cells = s.assign.map(function (item, i) {
    return { id: i, label: PEOPLE[i] + '\n' + ITEMS[item], tone: 'person', state: '' };
  });
  var notes = s.clues.map(function (c) { return '• ' + labelOf(c, s.assign); });
  notes.push('点击人物可轮换物品；线索全部成立后点“核对”。');
  return {
    cols: N <= 3 ? 3 : 2, prompt: '根据线索判断每个人拿的物品。', cells: cells,
    actions: [{ id: 'check', label: '核对答案' }], notes: notes,
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve, checkClues: checkClues };
});
