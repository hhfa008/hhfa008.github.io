'use strict';

// Banqi (暗棋 / 翻棋) test. Engine lives in ENGINE START..END inside index.html.

var lib = require('../tests/lib.js');
var s = lib.suite('banqi');

var html = lib.page(__dirname);
var B = lib.evalBetween(html, '/* === ENGINE START === */', '/* === ENGINE END === */', 'BQ');

function at(entries, turn) {
  var st = B.empty(turn == null ? B.RED : turn), i;
  for (i = 0; i < entries.length; i++) {
    var e = entries[i];
    st.cells[e[0]] = B.mk(e[1], e[2], e[3]);
  }
  return st;
}
function hasMove(st, from, to) {
  return B.legalActions(st).some(function (a) {
    return a.k === 'move' && a.from === from && a.to === to;
  });
}
function movesFrom(st, from) {
  return B.legalActions(st).filter(function (a) {
    return a.k === 'move' && a.from === from;
  }).map(function (a) { return a.to; }).sort(function (a, b) { return a - b; });
}
function countType(st, side, type) {
  var n = 0;
  st.cells.forEach(function (c) { if (c && c.s === side && c.t === type) n++; });
  return n;
}
function blackDefender(type) { return at([[8, B.RED, 'K'], [9, B.BLACK, type]]); }

s.group('开局：4×8、32 枚全暗、红黑各 16', function () {
  var st = B.setup(lib.mulberry32(20261109));
  s.eq('格子数 32', st.cells.length, 32);
  s.eq('列数 8', B.COLS, 8);
  s.eq('行数 4', B.ROWS, 4);
  s.ok('32 格全部有子', st.cells.every(function (c) { return !!c; }));
  s.ok('全部背面朝上', st.cells.every(function (c) { return c.h === 1; }));
  s.eq('红方 16 枚', B.count(st, B.RED), 16);
  s.eq('黑方 16 枚', B.count(st, B.BLACK), 16);
  s.eq('暗子 32 枚', B.hiddenCount(st), 32);
  s.eq('红方明子 0', B.visibleCount(st, B.RED), 0);
  s.eq('黑方明子 0', B.visibleCount(st, B.BLACK), 0);
  s.eq('红帅 1', countType(st, B.RED, 'K'), 1);
  s.eq('红仕 2', countType(st, B.RED, 'A'), 2);
  s.eq('红相 2', countType(st, B.RED, 'B'), 2);
  s.eq('红車 2', countType(st, B.RED, 'R'), 2);
  s.eq('红馬 2', countType(st, B.RED, 'N'), 2);
  s.eq('红炮 2', countType(st, B.RED, 'C'), 2);
  s.eq('红兵 5', countType(st, B.RED, 'P'), 5);
  s.eq('黑将 1', countType(st, B.BLACK, 'K'), 1);
  s.eq('黑士 2', countType(st, B.BLACK, 'A'), 2);
  s.eq('黑象 2', countType(st, B.BLACK, 'B'), 2);
  s.eq('黑車 2', countType(st, B.BLACK, 'R'), 2);
  s.eq('黑馬 2', countType(st, B.BLACK, 'N'), 2);
  s.eq('黑砲 2', countType(st, B.BLACK, 'C'), 2);
  s.eq('黑卒 5', countType(st, B.BLACK, 'P'), 5);
  s.eq('总子数 32', B.count(st, B.RED) + B.count(st, B.BLACK), 32);
  s.eq('红先', st.turn, B.RED);
  var st2 = B.setup(lib.mulberry32(777));
  var differ = false, i;
  for (i = 0; i < 32; i++) if (st.cells[i].t !== st2.cells[i].t || st.cells[i].s !== st2.cells[i].s) { differ = true; break; }
  s.ok('不同种子发牌不同', differ);
  var flips = B.legalActions(st).filter(function (a) { return a.k === 'flip'; });
  s.eq('开局只有 32 个翻子动作', flips.length, 32);
  s.eq('开局没有走子动作', B.legalActions(st).length - flips.length, 0);
});

