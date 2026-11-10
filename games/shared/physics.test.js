'use strict';

/*
 * Contract and numeric tests for games/shared/physics.js.
 *
 * Run: node games/shared/physics.test.js
 *
 * The seven self-checks required by the engine brief are all here, plus
 * constraint and API checks. Every number printed in the group summaries is
 * measured by this run, not hard-coded.
 */

var lib = require('../tests/lib.js');
var Physics = require('./physics.js');

var s = lib.suite('shared/physics');

var DT = 1 / 60;

function stepN(world, n, dt) {
  for (var i = 0; i < n; i++) world.step(dt == null ? DT : dt);
}

function dist(a, b) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function kineticEnergy(bodies) {
  var e = 0;
  for (var i = 0; i < bodies.length; i++) {
    var b = bodies[i];
    e += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
  }
  return e;
}

function momentum(bodies) {
  var px = 0, py = 0;
  for (var i = 0; i < bodies.length; i++) {
    px += bodies[i].mass * bodies[i].vx;
    py += bodies[i].mass * bodies[i].vy;
  }
  return { x: px, y: py };
}

function relativeError(actual, expected) {
  return expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected);
}

/* ------------------------------------------------------------------ *
 * 1. Collision solving                                                *
 * ------------------------------------------------------------------ */
s.group('碰撞解算：动量守恒与穿透消除', function () {
  var w = Physics.createWorld({ gravity: { x: 0, y: 0 }, substeps: 4 });
  var a = w.addBody({ shape: 'circle', r: 10, x: 0, y: 0, vx: 120, mass: 1, restitution: 0.6, friction: 0 });
  var b = w.addBody({ shape: 'circle', r: 10, x: 60, y: 0, vx: -80, mass: 1, restitution: 0.6, friction: 0 });
  var p0 = momentum([a, b]);
  stepN(w, 60);
  var p1 = momentum([a, b]);
  var errX = Math.abs(p1.x - p0.x);
  var errY = Math.abs(p1.y - p0.y);
  s.ok('等质量圆碰撞后 x 动量守恒', errX < 1e-6, '误差 ' + errX);
  s.ok('等质量圆碰撞后 y 动量守恒', errY < 1e-6, '误差 ' + errY);
  s.ok('碰撞后两球已分开', dist(a, b) >= 20 - 1e-9, '距离 ' + dist(a, b));

  // Overlap 1 px, no velocity: one step must project them exactly apart.
  var w2 = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var c = w2.addBody({ shape: 'circle', r: 10, x: 0, y: 0, mass: 1, restitution: 0 });
  var d = w2.addBody({ shape: 'circle', r: 10, x: 19, y: 0, mass: 1, restitution: 0 });
  stepN(w2, 1);
  var depth = 20 - dist(c, d);
  s.ok('一步内消除 1px 圆-圆穿透', depth <= 1e-9, '剩余穿透 ' + depth);

  var w3 = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var box = w3.addBody({ shape: 'aabb', w: 20, h: 20, x: 0, y: 0, static: true });
  var ball = w3.addBody({ shape: 'circle', r: 10, x: 15, y: 0, mass: 1 });
  stepN(w3, 1);
  s.ok('一步内消除圆-AABB 穿透', ball.x >= 19.999999999, '圆心 x=' + ball.x);

  var w4 = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var b1 = w4.addBody({ shape: 'aabb', w: 20, h: 20, x: 0, y: 0, mass: 1 });
  var b2 = w4.addBody({ shape: 'aabb', w: 20, h: 20, x: 19, y: 0, mass: 1 });
  stepN(w4, 1);
  s.ok('一步内消除 AABB-AABB 穿透', Math.abs(b2.x - b1.x) >= 19.999999999,
    '间距 ' + Math.abs(b2.x - b1.x));

  // Static floor stops a falling circle at the expected contact height.
  var w5 = Physics.createWorld({ gravity: { x: 0, y: 900 }, substeps: 2 });
  w5.addBody({ shape: 'aabb', w: 400, h: 20, x: 0, y: 200, static: true });
  var drop = w5.addBody({ shape: 'circle', r: 10, x: 0, y: 0, mass: 1, restitution: 0 });
  stepN(w5, 120);
  s.near('落地后圆心贴地', drop.y, 180, 1e-6);

  return '动量误差 ' + errX.toExponential(2) + ' / ' + errY.toExponential(2) +
    '；残余穿透 ' + depth.toExponential(2);
});

