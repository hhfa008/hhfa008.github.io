/* 场景 / 人物 / 事件运行时（UMD，零依赖）。
 *
 *   var scene = Scene.create({ id, ambience, cast: [{id, name, role, emotion, stats}] })
 *   scene.updateCast(id, patch)         // 角色状态（情绪/血量/资源）
 *   scene.on(type, fn)                  // 订阅事件（返回取消函数）
 *   scene.emit(type, payload)           // 回合/行动/命中/结算/失败…
 *   scene.events(limit)                 // 最近事件（叙事日志的数据源）
 *   scene.snapshot() / Scene.restore()  // 存档：可 JSON 序列化
 *
 * 设计目标：场景（环境+音景）、人物（角色与状态）、事件（触发与叙事）
 * 成为所有游戏共用的三层，而不是每页各自散着写。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scene = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_EVENTS = 80;

  function create(cfg) {
    var conf = cfg || {};
    var cast = {};
    (conf.cast || []).forEach(function (member) {
      if (!member || !member.id) return;
      cast[member.id] = {
        id: member.id,
        name: member.name || member.id,
        role: member.role || 'neutral',
        emotion: member.emotion || 'neutral',
        stats: Object.assign({}, member.stats || {})
      };
    });
    var listeners = {};
    var events = [];
    var log = [];

    function emit(type, payload) {
      var event = { type: String(type), at: events.length, payload: payload || null };
      events.push(event);
      if (events.length > MAX_EVENTS) events.shift();
      log.push(event);
      if (log.length > MAX_EVENTS) log.shift();
      (listeners[type] || []).slice().forEach(function (fn) {
        try { fn(event); } catch (e) { /* listeners must not break the game */ }
      });
      (listeners['*'] || []).slice().forEach(function (fn) {
        try { fn(event); } catch (e) { /* ignore */ }
      });
      return event;
    }

    function on(type, fn) {
      if (typeof fn !== 'function') throw new Error('on: listener required');
      var key = String(type);
      (listeners[key] = listeners[key] || []).push(fn);
      return function off() {
        listeners[key] = (listeners[key] || []).filter(function (f) { return f !== fn; });
      };
    }

    function updateCast(id, patch) {
      var member = cast[id];
      if (!member) throw new Error('unknown cast id: ' + id);
      Object.keys(patch || {}).forEach(function (k) {
        if (k === 'stats') member.stats = Object.assign({}, member.stats, patch.stats || {});
        else if (k !== 'id') member[k] = patch[k];
      });
      return member;
    }

    function snapshot() {
      return {
        id: conf.id || 'scene',
        ambience: conf.ambience || 'table',
        cast: Object.keys(cast).map(function (k) { return cast[k]; }),
        events: events.slice()
      };
    }

    return {
      id: conf.id || 'scene',
      ambience: conf.ambience || 'table',
      cast: cast,
      updateCast: updateCast,
      on: on,
      emit: emit,
      events: function (limit) { return events.slice(-(limit || 20)); },
      snapshot: snapshot
    };
  }

  function restore(snapshot) {
    if (!snapshot || !snapshot.id) throw new Error('restore: invalid snapshot');
    var scene = create({ id: snapshot.id, ambience: snapshot.ambience, cast: snapshot.cast || [] });
    (snapshot.events || []).forEach(function (event) {
      scene.emit(event.type, event.payload);
    });
    return scene;
  }

  return { create: create, restore: restore, version: '1.0.0', MAX_EVENTS: MAX_EVENTS };
});