s.group('等级吃子：高吃低、同级拒绝、低吃高、兵吃帅', function () {
  var cases = [
    ['帅吃仕', 'K', 'A', true],
    ['仕吃相', 'A', 'B', true],
    ['相吃車', 'B', 'R', true],
    ['車吃馬', 'R', 'N', true],
    ['馬吃炮', 'N', 'C', true],
    ['帅吃卒', 'K', 'P', true]
  ];
  cases.forEach(function (c) {
    s.ok(c[0] + '通过', hasMove(blackDefender(c[2]), 8, 9) === c[3]);
  });
  var same = [
    ['帅吃帅', 'K'], ['仕吃仕', 'A'], ['相吃相', 'B'], ['車吃車', 'R'], ['馬吃馬', 'N'], ['兵吃兵', 'P']
  ];
  same.forEach(function (c) {
    var st = at([[8, B.RED, c[1]], [9, B.BLACK, c[1]]]);
    s.ok(c[0] + '被拒绝', !hasMove(st, 8, 9));
    s.ok(c[0] + 'canCapture 为假', !B.canCapture(st.cells[8], st.cells[9]));
  });
  var low = [
    ['兵吃仕', 'P', 'A'], ['馬吃車', 'N', 'R'], ['仕吃帅', 'A', 'K'], ['相吃仕', 'B', 'A'], ['車吃帅', 'R', 'K']
  ];
  low.forEach(function (c) {
    var st = at([[8, B.RED, c[1]], [9, B.BLACK, c[2]]]);
    s.ok(c[0] + '被拒绝', !hasMove(st, 8, 9));
  });
  s.ok('兵吃帅通过', hasMove(at([[8, B.RED, 'P'], [9, B.BLACK, 'K']]), 8, 9));
  s.ok('卒吃帅镜像通过', hasMove(at([[8, B.BLACK, 'P'], [9, B.RED, 'K']], B.BLACK), 8, 9));
  s.ok('炮在車之后：車吃炮通过', hasMove(at([[8, B.RED, 'R'], [9, B.BLACK, 'C']]), 8, 9));
  s.ok('炮在馬之后：馬吃炮通过', hasMove(at([[8, B.RED, 'N'], [9, B.BLACK, 'C']]), 8, 9));
  s.ok('兵不能吃炮', !hasMove(at([[8, B.RED, 'P'], [9, B.BLACK, 'C']]), 8, 9));
});

s.group('炮：隔一子可吃、不隔子不能吃、隔两子不能吃', function () {
  function cannon(entries, turn) {
    var all = [[8, turn === B.BLACK ? B.BLACK : B.RED, 'C']].concat(entries);
    return at(all, turn);
  }
  // exactly one screen
  s.ok('隔一个明子可吃', hasMove(cannon([[10, B.BLACK, 'P'], [12, B.BLACK, 'K']]), 8, 12));
  s.ok('隔一个暗子可吃', hasMove(cannon([[10, B.BLACK, 'P', 1], [12, B.BLACK, 'K']]), 8, 12));
  s.ok('隔一个自己的子也可吃', hasMove(cannon([[10, B.RED, 'P'], [12, B.BLACK, 'K']]), 8, 12));
  s.ok('紧邻的隔子：炮 8 吃 10', hasMove(cannon([[9, B.BLACK, 'P'], [10, B.BLACK, 'K']]), 8, 10));
  // no screen
  s.ok('不隔子不能吃紧邻敌子', !hasMove(cannon([[9, B.BLACK, 'K']]), 8, 9));
  s.ok('不隔子不能吃远处敌子', !hasMove(cannon([[12, B.BLACK, 'K']]), 8, 12));
  s.ok('中间全是空格也不能吃', !hasMove(cannon([[13, B.BLACK, 'K']]), 8, 13));
  // two screens
  s.ok('隔两子不能吃', !hasMove(cannon([[9, B.BLACK, 'P'], [10, B.BLACK, 'P'], [11, B.BLACK, 'K']]), 8, 11));
  s.ok('隔两子（中间有空格）不能吃', !hasMove(cannon([[9, B.BLACK, 'P'], [11, B.BLACK, 'P'], [12, B.BLACK, 'K']]), 8, 12));
  // other guards
  s.ok('不能隔子吃自己的子', !hasMove(cannon([[9, B.BLACK, 'P'], [10, B.RED, 'K']]), 8, 10));
  s.ok('不能隔子吃暗子', !hasMove(cannon([[9, B.BLACK, 'P'], [10, B.BLACK, 'K', 1]]), 8, 10));
  s.ok('炮可以走到紧邻空格', hasMove(cannon([]), 8, 9));
  s.ok('炮不能斜走', !hasMove(cannon([]), 8, 17));
  s.ok('炮的目标是硬挡：中间两子时第二个己方子也挡住', !hasMove(cannon([[9, B.BLACK, 'P'], [10, B.RED, 'P'], [11, B.BLACK, 'K']]), 8, 11));
  s.ok('炮隔一子吃帅/将（无等级限制）', hasMove(cannon([[10, B.BLACK, 'P'], [12, B.BLACK, 'K']]), 8, 12));
});

