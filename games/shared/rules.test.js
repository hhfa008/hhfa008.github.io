'use strict';

// Contract test for the shared Gomoku / Connect Four engines.
//
//   setup(opts) -> state
//   legalMoves(state) -> [move]
//   applyMove(state, move) -> newState     (pure: never mutates its argument)
//   status(state) -> 'playing' | 'win' | 'draw'
//   winner(state) -> 0 (draw) | player token | null (playing)
//   key(state) -> string                   (stable, random-free)
//
// Connect Four's own status(state) still returns its legacy detail object
// { over, winner, line, draw } because the page and the voice-room Worker read
// those fields; GameRules.contract(kind) is the normalized view used here.

var lib = require('../tests/lib.js');
var s = lib.suite('shared/rules');

var Games = require('../shared/rules.js');
var G = Games.gomoku, C = Games.connect4;
var GN = G.N, GNN = G.NN;

function gIdx(r, c) { return r * GN + c; }
function cIdx(r, c) { return r * C.COLS + c; }

function boardSnapshot(st) {
  return { b: Array.from(st.b).join(','), turn: st.turn, last: st.last, plies: st.plies };
}

// Black stones on row 7 (3..7), White stones on row 0 (0..3). The 9th ply is
// Black's fifth in a row.
function gomokuWinState() {
  var st = G.setup();
  var seq = [[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]];
  for (var i = 0; i < seq.length; i++) st = G.applyMove(st, gIdx(seq[i][0], seq[i][1]));
  return st;
}

// Full board coloured by ((r + 2c) mod 4): runs of at most two in every
// direction, so no five in a row exists and status() has to report a draw.
function gomokuDrawState() {
  var b = new Int8Array(GNN), r, c;
  for (r = 0; r < GN; r++) for (c = 0; c < GN; c++) {
    b[gIdx(r, c)] = ((r + 2 * c) & 3) < 2 ? G.BLACK : G.WHITE;
  }
  return { b: b, turn: G.BLACK, last: -1, plies: GNN };
}

s.group('五子棋状态契约', function () {
  var st = G.setup();
  s.eq('setup 棋盘 225 格', st.b.length, GNN);
  s.eq('setup 全空', Array.from(st.b).filter(Boolean).length, 0);
  s.eq('setup 黑先', st.turn, G.BLACK);
  s.eq('setup last/plies', [st.last, st.plies], [-1, 0]);
  s.eq('开局合法走法 225 个', G.legalMoves(st).length, GNN);
  s.eq('开局含首尾索引', [G.legalMoves(st)[0], G.legalMoves(st)[GNN - 1]], [0, GNN - 1]);
  s.eq('索引 -1 / 225 / 小数非法', [G.isLegal(st, -1), G.isLegal(st, GNN), G.isLegal(st, 0.5)],
    [false, false, false]);
  s.ok('空点合法', G.isLegal(st, gIdx(7, 7)));

  var mv = G.applyMove(st, gIdx(7, 7));
  s.eq('落子 last 为索引', mv.last, gIdx(7, 7));
  s.eq('落子后换白', mv.turn, G.WHITE);
  s.eq('落子后 plies=1', mv.plies, 1);
  s.eq('落子写入棋盘', mv.b[gIdx(7, 7)], G.BLACK);
  s.eq('已占点不再合法', G.applyMove(mv, gIdx(7, 7)), null);
  s.eq('非法索引返回 null', G.applyMove(st, -1), null);

  s.eq('开局 status=playing', G.status(st), 'playing');
  s.eq('开局 winner=null', G.winner(st), null);
  s.eq('single stone 仍 playing', G.status(mv), 'playing');

  var win = gomokuWinState();
  s.eq('五连 status=win', G.status(win), 'win');
  s.eq('五连 winner=BLACK', G.winner(win), G.BLACK);
  s.eq('五连回到最后落点的连线', G.lineAt(win.b, 7, 7, G.BLACK).length, 5);

  var draw = gomokuDrawState();
  s.eq('满盘无五连 => draw', G.status(draw), 'draw');
  s.eq('和棋 winner=0', G.winner(draw), 0);
  s.eq('满盘扫描无胜者', G.scanWinner(draw.b), null);

  s.ok('key 是字符串', typeof G.key(st) === 'string');
  s.eq('同一局面 key 稳定', G.key(st), G.key(G.setup()));
  s.ok('落子后 key 变化', G.key(mv) !== G.key(st));

  // Same board reached by a different order of same-colour moves.
  var a = G.setup(), b2 = G.setup();
  a = G.applyMove(a, gIdx(0, 0)); a = G.applyMove(a, gIdx(0, 1));
  a = G.applyMove(a, gIdx(0, 2)); a = G.applyMove(a, gIdx(0, 3));
  b2 = G.applyMove(b2, gIdx(0, 2)); b2 = G.applyMove(b2, gIdx(0, 1));
  b2 = G.applyMove(b2, gIdx(0, 0)); b2 = G.applyMove(b2, gIdx(0, 3));
  s.eq('不同手顺同一局面 key 相同', G.key(a), G.key(b2));
});

