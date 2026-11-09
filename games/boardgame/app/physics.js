'use strict';

/*
 * 轻量 2D 物理 / 缓动工具（纯函数 + 小类，无 DOM、无依赖）。
 *
 * 用途：发牌飞行动画、卡牌落位、麻将牌入河、轻量碰撞检测。
 * 所有时间由调用方传入（dt / elapsed），不读时钟；不使用 Math.random。
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function vec(x, y) {
  return { x: x || 0, y: y || 0 };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a, k) {
  return { x: a.x * k, y: a.y * k };
}

export function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distance(a, b) {
  return length(sub(a, b));
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export const EASING = {
  linear: function (t) { return t; },
  easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
  easeInCubic: function (t) { return t * t * t; },
  easeInOutCubic: function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  easeOutBack: function (t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: function (t) {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
};

export function ease(name, t) {
  const fn = EASING[name] || EASING.linear;
  return fn(clamp(t, 0, 1));
}

/* ---------- 碰撞检测 ---------- */

export function aabbIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function circleIntersects(a, b) {
  const r = a.r + b.r;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= r * r;
}

export function circleAabbCircle(circle, box) {
  const cx = clamp(circle.x, box.x, box.x + box.w);
  const cy = clamp(circle.y, box.y, box.y + box.h);
  const dx = circle.x - cx;
  const dy = circle.y - cy;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

export function pointInAabb(point, box) {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

export function pointInCircle(point, circle) {
  const dx = point.x - circle.x;
  const dy = point.y - circle.y;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

export function overlapAmount(a, b) {
  return {
    x: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    y: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  };
}

/* ---------- 缓动 / 发牌动画 ---------- */

export class Tween {
  constructor(options) {
    const opts = options || {};
    this.from = opts.from || 0;
    this.to = opts.to == null ? 1 : opts.to;
    this.duration = Math.max(0.001, opts.duration == null ? 300 : opts.duration);
    this.delay = Math.max(0, opts.delay || 0);
    this.easing = typeof opts.easing === 'function' ? opts.easing : (EASING[opts.easing] || EASING.easeOutCubic);
    this.elapsed = 0;
    this.value = this.from;
    this.done = false;
    this.onUpdate = opts.onUpdate || null;
    this.onDone = opts.onDone || null;
  }

  update(dt) {
    if (this.done) return this.value;
    this.elapsed += Math.max(0, dt);
    const local = clamp((this.elapsed - this.delay) / this.duration, 0, 1);
    this.value = lerp(this.from, this.to, this.easing(local));
    if (this.onUpdate) this.onUpdate(this.value, local);
    if (local >= 1) {
      this.done = true;
      if (this.onDone) this.onDone(this.value);
    }
    return this.value;
  }

  reset() {
    this.elapsed = 0;
    this.value = this.from;
    this.done = false;
    return this;
  }
}

export function createTween(options) {
  return new Tween(options);
}

/*
 * 发牌计划：返回每张牌的起止点、延迟、时长与缓动名。
 * 页面可以直接把 from/to 写进 CSS transform，或交给 Tween 驱动。
 */
export function dealPlan(options) {
  const opts = options || {};
  const count = Math.max(0, Math.floor(opts.count || 0));
  const from = opts.from || { x: 0, y: 0 };
  const to = opts.to || { x: 0, y: 0 };
  const stagger = Math.max(0, opts.stagger == null ? 60 : opts.stagger);
  const duration = Math.max(1, opts.duration == null ? 320 : opts.duration);
  const easing = opts.easing || 'easeOutCubic';
  const spread = opts.spread || { x: 0, y: 0 };
  const plan = [];
  for (let i = 0; i < count; i += 1) {
    plan.push({
      index: i,
      from: { x: from.x, y: from.y },
      to: {
        x: to.x + (opts.arc ? spread.x * Math.sin((i / Math.max(1, count - 1)) * Math.PI) : 0),
        y: to.y + (opts.arc ? spread.y * Math.sin((i / Math.max(1, count - 1)) * Math.PI) : 0)
      },
      delay: i * stagger,
      duration: duration,
      easing: easing,
      endAt: i * stagger + duration
    });
  }
  return plan;
}

/* ---------- 轻量刚体世界（卡牌/麻将演示够用） ---------- */

export function createBody(options) {
  const opts = options || {};
  return {
    shape: opts.shape === 'circle' ? 'circle' : 'aabb',
    x: opts.x || 0,
    y: opts.y || 0,
    vx: opts.vx || 0,
    vy: opts.vy || 0,
    w: opts.w || opts.width || 40,
    h: opts.h || opts.height || 60,
    r: opts.r || opts.radius || 20,
    mass: opts.mass == null ? 1 : opts.mass,
    restitution: opts.restitution == null ? 0.35 : opts.restitution,
    friction: opts.friction == null ? 0.9 : opts.friction,
    isStatic: Boolean(opts.isStatic || opts.static),
    tag: opts.tag || ''
  };
}

function bodyBounds(body) {
  if (body.shape === 'circle') {
    return { x: body.x - body.r, y: body.y - body.r, w: body.r * 2, h: body.r * 2 };
  }
  return { x: body.x, y: body.y, w: body.w, h: body.h };
}

export class World {
  constructor(options) {
    const opts = options || {};
    this.gravity = opts.gravity == null ? 0 : opts.gravity;
    this.bounds = opts.bounds || null;
    this.bodies = [];
  }

  addBody(body) {
    this.bodies.push(body);
    return body;
  }

  removeBody(body) {
    const i = this.bodies.indexOf(body);
    if (i !== -1) this.bodies.splice(i, 1);
    return i !== -1;
  }

  step(dt) {
    const seconds = Math.max(0, Math.min(0.05, dt || 0));
    this.bodies.forEach((body) => {
      if (body.isStatic) return;
      body.vy += this.gravity * seconds;
      body.x += body.vx * seconds;
      body.y += body.vy * seconds;
      body.vx *= Math.pow(body.friction, seconds * 60);
      body.vy *= Math.pow(body.friction, seconds * 60);
      this._bounce(body);
    });
    this._resolve();
    return this.bodies;
  }

  _bounce(body) {
    const bounds = this.bounds;
    if (!bounds) return;
    const box = bodyBounds(body);
    if (box.x < bounds.x) {
      body.x += bounds.x - box.x;
      body.vx = Math.abs(body.vx) * body.restitution;
    } else if (box.x + box.w > bounds.x + bounds.w) {
      body.x -= box.x + box.w - (bounds.x + bounds.w);
      body.vx = -Math.abs(body.vx) * body.restitution;
    }
    if (box.y < bounds.y) {
      body.y += bounds.y - box.y;
      body.vy = Math.abs(body.vy) * body.restitution;
    } else if (box.y + box.h > bounds.y + bounds.h) {
      body.y -= box.y + box.h - (bounds.y + bounds.h);
      body.vy = -Math.abs(body.vy) * body.restitution;
    }
  }

  _resolve() {
    for (let i = 0; i < this.bodies.length; i += 1) {
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (a.isStatic && b.isStatic) continue;
        if (a.shape === 'circle' && b.shape === 'circle') {
          if (circleIntersects(a, b)) separateCircles(a, b);
        } else if (a.shape === 'circle' || b.shape === 'circle') {
          const circle = a.shape === 'circle' ? a : b;
          const box = a.shape === 'circle' ? b : a;
          if (circleAabbCircle(circle, bodyBounds(box))) separateCircleBox(circle, box);
        } else {
          const overlap = overlapAmount(bodyBounds(a), bodyBounds(b));
          if (overlap.x > 0 && overlap.y > 0) separateBoxes(a, b, overlap);
        }
      }
    }
  }
}

function separateCircles(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const overlap = a.r + b.r - dist;
  if (overlap <= 0) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const total = a.isStatic ? 1 : b.isStatic ? 1 : 2;
  const push = overlap / total;
  if (!a.isStatic) { a.x -= nx * push; a.y -= ny * push; }
  if (!b.isStatic) { b.x += nx * push; b.y += ny * push; }
  const impulse = Math.max(0, a.vx * nx + a.vy * ny) * (1 + a.restitution);
  if (!a.isStatic) { a.vx -= impulse * nx; a.vy -= impulse * ny; }
  if (!b.isStatic) { b.vx += impulse * nx; b.vy += impulse * ny; }
}

function separateCircleBox(circle, boxBody) {
  const box = bodyBounds(boxBody);
  const closestX = clamp(circle.x, box.x, box.x + box.w);
  const closestY = clamp(circle.y, box.y, box.y + box.h);
  let dx = circle.x - closestX;
  let dy = circle.y - closestY;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > circle.r) return;
  if (dist === 0) {
    dx = circle.x < box.x + box.w / 2 ? -1 : 1;
    dy = 0;
    dist = 1;
  }
  const push = circle.r - dist;
  if (!circle.isStatic) {
    circle.x += (dx / dist) * push;
    circle.y += (dy / dist) * push;
    circle.vx *= -circle.restitution;
    circle.vy *= -circle.restitution;
  }
}

function separateBoxes(a, b, overlap) {
  const boxA = bodyBounds(a);
  const boxB = bodyBounds(b);
  const pushX = overlap.x / 2;
  const pushY = overlap.y / 2;
  if (overlap.x < overlap.y) {
    const dir = boxA.x < boxB.x ? -1 : 1;
    if (!a.isStatic) a.x += dir * pushX;
    if (!b.isStatic) b.x -= dir * pushX;
    if (!a.isStatic) a.vx *= -a.restitution;
    if (!b.isStatic) b.vx *= -b.restitution;
  } else {
    const dir = boxA.y < boxB.y ? -1 : 1;
    if (!a.isStatic) a.y += dir * pushY;
    if (!b.isStatic) b.y -= dir * pushY;
    if (!a.isStatic) a.vy *= -a.restitution;
    if (!b.isStatic) b.vy *= -b.restitution;
  }
}

export function createWorld(options) {
  return new World(options);
}

/* ---------- C 模块契约兼容别名（app/physics.mjs 测试） ---------- */

function rectOf(rect) {
  if (!rect || typeof rect !== 'object') return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: Number(rect.x) || 0,
    y: Number(rect.y) || 0,
    w: rect.w != null ? rect.w : (rect.width || 0),
    h: rect.h != null ? rect.h : (rect.height || 0)
  };
}

