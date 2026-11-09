'use strict';

/*
 * Local room demo: create / join with password + invite code, BroadcastChannel
 * sync between tabs on the same machine, and an interface-only voice button.
 *
 * The authoritative room lives in the tab that created it. Other tabs send
 * join/reconnect/leave/voice requests over BroadcastChannel and receive room
 * snapshots. Nothing leaves the machine; no media is requested. The adapter
 * in ./rooms-engine-adapter.mjs keeps the room rules in app/rooms.js.
 */

import {
  createRoom,
  joinRoom,
  leaveRoom,
  reconnectRoom,
  closeRoom,
  joinVoice,
  leaveVoice,
  getRoom,
  isRoomMirror,
  subscribeRoom,
  exportRoomSnapshot,
  importRoomSnapshot
} from './rooms-engine-adapter.mjs';

const SESSION_KEY = 'boardgame-room-session';
const CHANNEL_NAME = 'boardgame-rooms-demo';

const el = (id) => document.getElementById(id);
const ui = {
  toast: el('toast'),
  createForm: el('createForm'),
  createNick: el('createNick'),
  createName: el('createName'),
  createPassword: el('createPassword'),
  createMax: el('createMax'),
  createGame: el('createGame'),
  createMsg: el('createMsg'),
  joinForm: el('joinForm'),
  joinRoomId: el('joinRoomId'),
  joinNick: el('joinNick'),
  joinPassword: el('joinPassword'),
  joinInvite: el('joinInvite'),
  joinMsg: el('joinMsg'),
  roomPanel: el('roomPanel'),
  roomState: el('roomState'),
  roomIdText: el('roomIdText'),
  roomCodeText: el('roomCodeText'),
  roomGameText: el('roomGameText'),
  roomPasswordFlag: el('roomPasswordFlag'),
  voiceState: el('voiceState'),
  memberCount: el('memberCount'),
  memberList: el('memberList'),
  voiceBtn: el('voiceBtn'),
  leaveBtn: el('leaveBtn'),
  closeBtn: el('closeBtn'),
  roomStatus: el('roomStatus'),
  startMatchLink: el('startMatchLink')
};

const tabId = 'tab-' + Math.random().toString(36).slice(2, 10);
const hosted = new Map();
const pending = new Map();
let sequence = 0;

let channel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', onMessage);
  }
} catch (err) {
  channel = null;
}

let roomRef = null;
let me = null;
let role = null;
let token = null;
let unsubscribe = null;

/* ------------------------------------------------------------------ */
/* messaging                                                           */
/* ------------------------------------------------------------------ */

function post(message) {
  if (!channel) return;
  try {
    channel.postMessage(Object.assign({ from: tabId, at: Date.now() }, message || {}));
  } catch (err) {
    // A closed channel must not break the local UI.
  }
}

function request(type, payload, timeoutMs) {
  if (!channel) return Promise.resolve(null);
  const requestId = tabId + '-' + (++sequence);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs == null ? 1500 : timeoutMs);
    pending.set(requestId, {
      resolve(value) {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(value);
      }
    });
    post(Object.assign({ type, requestId }, payload));
  });
}

