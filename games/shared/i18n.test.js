'use strict';

/*
 * Contract + failure-mode tests for games/shared/i18n.js.
 *
 * Run: node games/shared/i18n.test.js
 *
 * No browser is involved. Each group installs fake `document`, `navigator`,
 * `localStorage` and/or `Store` on globalThis, because the module resolves all
 * four at call time (the same trick the Store tests use).
 */

var lib = require('../tests/lib.js');
var I18n = require('./i18n.js');

var s = lib.suite('shared/i18n');

/* ------------------------------- fakes ------------------------------------ */

function element(tag, attrs) {
  return {
    tagName: tag,
    attrs: Object.assign({}, attrs || {}),
    textContent: '',
    listeners: {},
    getAttribute: function (k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    setAttribute: function (k, v) {
      this.attrs[k] = String(v);
    },
    addEventListener: function (type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    fire: function (type) {
      var list = this.listeners[type] || [];
      for (var i = 0; i < list.length; i++) list[i].call(this);
    }
  };
}

function fakeDocument(map) {
  return {
    documentElement: { lang: 'en' },
    querySelectorAll: function (sel) {
      return Object.prototype.hasOwnProperty.call(map, sel) ? map[sel] : [];
    }
  };
}

function memoryStorage(initial) {
  var map = Object.assign({}, initial || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    dump: function () { return map; }
  };
}

function withGlobal(name, value, fn) {
  var descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  try {
    Object.defineProperty(globalThis, name, {
      value: value,
      configurable: true,
      writable: true,
      enumerable: true
    });
  } catch (e) {
    globalThis[name] = value;
  }
  try {
    return fn();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else { try { delete globalThis[name]; } catch (e) { globalThis[name] = undefined; } }
  }
}

function withDocument(doc, fn) { return withGlobal('document', doc, fn); }
function withStorage(storage, fn) { return withGlobal('localStorage', storage, fn); }
function withStore(store, fn) { return withGlobal('Store', store, fn); }
function withNavigator(lang, fn) {
  return withGlobal('navigator', lang == null ? undefined : { language: lang }, fn);
}

// Every group starts from a storage that has never seen the key, so a test
// cannot pass because a previous group wrote to shared memory.
function cleanStorage() { return memoryStorage(); }

var STRINGS = {
  en: {
    greet: 'Hi {name}',
    count: '{n} of {total}',
    hello: 'Hello',
    search: 'Search…',
    board: 'Board',
    enOnly: 'EN only',
    plain: 'Plain'
  },
  zh: {
    greet: '你好 {name}',
    count: '{n}/{total}',
    hello: '你好',
    search: '搜索…',
    board: '棋盘',
    zhOnly: '只有中文',
    plain: '普通'
  },
  id: {
    greet: 'Halo {name}',
    count: '{n} dari {total}',
    hello: 'Halo',
    search: 'Cari…',
    board: 'Papan',
    plain: 'Biasa'
  }
};

/* --------------------------------- t() ------------------------------------ */

s.group('t：插值、缺变量、缺失 key、en 回退', function () {
  withStorage(cleanStorage(), function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 't-key' });

    s.eq('单变量插值', i.t('greet', { name: 'Ada' }), 'Hi Ada');
    s.eq('双变量插值', i.t('count', { n: 2, total: 5 }), '2 of 5');
    s.eq('无 vars 时保留花括号', i.t('greet'), 'Hi {name}');
    s.eq('缺变量替换为空串', i.t('count', { n: 2 }), '2 of ');
    s.eq('普通 key', i.t('plain'), 'Plain');
    s.eq('两表都缺失时返回 key', i.t('nope'), 'nope');
    s.eq('带 vars 的缺失 key 仍返回 key', i.t('nope', { x: 1 }), 'nope');

    i.setLang('zh');
    s.eq('切换后使用中文', i.t('hello'), '你好');
    s.eq('中文表缺失时回退 en', i.t('enOnly'), 'EN only');
    s.eq('中文表缺失且 en 也缺失时返回 key', i.t('ghost'), 'ghost');
  });
});

s.group('t：数字 0 / 空串变量不被当成缺失', function () {
  withStorage(cleanStorage(), function () {
    var i = I18n.create({
      strings: { en: { n: 'n={n}', e: 'e={v}' } },
      defaultLang: 'en',
      storageKey: 't-key-2'
    });
    s.eq('变量 0 正常渲染', i.t('n', { n: 0 }), 'n=0');
    s.eq('变量空串正常渲染', i.t('e', { v: '' }), 'e=');
  });
});

/* ------------------------------ auto 检测 --------------------------------- */

