'use strict';

/*
 * L2 contract: shared 2D physics / animation / movement helpers.
 *
 * Pure-function contract, no canvas or DOM required:
 *   - aabbOverlap(a, b): strict overlap (touching edges do NOT overlap)
 *   - circleRectOverlap(circle, rect)
 *   - pointInRect(point, rect) (inclusive boundary)
 *   - moveCharacter(state, input, dt, bounds): normalised diagonal, clamps
 *   - createDealAnimation({cards, duration, stagger}): monotonic state machine
 */

import { createSuite } from './lib/suite.mjs';
import { probeModule, fnOf, nameOf, instantiate, describeMissing } from './lib/probe.mjs';
import { PHYSICS, call } from './lib/contracts.mjs';

const CANDIDATES = [
  'app/physics.mjs',
  'app/physics.js',
  'app/engine/physics.mjs',
  'app/engine/physics.js',
  'app/game/physics.mjs',
  'app/lib/physics.mjs'
];

function rect(x, y, width, height) {
  // Both spellings are present so either implementation convention works.
  return { x: x, y: y, width: width, height: height, w: width, h: height };
}

function point(x, y) {
  return { x: x, y: y };
}

function numberFrom(object, keys, fallback) {
  for (const key of keys) {
    if (object && typeof object[key] === 'number') return object[key];
  }
  return fallback;
}

const s = createSuite('boardgame-engine-physics');

