/* Dou Dizhu (斗地主) — premium UMD rules engine.
 *
 * Node:    const E = require('./engine.js');
 * Browser: window.DoudizhuPremiumEngine
 *
 * Real rules implemented (54 cards, three players):
 *  - 3..2 in four suits plus small joker (16) and big joker (17) = 54 cards.
 *  - Deal 17/17/17 plus a 3-card bottom. Bidding 1/2/3 (or pass) clockwise;
 *    the highest bidder becomes the landlord and takes the bottom (20 cards).
 *  - Hand types: single, pair, triple, triple+single, triple+pair,
 *    straight (>=5), consecutive pairs (>=3), plane (>=2 triples),
 *    plane+singles, plane+pairs, four+two singles, four+two pairs, bomb,
 *    rocket. A hand beats another only with the same type and card count and a
 *    higher main rank; a bomb beats any normal hand, a bigger bomb beats a
 *    smaller one, and the rocket beats everything.
 *  - After two consecutive passes the last player leads freely again.
 *  - Emptying your hand wins. Landlord plays alone against the two farmers.
 *  - Score = base × bid × 2^(bombs+rockets played). Landlord settles double.
 *
 * The deal uses games/shared/shuffle.js (seeded sfc32 Fisher–Yates), never
 * Math.random. The engine is deterministic and serialisable so the room server
 * can own the authoritative state and send each seat a masked public view.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DoudizhuPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('DoudizhuPremiumEngine requires games/shared/shuffle.js');
  }

  var SMALL_JOKER = 16, BIG_JOKER = 17;
  var SUITS = ['♠', '♥', '♣', '♦'];
  var SUIT_KEYS = ['S', 'H', 'C', 'D'];
  var RED_SUITS = { 1: true, 3: true };
  var BASE_SCORE = 1;
  var MAX_REDEALS = 24;
  var MAX_TURNS = 3000;
  var DEFAULT_NAMES = ['玩家', 'AI 右', 'AI 左'];

  /* ------------------------------------------------------------------ cards */

  function makeDeck() {
    var deck = [];
    for (var r = 3; r <= 15; r++) {
      for (var s = 0; s < 4; s++) deck.push({ id: SUIT_KEYS[s] + r, r: r, s: s });
    }
    deck.push({ id: 'SJ', r: SMALL_JOKER, s: -1 });
    deck.push({ id: 'BJ', r: BIG_JOKER, s: -1 });
    return deck;
  }

  function getRank(c) { return typeof c === 'number' ? c : c.r; }
  function getCardId(c) { return typeof c === 'number' ? String(c) : c.id; }
  function isJoker(c) { var r = getRank(c); return r === SMALL_JOKER || r === BIG_JOKER; }
  function isRed(c) {
    if (isJoker(c)) return getRank(c) === BIG_JOKER;
    return !!RED_SUITS[typeof c === 'number' ? 0 : c.s];
  }
  function suitChar(c) {
    if (isJoker(c)) return '';
    if (typeof c === 'number') return SUITS[0];
    return SUITS[c.s] || '';
  }
  function rankName(r) {
    r = getRank(r);
    if (r === SMALL_JOKER) return '小王';
    if (r === BIG_JOKER) return '大王';
    if (r === 11) return 'J';
    if (r === 12) return 'Q';
    if (r === 13) return 'K';
    if (r === 14) return 'A';
    if (r === 15) return '2';
    return String(r);
  }
  function cardLabel(c) {
    var r = getRank(c);
    if (r === SMALL_JOKER) return '小王';
    if (r === BIG_JOKER) return '大王';
    return suitChar(c) + rankName(r);
  }
  function cardCmp(a, b) {
    var ra = getRank(a), rb = getRank(b);
    if (ra !== rb) return ra - rb;
    var sa = typeof a === 'number' ? -1 : a.s, sb = typeof b === 'number' ? -1 : b.s;
    return sa - sb;
  }
  function sortCards(cards) { return cards.sort(cardCmp); }
  function sortHand(hand) { return sortCards(hand.slice()); }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(deck, rand) {
    if (rand) return ShuffleApi.shuffleInPlace(deck, { rng: rand });
    return ShuffleApi.shuffleInPlace(deck, {});
  }

  function deal(seed) {
    var deck = seed == null
      ? ShuffleApi.shuffle(makeDeck())
      : ShuffleApi.shuffle(makeDeck(), { seed: seed });
    var hands = [[], [], []];
    for (var i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
    for (var h = 0; h < 3; h++) sortCards(hands[h]);
    return { hands: hands, bottom: sortCards(deck.slice(51)), deck: deck };
  }

  function groupOf(cards) {
    var counts = {}, groups = {}, ranks = [], hand = cards.slice();
    for (var i = 0; i < hand.length; i++) {
      var r = getRank(hand[i]);
      if (!counts[r]) { counts[r] = 0; ranks.push(r); groups[r] = []; }
      counts[r]++; groups[r].push(hand[i]);
    }
    ranks.sort(function (a, b) { return a - b; });
    for (var k = 0; k < ranks.length; k++) groups[ranks[k]].sort(cardCmp);
    return { counts: counts, groups: groups, ranks: ranks, hand: hand };
  }

  /* -------------------------------------------------------- hand type rules */

  function result(type, main, cards, extra) {
    var o = { type: type, main: main, count: cards.length, cards: cards.slice() };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }

  function consecutive(ranks) {
    for (var i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
    return true;
  }

  function detect(cards) {
    if (!cards || !cards.length) return null;
    var seenId = {}, si;
    for (si = 0; si < cards.length; si++) {
      var cid = typeof cards[si] === 'string' ? cards[si] : (cards[si] && cards[si].id);
      if (cid == null) continue;
      if (seenId[cid]) return null; // a real 54-card deck has no duplicate ids
      seenId[cid] = 1;
    }
    var n = cards.length;
    var g = groupOf(cards);
    var counts = g.counts, ranks = g.ranks, uniq = ranks.length;

    if (n === 2 && counts[SMALL_JOKER] === 1 && counts[BIG_JOKER] === 1) {
      return result('rocket', BIG_JOKER, cards);
    }
    if (n === 4 && uniq === 1 && counts[ranks[0]] === 4) return result('bomb', ranks[0], cards);
    if (n === 1) return result('single', ranks[0], cards);
    if (n === 2 && uniq === 1) return result('pair', ranks[0], cards);
    if (n === 3 && uniq === 1) return result('triple', ranks[0], cards);

    if (n === 4 && uniq === 2) {
      var t4 = ranks.filter(function (r) { return counts[r] === 3; });
      if (t4.length === 1) return result('triple_single', t4[0], cards);
    }
    if (n === 5 && uniq === 2) {
      var t5 = ranks.filter(function (r) { return counts[r] === 3; });
      var p5 = ranks.filter(function (r) { return counts[r] === 2; });
      if (t5.length === 1 && p5.length === 1) return result('triple_pair', t5[0], cards);
    }

    if (n >= 5 && uniq === n && consecutive(ranks) && ranks[0] >= 3 && ranks[uniq - 1] <= 14) {
      return result('straight', ranks[uniq - 1], cards, { start: ranks[0], length: n });
    }

    if (n >= 6 && n % 2 === 0 && uniq === n / 2 && consecutive(ranks) &&
        ranks[0] >= 3 && ranks[uniq - 1] <= 14) {
      var allPairs = true;
      for (var pi = 0; pi < ranks.length; pi++) if (counts[ranks[pi]] !== 2) { allPairs = false; break; }
      if (allPairs) return result('straight_pair', ranks[uniq - 1], cards, { start: ranks[0], pairs: uniq });
    }

    var plane = findPlane(g, n, cards);
    if (plane) return plane;

    var quads = ranks.filter(function (r) { return counts[r] === 4; });
    if (n === 6 && quads.length === 1) return result('four_two_single', quads[0], cards);
    if (n === 8 && quads.length === 1) {
      var rest = [];
      for (var qi = 0; qi < ranks.length; qi++) {
        var rr = ranks[qi];
        var left = counts[rr] - (rr === quads[0] ? 4 : 0);
        if (left) rest.push([rr, left]);
      }
      if (rest.length === 2 && rest[0][1] === 2 && rest[1][1] === 2) {
        return result('four_two_pair', quads[0], cards);
      }
    }
    return null;
  }

  function exactTriples(counts, start, len) {
    for (var i = 0; i < len; i++) if (counts[start + i] !== 3) return false;
    return true;
  }

  function findPlane(g, n, cards) {
    var counts = g.counts, ranks = g.ranks;

    function bodyOk(start, len, exact) {
      for (var i = 0; i < len; i++) {
        var r = start + i;
        if (exact ? counts[r] !== 3 : (counts[r] || 0) < 3) return false;
      }
      return true;
    }
    function outsideTotals(start, len) {
      var out = {}, total = 0, ok = true;
      for (var i = 0; i < ranks.length; i++) {
        var r = ranks[i];
        if (r >= start && r < start + len) continue;
        out[r] = counts[r];
        total += counts[r];
        if (counts[r] > 4) ok = false;
      }
      return { out: out, total: total, ok: ok };
    }

    // Bare plane: exactly k consecutive triples.
    if (n % 3 === 0) {
      var k3 = n / 3;
      if (k3 >= 2) {
        for (var s3 = 3; s3 + k3 - 1 <= 14; s3++) {
          if (exactTriples(counts, s3, k3) && ranks.length === k3 &&
              ranks[0] === s3 && ranks[ranks.length - 1] === s3 + k3 - 1) {
            return result('plane', s3 + k3 - 1, cards, { start: s3, triples: k3 });
          }
        }
      }
    }

    // Plane + one single per triple. Wings may not reuse a body rank.
    if (n % 4 === 0) {
      var k4 = n / 4;
      if (k4 >= 2) {
        for (var s4 = 3; s4 + k4 - 1 <= 14; s4++) {
          if (!bodyOk(s4, k4, true)) continue;
          var o4 = outsideTotals(s4, k4);
          if (o4.total !== k4) continue;
          return result('plane_single', s4 + k4 - 1, cards, { start: s4, triples: k4 });
        }
      }
    }

    // Plane + one pair per triple.
    if (n % 5 === 0) {
      var k5 = n / 5;
      if (k5 >= 2) {
        for (var s5 = 3; s5 + k5 - 1 <= 14; s5++) {
          if (!bodyOk(s5, k5, true)) continue;
          var o5 = outsideTotals(s5, k5);
          if (o5.total !== 2 * k5) continue;
          var pairs = 0, bad = false;
          for (var rk in o5.out) {
            if (!Object.prototype.hasOwnProperty.call(o5.out, rk)) continue;
            if (o5.out[rk] === 2) pairs++;
            else { bad = true; break; }
          }
          if (!bad && pairs === k5) {
            return result('plane_pair', s5 + k5 - 1, cards, { start: s5, triples: k5 });
          }
        }
      }
    }
    return null;
  }

  function canBeat(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.type === 'rocket') return b.type !== 'rocket';
    if (b.type === 'rocket') return false;
    if (a.type === 'bomb') {
      if (b.type === 'bomb') return a.main > b.main;
      return true;
    }
    if (b.type === 'bomb') return false;
    if (a.type !== b.type) return false;
    if (a.count !== b.count) return false;
    return a.main > b.main;
  }

  /* -------------------------------------------------- legal play enumeration */

  function takeKickers(remaining, k, counts, banned) {
    banned = banned || {};
    var copy = remaining.slice().sort(function (a, b) {
      var ra = getRank(a), rb = getRank(b);
      var ca = counts[ra] || 0, cb = counts[rb] || 0;
      var pa = ca >= 3 ? 1 : 0, pb = cb >= 3 ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return cardCmp(a, b);
    });
    var picked = [], per = {}, left = k;
    for (var i = 0; i < copy.length && left > 0; i++) {
      var r = getRank(copy[i]);
      if (banned[r]) continue;
      per[r] = per[r] || 0;
      if (per[r] >= 2) continue;
      per[r]++; picked.push(copy[i]); left--;
    }
    return picked;
  }

  function genType(g, type, needCount, out, seen) {
    var counts = g.counts, groups = g.groups, ranks = g.ranks, hand = g.hand;
    var i, r, start, len, cards, body, remaining, pairRanks, picks;

    function add(selected) {
      if (needCount && selected.length !== needCount) return;
      var p = detect(selected);
      if (!p || p.type !== type) return;
      var sig = p.type + ':' + p.main + ':' + p.count;
      if (seen[sig]) return;
      seen[sig] = 1;
      out.push(p);
    }

    if (type === 'single') {
      for (i = 0; i < ranks.length; i++) add([groups[ranks[i]][0]]);
      return;
    }
    if (type === 'pair') {
      for (i = 0; i < ranks.length; i++) {
        r = ranks[i];
        if (counts[r] >= 2) add(groups[r].slice(0, 2));
      }
      return;
    }
    if (type === 'triple') {
      for (i = 0; i < ranks.length; i++) {
        r = ranks[i];
        if (counts[r] >= 3) add(groups[r].slice(0, 3));
      }
      return;
    }
    if (type === 'triple_single') {
      for (i = 0; i < ranks.length; i++) {
        r = ranks[i];
        if (counts[r] < 3) continue;
        body = groups[r].slice(0, 3);
        for (var j = 0; j < ranks.length; j++) {
          if (ranks[j] === r) continue;
          add(body.concat(groups[ranks[j]].slice(0, 1)));
        }
      }
      return;
    }
    if (type === 'triple_pair') {
      for (i = 0; i < ranks.length; i++) {
        r = ranks[i];
        if (counts[r] < 3) continue;
        body = groups[r].slice(0, 3);
        for (var j2 = 0; j2 < ranks.length; j2++) {
          var u = ranks[j2];
          if (u === r || counts[u] < 2) continue;
          add(body.concat(groups[u].slice(0, 2)));
        }
      }
      return;
    }
    if (type === 'straight') {
      for (start = 3; start <= 14; start++) {
        var end = start;
        while (end <= 14 && (counts[end] || 0) >= 1) end++;
        for (len = 5; start + len - 1 < end; len++) {
          cards = [];
          for (i = 0; i < len; i++) cards.push(groups[start + i][0]);
          add(cards);
        }
      }
      return;
    }
    if (type === 'straight_pair') {
      for (start = 3; start <= 14; start++) {
        var end2 = start;
        while (end2 <= 14 && (counts[end2] || 0) >= 2) end2++;
        for (len = 3; start + len - 1 < end2; len++) {
          cards = [];
          for (i = 0; i < len; i++) cards = cards.concat(groups[start + i].slice(0, 2));
          add(cards);
        }
      }
      return;
    }
    if (type === 'plane' || type === 'plane_single' || type === 'plane_pair') {
      var per = type === 'plane' ? 3 : type === 'plane_single' ? 4 : 5;
      for (start = 3; start <= 14; start++) {
        var end3 = start;
        while (end3 <= 14 && (counts[end3] || 0) >= 3) end3++;
        var maxLen = end3 - start;
        for (len = 2; len <= maxLen; len++) {
          if (needCount && needCount !== per * len) continue;
          body = [];
          var banned = {};
          for (i = 0; i < len; i++) {
            body = body.concat(groups[start + i].slice(0, 3));
            banned[start + i] = 1;
          }
          if (type === 'plane') { add(body); continue; }
          remaining = hand.filter(function (c) { return body.indexOf(c) < 0; });
          if (type === 'plane_single') {
            picks = takeKickers(remaining, len, counts, banned);
            if (picks.length === len) add(body.concat(picks));
          } else {
            var remCounts = {};
            for (i = 0; i < remaining.length; i++) {
              var rr = getRank(remaining[i]);
              remCounts[rr] = (remCounts[rr] || 0) + 1;
            }
            pairRanks = [];
            for (var rk in remCounts) {
              if (!Object.prototype.hasOwnProperty.call(remCounts, rk)) continue;
              if (!banned[rk] && remCounts[rk] >= 2) pairRanks.push(Number(rk));
            }
            pairRanks.sort(function (a, b) { return a - b; });
            if (pairRanks.length >= len) {
              cards = body.slice();
              for (i = 0; i < len; i++) cards = cards.concat(groups[pairRanks[i]].slice(0, 2));
              add(cards);
            }
          }
        }
      }
      return;
    }
    if (type === 'four_two_single' || type === 'four_two_pair') {
      for (i = 0; i < ranks.length; i++) {
        r = ranks[i];
        if (counts[r] !== 4) continue;
        body = groups[r].slice(0, 4);
        remaining = hand.filter(function (c) { return body.indexOf(c) < 0; });
        if (type === 'four_two_single') {
          picks = takeKickers(remaining, 2, counts, {});
          if (picks.length === 2) add(body.concat(picks));
        } else {
          var remCounts2 = {};
          for (i = 0; i < remaining.length; i++) {
            var rr2 = getRank(remaining[i]);
            remCounts2[rr2] = (remCounts2[rr2] || 0) + 1;
          }
          pairRanks = [];
          for (var rk2 in remCounts2) {
            if (!Object.prototype.hasOwnProperty.call(remCounts2, rk2)) continue;
            if (remCounts2[rk2] >= 2) pairRanks.push(Number(rk2));
          }
          pairRanks.sort(function (a, b) { return a - b; });
          if (pairRanks.length >= 2) {
            cards = body.concat(groups[pairRanks[0]].slice(0, 2), groups[pairRanks[1]].slice(0, 2));
            add(cards);
          }
        }
      }
      return;
    }
    if (type === 'bomb') {
      for (i = 0; i < ranks.length; i++) {
        r = ranks[i];
        if (counts[r] === 4) add(groups[r].slice(0, 4));
      }
      return;
    }
    if (type === 'rocket') {
      if (counts[SMALL_JOKER] && counts[BIG_JOKER]) {
        add([groups[SMALL_JOKER][0], groups[BIG_JOKER][0]]);
      }
    }
  }

  var ALL_TYPES = ['single', 'pair', 'triple', 'triple_single', 'triple_pair', 'straight',
    'straight_pair', 'plane', 'plane_single', 'plane_pair', 'four_two_single',
    'four_two_pair', 'bomb', 'rocket'];

  function playSort(a, b) {
    var bombA = a.type === 'bomb' || a.type === 'rocket' ? 1 : 0;
    var bombB = b.type === 'bomb' || b.type === 'rocket' ? 1 : 0;
    if (bombA !== bombB) return bombA - bombB;
    if (a.main !== b.main) return a.main - b.main;
    return a.count - b.count;
  }

  function findAllPlays(hand, last) {
    var g = groupOf(hand);
    var out = [], seen = {};
    if (last) {
      if (last.type === 'rocket') return out;
      if (last.type === 'bomb') {
        genType(g, 'bomb', 4, out, seen);
      } else {
        genType(g, last.type, last.count, out, seen);
        genType(g, 'bomb', 4, out, seen);
      }
      genType(g, 'rocket', 2, out, seen);
    } else {
      for (var t = 0; t < ALL_TYPES.length; t++) genType(g, ALL_TYPES[t], null, out, seen);
    }
    if (last) out = out.filter(function (p) { return canBeat(p, last); });
    out.sort(playSort);
    return out;
  }

  function suggest(hand, last) {
    if (!hand || !hand.length) return null;
    if (!last) {
      var sorted = sortHand(hand);
      return detect([sorted[0]]);
    }
    var plays = findAllPlays(hand, last);
    if (!plays.length) return null;
    var normal = plays.filter(function (p) { return p.type !== 'bomb' && p.type !== 'rocket'; });
    var pool = normal.length ? normal : plays;
    pool.sort(playSort);
    return pool[0];
  }

  /* ------------------------------------------------------------------- state */

  function nextRandom(state) {
    var a = (state.rngState | 0) + 0x6D2B79F5 | 0;
    state.rngState = a;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 120) state.log.shift();
  }
  function emit(state, event) {
    state.events.push(event);
    if (state.events.length > 160) state.events.shift();
  }

  function dealInto(state, seed) {
    var dealt = deal(seed);
    state.seed = seed;
    state.hands = dealt.hands;
    state.bottom = dealt.bottom;
    state.deckIds = dealt.deck.map(function (c) { return c.id; });
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var names = opts.names || DEFAULT_NAMES;
    var state = {
      version: 1,
      seed: seed,
      rngState: (seed | 0) || 1,
      phase: 'bid',
      players: [0, 1, 2].map(function (i) {
        return { seat: i, name: names[i] || DEFAULT_NAMES[i], human: opts.human ? Boolean(opts.human[i]) : i === 0 };
      }),
      hands: [[], [], []],
      bottom: [],
      deckIds: [],
      landlord: -1,
      bid: 0,
      bidding: { turn: 0, first: 0, highest: 0, bidder: -1, acted: 0, actions: [], done: false },
      turn: 0,
      lastPlay: null,
      lastPlayer: -1,
      passes: 0,
      baseScore: opts.baseScore == null ? BASE_SCORE : opts.baseScore,
      bombsPlayed: 0,
      multiplier: 1,
      history: [],
      playedIds: [],
      winner: -1,
      winnerSide: '',
      reason: '',
      redeals: 0,
      turns: 0,
      log: [],
      events: []
    };
    dealInto(state, seed);
    var first = opts.firstBidder == null ? Math.floor(nextRandom(state) * 3) % 3 : (opts.firstBidder % 3);
    state.bidding.first = first;
    state.bidding.turn = first;
    log(state, '发牌完成：每家 17 张，底牌 3 张。由 ' + state.players[first].name + ' 先叫分。');
    emit(state, { type: 'start', first: first, phase: 'bid' });
    return state;
  }

  function clone(state) {
    return {
      version: state.version,
      seed: state.seed,
      rngState: state.rngState,
      phase: state.phase,
      players: state.players.map(function (p) { return { seat: p.seat, name: p.name, human: p.human }; }),
      hands: state.hands.map(function (h) { return h.slice(); }),
      bottom: state.bottom.slice(),
      deckIds: state.deckIds.slice(),
      landlord: state.landlord,
      bid: state.bid,
      bidding: {
        turn: state.bidding.turn, first: state.bidding.first, highest: state.bidding.highest,
        bidder: state.bidding.bidder, acted: state.bidding.acted,
        actions: state.bidding.actions.slice(), done: state.bidding.done
      },
      turn: state.turn,
      lastPlay: state.lastPlay ? {
        type: state.lastPlay.type, main: state.lastPlay.main, count: state.lastPlay.count,
        cards: state.lastPlay.cards.slice(), start: state.lastPlay.start, triples: state.lastPlay.triples,
        pairs: state.lastPlay.pairs, length: state.lastPlay.length
      } : null,
      lastPlayer: state.lastPlayer,
      passes: state.passes,
      baseScore: state.baseScore,
      bombsPlayed: state.bombsPlayed,
      multiplier: state.multiplier,
      history: state.history.map(function (h) {
        return { seat: h.seat, type: h.type, main: h.main, count: h.count, cards: h.cards.slice() };
      }),
      playedIds: state.playedIds.slice(),
      winner: state.winner,
      winnerSide: state.winnerSide,
      reason: state.reason,
      redeals: state.redeals,
      turns: state.turns,
      log: state.log.slice(),
      events: state.events.slice()
    };
  }

  function currentSeat(state) {
    if (!state) return -1;
    if (state.phase === 'bid') return state.bidding.turn;
    if (state.phase === 'play') return state.turn;
    return -1;
  }

  /* ---------------------------------------------------------------- bidding */

  function finalizeBidding(state) {
    var b = state.bidding;
    b.done = true;
    if (b.highest <= 0) {
      state.redeals += 1;
      if (state.redeals > MAX_REDEALS) {
        // Pathological seed guard: force the first bidder to take the landlord
        // at the minimum bid instead of looping forever.
        b.highest = 1;
        b.bidder = b.first;
        state.landlord = b.first;
        state.bid = 1;
        state.hands[b.first] = sortHand(state.hands[b.first].concat(state.bottom));
        state.phase = 'play';
        state.turn = b.first;
        log(state, '连续无人叫分达到上限，' + state.players[b.first].name + ' 以 1 分成为地主。');
        emit(state, { type: 'landlord', seat: b.first, bid: 1, forced: true });
        return { redeal: false };
      }
      var newSeed = ((state.seed * 1664525 + 1013904223 + state.redeals * 2654435761) >>> 0) || 1;
      dealInto(state, newSeed);
      var first = (b.first + 1) % 3;
      state.bidding = { turn: first, first: first, highest: 0, bidder: -1, acted: 0, actions: [], done: false };
      log(state, '三家都不叫，重新发牌。');
      emit(state, { type: 'redeal', redeals: state.redeals, first: first });
      return { redeal: true };
    }
    state.landlord = b.bidder;
    state.bid = b.highest;
    state.hands[b.bidder] = sortHand(state.hands[b.bidder].concat(state.bottom));
    state.phase = 'play';
    state.turn = b.bidder;
    state.bidding.done = true;
    log(state, state.players[b.bidder].name + ' 以 ' + b.highest + ' 分成为地主，获得 3 张底牌，先出牌。');
    emit(state, { type: 'landlord', seat: b.bidder, bid: b.highest, forced: false });
    return { redeal: false };
  }

  function applyBid(state, seat, action) {
    var b = state.bidding;
    if (seat !== b.turn) return { ok: false, error: 'not your bid turn', code: 'E_TURN' };
    var score = action.score == null ? 0 : Number(action.score);
    if ([0, 1, 2, 3].indexOf(score) < 0) return { ok: false, error: 'bid must be 0..3', code: 'E_BID' };
    if (score !== 0 && score <= b.highest) return { ok: false, error: 'bid must exceed ' + b.highest, code: 'E_BID' };
    b.actions.push({ seat: seat, score: score });
    b.acted += 1;
    if (score > b.highest) { b.highest = score; b.bidder = seat; }
    log(state, state.players[seat].name + (score === 0 ? ' 不叫。' : ' 叫 ' + score + ' 分。'));
    emit(state, { type: 'bid', seat: seat, score: score, highest: b.highest });
    state.turns += 1;
    var done = score === 3 || b.acted >= 3;
    if (done) return Object.assign({ ok: true, phase: state.phase }, finalizeBidding(state));
    b.turn = (seat + 1) % 3;
    return { ok: true };
  }

  /* ---------------------------------------------------------------- playing */

  function resolveCards(hand, given) {
    var pool = hand.slice();
    var picked = [];
    if (!Array.isArray(given)) return null;
    for (var i = 0; i < given.length; i++) {
      var want = typeof given[i] === 'string' ? given[i] : (given[i] && given[i].id);
      var at = -1;
      for (var j = 0; j < pool.length; j++) if (pool[j].id === want) { at = j; break; }
      if (at < 0) return null;
      picked.push(pool[at]);
      pool.splice(at, 1);
    }
    return picked;
  }

  function finish(state, seat) {
    state.phase = 'over';
    state.winner = seat;
    var landlordWon = seat === state.landlord;
    state.winnerSide = landlordWon ? 'landlord' : 'farmers';
    state.reason = 'empty-hand';
    var text = landlordWon ? '地主获胜' : '农民获胜';
    log(state, state.players[seat].name + ' 出完手牌，' + text + '。');
    emit(state, { type: 'over', winner: seat, side: state.winnerSide });
  }

  function applyPlay(state, seat, action) {
    if (seat !== state.turn) return { ok: false, error: 'not your turn', code: 'E_TURN' };
    if (action.k === 'pass') {
      if (!state.lastPlay) return { ok: false, error: 'cannot pass on a free lead', code: 'E_PASS' };
      state.passes += 1;
      log(state, state.players[seat].name + ' 不要。');
      emit(state, { type: 'pass', seat: seat, passes: state.passes });
      state.turns += 1;
      if (state.passes >= 2) {
        state.lastPlay = null;
        state.lastPlayer = -1;
        state.passes = 0;
        emit(state, { type: 'free-lead', seat: (seat + 1) % 3 });
        log(state, '两家连续不要，' + state.players[(seat + 1) % 3].name + ' 重新自由出牌。');
      }
      state.turn = (seat + 1) % 3;
      return { ok: true, passed: true };
    }
    if (action.k !== 'play') return { ok: false, error: 'unknown action', code: 'E_ACTION' };
    var cards = resolveCards(state.hands[seat], action.cards || action.cards === 0 ? action.cards : null);
    if (!cards || !cards.length) return { ok: false, error: 'cards not in hand', code: 'E_CARDS' };
    var play = detect(cards);
    if (!play) return { ok: false, error: 'not a legal hand type', code: 'E_TYPE' };
    if (state.lastPlay && !canBeat(play, state.lastPlay)) {
      return { ok: false, error: 'does not beat the last play', code: 'E_BEAT' };
    }
    var removed = cards.map(function (c) { return c.id; });
    for (var i = 0; i < cards.length; i++) {
      var at = state.hands[seat].indexOf(cards[i]);
      if (at >= 0) state.hands[seat].splice(at, 1);
    }
    state.playedIds = state.playedIds.concat(removed);
    state.history.push({ seat: seat, type: play.type, main: play.main, count: play.count, cards: play.cards.slice() });
    if (play.type === 'bomb' || play.type === 'rocket') {
      state.bombsPlayed += 1;
      state.multiplier = Math.pow(2, state.bombsPlayed);
      emit(state, { type: 'bomb', seat: seat, kind: play.type, bombs: state.bombsPlayed, multiplier: state.multiplier });
      log(state, (play.type === 'rocket' ? '王炸' : '炸弹') + '！倍数升到 ' + state.multiplier + ' 倍。');
    }
    state.lastPlay = play;
    state.lastPlayer = seat;
    state.passes = 0;
    state.turns += 1;
    log(state, state.players[seat].name + ' 出 ' + typeName(play.type) + '（' + play.cards.map(cardLabel).join(' ') + '）。');
    emit(state, { type: 'play', seat: seat, handType: play.type, main: play.main, count: play.count, cards: removed });
    if (!state.hands[seat].length) {
      finish(state, seat);
      return { ok: true, over: true, winner: seat, play: play };
    }
    state.turn = (seat + 1) % 3;
    return { ok: true, play: play };
  }

  function applyAction(state, action, seat) {
    if (!state || state.phase === 'over') return { ok: false, error: 'game is over', code: 'E_STATE' };
    if (!action) return { ok: false, error: 'missing action', code: 'E_ACTION' };
    var actual = seat == null ? currentSeat(state) : seat;
    if (actual !== currentSeat(state)) return { ok: false, error: 'not this seat\'s turn', code: 'E_TURN' };
    if (state.phase === 'bid') {
      if (action.k !== 'bid') return { ok: false, error: 'bidding phase expects a bid', code: 'E_PHASE' };
      return applyBid(state, actual, action);
    }
    return applyPlay(state, actual, action);
  }

  function legalActions(state, seat) {
    var out = [];
    if (!state || state.phase === 'over') return out;
    var who = seat == null ? currentSeat(state) : seat;
    if (who !== currentSeat(state) || who < 0) return out;
    if (state.phase === 'bid') {
      var high = state.bidding.highest;
      out.push({ k: 'bid', score: 0 });
      for (var s = 1; s <= 3; s++) if (s > high) out.push({ k: 'bid', score: s });
      return out;
    }
    var hand = state.hands[who];
    if (!hand.length) return out;
    var plays = findAllPlays(hand, state.lastPlay);
    for (var i = 0; i < plays.length; i++) {
      out.push({ k: 'play', cards: plays[i].cards.map(function (c) { return c.id; }), play: plays[i] });
    }
    if (state.lastPlay) out.push({ k: 'pass' });
    return out;
  }

  function isLegal(state, action, seat) {
    if (!state || !action) return false;
    var who = seat == null ? currentSeat(state) : seat;
    if (who !== currentSeat(state) || who < 0) return false;
    if (state.phase === 'bid') {
      if (action.k !== 'bid') return false;
      var score = action.score == null ? 0 : Number(action.score);
      return [0, 1, 2, 3].indexOf(score) >= 0 && (score === 0 || score > state.bidding.highest);
    }
    if (action.k === 'pass') return !!state.lastPlay;
    if (action.k !== 'play') return false;
    var cards = resolveCards(state.hands[who], action.cards);
    if (!cards || !cards.length) return false;
    var play = detect(cards);
    if (!play) return false;
    return !state.lastPlay || canBeat(play, state.lastPlay);
  }

  var TYPE_NAMES = {
    single: '单张', pair: '对子', triple: '三张', triple_single: '三带一', triple_pair: '三带二',
    straight: '顺子', straight_pair: '连对', plane: '飞机', plane_single: '飞机带单',
    plane_pair: '飞机带对', four_two_single: '四带二', four_two_pair: '四带两对',
    bomb: '炸弹', rocket: '王炸'
  };
  function typeName(type) { return TYPE_NAMES[type] || type; }

  /* -------------------------------------------------------------------- AI */

  function handStrength(hand) {
    var g = groupOf(hand), score = 0;
    for (var i = 0; i < g.ranks.length; i++) {
      var r = g.ranks[i], c = g.counts[r];
      if (r === BIG_JOKER) score += 4;
      else if (r === SMALL_JOKER) score += 3;
      else if (r === 15) score += 2;
      else if (r === 14) score += 1;
      if (c === 4) score += 3;
    }
    return score;
  }

  function aiBid(hand, currentBid, level, rng) {
    level = level || 2;
    var s = handStrength(hand);
    var want;
    if (level <= 1) {
      want = Math.floor((rng ? rng() : 0.5) * 4);
      if (s >= 9) want = Math.max(want, 2);
    } else if (level === 2) {
      want = s >= 10 ? 3 : s >= 6 ? 2 : s >= 2 ? 1 : 0;
    } else {
      // Level 3 adds shape: a hand with both jokers or a natural bomb is worth
      // one extra bid level even when the raw strength is only average.
      var bonus = (groupOf(hand).counts[BIG_JOKER] && groupOf(hand).counts[SMALL_JOKER]) ? 2 : 0;
      want = s + bonus >= 11 ? 3 : s + bonus >= 7 ? 2 : s + bonus >= 3 ? 1 : 0;
    }
    return want > currentBid ? want : 0;
  }

  function breaksBomb(g, cards) {
    var used = {}, i, r;
    for (i = 0; i < cards.length; i++) {
      r = getRank(cards[i]);
      used[r] = (used[r] || 0) + 1;
    }
    for (r in used) {
      if (!Object.prototype.hasOwnProperty.call(used, r)) continue;
      if (g.counts[r] === 4 && used[r] < 4) return true;
    }
    return false;
  }

  function leadCandidates(hand) {
    var g = groupOf(hand), out = [], seen = {};
    for (var t = 0; t < ALL_TYPES.length; t++) genType(g, ALL_TYPES[t], null, out, seen);
    return out;
  }

  function aiLead(hand, level, ctx) {
    if (!hand.length) return null;
    var g = groupOf(hand);
    var plays = leadCandidates(hand);
    if (!plays.length) return detect([hand[0]]);
    var wins = plays.filter(function (p) { return p.count === hand.length; });
    if (wins.length) { wins.sort(playSort); return wins[0]; }
    var safe = plays.filter(function (p) {
      return p.type !== 'bomb' && p.type !== 'rocket' && !breaksBomb(g, p.cards);
    });
    if (!safe.length) safe = plays.filter(function (p) { return p.type !== 'bomb' && p.type !== 'rocket'; });
    if (!safe.length) safe = plays.filter(function (p) { return !breaksBomb(g, p.cards); });
    if (!safe.length) safe = plays;
    if (level >= 3) {
      // Inference: when an opponent is nearly out, lead the longest normal
      // combination instead of a low single they can beat with one card.
      var danger = ctx && ctx.minOpponent != null ? ctx.minOpponent : 99;
      if (danger <= 2) {
        var big = safe.slice().sort(function (a, b) { return b.count - a.count || b.main - a.main; });
        if (big.length) return big[0];
      }
      // Otherwise prefer long combinations, then low cards.
      safe.sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.main - b.main;
      });
      return safe[0];
    }
    safe.sort(playSort);
    return safe[0];
  }

  function aiFollow(hand, last, ctx, level) {
    if (!hand.length) return null;
    var g = groupOf(hand);
    var plays = findAllPlays(hand, last);
    if (!plays.length) return null;
    var wins = plays.filter(function (p) { return p.count === hand.length; });
    if (wins.length) return wins.sort(playSort)[0];

    var teammateLed = Boolean(ctx && ctx.teammateLed);
    var normal = plays.filter(function (p) {
      return p.type !== 'bomb' && p.type !== 'rocket' && !breaksBomb(g, p.cards);
    });
    if (!normal.length) normal = plays.filter(function (p) { return p.type !== 'bomb' && p.type !== 'rocket'; });
    normal.sort(playSort);

    if (teammateLed) {
      if (ctx.teammateCount <= 2) return null;
      if (normal.length && ctx.teammateCount < hand.length && normal[0].main >= 14) return null;
      return null;
    }

    var opponentCount = ctx && ctx.opponentCount != null ? ctx.opponentCount : 99;
    var urgent = opponentCount <= 2 || hand.length <= 4;
    if (level >= 3) {
      // Do not spend a high normal card on an opponent who cannot finish.
      if (normal.length) {
        var low = normal[0];
        if (!urgent && low.main >= 15 && hand.length > 6) {
          var cheap = normal.filter(function (p) { return p.main < 15; });
          if (cheap.length) return cheap[0];
        }
        return low;
      }
      // Inference from unseen cards: if the opponent is one card from out,
      // spend a bomb now rather than letting them shed it.
      if (urgent) {
        var bombs3 = plays.filter(function (p) { return p.type === 'bomb' || p.type === 'rocket'; });
        bombs3.sort(playSort);
        return bombs3.length ? bombs3[0] : null;
      }
      return null;
    }
    if (normal.length) return normal[0];
    if (!urgent) return null;
    var bombs = plays.filter(function (p) { return p.type === 'bomb' || p.type === 'rocket'; });
    bombs.sort(playSort);
    return bombs.length ? bombs[0] : null;
  }

  // Unseen-card counter used by level 3. It reads the AI's own hand, the public
  // play history and the full deck list — never another seat's hand.
  function unseenCounts(state, seat, deckList) {
    var seenIds = {};
    var own = state.hands[seat] || [];
    var i;
    for (i = 0; i < own.length; i++) seenIds[own[i].id] = 1;
    for (i = 0; i < state.playedIds.length; i++) seenIds[state.playedIds[i]] = 1;
    var deck = deckList || makeDeck();
    var counts = {};
    for (i = 0; i < deck.length; i++) {
      var c = deck[i];
      if (seenIds[c.id]) continue;
      counts[c.r] = (counts[c.r] || 0) + 1;
    }
    return counts;
  }

  function inference(state, seat) {
    var counts = unseenCounts(state, seat);
    var possibleBombs = 0, rocket = false;
    for (var r in counts) {
      if (!Object.prototype.hasOwnProperty.call(counts, r)) continue;
      if (Number(r) <= 15 && counts[r] >= 4) possibleBombs++;
    }
    if (counts[SMALL_JOKER] && counts[BIG_JOKER]) rocket = true;
    return { possibleBombs: possibleBombs, rocket: rocket, unseen: counts };
  }

  // The AI's only door into the state. Other hands are reduced to lengths
  // before any decision code runs, so a heuristic cannot peek at their cards.
  function aiContext(state, seat) {
    var minOpponent = 99, opponentCount = 99, teammateCount = 0, teammateLed = false;
    var landlord = state.landlord;
    for (var i = 0; i < 3; i++) {
      if (i === seat) continue;
      var count = state.hands[i].length;
      var sameSide = seat !== landlord && i !== landlord;
      if (seat === landlord) opponentCount = Math.min(opponentCount, count);
      else if (sameSide) teammateCount = count;
      else opponentCount = Math.min(opponentCount, count);
      if (seat !== landlord && i !== landlord) { /* teammate */ }
      minOpponent = Math.min(minOpponent, sameSide ? 99 : count);
    }
    if (state.lastPlayer !== -1 && state.lastPlayer !== seat) {
      var lastIsTeammate = seat !== landlord && state.lastPlayer !== landlord;
      teammateLed = lastIsTeammate;
    }
    var ctx = {
      minOpponent: minOpponent,
      opponentCount: seat === landlord ? opponentCount : opponentCount,
      teammateLed: teammateLed,
      teammateCount: teammateCount,
      landlord: landlord,
      myCount: state.hands[seat].length
    };
    if (state.phase === 'play') {
      var inf = inference(state, seat);
      ctx.possibleBombs = inf.possibleBombs;
      ctx.enemyRocket = inf.rocket;
    }
    return ctx;
  }

  function aiChoose(state, seat, level, rng) {
    level = level || 2;
    rng = typeof rng === 'function' ? rng : function () { return nextRandom(state); };
    if (!state || state.phase === 'over') return null;
    if (currentSeat(state) !== seat) return null;
    var hand = state.hands[seat];
    if (state.phase === 'bid') {
      return { k: 'bid', score: aiBid(hand, state.bidding.highest, level, rng) };
    }
    var ctx = aiContext(state, seat);
    if (level <= 1) {
      var acts = legalActions(state, seat);
      if (!acts.length) return null;
      return acts[Math.floor(rng() * acts.length) % acts.length];
    }
    var play = state.lastPlay ? aiFollow(hand, state.lastPlay, ctx, level) : aiLead(hand, level, ctx);
    if (!play) return state.lastPlay ? { k: 'pass' } : { k: 'play', cards: [sortHand(hand)[0].id] };
    return { k: 'play', cards: play.cards.map(function (c) { return c.id; }) };
  }

  function aiAction(state, seat, level, rng) {
    return aiChoose(state, seat, level, rng);
  }

  function step(state, seat, level, rng) {
    if (state.phase === 'over') return { over: true };
    var who = seat == null ? currentSeat(state) : seat;
    var action = aiChoose(state, who, level || 2, rng);
    if (!action) return { over: false, error: 'no ai action' };
    return applyAction(state, action, who);
  }

  function selfPlay(seed, level) {
    var state = createGame({ seed: seed == null ? 20261110 : seed, names: ['AI-甲', 'AI-乙', 'AI-丙'], human: [false, false, false] });
    var guard = 0;
    var illegal = 0;
    while (state.phase !== 'over') {
      if (++guard > MAX_TURNS + 40) throw new Error('doudizhu selfPlay did not finish');
      var who = currentSeat(state);
      var action = aiChoose(state, who, level || 2, function () { return nextRandom(state); });
      var res = applyAction(state, action, who);
      if (!res.ok) { illegal++; if (illegal > 8) throw new Error('selfPlay illegal: ' + res.error); }
    }
    state.selfPlayIllegal = illegal;
    return state;
  }

  /* --------------------------------------------------------------- views */

  function publicCard(c) { return { id: c.id, r: c.r, s: c.s, label: cardLabel(c) }; }

  function scoreOf(state) {
    var points = state.baseScore * Math.max(1, state.bid || 1) * state.multiplier;
    var deltas = null;
    if (state.phase === 'over' && state.landlord >= 0) {
      var landlordWon = state.winnerSide === 'landlord';
      deltas = [0, 0, 0];
      for (var i = 0; i < 3; i++) {
        if (i === state.landlord) deltas[i] = landlordWon ? points * 2 : -points * 2;
        else deltas[i] = landlordWon ? -points : points;
      }
    }
    return {
      base: state.baseScore,
      bid: state.bid,
      bombs: state.bombsPlayed,
      multiplier: state.multiplier,
      points: points,
      landlord: state.landlord,
      winnerSeat: state.winner,
      winnerSide: state.winnerSide,
      deltas: deltas
    };
  }

  // Server-safe view. Other seats' hands and the bottom identity never leave
  // the authoritative state; the viewer only receives their own cards.
  function publicView(state, viewerSeat) {
    var viewer = viewerSeat == null ? -1 : Number(viewerSeat);
    var reveal = state.phase === 'over';
    return {
      phase: state.phase,
      turn: state.turn,
      turnSeat: currentSeat(state),
      viewerSeat: viewer,
      viewerTurn: currentSeat(state) === viewer,
      landlord: state.landlord,
      bid: state.bid,
      baseScore: state.baseScore,
      bombsPlayed: state.bombsPlayed,
      multiplier: state.multiplier,
      bidding: {
        turn: state.bidding.turn,
        first: state.bidding.first,
        highest: state.bidding.highest,
        bidder: state.bidding.bidder,
        acted: state.bidding.acted,
        actions: state.bidding.actions.map(function (a) { return { seat: a.seat, score: a.score }; }),
        done: state.bidding.done
      },
      seats: state.players.map(function (p, i) {
        return {
          seat: i,
          name: p.name,
          human: p.human,
          isLandlord: state.landlord === i,
          isViewer: i === viewer,
          handCount: state.hands[i].length
        };
      }),
      hand: viewer >= 0 && viewer < 3 ? state.hands[viewer].map(publicCard) : [],
      handCount: viewer >= 0 && viewer < 3 ? state.hands[viewer].length : 0,
      bottom: reveal
        ? { count: state.bottom.length, revealed: true, cards: state.bottom.map(publicCard) }
        : { count: state.bottom.length, revealed: false, cards: null },
      lastPlay: state.lastPlay ? {
        type: state.lastPlay.type,
        name: typeName(state.lastPlay.type),
        main: state.lastPlay.main,
        count: state.lastPlay.count,
        cards: state.lastPlay.cards.map(publicCard)
      } : null,
      lastPlayer: state.lastPlayer,
      passes: state.passes,
      played: state.playedIds.slice(),
      history: state.history.map(function (h) {
        return { seat: h.seat, type: h.type, name: typeName(h.type), main: h.main, count: h.count, cards: h.cards.map(cardLabel) };
      }),
      winner: state.winner,
      winnerSide: state.winnerSide,
      reason: state.reason,
      score: scoreOf(state),
      redeals: state.redeals,
      turns: state.turns,
      log: state.log.slice()
    };
  }

  return {
    SMALL_JOKER: SMALL_JOKER,
    BIG_JOKER: BIG_JOKER,
    SUITS: SUITS,
    SUIT_KEYS: SUIT_KEYS,
    RED_SUITS: RED_SUITS,
    BASE_SCORE: BASE_SCORE,
    MAX_REDEALS: MAX_REDEALS,
    DEFAULT_NAMES: DEFAULT_NAMES,
    ALL_TYPES: ALL_TYPES,
    TYPE_NAMES: TYPE_NAMES,
    makeDeck: makeDeck,
    mulberry32: mulberry32,
    shuffle: shuffle,
    deal: deal,
    sortCards: sortCards,
    sortHand: sortHand,
    getRank: getRank,
    getCardId: getCardId,
    isJoker: isJoker,
    isRed: isRed,
    suitChar: suitChar,
    rankName: rankName,
    cardLabel: cardLabel,
    cardCmp: cardCmp,
    groupOf: groupOf,
    detect: detect,
    canBeat: canBeat,
    typeName: typeName,
    findAllPlays: findAllPlays,
    suggest: suggest,
    createGame: createGame,
    clone: clone,
    currentSeat: currentSeat,
    applyAction: applyAction,
    legalActions: legalActions,
    isLegal: isLegal,
    aiBid: aiBid,
    aiLead: aiLead,
    aiFollow: aiFollow,
    aiChoose: aiChoose,
    aiAction: aiAction,
    aiContext: aiContext,
    inference: inference,
    unseenCounts: unseenCounts,
    step: step,
    selfPlay: selfPlay,
    handStrength: handStrength,
    scoreOf: scoreOf,
    publicView: publicView,
    nextRandom: nextRandom
  };
});
