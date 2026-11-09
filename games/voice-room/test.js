#!/usr/bin/env node
'use strict';

/*
 * Offline self-checks for the voice-room Worker Durable Object.
 *
 * RoomDO is imported directly (no wrangler, no network): Node's WebCrypto,
 * atob/btoa and TextEncoder provide everything the module needs. Only two
 * Cloudflare globals are stubbed — Response and WebSocketPair — so the real
 * handleJoin / fetch / handleMove / webSocketMessage code paths run unchanged.
 *
 * Covered:
 *   1. Reconnect token: HMAC generation, expiry, tamper and wrong-pid rejection.
 *   2. Password room: SHA-256(salt||password) derivation, constant-time
 *      comparison, 5 failures -> 60 s lock, lock expiry, password format.
 *   3. Join outcomes: need_password, room_exists, passwordless rooms.
 *   4. Capacity: 4 members max, reconnect takeover keeps the seat.
 *   5. Move legality: tic-tac-toe, gomoku and connect four illegal moves.
 *   6. Host-only reset/select.
 *   7. Message envelope validation.
 *
 * The Worker keeps its constants private. The test reads them from the source
 * file and asserts they match the values observed through behaviour, so a
 * future edit cannot silently desynchronise the mirrored expectations.
 *
 * Run: node games/voice-room/test.js
 */

var fs = require('fs');
var path = require('path');
var { pathToFileURL } = require('url');
var lib = require('../tests/lib');

var ROOM_PATH = path.join(__dirname, 'worker', 'src', 'room.js');
var SRC = fs.readFileSync(ROOM_PATH, 'utf8');

var s = lib.suite('voice-room');

function A(label, cond, detail) {
  return [label, !!cond, detail];
}

function sourceConst(name) {
  var re = new RegExp('\\b' + name + '\\s*=\\s*([^;]+);');
  var m = SRC.match(re);
  if (!m) throw new Error('constant not found in room.js: ' + name);
  return Function('return (' + m[1].trim() + ');')();
}

var CONST = {
  MAX_MEMBERS: sourceConst('MAX_MEMBERS'),
  RECONNECT_GRACE_MS: sourceConst('RECONNECT_GRACE_MS'),
  PASSWORD_MIN: sourceConst('PASSWORD_MIN'),
  PASSWORD_MAX: sourceConst('PASSWORD_MAX'),
  MAX_PASSWORD_FAILS: sourceConst('MAX_PASSWORD_FAILS'),
  PASSWORD_LOCK_MS: sourceConst('PASSWORD_LOCK_MS'),
  JOIN_TOKEN_TTL_MS: sourceConst('JOIN_TOKEN_TTL_MS')
};

var BOARD_SIZE = { ttt: 9, gomoku: 225, connect4: 42 };

/* ------------------------------------------------------------------ *
 * Fake Durable Object environment                                     *
 * ------------------------------------------------------------------ */

function makeStorage(init) {
  var map = new Map(Object.entries(init || {}));
  return {
    _map: map,
    get: async function (k) { return map.get(k); },
    put: async function (k, v) { map.set(k, v); },
    delete: async function (k) { map.delete(k); },
    deleteAll: async function () { map.clear(); },
    setAlarm: async function () {},
    deleteAlarm: async function () {}
  };
}

function makeSocket() {
  var att = null;
  var sock = {
    sent: [],
    closed: null,
    send: function (raw) { sock.sent.push(JSON.parse(raw)); },
    close: function (code, reason) { sock.closed = { code: code, reason: reason }; },
    serializeAttachment: function (a) { att = a; },
    deserializeAttachment: function () { return att; }
  };
  return sock;
}

function makeState(init) {
  var sockets = [];
  return {
    _sockets: sockets,
    storage: makeStorage(init || {}),
    getWebSockets: function () { return sockets.slice(); },
    acceptWebSocket: function (ws) { sockets.push(ws); }
  };
}

function member(id, pid, joinedAt) {
  return { id: id, pid: pid, name: pid, mic: false, joinedAt: joinedAt, leftAt: null };
}

function joinRequest(body, ip) {
  return {
    json: async function () { return body; },
    headers: {
      get: function (k) { return k === 'CF-Connecting-IP' ? (ip || '10.0.0.1') : null; }
    }
  };
}

function wsRequest(pid, token, name) {
  return {
    url: 'https://worker.test/ws?room=1234&pid=' + encodeURIComponent(pid || '') +
      '&name=' + encodeURIComponent(name || 'p') +
      '&token=' + encodeURIComponent(token || ''),
    headers: {
      get: function (k) { return k === 'Upgrade' ? 'websocket' : null; }
    }
  };
}

