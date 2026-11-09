/* Arcade shared runtime — 新游戏共用的页面基建。
 *
 * 提供：三语切换（data-i / data-ph / data-aria）、安全 localStorage、最高分、
 * 键盘与滑动输入、rAF 循环、数字格式化。
 *
 * 约束：无外部依赖、不发网络请求、不读取任何用户数据。
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

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  return {
    init: init, t: t, apply: apply, setLang: setLang, onLang: onLang,
    lang: function () { return state.lang; }, LANG_KEY: LANG_KEY,
    storageGet: storageGet, storageSet: storageSet,
    best: best, setBest: setBest,
    onKeys: onKeys, onSwipe: onSwipe, KEYMAP: KEYMAP,
    loop: loop, fmt: fmt, clamp: clamp, randInt: randInt, ready: ready
  };
});
