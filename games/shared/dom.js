/* Shared DOM helpers for the games.

   Why this exists
   ---------------
   Several game pages hand-rolled the same three helpers:

     - fmt(s, map) / fillText(s, map): replace every {name} with map[name],
       and an absent/null value with ''.
     - el(name, attrs[, text]): create an SVG element in the page's NS
       namespace and copy attrs through setAttribute.
     - toast(msg): append <div class="toast"> to <body> and remove it after
       2200 ms.

   This module is the one copy of those bodies. Pages keep their old helper
   names and signatures as thin adapters, so call sites do not change and a
   page whose helper behaves differently keeps its own implementation (do not
   force a shared shape on it).

   Contract
   --------
   - format(template, vars) mirrors the old fmt(s, map): /\{(\w+)\}/g, a missing
     or null value becomes ''. When `vars` is omitted the template is returned
     unchanged (no placeholder stripping). Non-string templates are coerced;
     nothing throws.
   - el(tag, attrs, opts) creates an HTML element by default, or an SVG
     element when opts.ns is set. attrs keys are applied in this order:
       - text        -> textContent
       - className   -> className for HTML, setAttribute('class') for SVG
       - aria-*      -> setAttribute, like every other attribute
       - anything else -> setAttribute(name, value)
     opts.text sets textContent after attrs and wins over attrs.text. When
     there is no document (Node, a denied frame) el returns null instead of
     throwing.
   - toast(text, opts) creates <div class="toast">, sets its text, appends it
     to opts.mount (element or selector; default document.body) and removes it
     after opts.duration / opts.ms milliseconds (default 2200). opts.className
     replaces 'toast'; opts.role (e.g. 'status') and opts.ariaLive are written
     as attributes only when given, so the default DOM matches the old inline
     toasts byte for byte. It returns the node, or null when no document /
     mount exists. Nothing throws.

   UMD: browsers read window.Dom, Node reads module.exports. One file, no
   dependencies, no network, no user data.

   Migrated callers (verbatim helper bodies before this module):
     games/connect4, banqi, draughts, backgammon, aeroplane, checkers-jump
       (fmt(s, map) / fillText(s, map) / el(name, attrs))
     games/gomoku, reversi, go9 (fillText(s, map))
     games/boardgame/{checkers-jump,draughts,xiangqi}-premium
       (el(name, attrs, text) / toast(msg))
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Dom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Looked up at call time (not at load time) so tests can inject a fake DOM
  // and a browser that throws on document access is caught here.
  function doc() {
    try { return root && root.document; } catch (e) { return null; }
  }

  function format(template, vars) {
    if (template == null) return '';
    if (typeof template !== 'string') {
      try { template = String(template); } catch (e) { return ''; }
    }
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (m, k) {
      var v;
      try { v = vars[k]; } catch (e) { return ''; }
      return v != null ? v : '';
    });
  }

  function setAttr(node, name, value) {
    try {
      if (name === 'text') {
        node.textContent = value;
        return;
      }
      if (name === 'className' && typeof node.setAttribute !== 'function') {
        node.className = value;
        return;
      }
      if (name === 'className') {
        // SVG elements expose a read-only SVGAnimatedString className.
        if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
          node.setAttribute('class', value);
        } else {
          node.className = value;
        }
        return;
      }
      if (typeof node.setAttribute === 'function') node.setAttribute(name, value);
    } catch (e) { /* one bad attribute must not abort the element */ }
  }

  function el(tag, attrs, opts) {
    opts = opts || {};
    var d = doc();
    if (!d) return null;
    var node;
    try {
      if (opts.ns) {
        if (typeof d.createElementNS !== 'function') return null;
        node = d.createElementNS(opts.ns, String(tag));
      } else {
        if (typeof d.createElement !== 'function') return null;
        node = d.createElement(String(tag));
      }
    } catch (e) {
      return null;
    }
    if (!node) return null;

    if (attrs && typeof attrs === 'object') {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var value;
        try { value = attrs[k]; } catch (e) { continue; }
        setAttr(node, k, value);
      }
    }
    if (opts.text != null) {
      try { node.textContent = opts.text; } catch (e) { /* not fatal */ }
    }
    return node;
  }

  function timerApi(name) {
    var fn = null;
    try { fn = root && root[name]; } catch (e) { fn = null; }
    if (typeof fn !== 'function') {
      try {
        var g = typeof globalThis !== 'undefined' ? globalThis : null;
        fn = g && g[name];
      } catch (e2) { fn = null; }
    }
    return typeof fn === 'function' ? fn : null;
  }

  function schedule(fn, ms) {
    var set = timerApi('setTimeout');
    if (!set) return null;
    try { return set(fn, ms); } catch (e) { return null; }
  }

  function cancel(handle) {
    var clear = timerApi('clearTimeout');
    if (!clear) return;
    try { clear(handle); } catch (e) { /* not fatal */ }
  }

  function toast(text, opts) {
    opts = opts || {};
    var d = doc();
    if (!d) return null;

    var node = el('div', { className: opts.className || 'toast' });
    if (!node) return null;
    try { node.textContent = text == null ? '' : String(text); } catch (e) { /* not fatal */ }
    if (opts.role) setAttr(node, 'role', opts.role);
    if (opts.ariaLive) setAttr(node, 'aria-live', opts.ariaLive);

    var mount = opts.mount;
    if (typeof mount === 'string') {
      try { mount = d.querySelector ? d.querySelector(mount) : null; } catch (e) { mount = null; }
    }
    if (!mount) {
      try { mount = d.body; } catch (e) { mount = null; }
    }
    if (!mount || typeof mount.appendChild !== 'function') return null;
    try { mount.appendChild(node); } catch (e) { return null; }

    var ms = opts.duration != null ? opts.duration : (opts.ms != null ? opts.ms : 2200);
    var removed = false;
    var handle = null;
    function remove() {
      if (removed) return;
      removed = true;
      if (handle != null) cancel(handle);
      try {
        if (typeof node.remove === 'function') node.remove();
        else if (node.parentNode && typeof node.parentNode.removeChild === 'function') node.parentNode.removeChild(node);
      } catch (e) { /* detached node is already gone */ }
    }
    handle = schedule(remove, ms);
    return node;
  }

  return {
    format: format,
    el: el,
    toast: toast
  };
});
