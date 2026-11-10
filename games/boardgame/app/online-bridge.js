/* Shared online bridge for premium game pages.
 *
 * The lobby (online.html) redirects to the game page with
 *   ?online=<roomId>&session=<token>&player=<name>
 * This script polls the authoritative room state and exposes a tiny API:
 *   OnlineBridge.active            true when the page is in online mode
 *   OnlineBridge.view              latest room view
 *   OnlineBridge.onChange(fn)      subscribe to view updates
 *   OnlineBridge.onError(fn)       subscribe to action/poll errors
 *   OnlineBridge.send(move)        POST /actions with the engine move
 *   OnlineBridge.restart()         host rematch
 *   OnlineBridge.isMyTurn()        current seat is this client and not AI
 *   OnlineBridge.seatIndex()       this client's seat
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var room = params.get('online') || params.get('room');
  if (!room) { window.OnlineBridge = { active: false }; return; }
  var readJSON = function (key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err) { return null; } };
  var writeJSON = function (key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {} };
  var gameKey = document.documentElement.getAttribute('data-online-key') ||
    (location.pathname.split('/').filter(Boolean).slice(-2)[0] || 'game');
  var saved = readJSON(gameKey + '-online-session-' + room) || {};
  var state = {
    room: room,
    session: params.get('session') || saved.session || '',
    playerId: params.get('player') || saved.playerId || '',
    view: null,
    timer: null,
    sending: false,
    closed: false
  };
  var listeners = [];
  var errorListeners = [];

  function emit() { listeners.slice().forEach(function (fn) { try { fn(state.view); } catch (err) {} }); }
  function emitError(err) { errorListeners.slice().forEach(function (fn) { try { fn(err); } catch (e) {} }); }
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
      throw Object.assign(new Error(data && data.error && data.error.message ? data.error.message : ('HTTP ' + response.status)), {
        code: data && data.error && data.error.code, status: response.status
      });
    }
    return data;
  }
  function laneUrl(suffix) {
    return '/api/rooms/' + encodeURIComponent(state.room) + (suffix || '');
  }
  async function poll() {
    if (state.closed) return;
    if (!state.session || !state.playerId) {
      location.replace('online.html?room=' + encodeURIComponent(state.room));
      return;
    }
    try {
      var view = await api('GET', laneUrl() +
        '?session=' + encodeURIComponent(state.session) + '&playerId=' + encodeURIComponent(state.playerId));
      state.view = view;
      writeJSON(gameKey + '-online-session-' + state.room, { session: state.session, playerId: state.playerId });
      emit();
    } catch (err) {
      emitError(err);
      if (err.status === 404 || err.code === 'E_SESSION' || err.code === 'E_PLAYER') {
        state.closed = true;
        return;
      }
    }
    clearTimeout(state.timer);
    state.timer = setTimeout(poll, 900);
  }
  async function send(move) {
    if (state.sending || !state.view) return null;
    state.sending = true;
    try {
      var view = await api('POST', laneUrl('/actions'), {
        session: state.session, playerId: state.playerId, type: 'move', move: move
      });
      state.view = view;
      emit();
      return view;
    } catch (err) {
      emitError(err);
      return null;
    } finally {
      state.sending = false;
    }
  }
  async function restart() {
    try {
      var view = await api('POST', laneUrl('/restart'), { session: state.session, playerId: state.playerId });
      state.view = view;
      emit();
      return view;
    } catch (err) { emitError(err); return null; }
  }
  function seatIndex() {
    return state.view && state.view.you ? state.view.you.playerIndex : -1;
  }
  function isMyTurn() {
    var view = state.view;
    return !!(view && view.canMove && view.currentPlayerIndex === seatIndex());
  }
  window.OnlineBridge = {
    active: true,
    room: room,
    view: function () { return state.view; },
    onChange: function (fn) { listeners.push(fn); if (state.view) fn(state.view); },
    onError: function (fn) { errorListeners.push(fn); },
    send: send,
    restart: restart,
    seatIndex: seatIndex,
    isMyTurn: isMyTurn,
    session: function () { return { session: state.session, playerId: state.playerId }; }
  };
  poll();
})();
