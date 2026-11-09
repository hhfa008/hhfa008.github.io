'use strict';

// Backgammon test. Engine lives in ENGINE START..END inside index.html.

var lib = require('../tests/lib.js');
var s = lib.suite('backgammon');

var html = lib.page(__dirname);
var B = lib.evalBetween(html, '/* === ENGINE START === */', '/* === ENGINE END === */', 'BG');

function blank(turn, dice) {
  var p = [], i;
  for (i = 0; i < 24; i++) p.push(0);
  return { points: p, bar: [0, 0], off: [0, 0], turn: turn || B.WHITE, dice: dice || [], rolled: [], over: false, winner: 0 };
}
function at(points) {
  var st = blank(), i;
  for (i = 0; i < 24; i++) if (points[i] != null) st.points[i] = points[i];
  return st;
}
function sum(side, st) {
  var n = 0, i;
  for (i = 0; i < 24; i++) {
    if (side > 0 && st.points[i] > 0) n += st.points[i];
    if (side < 0 && st.points[i] < 0) n += -st.points[i];
  }
  return n;
}
function hasMove(ms, from, to, die) {
  return ms.some(function (m) {
    return m.from === from && m.to === to && (die == null || m.die === die);
  });
}
function legal(st, m) {
  return B.legalMoves(st).some(function (x) {
    return x.from === m.from && x.to === m.to && x.die === m.die;
  });
}

s.group('初始摆法', function () {
  var st = B.setup();
  s.eq('24 个棋位', st.points.length, 24);
  s.eq('白方 1 点 2 枚', st.points[0], 2);
  s.eq('白方 12 点 5 枚', st.points[11], 5);
  s.eq('白方 17 点 3 枚', st.points[16], 3);
  s.eq('白方 19 点 5 枚', st.points[18], 5);
  s.eq('黑方 24 点 2 枚', st.points[23], -2);
  s.eq('黑方 13 点 5 枚', st.points[12], -5);
  s.eq('黑方 8 点 3 枚', st.points[7], -3);
  s.eq('黑方 6 点 5 枚', st.points[5], -5);
  s.eq('白方共 15 枚', sum(1, st), 15);
  s.eq('黑方共 15 枚', sum(-1, st), 15);
  s.eq('总数 30 枚', sum(1, st) + sum(-1, st), 30);
  s.eq('白方 pip 208', B.pip(st, B.WHITE), 208);
  s.eq('黑方 pip 208', B.pip(st, B.BLACK), 208);
  s.eq('bar 全空', st.bar, [0, 0]);
  s.eq('off 全空', st.off, [0, 0]);
  s.eq('白先', st.turn, B.WHITE);
  s.eq('白方内盘 1 点已有 2 枚', st.points[0], 2);
  s.ok('白方内盘 2–5 点开局为空', st.points.slice(1, 5).every(function (v) { return v === 0; }));
});

