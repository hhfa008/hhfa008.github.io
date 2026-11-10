'use strict';

/*
 * 卡牌对战引擎（纯逻辑、无 DOM、无第三方依赖）。
 *
 * 极简宝可梦式规则：
 * - 双方训练师各 20 HP，各自从同一套 10 张生物卡里洗牌。
 * - 起手 5 张；每回合开始 +1 能量（上限 6）并摸 1 张。
 * - 出牌消耗能量；场上没有生物时才能出牌，生物被击倒后才能补场。
 * - 每回合可攻击一次（不消耗能量）：打对方出战生物；击倒生物造成 2 点突破伤害；
 *   对方空场则直接打训练师。
 * - 训练师 HP ≤ 0 判负。牌库抽空时把弃牌堆洗回。
 *
 * 所有随机数来自 state.rngState（mulberry32），不使用 Math.random，
 * 因此同样的 seed + 同样的操作序列会得到完全一样的结果。
 */

export const CARD_POOL = [
  { id: 'c1', name: '火焰猴', type: 'fire', category: 'pokemon', stage: 'basic', hp: 3, attack: 2, cost: 1, color: '#c0392b' },
  { id: 'c2', name: '水箭龟', type: 'water', category: 'pokemon', stage: 'basic', hp: 4, attack: 1, cost: 2, color: '#2f6f8f' },
  { id: 'c3', name: '妙蛙种子', type: 'grass', category: 'pokemon', stage: 'basic', hp: 2, attack: 3, cost: 1, color: '#3f7d5b' },
  { id: 'c4', name: '皮卡丘', type: 'electric', category: 'pokemon', stage: 'basic', hp: 3, attack: 2, cost: 1, color: '#b98a2e' },
  { id: 'c5', name: '喷火龙', type: 'fire', category: 'pokemon', stage: 'basic', hp: 5, attack: 3, cost: 3, color: '#a93226' },
  { id: 'c6', name: '杰尼龟', type: 'water', category: 'pokemon', stage: 'basic', hp: 2, attack: 4, cost: 2, color: '#3a7ca5' },
  { id: 'c7', name: '小火龙', type: 'fire', category: 'pokemon', stage: 'basic', hp: 4, attack: 2, cost: 2, color: '#d35400' },
  { id: 'c8', name: '菊草叶', type: 'grass', category: 'pokemon', stage: 'basic', hp: 3, attack: 3, cost: 2, color: '#4f8a4f' },
  { id: 'c9', name: '雷伊布', type: 'electric', category: 'pokemon', stage: 'basic', hp: 2, attack: 5, cost: 3, color: '#c9a227' },
  { id: 'c10', name: '卡比兽', type: 'normal', category: 'pokemon', stage: 'basic', hp: 6, attack: 1, cost: 3, color: '#8a6a4a' },
  // 能量卡不参与页面默认牌组；C 的 60 张牌契约会把它洗进牌库。
  { id: 'en-001', name: '基础火能量', type: 'fire', category: 'energy', hp: 0, attack: 0, cost: 99, color: '#c0392b' }
];

const CREATURE_DECK = CARD_POOL.filter(function (card) {
  return card.category !== 'energy';
}).map(function (card) { return card.id; });

export const CARD_MAP = Object.freeze(
  CARD_POOL.reduce(function (map, card) {
    map[card.id] = card;
    return map;
  }, {})
);

export const RULES = [
  '牌库 60 张，起手 7 张，奖赏卡 6 张，备战区 5 个位置。',
  '双方训练师各 20 HP（页面演示计分；官方 TCG 以取完 6 张奖赏卡决胜负）。',
  '初始能量 1；每回合开始 +1 能量（上限 6）并摸 1 张。',
  '出牌消耗卡牌费用；基础生物可放出战区或备战区。',
  '每回合可攻击一次，不消耗能量。',
  '对方有生物时打生物；击倒生物造成 2 点突破伤害。',
  '对方空场时攻击直接打训练师。',
  '训练师 HP 归零或取完 6 张奖赏卡即获胜；牌库空了洗回弃牌堆。'
];

/*
 * Physical deck-construction numbers shared with the playable page and the
 * realism fixture. 60 cards / 7 opening hand / 6 prizes / 5 bench is the
 * standard Pokémon TCG deck contract; the sample engine keeps its 20 HP
 * trainer and breakthrough damage as a demo scoring layer (see
 * games/boardgame/realism/card-battle.json deviations).
 */
