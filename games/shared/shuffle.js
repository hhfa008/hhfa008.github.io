/* Shared shuffle engine for the card games.

   UMD: browsers read window.Shuffle (the pages include this file before their
   inline core), Node reads module.exports. No dependencies, one file.

   Why not Math.random
   -------------------
   Math.random is explicitly not a cryptographic PRNG. Its state can be
   recovered from a short run of outputs, so a player who observes a few
   deals can predict the next ones (and the engine's exact algorithm is
   browser-dependent, so a "fair" deal is not even reproducible). Every
   default path here therefore reads from crypto.getRandomValues (browser)
   or node:crypto.randomBytes (Node). Math.random appears nowhere in this
   file, not even as a fallback: if neither source exists we throw.

   Why Fisher-Yates is unbiased
   ----------------------------
   Walking i from n-1 down to 1 and picking j uniformly from 0..i gives every
   permutation exactly one path of choices, and the probability of any one
   path is 1/n * 1/(n-1) * ... * 1/2 * 1 = 1/n!. So all n! orders are equally
   likely. The common `array.sort(() => Math.random() - 0.5)` is NOT a shuffle:
   a comparison sort performs a different, data-dependent number of
   comparisons, so permutations get different probabilities.

   When our own RNG is used (crypto or seeded), `nextBelow` draws 32-bit words
   and rejects the incomplete top bucket, so j is exactly uniform. When a
   caller supplies an arbitrary float rng (the games' existing seeded
   mulberry32, kept for save/replay compatibility), j = floor(rng() * n); that
   has only the unavoidable ~n/2^53 float quantisation bias.

   Seed mode: sfc32 (Small Fast Counting PRNG) seeded by an FNV-1a hash of the
   seed, expanded with splitmix32. Same seed -> same sequence, everywhere.
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Shuffle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Cryptographic words                                                *
   * ------------------------------------------------------------------ */

  var nodeCrypto = null;
  if (typeof require === 'function') {
    try { nodeCrypto = require('node:crypto'); } catch (e) { nodeCrypto = null; }
  }

  // Pull random words in blocks: a 52-card shuffle needs 51 words, and the
  // statistical tests draw tens of millions, so one OS call per word would
  // dominate the runtime.
  var POOL_WORDS = 512;
  var pool = null;
  var poolPos = POOL_WORDS;

  function refillPool() {
    if (!pool) pool = new Uint32Array(POOL_WORDS);
    if (root && root.crypto && typeof root.crypto.getRandomValues === 'function') {
      root.crypto.getRandomValues(pool);
    } else if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
      var buf = nodeCrypto.randomBytes(POOL_WORDS * 4);
      for (var i = 0; i < POOL_WORDS; i++) pool[i] = buf.readUInt32BE(i * 4);
    } else {
      throw new Error('Shuffle: no cryptographic random source ' +
        '(crypto.getRandomValues or node:crypto.randomBytes)');
    }
    poolPos = 0;
  }

  function cryptoNextUint32() {
    if (!pool || poolPos >= POOL_WORDS) refillPool();
    return pool[poolPos++];
  }

  /* ------------------------------------------------------------------ *
   * Seeded PRNG: FNV-1a hash -> splitmix32 expansion -> sfc32           *
   * ------------------------------------------------------------------ */

  function hashSeed(seed) {
    var str = typeof seed === 'string' ? seed : String(seed);
    var h = 0x811c9dc5; // FNV-1a 32-bit offset basis
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    return h >>> 0;
  }

  function splitmix32(a) {
    return function () {
      a |= 0;
      a = (a + 0x9e3779b9) | 0;
      var t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      t ^= t >>> 15;
      return t >>> 0;
    };
  }

  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      var t = ((a + b) | 0) + d | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return t >>> 0;
    };
  }

  function makeSeeded(seed) {
    var mix = splitmix32(hashSeed(seed));
    var a = mix(), b = mix(), c = mix(), d = mix();
    if ((a | b | c | d) === 0) a = 1; // all-zero sfc32 state never advances
    var next = sfc32(a, b, c, d);
    for (var i = 0; i < 15; i++) next(); // discard warm-up output
    return next;
  }

  /* ------------------------------------------------------------------ *
   * RNG factory                                                        *
   * ------------------------------------------------------------------ */

  // createRng() -> CSPRNG-backed float generator.
  // createRng(seed) -> deterministic sfc32 float generator.
  // The returned function is plain `() => float in [0, 1)` as documented.
  // Its `.nextUint32` property lets the shuffle draw exact 32-bit words.
  function createRng(seed) {
    var nextUint32 = (seed === undefined || seed === null)
      ? cryptoNextUint32
      : makeSeeded(seed);
    function rng() { return nextUint32() / 4294967296; }
    rng.nextUint32 = nextUint32;
    return rng;
  }

  function resolveRng(opts) {
    if (opts && opts.seed !== undefined && opts.seed !== null) return createRng(opts.seed);
    if (opts && opts.rng !== undefined && opts.rng !== null) {
      if (typeof opts.rng !== 'function') {
        throw new TypeError('Shuffle: opts.rng must be a function returning [0, 1)');
      }
      return opts.rng;
    }
    return createRng();
  }

  // Uniform integer in [0, n). Uses rejection sampling on 32-bit words when
  // available, so no modulo bias; falls back to the caller's float rng.
  function nextBelow(rng, n) {
    if (n <= 0) throw new RangeError('Shuffle: bound must be positive');
    if (typeof rng.nextUint32 === 'function') {
      var range = 4294967296;
      var limit = range - (range % n);
      var x;
      do { x = rng.nextUint32(); } while (x >= limit);
      return x % n;
    }
    var j = Math.floor(rng() * n);
    return j >= n ? n - 1 : (j < 0 ? 0 : j);
  }

  /* ------------------------------------------------------------------ *
   * Fisher-Yates                                                       *
   * ------------------------------------------------------------------ */

  function shuffleInPlace(array, opts) {
    if (!Array.isArray(array)) throw new TypeError('Shuffle: expected an array');
    var n = array.length;
    if (n < 2) return array;
    var rng = resolveRng(opts);
    for (var i = n - 1; i > 0; i--) {
      var j = nextBelow(rng, i + 1);
      var t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  function shuffle(array, opts) {
    if (!Array.isArray(array)) throw new TypeError('Shuffle: expected an array');
    return shuffleInPlace(array.slice(), opts);
  }

  /* ------------------------------------------------------------------ *
   * Standard deck / dealing                                            *
   * ------------------------------------------------------------------ */

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var SUITS = ['♠', '♥', '♦', '♣']; // spade heart diamond club

  function makeCard(rank, suit) {
    return {
      id: rank + suit,
      rank: rank,
      suit: suit,
      red: suit === '♥' || suit === '♦'
    };
  }

  function jokerCard(id, red) {
    return { id: id, rank: 'Joker', suit: '', red: red, joker: true };
  }

  // shuffleDeck({jokers}) -> 52 cards, or 54 with the two jokers.
  // jokers: true | 1 | 2. Also accepts {seed} / {rng} for reproducible deals.
  function shuffleDeck(opts) {
    opts = opts || {};
    var jokers = opts.jokers === true ? 2
      : (opts.jokers === 1 ? 1 : (opts.jokers === 2 ? 2 : 0));
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) deck.push(makeCard(RANKS[r], SUITS[s]));
    }
    if (jokers >= 1) deck.push(jokerCard('SJ', false));
    if (jokers >= 2) deck.push(jokerCard('BJ', true));
    return shuffle(deck, opts);
  }

  // deal(deck, hands, perHand) -> array of `hands` arrays of `perHand` cards.
  // Takes cards from the front of the deck without mutating it; throws when
  // there are not enough cards instead of silently dealing a short hand.
  function deal(deck, hands, perHand) {
    if (!Array.isArray(deck)) throw new TypeError('deal: deck must be an array');
    if (typeof hands !== 'number' || hands < 0 || hands % 1 !== 0) {
      throw new RangeError('deal: hands must be a non-negative integer');
    }
    if (typeof perHand !== 'number' || perHand < 0 || perHand % 1 !== 0) {
      throw new RangeError('deal: perHand must be a non-negative integer');
    }
    var need = hands * perHand;
    if (need > deck.length) {
      throw new RangeError('deal: not enough cards (' + deck.length + ' < ' + need + ')');
    }
    var out = [];
    var k = 0;
    for (var h = 0; h < hands; h++) {
      var hand = [];
      for (var c = 0; c < perHand; c++) hand.push(deck[k++]);
      out.push(hand);
    }
    return out;
  }

  return {
    createRng: createRng,
    shuffle: shuffle,
    shuffleInPlace: shuffleInPlace,
    shuffleDeck: shuffleDeck,
    deal: deal,
    hashSeed: hashSeed, // exposed for tests/tools; not needed at runtime
    RANKS: RANKS,
    SUITS: SUITS
  };
});
