'use strict';

/*
 * Deterministic task bank for the AI eval engine.
 *
 * Every expected answer is COMPUTED here with the repository's own engines:
 *   games/shared/hand-eval.js  (mahjong win detection, poker best-5-of-7)
 *   games/shared/rules.js      (gomoku terminal-position winner)
 *   games/shared/tcg.js        (legal action enumeration)
 *   games/shared/shuffle.js    (all deals and sampling)
 *
 * The bank is generated from a FIXED internal seed (BANK_SEED) so every
 * machine has the same 360 questions. A run's `seed` only chooses the sample
 * (and, for suite B, the match seeds). Same seed + same n => same cases.
 *
 * Suite A families (360 total):
 *   mahjong        100  14-tile win? basic wins, seven pairs, thirteen
 *                       orphans, random false hands, near-miss false hands
 *   poker-category  60  7 cards -> category / rank / tiebreak
 *   poker-compare   40  two 7-card hands -> -1 / 0 / 1
 *   gomoku          80  terminal 15x15 board -> black / white / draw
 *   tcg-legal       80  match state -> full legal action set
 *
 * Suite C built-in tasks are copies of real shared engines with a single
 * one-line mutation. Their pristine source is kept in `reference`, which is
 * only handed to the builtin adapter; HTTP/random adapters never see it.
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var H = require('../shared/hand-eval.js');
var Shuffle = require('../shared/shuffle.js');
var TCG = require('../shared/tcg.js');
var GameRules = require('../shared/rules.js');
var adapters = require('./adapters.js');

var ROOT = path.resolve(__dirname, '..', '..');
var SHARED = path.join(ROOT, 'games', 'shared');
var AI_EVAL_VERSION = '1.0.0';
var BANK_SEED = 'ai-eval-bank-v1';
var GOMOKU_N = GameRules.gomoku.N;

var BANK_CACHE = null;
var C_BUILTIN_CACHE = null;

/* ------------------------------- utilities -------------------------------- */

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function engineVersion() {
  var shared = ['hand-eval.js', 'shuffle.js', 'tcg.js', 'rules.js'];
  var own = ['runner.js', 'tasks.js', 'score.js', 'adapters.js'];
  var parts = [];
  var i;
  for (i = 0; i < shared.length; i++) {
    parts.push('shared/' + shared[i] + ':' + sha256(fs.readFileSync(path.join(SHARED, shared[i]))));
  }
  // Suite B may switch to the unified agent protocol; its version is part of
  // the measurement when the file exists.
  var agentApi = path.join(SHARED, 'agent-api.js');
  if (fs.existsSync(agentApi)) {
    parts.push('shared/agent-api.js:' + sha256(fs.readFileSync(agentApi)));
  }
  for (i = 0; i < own.length; i++) {
    var file = path.join(__dirname, own[i]);
    if (fs.existsSync(file)) parts.push('ai-eval/' + own[i] + ':' + sha256(fs.readFileSync(file)));
  }
  return 'ai-eval/' + AI_EVAL_VERSION + '+sha256:' + sha256(parts.join('\n')).slice(0, 16);
}

function engineHashes() {
  var out = {};
  ['hand-eval.js', 'shuffle.js', 'tcg.js', 'rules.js'].forEach(function (name) {
    out[name] = sha256(fs.readFileSync(path.join(SHARED, name))).slice(0, 16);
  });
  var agentApi = path.join(SHARED, 'agent-api.js');
  if (fs.existsSync(agentApi)) {
    out['agent-api.js'] = sha256(fs.readFileSync(agentApi)).slice(0, 16);
  }
  return out;
}

