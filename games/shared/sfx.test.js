'use strict';

/*
 * Contract tests for games/shared/sfx.js.
 *
 * Run: node games/shared/sfx.test.js
 *
 * Node has no AudioContext, so the useful paths are the ones that must not
 * throw without one, the pending-queue overflow accounting, and the
 * statechange unlock. A tiny mock AudioContext supplies just enough nodes to
 * build the `click` voice without any real audio graph.
 */

var lib = require('../tests/lib.js');

var SFX_PATH = require.resolve('./sfx.js');
var s = lib.suite('shared/sfx');

/* ------------------------------------------------------------- mock audio */

function param(value) {
  return {
    value: value,
    setValueAtTime: function () {},
    linearRampToValueAtTime: function () {},
    exponentialRampToValueAtTime: function () {},
    setTargetAtTime: function () {}
  };
}

function node() {
  return {
    gain: param(1),
    frequency: param(440),
    detune: param(0),
    Q: param(1),
    connect: function () { return this; },
    disconnect: function () {},
    start: function () {},
    stop: function () {},
    onended: null
  };
}

function MockAudioContext() {
  this.state = 'suspended';
  this.currentTime = 1000;
  this.sampleRate = 44100;
  this.destination = node();
  this.handlers = {};
  this.resumeCalls = 0;
  MockAudioContext.instances.push(this);
}
MockAudioContext.instances = [];

MockAudioContext.prototype.createGain = function () { return node(); };
MockAudioContext.prototype.createOscillator = function () { return node(); };
MockAudioContext.prototype.createBiquadFilter = function () { return node(); };
MockAudioContext.prototype.createBufferSource = function () { return node(); };
MockAudioContext.prototype.createBuffer = function (channels, length) {
  var data = new Float32Array(length);
  return { getChannelData: function () { return data; } };
};
// Deliberately stays suspended: the test flips state by hand so the queue can
// build up and overflow before the statechange test resumes it.
MockAudioContext.prototype.resume = function () {
  this.resumeCalls++;
  return null;
};
MockAudioContext.prototype.addEventListener = function (type, fn) {
  (this.handlers[type] || (this.handlers[type] = [])).push(fn);
};
MockAudioContext.prototype.emit = function (type) {
  var list = this.handlers[type] || [];
  for (var i = 0; i < list.length; i++) list[i].call(this, { type: type });
};

