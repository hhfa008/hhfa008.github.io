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
var CAPS = VARIANT === 'b' ? [4, 7] : [3, 5];
var TARGET = VARIANT === 'b' ? 5 : 4;
function create(seed) {
  return { caps: CAPS.slice(), target: TARGET, amt: [0, 0], moves: 0, message: '通过装水、倒水和清空，量出目标水量。' };
}
function solved(s) { return s.amt[0] === s.target || s.amt[1] === s.target; }
function act(s, a) {
  if (solved(s) || !a || a.type !== 'action') return s;
  var id = a.id;
  if (id === 'fill0') s.amt[0] = s.caps[0];
  else if (id === 'fill1') s.amt[1] = s.caps[1];
  else if (id === 'empty0') s.amt[0] = 0;
  else if (id === 'empty1') s.amt[1] = 0;
  else if (id === 'pour01') {
    var move = Math.min(s.amt[0], s.caps[1] - s.amt[1]);
    s.amt[0] -= move; s.amt[1] += move;
  } else if (id === 'pour10') {
    var move2 = Math.min(s.amt[1], s.caps[0] - s.amt[0]);
    s.amt[1] -= move2; s.amt[0] += move2;
  } else { s.message = '未知操作。'; return s; }
  s.moves++;
  s.message = solved(s) ? '量出了 ' + s.target + ' 升！' : '继续量水。';
  return s;
}
function solve(s) {
  var start = '0,0', goal = null;
  var q = [start], prev = {}, via = {}; prev[start] = null;
  for (var qi = 0; qi < q.length; qi++) {
    var parts = q[qi].split(',').map(Number), a = parts[0], b = parts[1];
    if (a === s.target || b === s.target) { goal = q[qi]; break; }
    var next = [
      ['fill0', s.caps[0], b], ['fill1', a, s.caps[1]],
      ['empty0', 0, b], ['empty1', a, 0],
      ['pour01', a - Math.min(a, s.caps[1] - b), b + Math.min(a, s.caps[1] - b)],
      ['pour10', a + Math.min(b, s.caps[0] - a), b - Math.min(b, s.caps[0] - a)]
    ];
    for (var i = 0; i < next.length; i++) {
      var key = next[i][1] + ',' + next[i][2];
      if (prev[key] !== undefined) continue;
      prev[key] = q[qi]; via[key] = next[i][0]; q.push(key);
    }
  }
  if (!goal) return [];
  var path = [], node = goal;
  while (prev[node] !== null) { path.push(via[node]); node = prev[node]; }
  return path.reverse();
}
function view(s) {
  var cells = s.caps.map(function (cap, i) {
    return { id: i, label: s.amt[i] + ' / ' + cap + ' L', tone: s.amt[i] === s.target ? 'ok' : 'jug', state: '' };
  });
  var actions = [
    { id: 'fill0', label: '装满小壶' }, { id: 'fill1', label: '装满大壶' },
    { id: 'empty0', label: '倒空小壶' }, { id: 'empty1', label: '倒空大壶' },
    { id: 'pour01', label: '小壶倒大壶' }, { id: 'pour10', label: '大壶倒小壶' }
  ];
  return {
    cols: 2, prompt: '量出正好 ' + s.target + ' 升水。', cells: cells, actions: actions,
    notes: ['容量：' + s.caps.join('L / ') + 'L', '步数：' + s.moves],
    status: solved(s) ? 'win' : 'playing'
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