function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function randInt(rng, n) {
  if (!(n > 0)) return 0;
  var limit = 4294967296 - (4294967296 % n);
  var x;
  do { x = rng.nextUint32(); } while (x >= limit);
  return x % n;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function shuffle(items, seed) {
  return Shuffle.shuffle(items.slice(), { seed: seed });
}

// Seed-based sampling. n >= tasks.length returns every task (shuffled).
function sampleTasks(tasks, n, seed, label) {
  var count = Number(n);
  if (!isFinite(count) || count <= 0) count = tasks.length;
  var shuffled = shuffle(tasks, String(label || 'sample') + ':' + String(seed));
  if (count >= shuffled.length) return shuffled;
  return shuffled.slice(0, Math.floor(count));
}

/* ================================ mahjong ================================= */

var ZERO34 = function () {
  var a = new Array(34);
  for (var i = 0; i < 34; i++) a[i] = 0;
  return a;
};

var WALL = (function () {
  var out = [];
  for (var t = 0; t < 34; t++) for (var c = 0; c < 4; c++) out.push(t);
  return out;
})();

function deal14(seed) {
  var shuffled = shuffle(WALL, seed);
  var counts = ZERO34();
  for (var i = 0; i < 14; i++) counts[shuffled[i]]++;
  return counts;
}

function total34(counts) {
  var s = 0;
  for (var i = 0; i < 34; i++) s += counts[i];
  return s;
}

function canAdd(counts, tile, amount) {
  return counts[tile] + amount <= 4;
}

function craftBasicWin(seed) {
  for (var attempt = 0; attempt < 300; attempt++) {
    var rng = Shuffle.createRng(seed + ':basic:' + attempt);
    var counts = ZERO34();
    var pair = randInt(rng, 34);
    counts[pair] += 2;
    var ok = true;
    for (var meld = 0; meld < 4; meld++) {
      var placed = false;
      for (var tries = 0; tries < 100 && !placed; tries++) {
        if (randInt(rng, 2) === 0) {
          var trip = randInt(rng, 34);
          if (canAdd(counts, trip, 3)) { counts[trip] += 3; placed = true; }
        } else {
          var suit = randInt(rng, 3);
          var start = randInt(rng, 7);
          var base = suit * 9 + start;
          if (canAdd(counts, base, 1) && canAdd(counts, base + 1, 1) && canAdd(counts, base + 2, 1)) {
            counts[base]++;
            counts[base + 1]++;
            counts[base + 2]++;
            placed = true;
          }
        }
      }
      if (!placed) { ok = false; break; }
    }
    if (!ok) continue;
    if (total34(counts) !== 14) continue;
    if (H.checkWinningHand(counts).winning) return counts;
  }
  throw new Error('craftBasicWin failed: ' + seed);
}

function craftSevenPairs(seed) {
  for (var attempt = 0; attempt < 200; attempt++) {
    var rng = Shuffle.createRng(seed + ':pairs:' + attempt);
    var counts = ZERO34();
    var used = {};
    var quad = attempt % 3 === 0;
    var i;
    if (quad) {
      var q = randInt(rng, 34);
      counts[q] = 4;
      used[q] = true;
      for (i = 0; i < 5; i++) {
        var t = randInt(rng, 34);
        if (used[t]) { i--; continue; }
        used[t] = true;
        counts[t] = 2;
      }
    } else {
      for (i = 0; i < 7; i++) {
        var p = randInt(rng, 34);
        if (used[p]) { i--; continue; }
        used[p] = true;
        counts[p] = 2;
      }
    }
    if (total34(counts) !== 14) continue;
    var r = H.checkWinningHand(counts);
    if (r.winning && r.patterns.indexOf('七对') >= 0) return counts;
  }
  throw new Error('craftSevenPairs failed: ' + seed);
}

var ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function craftThirteenOrphans(seed) {
  var rng = Shuffle.createRng(seed + ':orphans');
  var counts = ZERO34();
  var i;
  for (i = 0; i < ORPHANS.length; i++) counts[ORPHANS[i]] = 1;
  var dup = ORPHANS[randInt(rng, ORPHANS.length)];
  counts[dup] = 2;
  if (total34(counts) !== 14) throw new Error('thirteen orphans total');
  var r = H.checkWinningHand(counts);
  if (!r.winning) throw new Error('thirteen orphans not winning');
  return counts;
}

function nearMiss(seed) {
  for (var attempt = 0; attempt < 300; attempt++) {
    var base = craftBasicWin(seed + ':near-base:' + attempt);
    var rng = Shuffle.createRng(seed + ':near:' + attempt);
    var from = -1;
    for (var k = 0; k < 200; k++) {
      var t = randInt(rng, 34);
      if (base[t] > 0) { from = t; break; }
    }
    if (from < 0) continue;
    var counts = base.slice();
    counts[from]--;
    var to = randInt(rng, 34);
    if (counts[to] >= 4) continue;
    counts[to]++;
    if (total34(counts) !== 14) continue;
    if (!H.checkWinningHand(counts).winning) return counts;
  }
  throw new Error('nearMiss failed: ' + seed);
}

function randomFalseHand(seed) {
  for (var attempt = 0; attempt < 500; attempt++) {
    var counts = deal14(seed + ':false:' + attempt);
    if (!H.checkWinningHand(counts).winning) return counts;
  }
  throw new Error('randomFalseHand failed: ' + seed);
}

function expandTiles(counts) {
  var out = [];
  for (var i = 0; i < 34; i++) {
    for (var n = 0; n < counts[i]; n++) out.push(H.TILE_NAMES[i]);
  }
  return out;
}

var MAHJONG_PROMPT = [
  '这是一手 14 张麻将（万/筒/条/字），tiles34 是 34 位计数数组：',
  '0-8=1-9万, 9-17=1-9筒, 18-26=1-9条, 27-33=东南西北中发白。',
  '判断是否胡牌（基本胡/七对/十三幺，不考虑番种）。',
  '只返回 JSON：{"winning": true} 或 {"winning": false}。'
].join('');

function makeMahjongTasks() {
  var tasks = [];
  var i;
  for (i = 0; i < 30; i++) {
    var basic = craftBasicWin(BANK_SEED + ':mj:basic:' + i);
    tasks.push(mahjongTask('A-mj-' + pad(tasks.length + 1, 3), basic));
  }
  for (i = 0; i < 15; i++) {
    tasks.push(mahjongTask('A-mj-' + pad(tasks.length + 1, 3), craftSevenPairs(BANK_SEED + ':mj:pairs:' + i)));
  }
  for (i = 0; i < 10; i++) {
    tasks.push(mahjongTask('A-mj-' + pad(tasks.length + 1, 3), craftThirteenOrphans(BANK_SEED + ':mj:orphans:' + i)));
  }
  for (i = 0; i < 25; i++) {
    tasks.push(mahjongTask('A-mj-' + pad(tasks.length + 1, 3), randomFalseHand(BANK_SEED + ':mj:false:' + i)));
  }
  for (i = 0; i < 20; i++) {
    tasks.push(mahjongTask('A-mj-' + pad(tasks.length + 1, 3), nearMiss(BANK_SEED + ':mj:near:' + i)));
  }
  return tasks;
}

function mahjongTask(id, counts) {
  var truth = H.checkWinningHand(counts);
  return {
    id: id,
    suite: 'A',
    family: 'mahjong',
    prompt: MAHJONG_PROMPT,
    data: { tiles34: counts.slice(), tiles: expandTiles(counts) },
    expected: { winning: truth.winning }
  };
}

/* ================================= poker ================================== */

var SUITS = ['s', 'h', 'd', 'c'];
var RANK_LABEL = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function rankLabel(r) {
  return RANK_LABEL[r] || String(r);
}

function cardString(card) {
  return rankLabel(card.r) + card.s;
}

function fullDeck() {
  var out = [];
  for (var s = 0; s < SUITS.length; s++) {
    for (var r = 2; r <= 14; r++) out.push({ r: r, s: SUITS[s] });
  }
  return out;
}

var POKER_DECK = fullDeck();

var CRAFTED_POKER = [
  ['As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d'],
  ['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3s'],
  ['As', '2h', '3d', '4c', '5s', 'Kh', 'Qd'],
  ['Ah', '2h', '3h', '4h', '5h', 'Ks', 'Qd'],
  ['9s', '9h', '9d', '9c', 'As', 'Kh', '2d'],
  ['4s', '4h', '4d', '4c', 'Ks', 'Kh', '2d'],
  ['Ks', 'Kh', 'Kd', '7c', '7s', 'As', '2d'],
  ['8s', '8h', '8d', '2c', '2s', 'As', 'Kd'],
  ['Ah', 'Jh', '8h', '5h', '2h', 'Ks', 'Qd'],
  ['Ah', '5h', '4h', '3h', '2h', 'Ks', 'Qd'],
  ['As', 'Ah', 'Kd', 'Kc', 'Qs', '3d', '2c'],
  ['Qs', 'Qh', 'Qd', 'As', 'Kh', '3c', '2d'],
  ['9s', '8h', '7d', '6c', '5s', 'As', 'Kd'],
  ['As', 'Kh', 'Qd', 'Jc', '9s', '3d', '2c'],
  ['Js', 'Jh', 'As', '9d', '7c', '5h', '3s'],
  ['7h', '6h', '5h', '4h', '3h', 'As', 'Kd'],
  ['Ks', 'Kh', '9d', '9c', 'As', '2d', '3c'],
  ['7s', '7h', '7d', 'As', 'Kd', '2c', '3h'],
  ['As', 'Kd', '9h', '7s', '5d', '3c', '2h'],
  ['5s', '5h', '5d', '9c', '9s', '9d', 'As']
];

var POKER_CATEGORY_PROMPT = [
  '给出 7 张德州扑克牌，取其中最强的 5 张。',
  '返回 JSON：{"category": <键>, "rank": <0-9>, "tiebreak": [降序点数]}。',
  '键与 rank：high=0, pair=1, twopair=2, trips=3, straight=4, flush=5,',
  'fullhouse=6, quads=7, straightflush=8, royal=9。A=14,K=13,Q=12,J=11,T=10。',
  'tiebreak 是除牌型外用于比较的点数（顺序不计）。'
].join('');

var POKER_COMPARE_PROMPT = [
  '比较两手各 7 张德州扑克（各取最强 5 张）。',
  '返回 JSON：{"compare": -1|0|1}，a 弱于 b 为 -1，相等为 0，强于 b 为 1。'
].join('');

function pokerCategoryTask(id, hand) {
  var ev = H.evalPoker(hand);
  return {
    id: id,
    suite: 'A',
    family: 'poker-category',
    prompt: POKER_CATEGORY_PROMPT,
    data: { cards: hand.slice() },
    expected: { category: ev.key, rank: ev.rank, tiebreak: ev.tiebreak.slice() }
  };
}

function pokerCompareTask(id, a, b) {
  var ea = H.evalPoker(a);
  var eb = H.evalPoker(b);
  return {
    id: id,
    suite: 'A',
    family: 'poker-compare',
    prompt: POKER_COMPARE_PROMPT,
    data: { a: a.slice(), b: b.slice() },
    expected: { compare: H.comparePoker(ea, eb) }
  };
}

function rotateSuits(cards, shift) {
  var map = {};
  for (var i = 0; i < SUITS.length; i++) map[SUITS[i]] = SUITS[(i + shift) % SUITS.length];
  return cards.map(function (c) {
    var parsed = H.card(c);
    return rankLabel(parsed.r) + map[parsed.s];
  });
}

function makePokerTasks() {
  var tasks = [];
  var i;
  for (i = 0; i < CRAFTED_POKER.length; i++) {
    tasks.push(pokerCategoryTask('A-pk-' + pad(tasks.length + 1, 3), CRAFTED_POKER[i]));
  }
  for (i = 0; i < 40; i++) {
    var deck = shuffle(POKER_DECK, BANK_SEED + ':poker:deal:' + i);
    var hand = deck.slice(0, 7).map(cardString);
    tasks.push(pokerCategoryTask('A-pk-' + pad(tasks.length + 1, 3), hand));
  }
  // 10 ties: a suit bijection preserves category, flush-ness and ranks.
  for (i = 0; i < 10; i++) {
    var base = CRAFTED_POKER[i % CRAFTED_POKER.length];
    var shifted = rotateSuits(base, 1 + (i % 3));
    var cmp = H.comparePoker(H.evalPoker(base), H.evalPoker(shifted));
    if (cmp !== 0) throw new Error('suit-rotated poker hand is not a tie at ' + i);
    tasks.push(pokerCompareTask('A-pkcmp-' + pad(tasks.length + 1, 3), base, shifted));
  }
  for (i = 0; i < 30; i++) {
    var d = shuffle(POKER_DECK, BANK_SEED + ':poker:cmp:' + i);
    var a = d.slice(0, 7).map(cardString);
    var b = d.slice(7, 14).map(cardString);
    tasks.push(pokerCompareTask('A-pkcmp-' + pad(tasks.length + 1, 3), a, b));
  }
  return tasks;
}

/* ================================= gomoku ================================= */

var GOMOKU_PROMPT = [
  '这是 15x15 五子棋的终局棋盘，board 按行优先展开，共 225 格：1=黑，2=白，0=空。',
  '没有禁手规则；任意方向连续 5 子及以上即获胜。',
  '判断终局结果。只返回 JSON：{"winner":"black"}、{"winner":"white"} 或 {"winner":"draw"}。'
].join('');

function drawBoard(phase, swap) {
  var board = new Array(GOMOKU_N * GOMOKU_N);
  for (var r = 0; r < GOMOKU_N; r++) {
    for (var c = 0; c < GOMOKU_N; c++) {
      var f = (r + 2 * c + phase) % 4;
      var v = f < 2 ? 1 : 2;
      board[r * GOMOKU_N + c] = swap ? 3 - v : v;
    }
  }
  return board;
}

function gomokuTask(id, board) {
  var truth = adapters.gomokuResult(board);
  return {
    id: id,
    suite: 'A',
    family: 'gomoku',
    prompt: GOMOKU_PROMPT,
    data: { board: board.slice() },
    expected: { winner: truth }
  };
}

function paintWin(board, winner, orientation, rng) {
  var out = board.slice();
  var r, c, k;
  if (orientation === 0) { r = randInt(rng, 15); c = randInt(rng, 11); }
  else if (orientation === 1) { r = randInt(rng, 11); c = randInt(rng, 15); }
  else if (orientation === 2) { r = randInt(rng, 11); c = randInt(rng, 11); }
  else { r = randInt(rng, 11); c = 4 + randInt(rng, 11); }
  var dr = orientation === 1 ? 1 : (orientation === 2 || orientation === 3 ? 1 : 0);
  var dc = orientation === 0 ? 1 : (orientation === 3 ? -1 : (orientation === 2 ? 1 : 0));
  for (k = 0; k < 5; k++) out[(r + dr * k) * GOMOKU_N + (c + dc * k)] = winner;
  return out;
}

function makeGomokuTasks() {
  var tasks = [];
  var i;
  for (i = 0; i < 36; i++) {
    var made = null;
    for (var attempt = 0; attempt < 30 && !made; attempt++) {
      var rng = Shuffle.createRng(BANK_SEED + ':gomoku:black:' + i + ':' + attempt);
      var board = paintWin(drawBoard(i % 4, (i >> 2) % 2), 1, i % 4, rng);
      if (adapters.gomokuResult(board) === 'black') made = board;
    }
    if (!made) throw new Error('gomoku black generation failed at ' + i);
    tasks.push(gomokuTask('A-gmk-' + pad(tasks.length + 1, 3), made));
  }
  for (i = 0; i < 36; i++) {
    var madeW = null;
    for (var attemptW = 0; attemptW < 30 && !madeW; attemptW++) {
      var rngW = Shuffle.createRng(BANK_SEED + ':gomoku:white:' + i + ':' + attemptW);
      var boardW = paintWin(drawBoard(i % 4, (i >> 2) % 2), 2, i % 4, rngW);
      if (adapters.gomokuResult(boardW) === 'white') madeW = boardW;
    }
    if (!madeW) throw new Error('gomoku white generation failed at ' + i);
    tasks.push(gomokuTask('A-gmk-' + pad(tasks.length + 1, 3), madeW));
  }
  for (i = 0; i < 8; i++) {
    var draw = drawBoard(i % 4, i >= 4);
    var result = adapters.gomokuResult(draw);
    if (result !== 'draw') throw new Error('gomoku draw pattern produced ' + result);
    tasks.push(gomokuTask('A-gmk-' + pad(tasks.length + 1, 3), draw));
  }
  return tasks;
}

/* ================================== TCG =================================== */

var TCG_CARDS = {
  blade: { id: 'blade', type: 'unit', cost: 1, atk: 1, hp: 2 },
  guard: { id: 'guard', type: 'unit', cost: 2, atk: 1, hp: 4 },
  brute: { id: 'brute', type: 'unit', cost: 3, atk: 4, hp: 3 },
  archer: {
    id: 'archer', type: 'unit', cost: 2, atk: 2, hp: 2,
    effects: [{
      trigger: 'onPlay',
      target: { kind: 'unit', side: 'enemy', mode: 'single' },
      ops: [{ op: 'damage', amount: 1 }]
    }]
  },
  healer: {
    id: 'healer', type: 'unit', cost: 2, atk: 1, hp: 3,
    abilities: [{
      cost: 1, oncePerTurn: true,
      target: { kind: 'unit', side: 'self', mode: 'single' },
      ops: [{ op: 'heal', amount: 2 }]
    }]
  },
  bolt: {
    id: 'bolt', type: 'spell', cost: 1, atk: 0, hp: 1,
    effects: [{
      trigger: 'onPlay',
      target: { kind: 'unit', side: 'enemy', mode: 'single' },
      ops: [{ op: 'damage', amount: 2 }]
    }]
  },
  fireball: {
    id: 'fireball', type: 'spell', cost: 3, atk: 0, hp: 1,
    effects: [{
      trigger: 'onPlay',
      target: { kind: 'unit', side: 'enemy', mode: 'single' },
      ops: [{ op: 'damage', amount: 3 }]
    }]
  },
  wall: { id: 'wall', type: 'unit', cost: 2, atk: 0, hp: 6 },
  captain: {
    id: 'captain', type: 'unit', cost: 4, atk: 3, hp: 5,
    effects: [{
      trigger: 'onPlay',
      target: { kind: 'unit', side: 'self', mode: 'all' },
      ops: [{ op: 'buff', atk: 1, hp: 1 }]
    }]
  },
  ritual: {
    id: 'ritual', type: 'spell', cost: 2, atk: 0, hp: 1,
    effects: [{ trigger: 'onPlay', ops: [{ op: 'draw', amount: 2 }] }]
  },
  sniper: {
    id: 'sniper', type: 'unit', cost: 3, atk: 2, hp: 2,
    abilities: [{
      cost: 1, oncePerTurn: true,
      target: { kind: 'unit', side: 'enemy', mode: 'single' },
      ops: [{ op: 'damage', amount: 1 }]
    }]
  },
  titan: { id: 'titan', type: 'unit', cost: 6, atk: 6, hp: 6 },
  spark: {
    id: 'spark', type: 'spell', cost: 0, atk: 0, hp: 1,
    effects: [{
      trigger: 'onPlay',
      target: { kind: 'core', side: 'enemy' },
      ops: [{ op: 'damage', amount: 1 }]
    }]
  },
  mend: {
    id: 'mend', type: 'spell', cost: 1, atk: 0, hp: 1,
    effects: [{
      trigger: 'onPlay',
      target: { kind: 'unit', side: 'self', mode: 'single' },
      ops: [{ op: 'heal', amount: 3 }]
    }]
  },
  warlord: { id: 'warlord', type: 'unit', cost: 5, atk: 4, hp: 5 }
};

var TCG_DECK = [
  'blade', 'blade', 'blade',
  'guard', 'guard',
  'brute', 'brute',
  'archer', 'archer',
  'healer', 'healer',
  'bolt', 'bolt',
  'fireball',
  'wall', 'wall',
  'captain',
  'ritual', 'ritual',
  'sniper', 'sniper',
  'titan',
  'spark',
  'mend'
];

var TCG_RULES = {
  startingCore: 15,
  startingHand: 5,
  drawPerTurn: 1,
  firstTurnDraw: 0,
  startingResource: 3,
  resourceGrowth: 1,
  maxResource: 8,
  firstTurnResourcePenalty: 1,
  secondPlayerResourceBonus: 0,
  secondPlayerBonusCards: 0,
  maxTurns: 24,
  resourceName: 'resource',
  allowDirectCoreAttack: true
};

function tcgConfig(seed) {
  return {
    seed: String(seed),
    rules: cloneJson(TCG_RULES),
    players: [{ deck: TCG_DECK.slice() }, { deck: TCG_DECK.slice() }],
    cardPool: cloneJson(TCG_CARDS)
  };
}

var TCG_PROMPT = [
  '这是 TCG 对局的一个局面。setup + history 可以完整重放该对局，',
  'state 是当前快照（JSON 安全）。viewedPlayer 是当前行动玩家。',
  '列出当前玩家的全部合法动作（调用 shared/tcg.js 的 legalActions 得到）。',
  '返回动作对象数组；比较时不计顺序，按集合相等判分。',
  '只返回 JSON 数组，例如 [{"type":"endTurn"}]。'
].join('');

function prefixPick(legal, step) {
  var groups = { playCard: [], attack: [], activate: [], endTurn: [] };
  var i;
  for (i = 0; i < legal.length; i++) {
    var type = legal[i] && legal[i].type;
    if (groups[type]) groups[type].push(legal[i]);
  }
  var order = ['playCard', 'attack', 'activate', 'endTurn'];
  for (i = 0; i < order.length; i++) {
    var group = groups[order[i]];
    if (group.length) return group[(step * 7 + order.length) % group.length];
  }
  return null;
}

function makeTcgTask(index) {
  for (var attempt = 0; attempt < 60; attempt++) {
    var seed = BANK_SEED + ':tcg:' + index + ':' + attempt;
    var config = tcgConfig(seed);
    var match = TCG.createMatch(config);
    var history = [];
    var steps = 5 + ((index * 3 + attempt) % 9);
    var over = false;
    for (var s = 0; s < steps; s++) {
      var st = match.state;
      if (st.phase === 'over') { over = true; break; }
      var legal = match.legalActions();
      if (!legal.length) break;
      var pick = prefixPick(legal, s + index);
      if (!pick) break;
      try { match.apply(pick); }
      catch (e) { over = true; break; }
      history.push(pick);
    }
    if (over) continue;
    var snapshot = match.state;
    if (snapshot.phase === 'over' || snapshot.phase !== 'main') continue;
    var actions = match.legalActions();
    if (actions.length < 2) continue;
    return {
      id: 'A-tcg-' + pad(index + 1, 3),
      suite: 'A',
      family: 'tcg-legal',
      prompt: TCG_PROMPT,
      data: {
        setup: cloneJson(config),
        history: cloneJson(history),
        viewedPlayer: snapshot.activePlayer,
        state: snapshot
      },
      expected: cloneJson(actions)
    };
  }
  throw new Error('tcg task generation failed at index ' + index);
}

function makeTcgTasks() {
  var tasks = [];
  for (var i = 0; i < 80; i++) tasks.push(makeTcgTask(i));
  return tasks;
}

/* ============================== suite A bank ============================== */

function generateABank() {
  if (BANK_CACHE) return BANK_CACHE;
  var tasks = [];
  tasks = tasks.concat(makeMahjongTasks());
  tasks = tasks.concat(makePokerTasks());
  tasks = tasks.concat(makeGomokuTasks());
  tasks = tasks.concat(makeTcgTasks());
  BANK_CACHE = tasks;
  return tasks;
}

function bankSizes() {
  var counts = { mahjong: 0, 'poker-category': 0, 'poker-compare': 0, gomoku: 0, 'tcg-legal': 0 };
  generateABank().forEach(function (t) { counts[t.family] = (counts[t.family] || 0) + 1; });
  counts.total = generateABank().length;
  return counts;
}

/* ============================== suite B seeds ============================= */

function generateBCases(seed, n, games) {
  var perSide = Number(n);
  if (!isFinite(perSide) || perSide <= 0) perSide = 20;
  perSide = Math.floor(perSide);
  var list = games && games.length ? games : ['tcg'];
  var out = [];
  for (var g = 0; g < list.length; g++) {
    var game = list[g];
    for (var side = 0; side < 2; side++) {
      for (var i = 0; i < perSide; i++) {
        out.push({
          id: 'B-' + game + '-s' + side + '-' + pad(i + 1, 3),
          game: game,
          agentPlayer: side,
          seed: String(seed) + ':B:' + game + ':s' + side + ':' + i,
          index: i
        });
      }
    }
  }
  return out;
}

/* ============================ suite C built-ins =========================== */

function inject(source, needle, replacement, label) {
  var first = source.indexOf(needle);
  if (first < 0) throw new Error('C inject ' + label + ': needle not found');
  if (source.indexOf(needle, first + 1) >= 0) {
    throw new Error('C inject ' + label + ': needle is not unique');
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function readShared(name) {
  return fs.readFileSync(path.join(SHARED, name), 'utf8');
}

var C_TEST_HEADER = [
  "'use strict';",
  'var passed = 0, failed = 0;',
  'function ok(name, cond) {',
  '  if (cond) passed++; else { failed++; console.log("FAIL: " + name); }',
  '}',
  'function done() {',
  '  console.log("RESULT: " + passed + " passed, " + failed + " failed");',
  '  if (failed) process.exitCode = 1;',
  '}'
].join('\n');

function makeSevenPairsTest() {
  return [
    C_TEST_HEADER,
    'var H = require("./lib.js");',
    'function tiles(str) {',
    '  var counts = new Array(34).fill(0);',
    '  var HONOR = { 东: 27, 南: 28, 西: 29, 北: 30, 中: 31, 发: 32, 白: 33 };',
    '  str.trim().split(/\\s+/).forEach(function (tok) {',
    '    var re = /(\\d+)([mps])/g, m;',
    '    while ((m = re.exec(tok))) {',
    '      var base = { m: 0, p: 9, s: 18 }[m[2]];',
    '      for (var i = 0; i < m[1].length; i++) counts[base + Number(m[1][i]) - 1]++;',
    '    }',
    '    var rest = tok.replace(/(\\d+)([mps])/g, "");',
    '    for (var j = 0; j < rest.length; j++) counts[HONOR[rest[j]]]++;',
    '  });',
    '  return counts;',
    '}',
    'var pairs = H.checkWinningHand(tiles("1m 1m 3m 3m 5m 5m 7m 7m 9m 9m 1p 1p 东 东"));',
    'ok("seven pairs is a win", pairs.winning === true);',
    'ok("seven pairs pattern present", pairs.patterns.indexOf("七对") >= 0);',
    'var quad = H.checkWinningHand(tiles("2m 2m 2m 2m 4p 4p 6p 6p 8s 8s 东 东 白 白"));',
    'ok("quad counts as two pairs", quad.patterns.indexOf("七对") >= 0);',
    'var basic = H.checkWinningHand(tiles("1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 1p 1p 东 东"));',
    'ok("basic win still detected", basic.winning === true);',
    'ok("basic win pattern present", basic.patterns.indexOf("基本胡") >= 0);',
    'var orphans = H.checkWinningHand(tiles("1m 9m 1p 9p 1s 9s 东 南 西 北 中 发 白 白"));',
    'ok("thirteen orphans still detected", orphans.patterns.indexOf("十三幺") >= 0);',
    'var bad = H.checkWinningHand(tiles("1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 东 南"));',
    'ok("non-winning hand rejected", bad.winning === false);',
    'ok("poker evaluator untouched", H.evalPoker(H.cards("As 2h 3d 4c 5s")).rank === 4);',
    'done();'
  ].join('\n');
}

function makeGomokuRuleTest() {
  return [
    C_TEST_HEADER,
    'var G = require("./lib.js").gomoku;',
    'var N = G.N;',
    'function empty() { return new Uint8Array(N * N); }',
    'function put(b, cells, p) { cells.forEach(function (rc) { b[rc[0] * N + rc[1]] = p; }); return b; }',
    'var h5 = put(empty(), [[7,3],[7,4],[7,5],[7,6],[7,7]], 1);',
    'ok("horizontal five wins", G.checkWinAt(h5, 7, 5, 1) === true);',
    'var h4 = put(empty(), [[7,3],[7,4],[7,5],[7,6]], 1);',
    'ok("horizontal four is not a win", G.checkWinAt(h4, 7, 5, 1) === false);',
    'var v5 = put(empty(), [[3,8],[4,8],[5,8],[6,8],[7,8]], 2);',
    'ok("vertical five wins", G.checkWinAt(v5, 5, 8, 2) === true);',
    'var d5 = put(empty(), [[2,2],[3,3],[4,4],[5,5],[6,6]], 1);',
    'ok("diagonal five wins", G.checkWinAt(d5, 4, 4, 1) === true);',
    'var a5 = put(empty(), [[2,10],[3,9],[4,8],[5,7],[6,6]], 2);',
    'ok("anti-diagonal five wins", G.checkWinAt(a5, 4, 8, 2) === true);',
    'var mixed = put(empty(), [[7,3],[7,4],[7,5],[7,6],[7,7]], 1);',
    'ok("wrong player does not win", G.checkWinAt(mixed, 7, 5, 2) === false);',
    'ok("empty board has no win", G.checkWinAt(empty(), 7, 7, 1) === false);',
    'done();'
  ].join('\n');
}

function makeWheelTest() {
  return [
    C_TEST_HEADER,
    'var H = require("./lib.js");',
    'var wheel = H.evalPoker(H.cards("As 2h 3d 4c 5s"));',
    'ok("A2345 is a straight", wheel.rank === 4);',
    'ok("wheel name is 顺子", wheel.name === "顺子");',
    'ok("wheel high card is 5", wheel.tiebreak[0] === 5);',
    'var sixHigh = H.evalPoker(H.cards("6s 5h 4d 3c 2s"));',
    'ok("6-high straight is a straight", sixHigh.rank === 4);',
    'ok("6-high straight beats wheel", H.comparePoker(wheel, sixHigh) === -1);',
    'var royal = H.evalPoker(H.cards("As Ks Qs Js Ts"));',
    'ok("royal flush still detected", royal.rank === 9);',
    'var pair = H.evalPoker(H.cards("As Ah Kd Qc 9s"));',
    'ok("pair rank unchanged", pair.rank === 1);',
    'var nine = H.evalPoker(H.cards("9s 8h 7d 6c 5s"));',
    'ok("9-high straight rank", nine.rank === 4 && nine.tiebreak[0] === 9);',
    'done();'
  ].join('\n');
}

function generateBuiltinCTasks() {
  if (C_BUILTIN_CACHE) return C_BUILTIN_CACHE;
  var handEval = readShared('hand-eval.js');
  var rules = readShared('rules.js');

  var buggySeven = inject(handEval,
    'if (counts[i] % 2 !== 0) return false;',
    'if (counts[i] % 2 === 0) return false;',
    'seven-pairs');
  var buggyGomoku = inject(rules,
    'if (n >= 5) return true;',
    'if (n >= 6) return true;',
    'gomoku-five');
  var buggyWheel = inject(handEval,
    'ranksDesc[1] === 5',
    'ranksDesc[1] === 6',
    'wheel');

  C_BUILTIN_CACHE = [
    {
      id: 'C-builtin-1',
      suite: 'C',
      family: 'code',
      source: 'builtin',
      title: '修复七对判定',
      prompt: 'lib.js 的七对（七小对）判定被改坏了，test.js 因此失败。修复 lib.js，保持其它玩法不变。',
      files: { 'lib.js': buggySeven },
      testFile: 'test.js',
      test: makeSevenPairsTest(),
      reference: { 'lib.js': handEval }
    },
    {
      id: 'C-builtin-2',
      suite: 'C',
      family: 'code',
      source: 'builtin',
      title: '修复五子棋五连判定',
      prompt: 'lib.js 的五子棋五连判定被改坏了，test.js 因此失败。修复 lib.js，保持其它规则不变。',
      files: { 'lib.js': buggyGomoku },
      testFile: 'test.js',
      test: makeGomokuRuleTest(),
      reference: { 'lib.js': rules }
    },
    {
      id: 'C-builtin-3',
      suite: 'C',
      family: 'code',
      source: 'builtin',
      title: '修复 A2345 顺子判定',
      prompt: 'lib.js 的德州扑克 A2345（轮子顺）判定被改坏了，test.js 因此失败。修复 lib.js。',
      files: { 'lib.js': buggyWheel },
      testFile: 'test.js',
      test: makeWheelTest(),
      reference: { 'lib.js': handEval }
    }
  ];
  return C_BUILTIN_CACHE;
}

/* -------------------------- repo TASKS.json bridge ------------------------ */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
}

function isSafeRepoPath(s) {
  return typeof s === 'string' && /^[\w./-]+$/.test(s) && s.indexOf('..') < 0 && s.charAt(0) !== '/';
}

function discoverRepoCTasks() {
  var tasksPath = path.join(ROOT, 'games', 'TASKS.json');
  var checkPath = path.join(ROOT, 'scripts', 'check-tasks.js');
  if (!fs.existsSync(tasksPath) || !fs.existsSync(checkPath)) return null;
  var data = readJson(tasksPath);
  if (!data) return null;
  var list = Array.isArray(data) ? data
    : (Array.isArray(data.tasks) ? data.tasks
      : (Array.isArray(data.items) ? data.items : []));
  if (!list.length) return null;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || typeof t !== 'object') continue;
    // The TASKS.json board uses `effort`; older/other boards may use
    // level/severity/priority. Accept any of them.
    var level;
    if (t.level !== undefined) level = t.level;
    else if (t.severity !== undefined) level = t.severity;
    else if (t.priority !== undefined) level = t.priority;
    else level = t.effort;
    if (String(level).toUpperCase() !== 'S') continue;
    if (t.probe === undefined || t.probe === null) continue;
    // Already-completed tasks would be free points; only score unfinished work.
    if (t.status !== undefined && String(t.status).toLowerCase() === 'done') continue;
    var id = t.id || t.key || t.taskId;
    if (!id) continue;
    // Probe paths are the files an agent is expected to touch. Prefer the
    // task's declared `files`; fall back to a string `probe.file`.
    var pathSet = {};
    var paths = [];
    function addPath(p) {
      if (isSafeRepoPath(p) && !pathSet[p]) { pathSet[p] = true; paths.push(p); }
    }
    if (Array.isArray(t.files)) t.files.forEach(addPath);
    if (t.probe && typeof t.probe === 'object' && typeof t.probe.file === 'string') {
      addPath(t.probe.file);
    }
    out.push({
      id: 'C-repo-' + String(id),
      suite: 'C',
      family: 'repo-task',
      source: 'repo',
      title: String(t.title || t.name || id),
      prompt: '按 games/TASKS.json 中该任务的 probe/acceptance 要求解题。runner 只判分，不负责修改工作区。',
      checkTaskId: String(id),
      probePaths: paths
    });
  }
  return out.length ? out : null;
}

