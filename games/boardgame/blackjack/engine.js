(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BlackjackEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';

var SUITS = ['S', 'H', 'D', 'C'];
var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
var SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };

function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit] || '?';
}

function rankLabel(rank) {
  return rank;
}

function isRed(suit) {
  return suit === 'H' || suit === 'D';
}

function cardId(suit, rank) {
  return suit + '-' + rank;
}

function cardName(card) {
  return suitSymbol(card.suit) + card.rank;
}

// Deterministic seeded RNG (mulberry32).
function mulberry32(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDeck() {
  var deck = [];
  for (var si = 0; si < SUITS.length; si++) {
    for (var ri = 0; ri < RANKS.length; ri++) {
      deck.push({ suit: SUITS[si], rank: RANKS[ri], id: cardId(SUITS[si], RANKS[ri]) });
    }
  }
  return deck;
}

function shuffle(deck, rng) {
  for (var i = deck.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

function handValue(cards) {
  var total = 0;
  var aces = 0;
  var list = cards || [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i].rank;
    if (r === 'A') {
      aces += 1;
      total += 11;
    } else if (r === 'K' || r === 'Q' || r === 'J' || r === '10') {
      total += 10;
    } else {
      total += parseInt(r, 10) || 0;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  var soft = total <= 21 && aces > 0;
  return { total: total, soft: soft };
}

function isBlackjack(cards) {
  return !!(cards && cards.length === 2 && handValue(cards).total === 21);
}

function ensureDeck(state) {
  if (!state.deck || state.deck.length < state.reshuffleThreshold) {
    state.deck = shuffle(makeDeck(), state.rng);
    pushLog(state, '牌堆不足，已重新洗牌');
  }
  return state.deck;
}

function draw(state) {
  ensureDeck(state);
  return state.deck.pop();
}

function pushLog(state, message) {
  state.log.push(message);
  if (state.log.length > 120) state.log.shift();
}

function createGame(opts) {
  opts = opts || {};
  var seed = typeof opts.seed === 'number' ? opts.seed : 20241121;
  var startingChips = typeof opts.startingChips === 'number' ? opts.startingChips : 100;
  var rng = mulberry32(seed);
  var state = {
    deck: shuffle(makeDeck(), rng),
    player: [],
    dealer: [],
    phase: 'bet',
    bet: 0,
    chips: startingChips,
    result: null,
    message: '',
    log: [],
    rng: rng,
    dealerHidden: true,
    startingChips: startingChips,
    reshuffleThreshold: 15,
    seed: seed
  };
  pushLog(state, '欢迎来到 21 点，当前筹码 ' + state.chips);
  pushLog(state, '请下注并点击「发牌」开始');
  return state;
}

function startRound(state, bet) {
  if (!state || state.phase === 'player' || state.phase === 'dealer') {
    return { ok: false, error: '本局尚未结束，请先完成当前牌局' };
  }
  if (state.phase === 'over') {
    return { ok: false, error: '本轮已结束，请点击「新一局」' };
  }
  if (state.phase !== 'bet') {
    return { ok: false, error: '当前不能下注' };
  }
  if (typeof bet !== 'number' || !isFinite(bet) || Math.floor(bet) !== bet) {
    return { ok: false, error: '下注必须是整数' };
  }
  if (bet < 1) {
    return { ok: false, error: '下注至少为 1 筹码' };
  }
  if (bet > state.chips) {
    return { ok: false, error: '下注不能超过当前筹码' };
  }

  ensureDeck(state);
  state.chips -= bet;
  state.bet = bet;
  state.player = [];
  state.dealer = [];
  state.result = null;
  state.message = '';
  state.phase = 'player';
  state.dealerHidden = true;
  pushLog(state, '下注 ' + bet + ' 筹码，开始发牌');

  state.player.push(draw(state));
  state.dealer.push(draw(state));
  state.player.push(draw(state));
  state.dealer.push(draw(state));
  pushLog(state, '闲家手牌：' + state.player.map(cardName).join(' ') + '（' + handValue(state.player).total + ' 点）');
  pushLog(state, '庄家明牌：' + cardName(state.dealer[0]));

  var pBJ = isBlackjack(state.player);
  var dBJ = isBlackjack(state.dealer);
  if (pBJ && dBJ) {
    state.dealerHidden = false;
    settle(state, 'push', '双方都是黑杰克，平局退回下注');
  } else if (pBJ) {
    state.dealerHidden = false;
    settle(state, 'blackjack', '闲家黑杰克！按 3:2 赔付');
  }

  return { ok: true };
}

function hit(state) {
  if (!state || state.phase !== 'player') {
    return { ok: false, error: '当前不能要牌' };
  }
  var card = draw(state);
  state.player.push(card);
  var val = handValue(state.player);
  pushLog(state, '闲家要牌：' + cardName(card) + '，点数 ' + val.total);
  if (val.total > 21) {
    settle(state, 'bust', '闲家爆牌（' + val.total + ' 点），输掉下注');
  } else if (val.total === 21) {
    pushLog(state, '闲家达到 21 点，自动停牌');
    dealerPlay(state);
  }
  return { ok: true };
}

function stand(state) {
  if (!state || state.phase !== 'player') {
    return { ok: false, error: '当前不能停牌' };
  }
  pushLog(state, '闲家停牌，点数 ' + handValue(state.player).total);
  dealerPlay(state);
  return { ok: true };
}

function aiDealerAction(state) {
  return handValue(state.dealer).total < 17 ? 'hit' : 'stand';
}

function dealerPlay(state) {
  state.phase = 'dealer';
  state.dealerHidden = false;
  pushLog(state, '庄家翻开暗牌：' + state.dealer.map(cardName).join(' '));

  var guard = 0;
  while (aiDealerAction(state) === 'hit' && guard < 20) {
    var card = draw(state);
    state.dealer.push(card);
    pushLog(state, '庄家要牌：' + cardName(card) + '，点数 ' + handValue(state.dealer).total);
    guard += 1;
  }
  if (guard >= 20) pushLog(state, '庄家要牌次数达到上限，停止要牌');

  var p = handValue(state.player).total;
  var d = handValue(state.dealer).total;
  pushLog(state, '最终点数 — 闲家 ' + p + '，庄家 ' + d);

  var result;
  var message;
  if (d > 21) {
    result = 'player';
    message = '庄家爆牌（' + d + ' 点），闲家胜出';
  } else if (isBlackjack(state.player) && isBlackjack(state.dealer)) {
    result = 'push';
    message = '双方都是黑杰克，平局退回下注';
  } else if (isBlackjack(state.player)) {
    result = 'blackjack';
    message = '闲家黑杰克！按 3:2 赔付';
  } else if (isBlackjack(state.dealer)) {
    result = 'dealer';
    message = '庄家黑杰克，闲家落败';
  } else if (p > d) {
    result = 'player';
    message = '闲家 ' + p + ' 点胜过庄家 ' + d + ' 点';
  } else if (p < d) {
    result = 'dealer';
    message = '庄家 ' + d + ' 点胜过闲家 ' + p + ' 点';
  } else {
    result = 'push';
    message = '双方同为 ' + p + ' 点，平局退回下注';
  }
  settle(state, result, message);
}

function payout(bet, result) {
  if (result === 'blackjack') return bet + Math.floor(bet * 3 / 2);
  if (result === 'player') return bet * 2;
  if (result === 'push') return bet;
  return 0;
}

// settle helper: applies payout, marks the round over, records Chinese message.
function settle(state, result, message) {
  var returned = payout(state.bet, result);
  state.chips += returned;
  state.result = result;
  state.phase = 'over';
  state.dealerHidden = false;
  state.message = message;
  pushLog(state, message + '；返还 ' + returned + ' 筹码，当前筹码 ' + state.chips);
  return { ok: true, result: result, returned: returned, chips: state.chips };
}

function checkRoundOver(state) {
  return !state || state.phase === 'over';
}

function newRound(state) {
  if (!state) return { ok: false, error: '无效状态' };
  if (state.phase === 'player' || state.phase === 'dealer') {
    return { ok: false, error: '本局尚未结束' };
  }
  state.player = [];
  state.dealer = [];
  state.bet = 0;
  state.phase = 'bet';
  state.result = null;
  state.message = '';
  state.dealerHidden = true;
  if (state.chips <= 0) {
    state.chips = state.startingChips || 100;
    pushLog(state, '筹码已用尽，已重置为 ' + state.chips + ' 筹码');
  }
  pushLog(state, '新一局开始，请下注');
  return { ok: true, chips: state.chips };
}

function reset(state, opts) {
  opts = opts || {};
  if (!state) return { ok: false, error: '无效状态' };
  var starting = typeof opts.startingChips === 'number' ? opts.startingChips : (state.startingChips || 100);
  state.startingChips = starting;
  state.chips = starting;
  state.player = [];
  state.dealer = [];
  state.bet = 0;
  state.phase = 'bet';
  state.result = null;
  state.message = '';
  state.dealerHidden = true;
  state.deck = shuffle(makeDeck(), state.rng);
  state.log = [];
  pushLog(state, '游戏已重置，筹码 ' + starting + '，请下注');
  return { ok: true, chips: starting };
}

return {
  SUITS: SUITS,
  RANKS: RANKS,
  suitSymbol: suitSymbol,
  rankLabel: rankLabel,
  isRed: isRed,
  cardId: cardId,
  mulberry32: mulberry32,
  handValue: handValue,
  isBlackjack: isBlackjack,
  createGame: createGame,
  startRound: startRound,
  hit: hit,
  stand: stand,
  settle: settle,
  payout: payout,
  aiDealerAction: aiDealerAction,
  checkRoundOver: checkRoundOver,
  newRound: newRound,
  reset: reset
};
});