await s.run(async () => {
  const probe = await probeModule(CANDIDATES, 'physics');
  if (!probe.found) {
    s.skip('physics contract', describeMissing(probe, CANDIDATES));
    return;
  }
  if (probe.error) {
    s.ok('physics module imports without throwing', false,
      probe.path + ': ' + (probe.error.stack || probe.error.message || String(probe.error)));
    return;
  }

  const api = probe.api;
  const collide = fnOf(api, PHYSICS.collide);
  const circleRect = fnOf(api, PHYSICS.circle);
  const pointInRect = fnOf(api, PHYSICS.point);
  const move = fnOf(api, PHYSICS.move);
  const dealFactory = fnOf(api, PHYSICS.dealAnimation) ||
    (api.DealAnimation ? api.DealAnimation : undefined);

  await s.group('exports', async () => {
    s.ok('提供 AABB 碰撞函数', typeof collide === 'function', 'expected ' + PHYSICS.collide.join(' / '));
    s.ok('提供圆-矩形碰撞函数', typeof circleRect === 'function', 'expected ' + PHYSICS.circle.join(' / '));
    s.ok('提供点在矩形内判定', typeof pointInRect === 'function', 'expected ' + PHYSICS.point.join(' / '));
    s.ok('提供角色移动函数', typeof move === 'function', 'expected ' + PHYSICS.move.join(' / '));
    s.ok('提供发牌动效状态机', dealFactory !== undefined, 'expected ' + PHYSICS.dealAnimation.join(' / '));
  });

  if (!collide) return;

  await s.group('AABB collision', async () => {
    const a = rect(0, 0, 10, 10);
    s.eq('重叠矩形为 true', await call(collide, null, [a, rect(5, 5, 10, 10)]), true);
    s.eq('分离矩形为 false', await call(collide, null, [a, rect(20, 0, 10, 10)]), false);
    s.eq('边贴边不算重叠', await call(collide, null, [a, rect(10, 0, 10, 10)]), false);
    s.eq('完全包含为 true', await call(collide, null, [a, rect(2, 2, 3, 3)]), true);
    s.eq('同为负坐标不误判', await call(collide, null, [rect(-10, -10, 5, 5), rect(-8, -8, 2, 2)]), true);
    s.eq('不相邻负坐标不误判', await call(collide, null, [rect(-10, -10, 5, 5), rect(0, 0, 5, 5)]), false);
  });

  if (circleRect) {
    await s.group('circle vs rect', async () => {
      const box = rect(0, 0, 10, 10);
      async function hit(circle, rectangle) {
        let result = await call(circleRect, null, [circle, rectangle]);
        if (result === undefined) result = await call(circleRect, null, [rectangle, circle]);
        return result;
      }
      s.eq('圆在矩形内为 true', await hit({ x: 5, y: 5, r: 2, radius: 2 }, box), true);
      s.eq('圆与矩形深重叠为 true', await hit({ x: 12, y: 5, r: 4, radius: 4 }, box), true);
      s.eq('圆远离矩形为 false', await hit({ x: 30, y: 30, r: 3, radius: 3 }, box), false);
      s.eq('圆只碰到角外为 false', await hit({ x: 15, y: 15, r: 3, radius: 3 }, box), false);
    });
  }

  if (pointInRect) {
    await s.group('point in rect', async () => {
      const box = rect(10, 10, 20, 20);
      s.eq('内部点为 true', await call(pointInRect, null, [point(15, 15), box]), true);
      s.eq('外部点为 false', await call(pointInRect, null, [point(5, 5), box]), false);
      s.eq('另一侧外部点为 false', await call(pointInRect, null, [point(35, 15), box]), false);
      s.eq('边界点为 true（闭区间）', await call(pointInRect, null, [point(10, 10), box]), true);
    });
  }

  if (move) {
    const moveName = nameOf(api, PHYSICS.move) || move.name || '';
    const worldMode = /world/i.test(moveName);
    if (worldMode) {
      await s.group('character movement (body + world)', async () => {
        const createWorld = fnOf(api, ['createWorld']) || (moveName === 'World' ? move : undefined);
        const createBody = fnOf(api, ['createBody', 'makeBody']);
        s.ok('提供 createWorld', typeof createWorld === 'function');
        s.ok('提供 createBody', typeof createBody === 'function');
        if (!createWorld || !createBody) return;

        function runBody(options, steps) {
          const world = instantiate(createWorld, {
            bounds: { x: 0, y: 0, w: 200, h: 200 },
            gravity: 0
          });
          const body = createBody(Object.assign({
            friction: 1,
            restitution: 0,
            mass: 1
          }, options));
          world.addBody(body);
          for (let i = 0; i < steps; i += 1) world.step(0.05);
          return body;
        }

        const right = runBody({ x: 0, y: 0, vx: 100, vy: 0 }, 10);
        s.near('匀速向右 0.5s 位移 = velocity * t', right.x, 50);
        s.near('向右移动不改 y', right.y, 0);

        const up = runBody({ x: 0, y: 100, vx: 0, vy: -100 }, 10);
        s.near('向上移动 y 减小', up.y, 50);

        const diagonal = runBody({ x: 0, y: 0, vx: 100 / Math.SQRT2, vy: 100 / Math.SQRT2 }, 10);
        s.near('斜向位移总量 = speed * t',
          Math.sqrt(diagonal.x * diagonal.x + diagonal.y * diagonal.y), 50, 1e-6);
        s.ok('斜向两个分量同值', Math.abs(diagonal.x - diagonal.y) < 1e-6,
          'x=' + diagonal.x + ', y=' + diagonal.y);

        const clamped = runBody({ x: 195, y: 195, vx: 100, vy: 100 }, 20);
        s.ok('右侧越界被夹住/反弹', clamped.x <= 200 + 1e-9, 'x=' + clamped.x);
        s.ok('下侧越界被夹住/反弹', clamped.y <= 200 + 1e-9, 'y=' + clamped.y);

        const idle = runBody({ x: 10, y: 10, vx: 0, vy: 0 }, 10);
        s.near('零速度不移动 x', idle.x, 10);
        s.near('零速度不移动 y', idle.y, 10);
      });
    } else {
      await s.group('character movement', async () => {
        const bounds = {
          width: 200,
          height: 200,
          minX: 0,
          minY: 0,
          maxX: 200,
          maxY: 200
        };

        async function step(state, input, dt) {
          const base = Object.assign({ x: 0, y: 0, speed: 100 }, state);
          const result = await call(move, null, [base, input, dt, Object.assign({}, bounds)]);
          if (result && typeof result === 'object') return Object.assign({}, base, result);
          return base;
        }

        const right = await step({ speed: 100 }, { x: 1, y: 0 }, 0.5);
        s.near('向右移动 = speed * dt', numberFrom(right, ['x'], NaN), 50);
        s.near('向右移动不改 y', numberFrom(right, ['y'], NaN), 0);

        const up = await step({ speed: 100, y: 50 }, { x: 0, y: -1 }, 0.25);
        s.near('向上移动 y 减小', numberFrom(up, ['y'], NaN), 25);
        s.near('向上移动不改 x', numberFrom(up, ['x'], NaN), 0);

        const diagonal = await step({ speed: 100 }, { x: 1, y: 1 }, 0.5);
        const dx = numberFrom(diagonal, ['x'], NaN);
        const dy = numberFrom(diagonal, ['y'], NaN);
        const distance = Math.sqrt(dx * dx + dy * dy);
        s.near('斜向移动被归一化（总位移 = speed * dt）', distance, 50, 1e-6);
        s.ok('斜向两个分量同号同值', Math.abs(dx - dy) < 1e-6, 'dx=' + dx + ', dy=' + dy);

        const clamped = await step({ x: 195, y: 195, speed: 100 }, { x: 1, y: 1 }, 1);
        s.ok('右侧越界被夹住', numberFrom(clamped, ['x'], NaN) <= 200 + 1e-9,
          'x=' + numberFrom(clamped, ['x'], NaN));
        s.ok('下侧越界被夹住', numberFrom(clamped, ['y'], NaN) <= 200 + 1e-9,
          'y=' + numberFrom(clamped, ['y'], NaN));

        const idle = await step({ x: 10, y: 10, speed: 100 }, { x: 0, y: 0 }, 1);
        s.near('零输入不移动 x', numberFrom(idle, ['x'], NaN), 10);
        s.near('零输入不移动 y', numberFrom(idle, ['y'], NaN), 10);
      });
    }
  }

  if (dealFactory) {
    const dealName = nameOf(api, PHYSICS.dealAnimation) || '';
    if (/dealPlan/i.test(dealName)) {
      await s.group('deal plan + tween state machine', async () => {
        const plan = await call(dealFactory, null, [{
          count: 4,
          from: { x: 0, y: 0 },
          to: { x: 100, y: 0 },
          stagger: 50,
          duration: 200,
          easing: 'easeOutCubic'
        }]);
        s.ok('dealPlan 返回数组', Array.isArray(plan), JSON.stringify(plan));
        if (!Array.isArray(plan)) return;
        s.eq('发牌计划覆盖 4 张牌', plan.length, 4);
        s.eq('每张牌有起点/终点', plan.filter(function (item) {
          return item && item.from && item.to;
        }).length, plan.length);
        s.eq('发牌计划结束时间是单调递增的', plan.map(function (item) { return item.endAt; }),
          plan.map(function (item) { return item.endAt; }).slice().sort(function (a, b) { return a - b; }));
        s.eq('每张牌有 duration 与 easing', plan.filter(function (item) {
          return typeof item.duration === 'number' && item.duration > 0 && typeof item.easing === 'string';
        }).length, plan.length);

        const Tween = fnOf(api, ['createTween', 'Tween']);
        s.ok('提供 Tween/createTween', typeof Tween === 'function');
        if (!Tween) return;
        const tween = instantiate(Tween, { from: 0, to: 1, duration: 0.3, easing: 'easeOutCubic' });
        const update = fnOf(tween, ['update', 'step', 'advance']);
        s.ok('Tween 提供 update', typeof update === 'function');
        if (!update) return;

        let previous = -Infinity;
        let monotonic = true;
        for (let i = 0; i < 10; i += 1) {
          await call(update, tween, [0.05]);
          const value = typeof tween.value === 'number' ? tween.value : null;
          if (value !== null && value < previous - 1e-9) monotonic = false;
          if (value !== null) previous = value;
        }
        s.ok('Tween value 单调不减', monotonic, 'last=' + String(previous));
        s.ok('Tween 结束后 done', tween.done === true, 'done=' + String(tween.done));
        s.near('Tween 结束值为 to', tween.value, 1);
      });
    } else {
      await s.group('deal animation state machine', async () => {
        const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
        function create() {
          if (typeof dealFactory === 'function') {
            try {
              return instantiate(dealFactory, { cards: cards, duration: 0.4, stagger: 0.05 });
            } catch (err) {
              return dealFactory({ cards: cards, duration: 0.4, stagger: 0.05 });
            }
          }
          return dealFactory;
        }

        const animation = create();
        s.ok('可创建发牌动效实例', animation != null);
        if (!animation) return;

        const stepFn = fnOf(animation, ['step', 'update', 'tick', 'advance']) ||
          fnOf(api, ['stepDealAnimation', 'updateDealAnimation']);
        s.ok('提供 step/update/tick 推进函数', typeof stepFn === 'function',
          'expected step / update / tick / advance');

        function phaseOf(value) {
          if (!value) return undefined;
          if (typeof value === 'string') return value;
          return value.state || value.status || value.phase;
        }

        function dealtCount(value) {
          if (!value) return 0;
          if (typeof value.dealtCount === 'number') return value.dealtCount;
          if (typeof value.count === 'number') return value.count;
          if (Array.isArray(value.cardStates)) {
            return value.cardStates.filter(function (card) { return card.dealt === true; }).length;
          }
          if (Array.isArray(value.cards)) {
            return value.cards.filter(function (card) { return card.dealt === true; }).length;
          }
          return 0;
        }

        function isSettled(value) {
          if (!value) return false;
          if (value.settled === true || value.done === true || value.finished === true) return true;
          const phase = phaseOf(value);
          return phase === 'settled' || phase === 'done' || phase === 'idle' && dealtCount(value) === cards.length;
        }

        if (!stepFn) return;

        const initialPhase = phaseOf(animation);
        s.ok('初始状态不是 settled', !isSettled(animation),
          'phase=' + String(initialPhase) + ', dealt=' + dealtCount(animation));
        s.eq('初始已发牌数为 0', dealtCount(animation), 0);

        let previous = dealtCount(animation);
        let monotonic = true;
        for (let i = 0; i < 20; i += 1) {
          const result = await call(stepFn, animation, [0.05]);
          const view = result && typeof result === 'object' ? result : animation;
          const current = dealtCount(view);
          if (current < previous) monotonic = false;
          previous = current;
          if (isSettled(view)) break;
        }
        s.ok('已发牌数单调不减', monotonic);
        s.eq('推进结束后所有牌已发出', dealtCount(animation), cards.length);
        s.ok('推进结束后状态为 settled', isSettled(animation),
          'phase=' + String(phaseOf(animation)));

        const after = dealtCount(animation);
        await call(stepFn, animation, [0.05]);
        s.eq('settled 后再 step 不重复发牌', dealtCount(animation), after);
      });
    }
  }
});
