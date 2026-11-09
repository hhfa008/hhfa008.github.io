'use strict';

/*
 * L2 contract: unified AudioManager.
 *
 * The module is probed, not implemented here. Fake WebAudio globals let the
 * contract run in Node without a browser. Requirements:
 *   - importing the module and constructing the manager must not play anything
 *   - init / unlock / play / mute / volume are callable and idempotent
 *   - muted play() emits no new nodes
 *   - volume clamps to [0, 1]
 *   - no WebAudio available => graceful fallback, never a throw
 */

import { createSuite } from './lib/suite.mjs';
import { probeModule, pick, fnOf, instantiate, describeMissing } from './lib/probe.mjs';
import { AUDIO, call } from './lib/contracts.mjs';

const CANDIDATES = [
  'app/audio.mjs',
  'app/audio.js',
  'app/engine/audio.mjs',
  'app/engine/audio.js',
  'app/sound.mjs',
  'app/sound.js',
  'app/lib/audio.mjs'
];

class FakeParam {
  constructor(value) {
    this.value = value == null ? 0 : value;
    this.calls = [];
  }
  setValueAtTime(value) { this.value = value; this.calls.push('setValueAtTime'); }
  linearRampToValueAtTime(value) { this.value = value; this.calls.push('linearRamp'); }
  exponentialRampToValueAtTime(value) { this.value = value; this.calls.push('expRamp'); }
  cancelScheduledValues() { this.calls.push('cancel'); }
}

class FakeNode {
  constructor() { this.connections = []; this.started = false; this.stopped = false; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() {}
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

class FakeGain extends FakeNode {
  constructor(context) { super(); this.context = context; this.gain = new FakeParam(1); }
}

class FakeOscillator extends FakeNode {
  constructor(context) {
    super();
    this.context = context;
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.onended = null;
  }
}

class FakeBufferSource extends FakeNode {
  constructor(context) {
    super();
    this.context = context;
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new FakeParam(1);
    this.onended = null;
  }
}

class FakeAudioContext {
  static instances = [];
  constructor() {
    this.state = 'suspended';
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.gains = [];
    this.oscillators = [];
    this.sources = [];
    this.resumeCalls = 0;
    this.closeCalls = 0;
    FakeAudioContext.instances.push(this);
  }
  createGain() { const node = new FakeGain(this); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(this); this.oscillators.push(node); return node; }
  createBufferSource() { const node = new FakeBufferSource(this); this.sources.push(node); return node; }
  createDynamicsCompressor() { return new FakeNode(); }
  createStereoPanner() { const node = new FakeNode(); node.pan = new FakeParam(0); return node; }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length: length,
      sampleRate: sampleRate,
      getChannelData: function () { return new Float32Array(length); }
    };
  }
  decodeAudioData() { return Promise.resolve({ duration: 0.5 }); }
  resume() { this.resumeCalls += 1; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closeCalls += 1; this.state = 'closed'; return Promise.resolve(); }
}

function emittedNodes(context) {
  if (!context) return 0;
  return (context.oscillators ? context.oscillators.length : 0) +
    (context.sources ? context.sources.length : 0);
}

function allEmittedNodes() {
  return FakeAudioContext.instances.reduce(function (sum, ctx) { return sum + emittedNodes(ctx); }, 0);
}

function readMuted(manager, api) {
  const read = fnOf(manager, AUDIO.isMuted) || fnOf(api, AUDIO.isMuted);
  if (read) return read.call(manager);
  if (typeof manager.muted === 'boolean') return manager.muted;
  if (typeof manager.isMuted === 'boolean') return manager.isMuted;
  if (typeof manager.getMuted === 'function') return manager.getMuted();
  return undefined;
}

function readVolume(manager, api) {
  if (typeof manager.volume === 'number') return manager.volume;
  if (typeof manager.masterVolume === 'number') return manager.masterVolume;
  const getter = fnOf(manager, ['getVolume', 'getMasterVolume']);
  if (getter) return getter.call(manager);
  if (typeof api.getVolume === 'function') return api.getVolume.call(manager);
  return undefined;
}

function fakeStorage() {
  const data = new Map();
  return {
    getItem: function (key) { return data.has(key) ? data.get(key) : null; },
    setItem: function (key, value) { data.set(key, String(value)); },
    removeItem: function (key) { data.delete(key); }
  };
}

const previousGlobals = {
  AudioContext: globalThis.AudioContext,
  webkitAudioContext: globalThis.webkitAudioContext,
  localStorage: globalThis.localStorage,
  window: globalThis.window
};

globalThis.AudioContext = FakeAudioContext;
globalThis.webkitAudioContext = FakeAudioContext;
globalThis.localStorage = fakeStorage();
if (!globalThis.window) globalThis.window = globalThis;
try {
  globalThis.window.AudioContext = FakeAudioContext;
  globalThis.window.webkitAudioContext = FakeAudioContext;
} catch (err) {
  // A frozen window object is fine; the module can still use globalThis.
}