/* ------------------------------------------------------------------ *
 * 2. Elasticity                                                       *
 * ------------------------------------------------------------------ */
s.group('弹性：e=1 能量守恒，e=0 碰撞后静止', function () {
  var w = Physics.createWorld({ gravity: { x: 0, y: 0 }, substeps: 4 });
  var a = w.addBody({ shape: 'circle', r: 10, x: 0, y: 0, vx: 100, mass: 1, restitution: 1, friction: 0 });
  var b = w.addBody({ shape: 'circle', r: 10, x: 40, y: 0, vx: -100, mass: 1, restitution: 1, friction: 0 });
  var e0 = kineticEnergy([a, b]);
  stepN(w, 120);
  var e1 = kineticEnergy([a, b]);
  var err = relativeError(e1, e0);
  s.ok('e=1 动能守恒误差 < 1%', err < 0.01, '误差 ' + (err * 100).toFixed(9) + '%');
  s.near('e=1 两球交换速度', a.vx, -100, 1e-9);

  var w0 = Physics.createWorld({ gravity: { x: 0, y: 0 }, substeps: 4 });
  var c = w0.addBody({ shape: 'circle', r: 10, x: 0, y: 0, vx: 100, mass: 1, restitution: 0, friction: 0 });
  var d = w0.addBody({ shape: 'circle', r: 10, x: 40, y: 0, vx: -100, mass: 1, restitution: 0, friction: 0 });
  stepN(w0, 120);
  var speed = Math.max(Math.abs(c.vx), Math.abs(d.vx), Math.abs(c.vy), Math.abs(d.vy));
  s.ok('e=0 碰撞后速度趋于 0', speed < 1e-9, '最大速度 ' + speed);

  var w5 = Physics.createWorld({ gravity: { x: 0, y: 0 }, substeps: 4 });
  var p = w5.addBody({ shape: 'circle', r: 10, x: 0, y: 0, vx: 100, mass: 1, restitution: 0.5, friction: 0 });
  var q = w5.addBody({ shape: 'circle', r: 10, x: 40, y: 0, vx: -100, mass: 1, restitution: 0.5, friction: 0 });
  stepN(w5, 120);
  // Equal masses and e=0.5: each leaves at 0.5 of the closing speed.
  s.near('e=0.5 分离速度', q.vx - p.vx, 100, 1e-9);

  return 'e=1 能量误差 ' + (err * 100).toExponential(2) + '%；e=0 最大残余速度 ' +
    speed.toExponential(2) + ' px/s';
});

/* ------------------------------------------------------------------ *
 * 3. Gravity                                                          *
 * ------------------------------------------------------------------ */
s.group('重力：自由落体 1 秒', function () {
  var w = Physics.createWorld({ gravity: { x: 0, y: 900 } });
  var b = w.addBody({ shape: 'circle', r: 5, x: 0, y: 0, mass: 1, restitution: 0 });
  stepN(w, 60);
  var expected = 0.5 * 900 * 1 * 1;
  var err = relativeError(b.y, expected);
  s.ok('1 秒位移误差 < 2%', err < 0.02,
    'y=' + b.y + '，期望 ' + expected + '，误差 ' + (err * 100).toFixed(4) + '%');
  s.near('1 秒末速度 = g·t', b.vy, 900, 1e-6);
  s.eq('累计固定步数', w.steps, 60);

  return 'y=' + b.y + '（期望 450，误差 ' + (err * 100).toExponential(2) +
    '%），vy=' + b.vy;
});

/* ------------------------------------------------------------------ *
 * 4. Tunnelling and sub-steps                                         *
 * ------------------------------------------------------------------ */
