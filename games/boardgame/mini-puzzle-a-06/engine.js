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
var LEN = VARIANT === 'b' ? 4 : 3;
var COLORS = 4;
var MAX = VARIANT === 'b' ? 10 : 8;
function create(seed) {
  var r = rng(seed), secret = [];
  for (var i = 0; i < LEN; i++) secret.push(Math.floor(r() * COLORS));
  return { secret: secret, guess: [], attempts: [], max: MAX, len: LEN, lost: false, message: '猜出隐藏数字，提交后看反馈。' };
}
function feedback(secret, guess) {
  var exact = 0, sc = [0, 0, 0, 0], gc = [0, 0, 0, 0];
  for (var i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++; else { sc[secret[i]]++; gc[guess[i]]++; }
  }
  var partial = 0;
  for (var c = 0; c < COLORS; c++) partial += Math.min(sc[c], gc[c]);
  return { exact: exact, partial: partial };
}
function solved(s) { return s.attempts.length > 0 && s.attempts[s.attempts.length - 1].exact === LEN; }
function act(s, a) {
  if (!a) return s;
  if (a.type === 'digit') {
    if (solved(s) || s.lost) return s;
    if (a.d < 0 || a.d >= COLORS) { s.message = '数字超出范围。'; return s; }
    if (s.guess.length >= LEN) { s.message = '这一行已填满，先提交或清空。'; return s; }
    s.guess.push(a.d); s.message = '继续填写，或提交。'; return s;
  }
  if (a.type === 'action' && a.id === 'clear') { s.guess = []; s.message = '已清空本行。'; return s; }
  if (a.type === 'action' && a.id === 'submit') {
    if (solved(s) || s.lost) return s;
    if (s.guess.length !== LEN) { s.message = '要填满 ' + LEN + ' 位才能提交。'; return s; }
    var fb = feedback(s.secret, s.guess);
    s.attempts.push({ guess: s.guess.slice(), exact: fb.exact, partial: fb.partial });
    s.guess = [];
    if (fb.exact === LEN) { s.message = '密码破解！'; return s; }
    if (s.attempts.length >= MAX) { s.lost = true; s.message = '机会用尽，密码是 ' + s.secret.join('') + '。'; return s; }
    s.message = '位置正确 ' + fb.exact + '，数字正确但位置不对 ' + fb.partial + '。';
    return s;
  }
  return s;
}
function solve(s) {
  var total = Math.pow(COLORS, LEN), code = null;
  for (var n = 0; n < total; n++) {
    var x = n, cand = [];
    for (var i = 0; i < LEN; i++) { cand.push(x % COLORS); x = Math.floor(x / COLORS); }
    var good = true;
    for (var j = 0; j < s.attempts.length; j++) {
      var fb = feedback(cand, s.attempts[j].guess);
      if (fb.exact !== s.attempts[j].exact || fb.partial !== s.attempts[j].partial) { good = false; break; }
    }
    if (good) { code = cand; break; }
  }
  return code || s.secret.slice();
}
function view(s) {
  var cells = [];
  for (var i = 0; i < LEN; i++) cells.push({ id: 'slot' + i, label: s.guess[i] === undefined ? '·' : String(s.guess[i]), tone: 'slot', state: '' });
  var actions = [];
  for (var d = 0; d < COLORS; d++) actions.push({ id: String(d), label: String(d), action: 'digit', d: d });
  actions.push({ id: 'clear', label: '清空' });
  actions.push({ id: 'submit', label: '提交' });
  var notes = s.attempts.map(function (a, i) {
    return '第 ' + (i + 1) + ' 次：' + a.guess.join('') + ' → 位置 ' + a.exact + '，数字 ' + a.partial;
  });
  notes.push('剩余机会：' + (s.max - s.attempts.length));
  return {
    cols: LEN, prompt: '猜出 ' + LEN + ' 位隐藏数字（每位 0–3，可重复）。', cells: cells, actions: actions, notes: notes,
    status: solved(s) ? 'win' : (s.lost ? 'lose' : 'playing')
  };
}
return { create: create, view: view, act: act, solved: solved, solve: solve, feedback: feedback };
});
