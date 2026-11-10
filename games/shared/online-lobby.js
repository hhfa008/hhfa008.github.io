/* Shared online lobby controller for the premium abstract games.
 *
 * The page supplies the markup (ids below) and sets window.__LOBBY_CONFIG:
 *   { game, lastKey, nameKey, names: [...], enterUrl }
 * API contract (see games/shared/boardgame-room-server.mjs):
 *   POST /api/rooms, /join, /start, /invite, /leave, /reconnect, /restart
 *   GET  /api/rooms/:id, /api/leaderboard
 */
(function () {
  'use strict';
  var cfg = window.__LOBBY_CONFIG || {};
  var LAST_KEY = cfg.lastKey || 'boardgame-online-last-v1';
  var NAME_KEY = cfg.nameKey || 'boardgame-name';
  var NAMES = cfg.names || ['楚河', '汉界', '飞象', '跳马', '当头炮', '过河卒'];
  var ENTER_URL = cfg.enterUrl || 'index.html';
  var SEAT_NAMES = cfg.seatNames || ['先手', '后手'];
  var $ = function (id) { return document.getElementById(id); };
  var state = { room: '', session: '', playerId: '', view: null, timer: null };

  function readJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
  }
  function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {} }
  function removeKey(key) { try { localStorage.removeItem(key); } catch (err) {} }
  function status(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function randomName() { return NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10); }
  function savedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (err) { return ''; } }
  function rememberName(name) { try { localStorage.setItem(NAME_KEY, name); } catch (err) {} }

  function api(method, route, body) {
    return fetch(route, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (err) { data = null; }
        return { status: res.status, body: data };
      });
    });
  }
  function errText(res) {
    return (res.body && res.body.error && res.body.error.message) || ('请求失败（' + res.status + '）');
  }
  function gameUrl() {
    return ENTER_URL + '?online=' + encodeURIComponent(state.room) +
      '&session=' + encodeURIComponent(state.session) +
      '&player=' + encodeURIComponent(state.playerId);
  }
  function saveLast() {
    writeJSON(LAST_KEY, { room: state.room, session: state.session, playerId: state.playerId, roomCode: state.view && state.view.roomCode });
  }

  function renderSeats(view) {
    var box = $('seats');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    (view.seats || []).forEach(function (seat) {
      var row = document.createElement('div');
      row.className = 'seat';
      var name = document.createElement('span');
      name.textContent = (SEAT_NAMES[seat.index] || ('座位 ' + (seat.index + 1))) + ' · ' + (seat.nickname || '空位');
      var tag = document.createElement('span');
      tag.className = 'tag' + (seat.ai ? ' ai' : '');
      tag.textContent = seat.ai ? 'AI' : (seat.index === (view.you ? view.you.playerIndex : -1) ? '你' : '玩家');
      row.appendChild(name);
      row.appendChild(tag);
      box.appendChild(row);
    });
  }
  function renderRoom() {
    var view = state.view;
    if (!view) { if ($('roomPanel')) $('roomPanel').hidden = true; return; }
    $('roomPanel').hidden = false;
    $('roomCode').textContent = view.roomCode || state.room.slice(0, 6);
    $('roomStatus').textContent = view.status === 'playing' ? '对局中' : view.status === 'finished' ? '已结束' : '等待中';
    renderSeats(view);
    $('startBtn').disabled = view.started ? !view.isHost : !view.canStart;
    $('startBtn').textContent = view.started ? '重新开始（房主）' : '开始对局';
    $('enterBtn').disabled = !view.started;
    $('inviteBox').hidden = !view.inviteToken;
    if (view.inviteToken) $('inviteToken').textContent = view.inviteToken;
    $('inviteBtn').disabled = !view.isHost;
    $('leaveBtn').disabled = false;
    status($('roomStatusText'), view.started ? '对局已开始。进入棋盘走棋；离开后座位将由 AI 托管。' : '把房间码发给朋友，或直接开始让 AI 补位。', 'ok');
  }

  function renderLeaderboard(entries) {
    var list = $('leaderboard');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!entries || !entries.length) {
      var empty = document.createElement('li');
      empty.className = 'empty-note';
      empty.textContent = '还没有结算记录。';
      list.appendChild(empty);
      return;
    }
    entries.slice(0, 12).forEach(function (e) {
      var li = document.createElement('li');
      var winner = e.winnerSeat == null ? '和棋' : (e.winnerSeat === 0 ? '先手胜' : '后手胜');
      var names = (e.players || []).map(function (p) { return p.nickname; }).join(' vs ');
      var b = document.createElement('b');
      b.textContent = winner;
      li.appendChild(b);
      li.appendChild(document.createTextNode(' · ' + names + ' · 房间 ' + e.roomCode + (e.moves != null ? ' · ' + e.moves + ' 手' : '')));
      list.appendChild(li);
    });
  }
  function loadLeaderboard() {
    if (location.pathname.indexOf('/games/') === 0) return; // static site: no room API
    api('GET', '/api/leaderboard').then(function (res) {
      if (res.status === 200) renderLeaderboard(res.body.entries);
    }).catch(function () {});
  }

  function refreshRoom() {
    if (!state.room) return;
    api('GET', '/api/rooms/' + encodeURIComponent(state.room) +
      '?session=' + encodeURIComponent(state.session) +
      '&playerId=' + encodeURIComponent(state.playerId)).then(function (res) {
      if (res.status === 200) { state.view = res.body; renderRoom(); saveLast(); }
    }).catch(function () {});
  }
  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(refreshRoom, 1500);
  }
  function forgetRoom() {
    if (state.room) removeKey(LAST_KEY);
    if (state.timer) clearInterval(state.timer);
    state.room = ''; state.session = ''; state.playerId = ''; state.view = null;
    if ($('roomPanel')) $('roomPanel').hidden = true;
    if ($('createSection')) $('createSection').hidden = false;
    if ($('joinSection')) $('joinSection').hidden = false;
    if ($('reconnectSection')) $('reconnectSection').hidden = true;
  }

  async function createRoom() {
    var name = $('createName').value.trim() || randomName();
    rememberName(name);
    var password = $('createPassword').value;
    if (password && (password.length < 4 || password.length > 64)) {
      status($('createStatus'), '密码需要 4–64 位。', 'error'); return;
    }
    try {
      status($('createStatus'), '创建中…');
      var res = await api('POST', '/api/rooms', {
        playerId: name, nickname: name,
        password: password || undefined,
        visibility: $('createVisibility').value
      });
      if (res.status !== 201) { status($('createStatus'), errText(res), 'error'); return; }
      state.room = res.body.roomId;
      state.session = res.body.playerSession;
      state.playerId = name;
      state.view = res.body;
      saveLast();
      $('createSection').hidden = true;
      $('joinSection').hidden = true;
      $('reconnectSection').hidden = true;
      renderRoom();
      refreshRoom();
      loadLeaderboard();
      startPolling();
      status($('createStatus'), '房间已创建。把房间码或邀请 token 发给朋友；也可以直接开始让 AI 补位。', 'ok');
    } catch (err) {
      status($('createStatus'), '创建失败：' + err.message, 'error');
    }
  }

  async function joinRoom() {
    var code = $('joinCode').value.trim().toUpperCase();
    var name = $('joinName').value.trim() || randomName();
    if (!code) { status($('joinStatus'), '请填写房间码。', 'error'); return; }
    rememberName(name);
    var body = { playerId: name, nickname: name };
    if ($('joinInvite').value.trim()) body.inviteCode = $('joinInvite').value.trim();
    else if ($('joinPassword').value) body.password = $('joinPassword').value;
    try {
      status($('joinStatus'), '加入中…');
      var res = await api('POST', '/api/rooms/' + encodeURIComponent(code) + '/join', body);
      if (res.status !== 200) { status($('joinStatus'), errText(res), 'error'); return; }
      state.room = res.body.roomId;
      state.session = res.body.playerSession;
      state.playerId = name;
      state.view = res.body;
      saveLast();
      $('createSection').hidden = true;
      $('joinSection').hidden = true;
      $('reconnectSection').hidden = true;
      renderRoom();
      refreshRoom();
      loadLeaderboard();
      startPolling();
      status($('joinStatus'), '已加入房间。等待房主开始。', 'ok');
    } catch (err) {
      status($('joinStatus'), '加入失败：' + err.message, 'error');
    }
  }

  async function startRoom() {
    if (!state.view || !state.view.isHost) return;
    try {
      status($('roomStatusText'), '开始中…');
      var res = await api('POST', '/api/rooms/' + encodeURIComponent(state.room) + '/start', {
        session: state.session, playerId: state.playerId
      });
      if (res.status !== 200) { status($('roomStatusText'), errText(res), 'error'); return; }
      state.view = res.body;
      renderRoom();
      location.href = gameUrl();
    } catch (err) {
      status($('roomStatusText'), '开始失败：' + err.message, 'error');
    }
  }

  async function inviteAgain() {
    if (!state.view || !state.view.isHost) return;
    try {
      var res = await api('POST', '/api/rooms/' + encodeURIComponent(state.room) + '/invite', {
        session: state.session, playerId: state.playerId
      });
      if (res.status === 200) {
        state.view.inviteToken = res.body.inviteToken;
        renderRoom();
        status($('roomStatusText'), '已刷新邀请 token。', 'ok');
      } else status($('roomStatusText'), errText(res), 'error');
    } catch (err) {
      status($('roomStatusText'), '刷新失败：' + err.message, 'error');
    }
  }

  async function leaveRoom() {
    if (!state.room) return;
    try {
      await api('POST', '/api/rooms/' + encodeURIComponent(state.room) + '/leave', {
        session: state.session, playerId: state.playerId
      });
    } catch (err) {}
    forgetRoom();
    status($('createStatus'), '已离开房间。');
  }

  async function reconnectLast() {
    var last = readJSON(LAST_KEY);
    if (!last || !last.room) { $('reconnectSection').hidden = true; return; }
    state.room = last.room; state.session = last.session; state.playerId = last.playerId;
    try {
      var res = await api('POST', '/api/rooms/' + encodeURIComponent(last.room) + '/reconnect', {
        session: last.session, playerId: last.playerId
      });
      if (res.status !== 200) {
        removeKey(LAST_KEY);
        $('reconnectSection').hidden = true;
        status($('joinStatus'), '上次房间已失效：' + errText(res), 'error');
        return;
      }
      state.view = res.body;
      $('createSection').hidden = true;
      $('joinSection').hidden = true;
      $('reconnectSection').hidden = true;
      renderRoom();
      refreshRoom();
      startPolling();
      status($('roomStatusText'), '已重连上次房间。', 'ok');
    } catch (err) {
      status($('joinStatus'), '重连失败：' + err.message, 'error');
    }
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    var name = savedName() || randomName();
    if ($('createName')) $('createName').value = name;
    if ($('joinName')) $('joinName').value = name;
    if (params.get('room') && $('joinCode')) $('joinCode').value = params.get('room');
    $('createBtn').addEventListener('click', createRoom);
    $('joinBtn').addEventListener('click', joinRoom);
    $('startBtn').addEventListener('click', startRoom);
    $('enterBtn').addEventListener('click', function () {
      if (state.room && state.view && state.view.started) location.href = gameUrl();
    });
    $('inviteBtn').addEventListener('click', inviteAgain);
    $('leaveBtn').addEventListener('click', leaveRoom);
    $('reconnectBtn').addEventListener('click', reconnectLast);
    $('forgetBtn').addEventListener('click', function () { forgetRoom(); status($('createStatus'), '已清除上次房间记录。'); });
    loadLeaderboard();
    var last = readJSON(LAST_KEY);
    if (last && last.room) {
      $('reconnectSection').hidden = false;
      $('reconnectText').textContent = '上次房间 ' + (last.roomCode || last.room) + ' 未结束。可直接重连，或创建 / 加入新房间。';
    }
    window.addEventListener('beforeunload', function () { if (state.timer) clearInterval(state.timer); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