s.group('走法合法性', function () {
  // 1) 封闭点：两枚黑子占住落点，白方不能落。
  var a = at({ 10: 1, 7: -2 });
  a.dice = [3, 2];
  var am = B.legalMoves(a);
  s.ok('封闭点不能落子', !hasMove(am, 10, 7), JSON.stringify(am));
  s.ok('同一点的另一骰点仍可走', hasMove(am, 10, 8, 2), JSON.stringify(am));

  // 2) bar 未清空：只能从 bar 复活，不能动棋盘上的子。
  var b = at({ 19: 1 });
  b.bar[0] = 1;
  b.dice = [2, 5];
  var bm = B.legalMoves(b);
  s.ok('bar 有子时只能走 bar', bm.length > 0 && bm.every(function (m) { return m.from === 'bar'; }), JSON.stringify(bm));
  s.ok('bar 复活按骰点进对方内盘', hasMove(bm, 'bar', 22, 2) && hasMove(bm, 'bar', 19, 5), JSON.stringify(bm));
  var b2 = B.applyMove(b, bm[0]);
  s.eq('复活后 bar 减少', b2.bar[0], 0);
  s.ok('复活后可以走普通子', b2.dice.length === 1 && B.legalMoves(b2).every(function (m) { return m.from !== 'bar'; }));

  // 3) 非双骰每个点数只能用一次。
  var c = at({ 19: 1 });
  c.dice = [5, 2];
  var c1 = B.applyMove(c, B.legalMoves(c).filter(function (m) { return m.die === 5; })[0]);
  s.eq('用掉 5 后只剩 2', c1.dice, [2]);
  s.ok('5 不能再用', !B.legalMoves(c1).some(function (m) { return m.die === 5; }));
  var c2 = B.applyMove(c1, B.legalMoves(c1)[0]);
  s.eq('两骰都用完后无骰', c2.dice, []);
  s.eq('双骰生成 4 次移动', B.rollDice(function () { return 0.5; }), [4, 4, 4, 4]);
  var dbl = at({ 10: 1 });
  dbl.dice = [2, 2, 2, 2];
  s.eq('双骰最多走 4 步', B.allSequences(dbl)[0].length, 4);

  // 4) 落在对方单子上：吃子进 bar。
  var e = at({ 9: 1, 7: -1 });
  e.dice = [2];
  var em = B.legalMoves(e);
  var afterHit = B.applyMove(e, em[0]);
  s.eq('blot 被吃进黑方 bar', afterHit.bar[1], 1);
  s.eq('落点变成白方 1 枚', afterHit.points[7], 1);

  // 5) 黑方对称：封闭点与 bar 复活方向。
  var f = blank(B.BLACK, [2, 3]);
  f.points[4] = -1;   // 黑方 5 点
  f.points[7] = 2;    // 白方双子在 8 点
  f.bar[1] = 1;       // 黑方有子被吃
  var fm = B.legalMoves(f);
  s.ok('黑方 bar 未清时只能复活', fm.length > 0 && fm.every(function (m) { return m.from === 'bar'; }), JSON.stringify(fm));
  s.ok('黑方按骰点进白方内盘', hasMove(fm, 'bar', 1, 2) && hasMove(fm, 'bar', 2, 3), JSON.stringify(fm));
  var g = blank(B.BLACK, [2]);
  g.points[20] = -1;
  g.points[22] = 2;
  s.ok('黑方不能落在白方双子点', !hasMove(B.legalMoves(g), 20, 22, 2));
});

s.group('必须走满', function () {
  // 只有一种点数可用：die 2 可以收子，die 1 被封闭。
  var a = at({ 1: 1, 0: -2 });
  a.dice = [2, 1];
  var as = B.allSequences(a);
  s.eq('只有一种点数可用时只返回该序列', as.length, 1);
  s.eq('合法序列使用 die 2', as[0][0].die, 2);
  s.ok('系统不提供 die 1', !B.legalMoves(a).some(function (m) { return m.die === 1; }));
  var a2 = B.applyMove(a, as[0][0]);
  s.eq('收子后 off 增加', a2.off[0], 1);

  // 两种点数都单独可走、但不能同时走：必须用大的。
  var b = blank(B.WHITE, [3, 5]);
  b.points[0] = 1;   // 1 点，3 或 5 都能直接收子
  var bs = B.allSequences(b);
  s.eq('只能走一骰时只有一条序列', bs.length, 1);
  s.eq('必须用较大的 5', bs[0][0].die, 5);
  s.ok('较小点 3 被强制排除', B.legalMoves(b).every(function (m) { return m.die === 5; }));

  // 两骰可同时使用时，不允许只走一骰。
  var c = at({ 6: 1, 0: 1 });
  c.dice = [6, 1];
  var cs = B.allSequences(c);
  s.eq('可走两骰时最大序列长度为 2', cs[0].length, 2);
  s.ok('所有序列都用满两骰', cs.every(function (seq) { return seq.length === 2; }));
  s.eq('先走 6 再收子', [cs[0][0].die, cs[0][1].die], [6, 1]);

  // 两个子、两个骰点都能用：必须走满 2 步。
  var d = at({ 9: 1, 19: 1 });
  d.dice = [2, 3];
  var ds = B.allSequences(d);
  s.ok('两个子时两骰都走', ds.length > 0 && ds.every(function (seq) { return seq.length === 2; }), JSON.stringify(ds));
  s.ok('每个合法首步都能接上第二步', B.legalMoves(d).every(function (m) {
    return ds.some(function (seq) {
      return seq.length === 2 && seq[0].from === m.from && seq[0].to === m.to && seq[0].die === m.die;
    });
  }));
});