s.group('auto：navigator.language 前缀匹配', function () {
  withNavigator('zh-CN', function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'auto' });
    s.eq('zh-CN → zh', i.lang(), 'zh');
  });
  withNavigator('id-ID', function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'auto' });
    s.eq('id-ID → id', i.lang(), 'id');
  });
  withNavigator('in-ID', function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'auto' });
    s.eq('旧印尼代码 in-ID → id', i.lang(), 'id');
  });
  withNavigator('fr-FR', function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'auto' });
    s.eq('可读但未匹配 → en（与旧页面一致）', i.lang(), 'en');
  });
  withNavigator(null, function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'auto' });
    s.eq('navigator 不可用 → zh', i.lang(), 'zh');
  });
});

/* --------------------------- setLang / 持久化 ----------------------------- */

s.group('setLang：写 storage、apply、回调', function () {
  var storage = cleanStorage();
  var doc = fakeDocument({});

  withStorage(storage, function () {
    withDocument(doc, function () {
      var calls = [];
      var i = I18n.create({
        strings: STRINGS,
        defaultLang: 'en',
        storageKey: 'lang-key'
      });
      i.onLang(function (lang) { calls.push(lang); });

      s.eq('setLang 返回解析后的语言', i.setLang('zh'), 'zh');
      s.eq('storage 写入原 key', storage.dump()['lang-key'], 'zh');
      s.eq('html lang 用 zh-CN', doc.documentElement.lang, 'zh-CN');
      s.eq('回调收到新语言', calls, ['zh']);

      s.eq('切到 id', i.setLang('id'), 'id');
      s.eq('html lang 为 id', doc.documentElement.lang, 'id');
      s.eq('storage 跟随更新', storage.dump()['lang-key'], 'id');
      s.eq('回调再次触发', calls, ['zh', 'id']);

      s.eq('未知语言被忽略并返回当前语言', i.setLang('klingon'), 'id');
      s.eq('未知语言不写 storage', storage.dump()['lang-key'], 'id');
      s.eq('未知语言不触发回调', calls, ['zh', 'id']);

      s.eq('大写 ZH 被规范化为 zh', i.setLang('ZH'), 'zh');
      s.eq('旧代码 in 被规范化为 id', i.setLang('in'), 'id');

      i.apply();
      s.eq('apply 也触发回调', calls, ['zh', 'id', 'zh', 'id', 'id']);
    });
  });
});

s.group('setLang：storage 抛异常不影响切换', function () {
  var doc = fakeDocument({});
  var broken = {
    getItem: function () { throw new Error('SecurityError'); },
    setItem: function () { throw new Error('QuotaExceededError'); }
  };
  withStorage(broken, function () {
    withDocument(doc, function () {
      var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'broken' });
      s.eq('读取失败走 defaultLang', i.lang(), 'en');
      s.eq('写入失败仍切换', i.setLang('zh'), 'zh');
      s.eq('DOM 仍更新', doc.documentElement.lang, 'zh-CN');
    });
  });
});

/* ------------------------------ Store 优先 -------------------------------- */

s.group('storage：Store 可用时优先使用', function () {
  var readKeys = [], writePairs = [];
  var store = {
    get: function (k, fallback) {
      readKeys.push(k);
      return k === 'pref-key' ? 'zh' : fallback;
    },
    set: function (k, v) {
      writePairs.push([k, v]);
      return true;
    }
  };
  withStore(store, function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'pref-key' });
    s.eq('create 从 Store 读回已保存语言', i.lang(), 'zh');
    s.eq('读取使用原 key', readKeys, ['pref-key']);
    i.setLang('id');
    s.eq('setLang 通过 Store 写原 key', writePairs, [['pref-key', 'id']]);
  });
});

s.group('storage：Store 缺失时直写 localStorage', function () {
  var storage = cleanStorage();
  withStorage(storage, function () {
    withStore(undefined, function () {
      var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'raw-key' });
      i.setLang('zh');
      s.eq('直写 localStorage', storage.dump()['raw-key'], 'zh');
    });
  });
});

s.group('storage：已存值非语言时回退 defaultLang', function () {
  var storage = memoryStorage({ 'junk-key': '{"lang":"zh","level":2}' });
  withStorage(storage, function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'junk-key' });
    s.eq('JSON 预设置不被误读', i.lang(), 'en');
  });
  var upper = memoryStorage({ 'upper-key': 'ZH' });
  withStorage(upper, function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'upper-key' });
    s.eq('大小写不敏感', i.lang(), 'zh');
  });
});

/* --------------------------------- apply ---------------------------------- */

