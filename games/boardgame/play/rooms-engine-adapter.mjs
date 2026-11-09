'use strict';

/*
 * Compatibility adapter for the local room demo UI.
 *
 * Password hashing, invite tokens, member limits and the room lifecycle stay
 * in ../app/rooms.js (createRoomStoreInternal). This adapter only adds the
 * per-tab mirror registry, BroadcastChannel-friendly snapshot helpers and the
 * interface-only voice placeholder participant list that the page renders.
 */

import { createRoomStoreInternal } from '../app/rooms.js';

const store = createRoomStoreInternal();

const registry = new Map();      // roomId -> room view shared by this tab
const listeners = new Map();     // roomId -> Set<callback>
const sessions = new Map();      // token -> { roomId, playerId }
const authoritative = new Set(); // rooms owned by this tab (not mirrors)
let tokenSeq = 0;

function makeToken() {
  tokenSeq += 1;
  return 'sess_' + tokenSeq + '_' + Math.random().toString(36).slice(2, 10);
}

function fail(code, message) {
  return { ok: false, code: code, error: message || code };
}

const CODE_MAP = {
  E_NOT_FOUND: 'E_ROOM_NOT_FOUND',
  E_FULL: 'E_ROOM_FULL',
  E_INVITE: 'E_INVALID_INVITE',
  E_HOST: 'E_HOST_ONLY',
  E_PLAYER: 'E_NOT_MEMBER'
};

function mapFail(result) {
  if (!result) return fail('E_ROOM_NOT_FOUND', '房间不存在');
  return fail(CODE_MAP[result.code] || result.code || 'E_ROOM', result.message);
}

function notify(roomId) {
  const set = listeners.get(roomId);
  if (!set) return;
  set.forEach(function (callback) {
    try { callback(); } catch (err) { /* a UI listener must not break the store */ }
  });
}

function roomView(publicRoom, inviteCode) {
  return {
    id: publicRoom.id,
    code: publicRoom.code,
    inviteCode: inviteCode || publicRoom.code,
    hostId: publicRoom.hostId,
    gameId: publicRoom.gameId,
    game: publicRoom.gameId,
    players: publicRoom.players.slice(),
    maxPlayers: publicRoom.maxPlayers,
    status: publicRoom.status,
    hasPassword: publicRoom.hasPassword,
    passwordProtected: publicRoom.hasPassword,
    visibility: publicRoom.visibility,
    createdAt: publicRoom.createdAt,
    expiresAt: publicRoom.expiresAt,
    voice: { participants: [] }
  };
}

function syncRoom(roomId, publicRoom) {
  const existing = registry.get(roomId);
  if (!existing) {
    const created = roomView(publicRoom);
    registry.set(roomId, created);
    return created;
  }
  const voice = existing.voice || { participants: [] };
  Object.assign(existing, publicRoom, {
    game: publicRoom.gameId,
    passwordProtected: publicRoom.hasPassword,
    inviteCode: existing.inviteCode || publicRoom.code,
    voice: voice
  });
  return existing;
}

function resolveRoom(value) {
  if (!value) return null;
  if (typeof value === 'string') return registry.get(value) || null;
  if (value.id) return registry.get(value.id) || value;
  return null;
}

export function createRoom(input) {
  const opts = input || {};
  try {
    const result = store.create({
      hostId: opts.hostId || opts.name || 'host',
      gameId: opts.game || opts.gameId || 'mahjong',
      visibility: opts.visibility || 'public',
      password: opts.password == null || opts.password === '' ? null : opts.password,
      maxPlayers: opts.maxPlayers || 4,
      nickname: opts.hostId || opts.name
    });
    const room = roomView(result.room, result.invite.token);
    registry.set(room.id, room);
    authoritative.add(room.id);
    notify(room.id);
    return room;
  } catch (err) {
    return fail(err.code || 'E_CREATE', err.message);
  }
}

export function joinRoom(value, input) {
  const room = resolveRoom(value);
  const opts = input || {};
  if (!room) return fail('E_ROOM_NOT_FOUND', '房间不存在');
  const playerId = opts.userId || opts.playerId;
  if (!playerId) return fail('E_NOT_MEMBER', 'playerId is required');

  let result;
  if (opts.inviteCode) {
    result = store.consumeInvite(opts.inviteCode, { playerId: playerId, nickname: opts.nickname || playerId });
  } else {
    result = store.join(room.id, {
      playerId: playerId,
      nickname: opts.nickname || playerId,
      password: opts.password
    });
  }
  if (!result || result.ok !== true) return mapFail(result);

  const token = makeToken();
  sessions.set(token, { roomId: room.id, playerId: playerId });
  const updated = syncRoom(room.id, result.room);
  authoritative.add(room.id);
  notify(room.id);
  return {
    ok: true,
    room: exportRoomSnapshot(updated),
    token: token,
    member: { id: playerId, role: updated.hostId === playerId ? 'host' : 'player' }
  };
}