s.group('四子棋契约补齐与向后兼容', function () {
  var st = C.setup();
  var legacy = C.status(st);
  s.eq('旧 status 对象字段未变', Object.keys(legacy).sort(), ['draw', 'line', 'over', 'winner']);
  s.eq('旧 status 开局未结束', [legacy.over, legacy.draw, legacy.winner], [false, false, 0]);
  s.eq('开局 winner=null', C.winner(st), null);
  s.eq('开局 status 适配为 playing', Games.contract('connect4').status(st), 'playing');

  var win = C.setup(), seq = [0, 1, 0, 1, 0, 1, 0];
  for (var i = 0; i < seq.length; i++) win = C.applyMove(win, seq[i]);
  s.eq('旧 status 判定 P1 获胜', [C.status(win).over, C.status(win).winner], [true, C.P1]);
  s.eq('旧 status 给出 4 连线', C.status(win).line.length, 4);
  s.eq('winner=P1', C.winner(win), C.P1);
  s.eq('适配 status=win', Games.contract('connect4').status(win), 'win');

  var draw = { b: new Int8Array(C.ROWS * C.COLS), turn: C.P1, last: -1, plies: C.ROWS * C.COLS };
  s.eq('旧 status 满盘判和', [C.status(draw).over, C.status(draw).draw], [true, true]);
  s.eq('和棋 winner=0', C.winner(draw), 0);
  s.eq('适配 status=draw', Games.contract('connect4').status(draw), 'draw');

  s.ok('key 是字符串', typeof C.key(st) === 'string');
  s.eq('同一局面 key 稳定', C.key(st), C.key(C.setup()));
  var mv = C.applyMove(st, 3);
  s.ok('落子后 key 变化', C.key(mv) !== C.key(st));

  // Columns are independent: swapping two P1 moves yields the same board.
  var a = C.setup(), b2 = C.setup();
  [0, 1, 2, 3].forEach(function (c) { a = C.applyMove(a, c); });
  [2, 1, 0, 3].forEach(function (c) { b2 = C.applyMove(b2, c); });
  s.eq('不同手顺同一局面 key 相同', C.key(a), C.key(b2));

  s.eq('旧 legalMoves 不变', C.legalMoves(st), [0, 1, 2, 3, 4, 5, 6]);
  s.eq('旧 isLegal 边界不变', [C.isLegal(st, -1), C.isLegal(st, 7)], [false, false]);
});

