'use strict';

// Aeroplane (Ludo-style) test. The engine is the ENGINE START..END block.

var lib = require('../tests/lib.js');
var s = lib.suite('aeroplane');

var html = lib.page(__dirname);
var A = lib.evalBetween(html, '/* === ENGINE START === */', '/* === ENGINE END === */', 'AE');

s.group('棋盘常量与开局', function () {
  s.eq('一圈 52 格', A.LOOP, 52);
  s.eq('回家 6 格', A.HOME, 6);
  s.eq('终点 57', A.FINISH, 57);
  s.eq('停机坪 -1', A.HANGAR, -1);
  s.eq('四个起飞点', A.START, [0, 13, 26, 39]);
  s.eq('颜色带 0-3 / 4-7 / 8', [A.BOARD_COLOR(0), A.BOARD_COLOR(3), A.BOARD_COLOR(4), A.BOARD_COLOR(8)], [0, 0, 1, 2]);
  s.eq('四人局四个色', A.setup(4).active, [0, 1, 2, 3]);
  s.eq('双人局用对家', A.setup(2).active, [0, 2]);
  var st = A.setup(4);
  s.eq('开局四架都在停机坪', st.planes[0], [-1, -1, -1, -1]);
  s.eq('开局轮到 0 号', st.turn, 0);
});

s.group('全局路线与踩子', function () {
  s.eq('0 号起点', A.routeGlobal(0, 0), 0);
  s.eq('1 号起点在 13', A.routeGlobal(1, 0), 13);
  s.eq('1 号走 10 格到 23', A.routeGlobal(1, 10), 23);
  s.eq('3 号走 51 格绕回 38', A.routeGlobal(3, 51), 38);
  s.eq('负位置无效', A.routeGlobal(0, -1), -1);
  s.eq('超过一圈无效', A.routeGlobal(0, 52), -1);
  var st = A.setup(4);
  st.planes[0][0] = 0;   // 全局 0
  st.planes[1][0] = 39;  // 全局 (13+39)%52 = 0
  var cap = A.capturesAt(st, 0, 0);
  s.eq('同格敌机可被踩', cap, [{ p: 1, plane: 0, from: 39 }]);
  st.planes[0][1] = 39;
  s.eq('不踩自己人', A.capturesAt(st, 0, 0).length, 1);
});

s.group('合法着法', function () {
  var st = A.setup(4);
  s.eq('掷 6 四架都可起飞', A.legalMoves(st, 0, 6).length, 4);
  s.eq('掷 3 无子可动', A.legalMoves(st, 0, 3).length, 0);
  st.planes[0][0] = 56;
  s.eq('差 1 格到终点可走', A.legalMoves(st, 0, 1).filter(function (m) { return m.plane === 0; }).length, 1);
  s.eq('超过终点不可走', A.legalMoves(st, 0, 2).filter(function (m) { return m.plane === 0; }).length, 0);
  var jump = A.setup(4);
  jump.planes[0][0] = 15; // 走 1 到 16，正逢本 color 带（16-19）
  var mv = A.legalMoves(jump, 0, 1).filter(function (m) { return m.plane === 0; })[0];
  s.ok('落在自己颜色带跳 4 格', mv && mv.jump && mv.to === 20, JSON.stringify(mv));
  var noJump = A.setup(4);
  noJump.planes[0][0] = 11; // 12 属于 3 号色带
  var mv2 = A.legalMoves(noJump, 0, 1).filter(function (m) { return m.plane === 0; })[0];
  s.ok('落在别人色带不跳', mv2 && !mv2.jump && mv2.to === 12);
  var done = A.setup(4);
  done.planes[0][0] = 57;
  s.eq('已到终点的飞机不再走', A.legalMoves(done, 0, 6).filter(function (m) { return m.plane === 0; }).length, 0);
});

s.group('执行与胜负', function () {
  var st = A.setup(4);
  st.planes[0][0] = 0;
  st.planes[1][0] = 39;
  var launch = A.execute(st, 0, 6, {
    type: 'launch', plane: 0, to: 0, captured: A.capturesAt(st, 0, 0)
  });
  s.eq('起飞落到起点', launch.state.planes[0][0], 0);
  s.eq('被踩敌机回停机坪', launch.state.planes[1][0], -1);
  s.eq('掷 6 后再掷一次', launch.again, true);
  s.eq('掷 6 不换手', launch.state.turn, 0);
  var st2 = A.setup(4);
  st2.planes[0][0] = 0;
  var moved = A.execute(st2, 0, 3, { type: 'move', plane: 0, from: 0, to: 3, captured: [] });
  s.eq('普通移动后换手', moved.state.turn, 1);
  s.ok('普通移动不再掷', !moved.again);
  var pass = A.passTurn(st2, 0, 3);
  s.eq('无子可动换手', pass.turn, 1);
  var pass6 = A.passTurn(st2, 0, 6);
  s.eq('掷 6 无子可动也保留回合', pass6.turn, 0);
  var win = A.setup(4);
  win.planes[0] = [57, 57, 57, 57];
  s.eq('四架到终点即胜', A.winner(win), 0);
  win.planes[0][3] = 56;
  s.eq('差一架不胜', A.winner(win), -1);
  var hist = A.history(A.setup(4));
  s.eq('历史初始 1 步', hist.size(), 1);
  hist.push(A.setup(4));
  s.eq('push 后 2 步', hist.size(), 2);
  hist.undo();
  s.eq('undo 后 1 步', hist.size(), 1);
  s.ok('AI 返回合法着法', (function () {
    var m = A.aiChoose(A.setup(4), 0, 6);
    return m && A.legalMoves(A.setup(4), 0, 6).some(function (x) {
      return x.plane === m.plane && x.to === m.to;
    });
  })());
});

s.done();
