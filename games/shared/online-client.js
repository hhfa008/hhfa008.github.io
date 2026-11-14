/* 联机大厅客户端（UMD，零依赖）。
 *
 * 36 个 online.html 重复实现同一套「创建/加入/轮询/重连/动作」，本模块把这层
 * 收敛成一份；页面只保留自己的棋盘渲染。
 *
 *   var oc = OnlineClient.create({ game: 'connect4-premium', storagePrefix: 'c4p-online' });
 *   oc.load();                        // URL ?room&session&player&api + sessionStorage
 *   oc.setNickname('玩家-1');
 *   oc.createRoom({ playerId });      // POST /api/rooms
 *   oc.joinRoom(key, { playerId });   // POST /api/rooms/:id/join
 *   oc.onView(render); oc.onError(toast);
 *   oc.start();                       // GET room + 700ms 轮询，401 自动 reconnect
 *   oc.action(move); oc.startMatch(); oc.restart(); oc.leave(); oc.invite();
 *   oc.stop();
 *
 * API base：?api=<origin>（Worker 部署）或 sessionStorage 记忆；默认同源。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.OnlineClient = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function create(cfg) {
    var conf = cfg || {};
    var game = conf.game || 'game';
    var prefix = conf.storagePrefix || ('oc.' + game);
    var pollMs = Math.max(200, Number(conf.pollMs) || 700);
    var apiBase = String(conf.apiBase || '').replace(/\/+$/, '');
    var state = {
      roomId: '', session: '', playerId: '', nickname: '', inviteCode: '',
      view: null, pollErrors: 0, closed: false
    };
    var timer = null;
    var viewListeners = [];
    var errorListeners = [];

    function read(key) { try { return root.sessionStorage.getItem(key) || ''; } catch (e) { return ''; } }
    function write(key, value) {
      try {
        if (value == null || value === '') root.sessionStorage.removeItem(key);
        else root.sessionStorage.setItem(key, value);
      } catch (e) { /* storage optional */ }
    }

    function load() {
      var params = new root.URLSearchParams(root.location.search);
      state.roomId = params.get('room') || '';
      state.session = params.get('session') || read(prefix + '-session');
      state.playerId = params.get('player') || read(prefix + '-player');
      state.nickname = read(prefix + '-nick');
      state.inviteCode = params.get('code') || params.get('invite') || '';
      var api = params.get('api') || read(prefix + '-api');
      if (api) apiBase = String(api).replace(/\/+$/, '');
      return state;
    }

    function remember() {
      write(prefix + '-session', state.session);
      write(prefix + '-player', state.playerId);
      write(prefix + '-nick', state.nickname);
      if (apiBase) write(prefix + '-api', apiBase);
      try {
        var query = '?room=' + encodeURIComponent(state.roomId) +
          '&session=' + encodeURIComponent(state.session) +
          '&player=' + encodeURIComponent(state.playerId) +
          (apiBase ? '&api=' + encodeURIComponent(apiBase) : '');
        root.history.replaceState(null, '', root.location.pathname + query);
      } catch (e) { /* ignore */ }
    }

    function url(path) { return (apiBase ? apiBase : '') + path; }

    function api(method, path, body) {
      return root.fetch(url(path), {
        method: method,
        headers: body != null ? { 'content-type': 'application/json' } : undefined,
        body: body != null ? JSON.stringify(body) : undefined
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { data = null; }
          return { status: res.status, body: data };
        });
      });
    }

    function errText(res) {
      return (res && res.body && res.body.error && res.body.error.message) ||
        ('HTTP ' + (res ? res.status : '?'));
    }

    function emit(view) {
      state.view = view;
      viewListeners.slice().forEach(function (fn) { try { fn(view); } catch (e) { /* ignore */ } });
    }
    function emitError(err) {
      state.pollErrors += 1;
      errorListeners.slice().forEach(function (fn) { try { fn(err); } catch (e) { /* ignore */ } });
    }

    function fetchView() {
      if (!state.roomId || !state.session) return Promise.resolve(null);
      return api('GET', '/api/rooms/' + encodeURIComponent(state.roomId) +
        '?session=' + encodeURIComponent(state.session) +
        '&playerId=' + encodeURIComponent(state.playerId))
        .then(function (res) {
          if (res.status === 401) {
            return api('POST', '/api/rooms/' + encodeURIComponent(state.roomId) + '/reconnect', {
              session: state.session, playerId: state.playerId
            }).then(function (retry) {
              if (!retry.body || retry.body.ok === false) throw new Error('房间已失效，请重新创建。');
              return retry;
            });
          }
          if (res.status >= 400) throw new Error(errText(res));
          return res;
        })
        .then(function (res) {
          if (!res) return null;
          state.pollErrors = 0;
          var view = res.body || {};
          if (view.inviteToken) state.inviteCode = view.inviteToken;
          if (view.inviteCode) state.inviteCode = view.inviteCode;
          emit(view);
          return view;
        })
        .catch(function (err) {
          emitError(err);
          return null;
        });
    }

    function start() {
      stop();
      state.closed = false;
      fetchView();
      timer = root.setInterval(fetchView, pollMs);
      return apiObject;
    }
    function stop() {
      if (timer) root.clearInterval(timer);
      timer = null;
    }

    function post(suffix, body) {
      return api('POST', '/api/rooms/' + encodeURIComponent(state.roomId) + (suffix || ''), body);
    }
    function withSession(extra) {
      var body = { session: state.session, playerId: state.playerId };
      Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
      return body;
    }

    function createRoom(opts) {
      var body = opts || {};
      if (!body.playerId) body.playerId = 'oc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      body.nickname = state.nickname || body.nickname;
      return api('POST', '/api/rooms', body).then(function (res) {
        if (!res.body || !res.body.roomId) throw new Error(errText(res));
        state.roomId = res.body.roomId;
        state.session = res.body.session;
        state.playerId = res.body.playerId || body.playerId;
        state.inviteCode = res.body.inviteToken || state.inviteCode;
        remember();
        return res.body;
      });
    }

    function joinRoom(roomKey, opts) {
      var body = opts || {};
      if (!body.playerId) body.playerId = 'oc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      body.nickname = state.nickname || body.nickname;
      return api('POST', '/api/rooms/' + encodeURIComponent(roomKey) + '/join', body).then(function (res) {
        if (!res.body || !res.body.session) throw new Error(errText(res));
        state.roomId = res.body.roomId || roomKey;
        state.session = res.body.session;
        state.playerId = res.body.playerId || body.playerId;
        if (res.body.inviteToken) state.inviteCode = res.body.inviteToken;
        remember();
        return res.body;
      });
    }

    function action(move, idempotencyKey) {
      if (!state.session) return Promise.resolve(null);
      var body = withSession({ action: move });
      if (idempotencyKey) body.idempotencyKey = idempotencyKey;
      return post('/actions', body).then(function (res) {
        if (res.status >= 400) throw new Error(errText(res));
        state.view = res.body || state.view;
        return res.body;
      });
    }

    function simple(suffix) {
      return post(suffix, withSession()).then(function (res) {
        if (res.status >= 400) throw new Error(errText(res));
        state.view = res.body || state.view;
        return res.body;
      });
    }

    function startMatch() { return simple('/start'); }
    function restart() { return simple('/restart'); }
    function leave() { return simple('/leave').catch(function () { return null; }); }
    function closeRoom() { return api('DELETE', '/api/rooms/' + encodeURIComponent(state.roomId) + '?session=' + encodeURIComponent(state.session)).then(function (res) { if (res.status >= 400) throw new Error(errText(res)); return res.body; }); }
    function invite() { return simple('/invite'); }

    function inviteUrl() {
      return root.location.origin + root.location.pathname +
        '?room=' + encodeURIComponent(state.roomId) +
        '&code=' + encodeURIComponent(state.inviteCode || '') +
        (apiBase ? '&api=' + encodeURIComponent(apiBase) : '');
    }

    var apiObject = {
      game: game,
      load: load,
      remember: remember,
      api: api,
      errText: errText,
      fetchView: fetchView,
      start: start,
      stop: stop,
      onView: function (fn) { if (typeof fn === 'function') viewListeners.push(fn); return apiObject; },
      onError: function (fn) { if (typeof fn === 'function') errorListeners.push(fn); return apiObject; },
      createRoom: createRoom,
      joinRoom: joinRoom,
      action: action,
      startMatch: startMatch,
      restart: restart,
      leave: leave,
      closeRoom: closeRoom,
      invite: invite,
      inviteUrl: inviteUrl,
      room: function () { return state.roomId; },
      session: function () { return state.session; },
      playerId: function () { return state.playerId; },
      nickname: function () { return state.nickname; },
      inviteCode: function () { return state.inviteCode; },
      view: function () { return state.view; },
      pollErrors: function () { return state.pollErrors; },
      setNickname: function (value) { state.nickname = String(value || ''); remember(); return state.nickname; },
      setApiBase: function (value) { apiBase = String(value || '').replace(/\/+$/, ''); return apiBase; },
      setSession: function (roomId, session, playerId) {
        if (roomId != null) state.roomId = roomId;
        if (session != null) state.session = session;
        if (playerId != null) state.playerId = playerId;
        remember();
        return apiObject;
      }
    };
    return apiObject;
  }

  return { create: create, version: '1.0.0' };
});
