var Cards = (function(){var module={exports:{}};var exports=module.exports;
/* 卡牌游戏公共原语（UMD，零依赖）。
 *
 *   Cards.shuffle(arr, rng)               // Fisher–Yates；rng 需可复现（mulberry32 等）
 *   Cards.makeDeck(suits, maxRank)        // [{r,s}]，r=1..maxRank，s=0..suits-1
 *   Cards.draw(deck)                      // 从牌堆顶取一张（不可变：返回 {card, deck}）
 *   Cards.nextTurn(current, players)      // 0..players-1 轮转
 *   Cards.winnerByEmptyHand(hands)        // 谁先清空；平局返回 'tie'，未结束 null
 *   Cards.winnerByScore(scores)           // 最高分；并列 'tie'
 *
 * 目标：洗牌/牌堆/回合/胜负判定只写一份，卡牌类页面与引擎共用，
 * 随机性由种子驱动，复盘可复现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cards = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function shuffle(arr, rng) {
    var a = arr.slice();
    var random = typeof rng === 'function' ? rng : Math.random;
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 原地洗牌：仅用于内部状态（如单机引擎的牌池），不入存档、不跨座位共享。
  function shuffleInPlace(arr, rng) {
    var random = typeof rng === 'function' ? rng : Math.random;
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function makeDeck(suits, maxRank) {
    if (!(suits >= 1) || !(maxRank >= 1)) throw new Error('makeDeck: suits/maxRank must be >= 1');
    var deck = [];
    for (var s = 0; s < suits; s += 1) {
      for (var r = 1; r <= maxRank; r += 1) deck.push({ r: r, s: s });
    }
    return deck;
  }

  // 牌堆顶 = 数组末尾；不修改入参，返回新牌堆，便于存档/复盘。
  function draw(deck) {
    if (!deck.length) return { card: null, deck: deck.slice() };
    var next = deck.slice();
    var card = next.pop();
    return { card: card, deck: next };
  }

  function nextTurn(current, players) {
    if (!(players >= 1)) return 0;
    return ((Number(current) || 0) + 1) % players;
  }

  function winnerByEmptyHand(hands) {
    var empty = [];
    for (var i = 0; i < hands.length; i += 1) {
      if (Array.isArray(hands[i]) && hands[i].length === 0) empty.push(i);
    }
    if (!empty.length) return null;
    return empty.length === 1 ? empty[0] : 'tie';
  }

  function winnerByScore(scores) {
    if (!scores || !scores.length) return null;
    var best = -Infinity;
    var winners = [];
    scores.forEach(function (v, i) {
      var n = Number(v) || 0;
      if (n > best) { best = n; winners = [i]; }
      else if (n === best) winners.push(i);
    });
    return winners.length === 1 ? winners[0] : 'tie';
  }

  return {
    shuffle: shuffle,
    shuffleInPlace: shuffleInPlace,
    makeDeck: makeDeck,
    draw: draw,
    nextTurn: nextTurn,
    winnerByEmptyHand: winnerByEmptyHand,
    winnerByScore: winnerByScore,
    version: '1.0.0'
  };
});

return module.exports;})();
/* Mini-party engine (UMD) — generated for mini-party-b-02.
 * Pure, deterministic with a seed, shared by the page and the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniPartyEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GAME = {"slug":"mini-party-b-02","title":"颜色陷阱","family":"reaction","mode":"color","rounds":10,"accuracy":0.84,"seqLen":5,"itemCount":4,"optionCount":4,"startCoins":0};

  var SYMBOLS = ['★', '●', '▲', '■', '✦', '◆', '♥', '♪'];
  var DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  var COLOR_NAMES = ['红', '黄', '蓝', '绿', '紫', '橙'];
  var NAME_POOL = ['小狐', '小鹿', '小熊', '小兔', '小猫', '小狼', '小獾', '小貂'];
  var CHARS = '阳光月亮山川河流森林星辰海风云朵灯塔帆船花草松果麦田溪谷篝火筝露珠'.split('');
  var WORDS = ['阳光', '月亮', '山川', '河流', '森林', '星辰', '海风', '云朵', '灯塔', '帆船',
    '山谷', '草原', '晚霞', '晨雾', '松果', '麦田', '溪流', '篝火', '风筝', '露珠'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function ri(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function shuffle(rng, arr) { return Cards.shuffleInPlace(arr, rng); }
  function option(id, label, meta) {
    var o = { id: id, label: label };
    if (meta) { for (var k in meta) { if (Object.prototype.hasOwnProperty.call(meta, k)) o[k] = meta[k]; } }
    return o;
  }
  function mkOptions(labels, prefix) {
    return labels.map(function (label, i) { return option((prefix || 'o') + i, label); });
  }
  function findOption(state, id) {
    for (var i = 0; i < state.options.length; i++) { if (state.options[i].id === id) return state.options[i]; }
    return null;
  }
  function logLine(state, text) {
    state.log.push(text);
    if (state.log.length > 60) state.log.shift();
  }
  function setRound(state, prompt, detail, hint, options, correctIds, accuracy) {
    state.phase = 'choose';
    state.prompt = prompt;
    state.detail = detail || '';
    state.hint = hint || '';
    state.options = options;
    state.correctSet = (correctIds || []).slice();
    state.correct = state.correctSet.length ? state.correctSet[0] : null;
    state.aiAccuracy = accuracy == null ? 0.7 : accuracy;
  }
  function choiceSet(rng, correctLabels, pool, total, prefix) {
    var labels = correctLabels.slice(0);
    var rest = pool.filter(function (x) { return correctLabels.indexOf(x) < 0; });
    shuffle(rng, rest);
    while (labels.length < total && rest.length) labels.push(rest.shift());
    shuffle(rng, labels);
    var opts = mkOptions(labels, prefix || 'o');
    var ids = [];
    correctLabels.forEach(function (label) {
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].label === label && ids.indexOf(opts[i].id) < 0) ids.push(opts[i].id);
      }
    });
    return { options: opts, correctIds: ids };
  }
  function finishRound(state) {
    state.phase = 'result';
    state.history.push({ round: state.round, scores: state.scores.slice(0), result: state.lastResult });
    if (state.history.length > 60) state.history.shift();
  }

  /* ---------------------------------------------------------------- */
  /* Reaction                                                          */
  /* ---------------------------------------------------------------- */
  function symOptions(rng, n, first) {
    var pool = SYMBOLS.slice(0);
    shuffle(rng, pool);
    var labels = [];
    (first || []).forEach(function (sym) {
      var idx = pool.indexOf(sym);
      if (idx >= 0) { pool.splice(idx, 1); labels.push(sym); }
    });
    while (labels.length < n && pool.length) labels.push(pool.shift());
    shuffle(rng, labels);
    return mkOptions(labels, 'r');
  }
  function correctIdByLabel(opts, label) {
    for (var i = 0; i < opts.length; i++) { if (opts[i].label === label) return opts[i].id; }
    return null;
  }
  function generateReaction(state) {
    var rng = state.rng;
    var n = GAME.optionCount || 4;
    var opts, target, id;
    if (GAME.mode === 'color') {
      var colors = COLOR_NAMES.slice(0);
      shuffle(rng, colors);
      var chosen = colors.slice(0, n);
      target = chosen[0];
      shuffle(rng, chosen);
      opts = mkOptions(chosen, 'c');
      id = correctIdByLabel(opts, target);
      setRound(state, '拍下颜色：' + target, '选项里只有一个颜色名与它一致。',
        '越快越好，点错会输掉本回合。', opts, [id], GAME.accuracy);
    } else if (GAME.mode === 'forbidden') {
      var pool = SYMBOLS.slice(0);
      shuffle(rng, pool);
      var labels = pool.slice(0, n);
      var forbidden = labels[0];
      opts = mkOptions(labels, 'f');
      var ids = opts.filter(function (o) { return o.label !== forbidden; }).map(function (o) { return o.id; });
      setRound(state, '禁拍「' + forbidden + '」：拍下任意其他符号', '点中禁拍符号直接判负本回合。',
        '先找到被禁的符号，再避开它。', opts, ids, GAME.accuracy);
    } else if (GAME.mode === 'previous') {
      var spool = SYMBOLS.slice(0);
      shuffle(rng, spool);
      target = spool[0];
      if (state.round === 1 || !state.extra.prevTarget) {
        opts = symOptions(rng, n, [target]);
        state.extra.prevTarget = target;
        setRound(state, '先记住目标：' + target, '下一回合你要拍的是这个符号。',
          '记住它，下一回合会加入干扰。', opts, [correctIdByLabel(opts, target)], GAME.accuracy);
      } else {
        var prev = state.extra.prevTarget;
        opts = symOptions(rng, n, [prev, target]);
        state.extra.prevTarget = target;
        setRound(state, '拍下上一回合的目标（新的干扰目标：' + target + '）',
          '只看上一回合的目标，不要被新目标带走。', '上一回合的目标才是答案。',
          opts, [correctIdByLabel(opts, prev)], GAME.accuracy);
      }
    } else {
      var spp = SYMBOLS.slice(0);
      shuffle(rng, spp);
      target = spp[0];
      opts = symOptions(rng, n, [target]);
      setRound(state, '拍下目标：' + target, '在干扰符号里找到唯一的目标。',
        '眼睛先扫形状，再落点。', opts, [correctIdByLabel(opts, target)], GAME.accuracy);
    }
    state.extra.aiMs = ri(rng, 620, 1500);
  }
  function resolveReaction(state, opt, ms) {
    var rng = state.rng;
    var humanOk = state.correctSet.indexOf(opt.id) >= 0;
    var aiOk = rng() < state.aiAccuracy;
    var humanMs = (typeof ms === 'number' && ms > 0) ? Math.min(ms, 4000) : 900;
    var aiMs = state.extra.aiMs || 900;
    var winner = -1;
    if (humanOk && aiOk) winner = humanMs <= aiMs ? 0 : 1;
    else if (humanOk) winner = 0;
    else if (aiOk) winner = 1;
    if (winner === 0) { state.scores[0]++; logLine(state, '你抢拍成功，用时 ' + humanMs + 'ms。'); }
    else if (winner === 1) { state.scores[1]++; logLine(state, 'AI 抢拍成功，用时 ' + aiMs + 'ms。'); }
    else logLine(state, '双方都没拍中，本回合无人得分。');
    state.lastResult = (winner === 0 ? '你得 1 分' : winner === 1 ? 'AI 得 1 分' : '双方失手，无人得分') +
      ' · 你 ' + (humanOk ? '拍对' : '拍错') + ' ' + humanMs + 'ms · AI ' + (aiOk ? '拍对' : '拍错') + ' ' + aiMs + 'ms';
    finishRound(state);
  }

  /* ---------------------------------------------------------------- */
  /* Memory                                                            */
  /* ---------------------------------------------------------------- */
  function generateMemory(state) {
    var rng = state.rng;
    var len = GAME.seqLen || 5;
    var cs, seq, i, pool;
    if (GAME.mode === 'digit') {
      seq = [];
      for (i = 0; i < len; i++) seq.push(String(ri(rng, 1, 9)));
      var k = ri(rng, 1, len);
      cs = choiceSet(rng, [seq[k - 1]], DIGITS, 4, 'm');
      state.extra.sequence = seq;
      setRound(state, '第 ' + k + ' 位数字是什么？', '序列：' + seq.join(' ') + '（稍后自动隐藏）',
        '记住后再作答。', cs.options, cs.correctIds, GAME.accuracy);
    } else if (GAME.mode === 'missing') {
      pool = SYMBOLS.slice(0);
      shuffle(rng, pool);
      var full = pool.slice(0, 4);
      var missing = full[0];
      var shown = full.slice(1);
      shuffle(rng, shown);
      cs = choiceSet(rng, [missing], SYMBOLS, 4, 'm');
      state.extra.sequence = shown;
      setRound(state, '序列里少了哪个符号？', '序列：' + shown.join(' ') + '（稍后自动隐藏）',
        '从四个候选里找出缺失者。', cs.options, cs.correctIds, GAME.accuracy);
    } else if (GAME.mode === 'reverse') {
      pool = SYMBOLS.slice(0);
      shuffle(rng, pool);
      seq = pool.slice(0, len);
      var rev = seq.slice(0).reverse().join(' ');
      var distractors = [];
      for (var t = 0; t < 30 && distractors.length < 3; t++) {
        var tmp = seq.slice(0);
        shuffle(rng, tmp);
        var label = tmp.join(' ');
        if (label !== rev && distractors.indexOf(label) < 0) distractors.push(label);
      }
      cs = choiceSet(rng, [rev], distractors, 4, 'm');
      state.extra.sequence = seq;
      setRound(state, '把它倒过来，顺序是什么？', '序列：' + seq.join(' ') + '（稍后自动隐藏）',
        '从最后一个符号开始读。', cs.options, cs.correctIds, GAME.accuracy);
    } else if (GAME.mode === 'pair') {
      var pair = pick(rng, SYMBOLS);
      var others = SYMBOLS.filter(function (x) { return x !== pair; });
      shuffle(rng, others);
      var seq4 = [pair, pair, others[0], others[1]];
      shuffle(rng, seq4);
      var correctLabel = pair + '＋' + pair;
      var pairPool = [];
      SYMBOLS.forEach(function (a) {
        SYMBOLS.forEach(function (b) {
          if (a !== b) { var pl = a + '＋' + b; if (pairPool.indexOf(pl) < 0) pairPool.push(pl); }
        });
      });
      cs = choiceSet(rng, [correctLabel], pairPool, 4, 'm');
      state.extra.sequence = seq4;
      setRound(state, '哪一对符号相同？', '刚才的序列：' + seq4.join(' ') + '（稍后自动隐藏）',
        '相同的一对会出现两次。', cs.options, cs.correctIds, GAME.accuracy);
    } else {
      pool = SYMBOLS.slice(0);
      shuffle(rng, pool);
      seq = pool.slice(0, len);
      cs = choiceSet(rng, [seq[seq.length - 1]], SYMBOLS, 4, 'm');
      state.extra.sequence = seq;
      setRound(state, '最后一个符号是什么？', '序列：' + seq.join(' ') + '（稍后自动隐藏）',
        '盯住结尾。', cs.options, cs.correctIds, GAME.accuracy);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Betting                                                           */
  /* ---------------------------------------------------------------- */
  function generateBetting(state) {
    var rng = state.rng, opts;
    if (GAME.mode === 'dice') {
      opts = [
        option('big2', '押大 · 2 注', { guess: 'big', stake: 2 }),
        option('big1', '押大 · 1 注', { guess: 'big', stake: 1 }),
        option('small2', '押小 · 2 注', { guess: 'small', stake: 2 }),
        option('small1', '押小 · 1 注', { guess: 'small', stake: 1 })
      ];
      setRound(state, '押大小：两颗骰子，7–12 为大，2–6 为小',
        '猜对赢回同等注码，猜错失去注码。', '看准再押，筹码有限。', opts, [], 0.5);
    } else if (GAME.mode === 'auction') {
      state.extra.value = ri(rng, 3, 9);
      opts = [
        option('bid2', '出价 2', { bid: 2 }),
        option('bid4', '出价 4', { bid: 4 }),
        option('bid6', '出价 6', { bid: 6 }),
        option('bid0', '放弃', { bid: 0 })
      ];
      setRound(state, '暗拍一件宝物：出价最高且不超过底价的人得分',
        '底价 3–9，出价等于或低于底价才算有效。', '出价越高风险越大。', opts, [], 0.5);
    } else if (GAME.mode === 'card') {
      opts = [
        option('red1', '押红 · 1 注', { guess: 'red', stake: 1 }),
        option('red2', '押红 · 2 注', { guess: 'red', stake: 2 }),
        option('black1', '押黑 · 1 注', { guess: 'black', stake: 1 }),
        option('black2', '押黑 · 2 注', { guess: 'black', stake: 2 })
      ];
      setRound(state, '翻开一张牌：押红还是押黑？', '猜对赢回注码，猜错失去注码。',
        '颜色各半，注码由你决定。', opts, [], 0.5);
    } else {
      state.extra.current = ri(rng, 2, 7);
      opts = [
        option('push2', '加注 2 注', { stake: 2 }),
        option('push4', '加注 4 注', { stake: 4 }),
        option('stop', '收手', { stake: 0 })
      ];
      setRound(state, '当前点数是 ' + state.extra.current + '：下一张会比它大吗？',
        '加注后若更大则赢，否则失去注码；收手不赢不输。', '点数越高越危险。', opts, [], 0.5);
    }
  }
  function adjust(state, side, delta) { state.scores[side] += delta; }
  function resolveBetting(state, opt) {
    var rng = state.rng;
    if (GAME.mode === 'dice') {
      var d1 = ri(rng, 1, 6), d2 = ri(rng, 1, 6), sum = d1 + d2, big = sum >= 7;
      var hStake = Math.min(opt.stake, Math.max(state.scores[0], 1));
      var hWin = (opt.guess === 'big') === big;
      adjust(state, 0, hWin ? hStake : -hStake);
      var aiGuess = rng() < 0.5 ? 'big' : 'small';
      var aiStake = ri(rng, 1, 2);
      var aWin = (aiGuess === 'big') === big;
      adjust(state, 1, aWin ? aiStake : -aiStake);
      state.lastResult = '骰子 ' + d1 + '+' + d2 + '=' + sum + '（' + (big ? '大' : '小') + '）· 你' +
        (hWin ? '赢' : '输') + ' ' + hStake + ' 注 · AI ' + (aWin ? '赢' : '输') + ' ' + aiStake + ' 注';
    } else if (GAME.mode === 'auction') {
      var value = state.extra.value;
      var hBid = opt.bid;
      var aBid = pick(rng, [2, 4, 6, 0]);
      var hValid = hBid > 0 && hBid <= value;
      var aValid = aBid > 0 && aBid <= value;
      var hDelta = 0, aDelta = 0;
      if (hValid && aValid) {
        if (hBid > aBid) { hDelta = hBid; aDelta = -aBid; }
        else if (aBid > hBid) { aDelta = aBid; hDelta = -hBid; }
      } else if (hValid) hDelta = hBid;
      else if (aValid) aDelta = aBid;
      else { if (hBid > 0) hDelta = -hBid; if (aBid > 0) aDelta = -aBid; }
      adjust(state, 0, hDelta);
      adjust(state, 1, aDelta);
      state.lastResult = '底价 ' + value + ' · 你出价 ' + hBid + (hValid ? '（有效）' : '（无效）') +
        ' · AI 出价 ' + aBid + (aValid ? '（有效）' : '（无效）') +
        ' · 你 ' + (hDelta >= 0 ? '+' : '') + hDelta + '，AI ' + (aDelta >= 0 ? '+' : '') + aDelta;
    } else if (GAME.mode === 'card') {
      var red = rng() < 0.5;
      var color = red ? 'red' : 'black';
      var hStake2 = Math.min(opt.stake, Math.max(state.scores[0], 1));
      var hWin2 = opt.guess === color;
      adjust(state, 0, hWin2 ? hStake2 : -hStake2);
      var aiGuess2 = rng() < 0.5 ? 'red' : 'black';
      var aiStake2 = ri(rng, 1, 2);
      var aWin2 = aiGuess2 === color;
      adjust(state, 1, aWin2 ? aiStake2 : -aiStake2);
      state.lastResult = '翻出' + (red ? '红牌' : '黑牌') + ' · 你' + (hWin2 ? '赢' : '输') + ' ' + hStake2 +
        ' 注 · AI ' + (aWin2 ? '赢' : '输') + ' ' + aiStake2 + ' 注';
    } else {
      var cur = state.extra.current;
      var next = ri(rng, 2, 9);
      var stake = opt.stake;
      var hWin3 = stake > 0 && next > cur;
      var delta = stake > 0 ? (hWin3 ? stake : -stake) : 0;
      adjust(state, 0, delta);
      var aiStake3 = pick(rng, [0, 2, 4]);
      var aWin3 = aiStake3 > 0 && next > cur;
      var aDelta3 = aiStake3 > 0 ? (aWin3 ? aiStake3 : -aiStake3) : 0;
      adjust(state, 1, aDelta3);
      state.lastResult = '下一张 ' + next + (next > cur ? ' 更大' : ' 没有更大') + '（当前 ' + cur + '）· 你 ' +
        (delta >= 0 ? '+' : '') + delta + ' 注 · AI ' + (aDelta3 >= 0 ? '+' : '') + aDelta3 + ' 注';
    }
    logLine(state, state.lastResult);
    finishRound(state);
  }

  /* ---------------------------------------------------------------- */
  /* Passing                                                           */
  /* ---------------------------------------------------------------- */
  function generatePassing(state) {
    var rng = state.rng;
    if (GAME.mode === 'bomb') {
      state.extra.fuse = ri(rng, 2, 3);
      var bopts = [
        option('pass', '把炸弹传出去', { act: 'pass' }),
        option('defuse', '尝试拆弹', { act: 'defuse' })
      ];
      setRound(state, '炸弹在你手中，引线还剩 ' + state.extra.fuse + ' 格',
        '传出去后 AI 也会做选择；引线会随机缩短。', '引线越短越危险，拆弹只在 1 格时稳。', bopts, [], 0.5);
      return;
    }
    var hand = [ri(rng, 2, 9), ri(rng, 2, 9), ri(rng, 2, 9)];
    var aiHand = [ri(rng, 2, 9), ri(rng, 2, 9), ri(rng, 2, 9)];
    if (GAME.mode === 'suit') {
      var suits = ['♠', '♥', '♦', '♣'];
      hand = [pick(rng, suits), pick(rng, suits), pick(rng, suits)];
      aiHand = [pick(rng, suits), pick(rng, suits), pick(rng, suits)];
      var target = pick(rng, suits);
      state.extra.hand = hand;
      state.extra.aiHand = aiHand;
      state.extra.targetSuit = target;
      var sopts = hand.map(function (c, i) {
        return option('p' + i, '传 ' + c + '（第 ' + (i + 1) + ' 张）', { index: i });
      });
      setRound(state, '传出一张牌，目标是凑齐最多的 ' + target + ' 花色',
        '你的手牌：' + hand.join(' ') + ' ｜ AI 手牌：' + aiHand.join(' ') + '。双方同时传一张。',
        '传掉多余花色，留下目标花色。', sopts, [], 0.5);
      return;
    }
    state.extra.hand = hand;
    state.extra.aiHand = aiHand;
    var opts = hand.map(function (c, i) { return option('p' + i, '传 ' + c, { index: i }); });
    var hint = GAME.mode === 'gift' ? '保留两张牌，相邻点数差越小越好' : '交换后三张手牌点数之和更大者得分';
    setRound(state, '选一张牌传给 AI，AI 也会传回一张',
      '你的手牌：' + hand.join(' ') + ' ｜ AI 手牌：' + aiHand.join(' ') + '。',
      hint, opts, [], 0.5);
  }
  function resolveBomb(state, opt) {
    var rng = state.rng;
    var fuse = state.extra.fuse;
    var events = [], h = 0, a = 0;
    if (opt.act === 'defuse') {
      if (fuse <= 1) { h = 1; events.push('你在最后 1 格拆弹成功，得 1 分。'); }
      else { a = 1; events.push('你提前拆弹失败，AI 得 1 分。'); }
    } else {
      fuse = rng() < 0.55 ? fuse - 1 : fuse;
      events.push('你把炸弹传给 AI（引线剩 ' + Math.max(fuse, 0) + ' 格）');
      if (fuse <= 0) { h = 1; events.push('炸弹在 AI 手中引爆，你得 1 分。'); }
      else if (fuse <= 1) {
        if (rng() < 0.8) { a = 1; events.push('AI 在最后 1 格拆弹成功，AI 得 1 分。'); }
        else { h = 1; events.push('AI 拆弹失手，你得 1 分。'); }
      } else {
        fuse = rng() < 0.55 ? fuse - 1 : fuse;
        events.push('AI 把炸弹传回给你（引线剩 ' + Math.max(fuse, 0) + ' 格）');
        if (fuse <= 0) { a = 1; events.push('炸弹在你手中引爆，AI 得 1 分。'); }
        else events.push('本回合安全结束，无人得分。');
      }
    }
    state.scores[0] += h;
    state.scores[1] += a;
    state.lastResult = events.join('；');
    logLine(state, state.lastResult);
    finishRound(state);
  }
  function resolvePassing(state, opt) {
    if (GAME.mode === 'bomb') { resolveBomb(state, opt); return; }
    var rng = state.rng;
    var hand = state.extra.hand.slice(0);
    var aiHand = state.extra.aiHand.slice(0);
    var hi = opt.index;
    var aiIndex = ri(rng, 0, 2);
    var tmp = hand[hi]; hand[hi] = aiHand[aiIndex]; aiHand[aiIndex] = tmp;
    if (GAME.mode === 'suit') {
      var target = state.extra.targetSuit;
      var hc = hand.filter(function (c) { return c === target; }).length;
      var ac = aiHand.filter(function (c) { return c === target; }).length;
      if (hc > ac) { state.scores[0]++; state.lastResult = '你留下 ' + hc + ' 张 ' + target + '，AI ' + ac + ' 张，你得 1 分。'; }
      else if (ac > hc) { state.scores[1]++; state.lastResult = 'AI 留下 ' + ac + ' 张 ' + target + '，你 ' + hc + ' 张，AI 得 1 分。'; }
      else state.lastResult = '双方都是 ' + hc + ' 张 ' + target + '，平局。';
    } else if (GAME.mode === 'gift') {
      var hGap = Math.abs(hand[0] - hand[1]) + Math.abs(hand[1] - hand[2]);
      var aGap = Math.abs(aiHand[0] - aiHand[1]) + Math.abs(aiHand[1] - aiHand[2]);
      if (hGap < aGap) { state.scores[0]++; state.lastResult = '你的牌更接近（差 ' + hGap + ' vs ' + aGap + '），你得 1 分。'; }
      else if (aGap < hGap) { state.scores[1]++; state.lastResult = 'AI 的牌更接近（差 ' + aGap + ' vs ' + hGap + '），AI 得 1 分。'; }
      else state.lastResult = '两边一样接近（差 ' + hGap + '），平局。';
    } else {
      var hs = hand[0] + hand[1] + hand[2];
      var as = aiHand[0] + aiHand[1] + aiHand[2];
      if (hs > as) { state.scores[0]++; state.lastResult = '你的手牌 ' + hand.join('+') + '=' + hs + '，AI ' + aiHand.join('+') + '=' + as + '，你得 1 分。'; }
      else if (as > hs) { state.scores[1]++; state.lastResult = 'AI 的手牌 ' + aiHand.join('+') + '=' + as + '，你 ' + hand.join('+') + '=' + hs + '，AI 得 1 分。'; }
      else state.lastResult = '双方都是 ' + hs + ' 点，平局。';
    }
    logLine(state, state.lastResult);
    finishRound(state);
  }

  /* ---------------------------------------------------------------- */
  /* Forbidden                                                         */
  /* ---------------------------------------------------------------- */
  function generateForbidden(state) {
    var rng = state.rng, opts, labels, forbidden, correctIds, i;
    if (GAME.mode === 'char') {
      var chars = ['日', '月', '水', '火', '木', '金', '土', '风', '光', '山'];
      forbidden = pick(rng, chars);
      var others = CHARS.filter(function (c) { return c !== forbidden; });
      labels = [
        forbidden + pick(rng, others),
        pick(rng, others) + forbidden,
        pick(rng, others) + pick(rng, others),
        pick(rng, others) + pick(rng, others)
      ];
      shuffle(rng, labels);
      opts = mkOptions(labels, 'w');
      correctIds = opts.filter(function (o) { return o.label.indexOf(forbidden) < 0; }).map(function (o) { return o.id; });
      setRound(state, '避开含「' + forbidden + '」的词', '从词库里选一个不含禁字的词。',
        '禁字可能藏在词中间。', opts, correctIds, GAME.accuracy);
    } else if (GAME.mode === 'chain') {
      var prev = pick(rng, WORDS);
      var required = prev.charAt(prev.length - 1);
      var rest = CHARS.filter(function (c) { return c !== required; });
      var forbiddenWord = required + pick(rng, rest);
      var validA = required + pick(rng, rest);
      var validB = required + pick(rng, rest);
      if (validA === forbiddenWord) validA = required + pick(rng, rest);
      if (validB === forbiddenWord || validB === validA) validB = required + pick(rng, rest);
      var wrong = pick(rng, rest) + pick(rng, CHARS);
      labels = [validA, validB, forbiddenWord, wrong];
      shuffle(rng, labels);
      opts = mkOptions(labels, 'w');
      correctIds = opts.filter(function (o) {
        return o.label.charAt(0) === required && o.label !== forbiddenWord;
      }).map(function (o) { return o.id; });
      setRound(state, '尾字「' + required + '」开头接词，避开禁词「' + forbiddenWord + '」',
        '上一个词：「' + prev + '」。首字必须是「' + required + '」。',
        '先排除禁词，再检查首字。', opts, correctIds, GAME.accuracy);
    } else if (GAME.mode === 'describe') {
      var forb = ['甜', '快', '大'];
      var phrases = ['清甜的风', '快速的河', '巨大的山', '安静的山谷', '辽阔的草原',
        '温柔的海面', '明亮的夜空', '幽深的森林', '轻盈的晨雾', '绵长的溪流'];
      shuffle(rng, phrases);
      labels = phrases.slice(0, 4);
      opts = mkOptions(labels, 'w');
      correctIds = opts.filter(function (o) {
        return forb.every(function (c) { return o.label.indexOf(c) < 0; });
      }).map(function (o) { return o.id; });
      setRound(state, '用短语描述风景，避开「甜」「快」「大」', '踩中任意一个禁字就算答错。',
        '逐字扫过四个短语。', opts, correctIds, GAME.accuracy);
    } else {
      var groups = [
        ['开心', ['快乐', '高兴', '愉快', '兴奋']],
        ['美丽', ['漂亮', '好看', '秀丽', '俊美']],
        ['快速', ['迅速', '飞快', '快捷', '神速']],
        ['安静', ['宁静', '清净', '寂静', '平和']],
        ['困难', ['艰难', '麻烦', '棘手', '费劲']]
      ];
      var group = pick(rng, groups);
      forbidden = group[0];
      labels = [forbidden].concat(group[1].slice(0, 3));
      shuffle(rng, labels);
      opts = mkOptions(labels, 'w');
      correctIds = opts.filter(function (o) { return o.label !== forbidden; }).map(function (o) { return o.id; });
      setRound(state, '换一个意思相近但不含禁词「' + forbidden + '」的说法',
        '四个近义词里混入了一个禁词本身。', '先划掉与禁词相同的词。', opts, correctIds, GAME.accuracy);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rhythm                                                            */
  /* ---------------------------------------------------------------- */
  function generateRhythm(state) {
    var rng = state.rng, pattern, labels, opts, correctId, i, t;
    if (GAME.mode === 'count') {
      var len = ri(rng, 5, 7);
      pattern = [];
      var taps = 0;
      for (i = 0; i < len; i++) {
        var beat = rng() < 0.6 ? '哒' : '停';
        pattern.push(beat);
        if (beat === '哒') taps++;
      }
      var counts = [taps];
      [taps + 1, taps - 1, taps + 2].forEach(function (n) {
        if (n >= 0 && counts.indexOf(n) < 0) counts.push(n);
      });
      labels = counts.map(function (n) { return n + ' 个'; });
      shuffle(rng, labels);
      opts = mkOptions(labels, 't');
      correctId = correctIdByLabel(opts, taps + ' 个');
      state.extra.hide = false;
      setRound(state, '数一数：这段节奏里有几个「哒」？', '节奏：' + pattern.join(' '),
        '只在心里数，别出声。', opts, [correctId], GAME.accuracy);
    } else if (GAME.mode === 'next') {
      var period = ri(rng, 2, 4);
      pattern = [];
      for (i = 0; i < period; i++) pattern.push(rng() < 0.55 ? '哒' : '停');
      var shown = pattern.concat(pattern);
      labels = ['哒', '停'];
      opts = mkOptions(labels, 't');
      correctId = correctIdByLabel(opts, pattern[0]);
      state.extra.hide = false;
      setRound(state, '节奏重复出现，下一拍是什么？', '节奏：' + shown.join(' '),
        '找出重复的周期。', opts, [correctId], GAME.accuracy);
    } else {
      var len2 = ri(rng, 4, 5);
      pattern = [];
      for (i = 0; i < len2; i++) pattern.push(rng() < 0.55 ? '哒' : '停');
      var correctLabel = pattern.join(' ');
      var pool = [];
      for (t = 0; t < 30 && pool.length < 3; t++) {
        var alt = pattern.slice(0);
        var pos = ri(rng, 0, alt.length - 1);
        alt[pos] = alt[pos] === '哒' ? '停' : '哒';
        var altLabel = alt.join(' ');
        if (altLabel !== correctLabel && pool.indexOf(altLabel) < 0) pool.push(altLabel);
      }
      var cs = choiceSet(rng, [correctLabel], pool, 4, 't');
      state.extra.hide = true;
      setRound(state, '拍出刚才的节奏', '节奏：' + correctLabel + '（稍后自动隐藏）',
        '两拍一组地记。', cs.options, cs.correctIds, GAME.accuracy);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Ranking                                                           */
  /* ---------------------------------------------------------------- */
  function generateRanking(state) {
    var rng = state.rng;
    var names = NAME_POOL.slice(0);
    shuffle(rng, names);
    var n = GAME.itemCount || 4;
    var values = [];
    while (values.length < n) {
      var v = ri(rng, 2, 9);
      if (values.indexOf(v) < 0) values.push(v);
    }
    var items = names.slice(0, n).map(function (nm, i) { return { name: nm, value: values[i] }; });
    var shown = '数值：' + items.map(function (it) { return it.name + ' ' + it.value; }).join(' ｜ ');
    if (GAME.mode === 'second') {
      var sorted = items.slice(0).sort(function (a, b) { return b.value - a.value; });
      var second = sorted[1];
      var opts = mkOptions(items.map(function (it) { return it.name; }), 'k');
      setRound(state, '谁排第二？', shown, '先找最大值，再找次大值。',
        opts, [correctIdByLabel(opts, second.name)], GAME.accuracy);
      return;
    }
    var asc = GAME.mode === 'ascending';
    var ordered = items.slice(0).sort(function (a, b) { return asc ? a.value - b.value : b.value - a.value; });
    var correctLabel = ordered.map(function (it) { return it.name; }).join(' > ');
    var pool = [];
    for (var t = 0; t < 40 && pool.length < 3; t++) {
      var tmp = items.slice(0);
      shuffle(rng, tmp);
      var label = tmp.map(function (it) { return it.name; }).join(' > ');
      if (label !== correctLabel && pool.indexOf(label) < 0) pool.push(label);
    }
    var cs = choiceSet(rng, [correctLabel], pool, 4, 'k');
    setRound(state, asc ? '按数值从小到大排序' : '按数值从大到小排序', shown,
      '比较相邻两个数就够了。', cs.options, cs.correctIds, GAME.accuracy);
  }

  /* ---------------------------------------------------------------- */
  /* Round flow                                                        */
  /* ---------------------------------------------------------------- */
  function generateRound(state) {
    state.phase = 'choose';
    state.lastResult = null;
    if (state.family === 'reaction') generateReaction(state);
    else if (state.family === 'memory') generateMemory(state);
    else if (state.family === 'betting') generateBetting(state);
    else if (state.family === 'passing') generatePassing(state);
    else if (state.family === 'forbidden') generateForbidden(state);
    else if (state.family === 'rhythm') generateRhythm(state);
    else generateRanking(state);
  }
  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed;
    var rng = opts.rng || mulberry32(seed);
    var start = GAME.startCoins || 0;
    var state = {
      game: GAME.slug, title: GAME.title, family: GAME.family, mode: GAME.mode,
      seed: seed, rng: rng, aiAll: !!opts.aiAll,
      players: [{ id: 0, name: '你' }, { id: 1, name: 'AI' }],
      round: 1, maxRounds: GAME.rounds,
      phase: 'choose', scores: [start, start],
      prompt: '', detail: '', hint: '', options: [],
      correct: null, correctSet: [], aiAccuracy: 0.7,
      lastResult: null, winner: null, history: [], log: [], extra: {}
    };
    generateRound(state);
    logLine(state, '第 1 回合开始：' + GAME.title);
    return state;
  }
  function isOver(state) { return !state || state.phase === 'over'; }
  function finishGame(state) {
    state.phase = 'over';
    state.winner = state.scores[0] > state.scores[1] ? 0 : state.scores[0] < state.scores[1] ? 1 : -1;
    state.lastResult = state.winner === 0
      ? '你以 ' + state.scores[0] + ':' + state.scores[1] + ' 获胜！'
      : state.winner === 1
        ? 'AI 以 ' + state.scores[1] + ':' + state.scores[0] + ' 获胜。'
        : '双方 ' + state.scores[0] + ':' + state.scores[1] + ' 战平。';
    logLine(state, state.lastResult);
  }
  function applyAction(state, action) {
    if (!state) return { ok: false, error: '没有对局' };
    if (isOver(state)) return { ok: false, error: '对局已结束' };
    if (action && action.type === 'next') {
      if (state.phase !== 'result') return { ok: false, error: '当前不是结算阶段' };
      if (state.round >= state.maxRounds) { finishGame(state); return { ok: true, done: true }; }
      state.round++;
      generateRound(state);
      logLine(state, '第 ' + state.round + ' 回合开始。');
      return { ok: true, done: false };
    }
    if (state.phase !== 'choose') return { ok: false, error: '请先进入下一回合' };
    var opt = findOption(state, action && action.choice);
    if (!opt) return { ok: false, error: '无效选项' };
    if (state.family === 'reaction') resolveReaction(state, opt, action.ms);
    else if (state.family === 'betting') resolveBetting(state, opt);
    else if (state.family === 'passing') resolvePassing(state, opt);
    else resolveQuiz(state, opt);
    return { ok: true, done: false };
  }
  function resolveQuiz(state, opt) {
    var humanOk = state.correctSet.indexOf(opt.id) >= 0;
    var aiOk = state.rng() < state.aiAccuracy;
    if (humanOk && !aiOk) { state.scores[0]++; state.lastResult = '你答对，AI 答错，你得 1 分。'; }
    else if (!humanOk && aiOk) { state.scores[1]++; state.lastResult = '你答错，AI 答对，AI 得 1 分。'; }
    else if (humanOk && aiOk) state.lastResult = '双方都答对，本回合无人得分。';
    else state.lastResult = '双方都答错，本回合无人得分。';
    logLine(state, state.lastResult);
    finishRound(state);
  }
  function aiAction(state) {
    if (!state || isOver(state)) return null;
    if (state.phase === 'result') return { type: 'next' };
    if (state.phase !== 'choose') return null;
    var rng = state.rng, opt;
    if (state.family === 'betting') {
      opt = pick(rng, state.options);
    } else {
      var correctOpts = state.options.filter(function (o) { return state.correctSet.indexOf(o.id) >= 0; });
      var wrongOpts = state.options.filter(function (o) { return state.correctSet.indexOf(o.id) < 0; });
      if (correctOpts.length && rng() < (state.aiAccuracy || 0.7)) opt = pick(rng, correctOpts);
      else if (wrongOpts.length) opt = pick(rng, wrongOpts);
      else opt = pick(rng, state.options);
    }
    return { type: 'choose', choice: opt.id, ms: ri(rng, 650, 1400) };
  }
  function legalActions(state) {
    if (!state || isOver(state)) return [];
    if (state.phase === 'result') return [{ type: 'next' }];
    return state.options.map(function (o) { return { type: 'choose', choice: o.id, label: o.label }; });
  }

  return {
    GAME: GAME,
    createGame: createGame,
    applyAction: applyAction,
    aiAction: aiAction,
    isOver: isOver,
    winner: function (state) { return state ? state.winner : null; },
    legalActions: legalActions
  };
}));