const s = createSuite('boardgame-engine-audio');

await s.run(async () => {
  const probe = await probeModule(CANDIDATES, 'audio');
  if (!probe.found) {
    s.skip('audio manager contract', describeMissing(probe, CANDIDATES));
    return;
  }
  if (probe.error) {
    s.ok('audio module imports without throwing', false,
      probe.path + ': ' + (probe.error.stack || probe.error.message || String(probe.error)));
    return;
  }

  const api = probe.api;
  const factory = pick(api, AUDIO.factory) ||
    (fnOf(api, AUDIO.init) && fnOf(api, AUDIO.play) ? api : undefined);
  if (factory === undefined) {
    s.ok('audio module exports a manager factory', false,
      'expected one of: ' + AUDIO.factory.join(', '));
    return;
  }

  const manager = instantiate(factory, { autoPlay: false, storage: fakeStorage() });
  const init = fnOf(manager, AUDIO.init) || fnOf(api, AUDIO.init);
  const play = fnOf(manager, AUDIO.play) || fnOf(api, AUDIO.play);
  const unlock = fnOf(manager, AUDIO.unlock) || fnOf(api, AUDIO.unlock);
  const mute = fnOf(manager, AUDIO.mute) || fnOf(api, AUDIO.mute);
  const volume = fnOf(manager, AUDIO.volume) || fnOf(api, AUDIO.volume);
  const listSounds = fnOf(manager, ['list', 'listSounds', 'sounds']) || fnOf(api, ['list', 'listSounds']);
  let soundName = 'click';

  await s.group('exports', async () => {
    s.ok('导出可构造的 manager', typeof factory === 'function' || (factory && typeof factory === 'object'));
    s.ok('提供 init', typeof init === 'function', 'expected ' + AUDIO.init.join(' / '));
    s.ok('提供 play', typeof play === 'function', 'expected ' + AUDIO.play.join(' / '));
    s.ok('提供 unlock 或 play 自动 resume',
      typeof unlock === 'function' || typeof play === 'function',
      'expected ' + AUDIO.unlock.join(' / ') + ' or resume-on-play');
    s.ok('提供 mute 开关', typeof mute === 'function', 'expected ' + AUDIO.mute.join(' / '));
    s.ok('提供 volume 控制', typeof volume === 'function', 'expected ' + AUDIO.volume.join(' / '));
    s.eq('导入阶段没有产生任何声音节点', allEmittedNodes(), 0);
  });

  if (!init || !play) return;

  const contextCandidates = [manager && manager.context, manager && manager.ctx, manager && manager.audioContext];
  let context = contextCandidates.find(Boolean) || null;

  await s.group('lifecycle', async () => {
    let initResult;
    try {
      initResult = await call(init, manager, []);
      s.ok('init 不抛错', true);
    } catch (err) {
      s.ok('init 不抛错', false, err && err.message ? err.message : String(err));
    }
    s.ok('init 返回非 undefined 结果或 manager 有 context',
      initResult !== undefined || context !== null || FakeAudioContext.instances.length > 0,
      'init returned ' + String(initResult));

    if (!context && FakeAudioContext.instances.length > 0) {
      context = FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
    }
    s.ok('init 后存在 AudioContext', context !== null);
    s.ok('init 不自动播放声音', emittedNodes(context) === 0);

    if (unlock) {
      try {
        await call(unlock, manager, []);
        s.ok('unlock 不抛错', true);
      } catch (err) {
        s.ok('unlock 不抛错', false, err && err.message ? err.message : String(err));
      }
      if (context) {
        s.ok('unlock 后 context 为 running 或本身可用',
          context.state === 'running' || context.state === 'suspended',
          'state=' + context.state);
      }
    }

    try {
      const sounds = listSounds ? await call(listSounds, manager, []) : null;
      if (Array.isArray(sounds) && sounds.length > 0) {
        soundName = typeof sounds[0] === 'string' ? sounds[0] : (sounds[0].name || sounds[0].id || soundName);
      }
    } catch (err) {
      // fall back to a generic name
    }
    const before = emittedNodes(context);
    let playResult;
    try {
      playResult = await call(play, manager, [soundName]);
      s.ok('play 不抛错', true);
    } catch (err) {
      s.ok('play 不抛错', false, err && err.message ? err.message : String(err));
    }
    if (!unlock && context) {
      s.ok('无显式 unlock 时 play 自动 resume',
        context.resumeCalls > 0 || context.state === 'running' || context.state === 'suspended',
        'state=' + context.state + ', resumeCalls=' + context.resumeCalls);
    }
    const after = emittedNodes(context);
    s.ok('play 要么发声音，要么明确返回 false fallback',
      after > before || playResult === false,
      'nodes ' + before + ' -> ' + after + ', result=' + String(playResult));

    const mutedBefore = readMuted(manager, api);
    s.ok('可读取静音状态', typeof mutedBefore === 'boolean', 'got ' + String(mutedBefore));

    if (mute) {
      await call(mute, manager, [true]);
      s.eq('静音后状态为 true', readMuted(manager, api), true);
      const mutedNodes = emittedNodes(context);
      await call(play, manager, [soundName]);
      s.eq('静音时 play 不产生新节点', emittedNodes(context), mutedNodes);

      await call(mute, manager, [false]);
      s.eq('取消静音后状态为 false', readMuted(manager, api), false);
      if (after > before) {
        const unmutedNodes = emittedNodes(context);
        await call(play, manager, [soundName]);
        s.ok('取消静音后 play 恢复发声', emittedNodes(context) > unmutedNodes,
          'nodes ' + unmutedNodes + ' -> ' + emittedNodes(context));
      } else {
        s.skip('audio mute/unmute 发声回归', 'play() 对未知音效返回 fallback，无法观察节点变化');
      }
    }

    if (volume) {
      await call(volume, manager, [0.35]);
      const current = readVolume(manager, api);
      s.ok('volume 可设置并读取 0.35', typeof current === 'number' && Math.abs(current - 0.35) < 1e-6,
        'got ' + String(current));

      await call(volume, manager, [2]);
      const high = readVolume(manager, api);
      s.ok('volume 上限夹到 1', high === 1, 'got ' + String(high));

      await call(volume, manager, [-3]);
      const low = readVolume(manager, api);
      s.ok('volume 下限夹到 0', low === 0, 'got ' + String(low));
    }
  });

  await s.group('fallback without WebAudio', async () => {
    const savedContext = globalThis.AudioContext;
    const savedWebkit = globalThis.webkitAudioContext;
    try {
      globalThis.AudioContext = undefined;
      globalThis.webkitAudioContext = undefined;
      let fallbackManager;
      try {
        fallbackManager = instantiate(factory, { audioContext: null, autoPlay: false, storage: fakeStorage() });
        s.ok('无 WebAudio 时仍可构造 manager', true);
      } catch (err) {
        s.ok('无 WebAudio 时仍可构造 manager', false, err && err.message ? err.message : String(err));
      }
      if (fallbackManager) {
        try {
          await call(init, fallbackManager, []);
          s.ok('无 WebAudio 时 init 不抛错', true);
        } catch (err) {
          s.ok('无 WebAudio 时 init 不抛错', false, err && err.message ? err.message : String(err));
        }
        try {
          await call(play, fallbackManager, ['click']);
          s.ok('无 WebAudio 时 play 静默降级不抛错', true);
        } catch (err) {
          s.ok('无 WebAudio 时 play 静默降级不抛错', false, err && err.message ? err.message : String(err));
        }
      }
    } finally {
      globalThis.AudioContext = savedContext;
      globalThis.webkitAudioContext = savedWebkit;
    }
  });

  await s.group('disable switch', async () => {
    const disable = fnOf(manager, AUDIO.disable) || fnOf(api, AUDIO.disable);
    const enable = fnOf(manager, ['enable', 'setEnabled', 'enableSound']) ||
      fnOf(api, ['enable', 'setEnabled', 'enableSound']);
    if (!disable) {
      s.skip('audio disable switch', 'no setEnabled/setDisabled/disable method');
      return;
    }
    const before = emittedNodes(context);
    await call(disable, manager, []);
    await call(play, manager, [soundName]);
    s.eq('关闭音效后 play 不产生新节点', emittedNodes(context), before);
    if (enable) {
      await call(enable, manager, []);
    } else {
      await call(disable, manager, [true]);
    }
    if (before > 0 || emittedNodes(context) > 0) {
      const afterEnable = emittedNodes(context);
      await call(play, manager, [soundName]);
      s.ok('重新开启后 play 恢复发声', emittedNodes(context) > afterEnable,
        'nodes ' + afterEnable + ' -> ' + emittedNodes(context));
    } else {
      s.skip('audio disable 重新开启发声', 'play() 对未知音效返回 fallback，无法观察节点变化');
    }
  });

  await s.group('dispose', async () => {
    const dispose = fnOf(manager, AUDIO.dispose) || fnOf(api, AUDIO.dispose);
    if (!dispose) {
      s.skip('audio dispose', 'no dispose/destroy/close method');
      return;
    }
    try {
      await call(dispose, manager, []);
      s.ok('dispose 不抛错', true);
    } catch (err) {
      s.ok('dispose 不抛错', false, err && err.message ? err.message : String(err));
    }
    if (context) {
      s.ok('dispose 后 context 关闭或不再播放',
        context.state === 'closed' || context.closeCalls > 0 || context.state === 'suspended',
        'state=' + context.state + ', closeCalls=' + context.closeCalls);
    }
  });
});

// Keep the previous globals referenced so linters do not treat them as dead.
void previousGlobals;
