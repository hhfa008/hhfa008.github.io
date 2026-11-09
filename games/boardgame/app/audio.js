'use strict';

/*
 * AudioManager —— 统一的 WebAudio 合成音效。
 *
 * - 无音频文件、无外部请求：每个音效都是现场用振荡器 + 增益包络合成。
 * - enable / mute / volume 持久化到 localStorage（hhfa-sfx-*），读写全部 try/catch。
 * - 没有 AudioContext（Node、旧浏览器、被策略禁用）时所有播放为安全 no-op，
 *   状态 API 仍然可用。
 * - 首次播放必须在用户手势里发生；在此之前浏览器会保持 suspended，
 *   play() 会尝试 resume()，失败也不抛错。
 */

const STORAGE_VOLUME = 'hhfa-sfx-volume';
const STORAGE_MUTED = 'hhfa-sfx-muted';
const DEFAULT_VOLUME = 0.75;

const SOUNDS = {
  // tap 是统一的轻触音；click 保留为旧页面的别名。
  tap: [{ freq: 660, to: 720, dur: 0.05, type: 'triangle', gain: 0.18 }],
  click: [{ freq: 660, to: 720, dur: 0.05, type: 'triangle', gain: 0.18 }],
  draw: [
    { freq: 420, to: 620, dur: 0.09, type: 'sine', gain: 0.16 },
    { freq: 620, to: 880, dur: 0.08, type: 'sine', gain: 0.1, delay: 0.06 }
  ],
  play: [
    { freq: 300, to: 520, dur: 0.12, type: 'square', gain: 0.12 },
    { freq: 520, to: 780, dur: 0.1, type: 'sine', gain: 0.1, delay: 0.08 }
  ],
  attack: [
    { freq: 220, to: 90, dur: 0.16, type: 'sawtooth', gain: 0.2 },
    { freq: 440, to: 120, dur: 0.1, type: 'square', gain: 0.12, delay: 0.02 }
  ],
  hit: [
    { freq: 160, to: 60, dur: 0.2, type: 'sawtooth', gain: 0.24 },
    { freq: 90, to: 45, dur: 0.24, type: 'square', gain: 0.16, delay: 0.03 }
  ],
  heal: [
    { freq: 520, to: 780, dur: 0.18, type: 'sine', gain: 0.14 },
    { freq: 780, to: 1040, dur: 0.18, type: 'sine', gain: 0.1, delay: 0.1 }
  ],
  tile: [{ freq: 880, to: 980, dur: 0.06, type: 'triangle', gain: 0.13 }],
  error: [
    { freq: 200, to: 150, dur: 0.12, type: 'square', gain: 0.14 },
    { freq: 150, to: 110, dur: 0.14, type: 'square', gain: 0.12, delay: 0.1 }
  ],
  win: [
    { freq: 523, to: 523, dur: 0.1, type: 'triangle', gain: 0.16 },
    { freq: 659, to: 659, dur: 0.1, type: 'triangle', gain: 0.16, delay: 0.1 },
    { freq: 784, to: 784, dur: 0.1, type: 'triangle', gain: 0.16, delay: 0.2 },
    { freq: 1047, to: 1047, dur: 0.24, type: 'triangle', gain: 0.18, delay: 0.3 }
  ],
  lose: [
    { freq: 392, to: 330, dur: 0.18, type: 'sine', gain: 0.15 },
    { freq: 330, to: 262, dur: 0.18, type: 'sine', gain: 0.14, delay: 0.16 },
    { freq: 262, to: 196, dur: 0.3, type: 'sine', gain: 0.12, delay: 0.32 }
  ],
  deal: [
    { freq: 500, to: 500, dur: 0.035, type: 'triangle', gain: 0.1 },
    { freq: 740, to: 740, dur: 0.03, type: 'triangle', gain: 0.06, delay: 0.03 }
  ]
};

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, n));
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (err) {
    /* storage 被策略禁用：用内存状态 */
  }
  return null;
}

function readStorage(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch (err) {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    if (storage) storage.setItem(key, String(value));
  } catch (err) {
    /* 持久化失败不影响播放 */
  }
}

