'use strict';

/*
 * Contract + failure-mode tests for games/shared/store.js.
 *
 * Run: node games/shared/store.test.js
 *
 * No real localStorage is involved. Each group installs an in-memory (or
 * deliberately broken) storage on globalThis, because the module resolves
 * localStorage at call time.
 */

var lib = require('../tests/lib.js');
var Store = require('./store.js');

var s = lib.suite('shared/store');

/* ------------------------------- test harness ------------------------------ */

function memory(opts) {
  opts = opts || {};
  var map = Object.create(null);
  return {
    getItem: function (k) {
      if (opts.throwGet) throw new Error('SecurityError: storage denied');
      return k in map ? map[k] : null;
    },
    setItem: function (k, v) {
      if (opts.throwSet) throw new Error('QuotaExceededError: storage full');
      map[k] = String(v);
    },
    dump: function () { return map; }
  };
}

function withStorage(storage, fn) {
  var had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  var prev;
  try { prev = globalThis.localStorage; } catch (e) { prev = undefined; }
  globalThis.localStorage = storage;
  try {
    return fn();
  } finally {
    if (had) globalThis.localStorage = prev;
    else { try { delete globalThis.localStorage; } catch (e) { globalThis.localStorage = prev; } }
  }
}

/* -------------------------------- plain get/set ---------------------------- */

s.group('get / set：字符串读写与 key 原样透传', function () {
  withStorage(memory(), function () {
    s.eq('缺失 key 返回 fallback', Store.get('missing', 'fb'), 'fb');
    s.eq('缺失 key 且无 fallback 返回 undefined', Store.get('missing'), undefined);
    s.ok('set 成功返回 true', Store.set('g24-best-streak-v1', '5') === true);
    s.eq('get 读回原值', Store.get('g24-best-streak-v1'), '5');

    Store.set('num', 42);
    s.eq('数字被 String 化', Store.get('num'), '42');
    Store.set('empty', '');
    s.eq('空字符串原样保存', Store.get('empty'), '');

    var dump = globalThis.localStorage.dump();
    s.eq('key 不加前缀、不改名', Object.keys(dump).sort(),
      ['empty', 'g24-best-streak-v1', 'num']);
  });
});

/* ---------------------------------- JSON ---------------------------------- */

s.group('getJSON / setJSON', function () {
  withStorage(memory(), function () {
    var obj = { w: 3, best: { draw1: 12 }, tags: ['a', 'b'] };
    s.ok('setJSON 成功返回 true', Store.setJSON('stats', obj) === true);
    s.eq('对象往返一致', Store.getJSON('stats', null), obj);
    s.eq('缺失 key 返回 fallback', Store.getJSON('nope', { x: 1 }), { x: 1 });

    Store.setJSON('zero', 0);
    s.eq('0 不被当成缺失', Store.getJSON('zero', 9), 0);
    Store.setJSON('false', false);
    s.eq('false 不被当成缺失', Store.getJSON('false', true), false);
    Store.setJSON('nil', null);
    s.eq('null 往返为 null（不是 fallback）', Store.getJSON('nil', 'fb'), null);

    globalThis.localStorage.setItem('bad', '{oops');
    s.eq('非法 JSON 回退 fallback', Store.getJSON('bad', 'fb'), 'fb');
    globalThis.localStorage.setItem('empty', '');
    s.eq('空字符串按非法 JSON 处理', Store.getJSON('empty', 'fb'), 'fb');

    var circular = {};
    circular.self = circular;
    s.ok('循环对象写失败返回 false', Store.setJSON('circular', circular) === false);
    s.ok('undefined 不写入', Store.setJSON('undef', undefined) === false);
    s.eq('写失败后 key 不存在', Store.get('circular'), undefined);
  });
});

/* ------------------------------- failure modes ---------------------------- */

s.group('失败模式：写满 / 读取被拒 / 无 storage', function () {
  withStorage(memory({ throwSet: true }), function () {
    s.ok('配额满：set 返回 false', Store.set('k', 'v') === false);
    s.ok('配额满：setJSON 返回 false', Store.setJSON('k', { a: 1 }) === false);
    s.ok('配额满：best 返回 false', Store.best('k', 5) === false);
    var merged = Store.record('k', { w: 1 });
    s.eq('配额满：record 仍返回合并结果', merged, { w: 1 });
  });

  withStorage(memory({ throwGet: true }), function () {
    s.eq('读被拒：get 返回 fallback', Store.get('k', 'fb'), 'fb');
    s.eq('读被拒：getJSON 返回 fallback', Store.getJSON('k', 'fb'), 'fb');
    s.ok('读被拒：best 仍可写入（当作无记录）', Store.best('k', 3) === true);
  });

  withStorage(null, function () {
    s.eq('无 storage：get 返回 fallback', Store.get('k', 'fb'), 'fb');
    s.ok('无 storage：set 返回 false', Store.set('k', 'v') === false);
    s.eq('无 storage：record 返回内存合并结果', Store.record('k', { a: 1 }), { a: 1 });
  });
});

