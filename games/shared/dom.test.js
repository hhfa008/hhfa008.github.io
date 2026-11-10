#!/usr/bin/env node
'use strict';

// Unit tests for games/shared/dom.js. Runs in Node with a tiny fake DOM, so no
// browser or jsdom dependency is needed. Output follows the other shared
// suites: a `RESULT: N passed, M failed` line that run-all.js can parse.

var Dom = require('./dom.js');

var passed = 0;
var failed = 0;
var failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    return;
  }
  failed++;
  failures.push(name + (detail == null ? '' : ' — ' + detail));
}

function describe(value) {
  if (value === null) return 'null';
  if (typeof value === 'object') return '[object ' + (value.tagName || 'Object') + ']';
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}

function eq(name, actual, expected) {
  var same = Object.is(actual, expected);
  ok(name, same, same ? '' : 'expected ' + describe(expected) + ', got ' + describe(actual));
}

function throwsCheck(name, fn) {
  try {
    fn();
    ok(name, true);
  } catch (e) {
    ok(name, false, 'threw: ' + (e && e.message));
  }
}

// --- fake DOM -------------------------------------------------------------

function FakeNode(tag, ns) {
  this.tagName = tag;
  this.namespaceURI = ns || null;
  this.attributes = {};
  this.children = [];
  this.parentNode = null;
  this.textContent = '';
  this.className = '';
  this.removed = false;
}

FakeNode.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
};

FakeNode.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name)
    ? this.attributes[name]
    : null;
};

FakeNode.prototype.appendChild = function (node) {
  node.parentNode = this;
  this.children.push(node);
  return node;
};

FakeNode.prototype.removeChild = function (node) {
  var i = this.children.indexOf(node);
  if (i >= 0) this.children.splice(i, 1);
  node.parentNode = null;
  return node;
};

FakeNode.prototype.remove = function () {
  this.removed = true;
  if (this.parentNode) this.parentNode.removeChild(this);
};

function fakeDocument() {
  var body = new FakeNode('body');
  var doc = {
    body: body,
    index: {},
    createElement: function (tag) { return new FakeNode(tag, null); },
    createElementNS: function (ns, tag) { return new FakeNode(tag, ns); },
    querySelector: function (selector) {
      return Object.prototype.hasOwnProperty.call(doc.index, selector)
        ? doc.index[selector]
        : null;
    }
  };
  return doc;
}

var ORIGINAL_DOCUMENT = globalThis.document;
var ORIGINAL_SET_TIMEOUT = globalThis.setTimeout;
var ORIGINAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

function withDocument(doc, fn) {
  globalThis.document = doc;
  try {
    fn();
  } finally {
    globalThis.document = ORIGINAL_DOCUMENT;
  }
}

function withoutDocument(fn) {
  delete globalThis.document;
  try {
    fn();
  } finally {
    if (ORIGINAL_DOCUMENT === undefined) delete globalThis.document;
    else globalThis.document = ORIGINAL_DOCUMENT;
  }
}

// Capture the timer callback instead of waiting for real time to pass.
function withFakeTimers(fn) {
  var calls = [];
  globalThis.setTimeout = function (cb, ms) {
    calls.push({ cb: cb, ms: ms });
    return 'timer-' + calls.length;
  };
  globalThis.clearTimeout = function () {};
  try {
    fn(calls);
  } finally {
    globalThis.setTimeout = ORIGINAL_SET_TIMEOUT;
    globalThis.clearTimeout = ORIGINAL_CLEAR_TIMEOUT;
  }
}

// --- module shape ---------------------------------------------------------

eq('exports format', typeof Dom.format, 'function');
eq('exports el', typeof Dom.el, 'function');
eq('exports toast', typeof Dom.toast, 'function');
eq('UMD global Dom', globalThis.Dom, Dom);

// --- format ---------------------------------------------------------------

eq('replaces one placeholder', Dom.format('你好 {name}', { name: 'Devin' }), '你好 Devin');
eq('replaces several placeholders',
  Dom.format('{a}-{b}-{c}', { a: 1, b: 2, c: 3 }), '1-2-3');
eq('replaces repeated placeholder',
  Dom.format('{x} + {x}', { x: 'y' }), 'y + y');
eq('missing key becomes empty', Dom.format('a{b}c', { a: 1 }), 'ac');
eq('null value becomes empty', Dom.format('a{b}c', { b: null }), 'ac');
eq('undefined value becomes empty', Dom.format('a{b}c', { b: undefined }), 'ac');
eq('zero is kept', Dom.format('{n}', { n: 0 }), '0');
eq('false is kept', Dom.format('{n}', { n: false }), 'false');
eq('unmatched brace stays', Dom.format('a{b', { b: 'x' }), 'a{b');
eq('no vars leaves template unchanged', Dom.format('a{b}c'), 'a{b}c');
eq('null vars leaves template unchanged', Dom.format('a{b}c', null), 'a{b}c');
eq('number template is coerced', Dom.format(42, {}), '42');
eq('null template becomes empty', Dom.format(null, {}), '');

(function () {
  var throwing = {};
  Object.defineProperty(throwing, 'b', {
    enumerable: true,
    get: function () { throw new Error('boom'); }
  });
  eq('throwing getter becomes empty', Dom.format('a{b}c', throwing), 'ac');
})();