function contextCtor(options) {
  if (options && (options.AudioContext || options.audioContext)) {
    return options.AudioContext || options.audioContext;
  }
  if (typeof globalThis === 'undefined') return null;
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

export class AudioManager {
  constructor(options) {
    const opts = options || {};
    this._Ctor = contextCtor(opts);
    this._storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this._ctx = null;
    this._broken = false;
    this._unlocked = false;
    this._stats = { plays: 0, blocked: 0, sounds: {} };
    this._unlockListeners = null;

    const storedVolume = readStorage(this._storage, STORAGE_VOLUME);
    this._volume = storedVolume == null ? DEFAULT_VOLUME : clamp01(storedVolume);
    const storedMuted = readStorage(this._storage, STORAGE_MUTED);
    this._muted = storedMuted === '1' || storedMuted === true;
  }

  get volume() {
    return this._volume;
  }

  get muted() {
    return this._muted;
  }

  get enabled() {
    return !this._muted;
  }

  get context() {
    return this._ensureContext();
  }

  get state() {
    return this._ctx ? this._ctx.state : 'unavailable';
  }

  get unlocked() {
    return Boolean(this._unlocked || (this._ctx && this._ctx.state === 'running'));
  }

  setVolume(value) {
    this._volume = clamp01(value);
    writeStorage(this._storage, STORAGE_VOLUME, this._volume);
    return this._volume;
  }

  mute(on) {
    this._muted = on === undefined ? true : Boolean(on);
    writeStorage(this._storage, STORAGE_MUTED, this._muted ? '1' : '0');
    if (this._muted) this._suspend();
    return this._muted;
  }

  enable() {
    return !this.mute(false);
  }

  disable() {
    return this.mute(true);
  }

  toggle() {
    return this.mute(!this._muted);
  }

  isMuted() {
    return this._muted;
  }

  init() {
    this._ensureContext();
    return this;
  }

  initialize() {
    return this.init();
  }

  ensureContext() {
    return this._ensureContext();
  }

  unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return this;
    if (ctx.state === 'running') {
      this._unlocked = true;
      return ctx;
    }
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const self = this;
        const resumed = ctx.resume();
        if (resumed && typeof resumed.then === 'function') {
          resumed.then(function () {
            self._unlocked = ctx.state === 'running';
          }, function () {
            /* 被策略拒绝：保持 suspended，后续 play 直接 no-op */
          });
        }
        this._unlocked = ctx.state === 'running';
      } catch (err) {
        /* ignore */
      }
    }
    return ctx;
  }

  /*
   * 在首次 pointerdown / touchstart / keydown 时 resume。
   * 未解锁前 play() 只返回 false，不调度节点，避免恢复时一次性爆音。
   */
  unlockOnGesture(target, options) {
    const opts = options || {};
    const el = target || (typeof window !== 'undefined' ? window : null);
    if (!el || typeof el.addEventListener !== 'function') return this;
    if (this._unlockListeners && this._unlockListeners.el === el) return this;
    const self = this;
    const events = opts.events || ['pointerdown', 'touchstart', 'keydown'];
    const handler = function () {
      self.unlock();
      detach();
      if (typeof opts.onUnlock === 'function') opts.onUnlock(self);
    };
    const detach = function () {
      const state = self._unlockListeners;
      if (!state) return;
      events.forEach(function (name) {
        try { el.removeEventListener(name, handler, state.passiveOption); } catch (err) { /* ignore */ }
      });
      if (self._unlockListeners && self._unlockListeners.el === el) self._unlockListeners = null;
    };
    const passive = events.filter(function (name) { return name !== 'keydown'; });
    const passiveOption = { passive: true };
    // 同一个事件名可能同时出现在被动列表里：统一用 passive 注册，keydown 不受影响。
    events.forEach(function (name) {
      try { el.addEventListener(name, handler, passive.indexOf(name) === -1 ? undefined : passiveOption); } catch (err) { /* ignore */ }
    });
    this._unlockListeners = { el: el, events: events, handler: handler, passiveOption: passiveOption, detach: detach };
    return this;
  }

  installUnlock(target, options) {
    return this.unlockOnGesture(target, options);
  }

  attachUnlock(target, options) {
    return this.unlockOnGesture(target, options);
  }

  detachUnlock() {
    if (this._unlockListeners && typeof this._unlockListeners.detach === 'function') {
      this._unlockListeners.detach();
    }
    return this;
  }

  resume() {
    return this.unlock();
  }

  volume(value) {
    if (value === undefined) return this._volume;
    return this.setVolume(value);
  }

  getVolume() {
    return this._volume;
  }

  getMasterVolume() {
    return this._volume;
  }

  setMasterVolume(value) {
    return this.setVolume(value);
  }

  setMuted(on) {
    return this.mute(on);
  }

  setMute(on) {
    return this.mute(on);
  }

  getMuted() {
    return this._muted;
  }

  setEnabled(on) {
    return this.mute(!on);
  }

  dispose() {
    this.detachUnlock();
    this._suspend();
    this._ctx = null;
    this._unlocked = false;
    return true;
  }

  list() {
    return Object.keys(SOUNDS);
  }

  stats() {
    return {
      plays: this._stats.plays,
      blocked: this._stats.blocked,
      sounds: Object.assign({}, this._stats.sounds),
      muted: this._muted,
      volume: this._volume,
      state: this.state,
      unlocked: this.unlocked,
      backend: this._Ctor && !this._broken ? 'webaudio' : 'none'
    };
  }

  play(name, opts) {
    if (this._muted) return false;
    const sound = SOUNDS[name] || SOUNDS.click;
    const ctx = this._ensureContext();
    if (!ctx) {
      this._stats.blocked += 1;
      return false;
    }
    try {
      if (ctx.state === 'suspended') {
        this.unlock();
        // 首次手势解锁前不调度任何节点：恢复瞬间不会一次性爆音。
        if (ctx.state !== 'running') {
          this._stats.blocked += 1;
          return false;
        }
      }
      const volume = clamp01(opts && opts.volume !== undefined ? opts.volume : this._volume);
      const start = ctx.currentTime + 0.005;
      // 连续音效错开 30ms，避免同帧叠加爆音。
      const offset = (this._stats.plays % 4) * 0.03;
      sound.forEach(function (note) {
        renderNote(ctx, note, start + offset + (note.delay || 0), volume);
      });
      this._stats.plays += 1;
      const key = SOUNDS[name] ? name : 'click';
      this._stats.sounds[key] = (this._stats.sounds[key] || 0) + 1;
      return true;
    } catch (err) {
      this._broken = true;
      this._stats.blocked += 1;
      return false;
    }
  }

  _ensureContext() {
    if (this._ctx || this._broken || !this._Ctor) return this._ctx;
    try {
      this._ctx = new this._Ctor();
    } catch (err) {
      this._broken = true;
      this._ctx = null;
    }
    return this._ctx;
  }

  _suspend() {
    if (!this._ctx) return;
    try {
      if (typeof this._ctx.suspend === 'function' && this._ctx.state === 'running') {
        const p = this._ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (err) {
      /* ignore */
    }
  }
}

function renderNote(ctx, note, at, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = note.type || 'sine';
  osc.frequency.setValueAtTime(note.freq, at);
  if (note.to && note.to !== note.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, note.to), at + note.dur);
  }
  const peak = Math.max(0.0001, note.gain * volume);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, note.dur * 0.4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + note.dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + note.dur + 0.02);
}