s.group('移动：上下左右一格、不斜走、不越子', function () {
  var center = at([[9, B.RED, 'K']]);
  s.eq('中心四向邻格', movesFrom(center, 9), [1, 8, 10, 17]);
  s.ok('不能斜走（左上）', !hasMove(center, 9, 2));
  s.ok('不能斜走（左下）', !hasMove(center, 9, 16));
  s.ok('不能跨两格', !hasMove(center, 9, 11));
  var corner = at([[0, B.RED, 'K']]);
  s.eq('角落只有两个方向', movesFrom(corner, 0), [1, 8]);
  var blocked = at([[8, B.RED, 'R'], [10, B.BLACK, 'P']]);
  s.ok('普通子不能越子吃', !hasMove(blocked, 8, 10));
  var own = at([[8, B.RED, 'R'], [9, B.RED, 'P']]);
  s.ok('不能走到自己的子上', !hasMove(own, 8, 9));
  var hidden = at([[8, B.RED, 'R'], [9, B.BLACK, 'P', 1]]);
  s.ok('不能吃暗子', !hasMove(hidden, 8, 9));
  s.ok('暗子也不能被走到', !hasMove(hidden, 8, 9));
  var oppTurn = at([[8, B.BLACK, 'R']], B.RED);
  s.ok('不能走对方的子', movesFrom(oppTurn, 8).length === 0);
  var mine = at([[8, B.RED, 'R']]);
  var before = B.clone(mine);
  var after = B.applyAction(mine, { k: 'move', from: 8, to: 9 });
  s.eq('走子后原格为空', after.cells[8], null);
  s.eq('走子后新格是原棋子', after.cells[9].t, 'R');
  s.eq('走子后换手', after.turn, B.BLACK);
  s.eq('原局面未被修改', before.cells[8].t, 'R');
  var capture = B.applyAction(at([[8, B.RED, 'R'], [9, B.BLACK, 'P']]), { k: 'move', from: 8, to: 9 });
  s.eq('吃子后目标变为己方子', capture.cells[9].s, B.RED);
  s.eq('吃子后黑子数量减一', B.count(capture, B.BLACK), 0);
  var hiddenMove = at([[8, B.RED, 'R', 1]]);
  s.eq('暗子只提供翻子动作', B.legalActions(hiddenMove).filter(function (a) { return a.k === 'move'; }).length, 0);
  var flip = B.applyAction(at([[8, B.RED, 'R', 1]]), { k: 'flip', to: 8 });
  s.eq('翻子后明牌', flip.cells[8].h, 0);
  s.eq('翻子后换手', flip.turn, B.BLACK);
  s.eq('翻子不改变归属', flip.cells[8].s, B.RED);
});