async function join(room, body, ip) {
  var res = await room.handleJoin(joinRequest(body, ip), '1234');
  return await res.json();
}

function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return new Uint8Array(Buffer.from(String(str), 'base64url'));
}

async function passwordDigest(saltBytes, password) {
  var pw = new TextEncoder().encode(String(password));
  var buf = new Uint8Array(saltBytes.length + pw.length);
  buf.set(saltBytes, 0);
  buf.set(pw, saltBytes.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

function lastError(sock) {
  var errs = sock.sent.filter(function (m) { return m.type === 'error'; });
  return errs[errs.length - 1] || null;
}
function hasType(sock, type) {
  return sock.sent.some(function (m) { return m.type === type; });
}

/* ------------------------------------------------------------------ *
 * Test groups (each returns assertion tuples)                         *
 * ------------------------------------------------------------------ */

async function tokenTests(RoomDO) {
  var out = [];
  var room = new RoomDO(makeState(), {});
  var token = await room.makeJoinToken('1234', 'p1');
  var exp = Number(String(token).split('.')[0]);
  var sig = String(token).split('.')[1];

  out.push(A('token 形如 exp.base64url(sig)', /^\d+\.[A-Za-z0-9_-]+$/.test(token), String(token).slice(0, 28)));
  out.push(A('有效期约为 24 小时', Math.abs(exp - (Date.now() + CONST.JOIN_TOKEN_TTL_MS)) < 5000,
    'exp-now=' + (exp - Date.now())));
  out.push(A('正确 room + pid 校验通过', (await room.verifyJoinToken('1234', 'p1', token)) === true));
  out.push(A('换 pid 校验失败', (await room.verifyJoinToken('1234', 'p2', token)) === false));
  out.push(A('换 room 校验失败', (await room.verifyJoinToken('9999', 'p1', token)) === false));

  var swapped = sig.charAt(0) === 'A' ? 'B' : 'A';
  var tampered = exp + '.' + swapped + sig.slice(1);
  out.push(A('篡改签名校验失败', (await room.verifyJoinToken('1234', 'p1', tampered)) === false));
  out.push(A('截短签名校验失败', (await room.verifyJoinToken('1234', 'p1', exp + '.' + sig.slice(0, -2))) === false));
  out.push(A('缺少点号的 token 被拒绝', (await room.verifyJoinToken('1234', 'p1', String(exp))) === false));
  out.push(A('空 token 被拒绝', (await room.verifyJoinToken('1234', 'p1', '')) === false));

  var past = Date.now() - 1000;
  var pastSig = b64urlEncode(await room.signPayload('1234|p1|' + past));
  out.push(A('已过期 token 校验失败', (await room.verifyJoinToken('1234', 'p1', past + '.' + pastSig)) === false));

  var future = Date.now() + 60000;
  var futureSig = b64urlEncode(await room.signPayload('1234|p1|' + future));
  out.push(A('未过期且签名正确校验通过',
    (await room.verifyJoinToken('1234', 'p1', future + '.' + futureSig)) === true));

  out.push(A('不同 pid 的签名不可互换',
    (await room.verifyJoinToken('1234', 'p2', future + '.' + futureSig)) === false));
  return out;
}

async function passwordTests(RoomDO) {
  var assertions = [];
  var state = makeState();
  var room = new RoomDO(state, {});
  var IP = '10.9.0.1';

  var created = await join(room, { pid: 'p1', password: 'abcd', create: true }, IP);
  assertions.push(A('创建密码房成功并返回 hasPassword', created.ok === true && created.hasPassword === true,
    JSON.stringify(created).slice(0, 80)));

  var meta = await state.storage.get('meta');
  var auth = meta && meta.auth;
  assertions.push(A('auth.algo 为 sha256', !!auth && auth.algo === 'sha256', auth && auth.algo));
  assertions.push(A('auth.length 记录密码长度', !!auth && auth.length === 4, String(auth && auth.length)));

  var salt = b64urlDecode(auth.salt);
  var hash = b64urlDecode(auth.hash);
  assertions.push(A('salt 为 16 字节', salt.length === 16, String(salt.length)));
  assertions.push(A('hash 为 32 字节（SHA-256）', hash.length === 32, String(hash.length)));

  var derived = await passwordDigest(salt, 'abcd');
  assertions.push(A('hash === SHA-256(salt||password)',
    Buffer.compare(Buffer.from(derived), Buffer.from(hash)) === 0));

  assertions.push(A('verifyPassword 接受正确密码', (await room.verifyPassword('abcd', auth)) === true));
  assertions.push(A('verifyPassword 拒绝错误密码', (await room.verifyPassword('abce', auth)) === false));

  var flipped = b64urlDecode(auth.hash);
  flipped[0] ^= 0x01;
  assertions.push(A('同长度篡改 hash 仍返回 false',
    (await room.verifyPassword('abcd', { salt: auth.salt, hash: b64urlEncode(flipped) })) === false));
  assertions.push(A('截短 hash（长度不同）返回 false',
    (await room.verifyPassword('abcd', { salt: auth.salt, hash: auth.hash.slice(0, -2) })) === false));
  assertions.push(A('损坏的 salt 不抛错、返回 false',
    (await room.verifyPassword('abcd', { salt: '!!!', hash: auth.hash })) === false));

  for (var i = 1; i <= 4; i++) {
    var r = await join(room, { pid: 'p1', password: 'wrong' + i }, IP);
    assertions.push(A('第 ' + i + ' 次错误密码返回 bad_password', r.code === 'bad_password', String(r.code)));
  }
  var rate4 = await state.storage.get('rate:' + IP);
  assertions.push(A('前 4 次错误累计 fails=4 且未锁定',
    !!rate4 && rate4.fails === 4 && !rate4.until, JSON.stringify(rate4)));

  var fifth = await join(room, { pid: 'p1', password: 'wrong5' }, IP);
  var rate5 = await state.storage.get('rate:' + IP);
  assertions.push(A('第 5 次错误仍返回 bad_password', fifth.code === 'bad_password', String(fifth.code)));
  assertions.push(A('第 5 次错误触发锁定并清零 fails',
    !!rate5 && rate5.fails === 0 && rate5.until > 0, JSON.stringify(rate5)));
  assertions.push(A('锁定时长约 60 秒',
    !!rate5 && Math.abs(rate5.until - (Date.now() + CONST.PASSWORD_LOCK_MS)) < 5000,
    rate5 ? String(rate5.until - Date.now()) : 'no rate'));

  var locked = await join(room, { pid: 'p1', password: 'abcd' }, IP);
  assertions.push(A('锁定期间即使密码正确也返回 rate_limited', locked.code === 'rate_limited', String(locked.code)));
  assertions.push(A('锁定期 retryAfter 在 1..60 秒之间',
    locked.retryAfter >= 1 && locked.retryAfter <= 60, String(locked.retryAfter)));

  var realNow = Date.now;
  var unlocked;
  try {
    Date.now = function () { return realNow() + CONST.PASSWORD_LOCK_MS + 2000; };
    unlocked = await join(room, { pid: 'p1', password: 'abcd' }, IP);
  } finally {
    Date.now = realNow;
  }
  assertions.push(A('锁定期满后正确密码可加入', unlocked.ok === true, JSON.stringify(unlocked).slice(0, 60)));
  assertions.push(A('成功加入后限流记录被删除', (await state.storage.get('rate:' + IP)) === undefined));

  return { assertions: assertions, lockAfter: 5 };
}

async function passwordFormatTests(RoomDO) {
  var out = [];
  var r1 = await join(new RoomDO(makeState(), {}), { pid: 'p', password: 'abc', create: true }, '10.1.0.1');
  out.push(A('3 位密码创建被拒绝', r1.code === 'bad_password_format', String(r1.code)));

  var r2 = await join(new RoomDO(makeState(), {}), { pid: 'p', password: 'a'.repeat(33), create: true }, '10.1.0.2');
  out.push(A('33 位密码创建被拒绝', r2.code === 'bad_password_format', String(r2.code)));

  var r3 = await join(new RoomDO(makeState(), {}), { pid: 'p', password: 'abcd', create: true }, '10.1.0.3');
  out.push(A('4 位密码可创建（下界）', r3.ok === true, JSON.stringify(r3).slice(0, 50)));

  var r4 = await join(new RoomDO(makeState(), {}), { pid: 'p', password: 'a'.repeat(32), create: true }, '10.1.0.4');
  out.push(A('32 位密码可创建（上界）', r4.ok === true, JSON.stringify(r4).slice(0, 50)));

  return out;
}

async function joinOutcomeTests(RoomDO) {
  var out = [];
  var state = makeState();
  var room = new RoomDO(state, {});
  var IP = '10.2.0.1';
  await join(room, { pid: 'p1', password: 'abcd', create: true }, IP);

  var noPw = await join(room, { pid: 'p2' }, IP);
  out.push(A('已有密码房不带密码 → need_password', noPw.code === 'need_password', String(noPw.code)));

  var again = await join(room, { pid: 'p2', password: 'abcd', create: true }, IP);
  out.push(A('已有密码房再次 create → room_exists', again.code === 'room_exists', String(again.code)));

  var rosterState = makeState({ members: [member('m1', 'p1', 1)] });
  var rosterRoom = new RoomDO(rosterState, {});
  var occupied = await join(rosterRoom, { pid: 'p2', password: 'wxyz', create: true }, '10.2.0.2');
  out.push(A('非空房间不能被后来者加密码占用', occupied.code === 'room_exists', String(occupied.code)));

  var openState = makeState();
  var openRoom = new RoomDO(openState, {});
  var opened = await join(openRoom, { pid: 'p3', create: true }, '10.2.0.3');
  out.push(A('无密码房可创建且 hasPassword=false', opened.ok === true && opened.hasPassword === false));
  var openMeta = await openState.storage.get('meta');
  out.push(A('无密码房不写入 auth', !!openMeta && openMeta.auth === undefined));

  var ignored = await join(openRoom, { pid: 'p4', password: 'ignored' }, '10.2.0.4');
  var ignoredMeta = await openState.storage.get('meta');
  out.push(A('无密码房提交的密码被忽略', ignored.ok === true && ignoredMeta.auth === undefined));

  return out;
}

async function capacityTests(RoomDO) {
  var assertions = [];
  var members4 = [
    member('m1', 'p1', 1), member('m2', 'p2', 2),
    member('m3', 'p3', 3), member('m4', 'p4', 4)
  ];

  // 4 active members -> 5th rejected.
  var fullState = makeState({ members: members4 });
  var fullRoom = new RoomDO(fullState, {});
  fullRoom.roomCode = '1234';
  members4.forEach(function (m) {
    var sock = makeSocket();
    sock.serializeAttachment({ id: m.id, name: m.name, room: '1234', pid: m.pid });
    fullState.acceptWebSocket(sock);
  });
  var fifthToken = await fullRoom.makeJoinToken('1234', 'p5');
  var fullRes = await fullRoom.fetch(wsRequest('p5', fifthToken, 'e'));
  var rejected = fullState._sockets[fullState._sockets.length - 1];
  assertions.push(A('4 人之后第 5 人被满员拒绝',
    fullRes.status === 101 && !!lastError(rejected) && lastError(rejected).code === 'room_full',
    JSON.stringify(lastError(rejected))));
  assertions.push(A('满员连接以 4001 关闭', !!rejected.closed && rejected.closed.code === 4001,
    JSON.stringify(rejected.closed)));
  assertions.push(A('满员拒绝不写成员表（仍为 4）',
    (await fullState.storage.get('members')).length === 4));

  // 3 active -> 4th accepted.
  var acceptState = makeState({ members: members4.slice(0, 3) });
  var acceptRoom = new RoomDO(acceptState, {});
  acceptRoom.roomCode = '1234';
  members4.slice(0, 3).forEach(function (m) {
    var sock = makeSocket();
    sock.serializeAttachment({ id: m.id, name: m.name, room: '1234', pid: m.pid });
    acceptState.acceptWebSocket(sock);
  });
  var fourthToken = await acceptRoom.makeJoinToken('1234', 'p4');
  var fourthRes = await acceptRoom.fetch(wsRequest('p4', fourthToken, 'd'));
  var fourthSock = acceptState._sockets[acceptState._sockets.length - 1];
  var welcome = fourthSock.sent.filter(function (m) { return m.type === 'welcome'; })[0];
  assertions.push(A('第 4 人可以加入', fourthRes.status === 101 && !!welcome, String(fourthRes.status)));
  assertions.push(A('成员表增加到 4', (await acceptState.storage.get('members')).length === 4));

  // Same pid reconnects while 4 active -> takeover, not a 5th seat.
  var takeState = makeState({ members: members4 });
  var takeRoom = new RoomDO(takeState, {});
  takeRoom.roomCode = '1234';
  members4.forEach(function (m) {
    var sock = makeSocket();
    sock.serializeAttachment({ id: m.id, name: m.name, room: '1234', pid: m.pid });
    takeState.acceptWebSocket(sock);
  });
  var oldSock = takeState._sockets[0];
  var reconnectToken = await takeRoom.makeJoinToken('1234', 'p1');
  var reconnectRes = await takeRoom.fetch(wsRequest('p1', reconnectToken, 'again'));
  var newSock = takeState._sockets[takeState._sockets.length - 1];
  var reWelcome = newSock.sent.filter(function (m) { return m.type === 'welcome'; })[0];
  assertions.push(A('满员时同一 pid 重连被允许（接管座位）', reconnectRes.status === 101));
  assertions.push(A('旧连接以 4003 replaced 关闭',
    !!oldSock.closed && oldSock.closed.code === 4003, JSON.stringify(oldSock.closed)));
  assertions.push(A('重连沿用原 id，不新增第 5 个成员',
    !!reWelcome && reWelcome.selfId === 'm1' &&
    (await takeState.storage.get('members')).length === 4,
    reWelcome ? reWelcome.selfId : 'no welcome'));

  // Same pid while its member is offline within the grace window.
  var offState = makeState({ members: [member('m1', 'p1', 1)] });
  offState.storage._map.get('members')[0].leftAt = Date.now() - 1000;
  var offRoom = new RoomDO(offState, {});
  offRoom.roomCode = '1234';
  var offToken = await offRoom.makeJoinToken('1234', 'p1');
  var offRes = await offRoom.fetch(wsRequest('p1', offToken, 'back'));
  var offSock = offState._sockets[offState._sockets.length - 1];
  var offWelcome = offSock.sent.filter(function (m) { return m.type === 'welcome'; })[0];
  assertions.push(A('宽限期内同一 pid 重连恢复原座位',
    offRes.status === 101 && !!offWelcome && offWelcome.selfId === 'm1' &&
    (await offState.storage.get('members')).length === 1,
    offWelcome ? offWelcome.selfId : 'no welcome'));

  // Missing token never reaches the socket.
  var guardRoom = new RoomDO(makeState(), {});
  var guardRes = await guardRoom.fetch(wsRequest('p9', ''));
  assertions.push(A('缺少 token 的升级请求被 403 拒绝', guardRes.status === 403, String(guardRes.status)));

  return { assertions: assertions, maxMembers: 4 };
}

async function moveRoom(RoomDO, kind, overrides) {
  var members = [member('m1', 'p1', 1), member('m2', 'p2', 2)];
  var game = Object.assign({
    kind: kind,
    board: new Array(BOARD_SIZE[kind]).fill(null),
    turn: 'X',
    winner: null,
    line: null,
    xId: 'm1',
    oId: 'm2',
    scores: { X: 0, O: 0 },
    round: 1,
    updatedAt: 1
  }, overrides || {});
  var state = makeState({ members: members, game: game });
  var room = new RoomDO(state, {});
  room.roomCode = '1234';
  var s1 = makeSocket();
  var s2 = makeSocket();
  s1.serializeAttachment({ id: 'm1', name: 'a', room: '1234', pid: 'p1' });
  s2.serializeAttachment({ id: 'm2', name: 'b', room: '1234', pid: 'p2' });
  state.acceptWebSocket(s1);
  state.acceptWebSocket(s2);
  return { room: room, state: state, members: members, s1: s1, s2: s2 };
}

async function moveTests(RoomDO) {
  var out = [];

  // ---- tic-tac-toe ----
  var ttt = await moveRoom(RoomDO, 'ttt');
  await ttt.room.handleMove(ttt.members, ttt.members[0], { x: 3, y: 0 });
  out.push(A('井字棋 x=3 越界被拒绝', !!lastError(ttt.s1) && lastError(ttt.s1).code === 'bad_move'));
  var tttGame = await ttt.state.storage.get('game');
  out.push(A('越界落子不改变棋盘', tttGame.board.every(function (v) { return v === null; })));

  await ttt.room.handleMove(ttt.members, ttt.members[0], { x: 0, y: 0 });
  tttGame = await ttt.state.storage.get('game');
  out.push(A('合法落子写入 X 并轮到 O', tttGame.board[0] === 'X' && tttGame.turn === 'O',
    JSON.stringify(tttGame.board.slice(0, 3))));
  out.push(A('game_state 广播给双方', hasType(ttt.s1, 'game_state') && hasType(ttt.s2, 'game_state')));

  await ttt.room.handleMove(ttt.members, ttt.members[0], { x: 1, y: 0 });
  out.push(A('非当前回合落子被拒绝', !!lastError(ttt.s1) && lastError(ttt.s1).code === 'not_your_turn'));

  await ttt.room.handleMove(ttt.members, ttt.members[1], { x: 1, y: 0 });
  tttGame = await ttt.state.storage.get('game');
  out.push(A('对手回合可正常落 O', tttGame.board[1] === 'O' && tttGame.turn === 'X'));

  await ttt.room.handleMove(ttt.members, ttt.members[0], { x: 1, y: 0 });
  out.push(A('已占用的格子被拒绝', !!lastError(ttt.s1) && lastError(ttt.s1).code === 'cell_taken'));

  await ttt.room.handleMove(ttt.members, ttt.members[0], { index: 8 });
  tttGame = await ttt.state.storage.get('game');
  out.push(A('兼容旧版 {index} 落子', tttGame.board[8] === 'X', JSON.stringify(tttGame.board)));

  var tttWin = await moveRoom(RoomDO, 'ttt', {
    board: ['X', 'X', null, 'O', 'O', null, null, null, null], turn: 'X'
  });
  await tttWin.room.handleMove(tttWin.members, tttWin.members[0], { x: 2, y: 0 });
  tttGame = await tttWin.state.storage.get('game');
  out.push(A('井字棋连成三子判胜',
    tttGame.winner === 'X' && JSON.stringify(tttGame.line) === '[0,1,2]' && tttGame.scores.X === 1,
    JSON.stringify({ winner: tttGame.winner, line: tttGame.line, scores: tttGame.scores })));

  var tttDraw = await moveRoom(RoomDO, 'ttt', {
    board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', null], turn: 'X'
  });
  await tttDraw.room.handleMove(tttDraw.members, tttDraw.members[0], { x: 2, y: 2 });
  tttGame = await tttDraw.state.storage.get('game');
  out.push(A('井字棋棋盘填满无胜者判和', tttGame.winner === 'draw', String(tttGame.winner)));

  var tttWaitingMember = member('m1', 'p1', 1);
  var tttWaitingState = makeState({
    members: [tttWaitingMember],
    game: {
      kind: 'ttt', board: new Array(9).fill(null), turn: 'X', winner: null, line: null,
      xId: 'm1', oId: null, scores: { X: 0, O: 0 }, round: 1, updatedAt: 1
    }
  });
  var tttWaitingRoom = new RoomDO(tttWaitingState, {});
  tttWaitingRoom.roomCode = '1234';
  var tttWaitingSock = makeSocket();
  tttWaitingSock.serializeAttachment({ id: 'm1', name: 'a', room: '1234', pid: 'p1' });
  tttWaitingState.acceptWebSocket(tttWaitingSock);
  await tttWaitingRoom.handleMove([tttWaitingMember], tttWaitingMember, { x: 0, y: 0 });
  out.push(A('缺少第二位玩家时拒绝落子',
    !!lastError(tttWaitingSock) && lastError(tttWaitingSock).code === 'waiting_peer'));

  var tttOver = await moveRoom(RoomDO, 'ttt', { winner: 'X' });
  await tttOver.room.handleMove(tttOver.members, tttOver.members[0], { x: 0, y: 0 });
  out.push(A('终局后继续落子被拒绝',
    !!lastError(tttOver.s1) && lastError(tttOver.s1).code === 'game_over'));

  // ---- gomoku ----
  var g5 = await moveRoom(RoomDO, 'gomoku');
  await g5.room.handleMove(g5.members, g5.members[0], { x: 15, y: 0 });
  out.push(A('五子棋 x=15 越界被拒绝', !!lastError(g5.s1) && lastError(g5.s1).code === 'bad_move'));
  await g5.room.handleMove(g5.members, g5.members[0], { x: 0, y: -1 });
  out.push(A('五子棋 y=-1 越界被拒绝', !!lastError(g5.s1) && lastError(g5.s1).code === 'bad_move'));

  await g5.room.handleMove(g5.members, g5.members[0], { x: 0, y: 0 });
  var g5Game = await g5.state.storage.get('game');
  out.push(A('五子棋按 y*15+x 落子', g5Game.board[0] === 'X' && g5Game.turn === 'O'));

  await g5.room.handleMove(g5.members, g5.members[1], { x: 1, y: 0 });
  await g5.room.handleMove(g5.members, g5.members[0], { x: 1, y: 0 });
  out.push(A('五子棋已占位被拒绝', !!lastError(g5.s1) && lastError(g5.s1).code === 'cell_taken'));

  var g5Board = new Array(225).fill(null);
  for (var gx = 0; gx < 4; gx++) g5Board[5 * 15 + gx] = 'X';
  var g5Win = await moveRoom(RoomDO, 'gomoku', { board: g5Board, turn: 'X' });
  await g5Win.room.handleMove(g5Win.members, g5Win.members[0], { x: 4, y: 5 });
  g5Game = await g5Win.state.storage.get('game');
  out.push(A('五子棋连成五子判胜并给出连线',
    g5Game.winner === 'X' && Array.isArray(g5Game.line) && g5Game.line.length === 5 &&
    g5Game.line.indexOf(75) >= 0 && g5Game.scores.X === 1,
    JSON.stringify({ winner: g5Game.winner, line: g5Game.line })));

  // ---- connect four ----
  var c4 = await moveRoom(RoomDO, 'connect4');
  await c4.room.handleMove(c4.members, c4.members[0], { x: 7 });
  out.push(A('四子棋 x=7 越界被拒绝', !!lastError(c4.s1) && lastError(c4.s1).code === 'bad_move'));
  await c4.room.handleMove(c4.members, c4.members[0], { x: -1 });
  out.push(A('四子棋 x=-1 越界被拒绝', !!lastError(c4.s1) && lastError(c4.s1).code === 'bad_move'));

  var fullCol = new Array(42).fill(null);
  for (var cr = 0; cr < 6; cr++) fullCol[cr * 7] = cr % 2 ? 'O' : 'X';
  var c4Full = await moveRoom(RoomDO, 'connect4', { board: fullCol });
  await c4Full.room.handleMove(c4Full.members, c4Full.members[0], { x: 0 });
  out.push(A('四子棋满列被拒绝',
    !!lastError(c4Full.s1) && lastError(c4Full.s1).code === 'column_full'));

  await c4.room.handleMove(c4.members, c4.members[0], { x: 3 });
  var c4Game = await c4.state.storage.get('game');
  out.push(A('四子棋落子受重力影响（落到最底行）',
    c4Game.board[5 * 7 + 3] === 'X' && c4Game.turn === 'O', String(c4Game.board[38])));
  await c4.room.handleMove(c4.members, c4.members[1], { x: 3 });
  c4Game = await c4.state.storage.get('game');
  out.push(A('同列第二子叠在上一子之上', c4Game.board[4 * 7 + 3] === 'O'));

  var c4WinBoard = new Array(42).fill(null);
  c4WinBoard[5 * 7 + 0] = 'X';
  c4WinBoard[5 * 7 + 1] = 'X';
  c4WinBoard[5 * 7 + 2] = 'X';
  var c4Win = await moveRoom(RoomDO, 'connect4', { board: c4WinBoard, turn: 'X' });
  await c4Win.room.handleMove(c4Win.members, c4Win.members[0], { x: 3 });
  c4Game = await c4Win.state.storage.get('game');
  out.push(A('四子棋横向连成四子判胜',
    c4Game.winner === 'X' && Array.isArray(c4Game.line) && c4Game.line.length === 4 &&
    c4Game.scores.X === 1,
    JSON.stringify({ winner: c4Game.winner, line: c4Game.line })));

  return out;
}

async function hostTests(RoomDO) {
  var out = [];
  var h = await moveRoom(RoomDO, 'ttt');

  await h.room.handleReset(h.members, h.members[1], {});
  out.push(A('非房主开新局被拒绝', !!lastError(h.s2) && lastError(h.s2).code === 'host_only'));
  await h.room.handleSelect(h.members, h.members[1], { kind: 'gomoku' });
  out.push(A('非房主换游戏被拒绝', !!lastError(h.s2) && lastError(h.s2).code === 'host_only'));

  await h.room.handleSelect(h.members, h.members[0], { kind: 'chess' });
  out.push(A('不支持的游戏类型被拒绝', !!lastError(h.s1) && lastError(h.s1).code === 'bad_game'));

  await h.room.handleSelect(h.members, h.members[0], { kind: 'gomoku' });
  var game = await h.state.storage.get('game');
  out.push(A('房主换游戏生效',
    game.kind === 'gomoku' && game.board.length === 225 && game.round === 2,
    JSON.stringify({ kind: game.kind, size: game.board.length, round: game.round })));

  var scored = await moveRoom(RoomDO, 'ttt', { scores: { X: 2, O: 1 } });
  await scored.room.handleReset(scored.members, scored.members[0], {});
  game = await scored.state.storage.get('game');
  out.push(A('房主开新局：清盘、轮次 +1、比分保留',
    game.board.every(function (v) { return v === null; }) &&
    game.round === 2 && game.scores.X === 2 && game.scores.O === 1,
    JSON.stringify({ round: game.round, scores: game.scores })));

  return out;
}

async function messageTests(RoomDO) {
  var out = [];
  var m = await moveRoom(RoomDO, 'ttt');

  await m.room.webSocketMessage(m.s1, '{oops');
  out.push(A('非法 JSON 返回 bad_json', !!lastError(m.s1) && lastError(m.s1).code === 'bad_json'));

  var before = m.s1.sent.length;
  await m.room.webSocketMessage(m.s1, new Uint8Array([1, 2, 3]));
  out.push(A('二进制帧被忽略', m.s1.sent.length === before));

  await m.room.webSocketMessage(m.s1, JSON.stringify({ type: 'ping', room: '9999' }));
  out.push(A('跨房间消息被拒绝', !!lastError(m.s1) && lastError(m.s1).code === 'room_mismatch'));

  await m.room.webSocketMessage(m.s1, JSON.stringify({ type: 'wat', room: '1234' }));
  out.push(A('未知消息类型被拒绝', !!lastError(m.s1) && lastError(m.s1).code === 'unknown_type'));

  var beforeLong = m.s1.sent.length;
  await m.room.webSocketMessage(m.s1, 'x'.repeat(40001));
  out.push(A('超长消息被直接忽略', m.s1.sent.length === beforeLong));

  await m.room.webSocketMessage(m.s1, JSON.stringify({ type: 'ping', room: '1234', t: 123 }));
  var pong = m.s1.sent.filter(function (x) { return x.type === 'pong'; })[0];
  out.push(A('ping 返回 pong 并回显时间戳', !!pong && pong.t === 123, JSON.stringify(pong)));

  var ghost = makeSocket();
  ghost.serializeAttachment({ id: 'ghost', name: 'g', room: '1234', pid: 'pg' });
  m.state.acceptWebSocket(ghost);
  await m.room.webSocketMessage(ghost, JSON.stringify({ type: 'ping', room: '1234' }));
  out.push(A('不在成员表的连接被拒绝', !!lastError(ghost) && lastError(ghost).code === 'not_member'));

  return out;
}

/* ------------------------------------------------------------------ *
 * Main                                                               *
 * ------------------------------------------------------------------ */

async function main() {
  // Cloudflare globals the Worker expects. Response with status 101 is not
  // legal in undici, and WebSocketPair does not exist outside Workers.
  globalThis.Response = class FakeResponse {
    constructor(body, init) {
      this.body = body;
      this.status = (init && init.status) || 200;
      this.headers = (init && init.headers) || {};
      this.webSocket = init && init.webSocket;
    }
    async json() { return JSON.parse(this.body); }
  };
  globalThis.WebSocketPair = function () {
    this[0] = makeSocket();
    this[1] = makeSocket();
  };

  var mod = await import(pathToFileURL(ROOM_PATH).href);
  var RoomDO = mod.RoomDO;
  if (typeof RoomDO !== 'function') throw new Error('RoomDO export not found');

  var tokens = await tokenTests(RoomDO);
  var passwords = await passwordTests(RoomDO);
  var formats = await passwordFormatTests(RoomDO);
  var outcomes = await joinOutcomeTests(RoomDO);
  var capacity = await capacityTests(RoomDO);
  var moves = await moveTests(RoomDO);
  var host = await hostTests(RoomDO);
  var messages = await messageTests(RoomDO);

  s.group('1. 重连 token：生成、24h 有效期、篡改/过期/换 pid 拒绝', function () {
    tokens.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return tokens.length + ' 项';
  });

  s.group('2. 密码房：SHA-256(salt||password)、常量时间比较、5 次失败锁 60s', function () {
    passwords.assertions.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return '5 次失败触发锁定';
  });

  s.group('3. 密码长度边界 4–32 与加入结果', function () {
    formats.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    outcomes.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return (formats.length + outcomes.length) + ' 项';
  });

  s.group('4. 房间容量：4 人上限、重连接管、缺 token 拒绝', function () {
    capacity.assertions.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return '实测上限 ' + capacity.maxMembers + ' 人';
  });

  s.group('5. 落子合法性：井字棋/五子棋/四子棋非法落子均被服务端拒绝', function () {
    moves.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return moves.length + ' 项';
  });

  s.group('6. 房主权限：仅房主可开新局/换游戏', function () {
    host.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return host.length + ' 项';
  });

  s.group('7. 消息封套校验：JSON/房间号/类型/超长/非成员', function () {
    messages.forEach(function (a) { s.ok(a[0], a[1], a[2]); });
    return messages.length + ' 项';
  });

  s.group('8. 源文件常量镜像与实测行为一致', function () {
    s.eq('MAX_MEMBERS 与实测上限一致', CONST.MAX_MEMBERS, capacity.maxMembers);
    s.eq('MAX_PASSWORD_FAILS 与实测锁定阈值一致', CONST.MAX_PASSWORD_FAILS, passwords.lockAfter);
    s.eq('PASSWORD_LOCK_MS = 60s', CONST.PASSWORD_LOCK_MS, 60000);
    s.eq('PASSWORD_MIN/PASSWORD_MAX = 4/32', [CONST.PASSWORD_MIN, CONST.PASSWORD_MAX], [4, 32]);
    s.eq('JOIN_TOKEN_TTL_MS = 24h', CONST.JOIN_TOKEN_TTL_MS, 86400000);
    s.eq('RECONNECT_GRACE_MS = 60s', CONST.RECONNECT_GRACE_MS, 60000);
    return '常量读取自 worker/src/room.js';
  });

  s.done();
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  s.ok('测试脚本整体执行未抛错', false, String(err && err.message));
  s.done();
  process.exitCode = 1;
});
