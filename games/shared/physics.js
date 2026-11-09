/* Shared 2D physics engine for the games.

   UMD: browsers read window.Physics (pages include this file before their
   inline core), Node reads module.exports. No dependencies, one file.

   Scope
   -----
   This is a deliberately small engine for *effects*: dealing cards, a chess
   piece hopping between squares, confetti-like particles. It is not a
   general-purpose rigid-body library. A body has a position, linear velocity,
   angle, angular velocity, mass, restitution and friction. Two shapes exist:
   circles and axis-aligned boxes (AABB). Cards are boxes that also carry an
   angle; the angle is integrated and rendered with a CSS transform, but
   collision detection always uses the unrotated AABB. That approximation is
   fine for cards and keeps the contact math short and stable.

   Determinism
   -----------
   Math.random and wall-clock time are never read. Every operation is plain
   arithmetic in a fixed order, so the same initial state and the same step
   calls produce bit-identical results. `world.step(dt)` feeds a fixed-step
   accumulator; call it with the same dt sequence and you get the same
   simulation on every run (and on every browser, to the extent that IEEE-754
   arithmetic and Math.sqrt/cos/sin agree).

   Sub-stepping and tunnelling
   ---------------------------
   Each fixed step is split into `substeps` smaller integrations. Collision
   detection runs after every sub-step, so a fast body is caught on the way
   through a thin wall instead of jumping to the far side. A 3000 px/s body
   crosses 50 px in one 1/60 s step; with 16 sub-steps it moves 3.125 px at a
   time, which is less than a 5 px wall, so contact is found. With
   substeps: 1 the same body jumps clean over the wall (see physics.test.js,
   which asserts both the safe case and the tunnelling control).

   Sleeping
   --------
   A dynamic body whose linear speed and angular speed stay under the
   thresholds for `sleepTime` seconds is put to sleep: velocities are zeroed
   and it stops integrating. A sleeper still acts as a collider (as if it
   were static) and is woken by a fast contact or by applyImpulse.

   Units
   -----
   Pixels and seconds. Gravity defaults to {x: 0, y: 900} (screen y points
   down). Angles are radians, clockwise positive.

   API
   ---
   var world = Physics.createWorld({gravity: {x: 0, y: 900}})
   var card = world.addBody({shape: 'aabb', w: 80, h: 110, x: 0, y: 0,
                             mass: 1, restitution: 0.3, friction: 0.4})
   var ball = world.addBody({shape: 'circle', r: 8, x: 40, y: 0})
   world.addBody({shape: 'aabb', w: 800, h: 20, x: 0, y: 400, static: true})
   Physics.spring(card, {x: 100, y: 100}, {stiffness: 120, damping: 12})
   Physics.applyImpulse(card, {x: 250, y: -400})
   world.step(dt)                       // fixed-step accumulator
   world.bodies                         // read-only copy of the body list

   Optional body filters: group (default 1) and mask (default all bits). Two
   bodies collide only if (a.mask & b.group) and (b.mask & a.group) are both
   non-zero; card effects use group 2 / mask ~2 to ignore each other.

   Extras: Physics.fixedPoint(body, {x, y}) pins a point of a body in space;
   world.removeBody(body), world.addConstraint(c), world.removeConstraint(c),
   body.wake(), body.sleep().
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Physics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  var nextBodyId = 1;
  var nextConstraintId = 1;

  function num(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : d;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function isBody(x) {
    return !!(x && x._isPhysicsBody === true);
  }

  /* ------------------------------------------------------------------ *
   * Bodies                                                             *
   * ------------------------------------------------------------------ */

  var bodyProto = {
    // A static body cannot sleep or be woken; sleeping a body freezes it.
    wake: function () {
      if (this.static) return this;
      this.sleeping = false;
      this.sleepTimer = 0;
      return this;
    },
    sleep: function () {
      if (this.static) return this;
      this.sleeping = true;
      this.vx = 0;
      this.vy = 0;
      this.angularVelocity = 0;
      return this;
    }
  };

  function makeBody(world, o) {
    o = o || {};
    var shape = o.shape === 'circle' ? 'circle' : 'aabb';
    var isStatic = !!(o.static || o.isStatic || o.mass === 0);
    var mass = isStatic ? 0 : num(o.mass, 1);
    if (!(mass > 0)) { isStatic = true; mass = 0; }

    var b = Object.create(bodyProto);
    b._isPhysicsBody = true;
    b._world = world;
    b.id = nextBodyId++;
    b.shape = shape;
    b.static = isStatic;
    b.mass = mass;
    b.invMass = isStatic ? 0 : 1 / mass;
    b.x = num(o.x, 0);
    b.y = num(o.y, 0);
    b.vx = isStatic ? 0 : num(o.vx, 0);
    b.vy = isStatic ? 0 : num(o.vy, 0);
    b.angle = num(o.angle, 0);
    b.angularVelocity = isStatic ? 0 : num(o.angularVelocity, num(o.av, 0));
    b.restitution = clamp(num(o.restitution, 0.3), 0, 1);
    b.friction = Math.max(0, num(o.friction, 0.4));
    b.linearDamping = Math.max(0, num(o.linearDamping, 0));
    b.angularDamping = Math.max(0, num(o.angularDamping, 0));
    b.gravityScale = num(o.gravityScale, 1);
    // Collision filtering: two bodies touch only when each one's mask
    // includes the other's group. Defaults let everything collide. Effects
    // like flying cards use group 2 / mask ~2 so they pass through each
    // other but still bounce off the table.
    b.group = o.group == null ? 1 : (o.group | 0);
    b.mask = o.mask == null ? -1 : (o.mask | 0);
    b.fixedRotation = !!o.fixedRotation;
    b.sleeping = isStatic ? false : !!o.sleeping;
    b.sleepTimer = 0;
    b.label = o.label;
    b.userData = o.userData;

    if (shape === 'circle') {
      b.radius = Math.max(1e-6, num(o.radius, num(o.r, 10)));
      b.inertia = isStatic || b.fixedRotation ? 0 : 0.5 * mass * b.radius * b.radius;
    } else {
      b.w = Math.max(1e-6, num(o.w, 10));
      b.h = Math.max(1e-6, num(o.h, 10));
      b.hw = b.w / 2;
      b.hh = b.h / 2;
      b.inertia = isStatic || b.fixedRotation ? 0 : mass * (b.w * b.w + b.h * b.h) / 12;
    }
    b.invInertia = b.inertia > 0 ? 1 / b.inertia : 0;

    // Scratch accumulators, reset every sub-step.
    b._ax = 0;
    b._ay = 0;
    return b;
  }

  function isStaticOrSleeping(b) {
    return b.static || b.sleeping;
  }

  function minX(b) { return b.shape === 'circle' ? b.x - b.radius : b.x - b.hw; }
  function maxX(b) { return b.shape === 'circle' ? b.x + b.radius : b.x + b.hw; }
  function minY(b) { return b.shape === 'circle' ? b.y - b.radius : b.y - b.hh; }
  function maxY(b) { return b.shape === 'circle' ? b.y + b.radius : b.y + b.hh; }

  /* ------------------------------------------------------------------ *
   * Narrow phase                                                       *
   * ------------------------------------------------------------------ */

  // All detectors return {nx, ny, penetration} with the normal pointing
  // from a to b, or null. Rotation is intentionally ignored for AABBs.

  function detectCircleCircle(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var rsum = a.radius + b.radius;
    var d2 = dx * dx + dy * dy;
    if (d2 > rsum * rsum) return null;
    var d = Math.sqrt(d2);
    if (d > 1e-9) return { nx: dx / d, ny: dy / d, penetration: rsum - d };
    return { nx: 1, ny: 0, penetration: rsum };
  }

  // a = circle, b = box. Normal points from the circle to the box.
  function detectCircleBox(a, b) {
    var qx = clamp(a.x, b.x - b.hw, b.x + b.hw);
    var qy = clamp(a.y, b.y - b.hh, b.y + b.hh);
    var dx = a.x - qx;               // box -> circle
    var dy = a.y - qy;
    var d2 = dx * dx + dy * dy;
    if (d2 > a.radius * a.radius) return null;
    if (d2 > 1e-12) {
      var d = Math.sqrt(d2);
      return { nx: -dx / d, ny: -dy / d, penetration: a.radius - d };
    }
    // Centre is inside the box: push out through the nearest face.
    var left = a.x - (b.x - b.hw);
    var right = (b.x + b.hw) - a.x;
    var top = a.y - (b.y - b.hh);
    var bottom = (b.y + b.hh) - a.y;
    var m = Math.min(left, right, top, bottom);
    if (m === left) return { nx: 1, ny: 0, penetration: a.radius + left };
    if (m === right) return { nx: -1, ny: 0, penetration: a.radius + right };
    if (m === top) return { nx: 0, ny: 1, penetration: a.radius + top };
    return { nx: 0, ny: -1, penetration: a.radius + bottom };
  }

  // a = box, b = circle. Invert the circle-box result.
  function detectBoxCircle(a, b) {
    var c = detectCircleBox(b, a);
    if (!c) return null;
    return { nx: -c.nx, ny: -c.ny, penetration: c.penetration };
  }

  function detectBoxBox(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var ox = (a.hw + b.hw) - Math.abs(dx);
    if (ox <= 0) return null;
    var oy = (a.hh + b.hh) - Math.abs(dy);
    if (oy <= 0) return null;
    if (ox < oy) return { nx: dx < 0 ? -1 : 1, ny: 0, penetration: ox };
    return { nx: 0, ny: dy < 0 ? -1 : 1, penetration: oy };
  }

  function detect(a, b) {
    var sa = a.shape;
    var sb = b.shape;
    if (sa === 'circle' && sb === 'circle') return detectCircleCircle(a, b);
    if (sa === 'circle') return detectCircleBox(a, b);
    if (sb === 'circle') return detectBoxCircle(a, b);
    return detectBoxBox(a, b);
  }

  /* ------------------------------------------------------------------ *
   * World                                                              *
   * ------------------------------------------------------------------ */

  function World(options) {
    options = options || {};
    var g = options.gravity || {};
    this.gravity = { x: num(g.x, 0), y: num(g.y, 900) };
    this.fixedDt = num(options.fixedDt, 1 / 60);
    if (!(this.fixedDt > 0)) this.fixedDt = 1 / 60;
    this.substeps = Math.max(1, Math.floor(num(options.substeps, 1)));
    this.iterations = Math.max(1, Math.floor(num(options.iterations, 4)));
    this.positionIterations = Math.max(1, Math.floor(num(options.positionIterations, 2)));
    this.sleepEnabled = options.sleep !== false;
    this.sleepTime = Math.max(0, num(options.sleepTime, 2));
    this.sleepLinear = Math.max(0, num(options.sleepLinear, 2));
    this.sleepAngular = Math.max(0, num(options.sleepAngular, 0.02));
    this.wakeSpeed = Math.max(0, num(options.wakeSpeed, 4));
    this.restitutionThreshold = Math.max(0, num(options.restitutionThreshold, 1));
    this.maxAccumulator = Math.max(this.fixedDt, num(options.maxAccumulator, 0.25));
    this.accumulator = 0;
    this.time = 0;
    this.steps = 0;
    this.contactCount = 0;
    this._bodies = [];
    this._constraints = [];
  }

  // Read-only view: every access returns a fresh array so callers cannot push
  // into the simulation's storage. The body objects themselves are shared.
  Object.defineProperty(World.prototype, 'bodies', {
    get: function () { return this._bodies.slice(); }
  });

  World.prototype.addBody = function (options) {
    var b = makeBody(this, options);
    this._bodies.push(b);
    return b;
  };

  World.prototype.removeBody = function (body) {
    var i = this._bodies.indexOf(body);
    if (i >= 0) this._bodies.splice(i, 1);
    for (var j = this._constraints.length - 1; j >= 0; j--) {
      var c = this._constraints[j];
      if (c.a === body || c.b === body) this._constraints.splice(j, 1);
    }
    if (body) body._world = null;
    return this;
  };

  World.prototype.addConstraint = function (c) {
    if (!c) return this;
    var i = this._constraints.indexOf(c);
    if (i < 0) {
      this._constraints.push(c);
      c._world = this;
    }
    return this;
  };

  World.prototype.removeConstraint = function (c) {
    var i = this._constraints.indexOf(c);
    if (i >= 0) {
      this._constraints.splice(i, 1);
      c._world = null;
    }
    return this;
  };

  World.prototype.wakeAll = function () {
    for (var i = 0; i < this._bodies.length; i++) this._bodies[i].wake();
    return this;
  };

  World.prototype.applyImpulse = function (body, impulse, at) {
    return applyImpulse(body, impulse, at);
  };

  // Advance by dt seconds through a fixed-step accumulator. Leftover time is
  // kept for the next call; a huge dt is capped so a stalled tab cannot make
  // the next frame spiral.
  World.prototype.step = function (dt) {
    if (!(dt > 0) || !isFinite(dt)) return this;
    this.accumulator += dt;
    if (this.accumulator > this.maxAccumulator) this.accumulator = this.maxAccumulator;
    var h = this.fixedDt;
    var guard = 0;
    var maxSteps = Math.ceil(this.maxAccumulator / h) + 1;
    while (this.accumulator + 1e-9 >= h && guard < maxSteps) {
      this._stepFixed(h);
      this.accumulator -= h;
      if (this.accumulator < 0) this.accumulator = 0;
      guard++;
    }
    return this;
  };

  World.prototype._stepFixed = function (dt) {
    this.time += dt;
    this.steps++;
    var n = this.substeps | 0;
    if (n < 1) n = 1;
    var h = dt / n;
    for (var i = 0; i < n; i++) this._substep(h);
  };

  World.prototype._substep = function (h) {
    var bodies = this._bodies;
    var i, b, n = bodies.length;
    var gx = this.gravity.x;
    var gy = this.gravity.y;

    // 1. Gather accelerations: gravity plus spring forces.
    for (i = 0; i < n; i++) {
      b = bodies[i];
      b._ax = 0;
      b._ay = 0;
    }
    for (i = 0; i < n; i++) {
      b = bodies[i];
      if (b.static || b.sleeping) continue;
      b._ax += gx * b.gravityScale;
      b._ay += gy * b.gravityScale;
    }
    var constraints = this._constraints;
    for (i = 0; i < constraints.length; i++) {
      var c = constraints[i];
      if (c.type === 'spring') this._applySpring(c);
    }

    // 2. Integrate with symplectic Euler (velocity first, then position with
    //    the new velocity). That keeps spring energy bounded. The small
    //    -0.5*g*h^2 term cancels the Euler overshoot for gravity only, so a
    //    free fall lands on 0.5*g*t^2; subtract spring/other accelerations
    //    here instead and the scheme becomes the energy-growing variant.
    for (i = 0; i < n; i++) {
      b = bodies[i];
      if (b.static || b.sleeping) continue;
      var ax = b._ax;
      var ay = b._ay;
      var gax = gx * b.gravityScale;
      var gay = gy * b.gravityScale;
      b.vx += ax * h;
      b.vy += ay * h;
      if (b.linearDamping > 0) {
        var ld = 1 / (1 + b.linearDamping * h);
        b.vx *= ld;
        b.vy *= ld;
      }
      b.x += b.vx * h - 0.5 * gax * h * h;
      b.y += b.vy * h - 0.5 * gay * h * h;
      b.angle += b.angularVelocity * h;
      if (b.angularDamping > 0) {
        b.angularVelocity /= 1 + b.angularDamping * h;
      }
    }

    // 3. Collisions: velocity impulses, then positional projection.
    var contacts = this._collectContacts();
    this.contactCount = contacts.length;
    if (contacts.length) {
      this._solveVelocities(contacts);
      this._solvePositions(contacts);
    }

    // 4. Hard constraints (fixed points) win over collisions.
    for (i = 0; i < constraints.length; i++) {
      if (constraints[i].type === 'pin') this._solvePin(constraints[i]);
    }

    // 5. Sleep bookkeeping.
    if (this.sleepEnabled) this._updateSleep(h);
  };

  World.prototype._applySpring = function (s) {
    var a = s.a;
    var b = s.b;
    var ax = a.x;
    var ay = a.y;
    if (s.localA.x !== 0 || s.localA.y !== 0) {
      var ca = Math.cos(a.angle);
      var sa = Math.sin(a.angle);
      ax += s.localA.x * ca - s.localA.y * sa;
      ay += s.localA.x * sa + s.localA.y * ca;
    }
    var bx, by, bvx = 0, bvy = 0;
    if (s.isPoint) {
      bx = b.x;
      by = b.y;
    } else {
      bx = b.x;
      by = b.y;
      if (s.localB.x !== 0 || s.localB.y !== 0) {
        var cb = Math.cos(b.angle);
        var sb = Math.sin(b.angle);
        bx += s.localB.x * cb - s.localB.y * sb;
        by += s.localB.x * sb + s.localB.y * cb;
      }
      bvx = b.vx;
      bvy = b.vy;
    }
    var dx = bx - ax;
    var dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) return;
    var ux = dx / len;
    var uy = dy / len;
    var rel = (bvx - a.vx) * ux + (bvy - a.vy) * uy;
    var force = s.stiffness * (len - s.restLength) + s.damping * rel;
    if (force > s.maxForce) force = s.maxForce;
    else if (force < -s.maxForce) force = -s.maxForce;
    var fx = ux * force;
    var fy = uy * force;
    if (!a.static && !a.sleeping) {
      a._ax += fx * a.invMass;
      a._ay += fy * a.invMass;
    }
    if (!s.isPoint && !b.static && !b.sleeping) {
      b._ax -= fx * b.invMass;
      b._ay -= fy * b.invMass;
    }
  };

  World.prototype._collectContacts = function () {
    var bodies = this._bodies;
    var n = bodies.length;
    var out = [];
    var wake2 = this.wakeSpeed * this.wakeSpeed;
    for (var i = 0; i < n; i++) {
      var a = bodies[i];
      for (var j = i + 1; j < n; j++) {
        var b = bodies[j];
        // Two immovable participants can never need a contact: both are
        // static, both asleep, or one is static and the other asleep.
        if ((a.static || a.sleeping) && (b.static || b.sleeping)) continue;
        // Collision filter (group / mask).
        if ((a.mask & b.group) === 0 || (b.mask & a.group) === 0) continue;
        // Cheap broad phase before the shape-specific test.
        if (maxX(a) < minX(b) || maxX(b) < minX(a) ||
            maxY(a) < minY(b) || maxY(b) < minY(a)) continue;
        var m = detect(a, b);
        if (!m) continue;

        // A fast body wakes a sleeper it hits; a slow one treats it as static
        // so resting piles stay quiet.
        if (a.sleeping && !b.static && !b.sleeping) {
          if (b.vx * b.vx + b.vy * b.vy > wake2) a.wake();
        } else if (b.sleeping && !a.static && !a.sleeping) {
          if (a.vx * a.vx + a.vy * a.vy > wake2) b.wake();
        }

        var invA = isStaticOrSleeping(a) ? 0 : a.invMass;
        var invB = isStaticOrSleeping(b) ? 0 : b.invMass;
        var sum = invA + invB;
        if (!(sum > 0)) continue;

        var vn = (b.vx - a.vx) * m.nx + (b.vy - a.vy) * m.ny;
        var e = -vn > this.restitutionThreshold
          ? (a.restitution + b.restitution) * 0.5
          : 0;
        out.push({
          a: a, b: b,
          nx: m.nx, ny: m.ny,
          penetration: m.penetration,
          invA: invA, invB: invB, sum: sum,
          restitution: e,
          friction: Math.sqrt(a.friction * b.friction),
          jn: 0
        });
      }
    }
    return out;
  };

  World.prototype._solveVelocities = function (contacts) {
    var iterations = this.iterations;
    for (var it = 0; it < iterations; it++) {
      for (var k = 0; k < contacts.length; k++) {
        var c = contacts[k];
        var a = c.a;
        var b = c.b;
        var nx = c.nx;
        var ny = c.ny;
        var rvx = b.vx - a.vx;
        var rvy = b.vy - a.vy;
        var vn = rvx * nx + rvy * ny;

        if (vn < 0) {
          var j = -(1 + c.restitution) * vn / c.sum;
          if (j > 0) {
            c.jn += j;
            a.vx -= j * nx * c.invA;
            a.vy -= j * ny * c.invA;
            b.vx += j * nx * c.invB;
            b.vy += j * ny * c.invB;
          }
        }

        // Coulomb friction along the tangent. The normal impulse accumulated
        // so far bounds the tangential impulse.
        if (c.jn > 0) {
          rvx = b.vx - a.vx;
          rvy = b.vy - a.vy;
          var vn2 = rvx * nx + rvy * ny;
          var tx = rvx - vn2 * nx;
          var ty = rvy - vn2 * ny;
          var tl = Math.sqrt(tx * tx + ty * ty);
          if (tl > 1e-9) {
            tx /= tl;
            ty /= tl;
            var jt = -(rvx * tx + rvy * ty) / c.sum;
            var maxJt = c.friction * c.jn;
            if (jt > maxJt) jt = maxJt;
            else if (jt < -maxJt) jt = -maxJt;
            a.vx -= jt * tx * c.invA;
            a.vy -= jt * ty * c.invA;
            b.vx += jt * tx * c.invB;
            b.vy += jt * ty * c.invB;
          }
        }
      }
    }
  };

  World.prototype._solvePositions = function (contacts) {
    var passes = this.positionIterations;
    for (var p = 0; p < passes; p++) {
      for (var k = 0; k < contacts.length; k++) {
        var c = contacts[k];
        // Re-measure: another contact may have moved one of the bodies.
        var d = detect(c.a, c.b);
        if (!d) continue;
        var invA = isStaticOrSleeping(c.a) ? 0 : c.a.invMass;
        var invB = isStaticOrSleeping(c.b) ? 0 : c.b.invMass;
        var sum = invA + invB;
        if (!(sum > 0)) continue;
        var corr = d.penetration / sum;
        c.a.x -= d.nx * corr * invA;
        c.a.y -= d.ny * corr * invA;
        c.b.x += d.nx * corr * invB;
        c.b.y += d.ny * corr * invB;
      }
    }
  };

  World.prototype._solvePin = function (pin) {
    var b = pin.body;
    if (b.static || b.sleeping) return;
    var ca = Math.cos(b.angle);
    var sa = Math.sin(b.angle);
    var wx = pin.local.x * ca - pin.local.y * sa;
    var wy = pin.local.x * sa + pin.local.y * ca;
    var ax = b.x + wx;
    var ay = b.y + wy;
    var dx = pin.x - ax;
    var dy = pin.y - ay;
    if (dx === 0 && dy === 0) return;
    b.x += dx;
    b.y += dy;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-12) {
      var nx = dx / len;
      var ny = dy / len;
      var vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= vn * nx;
        b.vy -= vn * ny;
      }
    }
  };

  World.prototype._updateSleep = function (dt) {
    var bodies = this._bodies;
    var lin2 = this.sleepLinear * this.sleepLinear;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.static || b.sleeping) continue;
      var slow = b.vx * b.vx + b.vy * b.vy <= lin2 &&
        Math.abs(b.angularVelocity) <= this.sleepAngular;
      if (slow) {
        b.sleepTimer += dt;
        if (b.sleepTimer >= this.sleepTime) b.sleep();
      } else {
        b.sleepTimer = 0;
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Public helpers                                                     *
   * ------------------------------------------------------------------ */

  function applyImpulse(body, impulse, at) {
    if (!body || !impulse) return body;
    var ix = num(impulse.x, 0);
    var iy = num(impulse.y, 0);
    body.wake();
    if (!body.static) {
      body.vx += ix * body.invMass;
      body.vy += iy * body.invMass;
      if (at && body.invInertia) {
        var rx = num(at.x, body.x) - body.x;
        var ry = num(at.y, body.y) - body.y;
        body.angularVelocity += (rx * iy - ry * ix) * body.invInertia;
      }
    }
    return body;
  }

  function spring(a, b, options) {
    var o = options || {};
    var isPoint = !isBody(b);
    var localA = { x: num(o.anchorA && o.anchorA.x, 0), y: num(o.anchorA && o.anchorA.y, 0) };
    var localB = isPoint ? { x: 0, y: 0 } : { x: num(o.anchorB && o.anchorB.x, 0), y: num(o.anchorB && o.anchorB.y, 0) };
    var ax = a.x + localA.x;
    var ay = a.y + localA.y;
    var bx = isPoint ? b.x : b.x + localB.x;
    var by = isPoint ? b.y : b.y + localB.y;
    var current = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    var c = {
      id: nextConstraintId++,
      type: 'spring',
      a: a,
      b: b,
      isPoint: isPoint,
      localA: localA,
      localB: localB,
      stiffness: Math.max(0, num(o.stiffness, 100)),
      damping: Math.max(0, num(o.damping, 10)),
      restLength: num(o.restLength, current),
      maxForce: num(o.maxForce, 1e6),
      _world: null
    };
    var wa = isBody(a) ? a._world : null;
    var wb = isBody(b) ? b._world : null;
    if (wa && (!wb || wa === wb)) wa.addConstraint(c);
    else if (wb) wb.addConstraint(c);
    return c;
  }

  // Pin a local point of a body to a world-space point. The body is moved so
  // the anchor matches after each sub-step, and velocity into the pin is
  // removed; the body can still slide tangentially.
  function fixedPoint(body, point, options) {
    var o = options || {};
    var c = {
      id: nextConstraintId++,
      type: 'pin',
      body: body,
      x: num(o.x, num(point && point.x, 0)),
      y: num(o.y, num(point && point.y, 0)),
      local: {
        x: num(o.localX, num(options && options.anchor && options.anchor.x, 0)),
        y: num(o.localY, num(options && options.anchor && options.anchor.y, 0))
      },
      _world: null
    };
    if (isBody(body) && body._world) body._world.addConstraint(c);
    return c;
  }

  function createWorld(options) {
    return new World(options);
  }

  return {
    VERSION: VERSION,
    createWorld: createWorld,
    World: World,
    spring: spring,
    fixedPoint: fixedPoint,
    applyImpulse: applyImpulse
  };
});