s.group('胜负：一方无子或无法行动判负', function () {
  var onlyRed = at([[8, B.RED, 'K']]);
  var r1 = B.status(onlyRed);
  s.ok('黑方 0 子：红胜', r1.over && r1.winner === B.RED);
  s.eq('原因为吃光', r1.reason, 'all');
  var onlyBlack = at([[8, B.BLACK, 'K']], B.BLACK);
  var r2 = B.status(onlyBlack);
  s.ok('红方 0 子：黑胜', r2.over && r2.winner === B.BLACK);
  var kill = at([[8, B.RED, 'K'], [9, B.BLACK, 'P']]);
  var killed = B.applyAction(kill, { k: 'move', from: 8, to: 9 });
  s.eq('吃掉最后一枚黑子', B.count(killed, B.BLACK), 0);
  s.ok('吃光后红胜', B.status(killed).winner === B.RED);
  var stuck = at([[0, B.RED, 'P'], [1, B.BLACK, 'P'], [8, B.BLACK, 'P']]);
  s.eq('被困红兵没有动作', B.legalActions(stuck).length, 0);
  var r3 = B.status(stuck);
  s.ok('无法行动判负（黑胜）', r3.over && r3.winner === B.BLACK);
  s.eq('原因为无子可动', r3.reason, 'stuck');
  var both = at([[8, B.RED, 'K'], [10, B.BLACK, 'K']]);
  s.ok('双方有子且能走时未结束', !B.status(both).over);
  both.noProgress = 120;
  var r4 = B.status(both);
  s.ok('长期无进展判和', r4.over && r4.winner === 0 && r4.reason === 'draw');
  var hiddenRed = at([[8, B.RED, 'K', 1], [10, B.BLACK, 'K']]);
  s.ok('暗子仍算己方子，不判负', !B.status(hiddenRed).over && B.count(hiddenRed, B.RED) === 1);
  s.ok('只剩暗子时仍可翻子', B.legalActions(hiddenRed).some(function (a) { return a.k === 'flip' && a.to === 8; }));
  var blackHidden = at([[8, B.BLACK, 'K', 1]]);
  s.ok('黑方只剩暗子也未被判负', !B.status(blackHidden).over || B.status(blackHidden).winner !== B.RED);
});

s.group('AI 自对弈 50 局：全部结束、0 非法动作', function () {
  var total = 50, illegal = 0, unfinished = 0, redWins = 0, blackWins = 0, draws = 0;
  var maxPlies = 0, totalPlies = 0, i, k;
  for (i = 0; i < total; i++) {
    var rng = lib.mulberry32(9001 + i * 7919);
    var st = B.setup(rng);
    var plies = 0, guard = 0;
    while (!B.status(st).over && guard < 1000) {
      var lvl = (i % 3) + 1;
      var a = B.aiAction(st, lvl, rng, 20);
      if (!a) { illegal++; break; }
      if (!B.isLegal(st, a)) {
        illegal++;
        console.log('  illegal action:', JSON.stringify(a), 'game', i, 'ply', plies);
        break;
      }
      st = B.applyAction(st, a);
      plies++; guard++;
    }
    var res = B.status(st);
    if (!res.over) unfinished++;
    else if (res.winner === B.RED) redWins++;
    else if (res.winner === B.BLACK) blackWins++;
    else draws++;
    if (plies > maxPlies) maxPlies = plies;
    totalPlies += plies;
  }
  s.eq('50 局全部正常结束', unfinished, 0);
  s.eq('0 步非法动作', illegal, 0);
  s.eq('50 局都有结果', redWins + blackWins + draws, 50);
  s.ok('对局步数在合理范围', maxPlies > 0 && maxPlies < 1000, 'max ' + maxPlies);

  var mid = B.setup(lib.mulberry32(424242));
  var seedRng = lib.mulberry32(5150);
  for (k = 0; k < 24 && !B.status(mid).over; k++) {
    var ma = B.aiAction(mid, 2, seedRng, 0);
    if (!ma) break;
    mid = B.applyAction(mid, ma);
  }
  var t0 = Date.now();
  var pick = B.aiAction(mid, 3, lib.mulberry32(99), 200);
  var ms = Date.now() - t0;
  s.ok('较难 AI 返回合法动作', !!pick && B.isLegal(mid, pick));
  s.ok('较难 AI 单步 ≤ 300ms', ms <= 300, '实测 ' + ms + 'ms');
  return '红胜 ' + redWins + ' · 黑胜 ' + blackWins + ' · 和棋 ' + draws +
    ' · 平均 ' + (totalPlies / total).toFixed(0) + ' 步/局 · AI 实测 ' + ms + 'ms';
});

s.done();