function onMessage(event) {
  const msg = event.data;
  if (!msg || typeof msg !== 'object' || msg.from === tabId) return;

  if (msg.type === 'join-request') {
    const room = hosted.get(msg.roomId);
    if (!room) return;
    const result = joinRoom(room, {
      userId: msg.playerId,
      password: msg.password,
      inviteCode: msg.inviteCode,
      clientId: msg.from
    });
    post({
      type: 'join-response',
      to: msg.from,
      requestId: msg.requestId,
      result: result && result.ok
        ? { ok: true, room: exportRoomSnapshot(room), token: result.token, member: result.member }
        : { ok: false, code: result && result.code, error: result && result.error }
    });
    return;
  }

  if (msg.type === 'reconnect-request') {
    const room = hosted.get(msg.roomId);
    if (!room) return;
    const result = reconnectRoom(room, { userId: msg.playerId, token: msg.token });
    post({
      type: 'reconnect-response',
      to: msg.from,
      requestId: msg.requestId,
      result: result && result.ok
        ? { ok: true, room: exportRoomSnapshot(room), token: result.token, member: result.member }
        : { ok: false, code: result && result.code, error: result && result.error }
    });
    return;
  }

  if (msg.type === 'join-response' || msg.type === 'reconnect-response') {
    if (msg.to !== tabId) return;
    const waiting = pending.get(msg.requestId);
    if (waiting) waiting.resolve(msg.result);
    return;
  }

  if (msg.type === 'room-update') {
    if (!roomRef || !msg.room || msg.room.id !== roomRef.id) return;
    importRoomSnapshot(msg.room);
    const next = getRoom(msg.room.id);
    if (next) roomRef = next;
    renderRoom();
    if (msg.room.status === 'closed') {
      setMsg(ui.roomStatus, '房主已关闭房间。', 'error');
    }
    return;
  }

  if (msg.type === 'leave-request') {
    const room = hosted.get(msg.roomId);
    if (!room) return;
    leaveRoom(room, msg.playerId);
    return;
  }

  if (msg.type === 'close-request') {
    const room = hosted.get(msg.roomId);
    if (!room) return;
    const result = closeRoom(room, msg.actorId);
    if (result && result.ok) post({ type: 'room-update', room: exportRoomSnapshot(room) });
    return;
  }

  if (msg.type === 'voice-request') {
    const room = hosted.get(msg.roomId);
    if (!room) return;
    if (msg.action === 'leave') leaveVoice(room, msg.playerId);
    else joinVoice(room, msg.playerId);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function setMsg(element, text, kind) {
  if (!element) return;
  element.textContent = text || '';
  element.className = 'msg' + (kind ? ' ' + kind : '');
}

function toast(text) {
  ui.toast.textContent = text || '';
}

function errorText(result) {
  const code = result && (result.code || result.error);
  const labels = {
    E_PASSWORD: '密码错误',
    E_INVALID_PASSWORD: '密码错误',
    E_ROOM_NOT_FOUND: '房间不存在（房主标签页可能已关闭）',
    E_ROOM_FULL: '房间已满',
    E_INVALID_INVITE: '邀请码无效',
    E_ROOM_CLOSED: '房间已关闭',
    E_NOT_MEMBER: '你还不在这个房间里',
    E_HOST_ONLY: '只有房主可以执行这个操作',
    E_ROOM_REMOTE: '房间状态在房主标签页'
  };
  if (code && labels[code]) return labels[code] + '（' + code + '）';
  if (result && result.error && result.error !== result.code) return String(result.error);
  if (code) return String(code);
  return '操作失败';
}

function saveSession() {
  if (!roomRef || !me) return;
  if (hosted.has(roomRef.id) && roomRef.hostId === me) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      roomId: roomRef.id,
      playerId: me,
      token: token || null
    }));
  } catch (err) {
    // Private mode / disabled storage: reconnect is simply not persisted.
  }
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    // ignore
  }
}

function membersOf(room) {
  const list = (room && (room.members || room.players)) || [];
  return list.map((member) => {
    if (member && typeof member === 'object') return member;
    return { id: String(member), role: 'player' };
  });
}

function voiceParticipants() {
  if (!roomRef || !roomRef.voice || !Array.isArray(roomRef.voice.participants)) return [];
  return roomRef.voice.participants;
}

