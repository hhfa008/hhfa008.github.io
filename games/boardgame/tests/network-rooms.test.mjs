'use strict';

/*
 * L3 contract: rooms, invites, password rooms, reconnect and the voice seam.
 *
 * Preferred: an importable app/rooms.mjs (or worker/server module).
 * Fallback: a local HTTP service exposing /api/rooms*.
 * Neither present => SKIP (strict mode fails).
 *
 * Voice is intentionally interface-only: membership authorization is checked;
 * no audio transport is exercised.
 */

import { createSuite } from './lib/suite.mjs';
import { probeModule, fnOf, instantiate, describeMissing } from './lib/probe.mjs';
import { ROOMS, call } from './lib/contracts.mjs';
import { mulberry32 } from './lib/fixtures.mjs';
import { probeService, fetchJson, urlFor } from './lib/http.mjs';

const CANDIDATES = [
  'app/rooms.mjs',
  'app/rooms.js',
  'app/net/rooms.mjs',
  'app/network/rooms.mjs',
  'app/multiplayer/rooms.mjs',
  'worker/rooms.mjs',
  'server/rooms.mjs'
];

function unwrapRoom(value) {
  if (!value || typeof value !== 'object') return value;
  return value.room || value.data || value;
}

function membersOf(room) {
  if (!room) return [];
  const list = room.members || room.players || room.seats || [];
  return list.map(function (member) {
    if (member && typeof member === 'object') return member.id || member.userId || member.uid;
    return member;
  }).filter(function (id) { return id != null; });
}

function sessionTokenOf(value) {
  if (!value || typeof value !== 'object') return undefined;
  return value.token || value.sessionToken || value.sessionId ||
    (value.session && (value.session.token || value.session.id));
}

function looksLikeFailure(value) {
  if (value === false) return true;
  if (!value || typeof value !== 'object') return false;
  if (value.ok === false || value.success === false) return true;
  if (value.error) return true;
  if (value.code && /error|invalid|denied|wrong|forbidden/i.test(String(value.code))) return true;
  return false;
}

async function expectRejected(s, label, fn) {
  try {
    const value = await fn();
    s.ok(label, looksLikeFailure(value), 'expected rejection/failure, got ' + JSON.stringify(value));
  } catch (err) {
    s.ok(label, true);
  }
}

async function expectAllowed(s, label, fn) {
  try {
    const value = await fn();
    s.ok(label, !looksLikeFailure(value), 'got failure ' + JSON.stringify(value));
    return value;
  } catch (err) {
    s.ok(label, false, err && err.message ? err.message : String(err));
    return undefined;
  }
}

const s = createSuite('boardgame-network-rooms');