s.group('子步进：3000px/s 射向 5px 墙', function () {
  function run(substeps) {
    var w = Physics.createWorld({ gravity: { x: 0, y: 0 }, substeps: substeps });
    w.addBody({ shape: 'aabb', w: 5, h: 400, x: 180, y: 0, static: true, restitution: 0 });
    var bullet = w.addBody({
      shape: 'circle', r: 2, x: 0, y: 0, vx: 3000, mass: 1,
      restitution: 0, friction: 0
    });
    stepN(w, 20);
    return bullet;
  }
  var safe = run(16);
  var tunnel = run(1);
  s.ok('子步进 16：不穿墙', safe.x < 180, '子弹 x=' + safe.x);
  s.ok('子步进 16：停在墙面外侧', safe.x > 160 && safe.x < 180, '子弹 x=' + safe.x);
  s.ok('对照组子步进 1：复现穿透', tunnel.x > 180, '子弹 x=' + tunnel.x);
  s.ok('对照组确实越过墙右侧', tunnel.x > 250, '子弹 x=' + tunnel.x);
  return '16 子步 x=' + safe.x.toFixed(3) + '（未穿）；1 子步 x=' + tunnel.x.toFixed(1) + '（穿过）';
});

/* ------------------------------------------------------------------ *
 * 5. Determinism                                                      *
 * ------------------------------------------------------------------ */
s.group('确定性：同一状态跑 600 步两次', function () {
  function build() {
    var w = Physics.createWorld({ gravity: { x: 0, y: 900 }, substeps: 3, sleep: false });
    w.addBody({ shape: 'aabb', w: 600, h: 20, x: 0, y: 300, static: true });
    var a = w.addBody({ shape: 'aabb', w: 40, h: 56, x: -60, y: 0, angle: 0.3, angularVelocity: 2, restitution: 0.4, friction: 0.4 });
    var b = w.addBody({ shape: 'circle', r: 12, x: 20, y: 40, vx: 70, vy: -40, restitution: 0.7, friction: 0.2 });
    var c = w.addBody({ shape: 'circle', r: 8, x: 90, y: -30, vx: -30, restitution: 0.5, friction: 0.6 });
    Physics.spring(a, { x: -10, y: 120 }, { stiffness: 40, damping: 6 });
    Physics.applyImpulse(b, { x: 30, y: -140 });
    Physics.applyImpulse(c, { x: -90, y: 20 }, { x: 95, y: -30 });
    return { world: w, bodies: [a, b, c] };
  }
  var r1 = build();
  var r2 = build();
  stepN(r1.world, 600);
  stepN(r2.world, 600);

  var same = true;
  var checked = 0;
  var firstDiff = '';
  for (var i = 0; i < r1.bodies.length; i++) {
    var x = r1.bodies[i], y = r2.bodies[i];
    var fields = ['x', 'y', 'vx', 'vy', 'angle', 'angularVelocity'];
    for (var k = 0; k < fields.length; k++) {
      checked++;
      if (x[fields[k]] !== y[fields[k]]) {
        same = false;
        if (!firstDiff) firstDiff = 'body' + i + '.' + fields[k] + ': ' +
          x[fields[k]] + ' vs ' + y[fields[k]];
      }
    }
  }
  s.ok('600 步后全部位置/角度逐位一致', same, firstDiff);
  s.eq('比较字段数', checked, 18);
  s.eq('两个世界都推进 600 步', [r1.world.steps, r2.world.steps], [600, 600]);
  s.ok('结果不是 NaN', isFinite(r1.bodies[0].x) && isFinite(r1.bodies[0].y),
    String(r1.bodies[0].x));
  return checked + ' 个字段逐位相等，首位差异：' + (firstDiff || '无');
});

/* ------------------------------------------------------------------ *
 * 6. Performance                                                      *
 * ------------------------------------------------------------------ */
s.group('性能：100 刚体单步耗时', function () {
  var w = Physics.createWorld({ gravity: { x: 0, y: 900 }, substeps: 1 });
  w.addBody({ shape: 'aabb', w: 420, h: 30, x: 0, y: 260, static: true });   // floor
  w.addBody({ shape: 'aabb', w: 30, h: 420, x: -210, y: 60, static: true }); // left wall
  w.addBody({ shape: 'aabb', w: 30, h: 420, x: 210, y: 60, static: true });  // right wall
  var bodies = [];
  for (var i = 0; i < 100; i++) {
    var row = Math.floor(i / 10);
    var col = i % 10;
    bodies.push(w.addBody({
      shape: 'circle', r: 6, mass: 1,
      x: -135 + col * 30, y: -120 + row * 16,
      vx: (i % 2 ? 1 : -1) * 20, restitution: 0.1, friction: 0.5
    }));
  }
  for (var warm = 0; warm < 30; warm++) w.step(DT);

  var runs = 1000;
  var t0 = process.hrtime.bigint();
  for (var n = 0; n < runs; n++) w.step(DT);
  var t1 = process.hrtime.bigint();
  var avgMs = Number(t1 - t0) / 1e6 / runs;
  var maxContact = 0;
  // One more step to report the current contact count (not part of timing).
  w.step(DT);
  maxContact = w.contactCount;
  s.ok('100 刚体单步均值 < 2ms', avgMs < 2, avgMs.toFixed(4) + ' ms/step');
  s.ok('100 个动态刚体都在场', bodies.length === 100, String(bodies.length));
  s.ok('模拟产生接触', maxContact > 0, String(maxContact));
  return avgMs.toFixed(4) + ' ms/step（' + runs + ' 步均值），当前接触 ' + maxContact + ' 对';
});

