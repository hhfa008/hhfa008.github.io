/* Shared hand evaluator: Texas Hold'em + Mahjong (win detection only).
 *
 * Single file, no dependencies. Loads as a classic <script> in the browser
 * (window.HandEval), via require() in Node, or as a UMD module.
 *
 * Poker cards are { r: 2..14, s: 's'|'h'|'d'|'c' } or strings like "As".
 * evalPoker() accepts 5-7 cards and always judges the strongest 5-card hand.
 *
 * Mahjong tiles34 is a 34-length count array (0-4):
 *   0-8   1-9 万 (characters)
 *   9-17  1-9 筒 (dots)
 *   18-26 1-9 条 (bamboo)
 *   27-33 东 南 西 北 中 发 白 (honors)
 * Only win detection (basic / seven pairs / thirteen orphans) — no fan scoring.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HandEval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ============================== Poker ============================== */

  var SUITS = ['s', 'h', 'd', 'c'];
  var SUIT_ALIASES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c', S: 's', H: 'h', D: 'd', C: 'c' };
  var CATEGORY_KEYS = ['high', 'pair', 'twopair', 'trips', 'straight', 'flush',
    'fullhouse', 'quads', 'straightflush', 'royal'];
  var HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦',
    '四条', '同花顺', '皇家同花顺'];

  function rankNumber(part) {
    var s = String(part).toUpperCase();
    if (s === 'A') return 14;
    if (s === 'K') return 13;
    if (s === 'Q') return 12;
    if (s === 'J') return 11;
    if (s === 'T' || s === '10') return 10;
    return parseInt(s, 10);
  }

  function card(str) {
    if (str && typeof str === 'object' && !Array.isArray(str)) {
      var r = typeof str.r === 'number' ? str.r : rankNumber(str.r);
      var s = String(str.s).toLowerCase();
      s = SUIT_ALIASES[s] || s;
      if (!(r >= 2 && r <= 14) || SUITS.indexOf(s) < 0) throw new Error('bad card: ' + JSON.stringify(str));
      return { r: r, s: s };
    }
    str = String(str).trim();
    var suit = str.slice(-1);
    suit = SUIT_ALIASES[suit] || suit.toLowerCase();
    var rawRank = str.slice(0, -1);
    var rank = rankNumber(rawRank);
    if (!(rank >= 2 && rank <= 14) || SUITS.indexOf(suit) < 0) throw new Error('bad card: ' + str);
    return { r: rank, s: suit };
  }

  function cards(str) {
    return String(str).trim().split(/\s+/).filter(Boolean).map(card);
  }

  function normalizeCards(input) {
    if (!Array.isArray(input)) throw new Error('cards must be an array of 5 to 7 cards');
    if (input.length < 5 || input.length > 7) {
      throw new Error('cards must contain 5 to 7 cards, got ' + input.length);
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < input.length; i++) {
      var c = card(input[i]);
      var key = c.r + c.s;
      if (seen[key]) throw new Error('duplicate card: ' + c.r + c.s);
      seen[key] = true;
      out.push(c);
    }
    return out;
  }

  // Straight high for a 5-card set of *distinct* ranks, or 0.
  // A2345 is the wheel: high card 5 (A plays low).
  function straightHigh(ranksDesc) {
    if (ranksDesc.length !== 5) return 0;
    // Five distinct ranks are required (77,44,3 spans 4 ranks but is two pair).
    for (var i = 1; i < 5; i++) if (ranksDesc[i] === ranksDesc[i - 1]) return 0;
    if (ranksDesc[0] - ranksDesc[4] === 4) return ranksDesc[0];
    if (ranksDesc[0] === 14 && ranksDesc[1] === 5 && ranksDesc[2] === 4 &&
      ranksDesc[3] === 3 && ranksDesc[4] === 2) return 5;
    return 0;
  }

  function makeEval(rank, tiebreak, best) {
    return {
      rank: rank,
      tiebreak: tiebreak,
      name: HAND_NAMES[rank],
      cat: rank,                    // compatibility with games/texas-holdem
      score: [rank].concat(tiebreak), // compatibility with games/texas-holdem
      key: CATEGORY_KEYS[rank],
      best: best
    };
  }

  // Take one physical card per requested rank, consuming repeats (e.g. quads).
  function pickCards(byRank, rankList) {
    var used = {};
    var out = [];
    for (var i = 0; i < rankList.length; i++) {
      var r = rankList[i];
      var at = used[r] || 0;
      var arr = byRank[r];
      out.push(arr[Math.min(at, arr.length - 1)]);
      used[r] = at + 1;
    }
    return out;
  }

  function withKickers(byRank, used, count) {
    var ranks = Object.keys(byRank).map(Number)
      .filter(function (r) { return used.indexOf(r) < 0; })
      .sort(function (a, b) { return b - a; })
      .slice(0, count);
    return ranks;
  }

  // Evaluate exactly five cards.
  function eval5(cs) {
    var ranks = cs.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
    var flush = cs.every(function (c) { return c.s === cs[0].s; });
    var byRank = {};
    cs.forEach(function (c) { (byRank[c.r] = byRank[c.r] || []).push(c); });
    var groups = Object.keys(byRank).map(Number).map(function (r) {
      return { r: r, n: byRank[r].length };
    }).sort(function (a, b) { return (b.n - a.n) || (b.r - a.r); });

    var sfHigh = straightHigh(ranks);

    if (flush && sfHigh) {
      return makeEval(sfHigh === 14 ? 9 : 8, [sfHigh],
        pickCards(byRank, sfHigh === 5 ? [5, 4, 3, 2, 14] : [sfHigh, sfHigh - 1, sfHigh - 2, sfHigh - 3, sfHigh - 4]));
    }

    if (groups[0].n === 4) {
      var qr = groups[0].r;
      var qk = withKickers(byRank, [qr], 1);
      return makeEval(7, [qr].concat(qk), pickCards(byRank, [qr, qr, qr, qr].concat(qk)));
    }

    if (groups[0].n === 3 && groups[1] && groups[1].n === 2) {
      var tr = groups[0].r, pr = groups[1].r;
      return makeEval(6, [tr, pr], pickCards(byRank, [tr, tr, tr, pr, pr]));
    }

    if (flush) return makeEval(5, ranks, pickCards(byRank, ranks));

    if (sfHigh) {
      return makeEval(4, [sfHigh],
        pickCards(byRank, sfHigh === 5 ? [5, 4, 3, 2, 14] : [sfHigh, sfHigh - 1, sfHigh - 2, sfHigh - 3, sfHigh - 4]));
    }

    if (groups[0].n === 3) {
      var t = groups[0].r;
      var tk = withKickers(byRank, [t], 2);
      return makeEval(3, [t].concat(tk), pickCards(byRank, [t, t, t].concat(tk)));
    }

    if (groups[0].n === 2 && groups[1] && groups[1].n === 2) {
      var hi = Math.max(groups[0].r, groups[1].r);
      var lo = Math.min(groups[0].r, groups[1].r);
      var pk = withKickers(byRank, [hi, lo], 1);
      return makeEval(2, [hi, lo].concat(pk), pickCards(byRank, [hi, hi, lo, lo].concat(pk)));
    }

    if (groups[0].n === 2) {
      var p = groups[0].r;
      var kk = withKickers(byRank, [p], 3);
      return makeEval(1, [p].concat(kk), pickCards(byRank, [p, p].concat(kk)));
    }

    return makeEval(0, ranks, pickCards(byRank, ranks));
  }

  var COMBO_CACHE = {};

  // All k-index combinations out of n, as arrays of indices.
  function combinations(n, k) {
    var key = n + ':' + k;
    if (COMBO_CACHE[key]) return COMBO_CACHE[key];
    var out = [];
    var idx = [];
    (function walk(start, left) {
      if (!left) { out.push(idx.slice()); return; }
      for (var i = start; i <= n - left; i++) {
        idx.push(i);
        walk(i + 1, left - 1);
        idx.pop();
      }
    })(0, k);
    COMBO_CACHE[key] = out;
    return out;
  }

  function compareScores(a, b) {
    var A = scoreOf(a), B = scoreOf(b);
    var n = Math.max(A.length, B.length);
    for (var i = 0; i < n; i++) {
      var x = A[i] || 0, y = B[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function scoreOf(x) {
    if (Array.isArray(x)) {
      // Raw card array: allow comparePoker(cardsA, cardsB) directly.
      if (x.length >= 5 && x[0] && typeof x[0] === 'object') return evalPoker(x).score;
      return x;
    }
    if (!x) throw new Error('not a hand result');
    if (Array.isArray(x.score)) return x.score;
    if (x.rank != null) return [x.rank].concat(x.tiebreak || []);
    throw new Error('not a hand result');
  }

  // Strongest 5 cards out of 5-7 cards. Enumerates every C(n,5) combination.
  function best5of7(input) {
    var cs = normalizeCards(input);
    if (cs.length === 5) {
      var only = eval5(cs);
      return { cards: cs.slice(), eval: only };
    }
    var combos = combinations(cs.length, 5);
    var bestEval = null, bestCards = null;
    for (var i = 0; i < combos.length; i++) {
      var hand = [];
      for (var j = 0; j < 5; j++) hand.push(cs[combos[i][j]]);
      var ev = eval5(hand);
      if (!bestEval || compareScores(ev, bestEval) > 0) {
        bestEval = ev;
        bestCards = hand;
      }
    }
    return { cards: bestCards, eval: bestEval };
  }

  // Evaluate 5-7 poker cards. For 6/7 cards the strongest 5 are selected.
  function evalPoker(input) {
    var cs = normalizeCards(input);
    if (cs.length === 5) return eval5(cs);
    return best5of7(cs).eval;
  }

  function comparePoker(a, b) {
    return compareScores(a, b);
  }

  /* ============================= Mahjong ============================= */

  var TILE_NAMES = (function () {
    var out = [];
    var suits = ['万', '筒', '条'];
    for (var s = 0; s < 3; s++) {
      for (var n = 1; n <= 9; n++) out.push(n + suits[s]);
    }
    return out.concat(['东', '南', '西', '北', '中', '发', '白']);
  })();

  // Terminal + honor tiles used by thirteen orphans.
  var ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  function tileName(i) { return TILE_NAMES[i] || ('#' + i); }

  function validateTiles34(tiles) {
    if (!tiles || typeof tiles.length !== 'number' || tiles.length !== 34) {
      return { ok: false, reason: '牌型必须是长度 34 的计数数组' };
    }
    var total = 0;
    for (var i = 0; i < 34; i++) {
      var n = tiles[i];
      if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n) {
        return { ok: false, reason: tileName(i) + ' 的数量必须是整数' };
      }
      if (n < 0 || n > 4) {
        return { ok: false, reason: tileName(i) + ' 的数量为 ' + n + '，超出 0–4' };
      }
      total += n;
    }
    return { ok: true, total: total };
  }

  // Split `melds` groups out of counts. Triplets or same-suit runs only.
  function canFormMelds(counts, melds) {
    var i = 0;
    while (i < 34 && counts[i] === 0) i++;
    if (i === 34) return melds === 0;
    if (melds === 0) return false;

    if (counts[i] >= 3) {
      counts[i] -= 3;
      if (canFormMelds(counts, melds - 1)) { counts[i] += 3; return true; }
      counts[i] += 3;
    }

    // Sequences never cross suits or use honors.
    if (i < 27 && (i % 9) <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
      counts[i]--; counts[i + 1]--; counts[i + 2]--;
      if (canFormMelds(counts, melds - 1)) {
        counts[i]++; counts[i + 1]++; counts[i + 2]++;
        return true;
      }
      counts[i]++; counts[i + 1]++; counts[i + 2]++;
    }
    return false;
  }

  function isBasicWin(counts) {
    for (var i = 0; i < 34; i++) {
      if (counts[i] >= 2) {
        counts[i] -= 2;
        var ok = canFormMelds(counts, 4);
        counts[i] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  // Seven pairs: all 14 tiles pair up. Four identical tiles count as two pairs.
  function isSevenPairs(counts) {
    for (var i = 0; i < 34; i++) if (counts[i] % 2 !== 0) return false;
    return true;
  }

  function isThirteenOrphans(counts) {
    var inOrphans = {};
    ORPHANS.forEach(function (i) { inOrphans[i] = true; });
    for (var i = 0; i < 34; i++) {
      if (counts[i] > 0 && !inOrphans[i]) return false;
    }
    for (var k = 0; k < ORPHANS.length; k++) {
      if (counts[ORPHANS[k]] < 1) return false;
    }
    return true;
  }

  // Full analysis: { winning, reason, count, patterns }
  function checkWinningHand(tiles34) {
    var v = validateTiles34(tiles34);
    if (!v.ok) return { winning: false, reason: v.reason, count: null, patterns: [] };
    if (v.total !== 14) {
      return {
        winning: false,
        reason: '需要 14 张牌（13 张手牌 + 1 张胡牌），当前 ' + v.total + ' 张',
        count: v.total,
        patterns: []
      };
    }

    var counts = tiles34.slice();
    var patterns = [];
    if (isBasicWin(counts)) patterns.push('基本胡');
    if (isSevenPairs(counts)) patterns.push('七对');
    if (isThirteenOrphans(counts)) patterns.push('十三幺');

    if (!patterns.length) {
      return {
        winning: false,
        reason: '不是胡牌：无法拆成 4 副面子 + 1 对将，也不是七对或十三幺',
        count: v.total,
        patterns: []
      };
    }
    return { winning: true, reason: '', count: v.total, patterns: patterns };
  }

  // Boolean view of checkWinningHand. The reason for a false result is mirrored
  // on isWinningHand.lastReason, so the signature stays boolean.
  function isWinningHand(tiles34) {
    var r = checkWinningHand(tiles34);
    isWinningHand.lastReason = r.reason;
    return r.winning;
  }

  // Every tile (0..33) that completes a 13-tile hand, ascending.
  function winningTiles(hand13) {
    var v = validateTiles34(hand13);
    if (!v.ok) throw new Error(v.reason);
    if (v.total !== 13) {
      throw new Error('winningTiles 需要 13 张手牌，当前 ' + v.total + ' 张');
    }
    var counts = hand13.slice();
    var out = [];
    for (var t = 0; t < 34; t++) {
      if (counts[t] >= 4) continue;
      counts[t]++;
      if (isWinningHand(counts)) out.push(t);
      counts[t]--;
    }
    return out;
  }

  return {
    // Poker
    SUITS: SUITS,
    CATEGORY_KEYS: CATEGORY_KEYS,
    HAND_NAMES: HAND_NAMES,
    card: card,
    cards: cards,
    evalPoker: evalPoker,
    comparePoker: comparePoker,
    best5of7: best5of7,
    // Compatibility aliases for the Texas Hold'em page.
    evaluate: evalPoker,
    compare: comparePoker,
    // Mahjong
    TILE_NAMES: TILE_NAMES,
    tileName: tileName,
    validateTiles34: validateTiles34,
    checkWinningHand: checkWinningHand,
    analyzeHand: checkWinningHand,
    isWinningHand: isWinningHand,
    winningTiles: winningTiles
  };
});
