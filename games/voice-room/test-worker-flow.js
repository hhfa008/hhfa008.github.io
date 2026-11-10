'use strict';

/*
 * voice-room worker tests.
 *
 * The production Worker is an ES module (worker/src/index.js) backed by a
 * Durable Object (worker/src/room.js). Cloudflare provides Request/Response,
 * WebSocketPair and the DurableObjectState storage/socket APIs, so the test
 * installs small in-process fakes for the pieces Node does not ship:
 *   - WebSocketPair + a socket object with attachment/send/close
 *   - Response with status 101 support (Node's Response rejects 101)
 *   - DurableObjectState.storage (Map) and accept/getWebSockets
 *
 * Nothing here touches the network: the room number, member cap, password,
 * host hand-off, server-side move validation and reconnect flow are exercised
 * against the real worker code.
 */

var path = require('path');
var url = require('url');
var lib = require('../tests/lib.js');

var s = lib.suite('voice-room worker flow');

var ROOM_MODULE = url.pathToFileURL(
  path.join(__dirname, 'worker', 'src', 'room.js'),
).href;
var WORKER_MODULE = url.pathToFileURL(
  path.join(__dirname, 'worker', 'src', 'index.js'),
).href;

// ---------------------------------------------------------------------------
// Cloudflare API fakes
// ---------------------------------------------------------------------------

function FakeSocket() {
  this.attachment = null;
  this.sent = [];
  this.closed = null;
}

FakeSocket.prototype.serializeAttachment = function (value) {
  this.attachment = value;
};
FakeSocket.prototype.deserializeAttachment = function () {
  return this.attachment;
};
FakeSocket.prototype.send = function (data) {
  this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
};
FakeSocket.prototype.close = function (code, reason) {
  this.closed = { code: code, reason: reason };
};

function installCloudflareFakes() {
  globalThis.WebSocketPair = function WebSocketPair() {
    return [new FakeSocket(), new FakeSocket()];
  };

  var RealResponse = globalThis.Response;
  function FakeResponse(body, init) {
    init = init || {};
    this.body = body;
    this.status = init.status || 200;
    this.headers = init.headers || {};
    this.webSocket = init.webSocket || null;
    this._real = null;
  }
  FakeResponse.prototype.json = function () {
    return Promise.resolve(JSON.parse(this.body == null ? 'null' : String(this.body)));
  };
  FakeResponse.prototype.text = function () {
    return Promise.resolve(this.body == null ? '' : String(this.body));
  };
  globalThis.Response = FakeResponse;

  return function restore() {
    globalThis.Response = RealResponse;
  };
}

function fakeState() {
  var store = new Map();
  var sockets = new Set();
  var alarm = null;
  var state = {
    storage: {
      get: function (key) {
        return Promise.resolve(store.has(key) ? store.get(key) : undefined);
      },
      put: function (key, value) {
        store.set(key, value);
        return Promise.resolve();
      },
      delete: function (key) {
        store.delete(key);
        return Promise.resolve();
      },
      deleteAll: function () {
        store.clear();
        return Promise.resolve();
      },
      setAlarm: function (at) {
        alarm = at;
        return Promise.resolve();
      },
      deleteAlarm: function () {
        alarm = null;
        return Promise.resolve();
      },
      getAlarm: function () {
        return Promise.resolve(alarm);
      },
    },
    getWebSockets: function () {
      return Array.from(sockets);
    },
    acceptWebSocket: function (ws) {
      sockets.add(ws);
    },
    _store: store,
    _sockets: sockets,
  };
  return state;
}

// ---------------------------------------------------------------------------
// Rig helpers
// ---------------------------------------------------------------------------

async function makeRig(defaultRoom) {
  var RoomDO = (await import(ROOM_MODULE)).RoomDO;
  var worker = (await import(WORKER_MODULE)).default;
  var entries = new Map();

  function entryFor(id) {
    var entry = entries.get(id);
    if (!entry) {
      var state = fakeState();
      var room = new RoomDO(state, {});
      entry = {
        state: state,
        room: room,
        stub: {
          fetch: function (request) {
            return room.fetch(request);
          },
        },
      };
      entries.set(id, entry);
    }
    return entry;
  }

  // The edge worker names each Durable Object `room:<4 digits>`.
  var first = entryFor('room:' + (defaultRoom || '0000'));
  var env = {
    ROOMS: {
      idFromName: function (name) {
        return name;
      },
      get: function (id) {
        return entryFor(id).stub;
      },
    },
  };
  return { worker: worker, env: env, room: first.room, state: first.state };
}

