'use strict';

/*
 * 房间 / 邀请 / 密码状态机（本地内存实现）。
 *
 * - 无网络、无后端；页面刷新即丢失，适合单机演示与后续替换成真实服务。
 * - 房间对象里不存明文密码，只暴露 hasPassword。
 * - 连续 5 次密码错误锁定 60 秒。
 * - 邀请 token 单次使用，默认 1 小时过期。
 * - voice 永远为 null：语音能力只保留接口位，不在这里实现。
 *
 * 所有时间来自注入的 now()，所有随机来自注入的 rng()，便于测试。
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_TTL = 60 * 60 * 1000;
const LOCK_MS = 60 * 1000;
const MAX_WRONG = 5;

function fail(code, message) {
  return { ok: false, code: code, message: message || code };
}

function throwCode(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

// 本地内存场景下的口令摘要：加盐 + 多轮 FNV-1a。不是密码学哈希，
// 目的只是让 room 对象里不出现明文；真实后端请换成 bcrypt/argon2。
function hashPassword(password) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const salted = 'boardgame-room:' + password;
  for (let i = 0; i < salted.length; i += 1) {
    const c = salted.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  h1 >>>= 0;
  h2 >>>= 0;
  return 'h$' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function randomToken(rng) {
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    const index = Math.min(CODE_ALPHABET.length - 1, Math.floor((rng() || 0) * CODE_ALPHABET.length));
    out += CODE_ALPHABET[index];
  }
  return out;
}

export function createRoomStoreInternal(options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const ttlMs = Math.max(1000, opts.ttlMs == null ? DEFAULT_TTL : opts.ttlMs);
  const defaultMaxPlayers = Math.max(2, opts.maxPlayers == null ? 4 : Math.floor(opts.maxPlayers));
  const codeLength = Math.max(4, opts.codeLength == null ? 6 : Math.floor(opts.codeLength));

  const rooms = new Map(); // room.id -> record
  const byCode = new Map(); // CODE -> record
  const invites = new Map(); // token -> { roomId, expiresAt, usesLeft }
  const wrongAttempts = new Map(); // roomId -> { count, lockedUntil }
  let seq = 0;

  function publicRoom(record) {
    const room = record.room;
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      gameId: room.gameId,
      visibility: room.visibility,
      hasPassword: room.hasPassword,
      players: room.players.slice(),
      maxPlayers: room.maxPlayers,
      status: room.status,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      voice: null
    };
  }

  function remove(record) {
    rooms.delete(record.room.id);
    byCode.delete(record.room.code);
    wrongAttempts.delete(record.room.id);
  }

  function getRecord(roomIdOrCode) {
    if (roomIdOrCode == null) return null;
    const key = String(roomIdOrCode);
    let record = rooms.get(key) || byCode.get(key.toUpperCase());
    if (!record) return null;
    if (now() >= record.room.expiresAt) {
      remove(record);
      return null;
    }
    return record;
  }

  function makeCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < codeLength; i += 1) {
        const index = Math.min(CODE_ALPHABET.length - 1, Math.floor(rng() * CODE_ALPHABET.length));
        code += CODE_ALPHABET[index];
      }
      if (!byCode.has(code)) return code;
    }
    throw throwCode('E_CODE', 'cannot allocate a unique room code');
  }

  function playerOf(record, playerId) {
    return record.members.get(playerId) || null;
  }

  function addPlayer(record, playerId, nickname) {
    const player = {
      id: playerId,
      nickname: nickname || playerId,
      joinedAt: now(),
      ready: false
    };
    record.members.set(playerId, player);
    record.room.players.push(playerId);
    record.room.status = record.room.players.length >= record.room.maxPlayers ? 'ready' : 'waiting';
    return player;
  }

  function joinInternal(record, playerId, nickname, skipPassword, password) {
    if (!playerId) return fail('E_PLAYER', 'playerId is required');
    const existing = playerOf(record, playerId);
    if (existing) {
      return { ok: true, room: publicRoom(record), player: Object.assign({}, existing) };
    }
    if (record.room.status === 'playing' || record.room.status === 'finished') {
      return fail('E_LOCKED', 'room already started');
    }

    if (!skipPassword && record.room.hasPassword) {
      const attempts = wrongAttempts.get(record.room.id) || { count: 0, lockedUntil: 0 };
      if (attempts.lockedUntil > now()) {
        return fail('E_LOCKED', 'too many wrong passwords');
      }
      if (hashPassword(String(password == null ? '' : password)) !== record.passwordHash) {
        attempts.count += 1;
        if (attempts.count >= MAX_WRONG) {
          attempts.count = 0;
          attempts.lockedUntil = now() + LOCK_MS;
        }
        wrongAttempts.set(record.room.id, attempts);
        return fail('E_PASSWORD', 'wrong password');
      }
      wrongAttempts.delete(record.room.id);
    }

    if (record.room.players.length >= record.room.maxPlayers) {
      return fail('E_FULL', 'room is full');
    }
    const player = addPlayer(record, playerId, nickname);
    return { ok: true, room: publicRoom(record), player: Object.assign({}, player) };
  }

  function createInvite(record, inviterId, ttl) {
    if (record.room.hostId !== inviterId) throw throwCode('E_HOST', 'only the host can invite');
    const expiresAt = now() + Math.max(1000, ttl == null ? ttlMs : ttl);
    let token = randomToken(rng);
    while (invites.has(token)) token = randomToken(rng);
    invites.set(token, { roomId: record.room.id, expiresAt: expiresAt, usesLeft: 1 });
    return { token: token, expiresAt: expiresAt };
  }

  const store = {
    voice: null,

    create(input) {
      const optsIn = input || {};
      if (!optsIn.hostId) throw throwCode('E_PLAYER', 'hostId is required');
      if (!optsIn.gameId) throw throwCode('E_GAME', 'gameId is required');
      const visibility = optsIn.visibility == null ? 'public' : optsIn.visibility;
      if (visibility !== 'public' && visibility !== 'private') {
        throw throwCode('E_VISIBILITY', 'visibility must be public or private');
      }
      const password = optsIn.password == null ? null : String(optsIn.password);
      if (password !== null && (password.length < 4 || password.length > 64)) {
        throw throwCode('E_PASSWORD', 'password must be 4..64 characters');
      }
      const maxPlayers = optsIn.maxPlayers == null
        ? defaultMaxPlayers
        : Math.max(2, Math.min(12, Math.floor(optsIn.maxPlayers)));
      seq += 1;
      const code = makeCode();
      const room = {
        id: 'room_' + seq + '_' + code.toLowerCase(),
        code: code,
        hostId: optsIn.hostId,
        gameId: optsIn.gameId,
        visibility: visibility,
        hasPassword: password !== null,
        players: [],
        maxPlayers: maxPlayers,
        status: maxPlayers <= 1 ? 'ready' : 'waiting',
        createdAt: now(),
        expiresAt: now() + ttlMs,
        voice: null
      };
      const record = {
        room: room,
        passwordHash: password === null ? null : hashPassword(password),
        members: new Map()
      };
      addPlayer(record, optsIn.hostId, optsIn.nickname || optsIn.hostId);
      record.room.status = record.room.players.length >= record.room.maxPlayers ? 'ready' : 'waiting';
      rooms.set(room.id, record);
      byCode.set(code, record);
      const invite = createInvite(record, optsIn.hostId, ttlMs);
      return { room: publicRoom(record), invite: invite };
    },

    join(roomIdOrCode, input) {
      const rec = getRecord(roomIdOrCode);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      const optsJoin = input || {};
      return joinInternal(rec, optsJoin.playerId, optsJoin.nickname, false, optsJoin.password);
    },

    /*
     * 服务器内部补位：跳过房间密码，仅供 server 的 AI 自动补位使用。
     * 浏览器端不能直接调用（HTTP 层没有暴露这个动作）。
     */
    addAi(roomIdOrCode, input) {
      const rec = getRecord(roomIdOrCode);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      const optsAi = input || {};
      if (!optsAi.playerId) return fail('E_PLAYER', 'playerId is required');
      const existing = playerOf(rec, optsAi.playerId);
      if (existing) {
        return { ok: true, room: publicRoom(rec), player: Object.assign({}, existing) };
      }
      if (rec.room.status === 'playing' || rec.room.status === 'finished') {
        return fail('E_LOCKED', 'room already started');
      }
      if (rec.room.players.length >= rec.room.maxPlayers) {
        return fail('E_FULL', 'room is full');
      }
      const player = addPlayer(rec, optsAi.playerId, optsAi.nickname || 'AI 补位');
      player.ai = true;
      return { ok: true, room: publicRoom(rec), player: Object.assign({}, player) };
    },

    invite(roomId, input) {
      const rec = getRecord(roomId);
      if (!rec) throw throwCode('E_NOT_FOUND', 'room not found');
      const optsInvite = input || {};
      return createInvite(rec, optsInvite.inviterId, optsInvite.ttlMs);
    },

    verifyInvite(token) {
      const invite = invites.get(token);
      if (!invite || invite.usesLeft <= 0 || now() >= invite.expiresAt) {
        return fail('E_INVITE', 'invalid or expired invite');
      }
      const rec = getRecord(invite.roomId);
      if (!rec) return fail('E_INVITE', 'room no longer exists');
      return {
        ok: true,
        roomId: invite.roomId,
        expiresAt: invite.expiresAt,
        usesLeft: invite.usesLeft
      };
    },

    consumeInvite(token, input) {
      const invite = invites.get(token);
      if (!invite || invite.usesLeft <= 0 || now() >= invite.expiresAt) {
        return fail('E_INVITE', 'invalid or expired invite');
      }
      const rec = getRecord(invite.roomId);
      if (!rec) return fail('E_INVITE', 'room no longer exists');
      const optsConsume = input || {};
      if (!optsConsume.playerId) return fail('E_PLAYER', 'playerId is required');
      const already = playerOf(rec, optsConsume.playerId);
      if (!already && rec.room.players.length >= rec.room.maxPlayers) {
        return fail('E_FULL', 'room is full');
      }
      invite.usesLeft -= 1;
      invites.delete(token);
      return joinInternal(rec, optsConsume.playerId, optsConsume.nickname, true, null);
    },

    close(roomId, actorId) {
      const rec = getRecord(roomId);
      if (!rec) return false;
      if (rec.room.hostId !== actorId) return false;
      remove(rec);
      return true;
    },

    get(roomIdOrCode) {
      const rec = getRecord(roomIdOrCode);
      return rec ? publicRoom(rec) : null;
    },

    list() {
      return Array.from(rooms.values())
        .filter(function (record) { return now() < record.room.expiresAt; })
        .map(publicRoom);
    },

    setReady(roomId, playerId, ready) {
      const rec = getRecord(roomId);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      const player = playerOf(rec, playerId);
      if (!player) return fail('E_PLAYER', 'not in this room');
      player.ready = Boolean(ready);
      return { ok: true, room: publicRoom(rec), player: Object.assign({}, player) };
    },

    start(roomId, actorId) {
      const rec = getRecord(roomId);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      if (rec.room.hostId !== actorId) return fail('E_HOST', 'only the host can start');
      if (rec.room.players.length < 2) return fail('E_PLAYERS', 'need at least 2 players');
      rec.room.status = 'playing';
      return { ok: true, room: publicRoom(rec) };
    },

    finish(roomId, actorId) {
      const rec = getRecord(roomId);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      if (rec.room.hostId !== actorId) return fail('E_HOST', 'only the host can finish');
      rec.room.status = 'finished';
      return { ok: true, room: publicRoom(rec) };
    },

    kick(roomId, actorId, targetId) {
      const rec = getRecord(roomId);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      if (rec.room.hostId !== actorId) return fail('E_HOST', 'only the host can kick');
      if (targetId === rec.room.hostId) return fail('E_HOST', 'host cannot be kicked');
      if (!rec.members.has(targetId)) return fail('E_PLAYER', 'not in this room');
      rec.members.delete(targetId);
      rec.room.players = rec.room.players.filter(function (id) { return id !== targetId; });
      rec.room.status = rec.room.players.length >= rec.room.maxPlayers ? 'ready' : 'waiting';
      return { ok: true, room: publicRoom(rec) };
    },

    leave(roomId, playerId) {
      const rec = getRecord(roomId);
      if (!rec) return fail('E_NOT_FOUND', 'room not found');
      if (!rec.members.has(playerId)) return fail('E_PLAYER', 'not in this room');
      rec.members.delete(playerId);
      rec.room.players = rec.room.players.filter(function (id) { return id !== playerId; });
      rec.room.status = rec.room.players.length >= rec.room.maxPlayers ? 'ready' : 'waiting';
      return { ok: true, room: publicRoom(rec) };
    }
  };

  return store;
}