export function aabbOverlap(a, b) {
  return aabbIntersects(rectOf(a), rectOf(b));
}

export const rectsOverlap = aabbOverlap;
export const rectOverlap = aabbOverlap;
export const collides = aabbOverlap;
export const overlaps = aabbOverlap;

export function circleRectOverlap(circle, rect) {
  const firstIsCircle = Boolean(circle && (circle.r != null || circle.radius != null));
  const c = firstIsCircle ? circle : rect;
  const r = firstIsCircle ? rect : circle;
  const radius = Number(c && (c.r != null ? c.r : c.radius)) || 0;
  return circleAabbCircle(
    { x: Number(c && c.x) || 0, y: Number(c && c.y) || 0, r: radius },
    rectOf(r)
  );
}

export const circleRectCollide = circleRectOverlap;
export const circleRect = circleRectOverlap;

export function pointInRect(point, rect) {
  return pointInAabb(
    { x: Number(point && point.x) || 0, y: Number(point && point.y) || 0 },
    rectOf(rect)
  );
}

export const pointInRect2D = pointInRect;
export const pointInsideRect = pointInRect;

export function moveCharacter(state, input, dt, bounds) {
  const body = state || {};
  const speed = Number(body.speed == null ? 100 : body.speed);
  let ix = Number(input && input.x) || 0;
  let iy = Number(input && input.y) || 0;
  const len = Math.sqrt(ix * ix + iy * iy);
  if (len > 0) {
    ix /= len;
    iy /= len;
  }
  const seconds = Number(dt) || 0;
  let x = (Number(body.x) || 0) + ix * speed * seconds;
  let y = (Number(body.y) || 0) + iy * speed * seconds;
  if (bounds) {
    const minX = bounds.minX != null ? bounds.minX : 0;
    const minY = bounds.minY != null ? bounds.minY : 0;
    const maxX = bounds.maxX != null ? bounds.maxX : (bounds.width != null ? bounds.width : Infinity);
    const maxY = bounds.maxY != null ? bounds.maxY : (bounds.height != null ? bounds.height : Infinity);
    x = clamp(x, minX, maxX);
    y = clamp(y, minY, maxY);
  }
  return { x: x, y: y };
}