function postJson(rig, pathname, body) {
  return rig.worker.fetch(
    new Request('https://room.test' + pathname, {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    rig.env,
    {},
  );
}

async function join(rig, room, pid, password, create) {
  var res = await postJson(rig, '/api/join', {
    room: room,
    pid: pid,
    password: password,
    create: create === true,
  });
  var body = await res.json();
  return { status: res.status, body: body };
}

function connectRequest(room, pid, name, token) {
  return new Request(
    'https://room.test/ws?room=' + encodeURIComponent(room) +
      '&pid=' + encodeURIComponent(pid) +
      '&name=' + encodeURIComponent(name || '') +
      '&token=' + encodeURIComponent(token || ''),
    { headers: { Origin: 'http://localhost', Upgrade: 'websocket' } },
  );
}

async function connect(rig, room, pid, name, token) {
  var res = await rig.worker.fetch(connectRequest(room, pid, name, token), rig.env, {});
  var server = null;
  if (res.status === 101) {
    var arr = Array.from(rig.state._sockets);
    server = arr[arr.length - 1] || null;
  }
  return { status: res.status, webSocket: res.webSocket, server: server, response: res };
}

async function joinAndConnect(rig, room, pid, name, password, create) {
  var j = await join(rig, room, pid, password, create);
  if (!j.body || !j.body.token) return { join: j, connect: null };
  var c = await connect(rig, room, pid, name, j.body.token);
  // Host and seat order are joinedAt-first (then id); keep sequential joins in
  // distinct milliseconds so the ordering is the one the test intends.
  if (c.status === 101) await new Promise(function (resolve) { setTimeout(resolve, 3); });
  return { join: j, connect: c };
}

function lastMessage(socket, type) {
  for (var i = socket.sent.length - 1; i >= 0; i--) {
    var m = socket.sent[i];
    if (!type || m.type === type) return m;
  }
  return null;
}

function lastError(socket) {
  return lastMessage(socket, 'error');
}

async function send(rig, socket, message) {
  await rig.room.webSocketMessage(socket, JSON.stringify(message));
}

async function disconnect(rig, socket) {
  // Cloudflare removes the closed socket from getWebSockets(); do the same so
  // normalizeRoster() sees the member as offline.
  rig.state._sockets.delete(socket);
  await rig.room.webSocketClose(socket, 1000, '', true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async function main() {
  var restoreResponse = installCloudflareFakes();
  try {
    // --- room number must be exactly four digits -------------------------
    await (async function roomNumber() {
      var rig = await makeRig('0000');
      for (var bad of ['', '123', '12345', '12a4', ' 123', 'abcd']) {
        var res = await postJson(rig, '/api/join', { room: bad, pid: 'p1', create: true });
        var body = await res.json();
        s.eq('room "' + bad + '" rejected', [res.status, body.code], [400, 'bad_room']);
      }
      var directRig = await makeRig('9999');
      var direct = await directRig.room.fetch(
        new Request('https://room.test/join?room=12', { method: 'POST', body: '{}' }),
      );
      s.eq('Durable Object rejects a non-4-digit room', direct.status, 400);
      var ok = await join(rig, '0000', 'p1', '', true);
      s.eq('4-digit room accepted', [ok.status, ok.body.ok], [200, true]);
    })();

    // --- optional password ------------------------------------------------
    await (async function password() {
      var rig = await makeRig('4731');
      var created = await join(rig, '4731', 'p1', 'abcd', true);
      s.eq('create with 4-char password', [created.status, created.body.ok, created.body.hasPassword],
        [200, true, true]);

      var shortPw = await join(rig, '4732', 'p1', 'abc', true);
      s.eq('short password rejected', [shortPw.body.ok, shortPw.body.code], [false, 'bad_password_format']);

      var wrong = await join(rig, '4731', 'p2', 'nope', false);
      s.eq('wrong password rejected', [wrong.body.ok, wrong.body.code], [false, 'bad_password']);
      var missing = await join(rig, '4731', 'p2', '', false);
      s.eq('password required when set', [missing.body.ok, missing.body.code], [false, 'need_password']);
      var right = await join(rig, '4731', 'p2', 'abcd', false);
      s.eq('correct password accepted', right.body.ok, true);

      var exists = await join(rig, '4731', 'p3', 'abcd', true);
      s.eq('password cannot be replaced on a live room', exists.body.code, 'room_exists');

      // Five bad guesses lock the source for a minute.
      var lockRoom = '4733';
      await join(rig, lockRoom, 'host', 'wxyz', true);
      for (var i = 0; i < 5; i++) await join(rig, lockRoom, 'guess' + i, 'bad', false);
      var locked = await join(rig, lockRoom, 'guess5', 'bad', false);
      s.eq('rate limited after five failures', locked.body.code, 'rate_limited');

      var open = await makeRig('4734');
      var plain = await join(open, '4734', 'p1', '', true);
      s.eq('passwordless room has no lock', plain.body.hasPassword, false);
      var ignored = await join(open, '4734', 'p2', 'anything', false);
      s.eq('password ignored when room has none', ignored.body.ok, true);
    })();

    // --- maximum four members --------------------------------------------
    await (async function memberCap() {
      var rig = await makeRig('5111');
      var room = '5111';
      for (var i = 1; i <= 4; i++) {
        var got = await joinAndConnect(rig, room, 'p' + i, 'P' + i, '', i === 1);
        s.eq('member ' + i + ' connected', [got.join.body.ok, got.connect.status], [true, 101]);
      }
      s.eq('roster holds four members', rig.state._store.get('members').length, 4);

      var fifthJoin = await join(rig, room, 'p5', '', false);
      var fifth = await connect(rig, room, 'p5', 'P5', fifthJoin.body.token);
      s.eq('fifth connection still upgrades then closes', fifth.status, 101);
      s.eq('fifth socket gets room_full', [lastError(fifth.server).code, fifth.server.closed.code],
        ['room_full', 4001]);
      s.eq('roster still four after rejected fifth', rig.state._store.get('members').length, 4);
      s.ok('fifth name never entered the roster',
        rig.state._store.get('members').every(function (m) { return m.name !== 'P5'; }));
    })();

    // --- host transfer ----------------------------------------------------
    await (async function hostTransfer() {
      var rig = await makeRig('5222');
      var room = '5222';
      var p1 = await joinAndConnect(rig, room, 'p1', 'Host', '', true);
      var p2 = await joinAndConnect(rig, room, 'p2', 'Second', '', false);
      var p3 = await joinAndConnect(rig, room, 'p3', 'Third', '', false);
      var hostId = lastMessage(p1.connect.server, 'welcome').selfId;
      s.eq('first member is host', lastMessage(p2.connect.server, 'welcome').hostId, hostId);

      await disconnect(rig, p1.connect.server);
      var stored = rig.state._store.get('members');
      var first = stored.find(function (m) { return m.id === hostId; });
      s.ok('disconnected host stays in roster during grace', first && first.leftAt != null);
      s.eq('host crown survives the grace window',
        lastMessage(p2.connect.server, 'room_state').hostId, hostId);

      // Expire the grace window: the next member must inherit the crown.
      first.leftAt = Date.now() - 61 * 1000;
      await rig.room.normalizeRoster();
      var remaining = rig.state._store.get('members').map(function (m) { return m.name; });
      s.eq('expired host is dropped', remaining.indexOf('Host'), -1);

      await send(rig, p2.connect.server, { type: 'game_select', room: room, kind: 'gomoku' });
      var p2Select = lastMessage(p2.connect.server, 'game_state');
      s.ok('second member can now act as host', p2Select && p2Select.game.kind === 'gomoku');

      await send(rig, p3.connect.server, { type: 'game_reset', room: room });
      s.eq('third member is still not host', lastError(p3.connect.server).code, 'host_only');
    })();

    // --- server-side move validation -------------------------------------
    await (async function moveValidation() {
      var rig = await makeRig('5333');
      var room = '5333';
      var p1 = await joinAndConnect(rig, room, 'p1', 'X', '', true);
      var p2 = await joinAndConnect(rig, room, 'p2', 'O', '', false);

      await send(rig, p2.connect.server, { type: 'game_move', room: room, x: 0, y: 0 });
      s.eq('out-of-turn move refused', lastError(p2.connect.server).code, 'not_your_turn');

      await send(rig, p1.connect.server, { type: 'game_move', room: room, x: 0, y: 0 });
      var afterX = lastMessage(p1.connect.server, 'game_state');
      s.eq('server places X and flips turn', [afterX.game.board[0], afterX.game.turn], ['X', 'O']);

      await send(rig, p2.connect.server, { type: 'game_move', room: room, x: 0, y: 0 });
      s.eq('occupied cell refused', lastError(p2.connect.server).code, 'cell_taken');
      await send(rig, p2.connect.server, { type: 'game_move', room: room, x: 9, y: 9 });
      s.eq('out-of-range ttt move refused', lastError(p2.connect.server).code, 'bad_move');

      // Client messages only carry coordinates; the socket attachment decides
      // who is X/O and which turn it is.
      await send(rig, p2.connect.server, { type: 'game_move', room: room, x: 1, y: 0 });
      var afterO = lastMessage(p2.connect.server, 'game_state');
      s.eq('server places O for the second seat', [afterO.game.board[1], afterO.game.turn], ['O', 'X']);

      await send(rig, p1.connect.server, { type: 'game_select', room: room, kind: 'gomoku' });
      var gomoku = lastMessage(p1.connect.server, 'game_state');
      s.eq('host can switch the game', gomoku.game.kind, 'gomoku');

      await send(rig, p1.connect.server, { type: 'game_move', room: room, x: 15, y: 0 });
      s.eq('gomoku edge rejected', lastError(p1.connect.server).code, 'bad_move');
      await send(rig, p1.connect.server, { type: 'game_move', room: room, x: 1, y: 1 });
      var afterGomoku = lastMessage(p1.connect.server, 'game_state');
      s.eq('gomoku move lands at y*15+x', [afterGomoku.game.board[16], afterGomoku.game.turn], ['X', 'O']);
    })();

    // --- disconnect / reconnect ------------------------------------------
    await (async function reconnect() {
      var rig = await makeRig('5444');
      var room = '5444';
      var first = await joinAndConnect(rig, room, 'p1', 'Alice', '', true);
      var p2 = await joinAndConnect(rig, room, 'p2', 'Bob', '', false);
      var selfId = lastMessage(first.connect.server, 'welcome').selfId;

      await disconnect(rig, first.connect.server);
      var offline = rig.state._store.get('members').find(function (m) { return m.id === selfId; });
      s.ok('member marked offline, not removed', offline && offline.leftAt != null);

      var rejoin = await join(rig, room, 'p1', '', false);
      s.eq('reconnect token still issued', rejoin.body.ok, true);
      var again = await connect(rig, room, 'p1', 'Alice', rejoin.body.token);
      var welcome = lastMessage(again.server, 'welcome');
      s.eq('reconnect takes the same seat', welcome.selfId, selfId);
      s.eq('reconnect does not add a member', rig.state._store.get('members').length, 2);
      s.eq('reconnected member is online again',
        rig.state._store.get('members').find(function (m) { return m.id === selfId; }).leftAt, null);

      // A second connection for the same pid replaces the live socket; the old
      // one is closed and the newer one keeps the single seat.
      var stale = await connect(rig, room, 'p1', 'Alice', first.join.body.token);
      s.eq('replaced socket is closed', again.server.closed.code, 4003);
      s.eq('stale reconnect keeps one seat', rig.state._store.get('members').length, 2);
    })();
  } catch (err) {
    s.ok('unhandled exception', false, err && err.stack ? err.stack : String(err));
  } finally {
    restoreResponse();
  }
  s.done();
})();