/* ---------- C 模块契约兼容接口（app/rooms.js 测试） ---------- */

const sharedStore = createRoomStoreInternal();
const roomPasswords = new Map();
const sessions = new Map();
let sessionSeq = 0;

function roomIdOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function membersOf(value) {
  if (!value) return [];
  const list = value.players || value.members || [];
  return list.map(function (member) {
    return member && typeof member === 'object' ? (member.id || member.userId) : member;
  }).filter(function (id) { return id != null; });
}

export function createRoom(input) {
  const opts = input || {};
  const password = opts.password == null ? null : String(opts.password);
  const result = sharedStore.create({
    hostId: opts.hostId || opts.userId || 'host',
    gameId: opts.gameId || opts.id || opts.name || 'room',
    visibility: opts.visibility || 'public',
    password: password,
    maxPlayers: opts.maxPlayers || 4
  });
  if (password !== null) roomPasswords.set(result.room.id, hashPassword(password));
  return { room: result.room, invite: result.invite, token: result.invite.token };
}

export function verifyRoomPassword(room, password) {
  // C 契约用 call(password, room, ['wrong']) 调用，此时 this 是房间、第一个
  // 参数才是密码；也兼容 verifyRoomPassword(room, password) 的直接写法。
  let target = room;
  let secret = password;
  if (this && typeof this === 'object' && (this.id || this.code) && typeof room === 'string') {
    target = this;
    secret = room;
  }
  const id = roomIdOf(target);
  if (!id) return false;
  const expected = roomPasswords.get(id);
  if (expected == null) return true;
  return hashPassword(String(secret == null ? '' : secret)) === expected;
}

