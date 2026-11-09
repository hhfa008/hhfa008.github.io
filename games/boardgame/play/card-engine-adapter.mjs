'use strict';

/*
 * Compatibility adapter: presents the playable card-battle UI with the small
 * API surface it expects, while every rule decision stays in ../app/cardgame.js
 * (the single engine used by the HTTP/AI contracts).
 *
 * No rule is reimplemented here: createBattle -> createGame, every action
 * delegates to the engine and only translates its incremental state into the
 * card-object shape the UI renders. The typed UI log is presentation only.
 */

import {
  createGame,
  draw,
  playCard as enginePlayCard,
  attachEnergy as engineAttachEnergy,
  attack as engineAttack,
  resolveAttack as engineResolveAttack,
  knockOut as engineKnockOut,
  takePrize as engineTakePrize,
  endTurn as engineEndTurn,
  summarize,
  cardById,
  CARD_POOL
} from '../app/cardgame.js';
import { buildSampleDeck, SAMPLE_RULES } from './cards.mjs';

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  throw err;
}

function viewCard(cardId) {
  const card = cardById(cardId);
  if (!card) {
    return {
      id: cardId,
      name: String(cardId),
      type: 'normal',
      category: 'pokemon',
      stage: 'basic',
      hp: 0,
      attack: 0,
      cost: 0
    };
  }
  return {
    id: card.id,
    cardId: card.id,
    name: card.name,
    type: card.type,
    category: card.category,
    stage: card.stage,
    hp: card.hp,
    maxHp: card.hp,
    attack: card.attack,
    cost: card.cost,
    color: card.color
  };
}

function viewActive(active) {
  if (!active) return null;
  const base = viewCard(active.cardId);
  return Object.assign({}, base, {
    id: active.cardId,
    cardId: active.cardId,
    hp: active.hp,
    maxHp: active.maxHp == null ? base.maxHp : active.maxHp,
    attack: active.attack,
    cost: active.cost,
    energies: Array.isArray(active.energies) ? active.energies.slice() : [],
    energyCount: Array.isArray(active.energies) ? active.energies.length : 0,
    // 旧 UI 用 attacks 数组渲染招式按钮；主线引擎只有一个普通攻击。
    attacks: [{ name: '普通攻击', cost: [], damage: active.attack || 0 }],
    knockedOut: active.hp <= 0
  });
}

function viewPlayer(player) {
  return {
    index: player.index,
    name: player.name,
    hp: player.hp,
    energy: player.energy,
    hand: player.hand.map(viewCard),
    deck: player.deck.slice(),
    discard: player.discard.slice(),
    prizes: (player.prizes || []).slice(),
    bench: Array.isArray(player.bench) ? player.bench.slice() : [],
    active: viewActive(player.active)
  };
}

function currentOf(state) {
  return summarize(state).current;
}

/*
 * The UI was written against an engine that throws on illegal actions. Keep
 * that contract by turning { ok:false } results into thrown errors.
 */
function unwrap(result) {
  if (!result || result.ok !== false) return result;
  fail(result.code || 'E_ACTION', result.message);
}

function pushLog(game, entry) {
  game.log.push(entry);
  if (game.log.length > 200) game.log.splice(0, game.log.length - 200);
}

export function createBattle(options) {
  const opts = options || {};
  const deck = Array.isArray(opts.deck) && opts.deck.length ? opts.deck.slice() : buildSampleDeck();
  const state = createGame({
    seed: opts.seed,
    deck: deck,
    // 主线引擎在首回合开始时会自动摸 1 张；这里按「起手 7 张」的页面口径回调 1。
    handSize: Math.max(1, (opts.handSize == null ? SAMPLE_RULES.handSize : opts.handSize) - 1),
    prizeCards: opts.prizeCards == null ? SAMPLE_RULES.prizeCards : opts.prizeCards,
    playerHp: opts.playerHp,
    // 旧 UI 以玩家 0 为固定先手/视角；显式固定先手，重置后也保持 7 张起手。
    first: opts.first == null ? 0 : opts.first,
    names: opts.names
  });
  const game = { state: state, log: [] };
  pushLog(game, { type: 'setup', player: 0 });
  return game;
}

export const createGameForUi = createBattle;

export function getState(game) {
  if (!game || !game.state) return null;
  const state = game.state;
  return {
    status: state.phase === 'playing' ? 'active' : 'finished',
    currentPlayer: currentOf(state),
    turn: state.turn,
    winner: state.winner,
    players: state.players.map(viewPlayer),
    log: game.log.slice()
  };
}

export const snapshot = getState;

export function drawCard(game, playerIndex) {
  const result = unwrap(draw(game.state, playerIndex, 1));
  pushLog(game, {
    type: 'draw',
    player: playerIndex,
    count: result.cards ? result.cards.length : 0
  });
  return result;
}

export function playCard(game, playerIndex, cardId, options) {
  const opts = options || {};
  if (opts.target === 'bench') {
    fail('E_BENCH', '主线引擎只支持出战区，暂不支持备战区');
  }
  const result = unwrap(enginePlayCard(game.state, playerIndex, cardId));
  pushLog(game, { type: 'play-card', player: playerIndex, cardId: cardId, target: 'active' });
  return result;
}

export function attachEnergy(game, playerIndex, energyCardId, targetCardId) {
  const result = unwrap(engineAttachEnergy(game.state, playerIndex, energyCardId, targetCardId));
  pushLog(game, {
    type: 'attach-energy',
    player: playerIndex,
    cardId: energyCardId,
    targetId: targetCardId
  });
  return result;
}

export function attack(game, playerIndex, moveIndex) {
  if (moveIndex != null && moveIndex !== 0) {
    fail('E_MOVE', '主线引擎只有普通攻击');
  }
  const state = game.state;
  const attacker = state.players[playerIndex];
  const defender = state.players[1 - playerIndex];
  const hadDefender = Boolean(defender.active);
  const result = unwrap(engineAttack(state, playerIndex));
  const knockedOut = hadDefender && !defender.active;
  pushLog(game, {
    type: 'attack',
    player: playerIndex,
    attackerId: attacker.active ? attacker.active.cardId : null,
    attack: '普通攻击',
    damage: result.damage,
    knockedOut: knockedOut
  });
  if (knockedOut) {
    pushLog(game, {
      type: 'knockOut',
      player: 1 - playerIndex,
      cardId: defender.discard[defender.discard.length - 1]
    });
    if (attacker && Array.isArray(attacker.prizes) && attacker.prizes.length) {
      const prize = engineTakePrize(state, playerIndex);
      if (prize && prize.ok) {
        pushLog(game, { type: 'take-prize', player: playerIndex, remaining: prize.prizesLeft });
      }
    }
  }
  return result;
}

export function resolveAttack(game) {
  return engineResolveAttack(game.state);
}

export function knockOut(game, target) {
  const result = unwrap(engineKnockOut(game.state, target));
  if (result.knockedOut) {
    pushLog(game, { type: 'knockOut', player: target, cardId: result.knockedOut.cardId });
  }
  return result;
}

export function takePrize(game, playerIndex) {
  const result = unwrap(engineTakePrize(game.state, playerIndex));
  pushLog(game, { type: 'take-prize', player: playerIndex, remaining: result.prizesLeft });
  return result;
}

export function endTurn(game, playerIndex) {
  const result = unwrap(engineEndTurn(game.state, playerIndex));
  pushLog(game, {
    type: 'end-turn',
    player: playerIndex,
    to: currentOf(game.state),
    turn: game.state.turn
  });
  return result;
}

export { CARD_POOL };
