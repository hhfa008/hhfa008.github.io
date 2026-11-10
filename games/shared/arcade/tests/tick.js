'use strict';

/* games/shared/arcade/kits/tick.js 的单元测试。
 *
 * 不依赖真实计时：raf()/cancelRaf()/document 全部注入，测试自己推进帧时间戳、
 * 逐个触发帧回调。
 *
 *   node games/shared/arcade/tests/tick.js
 */

var path = require('path');
var Tick = require(path.join(__dirname, '..', 'kits', 'tick.js'));

var passed = 0;
var failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   - ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + name + ' :: ' + (e && e.message ? e.message : e));
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || '') + ' expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
  }
}

function fakeRaf() {
  var queue = [];
  var nextId = 1;
  var cancelled = [];
  return {
    raf: function (cb) {
      var id = nextId++;
      queue.push({ id: id, cb: cb });
      return id;
    },
    cancelRaf: function (id) {
      cancelled.push(id);
      queue = queue.filter(function (item) { return item.id !== id; });
    },
    pending: function () { return queue.length; },
    peek: function () { return queue.length ? queue[0].cb : null; },
    frame: function (t) {
      var item = queue.shift();
      if (!item) return false;
      item.cb(t);
      return true;
    },
    cancelledIds: function () { return cancelled.slice(); },
  };
}

function fakeDoc() {
  var listeners = {};
  return {
    hidden: false,
    addEventListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener: function (name, fn) {
      listeners[name] = (listeners[name] || []).filter(function (x) { return x !== fn; });
    },
    fire: function (name) { (listeners[name] || []).slice().forEach(function (fn) { fn({ type: name }); }); },
    listenerCount: function (name) { return (listeners[name] || []).length; },
  };
}

function harness() {
  var raf = fakeRaf();
  var doc = fakeDoc();
  var steps = 0;
  var renders = 0;
  var ticker = Tick.create({
    step: 10,
    raf: raf.raf,
    cancelRaf: raf.cancelRaf,
    doc: doc,
    onStep: function () { steps++; },
    onRender: function () { renders++; },
  });
  return { ticker: ticker, raf: raf, doc: doc, steps: function () { return steps; }, renders: function () { return renders; } };
}

console.log('--- tick helper ---');

check('固定步长：N 帧 × step 后走 N 步，状态正确', function () {
  var state = 0;
  var raf = fakeRaf();
  var t = Tick.create({
    step: 10, raf: raf.raf, cancelRaf: raf.cancelRaf, doc: fakeDoc(),
    onStep: function () { state += 10; },
  });
  t.start();
  raf.frame(0); // 启动后的对齐帧
  for (var i = 1; i <= 6; i++) raf.frame(i * 10);
  eq(state, 60, '6 步后 state');
  eq(t.ticks(), 6, 'ticker.ticks() 累计 6');
  eq(raf.pending(), 1, '每帧后继续排下一帧');
});

check('一帧内按累加器补多步（不超过积压）', function () {
  var raf = fakeRaf();
  var steps = 0;
  var t = Tick.create({ step: 10, raf: raf.raf, cancelRaf: raf.cancelRaf, doc: fakeDoc(), onStep: function () { steps++; } });
  t.start();
  raf.frame(0);
  raf.frame(35); // 35ms 积压 -> 3 步，余 5ms
  eq(steps, 3, '35ms 走 3 步');
  raf.frame(45); // +10ms，累加器 15ms -> 再 1 步，余 5ms
  eq(steps, 4, '45ms 共 4 步');
});

check('pause 期间不推进，resume 后不补帧', function () {
  var h = harness();
  h.ticker.start();
  h.raf.frame(0);
  h.raf.frame(10);
  h.raf.frame(20);
  eq(h.steps(), 2, '暂停前 2 步');
  h.ticker.pause();
  h.raf.frame(30);
  h.raf.frame(40);
  eq(h.steps(), 2, '暂停期间帧回调不推进');
  h.ticker.resume();
  h.raf.frame(50);
  eq(h.steps(), 3, 'resume 首帧只走一步，不补 20ms');
  h.raf.frame(60);
  eq(h.steps(), 4, '恢复后正常一步');
});

check('document.hidden 期间不累积，回前台不补帧', function () {
  var h = harness();
  h.ticker.start();
  h.raf.frame(0);
  h.raf.frame(10);
  h.raf.frame(20);
  eq(h.steps(), 2, '隐藏前 2 步');
  h.doc.hidden = true;
  h.raf.frame(30);
  h.raf.frame(900); // 隐藏 870ms
  eq(h.steps(), 2, '隐藏期间 0 步');
  h.doc.hidden = false;
  h.doc.fire('visibilitychange');
  h.raf.frame(1000); // 回前台首帧：最多一步，绝不补 870ms（否则是 ~87 步）
  eq(h.steps(), 3, '回前台首帧不补隐藏期间的 870ms');
  h.raf.frame(1010);
  eq(h.steps(), 4, '回前台下一帧正常一步');
});

check('stop() 后不再回调，并取消已排期的帧', function () {
  var h = harness();
  h.ticker.start();
  h.raf.frame(0);
  h.raf.frame(10);
  eq(h.steps(), 1, '停止前 1 步');
  var inFlight = h.raf.peek();
  h.ticker.stop();
  eq(h.raf.pending(), 0, 'stop 取消已排期帧');
  eq(h.raf.cancelledIds().length, 1, 'cancelRaf 被调用一次');
  inFlight(20); // 模拟已拿到但未执行的旧回调
  eq(h.steps(), 1, 'stop 后旧回调不触发 onStep');
  eq(h.ticker.isRunning(), false, 'isRunning=false');
});

check('不暴露 setInterval：只用 rAF 时间戳推进', function () {
  var called = [];
  var t = Tick.create({
    step: 10,
    raf: function (cb) { called.push(cb); return 1; },
    cancelRaf: function () {},
    doc: fakeDoc(),
    onStep: function () {},
  });
  t.start();
  eq(called.length, 1, 'start 只排了一帧 rAF');
  eq(typeof t.start, 'function', 'API 完整');
});

check('ArcadeTick.last() 返回最近创建的 ticker', function () {
  var a = Tick.create({ step: 10, raf: function () { return 1; }, cancelRaf: function () {}, doc: fakeDoc() });
  var b = Tick.create({ step: 20, raf: function () { return 2; }, cancelRaf: function () {}, doc: fakeDoc() });
  eq(Tick.last(), b, 'last 是最近创建的那个');
  eq(Tick.last().step, 20, 'last().step 可读');
  eq(typeof a.ticks, 'function', '旧 ticker 仍可用');
});

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