export function joinRoom(room, input) {
  const id = roomIdOf(room);
  if (!id) return fail('E_NOT_FOUND', 'room not found');
  const opts = input || {};
  const playerId = opts.playerId || opts.userId;
  const result = sharedStore.join(id, {
    playerId: playerId,
    password: opts.password,
    nickname: opts.nickname || opts.name || playerId
  });
  if (!result.ok) return result;
  sessionSeq += 1;
  const token = 'sess_' + sessionSeq + '_' + Math.random().toString(36).slice(2, 10);
  sessions.set(token, { roomId: id, playerId: playerId });
  return { ok: true, room: result.room, player: result.player, token: token };
}

export function leaveRoom(room, playerId) {
  const id = roomIdOf(room);
  if (!id) return fail('E_NOT_FOUND', 'room not found');
  const result = sharedStore.leave(id, playerId);
  if (room && Array.isArray(room.players)) {
    const at = room.players.indexOf(playerId);
    if (at !== -1) room.players.splice(at, 1);
  }
  if (room && Array.isArray(room.members)) {
    room.members = room.members.filter(function (member) {
      return (member && (member.id || member.userId)) !== playerId;
    });
  }
  return result.ok ? { ok: true, room: room } : result;
}

export function reconnectRoom(room, input) {
  const id = roomIdOf(room);
  const opts = input || {};
  const session = sessions.get(opts.token);
  if (!id || !session || session.roomId !== id || session.playerId !== opts.userId) {
    return fail('E_TOKEN', 'invalid session token');
  }
  return { ok: true, room: sharedStore.get(id) || room, token: opts.token };
}

export function authorizeVoice(room, userId) {
  return membersOf(room).indexOf(userId) !== -1;
}

export const canUseVoice = authorizeVoice;

export function createVoiceChannel(room, userId) {
  if (!authorizeVoice(room, userId)) return fail('E_VOICE', 'not a room member');
  return {
    ok: true,
    roomId: roomIdOf(room),
    userId: userId,
    transport: null,
    voice: null
  };
}

export default {
  createRoomStoreInternal: createRoomStoreInternal,
  createRoom: createRoom,
  joinRoom: joinRoom,
  leaveRoom: leaveRoom,
  reconnectRoom: reconnectRoom,
  verifyRoomPassword: verifyRoomPassword,
  authorizeVoice: authorizeVoice,
  createVoiceChannel: createVoiceChannel
};