/* ----------------------------------- best --------------------------------- */

s.group('best：max / min 与非法值', function () {
  withStorage(memory(), function () {
    s.ok('max 首次写入', Store.best('hi', 10) === true);
    s.ok('max 更小不刷新', Store.best('hi', 3) === false);
    s.ok('max 相等不刷新', Store.best('hi', 10) === false);
    s.ok('max 更大刷新', Store.best('hi', 12) === true);
    s.eq('max 最终值', Store.get('hi', null), '12');

    s.ok('min 首次写入', Store.best('lo', 10, { mode: 'min' }) === true);
    s.ok('min 更大不刷新', Store.best('lo', 12, { mode: 'min' }) === false);
    s.ok('min 更小刷新', Store.best('lo', 3, { mode: 'min' }) === true);
    s.eq('min 最终值', Store.get('lo', null), '3');

    s.ok('默认 mode 是 max', Store.best('default', 1) === true &&
      Store.best('default', 0) === false);

    s.ok('非数字 value 不写入', Store.best('bad', 'abc') === false);
    s.ok('NaN 不写入', Store.best('bad', NaN) === false);
    s.eq('非法 value 后仍为空', Store.get('bad'), undefined);

    globalThis.localStorage.setItem('raw', 'not-a-number');
    s.ok('已存非数字视为无记录', Store.best('raw', 4) === true);
    s.eq('覆盖为有效数字', Store.get('raw'), '4');
  });
});

/* ---------------------------------- record -------------------------------- */

s.group('record：对象浅合并', function () {
  withStorage(memory(), function () {
    s.eq('首次 record', Store.record('stats', { w: 1 }), { w: 1 });
    s.eq('第二次合并保留旧键', Store.record('stats', { l: 2 }), { w: 1, l: 2 });
    s.eq('patch 覆盖同名键', Store.record('stats', { w: 5 }), { w: 5, l: 2 });
    s.eq('落盘与返回一致', Store.getJSON('stats', null), { w: 5, l: 2 });

    globalThis.localStorage.setItem('broken', '["not", "an", "object"]');
    s.eq('数组存储视为空对象', Store.record('broken', { x: 1 }), { x: 1 });
    globalThis.localStorage.setItem('broken2', 'not json');
    s.eq('非法 JSON 存储视为空对象', Store.record('broken2', { y: 2 }), { y: 2 });

    s.eq('patch 为 null 时返回原记录', Store.record('stats', null), { w: 5, l: 2 });
    s.eq('patch 非对象不合并', Store.record('stats', 'nope'), { w: 5, l: 2 });
  });
});

/* ------------------------------ never throws ------------------------------ */

s.group('永不抛异常：恶意/边角输入', function () {
  withStorage(memory(), function () {
    var threw = 0;
    var hostile = {};
    Object.defineProperty(hostile, 'boom', {
      enumerable: true,
      get: function () { throw new Error('getter exploded'); }
    });
    var hostileValue = {};
    Object.defineProperty(hostileValue, 'toJSON', {
      value: function () { throw new Error('toJSON exploded'); }
    });

    [
      function () { Store.get(null, 'fb'); },
      function () { Store.set(undefined, 'v'); },
      function () { Store.getJSON('x', 'fb'); },
      function () { Store.setJSON('x', hostileValue); },
      function () { Store.best('x', { valueOf: function () { throw new Error('nope'); } }); },
      function () { Store.record('x', hostile); }
    ].forEach(function (fn) {
      try { fn(); } catch (e) { threw++; }
    });
    s.eq('六种恶意输入均未抛异常', threw, 0);
    s.eq('恶意 getter 不进入记录', Store.getJSON('x', null), {});
  });

  var had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  var prev;
  try { prev = globalThis.localStorage; } catch (e) { prev = undefined; }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: function () { throw new Error('SecurityError on access'); }
  });
  try {
    s.eq('访问 localStorage 抛错：get 回退', Store.get('k', 'fb'), 'fb');
    s.ok('访问 localStorage 抛错：set 返回 false', Store.set('k', 'v') === false);
  } finally {
    try { delete globalThis.localStorage; } catch (e) {
      globalThis.localStorage = prev;
    }
    if (had) globalThis.localStorage = prev;
  }
});

s.done();