function generateCBank(options) {
  var opts = options || {};
  if (!opts.forceBuiltin) {
    var repo = discoverRepoCTasks();
    if (repo) return { source: 'repo', tasks: repo };
  }
  return { source: 'builtin', tasks: generateBuiltinCTasks() };
}

/* ------------------------------- public view ------------------------------ */

// Strip everything the tested model must not see: expected answers and the
// pristine reference files. Suite C's failing test is public on purpose.
function publicTask(task) {
  if (task.suite === 'A') {
    return { id: task.id, suite: 'A', family: task.family, prompt: task.prompt, data: task.data };
  }
  if (task.suite === 'C') {
    return {
      id: task.id,
      suite: 'C',
      family: task.family,
      prompt: task.prompt,
      files: task.files || {},
      testFile: task.testFile,
      test: task.test
    };
  }
  return cloneJson(task);
}

module.exports = {
  AI_EVAL_VERSION: AI_EVAL_VERSION,
  BANK_SEED: BANK_SEED,
  ROOT: ROOT,
  engineVersion: engineVersion,
  engineHashes: engineHashes,
  generateABank: generateABank,
  bankSizes: bankSizes,
  generateBCases: generateBCases,
  generateCBank: generateCBank,
  discoverRepoCTasks: discoverRepoCTasks,
  sampleTasks: sampleTasks,
  publicTask: publicTask,
  tcgConfig: tcgConfig,
  TCG_CARDS: TCG_CARDS,
  TCG_DECK: TCG_DECK,
  TCG_RULES: TCG_RULES
};