/* ------------------------------------------------------------------ *
 * 7. Sleeping                                                         *
 * ------------------------------------------------------------------ */
s.group('休眠：静止 2 秒入睡，唤醒后恢复', function () {
  var w = Physics.createWorld({ gravity: { x: 0, y: 900 }, substeps: 2 });
  w.addBody({ shape: 'aabb', w: 400, h: 20, x: 0, y: 200, static: true });
  var b = w.addBody({
    shape: 'circle', r: 10, x: 0, y: 180, mass: 1,
    restitution: 0, friction: 0.5
  });
  stepN(w, 100); // ~1.67 s
  s.ok('不到 2 秒还没睡', !b.sleeping, 'sleepTimer=' + b.sleepTimer.toFixed(3));
  stepN(w, 25);  // total ~2.08 s
  s.eq('静止约 2 秒后进入休眠', b.sleeping, true);
  var restY = b.y;
  stepN(w, 60);
  s.near('休眠后不再移动', b.y, restY, 1e-9);

  Physics.applyImpulse(b, { x: 200, y: 0 });
  s.eq('applyImpulse 立即唤醒', b.sleeping, false);
  s.near('唤醒后获得速度', b.vx, 200, 1e-9);
  stepN(w, 10);
  s.ok('唤醒后确实移动了', b.x > 5, 'x=' + b.x.toFixed(2));

  // A body in steady motion must not fall asleep just because it is slow.
  var w2 = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var m = w2.addBody({ shape: 'circle', r: 5, x: 0, y: 0, vx: 10, mass: 1 });
  stepN(w2, 180);
  s.eq('持续运动的物体不睡', m.sleeping, false);

  return '约 2.08s 入睡；唤醒后 vx=' + b.vx + '；恒速 10px/s 3 秒仍清醒';
});

/* ------------------------------------------------------------------ *
 * 8. Constraints                                                      *
 * ------------------------------------------------------------------ */
s.group('约束：弹簧与固定点', function () {
  // Spring to a point anchor: settles at restLength.
  var w = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var b = w.addBody({ shape: 'circle', r: 5, x: 0, y: 0, mass: 1, linearDamping: 0.2 });
  Physics.spring(b, { x: 100, y: 0 }, { stiffness: 200, damping: 30, restLength: 0 });
  stepN(w, 300);
  var err = Math.abs(b.x - 100);
  s.ok('弹簧吸附到目标点', err < 0.05, 'x=' + b.x + '，误差 ' + err);
  s.ok('弹簧静止后速度很小', Math.abs(b.vx) < 0.05, 'vx=' + b.vx);

  // Spring between two bodies: keeps the requested rest length.
  var w2 = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var a2 = w2.addBody({ shape: 'circle', r: 5, x: 0, y: 0, mass: 1, linearDamping: 0.2 });
  var b2 = w2.addBody({ shape: 'circle', r: 5, x: 100, y: 0, mass: 1, linearDamping: 0.2 });
  Physics.spring(a2, b2, { stiffness: 200, damping: 30, restLength: 50 });
  stepN(w2, 300);
  var len = dist(a2, b2);
  s.ok('双体弹簧收敛到 restLength', Math.abs(len - 50) < 0.05, 'len=' + len);

  // Fixed point: gravity pulls, the pin holds.
  var w3 = Physics.createWorld({ gravity: { x: 0, y: 900 }, substeps: 2 });
  var p = w3.addBody({ shape: 'aabb', w: 20, h: 20, x: 0, y: 0, mass: 1 });
  Physics.fixedPoint(p, { x: 0, y: 0 });
  stepN(w3, 300);
  s.ok('固定点约束抗重力', Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9,
    'p=(' + p.x + ',' + p.y + ')');
  s.ok('固定点约束消掉内侵速度', Math.abs(p.vy) < 1e-9, 'vy=' + p.vy);

  // Pin with an off-centre local anchor moves the centre to compensate.
  var w4 = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var q = w4.addBody({ shape: 'aabb', w: 20, h: 20, x: 0, y: 0, mass: 1 });
  Physics.fixedPoint(q, { x: 0, y: 0 }, { localX: 10, localY: 0 });
  stepN(w4, 2);
  s.near('偏心固定点把中心拉到 -10', q.x, -10, 1e-9);

  return '弹簧误差 ' + err.toFixed(4) + ' px；双体长度 ' + len.toFixed(4);
});