s.group('applyMove 不可变性（单独验证）', function () {
  // Gomoku: two plies in, then snapshot the whole state.
  var g0 = G.setup();
  g0 = G.applyMove(g0, gIdx(7, 7));
  g0 = G.applyMove(g0, gIdx(7, 8));
  var gBefore = boardSnapshot(g0);
  var gNext = G.applyMove(g0, gIdx(8, 8));
  s.ok('五子棋返回新状态对象', !!gNext && gNext !== g0);
  s.ok('五子棋返回新棋盘数组', gNext.b !== g0.b);
  s.eq('五子棋入参状态逐字段未变', boardSnapshot(g0), gBefore);
  var gBoardBefore = Array.from(g0.b).join(',');
  gNext.b[gIdx(0, 0)] = G.WHITE;
  s.eq('五子棋改新棋盘不回写旧状态', Array.from(g0.b).join(','), gBoardBefore);
  s.eq('五子棋非法走法返回 null', G.applyMove(g0, gIdx(7, 7)), null);
  s.eq('五子棋非法走法后入参仍不变', boardSnapshot(g0), gBefore);

  // Connect Four: same checks, including the gravity row of the new disc.
  var c0 = C.setup();
  c0 = C.applyMove(c0, 3);
  c0 = C.applyMove(c0, 3);
  var cBefore = boardSnapshot(c0);
  var cNext = C.applyMove(c0, 4);
  s.ok('四子棋返回新状态对象', !!cNext && cNext !== c0);
  s.ok('四子棋返回新棋盘数组', cNext.b !== c0.b);
  s.eq('四子棋入参状态逐字段未变', boardSnapshot(c0), cBefore);
  var cBoardBefore = Array.from(c0.b).join(',');
  cNext.b[0] = C.P2;
  s.eq('四子棋改新棋盘不回写旧状态', Array.from(c0.b).join(','), cBoardBefore);
  s.eq('四子棋满列走法返回 null', (function () {
    var full = C.setup();
    for (var k = 0; k < C.ROWS; k++) full = C.applyMove(full, 0);
    var snap = boardSnapshot(full);
    var res = C.applyMove(full, 0);
    return res === null && boardSnapshot(full).b === snap.b ? null : 'changed';
  })(), null);

  // A replay history: previously returned states must stay frozen.
  var states = [G.setup()], snaps = [boardSnapshot(states[0])];
  [gIdx(0, 0), gIdx(0, 1), gIdx(0, 2), gIdx(1, 1)].forEach(function (m) {
    states.push(G.applyMove(states[states.length - 1], m));
    snaps.push(boardSnapshot(states[states.length - 1]));
  });
  var frozen = true;
  for (var i = 0; i < states.length; i++) {
    if (JSON.stringify(boardSnapshot(states[i])) !== JSON.stringify(snaps[i])) frozen = false;
  }
  s.ok('五子棋历史状态不被后续走法改动', frozen);
});

s.group('两棋契约一致性', function () {
  var NAMES = ['setup', 'legalMoves', 'applyMove', 'status', 'winner', 'key'];
  s.eq('五子棋契约方法集', Object.keys(Games.contract('gomoku')).sort(), NAMES.slice().sort());
  s.eq('四子棋契约方法集', Object.keys(Games.contract('connect4')).sort(), NAMES.slice().sort());
  s.eq('两棋契约方法集一致', Object.keys(Games.contract('gomoku')).sort(),
    Object.keys(Games.contract('connect4')).sort());

  function drive(kind) {
    var R = Games.contract(kind);
    var st = R.setup();
    var trace = [];
    trace.push(R.status(st));
    var moves = R.legalMoves(st);
    trace.push(moves.length > 0 ? 'moves' : 'none');
    var k0 = R.key(st);
    var next = R.applyMove(st, moves[0]);
    trace.push(R.key(st) === k0 ? 'immutable' : 'mutated');
    trace.push(R.status(next));
    trace.push(R.winner(next));
    trace.push(typeof R.key(next) === 'string' ? 'key' : 'bad');
    return trace;
  }

  s.eq('同一调用序列在五子棋上跑通', drive('gomoku'),
    ['playing', 'moves', 'immutable', 'playing', null, 'key']);
  s.eq('同一调用序列在四子棋上跑通', drive('connect4'),
    ['playing', 'moves', 'immutable', 'playing', null, 'key']);

  var gw = Games.contract('gomoku');
  s.eq('五子棋契约 status=win', gw.status(gomokuWinState()), 'win');
  s.eq('五子棋契约 winner=BLACK', gw.winner(gomokuWinState()), G.BLACK);
  s.eq('五子棋契约 status=draw', gw.status(gomokuDrawState()), 'draw');

  var cw = Games.contract('connect4');
  var cwin = C.setup();
  [0, 1, 0, 1, 0, 1, 0].forEach(function (c) { cwin = C.applyMove(cwin, c); });
  s.eq('四子棋契约 status=win', cw.status(cwin), 'win');
  s.eq('四子棋契约 winner=P1', cw.winner(cwin), C.P1);
  s.eq('四子棋契约 status=draw', cw.status({
    b: new Int8Array(C.ROWS * C.COLS), turn: C.P1, last: -1, plies: C.ROWS * C.COLS
  }), 'draw');

  var threw = false;
  try { Games.contract('chess'); } catch (e) { threw = true; }
  s.ok('未知棋种抛错', threw);
});

s.done();
