/* Generic two-player trading-card-game engine.

   One file, UMD, no dependencies. Browsers read window.TCG; Node reads
   module.exports.

   What is generic here
   -------------------
   The engine knows nothing about a particular world, card name or stat
   vocabulary. A card is plain JSON: {id, type, cost, atk, hp, effects,
   abilities}. Rules are assembled from declarative effect primitives
   (damage, heal, draw, discard, destroy, buff, debuff, resource) with
   target selectors (single / all / random, self / enemy / any).

   State shape
   -----------
   match.state is a deep, JSON-safe snapshot. Card definitions inside the
   snapshot are stripped to engine fields (no artwork, no DOM, no
   functions), so JSON.stringify -> JSON.parse is loss-free and replay is
   byte-comparable.

   Determinism
   -----------
   All randomness (shuffling, "random" targets) comes from an sfc32 stream
   seeded by FNV-1a. The stream state lives in the snapshot. Same seed +
   same action sequence therefore produces a bit-identical snapshot, on
   any JS engine: integer ops always go through Math.imul / >>> 0.

   Replay records
   --------------
   match.record() returns a JSON-safe record:
     { engineVersion, rng, ruleset, seed, result, setup, actions }
   The header identifies the engine ('tcg/v2'), the PRNG
   ('sfc32/fnv1a/v1' plus the seed and an initial-state digest) and the
   ruleset digest. match.replay(record) validates the header first and throws
   replay_version_mismatch / replay_rng_mismatch / replay_ruleset_mismatch
   when the record was made by a different build. Legacy records without a
   header (including the old bare action array) throw replay_legacy_format.
   match.replayLegacy(log) is the explicit opt-in migration path for such
   logs: it replays against this match's setup and performs no header check,
   so callers must only use it for logs they know belong to that setup.
   The snapshot also carries engineVersion, rngInfo and ruleset.

   Hidden information
   ------------------
   match.state / snapshot() are the full authoritative state (server use).
   viewFor(state, playerId) / snapshotFor(state, playerId) return a per-player
   view: opponent hand is replaced by face-down placeholders plus handCount,
   deck order is reduced to deckCount, and the RNG stream/seed are removed.
   Public zones (field, discard, exile), defs, rules and the result are kept.

   Error contract
   --------------
   Illegal actions throw TCG.Error with a stable machine code:
     match_over, not_your_turn, unknown_action, card_not_in_hand,
     unknown_card, not_enough_<resource>, target_required, target_invalid,
     unexpected_target, unit_not_found, unit_not_ready, ability_not_found,
     ability_used.
   Replay and view validation add: replay_legacy_format,
   replay_invalid_record, replay_version_mismatch, replay_rng_mismatch,
   replay_seed_mismatch, replay_ruleset_mismatch, invalid_player.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TCG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  // Replay compatibility tag. Bump this whenever a rules or PRNG change makes
  // old action logs replay differently. It is part of every replay record and
  // every snapshot, and replay() refuses records from another tag instead of
  // silently producing a different game.
  var ENGINE_VERSION = 'tcg/v2';
  var RULESET_VERSION = 'tcg-rules/v1';
  // PRNG implementation identifier: algorithm / seed hash / version.
  var RNG_NAME = 'sfc32/fnv1a/v1';

  /* ------------------------------------------------------------------ *
   * Errors                                                              *
   * ------------------------------------------------------------------ */

  function TCGError(code, message, detail) {
    this.name = 'TCGError';
    this.code = code;
    this.message = message || code;
    if (detail !== undefined) this.detail = detail;
    if (Error.captureStackTrace) Error.captureStackTrace(this, TCGError);
  }
  TCGError.prototype = Object.create(Error.prototype);
  TCGError.prototype.constructor = TCGError;

  function fail(code, message, detail) {
    throw new TCGError(code, message, detail);
  }

  /* ------------------------------------------------------------------ *
   * Deterministic PRNG: FNV-1a seed -> splitmix32 expansion -> sfc32     *
   * ------------------------------------------------------------------ */

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function hex32(n) {
    return ('00000000' + (n >>> 0).toString(16)).slice(-8);
  }

  function hashString(str) {
    return 'fnv1a:' + hex32(fnv1a(str));
  }

  // Header metadata for a replay record. `seed` is the caller-supplied seed;
  // initialStateDigest fingerprints the warmed-up sfc32 state, so changing the
  // seed hash, warm-up count or PRNG algorithm is detectable even if the
  // human-readable name were accidentally left unchanged.
  function describeRng(seed, initialState) {
    return {
      name: RNG_NAME,
      algorithm: 'sfc32',
      seedHash: 'fnv1a',
      version: 'v1',
      seed: String(seed),
      initialStateDigest: hashString(initialState.join(','))
    };
  }

  // Rules are hashed with sorted keys so the digest does not depend on object
  // insertion order.
  function describeRuleset(rules) {
    var keys = Object.keys(rules).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      parts.push(keys[i] + '=' + JSON.stringify(rules[keys[i]]));
    }
    return { version: RULESET_VERSION, hash: hashString(parts.join('&')) };
  }

  function splitmix32(state) {
    state[0] = (state[0] + 0x9e3779b9) >>> 0;
    var z = state[0];
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  }

  function initRng(seed) {
    var s = [fnv1a('tcg:' + String(seed))];
    var a = splitmix32(s), b = splitmix32(s), c = splitmix32(s), d = splitmix32(s);
    // Warm up so that similar seeds diverge before the first draw.
    var out = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    for (var i = 0; i < 12; i++) nextWord(out);
    return out;
  }

  function nextWord(st) {
    var a = st[0], b = st[1], c = st[2], d = st[3];
    var t = (a + b) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    st[0] = a >>> 0; st[1] = b >>> 0; st[2] = c >>> 0; st[3] = d >>> 0;
    return t >>> 0;
  }

  // Uniform integer in [0, n). Rejection removes the incomplete top bucket,
  // so every value has exactly the same probability.
  function rngInt(st, n) {
    if (!(n > 0)) return 0;
    var limit = 4294967296 - (4294967296 % n);
    var x;
    do { x = nextWord(st); } while (x >= limit);
    return x % n;
  }

  // Deterministic sample of k distinct indices from 0..n-1, in draw order.
  function sampleIndices(st, n, k) {
    var pool = [], i;
    for (i = 0; i < n; i++) pool.push(i);
    k = Math.min(k, n);
    var out = [];
    for (i = 0; i < k; i++) {
      var j = rngInt(st, pool.length);
      out.push(pool[j]);
      pool.splice(j, 1);
    }
    return out;
  }

  function shuffleInPlace(st, arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rngInt(st, i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ------------------------------------------------------------------ *
   * Small helpers                                                       *
   * ------------------------------------------------------------------ */

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  var DEFAULT_RULES = {
    startingCore: 20,
    startingHand: 5,
    drawPerTurn: 1,
    firstTurnDraw: 0,
    startingResource: 3,
    resourceGrowth: 1,
    maxResource: 8,
    firstTurnResourcePenalty: 1,
    secondPlayerResourceBonus: 0,
    secondPlayerBonusCards: 0,
    maxTurns: 80,
    resourceName: 'resource',
    allowDirectCoreAttack: true
  };

  var TRIGGERS = { onPlay: 1, onDeath: 1, onTurnStart: 1 };
  var OPS = {
    damage: 1, heal: 1, draw: 1, discard: 1, destroy: 1,
    buff: 1, debuff: 1, resource: 1
  };

  function normalizeRules(raw) {
    var rules = {}, k;
    for (k in DEFAULT_RULES) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_RULES, k)) rules[k] = DEFAULT_RULES[k];
    }
    if (isObj(raw)) {
      for (k in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined) {
          rules[k] = raw[k];
        }
      }
    }
    var numeric = ['startingCore', 'startingHand', 'drawPerTurn', 'firstTurnDraw',
      'startingResource', 'resourceGrowth', 'maxResource', 'firstTurnResourcePenalty',
      'secondPlayerResourceBonus', 'secondPlayerBonusCards', 'maxTurns'];
    for (var i = 0; i < numeric.length; i++) {
      var n = Number(rules[numeric[i]]);
      if (!isFinite(n) || n < 0) fail('invalid_rules', 'rules.' + numeric[i] + ' must be a non-negative number');
      rules[numeric[i]] = Math.floor(n);
    }
    rules.startingCore = Math.max(1, rules.startingCore);
    rules.maxResource = Math.max(1, rules.maxResource);
    rules.maxTurns = Math.max(1, rules.maxTurns);
    rules.resourceName = String(rules.resourceName || 'resource').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'resource';
    rules.allowDirectCoreAttack = !!rules.allowDirectCoreAttack;
    return rules;
  }

  function validateSelector(sel, where) {
    if (!isObj(sel)) fail('invalid_card', where + ': target must be an object');
    if (sel.kind === 'unit') {
      if (['self', 'enemy', 'any'].indexOf(sel.side) < 0) fail('invalid_card', where + ': bad side');
      if (sel.mode !== undefined && ['single', 'all', 'random'].indexOf(sel.mode) < 0) {
        fail('invalid_card', where + ': bad mode');
      }
      if (sel.count !== undefined && (!isFinite(sel.count) || sel.count < 1)) {
        fail('invalid_card', where + ': bad count');
      }
      return;
    }
    if (sel.kind === 'core' || sel.kind === 'hand') {
      if (['self', 'enemy'].indexOf(sel.side) < 0) fail('invalid_card', where + ': bad side');
      return;
    }
    fail('invalid_card', where + ': unknown target kind ' + sel.kind);
  }

  function normalizeDef(raw, pool) {
    if (typeof raw === 'string') {
      if (!pool || !pool[raw]) fail('unknown_card', 'card definition not found in pool: ' + raw);
      raw = pool[raw];
    }
    if (!isObj(raw) || !raw.id) fail('invalid_card', 'card definition needs an id');
    var def = {
      id: String(raw.id),
      type: raw.type === undefined ? 'unit' : String(raw.type),
      cost: Math.max(0, Math.floor(Number(raw.cost) || 0)),
      atk: Math.max(0, Math.floor(Number(raw.atk) || 0)),
      hp: Math.max(1, Math.floor(Number(raw.hp) || 1)),
      effects: [],
      abilities: []
    };
    if (raw.name !== undefined) def.name = clone(raw.name);
    if (raw.type !== 'unit' && raw.type !== 'spell' && raw.type !== undefined) {
      // Other permanent types behave like spells at resolution time unless a
      // host says otherwise; keep the label for display.
      def.type = String(raw.type);
    }
    var effects = Array.isArray(raw.effects) ? raw.effects : [];
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      if (!isObj(e) || !TRIGGERS[e.trigger]) fail('invalid_card', def.id + ': bad effect trigger');
      if (e.target !== undefined) validateSelector(e.target, def.id + '.effects[' + i + ']');
      var ops = Array.isArray(e.ops) ? e.ops : [];
      for (var j = 0; j < ops.length; j++) {
        var op = ops[j];
        if (!isObj(op) || !OPS[op.op]) fail('invalid_card', def.id + ': bad op ' + (op && op.op));
        if (op.target !== undefined) validateSelector(op.target, def.id + '.ops[' + j + ']');
        if (op.amount !== undefined && !isFinite(op.amount)) fail('invalid_card', def.id + ': bad amount');
      }
      def.effects.push(clone(e));
    }
    var abilities = Array.isArray(raw.abilities) ? raw.abilities : [];
    for (var a = 0; a < abilities.length; a++) {
      var ab = abilities[a];
      if (!isObj(ab)) fail('invalid_card', def.id + ': bad ability');
      if (ab.target !== undefined) validateSelector(ab.target, def.id + '.abilities[' + a + ']');
      var aops = Array.isArray(ab.ops) ? ab.ops : [];
      for (var b = 0; b < aops.length; b++) {
        if (!isObj(aops[b]) || !OPS[aops[b].op]) fail('invalid_card', def.id + ': bad ability op');
        if (aops[b].target !== undefined) validateSelector(aops[b].target, def.id + '.ability.ops[' + b + ']');
      }
      def.abilities.push({
        cost: Math.max(0, Math.floor(Number(ab.cost) || 0)),
        oncePerTurn: ab.oncePerTurn !== false,
        target: ab.target === undefined ? undefined : clone(ab.target),
        ops: clone(aops)
      });
    }
    return def;
  }

  function makeInstance(def, owner, index) {
    return {
      id: 'p' + owner + '-' + index,
      defId: def.id,
      atk: def.atk,
      hp: def.hp,
      maxHp: def.hp,
      ready: false,
      playedTurn: 0,
      usedAbilityTurn: 0
    };
  }

  function emit(events, type, data) {
    var e = { type: type };
    if (data) {
      for (var k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined) e[k] = data[k];
      }
    }
    events.push(e);
    return e;
  }

  /* ------------------------------------------------------------------ *
   * Zone helpers                                                        *
   * ------------------------------------------------------------------ */

  function defOf(state, card) {
    return state.defs[card.defId];
  }

  function otherOf(p) { return p === 0 ? 1 : 0; }

  function findInHand(player, cardId) {
    for (var i = 0; i < player.hand.length; i++) {
      if (player.hand[i].id === cardId) return { card: player.hand[i], index: i };
    }
    return null;
  }

  function findUnit(state, id) {
    for (var p = 0; p < 2; p++) {
      var field = state.players[p].field;
      for (var i = 0; i < field.length; i++) {
        if (field[i].id === id) return { owner: p, card: field[i], index: i };
      }
    }
    return null;
  }

  function findOwnUnit(player, id) {
    for (var i = 0; i < player.field.length; i++) {
      if (player.field[i].id === id) return { card: player.field[i], index: i };
    }
    return null;
  }

  function drawCards(state, playerIdx, count, events, opts) {
    opts = opts || {};
    var p = state.players[playerIdx];
    var drawn = 0;
    for (var i = 0; i < count; i++) {
      if (p.deck.length === 0) {
        if (opts.initial) fail('deck_too_small', 'deck cannot satisfy the opening hand');
        emit(events, 'deckOut', { player: playerIdx });
        finish(state, otherOf(playerIdx), 'deck');
        return drawn;
      }
      var card = p.deck.shift();
      p.hand.push(card);
      emit(events, 'draw', { player: playerIdx, cardId: card.id, count: 1 });
      drawn++;
    }
    return drawn;
  }

  function finish(state, winner, reason) {
    if (state.phase === 'over') return;
    state.phase = 'over';
    state.winner = winner;
    state.winReason = reason;
    state.draw = winner === null || winner === undefined;
  }

  function checkCoreWin(state, events) {
    if (state.phase === 'over') return true;
    var a = state.players[0].core, b = state.players[1].core;
    if (a <= 0 && b <= 0) {
      var w = a === b ? null : (a > b ? 0 : 1);
      finish(state, w, 'core');
      emit(events, 'win', { player: w, reason: 'core' });
      return true;
    }
    if (a <= 0) { finish(state, 1, 'core'); emit(events, 'win', { player: 1, reason: 'core' }); return true; }
    if (b <= 0) { finish(state, 0, 'core'); emit(events, 'win', { player: 0, reason: 'core' }); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Target selectors                                                    *
   * ------------------------------------------------------------------ */

  function matchesFilter(card, filter, state) {
    if (!filter) return true;
    var def = defOf(state, card);
    if (filter.type !== undefined && def.type !== filter.type) return false;
    if (filter.minAtk !== undefined && card.atk < filter.minAtk) return false;
    if (filter.maxAtk !== undefined && card.atk > filter.maxAtk) return false;
    if (filter.minHp !== undefined && card.hp < filter.minHp) return false;
    if (filter.maxHp !== undefined && card.hp > filter.maxHp) return false;
    return true;
  }

  function unitsOfSide(state, actor, side, extra) {
    var out = [];
    if (side === 'self' || side === 'any') out = out.concat(state.players[actor].field);
    if (side === 'enemy' || side === 'any') out = out.concat(state.players[otherOf(actor)].field);
    if (extra && (side === 'self' || side === 'any')) {
      for (var i = 0; i < extra.length; i++) {
        var duplicate = false;
        for (var j = 0; j < out.length; j++) if (out[j].id === extra[i].id) duplicate = true;
        if (!duplicate) out.push(extra[i]);
      }
    }
    return out;
  }

  function eligibleUnits(state, actor, spec, extra) {
    var list = unitsOfSide(state, actor, spec.side || 'enemy', extra);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (matchesFilter(list[i], spec.filter, state)) out.push(list[i]);
    }
    return out;
  }

  function resolveSelector(state, actor, spec, chosen, auto) {
    if (!spec) return [];
    if (spec.kind === 'unit') {
      var eligible = eligibleUnits(state, actor, spec);
      var mode = spec.mode || (spec.count ? 'random' : 'single');
      if (mode === 'all') return eligible;
      if (mode === 'random') {
        var k = Math.min(spec.count || 1, eligible.length);
        var picks = sampleIndices(state.rng, eligible.length, k);
        var out = [];
        for (var i = 0; i < picks.length; i++) out.push(eligible[picks[i]]);
        return out;
      }
      // single
      if (chosen) {
        for (var j = 0; j < eligible.length; j++) {
          if (eligible[j].id === chosen) return [eligible[j]];
        }
        return [];
      }
      return auto && eligible.length ? [eligible[0]] : [];
    }
    if (spec.kind === 'core') {
      return [{ kind: 'core', owner: spec.side === 'self' ? actor : otherOf(actor) }];
    }
    if (spec.kind === 'hand') {
      var owner = spec.side === 'self' ? actor : otherOf(actor);
      var hand = state.players[owner].hand;
      var cards = [];
      for (var h = 0; h < hand.length; h++) cards.push(hand[h]);
      var howMany = spec.count || 1;
      if (spec.mode === 'all') return cards;
      var idx = sampleIndices(state.rng, cards.length, Math.min(howMany, cards.length));
      var picked = [];
      for (var q = 0; q < idx.length; q++) picked.push(cards[idx[q]]);
      return picked;
    }
    return [];
  }

  function targetRequirements(def, trigger, abilityIndex) {
    var specs = [];
    if (trigger === 'activate') {
      var ab = def.abilities[abilityIndex];
      if (ab && ab.target && ab.target.kind === 'unit' && (ab.target.mode || 'single') === 'single') {
        specs.push(ab.target);
      }
      return specs;
    }
    var effects = def.effects || [];
    for (var i = 0; i < effects.length; i++) {
      var t = effects[i].target;
      if (effects[i].trigger === trigger && t && t.kind === 'unit' && (t.mode || 'single') === 'single') {
        specs.push(t);
      }
    }
    return specs;
  }

  function validTargets(state, actor, specs, extra) {
    if (!specs.length) return [];
    var first = eligibleUnits(state, actor, specs[0], extra);
    var out = [];
    for (var i = 0; i < first.length; i++) {
      var unit = first[i], ok = true;
      for (var j = 1; j < specs.length; j++) {
        var rest = eligibleUnits(state, actor, specs[j], extra), found = false;
        for (var k = 0; k < rest.length; k++) if (rest[k].id === unit.id) { found = true; break; }
        if (!found) { ok = false; break; }
      }
      if (ok) out.push(unit);
    }
    return out;
  }

  function checkTargetChoice(state, actor, specs, target, extra) {
    if (!specs.length) {
      if (target !== undefined && target !== null) {
        fail('unexpected_target', 'this action does not take a target', { target: target });
      }
      return null;
    }
    var valid = validTargets(state, actor, specs, extra);
    if (target === undefined || target === null || target === '') {
      if (valid.length) fail('target_required', 'this action needs a target', { choices: valid.map(function (u) { return u.id; }) });
      return null; // no legal target: effect fizzles
    }
    for (var i = 0; i < valid.length; i++) {
      if (valid[i].id === target) return target;
    }
    fail('target_invalid', 'target is not a legal choice', { target: target, choices: valid.map(function (u) { return u.id; }) });
  }

  /* ------------------------------------------------------------------ *
   * Effects                                                             *
   * ------------------------------------------------------------------ */

  function applyOps(state, actor, source, targets, ops, ctx, events) {
    for (var i = 0; i < ops.length; i++) {
      if (state.phase === 'over') return;
      var op = ops[i];
      var opTargets = targets;
      if (op.target) opTargets = resolveSelector(state, actor, op.target, null, true);
      var amount = Number(op.amount) || 0;
      var j, t;
      switch (op.op) {
        case 'damage':
          for (j = 0; j < opTargets.length; j++) {
            t = opTargets[j];
            if (t.kind === 'core') {
              state.players[t.owner].core -= amount;
              emit(events, 'damage', { target: 'core', player: t.owner, amount: amount, source: source && source.id });
            } else {
              t.hp -= amount;
              emit(events, 'damage', { target: t.id, amount: amount, source: source && source.id });
            }
          }
          break;
        case 'heal':
          for (j = 0; j < opTargets.length; j++) {
            t = opTargets[j];
            if (t.kind === 'core') {
              var before = state.players[t.owner].core;
              state.players[t.owner].core = Math.min(state.rules.startingCore, before + amount);
              emit(events, 'heal', { target: 'core', player: t.owner, amount: state.players[t.owner].core - before });
            } else {
              var hpBefore = t.hp;
              t.hp = Math.min(t.maxHp, t.hp + amount);
              emit(events, 'heal', { target: t.id, amount: t.hp - hpBefore });
            }
          }
          break;
        case 'draw': {
          var who = (op.side || op.player) === 'enemy' ? otherOf(actor) : actor;
          if (op.side === 'each') {
            drawCards(state, actor, amount, events);
            if (state.phase !== 'over') drawCards(state, otherOf(actor), amount, events);
          } else {
            drawCards(state, who, amount, events);
          }
          break;
        }
        case 'discard': {
          var owner = op.side === 'self' ? actor : otherOf(actor);
          var hand = state.players[owner].hand;
          var n = Math.min(amount || 1, hand.length);
          var idx = sampleIndices(state.rng, hand.length, n);
          idx.sort(function (a, b) { return b - a; });
          for (j = 0; j < idx.length; j++) {
            var card = hand.splice(idx[j], 1)[0];
            state.players[owner].discard.push(card);
            emit(events, 'discard', { player: owner, cardId: card.id });
          }
          break;
        }
        case 'destroy':
          for (j = 0; j < opTargets.length; j++) {
            t = opTargets[j];
            if (t.kind === 'unit' && t.hp > 0) {
              t.hp = 0;
              emit(events, 'destroy', { target: t.id });
            }
          }
          break;
        case 'buff':
          for (j = 0; j < opTargets.length; j++) {
            t = opTargets[j];
            if (t.kind === 'unit') {
              t.atk = Math.max(0, t.atk + (Number(op.atk) || 0));
              t.hp += Number(op.hp) || 0;
              if ((Number(op.hp) || 0) > 0) t.maxHp += Number(op.hp);
              emit(events, 'buff', { target: t.id, atk: Number(op.atk) || 0, hp: Number(op.hp) || 0 });
            }
          }
          break;
        case 'debuff':
          for (j = 0; j < opTargets.length; j++) {
            t = opTargets[j];
            if (t.kind === 'unit') {
              t.atk = Math.max(0, t.atk - (Number(op.atk) || 0));
              t.hp -= Number(op.hp) || 0;
              emit(events, 'debuff', { target: t.id, atk: Number(op.atk) || 0, hp: Number(op.hp) || 0 });
            }
          }
          break;
        case 'resource': {
          var rp = state.players[op.side === 'enemy' ? otherOf(actor) : actor];
          rp.resource = Math.max(0, Math.min(state.rules.maxResource, rp.resource + amount));
          emit(events, 'resource', { player: rp.id, amount: amount });
          break;
        }
        default:
          break;
      }
      flushDeaths(state, ctx, events);
      if (checkCoreWin(state, events)) return;
    }
  }

  function resolveEffects(state, def, trigger, actor, source, chosen, ctx, events, auto) {
    var effects = def.effects || [];
    for (var i = 0; i < effects.length; i++) {
      var effect = effects[i];
      if (effect.trigger !== trigger) continue;
      if (ctx.guard++ > 128) return;
      var targets = resolveSelector(state, actor, effect.target, chosen, !!auto);
      applyOps(state, actor, source, targets, effect.ops || [], ctx, events);
      if (state.phase === 'over') return;
    }
  }

  function flushDeaths(state, ctx, events) {
    var rounds = 0;
    while (rounds++ < 64) {
      var dead = [], p, i;
      for (p = 0; p < 2; p++) {
        var field = state.players[p].field;
        var keep = [];
        for (i = 0; i < field.length; i++) {
          if (field[i].hp <= 0) dead.push({ owner: p, card: field[i] });
          else keep.push(field[i]);
        }
        if (dead.length) state.players[p].field = keep;
      }
      if (!dead.length) return;
      for (i = 0; i < dead.length; i++) {
        var d = dead[i];
        state.players[d.owner].discard.push(d.card);
        emit(events, 'death', { player: d.owner, target: d.card.id, defId: d.card.defId });
        if (ctx.guard++ > 128 || state.phase === 'over') return;
        resolveEffects(state, defOf(state, d.card), 'onDeath', d.owner, d.card, null, ctx, events, true);
        if (checkCoreWin(state, events)) return;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Turn engine                                                         *
   * ------------------------------------------------------------------ */

  function startTurn(state, playerIdx, events) {
    if (state.phase === 'over') return;
    var p = state.players[playerIdx];
    state.activePlayer = playerIdx;
    state.phase = 'start';
    p.turnCount += 1;
    var res = state.rules.startingResource + (p.turnCount - 1) * state.rules.resourceGrowth;
    if (playerIdx === 0 && p.turnCount === 1) res -= state.rules.firstTurnResourcePenalty;
    if (playerIdx === 1 && p.turnCount === 1) res += state.rules.secondPlayerResourceBonus;
    p.resource = Math.max(0, Math.min(state.rules.maxResource, res));
    for (var i = 0; i < p.field.length; i++) p.field[i].ready = true;
    emit(events, 'turnStart', { player: playerIdx, turn: state.turn, resource: p.resource });
    if (state.turn === 1) drawCards(state, playerIdx, state.rules.firstTurnDraw, events);
    else drawCards(state, playerIdx, state.rules.drawPerTurn, events);
    if (state.phase === 'over') return;
    // Snapshot the field so an onTurnStart effect that destroys its own unit
    // does not shift the iteration order.
    var fieldSnapshot = p.field.slice();
    var ctx = { guard: 0 };
    for (var j = 0; j < fieldSnapshot.length; j++) {
      var card = fieldSnapshot[j];
      if (card.hp <= 0) continue;
      if (state.phase === 'over') return;
      resolveEffects(state, defOf(state, card), 'onTurnStart', playerIdx, card, null, ctx, events, true);
    }
    if (state.phase !== 'over') state.phase = 'main';
    if (checkCoreWin(state, events)) return;
  }

  function endTurn(state, events) {
    if (state.phase === 'over') return;
    state.phase = 'end';
    emit(events, 'turnEnd', { player: state.activePlayer, turn: state.turn });
    state.turn += 1;
    if (state.turn > state.rules.maxTurns) {
      var a = state.players[0], b = state.players[1];
      function power(pl) {
        var s = 0;
        for (var i = 0; i < pl.field.length; i++) s += pl.field[i].atk + pl.field[i].hp;
        return s;
      }
      var winner = null;
      if (a.core !== b.core) winner = a.core > b.core ? 0 : 1;
      else if (power(a) !== power(b)) winner = power(a) > power(b) ? 0 : 1;
      else if (a.hand.length !== b.hand.length) winner = a.hand.length > b.hand.length ? 0 : 1;
      else if (a.deck.length !== b.deck.length) winner = a.deck.length > b.deck.length ? 0 : 1;
      finish(state, winner, 'max_turns');
      emit(events, 'win', { player: winner, reason: 'max_turns' });
      return;
    }
    startTurn(state, otherOf(state.activePlayer), events);
  }

  /* ------------------------------------------------------------------ *
   * Action construction and validation                                  *
   * ------------------------------------------------------------------ */

  function playActionVariants(state, actor, card) {
    var def = defOf(state, card);
    var specs = targetRequirements(def, 'onPlay');
    // A unit may target itself with its own onPlay effect (for example a
    // "give a friendly lampwight +1/+1" card). It is still in hand here, so
    // offer it as an extra candidate; after the play it is on the field.
    var extra = def.type === 'unit' ? [card] : [];
    var valid = validTargets(state, actor, specs, extra);
    var out = [];
    if (!specs.length || !valid.length) {
      out.push({ type: 'playCard', cardId: card.id });
      return out;
    }
    for (var i = 0; i < valid.length; i++) {
      out.push({ type: 'playCard', cardId: card.id, target: valid[i].id });
    }
    return out;
  }

  function activateVariants(state, actor, card) {
    var def = defOf(state, card);
    var out = [];
    for (var i = 0; i < def.abilities.length; i++) {
      var ab = def.abilities[i];
      if (ab.oncePerTurn && card.usedAbilityTurn === state.turn) continue;
      if (state.players[actor].resource < ab.cost) continue;
      var specs = targetRequirements(def, 'activate', i);
      var valid = validTargets(state, actor, specs);
      if (!specs.length || !valid.length) {
        out.push({ type: 'activate', unitId: card.id, abilityIndex: i });
      } else {
        for (var j = 0; j < valid.length; j++) {
          out.push({ type: 'activate', unitId: card.id, abilityIndex: i, target: valid[j].id });
        }
      }
    }
    return out;
  }

  function legalActions(state, playerId) {
    if (state.phase === 'over') return [];
    if (playerId !== state.activePlayer) return [];
    var actor = state.activePlayer;
    var player = state.players[actor];
    var enemy = state.players[otherOf(actor)];
    var out = [], i, j;

    // Play a card from hand.
    for (i = 0; i < player.hand.length; i++) {
      var card = player.hand[i];
      var def = defOf(state, card);
      if (player.resource < def.cost) continue;
      var variants = playActionVariants(state, actor, card);
      for (j = 0; j < variants.length; j++) out.push(variants[j]);
    }

    // Attack with a unit that is ready and did not arrive this turn.
    for (i = 0; i < player.field.length; i++) {
      var unit = player.field[i];
      if (!unit.ready || unit.playedTurn >= state.turn || unit.atk <= 0) continue;
      for (j = 0; j < enemy.field.length; j++) {
        out.push({ type: 'attack', attacker: unit.id, target: enemy.field[j].id });
      }
      if (state.rules.allowDirectCoreAttack) {
        out.push({ type: 'attack', attacker: unit.id, target: 'core' });
      }
    }

    // Activated abilities.
    for (i = 0; i < player.field.length; i++) {
      var actives = activateVariants(state, actor, player.field[i]);
      for (j = 0; j < actives.length; j++) out.push(actives[j]);
    }

    out.push({ type: 'endTurn' });
    return out;
  }

  function guardTurn(state, action) {
    if (state.phase === 'over') fail('match_over', 'the match is already over', { winner: state.winner });
    if (!isObj(action) || typeof action.type !== 'string') fail('unknown_action', 'action needs a type');
    if (action.playerId !== undefined && action.playerId !== state.activePlayer) {
      fail('not_your_turn', 'it is not this player\'s turn', { activePlayer: state.activePlayer });
    }
    if (action.type === 'playCard' || action.type === 'attack' || action.type === 'activate') {
      if (action.playerId === undefined && state.phase !== 'main') {
        fail('not_your_turn', 'no action is available outside the main phase');
      }
    }
  }

  function applyPlay(state, action, events, ctx) {
    var actor = state.activePlayer;
    var player = state.players[actor];
    if (typeof action.cardId !== 'string') fail('card_not_in_hand', 'cardId is required');
    var found = findInHand(player, action.cardId);
    if (!found) fail('card_not_in_hand', 'card is not in hand', { cardId: action.cardId });
    var card = found.card;
    var def = defOf(state, card);
    if (!def) fail('unknown_card', 'card definition missing', { cardId: action.cardId });
    if (player.resource < def.cost) {
      fail('not_enough_' + state.rules.resourceName, 'not enough ' + state.rules.resourceName,
        { need: def.cost, have: player.resource });
    }
    var specs = targetRequirements(def, 'onPlay');
    var extra = def.type === 'unit' ? [card] : [];
    var target = checkTargetChoice(state, actor, specs, action.target, extra);

    // Validation passed: mutate.
    player.resource -= def.cost;
    player.hand.splice(found.index, 1);
    emit(events, 'play', { player: actor, cardId: card.id, defId: def.id, cost: def.cost });
    if (def.type === 'unit') {
      card.ready = false;
      card.playedTurn = state.turn;
      player.field.push(card);
    } else {
      player.discard.push(card);
    }
    resolveEffects(state, def, 'onPlay', actor, card, target, ctx, events, false);
    flushDeaths(state, ctx, events);
    checkCoreWin(state, events);
  }

  function applyAttack(state, action, events, ctx) {
    var actor = state.activePlayer;
    var player = state.players[actor];
    var enemy = state.players[otherOf(actor)];
    if (typeof action.attacker !== 'string') fail('unit_not_found', 'attacker is required');
    var own = findOwnUnit(player, action.attacker);
    if (!own) fail('unit_not_found', 'attacker is not on your field', { attacker: action.attacker });
    var unit = own.card;
    if (!unit.ready || unit.playedTurn >= state.turn) {
      fail('unit_not_ready', 'unit cannot attack this turn', { attacker: unit.id });
    }
    if (unit.atk <= 0) fail('unit_not_ready', 'unit has no attack value', { attacker: unit.id });

    if (action.target === 'core') {
      if (!state.rules.allowDirectCoreAttack) fail('target_invalid', 'direct core attacks are disabled');
      unit.ready = false;
      enemy.core -= unit.atk;
      emit(events, 'attack', { player: actor, attacker: unit.id, target: 'core', amount: unit.atk });
      checkCoreWin(state, events);
      return;
    }
    if (typeof action.target !== 'string' || action.target === unit.id) {
      fail('target_invalid', 'target must be an enemy unit or the enemy core', { target: action.target });
    }
    var targetFound = findOwnUnit(enemy, action.target);
    if (!targetFound) fail('target_invalid', 'target is not an enemy unit', { target: action.target });
    var target = targetFound.card;
    unit.ready = false;
    var dealt = unit.atk;
    var taken = target.atk;
    target.hp -= dealt;
    unit.hp -= taken;
    emit(events, 'attack', {
      player: actor, attacker: unit.id, target: target.id,
      amount: dealt, retaliation: taken
    });
    flushDeaths(state, ctx, events);
    checkCoreWin(state, events);
  }

  function applyActivate(state, action, events, ctx) {
    var actor = state.activePlayer;
    var player = state.players[actor];
    if (typeof action.unitId !== 'string') fail('unit_not_found', 'unitId is required');
    var own = findOwnUnit(player, action.unitId);
    if (!own) fail('unit_not_found', 'unit is not on your field', { unitId: action.unitId });
    var unit = own.card;
    var def = defOf(state, unit);
    var idx = Number(action.abilityIndex === undefined ? 0 : action.abilityIndex);
    if (!isFinite(idx) || idx < 0 || idx >= def.abilities.length) {
      fail('ability_not_found', 'unit has no such ability', { unitId: unit.id, abilityIndex: action.abilityIndex });
    }
    var ab = def.abilities[idx];
    if (ab.oncePerTurn && unit.usedAbilityTurn === state.turn) {
      fail('ability_used', 'ability already used this turn', { unitId: unit.id, abilityIndex: idx });
    }
    if (player.resource < ab.cost) {
      fail('not_enough_' + state.rules.resourceName, 'not enough ' + state.rules.resourceName,
        { need: ab.cost, have: player.resource });
    }
    var specs = targetRequirements(def, 'activate', idx);
    var target = checkTargetChoice(state, actor, specs, action.target);

    player.resource -= ab.cost;
    unit.usedAbilityTurn = state.turn;
    emit(events, 'activate', { player: actor, unitId: unit.id, abilityIndex: idx, cost: ab.cost });
    applyOps(state, actor, unit, target ? resolveSelector(state, actor, specs[0], target, false) : [], ab.ops, ctx, events);
    flushDeaths(state, ctx, events);
    checkCoreWin(state, events);
  }

  function applyTo(state, action) {
    var events = [];
    guardTurn(state, action);
    var ctx = { guard: 0 };
    switch (action.type) {
      case 'playCard': applyPlay(state, action, events, ctx); break;
      case 'attack': applyAttack(state, action, events, ctx); break;
      case 'activate': applyActivate(state, action, events, ctx); break;
      case 'endTurn':
        if (state.phase !== 'main') fail('not_your_turn', 'the turn cannot end in this phase');
        endTurn(state, events);
        break;
      default:
        fail('unknown_action', 'unknown action type: ' + action.type);
    }
    return events;
  }

  /* ------------------------------------------------------------------ *
   * Match object                                                        *
   * ------------------------------------------------------------------ */

  function snapshot(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function hiddenCard() {
    return { hidden: true };
  }

  // Per-player view of the authoritative state. Hidden information is removed
  // rather than merely hidden in the UI:
  //   - the opponent's hand becomes `handCount` + face-down placeholders;
  //   - both decks become `deckCount` + an empty array (draw order is secret
  //     from every player, including the owner);
  //   - the RNG stream, its initial-state digest and the seed are server-only,
  //     because any of them lets a client predict future draws.
  // Public zones (field, discard, exile), defs, rules and the result stay
  // intact. The input state is never mutated.
  function viewFor(state, playerId) {
    if (playerId !== 0 && playerId !== 1) {
      fail('invalid_player', 'viewFor needs playerId 0 or 1', { playerId: playerId });
    }
    var view = snapshot(state);
    delete view.rng;
    delete view.rngInfo;
    delete view.seed;
    for (var p = 0; p < view.players.length; p++) {
      var player = view.players[p];
      var hidden = p !== playerId;
      var handCount = Array.isArray(player.hand) ? player.hand.length : 0;
      var deckCount = Array.isArray(player.deck) ? player.deck.length : 0;
      if (hidden) {
        var hand = [];
        for (var i = 0; i < handCount; i++) hand.push(hiddenCard());
        player.hand = hand;
      }
      player.handCount = handCount;
      player.handHidden = hidden;
      player.deck = [];
      player.deckCount = deckCount;
      player.deckHidden = true;
    }
    return view;
  }

  // snapshotFor is the named entry point from the online-protocol contract; it
  // is deliberately identical to viewFor (a JSON-safe, already-cloned view).
  function snapshotFor(state, playerId) {
    return viewFor(state, playerId);
  }

  // A replay record is {engineVersion, rng, ruleset, seed, result, setup,
  // actions}. The header is validated before a single action is applied, so a
  // record from another engine/PRNG/ruleset fails loudly instead of silently
  // producing a different game. Records written before this header existed
  // (including the old bare action array) are reported as legacy format.
  function buildReplayHeader(setup, rngInfo, ruleset, state) {
    return {
      engineVersion: ENGINE_VERSION,
      rng: clone(rngInfo),
      ruleset: clone(ruleset),
      seed: setup.seed,
      result: {
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        winReason: state.winReason,
        draw: state.draw
      }
    };
  }

  function buildReplayRecord(history, setup, rngInfo, ruleset, state) {
    var record = buildReplayHeader(setup, rngInfo, ruleset, state);
    record.setup = clone(setup);
    record.actions = clone(history);
    return record;
  }

  function validateReplayRecord(record, fallbackSetup) {
    if (record === undefined || Array.isArray(record)) {
      fail('replay_legacy_format',
        'legacy replay record: no header; re-record with match.record()',
        { got: record === undefined ? 'undefined' : 'array', expected: 'object with engineVersion/rng/ruleset' });
    }
    if (!isObj(record)) {
      fail('replay_invalid_record', 'replay record must be an object', { got: typeof record });
    }
    if (record.engineVersion === undefined) {
      fail('replay_legacy_format',
        'replay record has no engineVersion header (recorded by an older engine); it cannot be replayed safely',
        { keys: Object.keys(record).slice(0, 12) });
    }
    if (record.engineVersion !== ENGINE_VERSION) {
      fail('replay_version_mismatch',
        'replay record engine version does not match this engine',
        { recorded: record.engineVersion, current: ENGINE_VERSION });
    }

    if (record.setup !== undefined && !isObj(record.setup)) {
      fail('replay_invalid_record', 'record.setup must be an object', { got: typeof record.setup });
    }
    var setup = isObj(record.setup) ? clone(record.setup) : clone(fallbackSetup);
    var setupSeed = setup.seed === undefined ? 1 : setup.seed;
    var expectedRng = describeRng(setupSeed, initRng(setupSeed));

    var recordedRng = typeof record.rng === 'string' ? { name: record.rng } : record.rng;
    if (!isObj(recordedRng)) {
      fail('replay_legacy_format',
        'replay record has no rng header; the PRNG algorithm must be identified before replay',
        { got: typeof record.rng });
    }
    // Accept either the canonical {name:'sfc32/fnv1a/v1'} form or explicit
    // algorithm/seedHash/version fields. Either way the algorithm must match.
    if (recordedRng.name !== undefined) {
      if (recordedRng.name !== RNG_NAME) {
        fail('replay_rng_mismatch', 'replay record was produced by a different PRNG',
          { recorded: recordedRng.name, current: RNG_NAME });
      }
    } else if (recordedRng.algorithm !== undefined) {
      if (String(recordedRng.algorithm) !== 'sfc32' ||
          (recordedRng.seedHash !== undefined && String(recordedRng.seedHash) !== 'fnv1a') ||
          (recordedRng.version !== undefined && String(recordedRng.version) !== 'v1')) {
        fail('replay_rng_mismatch', 'replay record was produced by a different PRNG',
          { recorded: recordedRng, current: RNG_NAME });
      }
    } else {
      fail('replay_legacy_format',
        'replay record rng header has neither a name nor an algorithm',
        { keys: Object.keys(recordedRng).slice(0, 8) });
    }
    if (recordedRng.seed !== undefined && String(recordedRng.seed) !== expectedRng.seed) {
      fail('replay_seed_mismatch', 'replay record seed does not match its setup seed',
        { recorded: String(recordedRng.seed), setup: expectedRng.seed });
    }
    if (recordedRng.initialStateDigest !== undefined &&
        recordedRng.initialStateDigest !== expectedRng.initialStateDigest) {
      fail('replay_rng_mismatch', 'replay record PRNG initial state does not match this engine',
        { recorded: recordedRng.initialStateDigest, current: expectedRng.initialStateDigest });
    }
    if (record.seed !== undefined && String(record.seed) !== expectedRng.seed) {
      fail('replay_seed_mismatch', 'replay record seed does not match its setup seed',
        { recorded: String(record.seed), setup: expectedRng.seed });
    }

    // ruleset is optional ("若有"): a record without one is still replayable,
    // but a present header must agree with the setup rules.
    if (record.ruleset !== undefined) {
      var recordedRuleset = typeof record.ruleset === 'string'
        ? { hash: record.ruleset }
        : record.ruleset;
      if (!isObj(recordedRuleset)) {
        fail('replay_invalid_record', 'record.ruleset must be an object or hash string',
          { got: typeof record.ruleset });
      }
      var expectedRuleset = describeRuleset(normalizeRules(setup.rules));
      if (recordedRuleset.version !== undefined &&
          recordedRuleset.version !== expectedRuleset.version) {
        fail('replay_ruleset_mismatch', 'replay record was produced by a different ruleset version',
          { recorded: recordedRuleset.version, current: expectedRuleset.version });
      }
      if (recordedRuleset.hash !== undefined &&
          recordedRuleset.hash !== expectedRuleset.hash) {
        fail('replay_ruleset_mismatch', 'replay record ruleset hash does not match its setup',
          { recorded: recordedRuleset.hash, current: expectedRuleset.hash });
      }
    }

    if (!Array.isArray(record.actions)) {
      fail('replay_invalid_record', 'replay record actions must be an array',
        { got: typeof record.actions });
    }
    return { setup: setup, actions: record.actions };
  }

  function setupCardPool(config) {
    var pool = {};
    var raw = config.cardPool || {};
    for (var k in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) {
        var def = normalizeDef(raw[k], null);
        pool[def.id] = def;
      }
    }
    // A deck may also carry its definitions inline.
    var players = config.players || [];
    for (var p = 0; p < players.length; p++) {
      var deck = players[p].deck || [];
      for (var i = 0; i < deck.length; i++) {
        if (typeof deck[i] === 'string') {
          if (!pool[deck[i]]) fail('unknown_card', 'card not found in cardPool: ' + deck[i]);
        } else if (isObj(deck[i])) {
          var d = normalizeDef(deck[i], pool);
          pool[d.id] = d;
        } else {
          fail('invalid_card', 'deck entries must be card definitions or ids');
        }
      }
    }
    return pool;
  }

  function createMatch(config) {
    config = config || {};
    var players = config.players;
    if (!Array.isArray(players) || players.length !== 2) {
      fail('unsupported_player_count', 'this engine is a two-player engine');
    }
    var rules = normalizeRules(config.rules);
    var pool = setupCardPool(config);
    var seed = config.seed === undefined ? 1 : config.seed;
    var initialRng = initRng(seed);
    var rngInfo = describeRng(seed, initialRng);
    var ruleset = describeRuleset(rules);
    var state = {
      version: VERSION,
      engineVersion: ENGINE_VERSION,
      seed: String(seed),
      turn: 1,
      activePlayer: 0,
      phase: 'start',
      winner: null,
      winReason: null,
      draw: false,
      rng: initialRng.slice(),
      rngInfo: clone(rngInfo),
      ruleset: clone(ruleset),
      rules: clone(rules),
      defs: {},
      players: []
    };
    var p, i;
    for (var id in pool) {
      if (Object.prototype.hasOwnProperty.call(pool, id)) state.defs[id] = pool[id];
    }
    for (p = 0; p < 2; p++) {
      var defsInDeck = [];
      var deckInput = players[p].deck || [];
      for (i = 0; i < deckInput.length; i++) {
        var entry = deckInput[i];
        if (typeof entry === 'string') defsInDeck.push(pool[entry]);
        else defsInDeck.push(normalizeDef(entry, pool));
      }
      if (defsInDeck.length < rules.startingHand) fail('deck_too_small', 'deck must hold at least the opening hand');
      if (p === 1 && defsInDeck.length < rules.startingHand + rules.secondPlayerBonusCards) {
        fail('deck_too_small', 'deck must hold the opening hand plus the second-player bonus');
      }
      var instances = [];
      for (i = 0; i < defsInDeck.length; i++) instances.push(makeInstance(defsInDeck[i], p, i));
      shuffleInPlace(state.rng, instances);
      state.players.push({
        id: p,
        core: rules.startingCore,
        resource: 0,
        maxResource: rules.maxResource,
        turnCount: 0,
        deck: instances,
        hand: [],
        field: [],
        discard: [],
        exile: []
      });
    }
    var setupEvents = [];
    for (p = 0; p < 2; p++) {
      var opening = rules.startingHand + (p === 1 ? rules.secondPlayerBonusCards : 0);
      for (i = 0; i < opening; i++) {
        var card = state.players[p].deck.shift();
        state.players[p].hand.push(card);
        emit(setupEvents, 'draw', { player: p, cardId: card.id, opening: true, count: 1 });
      }
    }
    startTurn(state, 0, setupEvents);
    checkCoreWin(state, setupEvents);

    var history = [];
    var lastEvents = setupEvents;
    var setup = {
      seed: seed,
      rules: clone(rules),
      players: [
        { deck: clone(players[0].deck || []) },
        { deck: clone(players[1].deck || []) }
      ],
      cardPool: clone(config.cardPool || {})
    };

    var match = {
      get state() { return snapshot(state); },
      get log() { return clone(history); },
      get events() { return clone(lastEvents); },
      // Full authoritative snapshot (same as match.state).
      snapshot: function () {
        return snapshot(state);
      },
      // Full replay record: header (engineVersion/rng/ruleset/seed/result),
      // setup and the action stream. Pass it back to replay().
      record: function () {
        return buildReplayRecord(history, setup, rngInfo, ruleset, state);
      },
      // Header only, parseable without touching the action stream.
      header: function () {
        return buildReplayHeader(setup, rngInfo, ruleset, state);
      },
      // Per-player view; the authoritative snapshot() (match.state) stays full
      // for the server. Kept as an added method so existing callers are not
      // affected.
      viewFor: function (playerId) {
        return viewFor(state, playerId);
      },
      snapshotFor: function (playerId) {
        return snapshotFor(state, playerId);
      },
      legalActions: function (playerId) {
        return legalActions(state, playerId === undefined ? state.activePlayer : playerId);
      },
      apply: function (action) {
        var events = applyTo(state, action);
        history.push(clone(action));
        lastEvents = events;
        return clone(events);
      },
      replay: function (record) {
        var checked = validateReplayRecord(record, setup);
        var fresh = createMatch(checked.setup);
        var actions = checked.actions;
        for (var i = 0; i < actions.length; i++) fresh.apply(actions[i]);
        return fresh;
      },
      // Explicit migration path for action logs written before the v2 replay
      // header existed. A bare log carries no engine/rng/ruleset identity, so
      // callers must opt in: replaying it against another setup can silently
      // produce a different game. The strict replay() above keeps rejecting
      // bare arrays with replay_legacy_format; this method is the only place
      // that trusts the caller-supplied setup (default: this match's setup).
      replayLegacy: function (log, legacySetup) {
        if (!Array.isArray(log)) {
          fail('replay_invalid_record', 'legacy replay log must be an array of actions',
            { got: log === null ? 'null' : typeof log });
        }
        var target = legacySetup === undefined ? setup : legacySetup;
        if (!isObj(target)) {
          fail('replay_invalid_record', 'legacy replay setup must be an object',
            { got: target === null ? 'null' : typeof target });
        }
        var fresh = createMatch(clone(target));
        for (var i = 0; i < log.length; i++) fresh.apply(clone(log[i]));
        return fresh;
      }
    };
    return match;
  }

  return {
    version: VERSION,
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    rngName: RNG_NAME,
    Error: TCGError,
    createMatch: createMatch,
    viewFor: viewFor,
    snapshotFor: snapshotFor,
    defaults: function () { return clone(DEFAULT_RULES); }
  };
});