export function leaveRoom(value, playerId) {
  const room = resolveRoom(value);
  if (!room) return fail('E_ROOM_NOT_FOUND', '房间不存在');
  const result = store.leave(room.id, playerId);
  if (!result || result.ok !== true) return mapFail(result);
  syncRoom(room.id, result.room);
  notify(room.id);
  return { ok: true, room: exportRoomSnapshot(room) };
}

export function reconnectRoom(value, input) {
  const room = resolveRoom(value);
  const opts = input || {};
  const session = sessions.get(opts.token);
  if (!room || !session || session.roomId !== room.id || session.playerId !== opts.userId) {
    return fail('E_TOKEN', 'invalid session token');
  }
  return { ok: true, room: exportRoomSnapshot(room), token: opts.token };
}

export function closeRoom(value, actorId) {
  const room = resolveRoom(value);
  if (!room) return fail('E_ROOM_NOT_FOUND', '房间不存在');
  const closed = store.close(room.id, actorId);
  if (!closed) return fail('E_HOST_ONLY', 'only the host can close the room');
  room.status = 'closed';
  authoritative.delete(room.id);
  notify(room.id);
  return { ok: true, room: exportRoomSnapshot(room) };
}

export function joinVoice(value, playerId) {
  const room = resolveRoom(value);
  if (!room) return fail('E_ROOM_NOT_FOUND', '房间不存在');
  if (!room.voice || !Array.isArray(room.voice.participants)) room.voice = { participants: [] };
  if (room.voice.participants.indexOf(playerId) === -1) room.voice.participants.push(playerId);
  notify(room.id);
  return { ok: true, room: exportRoomSnapshot(room), voice: room.voice };
}

export function leaveVoice(value, playerId) {
  const room = resolveRoom(value);
  if (!room) return fail('E_ROOM_NOT_FOUND', '房间不存在');
  if (room.voice && Array.isArray(room.voice.participants)) {
    room.voice.participants = room.voice.participants.filter(function (id) { return id !== playerId; });
  }
  notify(room.id);
  return { ok: true, room: exportRoomSnapshot(room), voice: room.voice || { participants: [] } };
}

export function getRoom(roomId) {
  if (roomId == null) return null;
  return registry.get(String(roomId)) || null;
}

export function isRoomMirror(value) {
  const room = resolveRoom(value);
  return Boolean(room && !authoritative.has(room.id));
}

export function subscribeRoom(value, callback) {
  const room = resolveRoom(value);
  if (!room || typeof callback !== 'function') return function () {};
  if (!listeners.has(room.id)) listeners.set(room.id, new Set());
  listeners.get(room.id).add(callback);
  return function unsubscribe() {
    const set = listeners.get(room.id);
    if (!set) return;
    set.delete(callback);
    if (!set.size) listeners.delete(room.id);
  };
}

export function exportRoomSnapshot(value) {
  const room = resolveRoom(value);
  if (!room) return null;
  return {
    id: room.id,
    code: room.code,
    inviteCode: room.inviteCode,
    hostId: room.hostId,
    gameId: room.gameId,
    game: room.game,
    players: room.players.slice(),
    maxPlayers: room.maxPlayers,
    status: room.status,
    hasPassword: room.hasPassword,
    passwordProtected: room.passwordProtected,
    visibility: room.visibility,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    voice: { participants: (room.voice && room.voice.participants ? room.voice.participants : []).slice() }
  };
}

export function importRoomSnapshot(snapshot) {
  if (!snapshot || !snapshot.id) return null;
  let room = registry.get(snapshot.id);
  if (!room) {
    room = roomView(snapshot, snapshot.inviteCode);
    registry.set(snapshot.id, room);
  }
  Object.assign(room, snapshot, {
    game: snapshot.gameId,
    passwordProtected: snapshot.hasPassword,
    inviteCode: snapshot.inviteCode || room.inviteCode,
    voice: { participants: snapshot.voice && Array.isArray(snapshot.voice.participants)
      ? snapshot.voice.participants.slice()
      : (room.voice ? room.voice.participants.slice() : []) }
  });
  authoritative.delete(room.id);
  notify(room.id);
  return room;
}
