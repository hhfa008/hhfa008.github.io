/* Arcade background music — CC0 audio files first, runtime synthesis as fallback.
 *
 * Two layers share one AudioContext and one master bus:
 *
 *   file layer   fetch CC0 .ogg/.m4a -> decodeAudioData -> AudioBufferSourceNode
 *                (loop = true). One buffer per family, decoded once, cached.
 *                Switching family cross-fades ~400 ms; the previous source is
 *                stopped after the fade.
 *   synth layer  the original runtime-synthesized family themes. Kept intact
 *                and used silently whenever the file cannot be fetched or
 *                decoded (404 / offline / unsupported codec). Nothing throws.
 *
 *   Music.start('numbers'|'board'|'reaction'|'memory'|'pong')
 *   Music.stop() / pause() / resume()
 *   Music.mute(true|false) / isMuted() / setVolume(0..1)
 *   Music.isPlaying() / family() / accent('win'|'lose') / duck()
 *   Music.syncButtons()
 *   Music.stats()      // diagnostics for the verification harness
 *
 * Bus layout (shared with games/shared/sfx.js through globalThis.__arcadeAudioBus):
 *
 *   sfx voices  -> sfxBus  -\
 *                            >-- master(1.0) -> DynamicsCompressor(limiter) -> out
 *   bgm source  -> trackGain /
 *                   \-- bgmBus(volume * duck) -> master
 *
 * Whichever script initialises first creates the bus; the other adopts it, so
 * the page never ends up with two AudioContexts.
 *
 * Volume: per-track gain comes from manifest `gain_db` (loudness-normalised
 * offline), scaled by TRACK_BASE_GAIN so the default user volume (0.13) lands
 * around -22..-25 dBFS RMS **after the limiter**. WebKit's
 * DynamicsCompressorNode applies makeup gain even below threshold, so the
 * bus is calibrated at runtime with an OfflineAudioContext render instead of
 * trusting a constant (see measureLimiterMakeup). The base was derived from
 * the converted files' measured RMS (ffmpeg volumedetect), not by ear — see
 * LICENSES.md next to the audio. Music is on by default; volume/mute persist
 * under hhfa-music-*.
 *
 * Playback still starts only inside a user gesture (the caller — arcade.js —
 * invokes start() there). Hidden tabs suspend the shared context; returning
 * resumes it, so the loop continues from where it stopped. With no
 * AudioContext (Node test runner) every call is a silent no-op.
 *
 * Format choice: probed once via HTMLAudioElement.canPlayType. Safari only
 * gained Ogg Vorbis in 18.4 (Apple "Safari 18.4 Release Notes", WebKit
 * Features in Safari 18.4, https://webkit.org/blog/16574/); older Safari/iOS
 * has no Vorbis decoder. So both formats ship and only the probed one is
 * requested; the other is a lazy fallback if fetch/decode fails.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Music = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VOL_KEY = 'hhfa-music-volume';
  var MUTE_KEY = 'hhfa-music-muted';
  var DEFAULT_VOLUME = 0.13;

  // Lookahead: schedule notes at most ~0.12s into the future, wake every 25ms.
  var LOOKAHEAD = 0.12;
  var TICK_MS = 25;
  var STEPS_PER_BAR = 16;

  /* ------------------------------------------------------- file track table */

  var AUDIO_BASE = '/games/assets/audio/bgm/';
  // family -> asset slug + per-track loudness compensation from manifest.json.
  // gain_db is the offline loudness-normalisation gain, NOT an RMS delta; the
  // final trim_db is a small measured correction (offline render, 2026-11-14)
  // so every track lands inside the -22..-25 dBFS RMS target at volume 0.13
  // AFTER the limiter (measureLimiterMakeup cancels its makeup gain).
  // `offset` starts playback inside the track. memory-apple-cider's first
  // 0-2 s is 11.1 dB below its body (source RMS -28.9 vs -17.8 dBFS), so it
  // starts at 22 s. Post-limiter there: 0-2 s -21.5 dBFS vs a -22.4 dBFS
  // 2 s-window median (well inside the "intro >= body - 6 dB" rule).
  var TRACKS = {
    numbers: { slug: 'numbers-flowerbed', gain_db: 4.28, trim_db: -3.0, offset: 0, duration: 89.75, bpm: 143.6, key: 'A# minor' },
    board: { slug: 'board-musicbox', gain_db: 0.59, trim_db: 0.5, offset: 0, duration: 89.75, bpm: 112.3, key: 'A# major' },
    reaction: { slug: 'reaction-childrens-march', gain_db: 1.0, trim_db: 1.8, offset: 0, duration: 63.75, bpm: 89.1, key: 'F major' },
    memory: { slug: 'memory-apple-cider', gain_db: -0.99, trim_db: 2.4, offset: 22, duration: 89.75, bpm: 99.4, key: 'G major' },
    pong: { slug: 'pong-happy-adventure', gain_db: -0.1, trim_db: -0.1, offset: 0, duration: 46.56, bpm: 123, key: 'G major' }
  };
  // Derived so volume 0.13 yields roughly -22..-25 dBFS RMS AFTER the limiter
  // on the five files. trim_db centres each track at ~-23.5 dBFS post-limiter;
  // see measureLimiterMakeup for the per-browser makeup cancellation.
  var TRACK_BASE_GAIN = 3.4;
  var CROSSFADE = 0.4;          // 400 ms, inside the 300-600 ms target
  var DUCK_RATIO = 0.251;       // -12 dB
  var DUCK_ATTACK = 0.2;        // press within 200 ms
  var DUCK_HOLD = 0.35;
  var DUCK_RELEASE = 0.45;      // fully restored by 1.0 s

  /* --------------------------------------------------------------- themes */

  // Every synth theme is a 16-step grid. `pattern` holds semitone offsets from
  // the theme root (null = rest); `chords` is a per-bar offset progression.
  var THEMES = {
    // Bright major arpeggio, light and upward.
    numbers: {
      label: 'numbers arpeggio', bpm: 112, wave: 'triangle', root: 60,
      pattern: [0, 4, 7, 12, 7, 4, 2, 4, 0, 4, 9, 12, 16, 12, 9, 7],
      chords: [0, 9, 5, 7], noteDur: 0.14, gain: 0.36,
      bassEvery: 8, bassGain: 0.26, bassDur: 0.34
    },
    // Macaron xylophone: soft sine plucks with an octave sparkle.
    board: {
      label: 'board xylophone', bpm: 96, wave: 'sine', root: 65,
      pattern: [0, null, 4, null, 7, null, 12, null, 9, null, 7, null, 4, null, 2, null],
      chords: [0, 5, -2, 7], noteDur: 0.24, gain: 0.30,
      dyad: 12, dyadGain: 0.11,
      bassEvery: 8, bassGain: 0.17, bassDur: 0.5
    },
    // Tight rhythmic pulse for whack/aim/reaction.
    reaction: {
      label: 'reaction pulse', bpm: 132, wave: 'triangle', root: 57,
      pattern: [0, null, 0, null, 7, null, 12, null, 0, null, 5, null, 7, null, -5, null],
      chords: [0, 0, 5, 7], noteDur: 0.10, gain: 0.32,
      bassEvery: 4, bassGain: 0.22, bassDur: 0.16
    },
    // Gentle swing for memory pairs.
    memory: {
      label: 'memory swing', bpm: 84, wave: 'sine', root: 64,
      pattern: [0, null, 4, null, 7, null, 4, null, 9, null, 5, null, 4, null, 2, null],
      chords: [0, 5, 9, 7], noteDur: 0.30, gain: 0.27,
      dyad: 4, dyadGain: 0.09, swing: 0.055,
      bassEvery: 8, bassGain: 0.15, bassDur: 0.62
    },
    // Retro electronic pulse for pong.
    pong: {
      label: 'pong retro', bpm: 124, wave: 'square', root: 57,
      pattern: [0, null, 12, null, 7, null, 12, null, 0, null, 12, null, 10, null, 7, null],
      chords: [0, 5, 7, 3], noteDur: 0.10, gain: 0.20,
      bassEvery: 4, bassGain: 0.18, bassDur: 0.16
    }
  };

  /* ----------------------------------------------------------- preference */

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function storageGet(key) {
    try { return root.localStorage ? root.localStorage.getItem(key) : null; }
    catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { if (root.localStorage) root.localStorage.setItem(key, value); }
    catch (e) {}
  }
  function documentHidden() {
    return !!(root.document && root.document.hidden);
  }

  var storedVolume = parseFloat(storageGet(VOL_KEY));
  var volume = isNaN(storedVolume) ? DEFAULT_VOLUME : clamp(storedVolume, 0, 1);
  var muted = storageGet(MUTE_KEY) === '1';

  /* -------------------------------------------------------------- engine */

  var BUS_KEY = '__arcadeAudioBus';
  var ctx = null;
  var hub = null;
  var bgmBus = null;
  var timer = null;
  var current = 'numbers';
  var wantPlaying = false;
  var paused = false;
  var ducked = false;
  var duckTimer = null;
  var nextStepTime = 0;
  var stepIndex = 0;
  var voices = [];
  var playToken = 0;
  var sessionArmed = false;
  var interrupted = false;

  var fileState = {
    buffers: {},        // family -> decoded AudioBuffer
    loading: {},        // family -> in-flight Promise
    failed: {},         // family -> true when both formats failed
    formats: {},        // family -> 'ogg' | 'm4a'
    requested: [],      // every bgm URL actually fetched
    decoded: 0,
    currentSource: null,
    currentGain: null,
    currentFamily: null,
    crossfades: 0
  };
  var formatOrder = null;

  var stats = { scheduled: 0, active: 0, cancelled: 0, started: 0 };

  function nowPlaying() {
    if (!(ctx && wantPlaying && !paused && !muted && !interrupted)) return false;
    return !!(fileState.currentSource || timer);
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // One AudioContext and one limiter master for the whole page. sfx.js uses the
  // same object (see shared/sfx.js), so whichever initialises first wins and
  // the other adopts: never two contexts, never two limiters.
  var LIMITER = { threshold: -10, knee: 6, ratio: 12, attack: 0.003, release: 0.25 };

  function configureLimiter(comp) {
    try {
      comp.threshold.value = LIMITER.threshold;
      comp.knee.value = LIMITER.knee;
      comp.ratio.value = LIMITER.ratio;
      comp.attack.value = LIMITER.attack;
      comp.release.value = LIMITER.release;
    } catch (e) {}
    return comp;
  }

  function sharedBus(AC) {
    var existing = root[BUS_KEY];
    if (existing && existing.ctx && existing.ctx.state !== 'closed') return existing;
    var c = null;
    try { c = new AC(); } catch (e) { return null; }
    var master = c.createGain();
    master.gain.value = 1;
    var comp = null;
    try {
      comp = configureLimiter(c.createDynamicsCompressor());
    } catch (e) { comp = null; }
    if (comp) {
      master.connect(comp);
      comp.connect(c.destination);
    } else {
      master.connect(c.destination);
    }
    var created = { ctx: c, master: master };
    root[BUS_KEY] = created;
    return created;
  }

  function ensureContext() {
    if (ctx && ctx.state === 'closed') {
      ctx = null; hub = null; bgmBus = null; fileState.currentSource = null;
    }
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    var h = sharedBus(AC);
    if (!h) return null;
    ctx = h.ctx;
    hub = h;
    bgmBus = ctx.createGain();
    bgmBus.gain.value = bgmBaseGain();
    bgmBus.connect(h.master);
    return ctx;
  }

  // ----------------------------- limiter makeup calibration (post-limiter) --
  //
  // The audible level is what comes OUT of the shared limiter, not what goes
  // in. DynamicsCompressorNode applies makeup gain even far below threshold:
  // the independent audio check on 2026-11-14 measured a constant +4.33 dB
  // from -49 dBFS to -17 dBFS input in Safari 27.2, and this implementation
  // measured +4.21 dB in Chrome 157 on the same settings. A future engine may
  // differ, so the makeup is MEASURED per browser with an OfflineAudioContext
  // render of a low-level sine through a clone of the same limiter, then
  // cancelled from the BGM path. Do not replace this with a hard-coded 4.33
  // (or 0): stats() exposes limiterMakeupDb so a regression is visible and
  // re-calibrating remains automatic.
  var CALIBRATION = { makeupDb: null, factor: 1, ready: false, promise: null };

  function measureLimiterMakeup() {
    if (CALIBRATION.promise) return CALIBRATION.promise;
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var sr = ctx && ctx.sampleRate ? ctx.sampleRate : 44100;
    var amplitude = 0.02;                 // ~ -34 dBFS RMS, below threshold
    var seconds = 0.5;
    var promise;
    try {
      if (!OAC) throw new Error('no OfflineAudioContext');
      var off = new OAC(1, Math.ceil(sr * seconds), sr);
      var osc = off.createOscillator();
      var gain = off.createGain();
      gain.gain.value = amplitude;
      osc.frequency.value = 1000;
      var comp = configureLimiter(off.createDynamicsCompressor());
      osc.connect(gain);
      gain.connect(comp);
      comp.connect(off.destination);
      osc.start(0);
      promise = off.startRendering().then(function (rendered) {
        var data = rendered.getChannelData(0);
        var start = Math.floor(data.length * 0.25);
        var sum = 0;
        var n = 0;
        for (var i = start; i < data.length; i++) { sum += data[i] * data[i]; n++; }
        var outRms = n ? Math.sqrt(sum / n) : 0;
        var inRms = amplitude / Math.SQRT2;
        var db = 20 * Math.log10(outRms / inRms);
        if (!isFinite(db)) db = 0;
        return db;
      });
    } catch (e) {
      promise = Promise.resolve(0);
    }
    CALIBRATION.promise = promise.then(function (db) {
      CALIBRATION.makeupDb = db;
      CALIBRATION.factor = Math.pow(10, -db / 20);
      CALIBRATION.ready = true;
      applyBgmGain();
      return db;
    }, function () {
      CALIBRATION.ready = true;
      applyBgmGain();
      return 0;
    });
    return CALIBRATION.promise;
  }

  function calibrate() {
    return CALIBRATION.promise || measureLimiterMakeup();
  }

  function bgmBaseGain() {
    return (muted ? 0 : volume) * CALIBRATION.factor;
  }

  function applyBgmGain() {
    if (!bgmBus || !ctx) return;
    if (duckTimer) { clearTimeout(duckTimer); duckTimer = null; }
    ducked = false;
    try { bgmBus.gain.cancelScheduledValues(ctx.currentTime); } catch (e) {}
    try { bgmBus.gain.setTargetAtTime(bgmBaseGain(), ctx.currentTime, 0.03); }
    catch (e) { bgmBus.gain.value = bgmBaseGain(); }
  }

  /* ------------------------------------------------------- file transport */

  function chooseFormats() {
    // Probe the current engine; never assume. The independent audio check on
    // 2026-11-14 measured this on macOS 27.2 / Safari 27.2:
    //   canPlayType('audio/ogg; codecs="vorbis"') === 'probably'
    // so Safari 27.2 requests Ogg first. The AAC/M4A twin remains because
    // Apple only added Ogg Vorbis container support in Safari 18.4 (Apple
    // "Safari 18.4 Release Notes"; WebKit blog https://webkit.org/blog/16574/),
    // and this code must work on engines older than that. Older-engine
    // answers are handled by the probe itself, not asserted here.
    var order = ['ogg', 'm4a'];
    try {
      if (root.document && root.document.createElement) {
        var probe = root.document.createElement('audio');
        if (probe && probe.canPlayType) {
          var ogg = probe.canPlayType('audio/ogg; codecs="vorbis"');
          var m4a = probe.canPlayType('audio/mp4; codecs="mp4a.40.2"');
          if (ogg === 'probably') order = ['ogg', 'm4a'];
          else if (m4a) order = ['m4a', 'ogg'];
        }
      }
    } catch (e) {}
    return order;
  }

  function fetchOne(slug, ext) {
    var url = AUDIO_BASE + slug + '.' + ext;
    fileState.requested.push(url);
    if (!root.fetch) return Promise.reject(new Error('fetch unavailable'));
    return root.fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res || !res.ok) throw new Error('bgm HTTP ' + (res ? res.status : '?'));
      return res.arrayBuffer();
    }).then(function (array) {
      return new Promise(function (resolve, reject) {
        try {
          var maybe = ctx.decodeAudioData(array, resolve, reject);
          if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
        } catch (e) { reject(e); }
      });
    });
  }

  function loadFamily(family) {
    if (fileState.buffers[family]) return Promise.resolve(fileState.buffers[family]);
    if (fileState.loading[family]) return fileState.loading[family];
    if (!ctx || fileState.failed[family]) return Promise.reject(new Error('bgm unavailable'));
    if (!formatOrder) formatOrder = chooseFormats();
    var slug = TRACKS[family].slug;
    var chain = Promise.reject(new Error('no format attempted'));
    formatOrder.forEach(function (ext) {
      chain = chain.catch(function () {
        return fetchOne(slug, ext).then(function (buffer) {
          fileState.buffers[family] = buffer;
          fileState.formats[family] = ext;
          fileState.decoded++;
          return buffer;
        });
      });
    });
    fileState.loading[family] = chain.then(function (buffer) {
      delete fileState.loading[family];
      return buffer;
    }, function (err) {
      delete fileState.loading[family];
      fileState.failed[family] = true;
      throw err;
    });
    return fileState.loading[family];
  }

  function trackAmplitude(family) {
    var t = TRACKS[family];
    if (!t) return TRACK_BASE_GAIN;
    var db = t.gain_db + (t.trim_db || 0);
    return TRACK_BASE_GAIN * Math.pow(10, db / 20);
  }

  // Fade out and retire whatever file source is playing.
  function endFile(fade) {
    var old = fileState.currentSource;
    var oldGain = fileState.currentGain;
    if (!old) { fileState.currentGain = null; fileState.currentFamily = null; return; }
    fileState.currentSource = null;
    fileState.currentGain = null;
    fileState.currentFamily = null;
    if (!ctx) return;
    var now = ctx.currentTime;
    try {
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(Math.max(0.0001, oldGain.gain.value), now);
      oldGain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    } catch (e) {}
    var wait = Math.max(0, fade) * 1000 + 100;
    setTimeout(function () {
      try { old.stop(); } catch (e) {}
      try { old.disconnect(); } catch (e) {}
      try { oldGain.disconnect(); } catch (e) {}
    }, wait);
  }

  function startFile(family, buffer) {
    if (!ctx || !bgmBus) return false;
    // A file now owns the music; the synth scheduler must be quiet.
    clearTimer();
    cancelVoices();
    var hadPrevious = !!fileState.currentSource;
    endFile(hadPrevious ? CROSSFADE : 0.08);
    if (hadPrevious) fileState.crossfades++;
    var src = null;
    try { src = ctx.createBufferSource(); } catch (e) { return false; }
    src.buffer = buffer;
    src.loop = true;
    var gain = ctx.createGain();
    var target = Math.max(0.0002, trackAmplitude(family));
    var now = ctx.currentTime;
    try {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(target, now + (hadPrevious ? CROSSFADE : 0.05));
    } catch (e) { gain.gain.value = target; }
    src.connect(gain);
    gain.connect(bgmBus);
    var track = TRACKS[family] || {};
    var offset = track.offset || 0;
    if (!(offset > 0) || offset >= buffer.duration - 0.05) offset = 0;
    try { src.start(0, offset); } catch (e) {
      try { gain.disconnect(); } catch (e2) {}
      return false;
    }
    fileState.currentSource = src;
    fileState.currentGain = gain;
    fileState.currentFamily = family;
    fileState.startedAt = ctx.currentTime;
    fileState.playbackOffset = offset;
    stats.started++;
    src.onended = function () {
      if (fileState.currentSource === src) {
        fileState.currentSource = null;
        fileState.currentGain = null;
        fileState.currentFamily = null;
      }
    };
    return true;
  }

  /* --------------------------------------------------------------- synth */

  function releaseVoice(entry) {
    var i = voices.indexOf(entry);
    if (i >= 0) voices.splice(i, 1);
  }

  function scheduleVoice(freq, when, dur, wave, gain, detune) {
    if (!ctx || muted || paused) return;
    var osc = ctx.createOscillator();
    var env = ctx.createGain();
    osc.type = wave || 'sine';
    osc.frequency.setValueAtTime(freq, when);
    if (detune) osc.detune.setValueAtTime(detune, when);
    var peak = Math.max(0.0002, gain);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(env);
    env.connect(bgmBus);
    var entry = { osc: osc, env: env };
    voices.push(entry);
    stats.scheduled++;
    stats.active++;
    osc.onended = function () {
      stats.active--;
      releaseVoice(entry);
      try { env.disconnect(); } catch (e) {}
      try { osc.disconnect(); } catch (e) {}
    };
    try {
      osc.start(when);
      osc.stop(when + dur + 0.03);
    } catch (e) {}
  }

  function stepDuration() {
    var theme = THEMES[current] || THEMES.numbers;
    return 60 / theme.bpm / (STEPS_PER_BAR / 4);
  }

  function scheduleStep(index, when) {
    var theme = THEMES[current] || THEMES.numbers;
    var steps = theme.pattern.length;
    var step = index % steps;
    var bar = Math.floor(index / steps);
    var chord = theme.chords[bar % theme.chords.length] || 0;
    var offset = theme.pattern[step];
    var at = when + (theme.swing && step % 2 ? theme.swing : 0);
    if (offset != null) {
      var midi = theme.root + offset + chord;
      scheduleVoice(midiToFreq(midi), at, theme.noteDur, theme.wave, theme.gain);
      if (theme.dyad) {
        scheduleVoice(midiToFreq(midi + theme.dyad), at + 0.008, theme.noteDur * 0.8, theme.wave, theme.dyadGain);
      }
    }
    if (theme.bassEvery && step % theme.bassEvery === 0) {
      scheduleVoice(midiToFreq(theme.root - 12 + chord), at, theme.bassDur, 'sine', theme.bassGain);
    }
  }

  function loop() {
    timer = null;
    if (!nowPlayingFileFellBack() || !ctx) return;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
    }
    var horizon = ctx.currentTime + LOOKAHEAD;
    var guard = 0;
    while (nextStepTime < horizon && guard < 64) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += stepDuration();
      stepIndex++;
      guard++;
    }
    if (guard >= 64) nextStepTime = ctx.currentTime + 0.02;
    timer = setTimeout(loop, TICK_MS);
  }

  // The synth scheduler only runs when the file layer is unavailable.
  function nowPlayingFileFellBack() {
    return wantPlaying && !paused && !muted && !interrupted &&
      !fileState.currentSource && !!fileState.failed[current];
  }

  function startSynth() {
    if (!ctx || timer) return false;
    fileState.failed[current] = true;
    nextStepTime = ctx.currentTime + 0.05;
    stepIndex = 0;
    stats.started++;
    loop();
    return true;
  }

  function cancelVoices() {
    var list = voices.slice();
    voices.length = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      try { v.osc.stop(0); } catch (e) {}
      try { v.osc.disconnect(); } catch (e) {}
      try { v.env.disconnect(); } catch (e) {}
      stats.cancelled++;
    }
    stats.active = 0;
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  /* ----------------------------------------------------------------- iOS */

  // iOS Safari 16.4+: mark the audio session as playback so the hardware mute
  // switch does not silence music. Everything is feature-detected and guarded.
  function armIOSSession() {
    if (sessionArmed || !root.navigator) return;
    var session = null;
    try { session = root.navigator.audioSession; } catch (e) { return; }
    if (!session) return;
    sessionArmed = true;
    try { session.type = 'playback'; } catch (e) {}
    function onState() {
      var state = '';
      try { state = session.state; } catch (e) {}
      if (state === 'interrupted') {
        interrupted = true;
      } else {
        interrupted = false;
        if (wantPlaying && !muted && !documentHidden()) resume();
      }
    }
    try {
      if (typeof session.addEventListener === 'function') session.addEventListener('statechange', onState);
      else session.onstatechange = onState;
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- API */

  function start(family) {
    if (family && THEMES[family]) current = family;
    wantPlaying = true;
    if (muted) return false;
    if (documentHidden()) { paused = true; return false; }
    var c = ensureContext();
    if (!c) return false;
    paused = false;
    armIOSSession();
    try { c.resume(); } catch (e) {}
    var token = ++playToken;
    var target = current;
    // Calibrate before the first source starts so the very first second is
    // already at the post-limiter target, not +4.33 dB hotter.
    calibrate().then(function () {
      if (token !== playToken || !wantPlaying || paused || muted || interrupted) return;
      if (current !== target) return;
      if (fileState.buffers[target]) {
        startFile(target, fileState.buffers[target]);
        return;
      }
      if (fileState.failed[target] || !root.fetch) {
        startSynth();
        return;
      }
      loadFamily(target).then(function (buffer) {
        if (token !== playToken || !wantPlaying || paused || muted || interrupted) return;
        if (current !== target) return;
        startFile(target, buffer);
      }).catch(function () {
        if (token !== playToken || !wantPlaying || paused || muted || interrupted) return;
        if (current === target) startSynth();
      });
    });
    return true;
  }

  function stop() {
    wantPlaying = false;
    paused = true;
    playToken++;
    clearTimer();
    cancelVoices();
    endFile(0.15);
  }

  function pause() {
    paused = true;
    clearTimer();
    cancelVoices();
    // File sources cannot pause; suspend the shared clock instead. It resumes
    // from the same buffer position, so the loop continues where it stopped.
    if (ctx && fileState.currentSource && ctx.state === 'running') {
      try { ctx.suspend(); } catch (e) {}
    }
  }

  function resume() {
    if (!wantPlaying || muted || documentHidden()) return false;
    var c = ensureContext();
    if (!c) return false;
    paused = false;
    interrupted = false;
    try {
      var p = c.resume();
      if (p && typeof p.then === 'function') p.then(function () {}, function () {});
    } catch (e) {}
    if (fileState.currentSource) return true;
    var token = ++playToken;
    var target = current;
    calibrate().then(function () {
      if (token !== playToken || !wantPlaying || paused || muted || interrupted) return;
      if (fileState.failed[target]) { if (!timer) startSynth(); return; }
      if (fileState.loading[target]) return;
      loadFamily(target).then(function (buffer) {
        if (token !== playToken || !wantPlaying || paused || muted || interrupted) return;
        startFile(target, buffer);
      }).catch(function () {
        if (token !== playToken || !wantPlaying || paused || muted) return;
        startSynth();
      });
    });
    return true;
  }

  function setVolume(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return volume;
    volume = clamp(n, 0, 1);
    storageSet(VOL_KEY, String(volume));
    applyBgmGain();
    return volume;
  }

  function mute(on) {
    muted = !!on;
    storageSet(MUTE_KEY, muted ? '1' : '0');
    applyBgmGain();
    if (muted) pause();
    else if (wantPlaying) resume();
    syncButtons();
    return muted;
  }

  // Duck the BGM under a win/lose sting: -12 dB reached in 200 ms, released
  // so the original level is fully back within 1 s.
  function duck() {
    if (!ctx || !bgmBus || muted) return false;
    var base = bgmBaseGain();
    var now = ctx.currentTime;
    ducked = true;
    try {
      bgmBus.gain.cancelScheduledValues(now);
      bgmBus.gain.setValueAtTime(Math.max(0.0001, bgmBus.gain.value), now);
      bgmBus.gain.linearRampToValueAtTime(Math.max(0.0001, base * DUCK_RATIO), now + DUCK_ATTACK);
      bgmBus.gain.setValueAtTime(Math.max(0.0001, base * DUCK_RATIO), now + DUCK_ATTACK + DUCK_HOLD);
      bgmBus.gain.linearRampToValueAtTime(base, now + DUCK_ATTACK + DUCK_HOLD + DUCK_RELEASE);
    } catch (e) { return false; }
    if (duckTimer) clearTimeout(duckTimer);
    duckTimer = setTimeout(function () {
      duckTimer = null;
      ducked = false;
    }, (DUCK_ATTACK + DUCK_HOLD + DUCK_RELEASE) * 1000 + 20);
    return true;
  }

  function accent(kind) {
    if (!nowPlaying() || !ctx) return false;
    var theme = THEMES[current] || THEMES.numbers;
    var notes = kind === 'lose' ? [0, -3, -5, -12] : [0, 4, 7, 12];
    var t = ctx.currentTime + 0.03;
    for (var i = 0; i < notes.length; i++) {
      scheduleVoice(
        midiToFreq(theme.root + 12 + notes[i]),
        t + i * 0.085,
        0.16,
        theme.wave,
        theme.gain * 0.9
      );
    }
    return true;
  }

  function statsSnapshot() {
    var track = TRACKS[current] || null;
    var buffer = fileState.buffers[current] || null;
    var source = fileState.currentSource;
    var mode = source ? 'file' : (fileState.failed[current] ? 'synth' : 'idle');
    return {
      family: current,
      theme: (THEMES[current] || THEMES.numbers).label,
      track: track ? track.slug : null,
      mode: mode,
      playing: nowPlaying(),
      wantPlaying: wantPlaying,
      paused: paused,
      muted: muted,
      ducked: ducked,
      interrupted: interrupted,
      volume: volume,
      contextState: ctx ? ctx.state : 'none',
      limiterMakeupDb: CALIBRATION.makeupDb,
      limiterCompensation: CALIBRATION.factor,
      calibrated: CALIBRATION.ready,
      // Self-check: compensation must be the exact inverse of the measured
      // makeup, so post-limiter level equals the calibrated pre-limiter level.
      calibrationOk: CALIBRATION.ready && isFinite(CALIBRATION.makeupDb) &&
        Math.abs(CALIBRATION.factor * Math.pow(10, CALIBRATION.makeupDb / 20) - 1) < 1e-6,
      startOffset: (TRACKS[current] && TRACKS[current].offset) || 0,
      format: fileState.formats[current] || null,
      formatOrder: formatOrder ? formatOrder.slice() : null,
      decoded: fileState.decoded,
      bufferDuration: buffer ? buffer.duration : null,
      loop: source ? source.loop : null,
      sourceCount: source ? 1 : 0,
      sourcePosition: (source && buffer && ctx)
        ? ((ctx.currentTime - fileState.startedAt + (fileState.playbackOffset || 0)) % buffer.duration)
        : null,
      crossfades: fileState.crossfades,
      requested: fileState.requested.slice(),
      synthScheduled: stats.scheduled,
      synthActive: stats.active,
      synthCancelled: stats.cancelled,
      starts: stats.started
    };
  }

  /* ------------------------------------------------------------ buttons */

  var ICON_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
  var ICON_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>' +
    '<path d="m3 3 18 18"/></svg>';

  var CSS =
    '.music-toggle{display:inline-flex;align-items:center;justify-content:center;' +
    'width:44px;height:44px;min-width:44px;padding:0;margin:0;border:1px solid currentColor;' +
    'border-radius:999px;background:transparent;color:inherit;cursor:pointer;' +
    'line-height:1;-webkit-appearance:none;appearance:none;flex:none;opacity:.75;' +
    'transition:opacity .15s ease}' +
    '.music-toggle:hover{opacity:1}' +
    '.music-toggle:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
    '.music-toggle svg{display:block;width:20px;height:20px;pointer-events:none}' +
    '.music-toggle[aria-pressed="true"]{opacity:.45}';

  function injectCSS() {
    if (!root.document || root.document.getElementById('music-style')) return;
    var style = root.document.createElement('style');
    style.id = 'music-style';
    style.textContent = CSS;
    (root.document.head || root.document.documentElement).appendChild(style);
  }

  function toggleLabel() {
    return muted ? '开启音乐 / Unmute music' : '关闭音乐 / Mute music';
  }

  function syncButtons() {
    if (!root.document || !root.document.querySelectorAll) return;
    var buttons = root.document.querySelectorAll('.music-toggle');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.innerHTML = muted ? ICON_OFF : ICON_ON;
      b.setAttribute('aria-pressed', muted ? 'true' : 'false');
      b.setAttribute('aria-label', toggleLabel());
      b.title = toggleLabel();
      if (!b.__musicBound) {
        b.__musicBound = true;
        b.addEventListener('click', function () { mute(!muted); });
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
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.hidden) pause();
      else resume();
    });
    root.addEventListener('pagehide', pause);
  }

  return {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    mute: mute,
    isMuted: function () { return muted; },
    setVolume: setVolume,
    isPlaying: nowPlaying,
    family: function () { return current; },
    accent: accent,
    duck: duck,
    syncButtons: syncButtons,
    themes: function () { return Object.keys(THEMES); },
    stats: statsSnapshot,
    version: '2.0.0'
  };
});
