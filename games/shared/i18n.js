/* Shared language switcher for the games.

   Why this exists
   ---------------
   Every non-arcade game page used to hand-roll the same applyLang():

     - walk [data-i] nodes and overwrite textContent from a per-page table,
     - walk [data-i-ph] / [data-i-aria] nodes for placeholder / aria-label,
     - set aria-pressed on the `.langs button` row,
     - write document.documentElement.lang,
     - repeat that on every language button click.

   The copies had drifted (attribute names, button selectors, default
   language, storage key, extra render hooks), so this module keeps those
   variations as options instead of forcing one shape.

   Contract
   --------
   - `strings` is the page's existing { en: {...}, zh: {...}, id: {...} }
     table. Keys are passed through untouched; no renaming, no merging.
   - `defaultLang` is 'en' | 'zh' | 'id' | 'auto'. 'auto' matches
     navigator.language by prefix (zh*, id*, in* for legacy Indonesian) and
     falls back to 'zh' when navigator is unavailable. An unrecognised but
     readable language falls back to 'en', matching the pages' old code.
   - `storageKey` is the page's existing key. It is required for memory
     across loads; without it the module still works but forgets on reload.
     Store is used when available, otherwise localStorage directly; the
     module never throws.
   - `attrs` defaults to { text: 'data-i', ph: 'data-i-ph',
     aria: 'data-i-aria' } — the three names browser-check.js inspects.
   - `buttons` defaults to '.langs button'. Click handling is installed once
     by create(), so pages no longer bind the language row themselves.
   - `t(key, vars)` interpolates {name}; a key missing everywhere returns
     the key itself (never throws). When a translation is missing in the
     active language it falls back to en, then to the key.
   - `apply()` writes the active language to the DOM (html lang, text,
     placeholder, aria-label, button aria-pressed) and then tells every
     registered onLang listener. Nodes whose key is absent are left alone.
   - `setLang(lang)` stores the choice, calls apply() (and therefore the
     onLang listeners), and returns the resolved language. Unknown values
     are ignored so a buggy button cannot blank the page.
   - `onLang(fn)` subscribes and returns an unsubscribe function. Listener
     errors are swallowed: one page hook cannot break the switch.

   create() does not apply or notify by itself; call apply() once at init
   (where pages used to call applyLang()), exactly so the initial render
   sees a fully wired page.

   UMD: browsers read window.I18n, Node reads module.exports. One file, no
   dependencies, no network, no user data.
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.I18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var LANGS = { en: true, zh: true, id: true };
  var HTML_LANG = { zh: 'zh-CN' };

  function doc() {
    try { return root && root.document; } catch (e) { return null; }
  }

  function hasLang(lang) {
    return typeof lang === 'string' && LANGS.hasOwnProperty(lang);
  }

  // Accept the old Indonesian code ('in') and any casing; reject everything
  // else so a stored JSON blob or junk value cannot become the page language.
  function normalize(lang) {
    if (typeof lang !== 'string') return null;
    var l = lang.toLowerCase();
    if (l === 'in') return 'id';
    return hasLang(l) ? l : null;
  }

  function detect() {
    var navLang;
    try { navLang = root && root.navigator && root.navigator.language; } catch (e) { navLang = null; }
    if (typeof navLang !== 'string' || !navLang) return 'zh';
    var l = navLang.toLowerCase();
    if (l.indexOf('zh') === 0) return 'zh';
    if (l.indexOf('id') === 0 || l.indexOf('in') === 0) return 'id';
    return 'en';
  }

  // Looked up at call time (not at load time) so tests can inject Store or a
  // fake localStorage, and so a browser that throws on property access is
  // caught here. Store already has the try/catch discipline; the direct
  // fallback repeats it because localStorage can be denied in private mode.
  function storageGet(key) {
    if (!key) return null;
    try {
      var S = root && root.Store;
      if (S && typeof S.get === 'function') {
        var v = S.get(key, null);
        return v == null ? null : String(v);
      }
    } catch (e) { /* fall through to raw localStorage */ }
    try {
      var s = root && root.localStorage;
      if (!s || typeof s.getItem !== 'function') return null;
      var raw = s.getItem(key);
      return raw == null ? null : String(raw);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    if (!key) return false;
    try {
      var S = root && root.Store;
      if (S && typeof S.set === 'function') return S.set(key, value) === true;
    } catch (e) {
      return false;
    }
    try {
      var s = root && root.localStorage;
      if (!s || typeof s.setItem !== 'function') return false;
      s.setItem(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] != null ? String(vars[k]) : '';
    });
  }

  function create(opts) {
    opts = opts || {};

    var strings = (opts.strings && typeof opts.strings === 'object') ? opts.strings : {};
    var oa = opts.attrs || {};
    var attrs = {
      text: oa.text || 'data-i',
      ph: oa.ph || 'data-i-ph',
      aria: oa.aria || 'data-i-aria'
    };
    var buttonSelector = opts.buttons || '.langs button';
    var storageKey = typeof opts.storageKey === 'string' ? opts.storageKey : '';
    var listeners = [];

    var initial = storageKey ? normalize(storageGet(storageKey)) : null;
    if (!initial) {
      if (opts.defaultLang === 'auto') initial = detect();
      else initial = normalize(opts.defaultLang) || 'zh';
    }
    var current = initial;

    function dict(lang) {
      var d = strings[lang];
      return (d && typeof d === 'object') ? d : null;
    }

    // Used by t(): active language, then en, then the key itself.
    function lookup(key) {
      var d = dict(current);
      if (d && d[key] != null) return d[key];
      var en = dict('en');
      if (en && en[key] != null) return en[key];
      return null;
    }

    // Used by apply(): only the active language counts. A page that has not
    // translated a key keeps whatever the markup already said.
    function raw(key) {
      var d = dict(current);
      return (d && d[key] != null) ? d[key] : null;
    }

    function t(key, vars) {
      var v = lookup(key);
      if (typeof v !== 'string') return String(key);
      return interpolate(v, vars);
    }

    function query(selector) {
      var d = doc();
      if (!d || typeof d.querySelectorAll !== 'function') return [];
      try { return d.querySelectorAll(selector) || []; } catch (e) { return []; }
    }

    function attr(el, name) {
      try { return el && el.getAttribute ? el.getAttribute(name) : null; } catch (e) { return null; }
    }

    function setAttr(el, name, value) {
      try { if (el && el.setAttribute) el.setAttribute(name, value); } catch (e) { /* not fatal */ }
    }

    function setText(el, value) {
      try { if (el) el.textContent = value; } catch (e) { /* not fatal */ }
    }

    function notify() {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](current); } catch (e) { /* one bad hook is isolated */ }
      }
    }

    function apply() {
      var d = doc();
      try {
        if (d && d.documentElement) d.documentElement.lang = HTML_LANG[current] || current;
      } catch (e) { /* not fatal */ }

      var nodes = query('[' + attrs.text + ']');
      var i, k, v;
      for (i = 0; i < nodes.length; i++) {
        k = attr(nodes[i], attrs.text);
        if (k == null) continue;
        v = raw(k);
        if (v != null) setText(nodes[i], v);
      }

      nodes = query('[' + attrs.ph + ']');
      for (i = 0; i < nodes.length; i++) {
        k = attr(nodes[i], attrs.ph);
        if (k == null) continue;
        v = raw(k);
        if (v != null) setAttr(nodes[i], 'placeholder', v);
      }

      nodes = query('[' + attrs.aria + ']');
      for (i = 0; i < nodes.length; i++) {
        k = attr(nodes[i], attrs.aria);
        if (k == null) continue;
        v = raw(k);
        if (v != null) setAttr(nodes[i], 'aria-label', v);
      }

      nodes = query(buttonSelector);
      for (i = 0; i < nodes.length; i++) {
        setAttr(nodes[i], 'aria-pressed', attr(nodes[i], 'data-lang') === current ? 'true' : 'false');
      }

      notify();
    }

    function setLang(lang) {
      var next = normalize(lang);
      if (!next) return current;
      current = next;
      if (storageKey) storageSet(storageKey, current);
      apply();
      return current;
    }

    function onLang(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }

    if (typeof opts.onLang === 'function') listeners.push(opts.onLang);

    // Bind the language row once. Every migrated page used to duplicate this
    // loop; keeping it here is the point of the module.
    var buttons = query(buttonSelector);
    for (var b = 0; b < buttons.length; b++) {
      (function (btn) {
        try {
          if (btn && typeof btn.addEventListener === 'function') {
            btn.addEventListener('click', function () {
              setLang(attr(btn, 'data-lang'));
            });
          }
        } catch (e) { /* a detached button only loses its own click */ }
      })(buttons[b]);
    }

    return {
      t: t,
      setLang: setLang,
      lang: function () { return current; },
      apply: apply,
      onLang: onLang
    };
  }

  return { create: create };
});