await s.run(async () => {
  const probe = await probeModule(CANDIDATES, 'rooms');
  if (!probe.found) {
    const service = await probeService(['/health', '/api/health']);
    if (!service.available) {
      s.skip('rooms contract', describeMissing(probe, CANDIDATES) +
        '; no local HTTP service at ' + service.tried.map(function (item) { return item.url; }).join(', '));
      return;
    }

    await s.group('HTTP rooms API', async () => {
      const base = service.baseUrl;
      const room = await fetchJson(urlFor(base, '/api/rooms'), {
        method: 'POST',
        body: { name: 'contract-room', hostId: 'p1', password: 'secret-1' }
      });
      s.ok('创建密码房返回 2xx', room.status >= 200 && room.status < 300, 'status ' + room.status);
      const roomBody = room.body && (room.body.room || room.body);
      const roomId = roomBody && (roomBody.id || roomBody.roomId || roomBody.matchId);
      s.ok('创建房间返回 roomId', typeof roomId === 'string' && roomId.length > 0, JSON.stringify(room.body));
      s.ok('响应不含明文密码', !room.text.includes('secret-1'), 'plaintext password leaked');
      if (!roomId) return;

      const wrong = await fetchJson(urlFor(base, '/api/rooms/' + encodeURIComponent(roomId) + '/join'), {
        method: 'POST',
        body: { userId: 'p2', password: 'wrong' }
      });
      s.ok('错误密码被拒绝', wrong.status === 401 || wrong.status === 403 || wrong.status === 422,
        'status ' + wrong.status);
      s.ok('错误密码返回错误体', Boolean(wrong.body && (wrong.body.error || wrong.body.code)));

      const right = await fetchJson(urlFor(base, '/api/rooms/' + encodeURIComponent(roomId) + '/join'), {
        method: 'POST',
        body: { userId: 'p2', password: 'secret-1' }
      });
      s.ok('正确密码加入成功', right.status >= 200 && right.status < 300, 'status ' + right.status);
      const token = sessionTokenOf(right.body);
      s.ok('加入返回重连 token/session', token !== undefined, JSON.stringify(right.body));

      if (token !== undefined) {
        const reconnect = await fetchJson(urlFor(base, '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect'), {
          method: 'POST',
          body: { userId: 'p2', token: token }
        });
        s.ok('断线重连成功', reconnect.status >= 200 && reconnect.status < 300, 'status ' + reconnect.status);

        const badToken = await fetchJson(urlFor(base, '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect'), {
          method: 'POST',
          body: { userId: 'p2', token: 'not-a-real-token' }
        });
        s.ok('无效 token 被拒绝', badToken.status === 401 || badToken.status === 403 || badToken.status === 422,
          'status ' + badToken.status);
      }

      const voice = await fetchJson(urlFor(base, '/api/rooms/' + encodeURIComponent(roomId) + '/voice/token'), {
        method: 'POST',
        body: { userId: 'p1' }
      });
      s.ok('成员可申请语音 token', voice.status >= 200 && voice.status < 300, 'status ' + voice.status);
      const voiceOutsider = await fetchJson(urlFor(base, '/api/rooms/' + encodeURIComponent(roomId) + '/voice/token'), {
        method: 'POST',
        body: { userId: 'outsider' }
      });
      s.ok('非成员语音 token 被拒绝', voiceOutsider.status === 401 || voiceOutsider.status === 403,
        'status ' + voiceOutsider.status);
    });
    return;
  }

  if (probe.error) {
    s.ok('rooms module imports without throwing', false,
      probe.path + ': ' + (probe.error.stack || probe.error.message || String(probe.error)));
    return;
  }

  const api = probe.api;

  // Store-shaped rooms implementation: createRoomStore() returns an object
  // with create/join/invite/kick/close. This is the shape the pages app uses.
  const storeFactory = fnOf(api, ROOMS.store);
  if (storeFactory) {
    const clock = { now: Date.UTC(2026, 10, 10, 12, 0, 0) };
    const store = instantiate(storeFactory, {
      now: function () { return clock.now; },
      rng: mulberry32(7),
      ttlMs: 60 * 60 * 1000,
      maxPlayers: 4
    });

    await s.group('room store exports', async () => {
      s.ok('createRoomStore 返回对象', store != null && typeof store === 'object');
      for (const method of ['create', 'join', 'verifyInvite', 'consumeInvite', 'kick', 'close']) {
        s.ok('store 提供 ' + method, typeof store[method] === 'function');
      }
    });

    const secret = 'secret-1';
    let roomId = null;
    let inviteToken = null;

    await s.group('password room', async () => {
      let created;
      try {
        created = await call(store.create, store, [{
          hostId: 'p1', gameId: 'pokemon', nickname: 'P1', password: secret, maxPlayers: 4
        }]);
        s.ok('create 不抛错', true);
      } catch (err) {
        s.ok('create 不抛错', false, err && err.message ? err.message : String(err));
        return;
      }
      const room = created && created.room;
      s.ok('返回房间对象', room != null, JSON.stringify(created));
      if (!room) return;
      roomId = room.id;
      inviteToken = created.invite && created.invite.token;

      s.ok('房间有 id', typeof room.id === 'string' && room.id.length > 0);
      s.ok('host 是房间成员', (room.players || []).indexOf('p1') !== -1, JSON.stringify(room.players));
      s.eq('房间标记有密码', room.hasPassword, true);
      s.ok('房间记录不含明文密码', JSON.stringify(created).indexOf(secret) === -1,
        'plaintext password leaked');
      s.ok('返回邀请 token', typeof inviteToken === 'string' && inviteToken.length > 0,
        JSON.stringify(created.invite));

      const wrong = await call(store.join, store, [room.id, { playerId: 'p2', password: 'wrong' }]);
      s.ok('错误密码被拒绝', wrong && wrong.ok === false, JSON.stringify(wrong));
      s.eq('错误密码错误码', wrong && wrong.code, 'E_PASSWORD');

      const joined = await call(store.join, store, [room.id, { playerId: 'p2', password: secret }]);
      s.ok('正确密码加入成功', joined && joined.ok === true, JSON.stringify(joined));
      s.ok('加入后成员包含 p2', joined && joined.room && (joined.room.players || []).indexOf('p2') !== -1,
        JSON.stringify(joined && joined.room && joined.room.players));
    });

    await s.group('invite and reconnect seam', async () => {
      if (!inviteToken) {
        s.skip('invite token', 'create 未返回 invite token');
        return;
      }
      const verified = await call(store.verifyInvite, store, [inviteToken]);
      s.ok('邀请 token 可校验', verified && verified.ok === true, JSON.stringify(verified));
      s.eq('邀请 token 指向同一房间', verified && verified.roomId, roomId);

      const consumed = await call(store.consumeInvite, store, [inviteToken, { playerId: 'p3', nickname: 'P3' }]);
      s.ok('邀请 token 可加入', consumed && consumed.ok === true, JSON.stringify(consumed));
      const reuse = await call(store.consumeInvite, store, [inviteToken, { playerId: 'p4' }]);
      s.ok('邀请 token 用后失效', reuse && reuse.ok === false, JSON.stringify(reuse));

      // The current app has no session-token reconnect; invite consumption is
      // the only tokenized re-entry. Report the gap instead of inventing one.
      s.skip('断线重连 session token', 'store 只有 invite token，没有 reconnect/session 恢复接口');
    });

    await s.group('leave and close', async () => {
      if (!roomId) return;
      const kicked = await call(store.kick, store, [roomId, 'p1', 'p2']);
      s.ok('kick/leave 成功', kicked && kicked.ok !== false, JSON.stringify(kicked));
      const room = await call(store.get, store, [roomId]);
      const players = room && (room.players || (room.room && room.room.players));
      s.ok('离开后成员不含 p2', players && players.indexOf('p2') === -1, JSON.stringify(players));

      const closed = await call(store.close, store, [roomId, 'p1']);
      s.ok('close 成功', closed && closed.ok !== false, JSON.stringify(closed));
      const gone = await call(store.get, store, [roomId]);
      s.ok('关闭后房间不可获取', gone == null || gone.ok === false,
        JSON.stringify(gone));
    });

    await s.group('public room', async () => {
      const created = await call(store.create, store, [{
        hostId: 'h1', gameId: 'mahjong', nickname: 'H1', visibility: 'public', maxPlayers: 4
      }]);
      const room = created && created.room;
      s.ok('创建公开房成功', Boolean(room), JSON.stringify(created));
      if (!room) return;
      s.eq('公开房无密码', room.hasPassword, false);
      const joined = await call(store.join, store, [room.id, { playerId: 'guest' }]);
      s.ok('无密码房可直接加入', joined && joined.ok === true, JSON.stringify(joined));
    });

    await s.group('voice seam', async () => {
      if (store.voice == null) {
        s.skip('voice interface seam', 'store.voice 为 null，语音接口尚未实现（预留字段存在）');
        return;
      }
      const authorize = typeof store.voice.authorize === 'function'
        ? store.voice.authorize.bind(store.voice)
        : null;
      if (authorize) {
        s.ok('语音鉴权可调用', true);
      } else {
        s.ok('语音对象至少暴露 join/authorize',
          typeof store.voice.join === 'function' || typeof store.voice.authorize === 'function',
          JSON.stringify(Object.keys(store.voice)));
      }
    });

    return;
  }

  const create = fnOf(api, ROOMS.create);
  const join = fnOf(api, ROOMS.join);
  const leave = fnOf(api, ROOMS.leave);
  const reconnect = fnOf(api, ROOMS.reconnect);
  const password = fnOf(api, ROOMS.password);

  await s.group('exports', async () => {
    s.ok('提供 createRoom', typeof create === 'function', 'expected ' + ROOMS.create.join(' / '));
    s.ok('提供 joinRoom', typeof join === 'function', 'expected ' + ROOMS.join.join(' / '));
    s.ok('提供 leaveRoom', typeof leave === 'function', 'expected ' + ROOMS.leave.join(' / '));
    s.ok('提供 reconnectRoom', typeof reconnect === 'function', 'expected ' + ROOMS.reconnect.join(' / '));
    s.ok('提供密码校验', typeof password === 'function', 'expected ' + ROOMS.password.join(' / '));
  });

  if (!create || !join) return;

  const secret = 'secret-1';
  let room;
  await s.group('password room', async () => {
    try {
      room = unwrapRoom(await call(create, null, [{
        id: 'contract-room',
        name: 'contract-room',
        hostId: 'p1',
        password: secret
      }]));
      s.ok('createRoom 不抛错', true);
    } catch (err) {
      s.ok('createRoom 不抛错', false, err && err.message ? err.message : String(err));
      return;
    }
    if (!room) return;

    s.ok('房间有 id', typeof room.id === 'string' && room.id.length > 0, JSON.stringify(room));
    s.ok('房间记录不含明文密码', JSON.stringify(room).indexOf(secret) === -1, 'plaintext password leaked');
    s.ok('host 是房间成员', membersOf(room).indexOf('p1') !== -1, JSON.stringify(membersOf(room)));

    if (password) {
      s.eq('密码校验：错误密码 false', await call(password, room, ['wrong']), false);
      s.eq('密码校验：正确密码 true', await call(password, room, [secret]), true);
    }

    await expectRejected(s, '错误密码不能加入', function () {
      return call(join, null, [room, { userId: 'p2', password: 'wrong' }]);
    });

    const joined = await expectAllowed(s, '正确密码可以加入', function () {
      return call(join, null, [room, { userId: 'p2', password: secret }]);
    });
    const joinedRoom = unwrapRoom(joined) || room;
    s.ok('加入后成员包含 p2', membersOf(joinedRoom).indexOf('p2') !== -1,
      JSON.stringify(membersOf(joinedRoom)));

    const token = sessionTokenOf(joined) || sessionTokenOf(joinedRoom);
    s.ok('加入返回重连 token/session', token !== undefined, JSON.stringify(joined));
    if (token !== undefined) {
      await expectRejected(s, '无效 token 不能重连', function () {
        return call(reconnect, null, [joinedRoom, { userId: 'p2', token: 'not-a-real-token' }]);
      });
      await expectAllowed(s, '有效 token 可以重连', function () {
        return call(reconnect, null, [joinedRoom, { userId: 'p2', token: token }]);
      });
    }

    if (leave) {
      await expectAllowed(s, 'leaveRoom 不抛错', function () {
        return call(leave, null, [joinedRoom, 'p2']);
      });
      const afterLeave = unwrapRoom(joined) || joinedRoom;
      s.ok('离开后成员不含 p2', membersOf(afterLeave).indexOf('p2') === -1,
        JSON.stringify(membersOf(afterLeave)));
    }
  });

  await s.group('public room', async () => {
    if (!create || !join) return;
    try {
      const publicRoom = unwrapRoom(await call(create, null, [{
        id: 'public-room', name: 'public-room', hostId: 'p1'
      }]));
      s.ok('创建公开房不抛错', true);
      const joined = await expectAllowed(s, '无密码房可直接加入', function () {
        return call(join, null, [publicRoom, { userId: 'p3' }]);
      });
      const state = unwrapRoom(joined) || publicRoom;
      s.ok('公开房加入后成员包含 p3', membersOf(state).indexOf('p3') !== -1,
        JSON.stringify(membersOf(state)));
    } catch (err) {
      s.ok('创建公开房不抛错', false, err && err.message ? err.message : String(err));
    }
  });

  await s.group('voice seam', async () => {
    const voice = (room && room.voice) || fnOf(api, ROOMS.voice);
    const authorize = fnOf(api, ROOMS.auth) ||
      (room && room.voice && (room.voice.authorize || room.voice.canJoin || room.voice.canUse));
    if (!voice && !authorize) {
      s.skip('voice interface seam', 'no voice/createVoiceChannel/authorizeVoice export');
      return;
    }
    if (authorize) {
      s.eq('房间成员可通过语音鉴权', await call(authorize, room, [room, 'p1']), true);
      s.eq('非成员不能通过语音鉴权', await call(authorize, room, [room, 'outsider']), false);
    } else {
      s.ok('提供语音接缝对象/工厂', voice != null);
      s.ok('语音对象至少暴露 join 或 authorize',
        typeof voice === 'object' && (typeof voice.join === 'function' ||
          typeof voice.authorize === 'function' || typeof voice.canJoin === 'function'),
        JSON.stringify(Object.keys(voice || {})));
    }
  });
});
