/* Arcade kit: 固定步长计时器。
 *
 * 页面不再各自写 requestAnimationFrame 循环，统一由这里驱动：
 *   var ticker = ArcadeTick.create({ step: 1000 / 60, onStep: function () { input('tick'); } });
 *   ticker.start();
 *
 * 语义（所有模式都是 requestAnimationFrame + 固定步长累加器）：
 *   - 每帧把「上一帧时间戳 → 本帧时间戳」的增量累加进 acc，每满 step 调一次
 *     onStep；单帧积压上限 maxFrameMs，追不上就丢弃，不会一次跳几百步。
 *   - pause()/resume()：暂停期间不推进；恢复后最多走一步，不补暂停期间的时间。
 *   - document.hidden：通过 visibilitychange + 每帧 hidden 检查双重拦截，
 *     隐藏期间不累积；回到前台时累加器清零、首帧最多走一步，不补帧、不跳步。
 *   - stop()：取消调度，之后不再触发任何回调。
 *
 * 只用 rAF 时间戳做累加（不混用 performance.now），这样测试可以把帧时间戳
 * 直接喂进来，不需要真实等待。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeTick = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DEFAULT_STEP = 1000 / 60;
  var lastTicker = null;

  function createTicker(options) {
    options = options || {};
    var g = options.global || (typeof globalThis !== 'undefined' ? globalThis : {});
    var step = options.step > 0 ? options.step : DEFAULT_STEP;
    var onStep = typeof options.onStep === 'function' ? options.onStep : function () {};
    var onRender = typeof options.onRender === 'function' ? options.onRender : null;
    var doc = options.doc !== undefined ? options.doc : (typeof document !== 'undefined' ? document : null);
    var maxFrameMs = options.maxFrameMs > 0 ? options.maxFrameMs : 250;
    var maxStepsPerFrame = options.maxStepsPerFrame > 0 ? options.maxStepsPerFrame : 240;

    var raf = options.raf || (g.requestAnimationFrame && g.requestAnimationFrame.bind(g)) ||
      function (fn) { return g.setTimeout(function () { fn(Date.now()); }, 16); };
    var cancelRaf = options.cancelRaf || (g.cancelAnimationFrame && g.cancelAnimationFrame.bind(g)) ||
      function (id) { g.clearTimeout(id); };

    var started = false;
    var stopped = false;
    var paused = false;
    var acc = 0;
    var last = null;
    var handle = null;
    var resync = false;
    var ticks = 0;

    function hidden() { return !!(doc && doc.hidden); }

    function schedule() {
      if (stopped) return;
      handle = raf(frame);
    }

    function frame(t) {
      if (stopped) return;
      handle = null;
      if (typeof t !== 'number' || !isFinite(t)) t = last == null ? 0 : last;
      if (paused || hidden()) {
        // 暂停/后台：清空积压，只记住时间点；恢复时不补这段时间。
        acc = 0;
        last = t;
        resync = true;
        schedule();
        return;
      }
      if (last == null) {
        // 启动后的第一帧只对齐时间点。
        last = t;
        if (onRender) onRender();
        schedule();
        return;
      }
      var delta = t - last;
      if (delta < 0) delta = 0;
      // 刚从隐藏/暂停回来时最多只走一步，绝不把隐藏期间的时间一次性补回来；
      // 正常帧仍允许最多 maxFrameMs 的追赶。
      var cap = resync ? step : maxFrameMs;
      if (delta > cap) delta = cap;
      resync = false;
      last = t;
      acc += delta;
      var steps = 0;
      while (acc >= step && steps < maxStepsPerFrame) {
        acc -= step;
        steps++;
        ticks++;
        onStep();
      }
      if (acc >= step) acc = 0; // 追不上就丢弃积压，避免越积越多
      if (onRender) onRender();
      schedule();
    }

    function onVisibility() {
      if (stopped) return;
      acc = 0;
      resync = true;
    }

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibility);
    }

    var api = {
      start: function () {
        if (started || stopped) return api;
        started = true;
        paused = false;
        acc = 0;
        last = null;
        resync = false;
        schedule();
        return api;
      },
      pause: function () {
        if (stopped) return api;
        paused = true;
        acc = 0;
        return api;
      },
      resume: function () {
        if (stopped) return api;
        paused = false;
        acc = 0;
        resync = true; // 恢复后最多走一步，不补暂停期间的时间
        return api;
      },
      stop: function () {
        if (stopped) return api;
        stopped = true;
        started = false;
        paused = false;
        if (handle != null) { cancelRaf(handle); handle = null; }
        if (doc && typeof doc.removeEventListener === 'function') {
          doc.removeEventListener('visibilitychange', onVisibility);
        }
        return api;
      },
      isRunning: function () { return started && !stopped && !paused; },
      isPaused: function () { return paused; },
      // 自启动以来 onStep 的累计调用次数（测试/诊断用）。
      ticks: function () { return ticks; },
      step: step,
    };
    lastTicker = api;
    return api;
  }

  return {
    create: createTicker,
    DEFAULT_STEP: DEFAULT_STEP,
    // 最近创建的 ticker（诊断/测试用；每页只有一个）。
    last: function () { return lastTicker; },
  };
});
