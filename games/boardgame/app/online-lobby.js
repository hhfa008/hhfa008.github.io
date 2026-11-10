/* Shared premium online lobby client. Each game's online.html sets
 * window.ONLINE_GAME before loading this file. */
(function () {
  'use strict';
  var CFG = window.ONLINE_GAME || {};
  var GAME = CFG.id || 'game';
  var $ = function (id) { return document.getElementById(id); };
  var state = { room: '', session: '', playerId: '', view: null, timer: null, redirecting: false };

  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err) { return null; } }
  function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {} }
  function removeKey(key) { try { localStorage.removeItem(key); } catch (err) {} }
  function randomName() { return '玩家' + String(Math.floor(1000 + Math.random() * 9000)); }
  function savedName() { try { return localStorage.getItem(GAME + '-online-name') || ''; } catch (err) { return ''; } }
  function rememberName(name) { try { localStorage.setItem(GAME + '-online-name', name); } catch (err) {} }
  function status(text, kind) {
    var el = $('status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  async function api(method, route, body) {
    var response = await fetch(route, {
      method: method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await response.text();
    var data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    if (!response.ok) {
      var message = data && data.error && data.error.message ? data.error.message : ('HTTP ' + response.status);
      throw Object.assign(new Error(message), { code: data && data.error && data.error.code, status: response.status });
    }
    return data;
  }
  function saveSession(view, session, playerId) {
    state.room = view.roomId;
    state.session = session;
    state.playerId = playerId;
    state.view = view;
    writeJSON(GAME + '-online-session-' + view.roomId, { session: session, playerId: playerId });
    writeJSON(GAME + '-online-player-' + view.roomId, { playerId: playerId });
  }
  function gameUrl() {
    return (CFG.gameHref || 'index.html') + '?online=' + encodeURIComponent(state.room) +
      '&session=' + encodeURIComponent(state.session) + '&player=' + encodeURIComponent(state.playerId);
  }
  function renderRoom() {
    var view = state.view;
    if (!view) return;
    $('lobbySection').hidden = true;
    $('roomSection').hidden = false;
    $('roomCode').textContent = view.roomCode || view.inviteCode || '——';
    var humans = view.seats.filter(function (s) { return !s.ai; }).length;
    $('roomMeta').innerHTML =
      '<span class="chip">玩家 <b>' + humans + '</b> / ' + view.maxPlayers + '</span>' +
      '<span class="chip">状态 <b>' + escapeHtml(view.status) + '</b></span>' +
      (view.hasPassword ? '<span class="chip">密码房</span>' : '') +
      (view.isHost ? '<span class="chip">你是房主</span>' : '');
    $('seatList').innerHTML = view.seats.map(function (seat) {
      var tags = [];
      if (seat.ai) tags.push('AI 补位');
      if (seat.takeover) tags.push('托管中');
      if (seat.current) tags.push('行动中');
      return '<div class="seat' + (seat.ai ? ' ai' : '') + (seat.current ? ' current' : '') + '">' +
        '<span class="idx">' + (seat.index + 1) + '</span>' +
        '<span class="who">' + escapeHtml(seat.nickname || ('座位 ' + (seat.index + 1))) + '</span>' +
        '<span class="tag">' + escapeHtml(tags.join(' · ') || '等待') + '</span></div>';
    }).join('');
    $('startBtn').hidden = !view.canStart;
    $('startBtn').disabled = !view.canStart;
    $('inviteBtn').hidden = !view.isHost;
    $('leaveBtn').hidden = !state.room;
    if (view.inviteToken) {
      $('inviteBox').hidden = false;
      $('inviteToken').value = view.inviteToken;
    }
    if (view.started && !state.redirecting) {
      state.redirecting = true;
      status('对局已开始，正在进入牌桌…', 'ok');
      setTimeout(function () { location.href = gameUrl(); }, 420);
    }
  }
  async function refreshRoom() {
    if (!state.room || !state.session) return;
    try {
      var view = await api('GET', '/api/rooms/' + encodeURIComponent(state.room) +
        '?session=' + encodeURIComponent(state.session) + '&playerId=' + encodeURIComponent(state.playerId));
      state.view = view;
      renderRoom();
    } catch (err) {
      if (err.status === 404) {
        status('房间已关闭，请重新创建或加入。', 'error');
        forgetRoom();
      } else {
        status(err.message || '刷新房间失败', 'error');
      }
    }
    clearTimeout(state.timer);
    state.timer = setTimeout(refreshRoom, 1500);
  }
  async function loadLeaderboard() {
    if (location.pathname.indexOf('/games/') === 0) return; // static site: no room API
    var box = $('leaderboard');
    if (!box) return;
    try {
      var data = await api('GET', '/api/leaderboard?limit=8');
      if (!data.entries.length) {
        box.innerHTML = '<div class="entry"><span class="rank">—</span><span class="who">还没有完成的联机对局</span><span class="score"></span></div>';
        return;
      }
      box.innerHTML = data.entries.map(function (entry, i) {
        var best = entry.scores && entry.scores.length
          ? Math.max.apply(null, entry.scores.map(function (s) { return Number(s.total) || 0; })) : 0;
        return '<div class="entry"><span class="rank">' + (i + 1) + '</span>' +
          '<span class="who">' + escapeHtml(entry.winnerName || '平局') + '</span>' +
          '<span class="score">' + best + '</span></div>';
      }).join('');
    } catch (err) {
      box.innerHTML = '<div class="entry"><span class="rank">—</span><span class="who">榜单暂不可用</span><span class="score"></span></div>';
    }
  }
  async function createRoom() {
    var name = ($('hostName').value || '').trim() || randomName();
    rememberName(name);
    var body = { playerId: name, maxPlayers: Number($('maxPlayers').value) || 2 };
    var password = ($('hostPassword').value || '').trim();
    if (password) body.password = password;
    if ($('privateRoom').checked) body.visibility = 'private';
    try {
      var data = await api('POST', '/api/rooms', body);
      saveSession(data, data.playerSession, name);
      status('房间已创建，把房间码或邀请码发给朋友。', 'ok');
      renderRoom();
      refreshRoom();
    } catch (err) { status(err.message || '创建房间失败', 'error'); }
  }
  async function joinRoom() {
    var code = ($('joinCode').value || '').trim().toUpperCase();
    var name = ($('joinName').value || '').trim() || randomName();
    rememberName(name);
    if (!code) return status('请填写房间码。', 'error');
    var body = { playerId: name };
    var invite = ($('joinInvite').value || '').trim();
    var password = ($('joinPassword').value || '').trim();
    if (invite) body.inviteCode = invite;
    else if (password) body.password = password;
    try {
      var data = await api('POST', '/api/rooms/' + encodeURIComponent(code) + '/join', body);
      saveSession(data, data.playerSession, name);
      status('已加入房间。', 'ok');
      renderRoom();
      refreshRoom();
    } catch (err) { status(err.message || '加入房间失败', 'error'); }
  }
  async function startRoom() {
    if (!state.view || !state.view.canStart) return;
    try {
      var data = await api('POST', '/api/rooms/' + encodeURIComponent(state.room) + '/start', {
        session: state.session, playerId: state.playerId
      });
      state.view = data;
      renderRoom();
    } catch (err) { status(err.message || '开局失败', 'error'); }
  }
  async function inviteAgain() {
    if (!state.view || !state.view.isHost) return;
    try {
      var data = await api('POST', '/api/rooms/' + encodeURIComponent(state.room) + '/invite', {
        session: state.session, playerId: state.playerId
      });
      state.view.inviteToken = data.inviteToken;
      renderRoom();
      status('新的单次邀请码已生成。', 'ok');
    } catch (err) { status(err.message || '生成邀请失败', 'error'); }
  }
  async function leaveRoom() {
    if (!state.room) return;
    try {
      await api('POST', '/api/rooms/' + encodeURIComponent(state.room) + '/leave', {
        session: state.session, playerId: state.playerId
      });
    } catch (err) {}
    forgetRoom();
    status('已离开房间。', 'ok');
  }
  function forgetRoom() {
    if (state.room) removeKey(GAME + '-online-session-' + state.room);
    state.room = ''; state.session = ''; state.playerId = ''; state.view = null;
    clearTimeout(state.timer);
    $('lobbySection').hidden = false;
    $('roomSection').hidden = true;
  }
  function copyInvite() {
    var input = $('inviteToken');
    if (!input) return;
    input.select();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(function () { status('邀请码已复制。', 'ok'); });
      } else {
        document.execCommand('copy');
        status('邀请码已复制。', 'ok');
      }
    } catch (err) { status('请手动复制邀请码。', 'error'); }
  }
  function bind() {
    document.documentElement.style.setProperty('--accent', CFG.accent || '#2f6fb5');
    if (CFG.art) document.documentElement.style.setProperty('--lobby-art', 'url("' + CFG.art + '")');
    $('hostName').value = savedName();
    $('joinName').value = savedName();
    $('maxPlayers').innerHTML = Array.from({ length: Math.max(0, (CFG.maxPlayers || 4) - 1) }, function (_, i) {
      var n = i + 2;
      return '<option value="' + n + '">' + n + ' 人</option>';
    }).join('');
    $('createBtn').addEventListener('click', createRoom);
    $('joinBtn').addEventListener('click', joinRoom);
    $('startBtn').addEventListener('click', startRoom);
    $('inviteBtn').addEventListener('click', inviteAgain);
    $('leaveBtn').addEventListener('click', leaveRoom);
    $('copyInvite').addEventListener('click', copyInvite);
    $('newRoomBtn').addEventListener('click', forgetRoom);
    var saved = readJSON(GAME + '-online-session-' + (new URLSearchParams(location.search).get('room') || ''));
    if (saved) {
      state.room = new URLSearchParams(location.search).get('room');
      state.session = saved.session;
      state.playerId = saved.playerId;
      refreshRoom();
    }
    loadLeaderboard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