function attach(room, broadcast) {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  roomRef = room;
  unsubscribe = subscribeRoom(room, function onRoomChange() {
    if (roomRef !== room) return;
    renderRoom();
    if (broadcast) post({ type: 'room-update', room: exportRoomSnapshot(room) });
  });
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function renderRoom() {
  const room = roomRef;
  if (!room) {
    ui.roomPanel.hidden = true;
    return;
  }
  ui.roomPanel.hidden = false;
  ui.roomIdText.textContent = room.id || '—';
  ui.roomCodeText.textContent = room.inviteCode || room.code || '—';
  ui.roomGameText.textContent = room.game || room.gameId || '—';
  ui.roomPasswordFlag.textContent = (room.passwordProtected || room.hasPassword) ? '有' : '无';
  ui.roomState.textContent = room.status || '—';

  const members = membersOf(room);
  ui.memberCount.textContent = String(members.length);
  ui.memberList.textContent = '';
  for (const member of members) {
    const item = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = member.id + (member.id === me ? '（你）' : '');
    const roleText = document.createElement('span');
    roleText.className = 'role';
    roleText.textContent = member.id === room.hostId ? '房主' : '玩家';
    item.appendChild(who);
    item.appendChild(roleText);
    ui.memberList.appendChild(item);
  }

  const participants = voiceParticipants();
  const inVoice = me != null && participants.indexOf(me) !== -1;
  ui.voiceState.textContent = participants.length
    ? participants.join('、') + '（占位，无媒体）'
    : '未加入（占位）';
  ui.voiceBtn.textContent = inVoice ? '退出语音（占位）' : '加入语音（占位）';
  ui.voiceBtn.disabled = room.status === 'closed';

  const isHost = room.hostId != null && room.hostId === me;
  ui.closeBtn.hidden = !isHost;
  ui.leaveBtn.disabled = false;

  // Minimal room -> match hand-off: carry the room and the local player in the
  // query string so the playable page can show which room the match belongs to.
  if (ui.startMatchLink) {
    const game = room.game || room.gameId || '';
    const target = game === 'mahjong' ? './mahjong.html' : './card-battle.html';
    ui.startMatchLink.hidden = false;
    ui.startMatchLink.textContent = game === 'mahjong' ? '开始对局（麻将）' : '开始对局（卡牌）';
    ui.startMatchLink.href = target +
      '?room=' + encodeURIComponent(room.id || '') +
      '&player=' + encodeURIComponent(me == null ? '' : String(me));
  }
}

function clearRoomUI(message) {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  roomRef = null;
  me = null;
  role = null;
  token = null;
  clearSession();
  ui.roomPanel.hidden = true;
  if (ui.startMatchLink) ui.startMatchLink.hidden = true;
  setMsg(ui.roomStatus, '', '');
  if (message) toast(message);
}

/* ------------------------------------------------------------------ */
/* create / join / reconnect                                           */
/* ------------------------------------------------------------------ */

function createHostRoom(event) {
  event.preventDefault();
  const nick = (ui.createNick.value || '').trim() || '房主';
  const name = (ui.createName.value || '').trim() || '我的房间';
  const password = ui.createPassword.value || '';
  const maxPlayers = Number(ui.createMax.value) || 4;
  const game = ui.createGame.value || 'mahjong';

  const room = createRoom({
    name,
    hostId: nick,
    password: password || undefined,
    maxPlayers,
    game,
    clientId: tabId
  });

  if (!room || room.ok === false) {
    setMsg(ui.createMsg, errorText(room), 'error');
    return;
  }

  hosted.set(room.id, room);
  me = nick;
  role = 'host';
  roomRef = room;
  const session = joinRoom(room, { userId: nick, clientId: tabId });
  token = session && session.token ? session.token : null;
  attach(room, true);

  setMsg(ui.createMsg, '房间已创建。把房间 ID 发给另一个标签页即可加入。', 'ok');
  setMsg(ui.joinMsg, '', '');
  setMsg(ui.roomStatus, '', '');
  toast('房间已创建：' + room.id);
  renderRoom();
}

function applyJoin(result, remote, playerId) {
  if (!result || result.ok !== true) {
    setMsg(ui.joinMsg, errorText(result), 'error');
    toast(errorText(result));
    return;
  }

  if (remote && result.room) importRoomSnapshot(result.room);
  const room = (result.room && getRoom(result.room.id)) || result.room;
  if (!room) {
    setMsg(ui.joinMsg, '房间数据不可用。', 'error');
    return;
  }

  me = (result.member && result.member.id) || playerId;
  token = result.token || null;
  role = (result.member && result.member.role) || (room.hostId === me ? 'host' : 'player');
  attach(room, hosted.has(room.id));
  saveSession();
  setMsg(ui.joinMsg, '已加入房间。', 'ok');
  setMsg(ui.createMsg, '', '');
  setMsg(ui.roomStatus, '', '');
  toast('已加入：' + room.id);
  renderRoom();
}

function joinExisting(event) {
  event.preventDefault();
  const roomId = (ui.joinRoomId.value || '').trim();
  const nick = (ui.joinNick.value || '').trim();
  const password = ui.joinPassword.value || '';
  const inviteCode = (ui.joinInvite.value || '').trim();

  if (!roomId) {
    setMsg(ui.joinMsg, '请填写房间 ID。', 'error');
    return;
  }
  if (!nick) {
    setMsg(ui.joinMsg, '请填写你的昵称。', 'error');
    return;
  }

  const local = getRoom(roomId);
  if (local && !isRoomMirror(local)) {
    const result = joinRoom(local, {
      userId: nick,
      password,
      inviteCode: inviteCode || undefined,
      clientId: tabId
    });
    applyJoin(result, false, nick);
    return;
  }

  setMsg(ui.joinMsg, '正在联系房主标签页…', '');
  request('join-request', {
    roomId,
    playerId: nick,
    password,
    inviteCode: inviteCode || undefined
  }).then((result) => {
    if (!result) {
      setMsg(ui.joinMsg, '找不到房主标签页。同机多标签请保持房主页打开，或确认房间 ID。', 'error');
      return;
    }
    applyJoin(result, true, nick);
  });
}

function finishReconnect(result, remote, session) {
  if (!result || result.ok !== true) {
    clearSession();
    toast('未能恢复房间（房主标签页可能已关闭）。');
    return;
  }
  if (remote && result.room) importRoomSnapshot(result.room);
  const room = (result.room && getRoom(result.room.id)) || result.room;
  if (!room) {
    clearSession();
    return;
  }
  me = session.playerId;
  token = result.token || session.token;
  role = (result.member && result.member.role) || (room.hostId === me ? 'host' : 'player');
  attach(room, hosted.has(room.id));
  renderRoom();
  toast('已按 session token 恢复房间：' + room.id);
}

function restoreSession() {
  const session = readSession();
  if (!session || !session.roomId || !session.playerId || !session.token) return;
  const local = getRoom(session.roomId);
  if (local && !isRoomMirror(local)) {
    finishReconnect(reconnectRoom(local, { userId: session.playerId, token: session.token }), false, session);
    return;
  }
  if (!channel) return;
  toast('正在恢复上次的房间…');
  request('reconnect-request', {
    roomId: session.roomId,
    playerId: session.playerId,
    token: session.token
  }, 1600).then((result) => {
    if (!result) {
      clearSession();
      toast('未能恢复房间（房主标签页可能已关闭）。');
      return;
    }
    finishReconnect(result, true, session);
  });
}

/* ------------------------------------------------------------------ */
/* leave / close / voice                                               */
/* ------------------------------------------------------------------ */

function leaveCurrentRoom() {
  const room = roomRef;
  if (!room) return;
  const roomId = room.id;
  const authoritative = hosted.get(roomId);

  if (authoritative) {
    leaveRoom(authoritative, me);
  } else {
    post({ type: 'leave-request', roomId, playerId: me });
  }
  clearRoomUI('已离开房间。');
}

function closeCurrentRoom() {
  const room = roomRef;
  if (!room) return;
  const authoritative = hosted.get(room.id) || room;
  const result = closeRoom(authoritative, me);
  if (!result || result.ok !== true) {
    setMsg(ui.roomStatus, errorText(result), 'error');
    return;
  }
  post({ type: 'room-update', room: exportRoomSnapshot(authoritative) });
  hosted.delete(room.id);
  clearRoomUI('房间已关闭。');
}

function toggleVoice() {
  const room = roomRef;
  if (!room || !me) return;
  const joined = voiceParticipants().indexOf(me) !== -1;

  if (hosted.has(room.id) || !isRoomMirror(room)) {
    if (joined) leaveVoice(room, me);
    else joinVoice(room, me);
    renderRoom();
    return;
  }

  post({
    type: 'voice-request',
    roomId: room.id,
    playerId: me,
    action: joined ? 'leave' : 'join'
  });
  // Optimistic placeholder state in the mirror tab; the host snapshot follows.
  if (joined) leaveVoice(room, me);
  else joinVoice(room, me);
  renderRoom();
  setMsg(ui.roomStatus, '语音为接口占位：未请求麦克风，也未建立媒体连接。', '');
}

ui.createForm.addEventListener('submit', createHostRoom);
ui.joinForm.addEventListener('submit', joinExisting);
ui.leaveBtn.addEventListener('click', leaveCurrentRoom);
ui.closeBtn.addEventListener('click', closeCurrentRoom);
ui.voiceBtn.addEventListener('click', toggleVoice);

if (!channel) {
  toast('当前浏览器不支持 BroadcastChannel：只能在同一标签页内创建/加入房间。');
}

restoreSession();
