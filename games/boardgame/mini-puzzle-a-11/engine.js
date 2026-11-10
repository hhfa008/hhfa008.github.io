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
var NAMES = ['fox', 'goose', 'beans'];
var LABELS = { fox: '狐狸', goose: '鹅', beans: '豆袋' };
function danger(mask, farmer) {
  var left = (mask & 1 ? 'fox,' : '') + (mask & 2 ? 'goose,' : '') + (mask & 4 ? 'beans,' : '');
  var right = (mask & 1 ? '' : 'fox,') + (mask & 2 ? '' : 'goose,') + (mask & 4 ? '' : 'beans,');
  var unattended = farmer === 0 ? right : left;
  if (unattended.indexOf('fox,') >= 0 && unattended.indexOf('goose,') >= 0) return true;
  if (unattended.indexOf('goose,') >= 0 && unattended.indexOf('beans,') >= 0) return true;
  return false;
}
function create(seed) {
  return { mask: 7, farmer: 0, moves: 0, lost: false, message: '船夫每次只能带一样东西（或空船）过河。' };
}
function solved(s) { return s.mask === 0 && s.farmer === 1 && !s.lost; }
function act(s, a) {
  if (!a || a.type !== 'action' || solved(s) || s.lost) return s;
  var item = a.id;
  if (item === 'alone') {
    s.farmer = 1 - s.farmer; s.moves++;
  } else {
    var bit = item === 'fox' ? 1 : (item === 'goose' ? 2 : 4);
    var onFarmerSide = s.farmer === 0 ? (s.mask & bit) !== 0 : (s.mask & bit) === 0;
    if (NAMES.indexOf(item) < 0) return s;
    if (!onFarmerSide) { s.message = LABELS[item] + '不在船夫这一岸。'; return s; }
    s.mask = s.mask ^ bit; s.farmer = 1 - s.farmer; s.moves++;
  }
  if (danger(s.mask, s.farmer)) { s.lost = true; s.message = '无人看管的一岸发生了冲突，过河失败。'; return s; }
  s.message = solved(s) ? '全部安全过河！' : '继续摆渡，注意别让天敌单独相处。';
  return s;
}
function solve() {
  var start = '7,0', goal = '0,1';
  var q = [start], prev = {}, via = {}; prev[start] = null;
  for (var qi = 0; qi < q.length; qi++) {
    var parts = q[qi].split(','), mask = Number(parts[0]), farmer = Number(parts[1]);
    var moves = ['alone'];
    for (var i = 0; i < NAMES.length; i++) {
      var bit = 1 << i;
      var onSide = farmer === 0 ? (mask & bit) !== 0 : (mask & bit) === 0;
      if (onSide) moves.push(NAMES[i]);
    }
    for (var mi = 0; mi < moves.length; mi++) {
      var item = moves[mi], nm = mask, nf = 1 - farmer;
      if (item !== 'alone') { var b = item === 'fox' ? 1 : (item === 'goose' ? 2 : 4); nm = mask ^ b; }
      if (danger(nm, nf)) continue;
      var key = nm + ',' + nf;
      if (prev[key] !== undefined) continue;
      prev[key] = q[qi]; via[key] = item; q.push(key);
      if (key === goal) {
        var path = [], node = key;
        while (prev[node] !== null) { path.push(via[node]); node = prev[node]; }
        return path.reverse();
      }
    }
  }
  return [];
}
function view(s) {
  var left = [], right = [];
  for (var i = 0; i < NAMES.length; i++) {
    var bit = 1 << i, onLeft = (s.mask & bit) !== 0;
    (onLeft ? left : right).push(LABELS[NAMES[i]]);
  }
  var actions = [];
  for (i = 0; i < NAMES.length; i++) {
    var name = NAMES[i], b = 1 << i;
    var available = s.farmer === 0 ? (s.mask & b) !== 0 : (s.mask & b) === 0;
    actions.push({ id: name, label: '带' + LABELS[name] + (s.farmer === 0 ? '过河' : '返回'), disabled: !available });
  }
  actions.push({ id: 'alone', label: '空船' + (s.farmer === 0 ? '过河' : '返回') });
  return {
    cols: 2, prompt: '把狐狸、鹅和豆袋安全运到对岸。', cells: [], actions: actions,
    notes: ['左岸：' + (left.length ? left.join('、') : '空'), '右岸：' + (right.length ? right.join('、') : '空'), '船夫在' + (s.farmer === 0 ? '左岸' : '右岸'), '步数：' + s.moves],
    status: solved(s) ? 'win' : (s.lost ? 'lose' : 'playing')
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve };
});
