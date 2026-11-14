/* 程序化 BGM（场景化环境音乐），零音频文件、零外部请求。
 *
 *   Bgm.play('table' | 'dungeon' | 'market' | 'garden' | 'night')
 *   Bgm.stop() / Bgm.setVolume(0..1) / Bgm.mute(bool) / Bgm.isMuted()
 *   Bgm.current() / Bgm.scenes() / Bgm.version
 *
 * 设计：
 *  - 每个场景是一条缓慢的和弦铺底（2–3 个振荡器 + 低通 + 慢 LFO），
 *    用 WebAudio 合成，不加载任何资源；与 shared/sfx.js 同一套“脚本即音频”的思路。
 *  - 首次播放必须在用户手势内（浏览器自动播放策略）；此前的调用会被忽略并返回 false。
 *  - 音量/静音持久化到 localStorage（hhfa-bgm-*）。
 *  - Node 环境没有 AudioContext：API 可用但全部为静默 no-op（测试友好）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Bgm = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var SCENES = {
    table: { root: 196.0, chord: [0, 7, 12, 16], wave: 'sine', lfo: 0.07, gain: 0.05 },
    dungeon: { root: 110.0, chord: [0, 3, 7, 10], wave: 'triangle', lfo: 0.05, gain: 0.06 },
    market: { root: 220.0, chord: [0, 4, 7, 11], wave: 'sine', lfo: 0.11, gain: 0.045 },
    garden: { root: 174.6, chord: [0, 5, 9, 12], wave: 'sine', lfo: 0.06, gain: 0.045 },
    night: { root: 146.8, chord: [0, 7, 10, 14], wave: 'triangle', lfo: 0.04, gain: 0.05 }
  };
  var VOLUME_KEY = 'hhfa-bgm-volume';
  var MUTE_KEY = 'hhfa-bgm-muted';

  function storageGet(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function storageSet(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  var volume = Number(storageGet(VOLUME_KEY));
  if (!(volume >= 0 && volume <= 1)) volume = 0.6;
  var muted = storageGet(MUTE_KEY) === '1';
  var ctx = null;
  var nodes = [];
  var timer = null;
  var current = null;

  function AudioCtor() {
    return root.AudioContext || root.webkitAudioContext || null;
  }

  function ensureCtx() {
    if (ctx) return ctx;
    var C = AudioCtor();
    if (!C) return null;
    try { ctx = new C(); } catch (e) { ctx = null; }
    return ctx;
  }

  function clearNodes() {
    nodes.forEach(function (n) {
      try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* ignore */ }
      try { n.disconnect && n.disconnect(); } catch (e) { /* ignore */ }
    });
    nodes = [];
    if (timer) { clearInterval(timer); timer = null; }
  }

  function scheduleScene(scene) {
    if (!ctx) return;
    var cfg = SCENES[scene] || SCENES.table;
    var now = ctx.currentTime;
    var master = ctx.createGain();
    master.gain.value = muted ? 0 : volume * cfg.gain;
    master.connect(ctx.destination);
    nodes.push(master);

    cfg.chord.forEach(function (semi, i) {
      var osc = ctx.createOscillator();
      osc.type = cfg.wave;
      osc.frequency.value = cfg.root * Math.pow(2, semi / 12);
      var g = ctx.createGain();
      g.gain.value = 0.33;
      var lfo = ctx.createOscillator();
      lfo.frequency.value = cfg.lfo * (1 + i * 0.13);
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.18;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      lfo.start(now);
      nodes.push(osc, lfo, g, lfoGain);
    });
  }

  function fadeMaster(to, seconds) {
    var master = nodes.filter(function (n) { return n.gain && n.context; })[0];
    if (!master || !ctx) return;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(to, ctx.currentTime + (seconds || 0.8));
    } catch (e) { /* ignore */ }
  }

  function play(scene) {
    var name = SCENES[scene] ? scene : 'table';
    if (!AudioCtor()) { current = name; return false; }
    if (!ensureCtx()) { current = name; return false; }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    clearNodes();
    current = name;
    scheduleScene(name);
    if (timer) clearInterval(timer);
    // Rebuild the chord每 12 秒，形成缓慢的呼吸而不是一条死板长音。
    timer = setInterval(function () {
      if (!ctx || !current) return;
      clearNodes();
      scheduleScene(current);
    }, 12000);
    return true;
  }

  function stop() {
    clearNodes();
    current = null;
    return true;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    storageSet(VOLUME_KEY, String(volume));
    return volume;
  }

  function mute(on) {
    muted = Boolean(on);
    storageSet(MUTE_KEY, muted ? '1' : '0');
    fadeMaster(muted ? 0 : volume * (SCENES[current] || SCENES.table).gain, 0.4);
    return muted;
  }

  function scenes() { return Object.keys(SCENES); }
  function isMuted() { return muted; }
  function currentScene() { return current; }
  function getVolume() { return volume; }

  return {
    play: play,
    stop: stop,
    setVolume: setVolume,
    getVolume: getVolume,
    mute: mute,
    isMuted: isMuted,
    current: currentScene,
    scenes: scenes,
    version: '1.0.0'
  };
});