function fakeDocument() {
  var doc = {
    readyState: 'complete',
    dispatched: [],
    listeners: {},
    getElementById: function () { return null; },
    createElement: function () { return { id: '', textContent: '' }; },
    createEvent: function () { return null; },
    head: { appendChild: function () {} },
    documentElement: { appendChild: function () {} },
    querySelectorAll: function () { return []; },
    addEventListener: function (type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    dispatchEvent: function (ev) {
      this.dispatched.push(ev);
      var list = this.listeners[ev.type] || [];
      for (var i = 0; i < list.length; i++) list[i].call(this, ev);
      return true;
    }
  };
  return doc;
}

/* ------------------------------------------------------------- utilities */

function clearAudioGlobals() {
  delete global.AudioContext;
  delete global.webkitAudioContext;
  delete global.OfflineAudioContext;
  delete global.webkitOfflineAudioContext;
  delete global.document;
  delete global.CustomEvent;
}

function freshSfx() {
  delete require.cache[SFX_PATH];
  return require(SFX_PATH);
}

/* ------------------------------------------------------------------ tests */

s.group('无 AudioContext 环境：静默 no-op', function () {
  clearAudioGlobals();
  var Sfx = freshSfx();
  var threw = false;
  var result;
  try {
    result = Sfx.play('click');
  } catch (e) {
    threw = true;
  }
  s.ok('无 AudioContext 时 play 不抛错', !threw);
  s.eq('无 AudioContext 时 play 返回 false', result, false);
  s.eq('无 AudioContext 时无待播队列', Sfx.stats().pending, 0);
  s.eq('dropped() 初始为 0', Sfx.dropped(), 0);
  s.eq('contextState 为 none', Sfx.stats().contextState, 'none');
  return 'play()=false，dropped=0，无异常';
});

s.group('队列上限：丢最旧音并计数（无 document 也不报错）', function () {
  clearAudioGlobals();
  MockAudioContext.instances = [];
  global.AudioContext = MockAudioContext;
  var Sfx = freshSfx();
  var threw = false;
  try {
    for (var i = 0; i < 20; i++) Sfx.play('click', { volume: 0.1 });
  } catch (e) {
    threw = true;
  }
  s.ok('无 document 时丢音不抛错', !threw);
  s.eq('队列稳定在 MAX_PENDING=16', Sfx.stats().pending, 16);
  s.eq('20 次入队丢 4 个最旧音', Sfx.dropped(), 4);
  s.eq('stats().dropped 同步', Sfx.stats().dropped, 4);

  for (var k = 0; k < 3; k++) Sfx.play('click', { volume: 0.1 });
  s.eq('继续入队累计丢音 7 个', Sfx.dropped(), 7);
  s.eq('队列仍不超过 16', Sfx.stats().pending, 16);
  return '20 次入队丢 4；再 3 次累计丢 7；队列 16';
});

s.group('丢音事件：document 上可监听的 sfxdrop', function () {
  clearAudioGlobals();
  MockAudioContext.instances = [];
  global.AudioContext = MockAudioContext;
  global.CustomEvent = function (type, init) {
    this.type = type;
    this.detail = init && init.detail;
  };
  var doc = fakeDocument();
  global.document = doc;
  var heard = 0;
  doc.addEventListener('sfxdrop', function () { heard++; });

  var Sfx = freshSfx();
  for (var i = 0; i < 18; i++) Sfx.play('click', { volume: 0.1 });

  s.eq('派发 sfxdrop 次数等于丢音次数', heard, 2);
  s.eq('document 上收到的事件名', doc.dispatched[0].type, 'sfxdrop');
  s.eq('事件 detail.name 是被丢的音效', doc.dispatched[0].detail.name, 'click');
  s.eq('事件 detail.max 为 MAX_PENDING', doc.dispatched[0].detail.max, 16);
  s.eq('最后一条 detail.dropped 为累计值', doc.dispatched[1].detail.dropped, 2);
  s.eq('Sfx.dropped() 与事件计数一致', Sfx.dropped(), 2);
  return '18 次入队 → 2 个 sfxdrop 事件，detail.dropped=2';
});

s.group('statechange：suspended → running 时 flush 队列', function () {
  clearAudioGlobals();
  MockAudioContext.instances = [];
  global.AudioContext = MockAudioContext;
  var Sfx = freshSfx();

  Sfx.play('click');
  Sfx.play('click');
  Sfx.play('click');
  s.eq('suspended 时进入待播队列', Sfx.stats().pending, 3);
  var c = MockAudioContext.instances[0];
  s.ok('已创建 AudioContext', !!c);
  s.eq('已订阅一次 statechange', (c.handlers.statechange || []).length, 1);

  // More plays reuse the existing context and must not stack listeners.
  Sfx.play('click');
  s.eq('重复 play 不重复订阅 statechange', (c.handlers.statechange || []).length, 1);
  s.eq('第四条仍在队列中', Sfx.stats().pending, 4);

  c.state = 'running';
  c.emit('statechange');
  s.eq('statechange 后队列被 flush', Sfx.stats().pending, 0);
  s.ok('flush 后确实构建了声音节点', Sfx.stats().created > 0,
    'created=' + Sfx.stats().created);
  s.eq('无丢音', Sfx.dropped(), 0);

  // Already running: further plays must not add another listener.
  Sfx.play('click');
  s.eq('running 时不再重复订阅 statechange',
    (c.handlers.statechange || []).length, 1);
  s.eq('running 时直接播放不排队', Sfx.stats().pending, 0);
  return '4 条排队 → statechange 后 pending=0，created=' + Sfx.stats().created +
    '，statechange 监听器始终 1 个';
});

clearAudioGlobals();
s.done();