export function createAudioManager(options) {
  return new AudioManager(options);
}

const singleton = new AudioManager();

function managerOf(self) {
  return self instanceof AudioManager ? self : singleton;
}

export function play(name, opts) {
  return managerOf(this).play(name, opts);
}

export function setVolume(value) {
  return managerOf(this).setVolume(value);
}

export function mute(on) {
  return managerOf(this).mute(on);
}

export function isMuted() {
  return managerOf(this).isMuted();
}

export function list() {
  return managerOf(this).list();
}

export function stats() {
  return managerOf(this).stats();
}

export function init() {
  return managerOf(this).init();
}

export function initialize() {
  return managerOf(this).init();
}

export function unlock() {
  return managerOf(this).unlock();
}

export function resume() {
  return managerOf(this).unlock();
}

export function volume(value) {
  return managerOf(this).volume(value);
}

export function getVolume() {
  return managerOf(this).getVolume();
}

export function setMasterVolume(value) {
  return managerOf(this).setVolume(value);
}

export function setMuted(on) {
  return managerOf(this).mute(on);
}

export function setMute(on) {
  return managerOf(this).mute(on);
}

export function setEnabled(on) {
  return managerOf(this).setEnabled(on);
}

export function dispose() {
  return managerOf(this).dispose();
}

export const createAudio = createAudioManager;

export const audio = singleton;
export default singleton;