export const stepCharacter = moveCharacter;
export const integrateMovement = moveCharacter;
export const moveEntity = moveCharacter;

export class DealAnimation {
  constructor(options) {
    const opts = options || {};
    const cards = Array.isArray(opts.cards) ? opts.cards : [];
    this.cards = cards.map(function (card) {
      const item = card && typeof card === 'object' ? Object.assign({}, card) : { id: card };
      item.dealt = false;
      return item;
    });
    this.cardStates = this.cards;
    this.duration = Number(opts.duration) || 0.4;
    this.stagger = Math.max(0.001, Number(opts.stagger) || 0.05);
    this.elapsed = 0;
    this.dealtCount = 0;
    this.settled = false;
    this.done = false;
    this.phase = 'dealing';
  }

  update(dt) {
    if (this.settled) return this;
    this.elapsed += Math.max(0, Number(dt) || 0);
    let count = 0;
    for (let i = 0; i < this.cards.length; i += 1) {
      if (this.elapsed >= (i + 1) * this.stagger) {
        this.cards[i].dealt = true;
        count += 1;
      }
    }
    this.dealtCount = count;
    if (count >= this.cards.length) {
      this.settled = true;
      this.done = true;
      this.phase = 'settled';
    }
    return this;
  }

  step(dt) { return this.update(dt); }
  tick(dt) { return this.update(dt); }
  advance(dt) { return this.update(dt); }
}

export function createDealAnimation(options) {
  return new DealAnimation(options);
}

export const createDealState = createDealAnimation;
export const dealAnimation = createDealAnimation;