eq('$ in value is literal', Dom.format('{v}', { v: '$& $1' }), '$& $1');
throwsCheck('format never throws on odd input', function () {
  Dom.format(undefined, { a: 1 });
  Dom.format({ toString: function () { throw new Error('no'); } }, { a: 1 });
});

// --- el -------------------------------------------------------------------

withDocument(fakeDocument(), function () {
  var doc = globalThis.document;

  var a = Dom.el('div', { id: 'x', title: 'hi' });
  eq('el tag', a.tagName, 'div');
  eq('el attribute', a.getAttribute('id'), 'x');
  eq('el second attribute', a.getAttribute('title'), 'hi');

  var b = Dom.el('span', { className: 'card active' });
  eq('el className on HTML', b.className, 'card active');

  var c = Dom.el('p', { text: 'hello' });
  eq('el text', c.textContent, 'hello');

  var d = Dom.el('button', { 'aria-label': '关闭', 'aria-pressed': 'false' });
  eq('el aria-label', d.getAttribute('aria-label'), '关闭');
  eq('el aria-pressed', d.getAttribute('aria-pressed'), 'false');

  var e = Dom.el('circle', { cx: 10, cy: 20 }, { ns: 'http://www.w3.org/2000/svg' });
  eq('el SVG namespace', e.namespaceURI, 'http://www.w3.org/2000/svg');
  eq('el SVG tag', e.tagName, 'circle');
  eq('el SVG numeric attribute is stringified', e.getAttribute('cx'), '10');
  eq('el SVG second attribute', e.getAttribute('cy'), '20');

  var f = Dom.el('rect', { className: 'tray' }, { ns: 'http://www.w3.org/2000/svg' });
  eq('el SVG className uses class attribute', f.getAttribute('class'), 'tray');

  var g = Dom.el('i', { text: 'attrs' }, { text: 'opts' });
  eq('el opts.text wins', g.textContent, 'opts');

  var h = Dom.el('div');
  eq('el with no attrs has no attributes', Object.keys(h.attributes).length, 0);
  throwsCheck('el handles null attrs', function () {
    Dom.el('div', null);
    Dom.el('div', undefined);
  });

  var throwingDoc = {
    createElement: function () { throw new Error('nope'); }
  };
  globalThis.document = throwingDoc;
  eq('el returns null when createElement throws', Dom.el('div'), null);
  globalThis.document = doc;
});

withoutDocument(function () {
  eq('el returns null without document', Dom.el('div', { id: 'x' }), null);
});

// --- toast ----------------------------------------------------------------

withDocument(fakeDocument(), function () {
  var doc = globalThis.document;

  withFakeTimers(function (calls) {
    var node = Dom.toast('已保存');
    eq('toast returns node', node.tagName, 'div');
    eq('toast className', node.className, 'toast');
    eq('toast text', node.textContent, '已保存');
    eq('toast mounts on body', doc.body.children.length, 1);
    eq('toast mounted node', doc.body.children[0], node);
    eq('toast default duration', calls.length === 1 ? calls[0].ms : null, 2200);
    eq('toast no role by default', node.getAttribute('role'), null);
    calls[0].cb();
    eq('toast removed after timer', node.removed, true);
    eq('toast unmounted after timer', doc.body.children.length, 0);
  });

  withFakeTimers(function (calls) {
    Dom.toast('later', { duration: 1500 });
    eq('toast custom duration', calls[0].ms, 1500);
    calls[0].cb();
  });

  withFakeTimers(function (calls) {
    Dom.toast('ms alias', { ms: 900 });
    eq('toast ms alias', calls[0].ms, 900);
    calls[0].cb();
  });

  withFakeTimers(function (calls) {
    var node = Dom.toast('提示', { role: 'status', ariaLive: 'polite' });
    eq('toast role', node.getAttribute('role'), 'status');
    eq('toast aria-live', node.getAttribute('aria-live'), 'polite');
    calls[0].cb();
  });

  withFakeTimers(function (calls) {
    var mount = Dom.el('section', { id: 'toast-layer' });
    var node = Dom.toast('自定义挂载', { mount: mount, className: 'toast big' });
    eq('toast custom mount', mount.children[0], node);
    eq('toast custom class', node.className, 'toast big');
    eq('toast not on body when mounted elsewhere', doc.body.children.length, 0);
    calls[0].cb();
  });

  withFakeTimers(function (calls) {
    var mount = Dom.el('aside', { id: 'layer' });
    doc.index['#layer'] = mount;
    var node = Dom.toast('selector mount', { mount: '#layer' });
    eq('toast selector mount', mount.children[0], node);
    calls[0].cb();
  });

  withFakeTimers(function (calls) {
    var node = Dom.toast(0);
    eq('toast coerces text', node.textContent, '0');
    eq('toast schedules even for empty-ish text', calls.length, 1);
    calls[0].cb();
  });

  withFakeTimers(function (calls) {
    var node = Dom.toast('bad mount', { mount: { appendChild: null } });
    eq('toast returns null on bad mount', node, null);
    eq('toast does not schedule on bad mount', calls.length, 0);
  });
});

withoutDocument(function () {
  eq('toast returns null without document', Dom.toast('x'), null);
});

// --- report ---------------------------------------------------------------

if (failures.length) {
  failures.forEach(function (f) { console.error('FAIL ' + f); });
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(1);
}
console.log('RESULT: ' + passed + ' passed, 0 failed');
