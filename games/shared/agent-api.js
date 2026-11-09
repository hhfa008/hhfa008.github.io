/* GameAgent — one machine-play protocol for every game on the site.
 *
 * UMD: browsers read window.GameAgent, Node reads module.exports. The core has
 * no DOM, no localStorage and no timers, so the same file runs in a page, in a
 * Worker and under `node`.
 *
 * Protocol (v1.0.0)
 *   GameAgent.register(slug, factory)
 *   GameAgent.list()                    -> [{slug, players, moves, source}]
 *   GameAgent.create(slug, {seed})      -> session (throws {code:'unknown_game'})
 *   GameAgent.playout(slug, agents, {seed, maxMoves})
 *                                       -> {winner, moves, hash, log}
 *
 *   session.slug / session.version
 *   session.seats          -> array of seat ids, e.g. ['p1','p2'] or 4 seats
 *   session.state()        -> plain JSON snapshot (safe to structuredClone)
 *   session.legalActions() -> [{id, type, payload, desc}], ids unique in state
 *   session.apply(id)      -> {ok:true, state} | {ok:false, error}
 *   session.status()       -> {phase:'playing'|'over', winner:null|seatId|'draw'}
 *   session.player()       -> current seat id; in claim phases, the seat that
 *                             must answer
 *   session.hash()         -> deterministic fingerprint of state()
 *
 * Two-seat games keep exactly the old surface: seats is ['p1','p2'],
 * player() returns 'p1'|'p2', and winners are 'p1'|'p2'|'draw'. Games with
 * more seats may return 'p3'/'p4'/... from player() and status().winner.
 *
 * A factory is a function ({seed}) -> session. Adapters may attach metadata to
 * the factory itself (factory.players, factory.seats, factory.moves,
 * factory.source); list() reads those, defaulting seats to ['p1','p2'],
 * players to seats.length, moves to 'alternating' and source to ''.
 *
 * playout agents may be omitted (seeded random), a single function, an array
 * indexed by seat (p1 first), or an object keyed by 'p1'/'p2'. An agent is
 * called as fn(session, legalActions) and returns an action id, an index into
 * legalActions, or an action-shaped object ({id} or {type, ...fields}).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GameAgent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var registry = Object.create(null);

  /* ------------------------------------------------------------------ *
   * JSON helpers                                                        *
   * ------------------------------------------------------------------ */

  function cloneJSON(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  // Key-sorted, cycle-free JSON. Used for hashing and for comparing actions
  // without depending on object insertion order.
  function canonicalJSON(value) {
    if (value === null || value === undefined) return 'null';
    var t = typeof value;
    if (t === 'number') return isFinite(value) ? JSON.stringify(value) : 'null';
    if (t === 'string' || t === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) {
      var items = [];
      for (var i = 0; i < value.length; i++) items.push(canonicalJSON(value[i]));
      return '[' + items.join(',') + ']';
    }
    if (t === 'object') {
      var keys = Object.keys(value).sort();
      var parts = [];
      for (var k = 0; k < keys.length; k++) {
        if (value[keys[k]] === undefined) continue;
        parts.push(JSON.stringify(keys[k]) + ':' + canonicalJSON(value[keys[k]]));
      }
      return '{' + parts.join(',') + '}';
    }
    return 'null';
  }

  function fnv1a(str, basis) {
    var h = basis >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function hex8(n) {
    var s = (n >>> 0).toString(16);
    while (s.length < 8) s = '0' + s;
    return s;
  }

  // Two independent FNV-1a lanes -> 16 hex chars (64 bits of fingerprint).
  function hashState(value) {
    var text = canonicalJSON(value);
    return hex8(fnv1a(text, 0x811c9dc5)) + hex8(fnv1a(text, 0x9e3779b9));
  }

  /* ------------------------------------------------------------------ *
   * Seeded RNG (mulberry32) for playouts with no agent                    *
   * ------------------------------------------------------------------ */

  function makeRng(seed) {
    var a = fnv1a('playout:' + String(seed), 0x811c9dc5);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * Registration and session creation                                   *
   * ------------------------------------------------------------------ */

  function protocolError(code, message, detail) {
    var e = new Error(message || code);
    e.code = code;
    if (detail !== undefined) e.detail = detail;
    return e;
  }

  function validSeats(value) {
    if (!Array.isArray(value) || !value.length) return null;
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string' || !value[i]) return null;
    }
    return value.slice();
  }

  function register(slug, factory) {
    if (typeof slug !== 'string' || !slug) {
      throw protocolError('invalid_registration', 'slug must be a non-empty string');
    }
    if (typeof factory !== 'function') {
      throw protocolError('invalid_registration', 'factory must be a function');
    }
    var seats = validSeats(factory.seats) || ['p1', 'p2'];
    var players = factory.players === undefined ? seats.length : factory.players;
    registry[slug] = {
      factory: factory,
      players: players,
      seats: seats,
      moves: factory.moves === undefined ? 'alternating' : factory.moves,
      source: factory.source === undefined ? '' : String(factory.source)
    };
    return api;
  }

  function list() {
    return Object.keys(registry).sort().map(function (slug) {
      var e = registry[slug];
      return {
        slug: slug,
        players: e.players,
        seats: e.seats.slice(),
        moves: e.moves,
        source: e.source
      };
    });
  }

  function create(slug, opts) {
    var entry = registry[slug];
    if (!entry) throw protocolError('unknown_game', 'no game registered as ' + slug, { slug: slug });
    opts = opts || {};
    var seed = opts.seed === undefined ? 1 : opts.seed;
    var session;
    try {
      session = entry.factory({ seed: seed });
    } catch (e) {
      if (e && e.code) throw e;
      throw protocolError('game_init_failed', 'factory failed: ' + (e && e.message), { slug: slug });
    }
    if (!session || typeof session.apply !== 'function' ||
        typeof session.state !== 'function' || typeof session.legalActions !== 'function') {
      throw protocolError('invalid_game', 'factory did not return a session', { slug: slug });
    }
    // Older adapters predate multi-seat support; give every session the same
    // seats array without changing any existing call signature.
    if (!validSeats(session.seats)) session.seats = entry.seats.slice();
    return session;
  }

  /* ------------------------------------------------------------------ *
   * Playout                                                            *
   * ------------------------------------------------------------------ */

  // agents: function(session, legalActions), array indexed by seat order, or
  // object keyed by seat id ('p1', 'p2', ...). Missing entries mean "random".
  function agentFor(agents, seat, seatIndex) {
    if (!agents) return null;
    var fn = null;
    if (typeof agents === 'function') fn = agents;
    else if (Array.isArray(agents)) fn = agents[seatIndex];
    else if (typeof agents === 'object') fn = agents[seat];
    if (fn && typeof fn === 'object' && typeof fn.choose === 'function') {
      fn = fn.choose.bind(fn);
    }
    return typeof fn === 'function' ? fn : null;
  }

  function actionFor(result, legal) {
    var i;
    if (typeof result === 'string') {
      for (i = 0; i < legal.length; i++) if (legal[i].id === result) return legal[i];
      return null;
    }
    if (typeof result === 'number') {
      if (!isFinite(result) || result < 0 || result >= legal.length) return null;
      return legal[Math.floor(result)];
    }
    if (result && typeof result === 'object') {
      if (typeof result.id === 'string') {
        for (i = 0; i < legal.length; i++) if (legal[i].id === result.id) return legal[i];
        return null;
      }
      var wanted = canonicalJSON(result);
      for (i = 0; i < legal.length; i++) {
        var merged = { type: legal[i].type };
        var payload = legal[i].payload || {};
        for (var k in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, k)) merged[k] = payload[k];
        }
        if (canonicalJSON(merged) === wanted) return legal[i];
      }
    }
    return null;
  }

  function playout(slug, agents, opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? 1 : opts.seed;
    var maxMoves = opts.maxMoves === undefined ? 5000 : Math.max(1, Math.floor(opts.maxMoves));
    var session = create(slug, { seed: seed });
    var rng = makeRng(seed);
    var log = [];
    var legal = session.legalActions();
    var seats = Array.isArray(session.seats) && session.seats.length
      ? session.seats : ['p1', 'p2'];

    while (legal.length && log.length < maxMoves) {
      var player = session.player();
      var seatIndex = seats.indexOf(player);
      if (seatIndex < 0) seatIndex = 0;
      var fn = agentFor(agents, player, seatIndex);
      var picked = null;
      if (fn) {
        var result = fn(session, legal);
        picked = actionFor(result, legal);
        if (!picked) {
          throw protocolError('illegal_agent_action',
            'agent returned an action that is not in legalActions',
            { game: slug, player: player, returned: result });
        }
      } else {
        picked = legal[Math.floor(rng() * legal.length)];
      }
      var res = session.apply(picked.id);
      if (!res || !res.ok) {
        throw protocolError('protocol_error',
          'a legal action was rejected: ' + (res && res.error),
          { game: slug, action: picked.id, error: res && res.error });
      }
      log.push({
        player: player,
        id: picked.id,
        type: picked.type,
        payload: cloneJSON(picked.payload)
      });
      legal = session.legalActions();
    }

    var status = session.status();
    return {
      winner: status.phase === 'over' ? status.winner : null,
      moves: log.length,
      hash: session.hash(),
      log: log
    };
  }

  var api = {
    version: VERSION,
    register: register,
    list: list,
    create: create,
    playout: playout,
    // Helpers for adapters and tests. Not part of the negotiated protocol.
    cloneJSON: cloneJSON,
    canonicalJSON: canonicalJSON,
    hashState: hashState
  };

  return api;
});
