/* Arcade shared runtime — 新游戏共用的页面基建。
 *
 * 提供：三语切换（data-i / data-ph / data-aria）、安全 localStorage、最高分、
 * 键盘与滑动输入、rAF 循环、数字格式化。
 *
 * 约束：无外部依赖、不读取任何用户数据。页面唯一的额外请求是本站共享的
 * /games/shared/sfx.js 与 /games/shared/arcade/music.js（音频层，由本文件
 * 自动加载；页面不需要再加 <script>，100 款 arcade 页面因此零改动接入）。
 *
 * 音频层（2026-11-11）：
 *   - 包装 ArcadeKit.create 得到的 CORE，从 act()/newGame() 的真实返回值
 *     （changed / gained / status）判断 move / capture / deal / win / lose /
 *     error，而不是"每次点击都响"。
 *   - 结算遮罩出现时，用页面自己的 I18N overlayWin/overlayLose 文案校验，
 *     作为 win/lose 的第二信号（反应类只信遮罩：其 status() 只表示结束）。
 *   - 首次用户手势之前不发声、不放 BGM（autoplay 安全）；toggle 按钮由
 *     sfx.js / music.js 自动接线，音量与静音各自持久化。
 *
 * 页面用法：
 *   <script src="/games/shared/arcade/arcade.js"></script>
 *   <script>
 *     Arcade.init({ strings: I18N, onLang: render });
 *   </script>
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Arcade = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var G = typeof globalThis !== 'undefined' ? globalThis : {};

  var LANG_KEY = 'arcade.lang';
  var LANGS = { en: 'en', zh: 'zh-CN', id: 'id' };
  var state = { lang: 'en', strings: {}, onLang: null, bound: false };
  var langListeners = [];

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }

  function storageGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, String(value)); return true; }
    catch (e) { return false; }
  }

  function detectLang() {
    var saved = storageGet(LANG_KEY, null);
    if (saved && LANGS[saved]) return saved;
    var nav = (typeof navigator !== 'undefined' && (navigator.language || '')) + '';
    if (/^zh/i.test(nav)) return 'zh';
    if (/^id/i.test(nav)) return 'id';
    return 'en';
  }

  function t(key, vars) {
    var d = state.strings[state.lang] || state.strings.en || {};
    var s = d[key] != null ? d[key] : (state.strings.en && state.strings.en[key] != null ? state.strings.en[key] : key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return s;
  }

  // 结算键名唯一规则：引擎状态 → 字典键。
  //   won / win  → overlayWin
  //   lost / lose → overlayLose
  //   其它（draw）→ overlayDraw
  // 页面统一用 I18N[Arcade.lang()][Arcade.overlayKey(status)] 取文案，
  // 不再自己拼 'status + Overlay' / 'overlay' + 状态。
  function overlayKey(status) {
    if (status === 'won' || status === 'win') return 'overlayWin';
    if (status === 'lost' || status === 'lose') return 'overlayLose';
    return 'overlayDraw';
  }

  function overlayText(status) {
    return t(overlayKey(status));
  }

  function apply() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = LANGS[state.lang] || 'en';
    each(document.querySelectorAll('[data-i]'), function (el) {
      el.textContent = t(el.getAttribute('data-i'));
    });
    each(document.querySelectorAll('[data-ph]'), function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-ph')));
    });
    each(document.querySelectorAll('[data-aria]'), function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-aria')));
    });
    each(document.querySelectorAll('[data-lang]'), function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === state.lang ? 'true' : 'false');
    });
  }

  function setLang(lang, silent) {
    if (!LANGS[lang]) lang = 'en';
    state.lang = lang;
    // 页面用 Arcade.init({ strings: I18N }) 传入的是同一个对象引用。
    // 把当前语言写回 strings.lang，页面里的 I18N[I18N.lang] 才能取到字典；
    // 语言切换复用同一入口，切完立即同步。
    if (state.strings && typeof state.strings === 'object') state.strings.lang = lang;
    storageSet(LANG_KEY, lang);
    apply();
    if (!silent) {
      each(langListeners, function (fn) { try { fn(lang); } catch (e) {} });
      if (state.onLang) { try { state.onLang(lang); } catch (e) {} }
    }
  }

  function init(opts) {
    opts = opts || {};
    state.strings = opts.strings || {};
    state.onLang = opts.onLang || null;
    if (!state.bound && typeof document !== 'undefined') {
      state.bound = true;
      each(document.querySelectorAll('[data-lang]'), function (btn) {
        btn.addEventListener('click', function () { setLang(this.getAttribute('data-lang')); });
      });
    }
    setLang(opts.lang || detectLang(), true);
    if (state.onLang) { try { state.onLang(state.lang); } catch (e) {} }
    return state.lang;
  }

  function onLang(fn) {
    langListeners.push(fn);
    return function () {
      var i = langListeners.indexOf(fn);
      if (i >= 0) langListeners.splice(i, 1);
    };
  }

  function best(key, fallback) {
    var n = parseInt(storageGet(key, fallback == null ? 0 : fallback), 10);
    return isFinite(n) ? n : (fallback || 0);
  }

  function setBest(key, value) {
    var cur = best(key, 0);
    if (value > cur) { storageSet(key, value); return true; }
    return false;
  }

  // map: {37:'left', 38:'up', 65:'left', ...}；handler(action, event)
  function onKeys(map, handler) {
    function key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      var action = map[e.keyCode] || map[e.key];
      if (!action) return;
      if (e.preventDefault) e.preventDefault();
      handler(action, e);
    }
    document.addEventListener('keydown', key);
    return function () { document.removeEventListener('keydown', key); };
  }

  var KEYMAP = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    65: 'left', 87: 'up', 68: 'right', 83: 'down',
    32: 'activate', 13: 'activate'
  };

  // 触屏滑动：阈值 24px；回调 (dir) ∈ left/right/up/down
  function onSwipe(el, handler, threshold) {
    var x0 = 0, y0 = 0, active = false;
    var min = threshold || 24;

    function start(e) {
      var p = e.touches ? e.touches[0] : e;
      x0 = p.clientX; y0 = p.clientY; active = true;
    }

    function move(e) {
      if (!active) return;
      var p = e.touches ? e.touches[0] : e;
      var dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
        if (e.cancelable) e.preventDefault();
      }
    }

    function end(e) {
      if (!active) return;
      active = false;
      var p = e.changedTouches ? e.changedTouches[0] : e;
      var dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return;
      handler(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    return function () {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
    };
  }

  function loop(fn) {
    var id = 0, last = 0, stopped = false;
    function tick(ts) {
      if (stopped) return;
      var dt = last ? Math.min(64, ts - last) : 16;
      last = ts;
      try { fn(dt, ts); } catch (e) { stopped = true; throw e; }
      id = requestAnimationFrame(tick);
    }
    id = requestAnimationFrame(tick);
    return function () { stopped = true; cancelAnimationFrame(id); };
  }

  function fmt(n) {
    var v = Math.round(Number(n) || 0);
    return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function randInt(rng, n) { return Math.floor((rng || Math.random)() * n); }

  /* ------------------------------------------------------------ audio layer */

  var SFX_SRC = '/games/shared/sfx.js';
  var MUSIC_SRC = '/games/shared/arcade/music.js';
  var audio = {
    ready: false, armed: false, family: 'numbers', kit: '',
    lastInputAt: 0, lastInputRepeat: false, lastByName: {},
    lastPlayed: ''
  };

  function audioNow() { return Date.now(); }

  function detectKit() {
    var kit = '';
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      var scripts = document.querySelectorAll('script[src*="/kits/"]');
      // Some pages load tick.js after the game kit; tick is the shared timer,
      // not the family, so take the first non-tick kit script.
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src || '';
        var m = /kits\/([a-z0-9-]+)\.js/.exec(src);
        if (m && m[1] !== 'tick') { kit = m[1]; break; }
      }
    }
    var family = 'numbers';
    if (kit === 'memory-pairs') family = 'memory';
    else if (kit === 'reaction') family = 'reaction';
    else if (kit === 'pong') family = 'pong';
    else if (kit === 'lights-out' || kit === 'minesweeper' || kit === 'tictactoe' ||
             kit === 'hanoi' || kit === 'snake') family = 'board';
    return { kit: kit, family: family };
  }

  function playSound(name, gap) {
    if (!audio.armed || !G.Sfx || typeof G.Sfx.play !== 'function') return false;
    var t = audioNow();
    gap = gap || 120;
    var last = audio.lastByName[name] || 0;
    if (t - last < gap) return false;
    audio.lastByName[name] = t;
    audio.lastPlayed = name;
    try { return G.Sfx.play(name); } catch (e) { return false; }
  }

  function musicAccent(kind) {
    if (!audio.armed || !G.Music || typeof G.Music.accent !== 'function') return;
    try { G.Music.accent(kind); } catch (e) {}
  }

  // Win/lose stings duck the BGM (-12 dB) so the verdict reads clearly.
  function musicDuck() {
    if (!audio.armed || !G.Music || typeof G.Music.duck !== 'function') return;
    try { G.Music.duck(); } catch (e) {}
  }

  function statusOf(core, st) {
    try { return core.status && st ? core.status(st) : null; } catch (e) { return null; }
  }

  function recentInput() {
    return audioNow() - audio.lastInputAt < 700;
  }

  function classify(core, kit, family, action, res, prevStatus) {
    if (!res || !res.state) return;
    var status = statusOf(core, res.state);

    // Reaction/aim/whack report status 'won' for any finished round; their
    // real win/lose verdict only exists in the overlay text, so let the
    // overlay observer decide instead of guessing here.
    if (family !== 'reaction') {
      if (status === 'won' && prevStatus !== 'won') {
        playSound('win', 900); musicDuck(); musicAccent('win'); return;
      }
      if (status === 'lost' && prevStatus !== 'lost') {
        playSound('lose', 900); musicDuck(); musicAccent('lose'); return;
      }
      if (status === 'draw' && prevStatus !== 'draw') {
        playSound('notify', 400); return;
      }
    }

    if (!res.changed) {
      if (action === 'tick' || action === 'hint') return;
      if (recentInput()) playSound('error', 300);
      return;
    }

    if (res.gained > 0) { playSound('capture', 130); return; }
    if (action === 'tick') return;

    if (kit === 'minesweeper' && action && action.type === 'flag') {
      playSound('notify', 250); return;
    }
    if (family === 'memory') { playSound('deal', 160); return; }
    if (family === 'pong') {
      // A held arrow key repeats; keep the paddle quiet instead of buzzing.
      if (!audio.lastInputRepeat) playSound('move', 180);
      return;
    }
    if (family === 'reaction') {
      if (action === 'miss') playSound('error', 300);
      return;
    }
    playSound('move', 110);
  }

  function wrapCore(core, kit, family) {
    if (!core || core.__arcadeAudioWrapped) return core;
    var origAct = core.act;
    var origNew = core.newGame;
    if (typeof origAct === 'function') {
      core.act = function (st, action) {
        var prev = statusOf(core, st);
        var res = origAct.apply(core, arguments);
        try { classify(core, kit, family, action, res, prev); } catch (e) {}
        return res;
      };
    }
    if (typeof origNew === 'function') {
      core.newGame = function () {
        var st = origNew.apply(core, arguments);
        if (audio.armed) playSound('deal', 400);
        return st;
      };
    }
    core.__arcadeAudioWrapped = true;
    return core;
  }

  // Kit modules assign root.ArcadeKit = api. Define an accessor before the kit
  // script runs so create() can be wrapped without touching any page. If a
  // harness already installed its own accessor (arcade/tests/terminal-cli.mjs
  // does), chain to it instead of replacing it — both wrappers must run.
  function ensureKitWrapped(mod) {
    if (!mod || typeof mod.create !== 'function' || mod.__arcadeAudioWrappedCreate) return mod;
    var origCreate = mod.create;
    mod.create = function () {
      var core = origCreate.apply(mod, arguments);
      var found = detectKit();
      audio.kit = found.kit;
      audio.family = found.family;
      return wrapCore(core, found.kit, found.family);
    };
    mod.__arcadeAudioWrappedCreate = true;
    return mod;
  }

  function installKitHook() {
    if (typeof document === 'undefined' || !G || G.__arcadeKitHooked) return;
    try {
      var desc = Object.getOwnPropertyDescriptor(G, 'ArcadeKit');
      var baseGet = desc && desc.get ? desc.get : null;
      var baseSet = desc && desc.set ? desc.set : null;
      var value = desc && !desc.get && !desc.set ? desc.value : undefined;

      function read() {
        if (baseGet) { try { return baseGet.call(G); } catch (e) { return value; } }
        return value;
      }

      Object.defineProperty(G, 'ArcadeKit', {
        configurable: true,
        enumerable: true,
        get: function () { return ensureKitWrapped(read()); },
        set: function (mod) {
          if (baseSet) {
            try { baseSet.call(G, mod); } catch (e) { value = mod; }
          } else {
            value = mod;
          }
          ensureKitWrapped(read());
        }
      });
      G.__arcadeKitHooked = true;
    } catch (e) {
      // Accessor unsupported: the game still works, only audio semantics degrade.
    }
  }

  function overlayVerdict(text) {
    var dict = G.I18N;
    if (!dict || typeof dict !== 'object') return null;
    for (var lang in dict) {
      var d = dict[lang];
      if (!d || typeof d !== 'object') continue;
      if (d.overlayWin && text === d.overlayWin) return 'win';
      if (d.overlayLose && text === d.overlayLose) return 'lose';
      if (d.overlayDraw && text === d.overlayDraw) return 'draw';
    }
    return null;
  }

  function watchOverlay() {
    if (typeof MutationObserver === 'undefined' || !document.getElementById) return;
    var ov = document.getElementById('overlay');
    if (!ov || ov.__arcadeAudioWatched) return;
    ov.__arcadeAudioWatched = true;
    var wasHidden = !!ov.hidden;
    var title = document.getElementById('overlay-title');
    function check() {
      if (wasHidden && !ov.hidden) {
        var verdict = overlayVerdict(title ? title.textContent : '');
        if (verdict === 'win') { playSound('win', 900); musicDuck(); musicAccent('win'); }
        else if (verdict === 'lose') { playSound('lose', 900); musicDuck(); musicAccent('lose'); }
        else if (verdict === 'draw') { playSound('notify', 400); }
      }
      wasHidden = !!ov.hidden;
    }
    var mo = new MutationObserver(check);
    mo.observe(ov, {
      attributes: true, attributeFilter: ['hidden'],
      childList: true, subtree: true, characterData: true
    });
    if (title) mo.observe(title, { childList: true, characterData: true, subtree: true });
  }

  function injectAudioStyle() {
    if (!document.getElementById) return;
    if (document.getElementById('arcade-audio-style')) return;
    var style = document.createElement('style');
    style.id = 'arcade-audio-style';
    style.textContent =
      '.audio-toggles{display:flex;align-items:center;gap:6px;margin-left:auto;flex:none}' +
      '@media (max-width:390px){.audio-toggles{order:0}}';
    (document.head || document.documentElement).appendChild(style);
  }

  function injectToggles() {
    if (!document.createElement || !document.querySelector) return;
    if (document.querySelector('.audio-toggles')) return;
    injectAudioStyle();
    var box = document.createElement('div');
    box.className = 'audio-toggles';
    var sfxBtn = document.createElement('button');
    sfxBtn.type = 'button';
    sfxBtn.className = 'sfx-toggle';
    sfxBtn.hidden = true;
    sfxBtn.setAttribute('aria-label', '静音 / Mute');
    var musicBtn = document.createElement('button');
    musicBtn.type = 'button';
    musicBtn.className = 'music-toggle';
    musicBtn.hidden = true;
    musicBtn.setAttribute('aria-label', '关闭音乐 / Mute music');
    box.appendChild(sfxBtn);
    box.appendChild(musicBtn);
    var top = document.querySelector('.game-top');
    if (top) top.appendChild(box);
    else {
      var header = document.querySelector('.header-inner');
      if (header) header.appendChild(box);
    }
    if (G.Sfx && G.Sfx.syncButtons) { try { G.Sfx.syncButtons(); } catch (e) {} }
    if (G.Music && G.Music.syncButtons) { try { G.Music.syncButtons(); } catch (e) {} }
  }

  // A toggle only appears once its audio script has loaded; a failed request
  // leaves no bare, unstyled button in the score row.
  function revealToggle(sel) {
    if (!document.querySelector) return;
    var btn = document.querySelector(sel);
    if (btn) btn.hidden = false;
  }

  function loadScript(src, onload) {
    if (typeof document === 'undefined' || !document.createElement) return;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function () { try { if (onload) onload(); } catch (e) {} };
    (document.head || document.documentElement).appendChild(s);
  }

  function armAudio() {
    if (audio.armed) return;
    audio.armed = true;
    var found = detectKit();
    if (found.kit) { audio.kit = found.kit; audio.family = found.family; }
    if (G.Music && !G.Music.isMuted()) {
      try { G.Music.start(audio.family); } catch (e) {}
    }
  }

  function onGesture(e) {
    audio.lastInputAt = audioNow();
    audio.lastInputRepeat = !!(e && e.repeat);
    armAudio();
  }

  function onButtonClick(e) {
    var t = e && e.target;
    if (!t) return;
    var el = t.closest ? t.closest('button, a, [role="button"]') : null;
    if (!el) return;
    if (el.classList && (el.classList.contains('sfx-toggle') || el.classList.contains('music-toggle'))) {
      if (el.classList.contains('music-toggle')) {
        // The toggle's own handler runs on the target first; if it unmuted,
        // a never-started page still needs start() inside this gesture.
        audio.lastInputAt = audioNow();
        if (G.Music && !G.Music.isMuted()) {
          try { G.Music.start(audio.family); } catch (err) {}
        }
      }
      return;
    }
    if (el.closest && (el.closest('#board') || el.closest('#overlay'))) return;
    var id = el.id || '';
    var key = el.getAttribute ? (el.getAttribute('data-i') || '') : '';
    if (id === 'btn-hint' || key === 'hint') { playSound('notify', 300); return; }
    if (id === 'btn-new' || id === 'btn-overlay' || key === 'newGame' || key === 'playAgain') {
      playSound('deal', 400); return;
    }
    playSound('click', 90);
  }

  function installAudio() {
    if (typeof document === 'undefined') return;
    if (audio.ready) return;
    audio.ready = true;
    installKitHook();
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    document.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    document.addEventListener('click', onGesture, true);
    // Bubble phase: the toggle's own handler (sfx.js / music.js, bound on the
    // button) has already flipped the state by the time this runs.
    document.addEventListener('click', onButtonClick, false);
    loadScript(SFX_SRC, function () {
      injectToggles();
      if (G.Sfx && G.Sfx.syncButtons) { try { G.Sfx.syncButtons(); } catch (e) {} }
      revealToggle('.sfx-toggle');
    });
    loadScript(MUSIC_SRC, function () {
      injectToggles();
      if (G.Music && G.Music.syncButtons) { try { G.Music.syncButtons(); } catch (e) {} }
      revealToggle('.music-toggle');
      if (audio.armed && G.Music && !G.Music.isMuted()) {
        try { G.Music.start(audio.family); } catch (e) {}
      }
    });
    ready(function () {
      injectToggles();
      watchOverlay();
    });
  }

  installAudio();

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // URL boot params: one canonical page absorbs size/speed variants
  // (e.g. /games/tictactoe/?n=8) instead of shipping one directory per value.
  var queryCache = null;
  function params() {
    if (queryCache) return queryCache;
    queryCache = {};
    var search = (typeof location !== 'undefined' && location.search) || '';
    search.replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      var key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
      var value = eq < 0 ? '1' : decodeURIComponent(pair.slice(eq + 1));
      if (key) queryCache[key] = value;
    });
    return queryCache;
  }
  function paramNumber(name, fallback, min, max) {
    var value = Number(params()[name]);
    if (!isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
  }
  function paramFlag(name) {
    var value = String(params()[name] || '').toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  return {
    init: init, t: t, apply: apply, setLang: setLang, onLang: onLang,
    lang: function () { return state.lang; }, LANG_KEY: LANG_KEY,
    overlayKey: overlayKey, overlayText: overlayText,
    storageGet: storageGet, storageSet: storageSet,
    best: best, setBest: setBest,
    onKeys: onKeys, onSwipe: onSwipe, KEYMAP: KEYMAP,
    loop: loop, fmt: fmt, clamp: clamp, randInt: randInt, ready: ready,
    params: params, paramNumber: paramNumber, paramFlag: paramFlag,
    audioStats: function () {
      return {
        armed: audio.armed,
        family: audio.family,
        kit: audio.kit,
        lastPlayed: audio.lastPlayed,
        sfx: G.Sfx && typeof G.Sfx.stats === 'function' ? G.Sfx.stats() : null,
        music: G.Music && typeof G.Music.stats === 'function' ? G.Music.stats() : null
      };
    }
  };
});