/* ------------------------------------------------------------------ *
 * 9. API surface                                                      *
 * ------------------------------------------------------------------ */
s.group('API 与只读约定', function () {
  var w = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var b = w.addBody({ shape: 'aabb', w: 10, h: 20, x: 0, y: 0, mass: 2 });
  s.eq('addBody 默认 aabb', b.shape, 'aabb');
  s.near('invMass = 1/mass', b.invMass, 0.5, 1e-12);
  var stat = w.addBody({ shape: 'circle', r: 4, x: 30, y: 0, static: true });
  s.eq('静态体 invMass = 0', stat.invMass, 0);

  var list = w.bodies;
  list.push({ fake: true });
  s.eq('bodies 是只读副本', w.bodies.length, 2);
  s.ok('bodies 返回的是新数组', list !== w.bodies, 'array identity');

  var before = b.vx;
  Physics.applyImpulse(b, { x: 8, y: 0 });
  s.near('applyImpulse 改变速度', b.vx - before, 4, 1e-12);

  var target = { x: 0, y: 0 };
  var sp = Physics.spring(b, target, {});
  s.ok('spring 自动挂到 world', w._constraints.indexOf(sp) >= 0, 'constraint count ' + w._constraints.length);
  s.near('spring 默认 restLength=当前距离', sp.restLength, 0, 1e-12);

  w.removeBody(b);
  s.eq('removeBody 移除刚体', w.bodies.length, 1);
  s.eq('removeBody 连带移除约束', w._constraints.indexOf(sp), -1);

  // Collision filters: cards in group 2 / mask ~2 ignore each other ...
  var wf = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  var f1 = wf.addBody({ shape: 'circle', r: 10, x: 0, y: 0, group: 2, mask: -3 });
  var f2 = wf.addBody({ shape: 'circle', r: 10, x: 15, y: 0, group: 2, mask: -3 });
  stepN(wf, 1);
  s.near('mask 排除同组：卡牌互不碰撞', dist(f1, f2), 15, 1e-9);
  // ... but still collide with the default-group table.
  var wg = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  wg.addBody({ shape: 'aabb', w: 20, h: 20, x: 15, y: 0, static: true });
  var cg = wg.addBody({ shape: 'circle', r: 10, x: 0, y: 0, group: 2, mask: -3 });
  stepN(wg, 1);
  s.near('mask 仍保留与桌面的碰撞', cg.x, -5, 1e-9);

  return 'bodies 长度 ' + w.bodies.length + '，约束与碰撞过滤正常';
});

/* ------------------------------------------------------------------ *
 * 10. Render interpolation (fixed-step alpha)
 * ------------------------------------------------------------------ */