s.group('apply：只改存在的节点，缺失 key 保持原文', function () {
  var hello = element('span', { 'data-i': 'hello' });
  hello.textContent = 'OLD hello';
  var missing = element('span', { 'data-i': 'missing' });
  missing.textContent = 'KEEP ME';
  var search = element('input', { 'data-i-ph': 'search', placeholder: 'OLD ph' });
  var board = element('canvas', { 'data-i-aria': 'board', 'aria-label': 'OLD aria' });
  var enBtn = element('button', { 'data-lang': 'en' });
  var zhBtn = element('button', { 'data-lang': 'zh' });

  var doc = fakeDocument({
    '[data-i]': [hello, missing],
    '[data-i-ph]': [search],
    '[data-i-aria]': [board],
    '.langs button': [enBtn, zhBtn]
  });

  withStorage(cleanStorage(), function () {
    withDocument(doc, function () {
      var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'apply-key' });
      i.apply();

      s.eq('存在的文本节点被翻译', hello.textContent, 'Hello');
      s.eq('缺失 key 的节点保持原文', missing.textContent, 'KEEP ME');
      s.eq('placeholder 被翻译', search.attrs.placeholder, 'Search…');
      s.eq('aria-label 被翻译', board.attrs['aria-label'], 'Board');
      s.eq('html lang = en', doc.documentElement.lang, 'en');
      s.eq('en 按钮 aria-pressed', enBtn.attrs['aria-pressed'], 'true');
      s.eq('zh 按钮 aria-pressed', zhBtn.attrs['aria-pressed'], 'false');

      i.setLang('zh');
      s.eq('切换后文本更新', hello.textContent, '你好');
      s.eq('切换后缺失 key 仍保持', missing.textContent, 'KEEP ME');
      s.eq('切换后 placeholder 更新', search.attrs.placeholder, '搜索…');
      s.eq('切换后 aria-label 更新', board.attrs['aria-label'], '棋盘');
      s.eq('html lang = zh-CN', doc.documentElement.lang, 'zh-CN');
      s.eq('en 按钮不再按下', enBtn.attrs['aria-pressed'], 'false');
      s.eq('zh 按钮已按下', zhBtn.attrs['aria-pressed'], 'true');
    });
  });
});

s.group('apply：没有 document 时不抛异常', function () {
  withStorage(cleanStorage(), function () {
    withGlobal('document', undefined, function () {
      var i = I18n.create({ strings: STRINGS, defaultLang: 'zh', storageKey: 'nodoc' });
      i.apply();
      s.eq('lang() 仍可用', i.lang(), 'zh');
    });
  });
});

/* -------------------------------- onLang ---------------------------------- */

s.group('onLang：异常隔离与退订', function () {
  var doc = fakeDocument({});
  withStorage(cleanStorage(), function () {
    withDocument(doc, function () {
      var calls = [];
      var i = I18n.create({ strings: STRINGS, defaultLang: 'en', storageKey: 'cb-key' });
      var off = i.onLang(function (lang) { calls.push('first:' + lang); });
      i.onLang(function () { throw new Error('page hook broke'); });
      i.onLang(function (lang) { calls.push('last:' + lang); });

      i.setLang('zh');
      s.eq('抛异常的回调不影响其他回调', calls, ['first:zh', 'last:zh']);

      off();
      i.setLang('id');
      s.eq('退订后不再收到回调', calls, ['first:zh', 'last:zh', 'last:id']);
    });
  });
});

/* ------------------------------ 按钮点击 ---------------------------------- */

s.group('create：自动绑定语言按钮点击', function () {
  var storage = cleanStorage();
  var enBtn = element('button', { 'data-lang': 'en' });
  var zhBtn = element('button', { 'data-lang': 'zh' });
  var doc = fakeDocument({ '.langs button': [enBtn, zhBtn] });

  withStorage(storage, function () {
    withDocument(doc, function () {
      var called = [];
      var i = I18n.create({
        strings: STRINGS,
        defaultLang: 'en',
        storageKey: 'click-key',
        buttons: '.langs button'
      });
      i.onLang(function (lang) { called.push(lang); });

      zhBtn.fire('click');
      s.eq('点击中文按钮切换语言', i.lang(), 'zh');
      s.eq('点击写入 storage', storage.dump()['click-key'], 'zh');
      s.eq('点击触发回调', called, ['zh']);
      s.eq('点击更新 html lang', doc.documentElement.lang, 'zh-CN');

      enBtn.fire('click');
      s.eq('点击英文按钮切回', i.lang(), 'en');
      s.eq('切回后 storage 更新', storage.dump()['click-key'], 'en');
    });
  });
});

/* --------------------------- defaultLang 兜底 ------------------------------ */

s.group('defaultLang：合法值、非法值、缺失 strings', function () {
  s.eq('合法 id 直接使用', I18n.create({ strings: STRINGS, defaultLang: 'id' }).lang(), 'id');
  s.eq('非法值兜底 zh', I18n.create({ strings: STRINGS, defaultLang: 'fr' }).lang(), 'zh');
  s.eq('未提供 defaultLang 兜底 zh', I18n.create({ strings: STRINGS }).lang(), 'zh');
  s.eq('未提供 strings 时返回 key', I18n.create({ defaultLang: 'en' }).t('anything'), 'anything');
  s.eq('storageKey 省略也能切换', (function () {
    var i = I18n.create({ strings: STRINGS, defaultLang: 'en' });
    i.setLang('zh');
    return i.lang();
  })(), 'zh');
});

s.done();