s.group('Bear off 收子', function () {
  // 未全部进内盘：不能收子。
  var a = at({ 6: 1, 0: 1 });
  a.dice = [1, 2];
  s.ok('有子在外盘时禁止收子', !B.canBearOff(a, B.WHITE));
  s.ok('所有走法都不含 off', B.legalMoves(a).every(function (m) { return m.to !== 'off'; }));

  // 全部进内盘 + 精确点数。
  var b = at({ 2: 1 });
  b.dice = [3];
  s.ok('全部进内盘可以收子', B.canBearOff(b, B.WHITE));
  s.eq('精确点数 3 收 3 点', B.legalMoves(b)[0].to, 'off');

  // 点数大于最远棋子：可收最远的一枚。
  var c = at({ 3: 1 });
  c.dice = [6];
  s.ok('6 点可收 4 点上最远的子', B.legalMoves(c).some(function (m) { return m.from === 3 && m.to === 'off'; }));
  var c2 = at({ 1: 1, 5: 1 });
  c2.dice = [3];
  s.ok('更远处还有子时不能用大点收近子', !B.legalMoves(c2).some(function (m) { return m.from === 1 && m.to === 'off'; }));

  // 点数小于棋子所在点：不能收，只能在内盘移动。
  var d = at({ 4: 1 });
  d.dice = [3];
  var dm = B.legalMoves(d);
  s.ok('3 点不能收 5 点上的子', !dm.some(function (m) { return m.to === 'off'; }), JSON.stringify(dm));
  s.ok('但仍可在内盘走普通步', hasMove(dm, 4, 1, 3), JSON.stringify(dm));

  // 黑方镜像：距离与更远子判断。
  var e = blank(B.BLACK, [6]);
  e.points[20] = -1;  // 21 点，距 off 4
  s.ok('黑方 6 点可收 21 点上的子', B.legalMoves(e).some(function (m) { return m.from === 20 && m.to === 'off'; }));
  var f = blank(B.BLACK, [3]);
  f.points[19] = -1;  // 20 点，距 off 5
  f.points[22] = -1;  // 23 点，距 off 2
  s.ok('黑方更远处有子时不能用大点收近子', !B.legalMoves(f).some(function (m) { return m.from === 19 && m.to === 'off'; }));
});

s.group('胜负与倍数', function () {
  function finish(blackPoints, blackOff, blackBar) {
    var st = at(blackPoints || {});
    st.points[0] = 1;
    st.off[0] = 14;
    st.off[1] = blackOff || 0;
    st.bar[1] = blackBar || 0;
    st.dice = [1];
    var m = B.legalMoves(st)[0];
    var fin = B.applyMove(st, m);
    return { st: fin, status: B.gameStatus(fin) };
  }
  var single = finish({ 10: -1 }, 1, 0);
  s.ok('正常胜：白方收完 15 枚', single.status.over && single.status.winner === B.WHITE);
  s.eq('正常胜倍率 1', B.multiplier(single.status.kind), 1);

  var gammon = finish({ 10: -1 }, 0, 0);
  s.ok('gammon：对手一枚未收', gammon.status.over && gammon.status.winner === B.WHITE);
  s.eq('gammon 判定', gammon.status.kind, 'gammon');
  s.eq('gammon 倍率 2', B.multiplier(gammon.status.kind), 2);

  var back = finish({ 2: -1 }, 0, 0);
  s.eq('backgammon：对手还有子在赢家内盘', back.status.kind, 'backgammon');
  s.eq('backgammon 倍率 3', B.multiplier(back.status.kind), 3);

  var backBar = finish({ 10: -1 }, 0, 1);
  s.eq('backgammon：对手还有子在 bar', backBar.status.kind, 'backgammon');

  var blackWin = (function () {
    var st = blank(B.BLACK, [1]);
    st.points[23] = -1;
    st.off[1] = 14;
    st.off[0] = 1;   // 白方已收过子 => 单倍
    var fin = B.applyMove(st, B.legalMoves(st)[0]);
    return B.gameStatus(fin);
  })();
  s.ok('黑方也能正常获胜', blackWin.over && blackWin.winner === B.BLACK);
  s.eq('黑方单倍', B.multiplier(blackWin.kind), 1);
});