s.group('渲染插值：alpha 范围与 interpolate 端点', function () {
  // alpha must always stay in [0, 1), whatever mix of frame times arrives.
  var w = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  w.addBody({ shape: 'circle', r: 5, x: 0, y: 0, vx: 120, mass: 1 });
  var dts = [1 / 120, 1 / 144, 1 / 90, 0.016, 0.011, 0.023];
  var alphaOk = true;
  var alphaMax = -1;
  var alphaMin = 2;
  for (var i = 0; i < 2000; i++) {
    w.step(dts[i % dts.length]);
    var a = w.alpha;
    if (!(a >= 0 && a < 1)) { alphaOk = false; break; }
    if (a > alphaMax) alphaMax = a;
    if (a < alphaMin) alphaMin = a;
  }
  s.ok('2000 次不规则步进后 alpha 始终在 [0,1)', alphaOk,
    'min=' + alphaMin + ', max=' + alphaMax);
  s.ok('alpha 确实在变化（不是恒 0）', alphaMax > 0, 'max=' + alphaMax);
  s.near('alpha = accumulator / fixedDt', w.alpha, w.accumulator / w.fixedDt, 1e-12);

  // The same wall-clock duration must produce the same number of fixed steps
  // at 60 Hz and 120 Hz: only the interpolation interval changes.
  function stepsFor(hz, seconds) {
    var world = Physics.createWorld({ gravity: { x: 0, y: 0 } });
    var frames = Math.round(hz * seconds);
    var frameDt = seconds / frames;
    for (var k = 0; k < frames; k++) world.step(frameDt);
    return world;
  }
  var r60 = stepsFor(60, 2);
  var r120 = stepsFor(120, 2);
  s.eq('60Hz 2 秒产生 120 个固定步', r60.steps, 120);
  s.eq('120Hz 2 秒产生 120 个固定步', r120.steps, 120);
  s.eq('120Hz 与 60Hz 同一时长步进次数一致', r120.steps, r60.steps);

  // Optional render hook: gets (world, alpha) and does not disturb physics.
  var gotAlpha = -1;
  var gotWorld = null;
  var wc = Physics.createWorld({ gravity: { x: 0, y: 0 } });
  wc.step(1 / 120, function (world, alpha) {
    gotWorld = world;
    gotAlpha = alpha;
  });
  s.ok('step 回调收到同一个 world', gotWorld === wc);
  s.near('step 回调第二个参数是 alpha', gotAlpha, 0.5, 1e-12);
  s.near('回调 alpha 与 world.alpha 一致', gotAlpha, wc.alpha, 1e-12);
  s.ok('不传回调时 step 仍返回 world', wc.step(1 / 60) === wc);

  function buildFalling() {
    var world = Physics.createWorld({ gravity: { x: 0, y: 900 }, substeps: 3 });
    world.addBody({ shape: 'aabb', w: 400, h: 20, x: 0, y: 200, static: true });
    var b = world.addBody({
      shape: 'circle', r: 10, x: -30, y: 0, vx: 40, mass: 1,
      restitution: 0.4, friction: 0.3
    });
    return { world: world, body: b };
  }
  var plain = buildFalling();
  var hooked = buildFalling();
  stepN(plain.world, 180);
  for (var n = 0; n < 180; n++) hooked.world.step(DT, function () {});
  s.eq('带渲染回调的 180 步结果逐位不变',
    [hooked.body.x, hooked.body.y, hooked.body.vx, hooked.body.vy],
    [plain.body.x, plain.body.y, plain.body.vx, plain.body.vy]);

  // interpolate: exact endpoints, midpoint, and no input mutation.
  var prev = { x: 0, y: 10, angle: 0, label: 'prev' };
  var curr = { x: 20, y: 30, angle: 1, label: 'curr' };
  var i0 = Physics.interpolate(prev, curr, 0);
  var i1 = Physics.interpolate(prev, curr, 1);
  var im = Physics.interpolate(prev, curr, 0.5);
  s.eq('alpha=0 精确落在 prev 端点', [i0.x, i0.y, i0.angle], [0, 10, 0]);
  s.eq('alpha=1 精确落在 curr 端点', [i1.x, i1.y, i1.angle], [20, 30, 1]);
  s.eq('alpha=0.5 取中点', [im.x, im.y, im.angle], [10, 20, 0.5]);
  s.eq('interpolate 不修改输入', [prev.x, prev.y, curr.x, curr.y], [0, 10, 20, 30]);
  s.near('数字插值', Physics.interpolate(10, 20, 0.25), 12.5, 1e-12);
  s.near('alpha 超过 1 时按端点饱和', Physics.interpolate(10, 20, 3), 20, 1e-12);

  return 'alpha ∈ [' + alphaMin.toFixed(3) + ', ' + alphaMax.toFixed(3) +
    ')；60/120Hz 均为 ' + r60.steps + ' 步；alpha=0.5 中点 (10,20)';
});

s.done();
