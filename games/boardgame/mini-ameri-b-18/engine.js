/* 走私航道 — original secret-bid risk engine (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "slug": "mini-ameri-b-18",
  "name": "走私航道",
  "rival": "缉私队长",
  "maxRounds": 8,
  "deck": [
    {
      "type": "safe",
      "pot": 2
    },
    {
      "type": "trap"
    },
    {
      "type": "safe",
      "pot": 3
    },
    {
      "type": "safe",
      "pot": 4
    },
    {
      "type": "trap"
    },
    {
      "type": "safe",
      "pot": 2
    },
    {
      "type": "safe",
      "pot": 5
    },
    {
      "type": "trap"
    },
    {
      "type": "safe",
      "pot": 3
    },
    {
      "type": "safe",
      "pot": 2
    }
  ]
};
  var CARD_NAMES = { safe: '安全卡', trap: '陷阱卡' };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 50) state.log.shift();
  }
  function draw(state) {
    if (!state.deck.length) state.deck = shuffle(CFG.deck, state.rng);
    return state.deck.pop();
  }
  function finish(state, winner, reason) {
    state.over = true;
    state.winner = winner;
    state.reason = reason;
    log(state, '结算：' + reason);
  }
  function settle(state, reason) {
    var a = state.players[0], b = state.players[1];
    if (a.score !== b.score) finish(state, a.score > b.score ? 'p0' : 'p1', reason + '，' + (a.score > b.score ? a.name : b.name) + ' 分数领先');
    else if (a.chips !== b.chips) finish(state, a.chips > b.chips ? 'p0' : 'p1', reason + '，同分比筹码');
    else finish(state, 'draw', reason + '，完全打平');
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var state = {
      seed: seed, rng: rng, round: 1, maxRounds: CFG.maxRounds,
      players: [
        { name: '你', human: true, chips: 10, score: 0, bid: null },
        { name: CFG.rival, human: false, chips: 10, score: 0, bid: null }
      ],
      deck: shuffle(CFG.deck, rng), lastCard: null,
      over: false, winner: null, reason: '', log: [], stepCount: 0
    };
    log(state, '第 1 轮：你与' + CFG.rival + '各持 10 枚筹码开始暗标');
    return state;
  }

  function legalActions(state) {
    return state.over ? [] : [0, 1, 2, 3];
  }

  function applyAction(state, playerBid, aiBid) {
    if (!state || state.over) throw new Error('game is over');
    if (typeof playerBid !== 'number' || playerBid < 0 || playerBid > 3 || playerBid % 1 !== 0) {
      throw new Error('illegal bid');
    }
    var p = state.players[0], q = state.players[1];
    if (playerBid > p.chips) throw new Error('not enough chips');
    var qBid = aiBid == null ? aiAction(state) : aiBid;
    if (typeof qBid !== 'number' || qBid < 0 || qBid > 3 || qBid % 1 !== 0) throw new Error('illegal ai bid');
    qBid = Math.min(qBid, q.chips);
    p.bid = playerBid; q.bid = qBid;
    p.chips -= playerBid; q.chips -= qBid;
    var card = draw(state);
    state.lastCard = card;
    log(state, '第 ' + state.round + ' 轮：你出 ' + playerBid + '，' + q.name + ' 出 ' + qBid + '，翻出' + CARD_NAMES[card.type]);
    if (playerBid === qBid) {
      log(state, '出价相同，双方只支付筹码，没有收益');
    } else {
      var winner = playerBid > qBid ? p : q;
      var winBid = Math.max(playerBid, qBid);
      if (card.type === 'safe') {
        winner.score += winBid + card.pot;
        log(state, winner.name + ' 赢得安全卡，获得 ' + (winBid + card.pot) + ' 分');
      } else {
        winner.score = Math.max(0, winner.score - winBid);
        log(state, winner.name + ' 踩中陷阱卡，扣掉 ' + winBid + ' 分');
      }
    }
    state.round++;
    state.stepCount++;
    if (state.round > state.maxRounds) settle(state, '轮数用尽');
    else if (p.chips === 0 && q.chips === 0) settle(state, '双方筹码耗尽');
    return state;
  }

  function aiAction(state) {
    if (!state || state.over) return null;
    var q = state.players[1];
    if (q.chips <= 0) return 0;
    var r = state.rng();
    var bid = r < 0.25 ? 0 : r < 0.6 ? 1 : r < 0.85 ? 2 : 3;
    return Math.min(bid, q.chips);
  }

  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0;
    while (!g.over && guard < 100) {
      var bid = Math.min(aiAction(g), g.players[0].chips);
      applyAction(g, bid);
      guard++;
    }
    if (!g.over) throw new Error('self-play did not terminate');
    return g;
  }

  return {
    CFG: CFG, createGame: createGame, legalActions: legalActions,
    applyAction: applyAction, aiAction: aiAction, selfPlay: selfPlay
  };
});