s.group('AI 自对弈 50 局', function () {
  var total = 50, whiteWins = 0, blackWins = 0, illegal = 0, unfinished = 0;
  var maxPlies = 0, totalPlies = 0, i;

  for (i = 0; i < total; i++) {
    var rng = lib.mulberry32(1000 + i * 7919);
    var st = B.setup();
    st.dice = B.rollDice(rng);
    st.rolled = st.dice.slice();
    var plies = 0, guard = 0;

    while (!B.gameStatus(st).over && plies < 4000 && guard < 6000) {
      var seqs = B.allSequences(st);
      if (!seqs.length) {
        st.turn = -st.turn;
        st.dice = B.rollDice(rng);
        st.rolled = st.dice.slice();
        guard++;
        continue;
      }
      var seq = B.aiSequence(st, 2, rng, 50);
      if (!seq) { illegal++; break; }
      for (var k = 0; k < seq.length; k++) {
        if (!legal(st, seq[k])) illegal++;
        st = B.applyMove(st, seq[k]);
        plies++;
        if (B.gameStatus(st).over) break;
      }
      guard++;
    }

    var res = B.gameStatus(st);
    if (!res.over) unfinished++;
    else if (res.winner === B.WHITE) whiteWins++;
    else blackWins++;
    if (plies > maxPlies) maxPlies = plies;
    totalPlies += plies;
  }

  s.eq('50 局全部正常结束', unfinished, 0);
  s.eq('0 步非法走法', illegal, 0);
  s.eq('胜负总数 50', whiteWins + blackWins, 50);
  s.ok('先手（白方）有胜局', whiteWins > 0, 'white ' + whiteWins + ', black ' + blackWins);
  s.ok('后手（黑方）有胜局', blackWins > 0, 'white ' + whiteWins + ', black ' + blackWins);
  s.ok('最长对局在合理范围内', maxPlies < 4000, 'max ' + maxPlies + ' plies');
  return '先手胜率 ' + (whiteWins / total * 100).toFixed(0) + '%（' + whiteWins + '–' + blackWins +
    '），平均 ' + (totalPlies / total).toFixed(0) + ' 步/局';
});

s.group('较难 AI 时限', function () {
  // 先用贪心走 30 个半步，得到一个中局局面。
  var rng = lib.mulberry32(424242);
  var st = B.setup();
  st.dice = B.rollDice(rng);
  var plies = 0, guard = 0;
  while (plies < 30 && guard < 100) {
    var seqs = B.allSequences(st);
    if (!seqs.length) {
      st.turn = -st.turn;
      st.dice = B.rollDice(rng);
      guard++;
      continue;
    }
    var seq = B.aiSequence(st, 2, rng, 50);
    st = B.applySequence(st, seq);
    plies += seq.length;
    guard++;
  }
  while (!B.gameStatus(st).over && !B.allSequences(st).length) {
    st.turn = -st.turn;
    st.dice = B.rollDice(rng);
  }
  var t0 = Date.now();
  var pick = B.aiSequence(st, 3, rng, 650);
  var ms = Date.now() - t0;
  s.ok('较难 AI 返回一条合法序列', !!pick && pick.length > 0);
  s.ok('单步 ≤ 700ms', ms <= 700, '实测 ' + ms + 'ms');
  return '实测 ' + ms + 'ms';
});

s.done();
