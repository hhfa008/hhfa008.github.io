/* Fully synthesized sound effects for every game — no audio files, zero requests.
 *
 * Everything is built at runtime from oscillators, biquad filters, gain
 * envelopes and a short white-noise buffer generated in code. Nothing is
 * fetched, decoded or embedded: the script is the whole sound library.
 *
 * UMD: browsers read window.Sfx, Node reads module.exports. In Node there is
 * no AudioContext, so the API still works but every play is a silent no-op
 * (handy for the test runner and any server-side rendering).
 *
 *   Sfx.play(name, opts)     // opts: { volume: 0..1 }
 *   Sfx.setVolume(0..1)
 *   Sfx.mute(true|false)
 *   Sfx.isMuted()
 *   Sfx.dropped()            // how many queued sounds overflowed MAX_PENDING
 *   Sfx.list()
 *
 * First playback happens inside a user gesture (browser autoplay policy).
 * Calls made before that are queued silently, then flushed once the context
 * resumes. The context's `statechange` event also flushes the queue, so an
 * engine that unlocks asynchronously is handled without another play() call.
 * When the queue is full the oldest sound is dropped; that is no longer
 * silent: Sfx.dropped() counts it and a `sfxdrop` CustomEvent is dispatched on
 * document (only when a document exists, so Node stays quiet).
 * Volume and mute live in localStorage under hhfa-sfx-*.
 *
 * Every page that includes this file gets any <button class="sfx-toggle">
 * wired up automatically, with the SVG icon and CSS injected once.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Sfx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VOL_KEY = 'hhfa-sfx-volume';
  var MUTE_KEY = 'hhfa-sfx-muted';
  var DEFAULT_VOLUME = 0.75;
  var MAX_PENDING = 16;

  var ORDER = [
    'click', 'move', 'capture', 'deal', 'dice', 'win', 'lose', 'error', 'notify',
    'voice-a', 'voice-i', 'voice-u', 'voice-yeah',
    'bird', 'cat', 'dog', 'cow', 'duck'
  ];

  /* ------------------------------------------------------------------ state */

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }
  function storageGet(key) {
    try { return root.localStorage ? root.localStorage.getItem(key) : null; }
    catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { if (root.localStorage) root.localStorage.setItem(key, value); }
    catch (e) {}
  }

  var storedVolume = parseFloat(storageGet(VOL_KEY));
  var volume = isNaN(storedVolume) ? DEFAULT_VOLUME : clamp(storedVolume, 0, 1);
  var muted = storageGet(MUTE_KEY) === '1';

  var ctx = null;
  var master = null;
  var pending = [];
  var listenersArmed = false;
  // Context already wired to statechange, so repeated ensureContext calls do
  // not stack listeners. Cleared whenever the context is replaced.
  var stateCtx = null;
  var droppedCount = 0;

  var stats = { created: 0, disconnected: 0, active: 0 };

  function contextRunning() {
    return !!ctx && ctx.state === 'running';
  }

  // Flush queued sounds when the context transitions from suspended to
  // running. If it is already running there is nothing to unlock, so skip the
  // subscription entirely. Node/mocked contexts without addEventListener fall
  // back to the onstatechange property.
  function armStateChange(c) {
    if (!c || stateCtx === c) return;
    stateCtx = c;
    if (c.state === 'running') return;
    var onState = function () {
      if (c.state === 'running') flushPending();
    };
    if (typeof c.addEventListener === 'function') {
      c.addEventListener('statechange', onState);
    } else {
      c.onstatechange = onState;
    }
  }

  // Count a dropped sound and make it observable. A document is required to
  // dispatch (there is none in Node), and every step is guarded so a hostile
  // or partial DOM can never make playback throw.
  function notifyDrop(name) {
    droppedCount++;
    if (!root.document || typeof root.document.dispatchEvent !== 'function') return;
    var detail = { name: name, dropped: droppedCount, pending: pending.length, max: MAX_PENDING };
    try {
      var ev = null;
      if (typeof root.CustomEvent === 'function') {
        ev = new root.CustomEvent('sfxdrop', { detail: detail });
      } else if (typeof root.document.createEvent === 'function') {
        ev = root.document.createEvent('CustomEvent');
        if (ev && typeof ev.initCustomEvent === 'function') {
          ev.initCustomEvent('sfxdrop', false, false, detail);
        }
      }
      if (ev) root.document.dispatchEvent(ev);
    } catch (e) {}
  }

  function ensureContext() {
    if (ctx && ctx.state === 'closed') {
      ctx = null;
      master = null;
      stateCtx = null;
    }
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      armStateChange(ctx);
      if (ctx.state === 'running') flushPending();
    } catch (e) {
      ctx = null;
      master = null;
      stateCtx = null;
      return null;
    }
    return ctx;
  }

  function armUnlock() {
    if (listenersArmed || !root.document || !root.document.addEventListener) return;
    listenersArmed = true;
    var opts = { capture: true, passive: true };
    root.document.addEventListener('pointerdown', tryResume, opts);
    root.document.addEventListener('touchstart', tryResume, opts);
    root.document.addEventListener('keydown', tryResume, opts);
  }

  function tryResume() {
    if (!ctx) return;
    if (ctx.state === 'running') { flushPending(); return; }
    try {
      var p = ctx.resume();
      if (p && typeof p.then === 'function') {
        p.then(flushPending, function () {});
      }
    } catch (e) {}
    // Some engines flip state synchronously.
    if (ctx.state === 'running') flushPending();
  }

  function flushPending() {
    if (!ctx || ctx.state !== 'running' || !pending.length) return;
    var batch = pending.splice(0, pending.length);
    for (var i = 0; i < batch.length; i++) {
      buildVoice(ctx, master, batch[i].name, batch[i].opts, true);
    }
  }

  /* -------------------------------------------------------------- noise bank */

  var noiseCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var NOISE_SECONDS = 2;

  function noiseBuffer(c) {
    if (noiseCache) {
      var cached = noiseCache.get(c);
      if (cached) return cached;
    } else if (c.__sfxNoise) {
      return c.__sfxNoise;
    }
    var len = Math.max(1, Math.ceil(c.sampleRate * NOISE_SECONDS));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (noiseCache) noiseCache.set(c, buf);
    else c.__sfxNoise = buf;
    return buf;
  }

  /* --------------------------------------------------------------- voice kit */

  function Voice(c, dest, t0, live, level) {
    this.ctx = c;
    this.t0 = t0;
    this.live = !!live;
    this.nodes = [];
    this.sources = [];
    this.end = t0 + 0.05;
    this.cleaned = false;
    this.out = c.createGain();
    this.out.gain.value = level;
    this.track(this.out);
    if (dest) this.out.connect(dest);
  }

  Voice.prototype.track = function (node) {
    this.nodes.push(node);
    if (this.live) { stats.created++; stats.active++; }
    return node;
  };

  Voice.prototype.addSource = function (node) {
    this.sources.push(node);
    return node;
  };

  Voice.prototype.stopAt = function (node, at) {
    if (at > this.end) this.end = at;
    node.stop(at);
  };

  Voice.prototype.finish = function () {
    var v = this;
    var remaining = v.sources.length;
    var done = false;

    function cleanup() {
      if (done) return;
      done = true;
      for (var i = 0; i < v.nodes.length; i++) {
        try { v.nodes[i].disconnect(); } catch (e) {}
      }
      if (v.live) {
        stats.disconnected += v.nodes.length;
        stats.active -= v.nodes.length;
        if (stats.active < 0) stats.active = 0;
      }
      v.nodes.length = 0;
      v.sources.length = 0;
    }

    if (!remaining) { cleanup(); return; }
    for (var i = 0; i < v.sources.length; i++) {
      (function (src) {
        src.onended = function () {
          remaining--;
          if (remaining <= 0) cleanup();
        };
      })(v.sources[i]);
    }
    // Belt and braces: some engines do not fire onended for a muted graph.
    if (v.live) {
      var ms = Math.max(0, (v.end - v.ctx.currentTime) * 1000) + 400;
      setTimeout(cleanup, Math.min(ms, 20000));
    }
  };

  function gainNode(v, value) {
    var g = v.ctx.createGain();
    g.gain.value = value;
    v.track(g);
    return g;
  }

  function filterNode(v, type, freq, q) {
    var f = v.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    v.track(f);
    return f;
  }

  function oscNode(v, type, freq, t0, stopAt) {
    var o = v.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    v.track(o);
    v.addSource(o);
    o.start(t0);
    v.stopAt(o, stopAt);
    return o;
  }

  function envelope(v, t0, attack, dur, release, peak) {
    var g = v.ctx.createGain();
    var hold = Math.max(0.0005, dur - attack - release);
    var p = g.gain;
    p.setValueAtTime(0.0001, t0);
    p.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    p.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    p.exponentialRampToValueAtTime(0.0001, t0 + dur);
    v.track(g);
    return g;
  }

  // A pitched blip with a linear frequency glide and an attack/hold/release
  // envelope. `to` is the end frequency (omit for a steady tone).
  function blip(v, o) {
    var t0 = o.t0, dur = o.dur;
    var src = oscNode(v, o.type || 'sine', o.f0, t0, t0 + dur + 0.02);
    if (o.to != null && o.to !== o.f0) {
      src.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur * 0.92);
    }
    var chain = src;
    if (o.filter) {
      var f = filterNode(v, o.filter, o.filterFreq || o.f0, o.q);
      chain.connect(f);
      chain = f;
    }
    var g = envelope(v, t0, o.attack == null ? 0.005 : o.attack, dur,
      o.release == null ? Math.min(0.03, dur * 0.4) : o.release, o.peak);
    chain.connect(g);
    g.connect(v.out);
    return src;
  }

  // White noise through an optional filter, with its own envelope.
  function noiseBurst(v, o) {
    var t0 = o.t0, dur = o.dur;
    var src = v.ctx.createBufferSource();
    src.buffer = noiseBuffer(v.ctx);
    v.track(src);
    v.addSource(src);
    var chain = src;
    if (o.filter) {
      var f = filterNode(v, o.filter, o.freq, o.q);
      if (o.to != null && o.to !== o.freq) {
        f.frequency.setValueAtTime(Math.max(20, o.freq), t0);
        f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur * 0.95);
      }
      chain.connect(f);
      chain = f;
    }
    var g = envelope(v, t0, o.attack == null ? 0.004 : o.attack, dur,
      o.release == null ? Math.min(0.04, dur * 0.5) : o.release, o.peak);
    chain.connect(g);
    g.connect(v.out);
    var offset = Math.random() * Math.max(0, NOISE_SECONDS - dur - 0.05);
    src.start(t0, offset, dur);
    v.stopAt(src, t0 + dur + 0.01);
    return src;
  }

  // Slow amplitude/frequency wobble attached to an oscillator's detune.
  function vibrato(v, target, t0, dur, rate, depthCents) {
    if (!depthCents) return;
    var lfo = oscNode(v, 'sine', rate, t0, t0 + dur + 0.02);
    var amp = gainNode(v, depthCents);
    lfo.connect(amp);
    amp.connect(target.detune);
  }

  /* --------------------------------------------------------- formant voices */

  var VOWEL = {
    a: [800, 1150, 2900],
    i: [300, 2300, 3000],
    u: [350, 700, 2500]
  };

  // A glottal-ish sawtooth pushed through three parallel band-pass filters.
  // `morph` is [{ f: [f1,f2,f3], at: 0..1 }]; frequencies slide between the
  // points, which is what makes a vowel sound like it is changing.
  function formantVoice(v, o) {
    var t0 = o.t0, dur = o.dur;
    var src = oscNode(v, 'sawtooth', o.f0, t0, t0 + dur + 0.03);
    if (o.f0End != null && o.f0End !== o.f0) {
      src.frequency.exponentialRampToValueAtTime(Math.max(20, o.f0End), t0 + dur * 0.9);
    }
    vibrato(v, src, t0, dur, o.vibRate || 5.5, o.vibDepth || 0);

    var amp = envelope(v, t0, o.attack == null ? 0.045 : o.attack, dur,
      o.release == null ? Math.min(0.14, dur * 0.35) : o.release, o.peak);
    src.connect(amp);

    var weights = o.weights || [0.62, 0.27, 0.11];
    var points = o.morph;
    for (var i = 0; i < 3; i++) {
      var bp = v.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = o.q || 7;
      var first = points[0];
      bp.frequency.setValueAtTime(Math.max(60, first.f[i]), t0);
      for (var k = 1; k < points.length; k++) {
        bp.frequency.linearRampToValueAtTime(
          Math.max(60, points[k].f[i]), t0 + dur * points[k].at);
      }
      v.track(bp);
      var level = gainNode(v, weights[i]);
      amp.connect(bp);
      bp.connect(level);
      level.connect(v.out);
    }
  }

  /* ------------------------------------------------------------ sound bank */

  var BUILD = {
    click: function (v) {
      var t = v.t0;
      blip(v, { t0: t, dur: 0.05, type: 'square', f0: 1900, to: 1200, filter: 'lowpass', filterFreq: 5000, peak: 0.26, attack: 0.002, release: 0.04 });
    },

    move: function (v) {
      var t = v.t0;
      noiseBurst(v, { t0: t, dur: 0.06, filter: 'bandpass', freq: 1050, q: 3.5, peak: 0.3, attack: 0.002, release: 0.05 });
      blip(v, { t0: t, dur: 0.07, type: 'sine', f0: 220, to: 150, peak: 0.28, attack: 0.003, release: 0.06 });
    },

    capture: function (v) {
      var t = v.t0;
      blip(v, { t0: t, dur: 0.24, type: 'sine', f0: 150, to: 46, peak: 0.55, attack: 0.004, release: 0.21 });
      noiseBurst(v, { t0: t, dur: 0.16, filter: 'lowpass', freq: 1400, q: 0.7, peak: 0.32, attack: 0.003, release: 0.14 });
    },

    deal: function (v) {
      for (var i = 0; i < 3; i++) {
        noiseBurst(v, {
          t0: v.t0 + i * 0.09, dur: 0.09, filter: 'bandpass',
          freq: 1100, to: 3200, q: 2.2, peak: 0.5, attack: 0.005, release: 0.07
        });
      }
    },

    dice: function (v) {
      var times = [0, 0.07, 0.16, 0.23, 0.34];
      var freqs = [2500, 3200, 2200, 3600, 2800];
      for (var i = 0; i < times.length; i++) {
        noiseBurst(v, {
          t0: v.t0 + times[i], dur: 0.028, filter: 'bandpass',
          freq: freqs[i], q: 2.5, peak: 0.34, attack: 0.001, release: 0.024
        });
      }
      blip(v, { t0: v.t0 + 0.02, dur: 0.06, type: 'sine', f0: 240, to: 160, peak: 0.2, attack: 0.002, release: 0.05 });
    },

    win: function (v) {
      var notes = [[523.25, 0, 0.7], [659.25, 0.14, 0.7], [783.99, 0.28, 1.25]];
      for (var i = 0; i < notes.length; i++) {
        blip(v, {
          t0: v.t0 + notes[i][1], dur: notes[i][2] * 0.22, type: 'triangle',
          f0: notes[i][0], peak: 0.26, attack: 0.008, release: 0.06
        });
      }
    },

    lose: function (v) {
      blip(v, { t0: v.t0, dur: 0.24, type: 'triangle', f0: 392, to: 370, peak: 0.24, attack: 0.01, release: 0.16 });
      blip(v, { t0: v.t0 + 0.22, dur: 0.34, type: 'triangle', f0: 293.66, to: 261.63, peak: 0.22, attack: 0.01, release: 0.24 });
    },

    error: function (v) {
      blip(v, { t0: v.t0, dur: 0.1, type: 'square', f0: 220, to: 210, filter: 'lowpass', filterFreq: 1500, peak: 0.18, attack: 0.003, release: 0.07 });
      blip(v, { t0: v.t0 + 0.11, dur: 0.14, type: 'square', f0: 174.61, to: 165, filter: 'lowpass', filterFreq: 1300, peak: 0.17, attack: 0.003, release: 0.11 });
    },

    notify: function (v) {
      blip(v, { t0: v.t0, dur: 0.16, type: 'sine', f0: 880, peak: 0.16, attack: 0.02, release: 0.11 });
      blip(v, { t0: v.t0 + 0.12, dur: 0.24, type: 'sine', f0: 1174.66, peak: 0.15, attack: 0.02, release: 0.18 });
    },

    'voice-a': function (v) {
      formantVoice(v, {
        t0: v.t0, dur: 0.34, f0: 118, f0End: 106, peak: 1,
        morph: [{ f: VOWEL.a, at: 0 }], vibRate: 5.2, vibDepth: 3
      });
    },

    'voice-i': function (v) {
      formantVoice(v, {
        t0: v.t0, dur: 0.28, f0: 132, f0End: 124, peak: 0.95,
        morph: [{ f: VOWEL.i, at: 0 }], vibRate: 5.6, vibDepth: 2.5
      });
    },

    'voice-u': function (v) {
      formantVoice(v, {
        t0: v.t0, dur: 0.32, f0: 112, f0End: 100, peak: 1,
        morph: [{ f: VOWEL.u, at: 0 }], vibRate: 4.8, vibDepth: 3
      });
    },

    'voice-yeah': function (v) {
      formantVoice(v, {
        t0: v.t0, dur: 0.62, f0: 120, f0End: 175, peak: 0.95,
        morph: [{ f: VOWEL.a, at: 0 }, { f: [500, 1750, 2950], at: 0.45 }, { f: VOWEL.i, at: 0.8 }],
        vibRate: 5.8, vibDepth: 9
      });
    },

    bird: function (v) {
      var starts = [0, 0.12, 0.23, 0.32];
      for (var i = 0; i < starts.length; i++) {
        var up = i % 2 === 0;
        var src = blip(v, {
          t0: v.t0 + starts[i], dur: 0.08, type: 'sine',
          f0: up ? 2400 : 4000, to: up ? 4200 : 2500,
          peak: 0.13, attack: 0.004, release: 0.05
        });
        vibrato(v, src, v.t0 + starts[i], 0.08, 34, 60);
      }
    },

    cat: function (v) {
      formantVoice(v, {
        t0: v.t0, dur: 0.72, f0: 340, f0End: 300, peak: 0.95,
        morph: [{ f: VOWEL.i, at: 0 }, { f: VOWEL.a, at: 0.35 }, { f: VOWEL.u, at: 0.8 }],
        vibRate: 6.2, vibDepth: 7, attack: 0.05, release: 0.2
      });
      noiseBurst(v, { t0: v.t0 + 0.05, dur: 0.5, filter: 'bandpass', freq: 1800, q: 1.2, peak: 0.08, attack: 0.08, release: 0.35 });
    },

    dog: function (v) {
      var starts = [0, 0.3];
      for (var i = 0; i < starts.length; i++) {
        var t = v.t0 + starts[i];
        blip(v, {
          t0: t, dur: 0.15, type: 'sawtooth', f0: 210, to: 82,
          filter: 'lowpass', filterFreq: 700, peak: 0.42, attack: 0.004, release: 0.12
        });
        noiseBurst(v, { t0: t, dur: 0.1, filter: 'bandpass', freq: 820, q: 1.4, peak: 0.26, attack: 0.003, release: 0.08 });
      }
    },

    cow: function (v) {
      formantVoice(v, {
        t0: v.t0, dur: 0.9, f0: 128, f0End: 104, peak: 1,
        morph: [{ f: [420, 820, 2350], at: 0 }, { f: [380, 760, 2200], at: 0.7 }],
        vibRate: 4.4, vibDepth: 4, attack: 0.09, release: 0.28
      });
    },

    duck: function (v) {
      var starts = [0, 0.17];
      for (var i = 0; i < starts.length; i++) {
        var t = v.t0 + starts[i];
        noiseBurst(v, { t0: t, dur: 0.085, filter: 'bandpass', freq: 1500, to: 1100, q: 3, peak: 0.3, attack: 0.003, release: 0.06 });
        blip(v, { t0: t, dur: 0.08, type: 'square', f0: 330, to: 260, filter: 'lowpass', filterFreq: 1200, peak: 0.16, attack: 0.003, release: 0.06 });
      }
    }
  };

  /* ------------------------------------------------------------- play/build */

  function buildVoice(c, dest, name, opts, live) {
    var effect = BUILD[name];
    if (!effect) return false;
    var level = opts && typeof opts.volume === 'number' ? clamp(opts.volume, 0, 1) : 1;
    var start = c.currentTime + 0.012;
    var v = new Voice(c, dest, start, live, level);
    try {
      effect(v);
    } catch (e) {
      v.finish();
      return false;
    }
    v.finish();
    return true;
  }

  /* ---------------------------------------------------------------- public */

  function play(name, opts) {
    if (!BUILD[name] || muted) return false;
    var c = ensureContext();
    if (!c) return false;
    if (!contextRunning()) {
      if (pending.length >= MAX_PENDING) {
        var lost = pending.shift();
        notifyDrop(lost && lost.name);
      }
      pending.push({ name: name, opts: opts });
      armUnlock();
      tryResume();
      return true; // queued; will play after the first gesture / statechange
    }
    return buildVoice(c, master, name, opts, true);
  }

  function setVolume(next) {
    var n = parseFloat(next);
    if (isNaN(n)) return volume;
    volume = clamp(n, 0, 1);
    storageSet(VOL_KEY, String(volume));
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
    }
    return volume;
  }

  function mute(on) {
    muted = !!on;
    storageSet(MUTE_KEY, muted ? '1' : '0');
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
    }
    if (muted) pending.length = 0;
    syncButtons();
    return muted;
  }

  function isMuted() {
    return muted;
  }

  function dropped() {
    return droppedCount;
  }

  function list() {
    return ORDER.slice();
  }

  /* ------------------------------------------------------------ mute button */

  var ICON_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z"/>' +
    '<path d="M15.6 9.2a4 4 0 0 1 0 5.6"/>' +
    '<path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>';

  var ICON_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z"/>' +
    '<path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/></svg>';

  var CSS =
    '.sfx-toggle{display:inline-flex;align-items:center;justify-content:center;' +
    'width:44px;height:44px;min-width:44px;padding:0;margin:0;border:1px solid currentColor;' +
    'border-radius:999px;background:transparent;color:inherit;cursor:pointer;' +
    'line-height:1;-webkit-appearance:none;appearance:none;flex:none;opacity:.75;' +
    'transition:opacity .15s ease}' +
    '.sfx-toggle:hover{opacity:1}' +
    '.sfx-toggle:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
    '.sfx-toggle svg{display:block;width:20px;height:20px;pointer-events:none}' +
    '.sfx-toggle[aria-pressed="true"]{opacity:.45}';

  function injectCSS() {
    if (!root.document || root.document.getElementById('sfx-style')) return;
    var style = root.document.createElement('style');
    style.id = 'sfx-style';
    style.textContent = CSS;
    (root.document.head || root.document.documentElement).appendChild(style);
  }

  function toggleLabel() {
    return muted ? '开启声音 / Unmute' : '静音 / Mute';
  }

  function syncButtons() {
    if (!root.document || !root.document.querySelectorAll) return;
    var buttons = root.document.querySelectorAll('.sfx-toggle');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.innerHTML = muted ? ICON_OFF : ICON_ON;
      b.setAttribute('aria-pressed', muted ? 'true' : 'false');
      b.setAttribute('aria-label', toggleLabel());
      b.title = toggleLabel();
      if (!b.__sfxBound) {
        b.__sfxBound = true;
        b.addEventListener('click', function () {
          mute(!muted);
        });
      }
    }
  }

  function initButtons() {
    if (!root.document) return;
    injectCSS();
    syncButtons();
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', initButtons);
    } else {
      initButtons();
    }
  }

  /* -------------------------------------------------------------- internals */

  // Render one effect offline (mono, 44.1 kHz) and return the AudioBuffer.
  // Used by the verification harness and useful for regressions; not needed
  // by game pages.
  function renderOffline(name, seconds) {
    if (!BUILD[name]) return null;
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) return null;
    var sr = 44100;
    var dur = seconds || 1;
    var offline = new OAC(1, Math.ceil(sr * dur), sr);
    if (!buildVoice(offline, offline.destination, name, { volume: 1 }, false)) return null;
    return offline.startRendering();
  }

  function snapshot() {
    return {
      created: stats.created,
      disconnected: stats.disconnected,
      active: stats.active,
      pending: pending.length,
      dropped: droppedCount,
      unlocked: contextRunning(),
      contextState: ctx ? ctx.state : 'none',
      muted: muted,
      volume: volume
    };
  }

  return {
    play: play,
    setVolume: setVolume,
    mute: mute,
    isMuted: isMuted,
    dropped: dropped,
    list: list,
    syncButtons: syncButtons,
    version: '1.0.0',
    // diagnostics / verification
    stats: snapshot,
    _render: renderOffline
  };
});