export const RULES_META = Object.freeze({
  deckSize: 60,
  openingHand: 7,
  prizeCards: 6,
  benchSize: 5,
  maxCopiesPerName: 4
});

const MAX_ENERGY = 6;

export function cardById(id) {
  return CARD_MAP[id] || null;
}

export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function random(state) {
  // 只推进 state.rngState，保持状态可 JSON 序列化。
  let a = (state.rngState >>> 0) + 0x6d2b79f5;
  state.rngState = a >>> 0;
  let t = Math.imul((a ^ (a >>> 15)) | 0, 1 | a);
  t = (t + Math.imul((t ^ (t >>> 7)) | 0, 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffleInPlace(state, list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random(state) * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

function cloneCard(card) {
  return {
    cardId: card.id,
    name: card.name,
    type: card.type,
    category: card.category || 'pokemon',
    stage: card.stage || 'basic',
    hp: card.hp,
    maxHp: card.hp,
    attack: card.attack,
    cost: card.cost,
    color: card.color,
    energies: [],
    energyCount: 0
  };
}

/*
 * Official TCG: when the Active Pokémon is Knocked Out, the owner promotes a
 * Benched Pokémon. The sample has no manual switch action, so promote the
 * first benched Basic automatically.
 */
function promoteBench(player) {
  if (!player || player.active) return null;
  if (!Array.isArray(player.bench) || !player.bench.length) return null;
  player.active = player.bench.shift();
  return player.active;
}

function makePlayer(index, name) {
  return {
    index: index,
    name: name || (index === 0 ? '你' : '对手'),
    hp: 20,
    energy: 1,
    hand: [],
    deck: [],
    discard: [],
    prizes: [],
    bench: [],
    active: null,
    attackedTurn: -1
  };
}

function playerError(state, playerIndex) {
  if (!state || !Array.isArray(state.players)) return { ok: false, code: 'E_STATE', message: '状态无效' };
  if (!Number.isInteger(playerIndex) || !state.players[playerIndex]) {
    return { ok: false, code: 'E_PLAYER', message: '玩家不存在' };
  }
  return null;
}

function refillDeck(state, player) {
  if (player.deck.length || !player.discard.length) return;
  player.deck = player.discard.splice(0);
  shuffleInPlace(state, player.deck);
}

export function draw(state, playerIndex, n) {
  const err = playerError(state, playerIndex);
  if (err) return err;
  if (state.phase !== 'playing') return { ok: false, code: 'E_PHASE', message: '对局已结束' };
  const player = state.players[playerIndex];
  const count = Math.max(1, n == null ? 1 : Math.floor(n));
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    refillDeck(state, player);
    if (!player.deck.length) break;
    const cardId = player.deck.shift();
    player.hand.push(cardId);
    cards.push(cardId);
  }
  return { ok: true, state: state, cards: cards };
}

function beginTurn(state, playerIndex) {
  const player = state.players[playerIndex];
  player.energy = Math.min(MAX_ENERGY, player.energy + 1);
  const result = draw(state, playerIndex, 1);
  const messages = [];
  messages.push(player.name + ' 回合开始，能量 ' + player.energy + '。');
  if (result.cards && result.cards.length) {
    const card = cardById(result.cards[0]);
    if (card) messages.push(player.name + ' 摸到「' + card.name + '」。');
  } else {
    messages.push(player.name + ' 无牌可摸。');
  }
  state.log.push({ turn: state.turn, text: messages.join(' ') });
  return messages.join(' ');
}

function currentIndex(state) {
  // 先手由 first 指定，之后双方交替。
  return (state.turn + (state.first || 0)) % state.players.length;
}

function checkTrainerWin(state) {
  const dead = state.players.findIndex(function (player) { return player.hp <= 0; });
  if (dead !== -1) {
    state.phase = 'ended';
    state.winner = dead === 0 ? 1 : 0;
    state.log.push({
      turn: state.turn,
      text: state.players[state.winner].name + ' 获胜。'
    });
    return true;
  }
  return false;
}

export function createGame(opts) {
  const options = opts || {};
  const seed = Number.isFinite(options.seed) ? (options.seed >>> 0) : 1;
  const deck = Array.isArray(options.deck) && options.deck.length
    ? options.deck.slice()
    : CREATURE_DECK.slice();
  const handSize = Math.min(10, Math.max(1, options.handSize == null ? 5 : Math.floor(options.handSize)));
  const hp = Math.max(1, options.playerHp == null ? 20 : Math.floor(options.playerHp));
  const prizeCount = Math.max(0, Math.floor(
    options.prizeCards != null ? options.prizeCards
      : (options.rules && options.rules.prizeCards) || 0
  ));
  const names = options.names || ['你', '对手'];
  const first = Number.isInteger(options.first)
    ? ((options.first % 2) + 2) % 2
    : seed % 2;

  const state = {
    players: [makePlayer(0, names[0]), makePlayer(1, names[1])],
    turn: 0,
    first: first,
    phase: 'playing',
    winner: null,
    prizeCards: prizeCount,
    rngState: seed >>> 0,
    log: []
  };
  state.players.forEach(function (player) {
    player.hp = hp;
    player.deck = shuffleInPlace(state, deck.slice());
    for (let i = 0; i < handSize; i += 1) {
      const cardId = player.deck.shift();
      if (cardId) player.hand.push(cardId);
    }
    for (let i = 0; i < prizeCount; i += 1) {
      const cardId = player.deck.shift();
      if (cardId) player.prizes.push(cardId);
    }
  });
  state.log.push({
    turn: 0,
    text: '对局开始，双方各 ' + hp + ' HP，起手 ' + handSize + ' 张' +
      (prizeCount ? '，奖赏卡 ' + prizeCount + ' 张' : '') + '。'
  });
  state.log.push({ turn: 0, text: state.players[first].name + ' 先手。' });
  beginTurn(state, first);
  return state;
}

export function legalActions(state, playerIndex) {
  if (!state || state.phase !== 'playing') return [];
  const index = playerIndex == null ? currentIndex(state) : playerIndex;
  const player = state.players[index];
  if (!player || index !== currentIndex(state)) return [];
  const actions = [{ type: 'endTurn' }];
  if (player.active && player.attackedTurn !== state.turn) {
    actions.push({ type: 'attack' });
  }
  if (player.active) {
    const seenEnergy = new Set();
    player.hand.forEach(function (cardId) {
      const card = cardById(cardId);
      if (card && card.category === 'energy' && !seenEnergy.has(cardId)) {
        seenEnergy.add(cardId);
        actions.push({
          type: 'attach',
          cardId: cardId,
          target: player.active.cardId,
          card: card
        });
      }
    });
    const bench = Array.isArray(player.bench) ? player.bench : [];
    if (bench.length < RULES_META.benchSize) {
      const seenBench = new Set();
      player.hand.forEach(function (cardId) {
        const card = cardById(cardId);
        if (!card || card.category === 'energy') return;
        if ((card.stage || 'basic') !== 'basic') return;
        if (player.energy < card.cost || seenBench.has(cardId)) return;
        seenBench.add(cardId);
        actions.push({
          type: 'play',
          cardId: cardId,
          target: 'bench',
          card: card
        });
      });
    }
    return actions;
  }
  const seen = new Set();
  player.hand.forEach(function (cardId) {
    const card = cardById(cardId);
    if (card && card.category !== 'energy' && player.energy >= card.cost && !seen.has(cardId)) {
      seen.add(cardId);
      actions.push({ type: 'play', cardId: cardId, card: card });
    }
  });
  return actions;
}

export function playCard(state, playerIndex, cardId, options) {
  const opts = options || {};
  const err = playerError(state, playerIndex);
  if (err) return err;
  if (state.phase !== 'playing') return { ok: false, code: 'E_PHASE', message: '对局已结束' };
  if (playerIndex !== currentIndex(state)) return { ok: false, code: 'E_TURN', message: '还没轮到你' };
  const player = state.players[playerIndex];
  const toBench = opts.target === 'bench';
  const index = player.hand.indexOf(cardId);
  if (index === -1) return { ok: false, code: 'E_CARD', message: '手牌中没有这张卡' };
  const card = cardById(cardId);
  if (!card) return { ok: false, code: 'E_CARD', message: '未知卡牌' };
  if (card.category === 'energy') return { ok: false, code: 'E_CARD', message: '能量卡请使用 attachEnergy' };
  if (player.energy < card.cost) return { ok: false, code: 'E_ENERGY', message: '能量不足' };

  if (toBench) {
    if (!player.active) return { ok: false, code: 'E_ACTIVE', message: '请先放出战生物' };
    if (!Array.isArray(player.bench)) player.bench = [];
    if (player.bench.length >= RULES_META.benchSize) {
      return { ok: false, code: 'E_BENCH_FULL', message: '备战区已满（' + RULES_META.benchSize + '）' };
    }
    // Official TCG: only Basic Pokémon may be placed directly on the bench.
    if ((card.stage || 'basic') !== 'basic') {
      return { ok: false, code: 'E_BENCH_STAGE', message: '只有基础生物可直接放入备战区' };
    }
  } else if (player.active) {
    return { ok: false, code: 'E_ACTIVE', message: '场上已有生物，等它被击倒后再出牌' };
  }

  player.energy -= card.cost;
  player.hand.splice(index, 1);
  const placed = cloneCard(card);
  if (toBench) player.bench.push(placed);
  else player.active = placed;
  const text = player.name + ' 打出「' + card.name + '」（HP ' + card.hp + ' / 攻击 ' + card.attack + '）' +
    (toBench ? '放入备战区。' : '出战。');
  state.log.push({ turn: state.turn, text: text });
  return { ok: true, state: state, card: placed, target: toBench ? 'bench' : 'active', log: [text] };
}

/*
 * 能量附着：把手里的一张能量卡放到出战生物的 energies 数组。
 * C 的 card-battle 契约用 attachEnergy(game, playerIndex, energyCardId, targetCardId)。
 */
export function attachEnergy(state, playerIndex, energyCardId, targetCardId) {
  const err = playerError(state, playerIndex);
  if (err) return err;
  if (state.phase !== 'playing') return { ok: false, code: 'E_PHASE', message: '对局已结束' };
  const player = state.players[playerIndex];
  const card = cardById(energyCardId);
  if (!card || card.category !== 'energy') {
    return { ok: false, code: 'E_CARD', message: '不是能量卡' };
  }
  const index = player.hand.indexOf(energyCardId);
  if (index === -1) return { ok: false, code: 'E_CARD', message: '手牌中没有这张能量卡' };
  if (!player.active) return { ok: false, code: 'E_ACTIVE', message: '没有出战生物' };
  if (targetCardId && player.active.cardId !== targetCardId) {
    return { ok: false, code: 'E_TARGET', message: '目标生物不是出战生物' };
  }

  player.hand.splice(index, 1);
  if (!Array.isArray(player.active.energies)) player.active.energies = [];
  player.active.energies.push(energyCardId);
  player.active.energyCount = player.active.energies.length;
  const text = player.name + ' 给「' + player.active.name + '」附着 1 张能量（共 ' +
    player.active.energyCount + '）。';
  state.log.push({ turn: state.turn, text: text });
  return {
    ok: true,
    state: state,
    energies: player.active.energies.slice(),
    active: player.active,
    log: [text]
  };
}

/*
 * 击倒：把指定玩家的出战生物移入弃牌堆。C 的契约会先 attack 再 knockOut。
 */
export function knockOut(state, target) {
  if (!state) return { ok: false, code: 'E_STATE', message: '状态无效' };
  let playerIndex = 1;
  if (Number.isInteger(target)) playerIndex = target;
  else if (target && Number.isInteger(target.player)) playerIndex = target.player;
  const player = state.players[playerIndex];
  if (!player) return { ok: false, code: 'E_PLAYER', message: '玩家不存在' };
  const knocked = player.active;
  if (knocked) {
    player.discard.push(knocked.cardId);
    player.active = null;
    const promoted = promoteBench(player);
    state.log.push({
      turn: state.turn,
      text: player.name + ' 的「' + knocked.name + '」被击倒。' +
        (promoted ? '「' + promoted.name + '」从备战区补位。' : '')
    });
  }
  return { ok: true, state: state, knockedOut: knocked };
}

/*
 * 结算攻击：本引擎在 attack() 内即时结算；保留接口以兼容分步调用。
 */
export function resolveAttack(state) {
  return { ok: true, state: state };
}

/*
 * 取奖赏卡：从该玩家的 prizes 取 1 张进手牌。
 */
export function takePrize(state, playerIndex) {
  const err = playerError(state, playerIndex);
  if (err) return err;
  const player = state.players[playerIndex];
  if (!Array.isArray(player.prizes) || !player.prizes.length) {
    return { ok: false, code: 'E_NO_PRIZE', message: '没有剩余奖赏卡' };
  }
  const cardId = player.prizes.shift();
  player.hand.push(cardId);
  const text = player.name + ' 取 1 张奖赏卡（剩 ' + player.prizes.length + ' 张）。';
  state.log.push({ turn: state.turn, text: text });
  // Official win condition: take your last prize card.
  if (state.prizeCards > 0 && player.prizes.length === 0 && state.phase === 'playing') {
    state.phase = 'ended';
    state.winner = playerIndex;
    state.log.push({ turn: state.turn, text: player.name + ' 取完 6 张奖赏卡，获胜。' });
  }
  return { ok: true, state: state, cardId: cardId, prizesLeft: player.prizes.length, log: [text] };
}

export const prize = takePrize;
export const drawCard = draw;

export function attack(state, playerIndex) {
  const err = playerError(state, playerIndex);
  if (err) return err;
  if (state.phase !== 'playing') return { ok: false, code: 'E_PHASE', message: '对局已结束' };
  if (playerIndex !== currentIndex(state)) return { ok: false, code: 'E_TURN', message: '还没轮到你' };
  const attacker = state.players[playerIndex];
  const defender = state.players[1 - playerIndex];
  if (!attacker.active) return { ok: false, code: 'E_CARD', message: '场上没有生物' };
  if (attacker.attackedTurn === state.turn) return { ok: false, code: 'E_ATTACKED', message: '本回合已经攻击过' };

  attacker.attackedTurn = state.turn;
  const damage = attacker.active.attack;
  let text;

  if (defender.active) {
    defender.active.hp -= damage;
    text = attacker.name + ' 的「' + attacker.active.name + '」攻击「' + defender.active.name +
      '」，造成 ' + damage + ' 伤害。';
    if (defender.active.hp <= 0) {
      const dead = defender.active;
      defender.discard.push(dead.cardId);
      defender.active = null;
      defender.hp -= 2;
      const promoted = promoteBench(defender);
      text += '「' + dead.name + '」被击倒，突破造成 2 点训练师伤害。' +
        (promoted ? '「' + promoted.name + '」从备战区补位。' : '');
    }
  } else {
    defender.hp -= damage;
    text = attacker.name + ' 的「' + attacker.active.name + '」直接命中训练师，造成 ' + damage + ' 伤害。';
  }

  state.log.push({ turn: state.turn, text: text });
  checkTrainerWin(state);
  return { ok: true, state: state, damage: damage, log: [text] };
}

export function endTurn(state, playerIndex) {
  const err = playerError(state, playerIndex == null ? currentIndex(state) : playerIndex);
  if (err) return err;
  if (state.phase !== 'playing') return { ok: false, code: 'E_PHASE', message: '对局已结束' };
  if (playerIndex != null && playerIndex !== currentIndex(state)) {
    return { ok: false, code: 'E_TURN', message: '还没轮到你' };
  }
  state.turn += 1;
  const next = currentIndex(state);
  const message = beginTurn(state, next);
  return { ok: true, state: state, turn: state.turn, log: [message] };
}

export function restart(state, opts) {
  const options = opts || {};
  const seed = Number.isFinite(options.seed)
    ? options.seed >>> 0
    : ((state && state.rngState ? state.rngState : 1) ^ 0x9e3779b9) >>> 0;
  const names = options.names || (state && state.players
    ? state.players.map(function (player) { return player.name; })
    : undefined);
  return {
    ok: true,
    state: createGame({
      seed: seed,
      deck: options.deck,
      handSize: options.handSize,
      playerHp: options.playerHp,
      names: names
    }),
    log: ['重新开始。']
  };
}

export function summarize(state) {
  return {
    turn: state.turn,
    first: state.first,
    phase: state.phase,
    winner: state.winner,
    current: currentIndex(state),
    players: state.players.map(function (player) {
      return {
        index: player.index,
        name: player.name,
        hp: player.hp,
        energy: player.energy,
        handCount: player.hand.length,
        deckCount: player.deck.length,
        discardCount: player.discard.length,
        prizeCount: player.prizes ? player.prizes.length : 0,
        benchCount: player.bench ? player.bench.length : 0,
        active: player.active ? Object.assign({}, player.active) : null,
        canAttack: Boolean(player.active && player.attackedTurn !== state.turn)
      };
    })
  };
}

export default {
  CARD_POOL: CARD_POOL,
  RULES: RULES,
  createGame: createGame,
  legalActions: legalActions,
  draw: draw,
  drawCard: draw,
  playCard: playCard,
  attachEnergy: attachEnergy,
  attack: attack,
  resolveAttack: resolveAttack,
  knockOut: knockOut,
  takePrize: takePrize,
  prize: takePrize,
  endTurn: endTurn,
  restart: restart,
  summarize: summarize
};
