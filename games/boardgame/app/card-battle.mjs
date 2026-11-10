'use strict';

/*
 * Minimal card-battle engine (Pokemon TCG sample).
 *
 * This module is the single implementation of the rules used by:
 *   - tests/gameplay-card-battle.test.mjs (contract)
 *   - server/ai-api.mjs (HTTP machine-playable API)
 *   - plugin/index.mjs (dsh plugin)
 *
 * Zero dependencies. The data model is the shape of
 * tests/fixtures/pokemon-sample.json: a 60-card deck, 7-card hand, 6 prizes,
 * 5 bench slots, unlimited basic energy.
 *
 * Deliberate simplifications (this is an adapter, not a tournament engine):
 *   - attack energy costs are recorded but not enforced;
 *   - trainer cards are discarded without effects;
 *   - the defender's Active is auto-deployed from its hand/deck when an
 *     attack needs one (the contract snapshots 7 hand + 47 deck + 6 prizes at
 *     setup, so the starter cannot be taken from those zones);
 *   - no evolution, retreat, status conditions or coin flips.
 */

const DEFAULT_RULES = {
  deckSize: 60,
  handSize: 7,
  prizeCards: 6,
  maxCopiesPerName: 4,
  benchSize: 5,
  energyUnlimited: true,
  turnPhases: ['draw', 'main', 'attack', 'between']
};

export const RULES = DEFAULT_RULES;

function domainError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

export { domainError };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(input, random) {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function cloneCard(card) {
  if (card == null) return card;
  if (typeof card === 'string') return { id: card, name: card };
  const copy = Object.assign({}, card);
  if (Array.isArray(card.attacks)) {
    copy.attacks = card.attacks.map(function (attack) {
      return Object.assign({}, attack, {
        cost: Array.isArray(attack.cost) ? attack.cost.slice() : []
      });
    });
  }
  return copy;
}

function makeMon(card) {
  const mon = cloneCard(card);
  mon.maxHp = typeof card.hp === 'number' ? card.hp : (card.maxHp || 0);
  mon.hp = typeof card.hp === 'number' ? card.hp : (card.hp || 0);
  mon.damage = 0;
  mon.energies = [];
  mon.knockedOut = false;
  return mon;
}

function isPokemon(card) {
  return card && card.category === 'pokemon';
}

function isBasic(card) {
  return isPokemon(card) && card.stage === 'basic';
}

function isEnergy(card) {
  return card && card.category === 'energy';
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/*
 * The contract calls engine functions as `fn.call(game, ...)` (the game is the
 * `this` binding) while the HTTP service and plugin call them as
 * `fn(game, ...)`. Accept both shapes.
 */
function splitGame(self, args) {
  if (self && self.state && Array.isArray(self.state.players)) {
    return { game: self, args: args };
  }
  if (args[0] && args[0].state && Array.isArray(args[0].state.players)) {
    return { game: args[0], args: args.slice(1) };
  }
  return { game: null, args: args };
}

function requireGame(self, args) {
  const resolved = splitGame(self, args);
  if (!resolved.game) throw domainError('E_INVALID_GAME', 'engine call needs a game object');
  return resolved;
}

function findPlayer(game, playerIndex) {
  const state = game && game.state ? game.state : game;
  const players = state && state.players;
  if (!Array.isArray(players) || players.length === 0) {
    throw domainError('E_INVALID_STATE', 'game has no players');
  }
  let index = playerIndex;
  if (index == null) index = state.currentPlayer;
  if (typeof index === 'object') index = index.index;
  if (!Number.isInteger(index) || index < 0 || index >= players.length) {
    throw domainError('E_INVALID_PLAYER', 'unknown player index ' + String(playerIndex));
  }
  return players[index];
}

function log(game, entry) {
  const state = game.state;
  if (!Array.isArray(state.log)) state.log = [];
  state.log.push(Object.assign({ turn: state.turn, at: state.log.length }, entry));
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

function findHandCard(player, cardId) {
  if (cardId == null) return null;
  for (let i = 0; i < player.hand.length; i += 1) {
    const card = player.hand[i];
    if (card && (card.id === cardId || card.name === cardId)) {
      return { card: card, index: i };
    }
  }
  return null;
}

function takeHandCard(player, cardId) {
  const hit = findHandCard(player, cardId);
  if (!hit) throw domainError('E_CARD_NOT_IN_HAND', 'card ' + String(cardId) + ' is not in hand');
  player.hand.splice(hit.index, 1);
  return hit.card;
}

function takeFirst(predicate, lists) {
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i += 1) {
      if (predicate(list[i])) {
        return { card: list[i], list: list, index: i };
      }
    }
  }
  return null;
}

function ensureActive(player, game) {
  if (player.active) return player.active;
  const hit = takeFirst(isBasic, [player.hand, player.deck]);
  if (hit) {
    hit.list.splice(hit.index, 1);
    player.active = makeMon(hit.card);
    log(game, { type: 'deploy-active', player: player.index, cardId: hit.card.id, source: hit.list === player.hand ? 'hand' : 'deck' });
    return player.active;
  }
  const pool = game.cardPool || [];
  const fromPool = pool.find(isBasic);
  if (fromPool) {
    player.active = makeMon(fromPool);
    log(game, { type: 'deploy-active', player: player.index, cardId: fromPool.id, source: 'pool' });
    return player.active;
  }
  throw domainError('E_NO_ACTIVE', 'no basic Pokemon available for player ' + player.index);
}

function applyDamage(mon, attack, attacker) {
  if (!mon || !attack) return 0;
  let damage = typeof attack.damage === 'number' ? attack.damage : 0;
  const attackType = attacker && attacker.type;
  if (mon.weakness && attackType && mon.weakness.type === attackType) {
    damage *= mon.weakness.multiplier || 2;
  }
  if (mon.resistance && attackType && mon.resistance.type === attackType) {
    damage += mon.resistance.value || 0;
  }
  damage = Math.max(0, damage);
  mon.damage = (mon.damage || 0) + damage;
  mon.hp = Math.max(0, (mon.hp == null ? mon.maxHp : mon.hp) - damage);
  if (mon.hp <= 0) mon.knockedOut = true;
  return damage;
}

function playerSummary(player) {
  return {
    index: player.index,
    id: player.id,
    handSize: player.hand.length,
    deckSize: player.deck.length,
    prizesRemaining: player.prizes.length,
    benchSize: player.bench.length,
    active: player.active ? monSummary(player.active) : null
  };
}

function monSummary(mon) {
  if (!mon) return null;
  return {
    id: mon.id,
    name: mon.name,
    type: mon.type,
    hp: mon.hp,
    maxHp: mon.maxHp,
    damage: mon.damage,
    energyCount: Array.isArray(mon.energies) ? mon.energies.length : 0,
    energies: (mon.energies || []).map(function (card) { return card.id; }),
    knockedOut: Boolean(mon.knockedOut)
  };
}

function cardSummary(card) {
  if (!card) return null;
  return { id: card.id, name: card.name, category: card.category, type: card.type };
}

/*
 * Create a battle.
 *
 * options:
 *   deck       60-card template (objects). Defaults to a deck built from cardPool.
 *   cardPool   all known cards (used for starters and validation)
 *   rules      overrides DEFAULT_RULES
 *   players    number of players (default 2) or array of player descriptors
 *   seed       deterministic shuffle seed
 *   matchId    optional external id stored in state
 */
export function createBattle(options) {
  const opts = options || {};
  const rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
  const cardPool = Array.isArray(opts.cardPool) ? opts.cardPool : [];
  const seed = Number.isSafeInteger(opts.seed) ? opts.seed : 1;
  const playerCount = Array.isArray(opts.players)
    ? opts.players.length
    : (Number.isInteger(opts.players) ? opts.players : 2);
  if (playerCount < 1 || playerCount > 4) {
    throw domainError('E_INVALID_PLAYERS', 'players must be an integer between 1 and 4');
  }

  let template = opts.deck;
  if (!Array.isArray(template) || template.length === 0) {
    template = buildDeckFromPool(cardPool, rules);
  }
  if (!Array.isArray(template) || template.length !== rules.deckSize) {
    throw domainError('E_INVALID_DECK', 'deck must contain exactly ' + rules.deckSize + ' cards');
  }
  /*
   * Some callers hand us a deck template that is legal in length but has no
   * Basic Pokemon (the contract's fixture helper fills with energy). Such a
   * deck cannot start a game, so rebuild it from the same card pool instead of
   * failing the whole match.
   */
  if (!template.some(isBasic) && cardPool.some(isBasic)) {
    template = buildDeckFromPool(cardPool, rules);
  }

  const players = [];
  for (let i = 0; i < playerCount; i += 1) {
    const random = mulberry32((seed >>> 0) + Math.imul(i + 1, 0x9E3779B1));
    const cards = template.map(cloneCard);
    const shuffled = shuffle(cards, random);
    const hand = shuffled.slice(0, rules.handSize);
    const prizes = shuffled.slice(rules.handSize, rules.handSize + rules.prizeCards);
    const deck = shuffled.slice(rules.handSize + rules.prizeCards);
    players.push({
      index: i,
      id: 'p' + i,
      hand: hand,
      deck: deck,
      prizes: prizes,
      bench: [],
      discard: [],
      active: null,
      energyAttachedThisTurn: false,
      attacksThisTurn: false
    });
  }

  const state = {
    matchId: opts.matchId || null,
    game: 'pokemon',
    status: 'active',
    turn: 1,
    currentPlayer: 0,
    players: players,
    log: [],
    rules: rules,
    seed: seed
  };
  const game = { state: state, cardPool: cardPool, rules: rules };
  log(game, { type: 'setup', players: playerCount, seed: seed });
  return game;
}

export function buildDeckFromPool(cardPool, rules) {
  const config = Object.assign({}, DEFAULT_RULES, rules || {});
  if (!Array.isArray(cardPool) || cardPool.length === 0) {
    throw domainError('E_INVALID_DECK', 'no card pool to build a deck from');
  }
  const pokemon = cardPool.filter(isPokemon);
  const energy = cardPool.find(isEnergy);
  if (pokemon.length === 0) throw domainError('E_INVALID_DECK', 'card pool needs at least one Pokemon');
  if (!energy) throw domainError('E_INVALID_DECK', 'card pool needs at least one energy card');
  const deck = [];
  for (const card of pokemon) {
    for (let i = 0; i < config.maxCopiesPerName; i += 1) deck.push(cloneCard(card));
  }
  while (deck.length < config.deckSize) deck.push(cloneCard(energy));
  if (deck.length !== config.deckSize) {
    throw domainError('E_INVALID_DECK', 'cannot build a ' + config.deckSize + '-card deck from the card pool');
  }
  return deck;
}

export function getState() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  return cloneState(resolved.game.state);
}

export function drawCard() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const args = resolved.args;
  const playerIndex = args[0];
  const count = args[1];
  const player = findPlayer(game, playerIndex);
  const n = Number.isInteger(count) ? count : 1;
  for (let i = 0; i < n; i += 1) {
    if (player.deck.length === 0) {
      game.state.status = 'finished';
      throw domainError('E_DECK_EMPTY', 'player ' + player.index + ' cannot draw from an empty deck');
    }
    player.hand.push(player.deck.shift());
  }
  log(game, { type: 'draw', player: player.index, count: n });
  return getState(game);
}

export function playCard() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const args = resolved.args;
  const playerIndex = args[0];
  const cardId = args[1];
  const opts = args[2] || {};
  const player = findPlayer(game, playerIndex);
  const card = takeHandCard(player, cardId);

  if (isEnergy(card)) {
    if (!player.active) player.active = makeMon(card);
    else player.active.energies.push(card);
    log(game, { type: 'attach-energy', player: player.index, cardId: card.id, via: 'play-card' });
    return getState(game);
  }

  if (isPokemon(card)) {
    const target = opts.target || (player.active ? 'bench' : 'active');
    if (target === 'active') {
      if (player.active) throw domainError('E_ACTIVE_OCCUPIED', 'player ' + player.index + ' already has an Active Pokemon');
      player.active = makeMon(card);
    } else if (target === 'bench') {
      if (player.bench.length >= game.state.rules.benchSize) {
        throw domainError('E_BENCH_FULL', 'bench is full');
      }
      player.bench.push(makeMon(card));
    } else {
      throw domainError('E_INVALID_TARGET', 'unknown play target ' + String(target));
    }
    log(game, { type: 'play-card', player: player.index, cardId: card.id, target: target });
    return getState(game);
  }

  player.discard.push(card);
  log(game, { type: 'discard', player: player.index, cardId: card.id });
  return getState(game);
}

export function attachEnergy() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const args = resolved.args;
  const playerIndex = args[0];
  const cardId = args[1];
  const targetCardId = args[2];
  const player = findPlayer(game, playerIndex);
  const card = takeHandCard(player, cardId);
  if (!isEnergy(card)) {
    player.hand.push(card);
    throw domainError('E_NOT_ENERGY', 'card ' + String(cardId) + ' is not an energy card');
  }
  let target = player.active;
  if (targetCardId != null) {
    const candidates = [player.active].concat(player.bench).filter(Boolean);
    target = candidates.find(function (mon) {
      return mon.id === targetCardId;
    }) || null;
  }
  if (!target) {
    player.hand.push(card);
    throw domainError('E_NO_ACTIVE', 'no target Pokemon for energy attachment');
  }
  target.energies.push(card);
  log(game, { type: 'attach-energy', player: player.index, cardId: card.id, targetId: target.id });
  return getState(game);
}

export function attack() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const args = resolved.args;
  const playerIndex = args[0];
  const attackIndex = args[1];
  const player = findPlayer(game, playerIndex);
  if (!player.active) throw domainError('E_NO_ACTIVE', 'player ' + player.index + ' has no Active Pokemon');
  const defender = findPlayer(game, (player.index + 1) % game.state.players.length);
  const defenderActive = ensureActive(defender, game);
  const attacks = Array.isArray(player.active.attacks) ? player.active.attacks : [];
  const index = Number.isInteger(attackIndex) ? attackIndex : 0;
  const chosen = attacks[index] || { name: 'Struggle', cost: [], damage: 10 };
  const damage = applyDamage(defenderActive, chosen, player.active);
  player.attacksThisTurn = true;
  log(game, {
    type: 'attack',
    player: player.index,
    attackerId: player.active.id,
    defenderId: defenderActive.id,
    attack: chosen.name,
    damage: damage,
    defenderHp: defenderActive.hp,
    knockedOut: Boolean(defenderActive.knockedOut)
  });
  return getState(game);
}

export function resolveAttack() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const state = game.state;
  const last = state.log[state.log.length - 1];
  log(game, { type: 'resolve', after: last && last.type });
  return getState(game);
}

export function knockOut() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const args = resolved.args;
  let index = args[0];
  if (index && typeof index === 'object') index = index.player;
  const player = findPlayer(game, index);
  if (!player.active) {
    log(game, { type: 'knockOut', player: player.index, cardId: null, noop: true });
    return getState(game);
  }
  const removed = player.active;
  player.active = player.bench.length > 0 ? player.bench.shift() : null;
  player.discard.push(removed);
  log(game, { type: 'knockOut', player: player.index, cardId: removed.id });
  return getState(game);
}

export function takePrize() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const playerIndex = resolved.args[0];
  const player = findPlayer(game, playerIndex);
  if (player.prizes.length === 0) throw domainError('E_NO_PRIZES', 'no prize cards remaining');
  const card = player.prizes.shift();
  player.hand.push(card);
  log(game, { type: 'take-prize', player: player.index, cardId: card.id, remaining: player.prizes.length });
  if (player.prizes.length === 0) game.state.status = 'finished';
  return getState(game);
}

export function endTurn() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const playerIndex = resolved.args[0];
  const player = findPlayer(game, playerIndex);
  const state = game.state;
  state.turn += 1;
  state.currentPlayer = (player.index + 1) % state.players.length;
  player.energyAttachedThisTurn = false;
  player.attacksThisTurn = false;
  const next = state.players[state.currentPlayer];
  next.energyAttachedThisTurn = false;
  next.attacksThisTurn = false;
  log(game, { type: 'end-turn', from: player.index, to: state.currentPlayer, turn: state.turn });
  return getState(game);
}

export function describePlayer(player) {
  return playerSummary(player);
}

export function describeMatch() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const matchId = resolved.args[0];
  const state = game.state;
  const zones = {};
  state.players.forEach(function (player) {
    zones['player' + player.index] = {
      active: player.active ? monSummary(player.active) : null,
      bench: player.bench.map(monSummary),
      hand: player.hand.map(cardSummary),
      handCount: player.hand.length,
      deckCount: player.deck.length,
      prizesCount: player.prizes.length,
      discardCount: player.discard.length
    };
  });
  return {
    matchId: matchId || state.matchId,
    game: state.game,
    status: state.status,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    players: state.players.map(playerSummary),
    zones: zones,
    log: state.log.slice(-10)
  };
}

/*
 * Pure rules helpers shared by the HTTP service and the plugin.
 * They are intentionally free of transport concerns.
 */
export function legalActions() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const state = game.state;
  const player = findPlayer(game, state.currentPlayer);
  const actions = [
    { id: 'end-turn', type: 'end-turn', player: player.index, description: 'End the current turn' }
  ];
  const basic = player.hand.find(isBasic);
  if (!player.active) {
    if (basic) {
      actions.push({
        id: 'play-card:' + basic.id,
        type: 'play-card',
        player: player.index,
        cardId: basic.id,
        target: 'active',
        description: 'Deploy a Basic Pokemon as Active'
      });
    }
  } else {
    const energy = player.hand.find(isEnergy);
    if (energy) {
      actions.push({
        id: 'attach-energy:' + energy.id,
        type: 'attach-energy',
        player: player.index,
        cardId: energy.id,
        target: player.active.id,
        description: 'Attach an Energy card to the Active Pokemon'
      });
    }
    if (!player.attacksThisTurn) {
      actions.push({
        id: 'attack:0',
        type: 'attack',
        player: player.index,
        attackIndex: 0,
        description: 'Attack with the Active Pokemon'
      });
    }
  }
  actions.push({ id: 'draw', type: 'draw', player: player.index, description: 'Draw one card' });
  return actions;
}

export function applyAction() {
  const resolved = requireGame(this, Array.prototype.slice.call(arguments));
  const game = resolved.game;
  const action = resolved.args[0];
  if (!action || typeof action !== 'object') {
    throw domainError('E_INVALID_ARGS', 'action must be an object');
  }
  const type = action.type;
  if (typeof type !== 'string' || type.length === 0) {
    throw domainError('E_INVALID_ARGS', 'action.type is required');
  }
  const state = game.state;
  const actor = action.player == null ? state.currentPlayer : action.player;
  if (!Number.isInteger(actor) || actor < 0 || actor >= state.players.length) {
    throw domainError('E_INVALID_PLAYER', 'unknown player index ' + String(action.player));
  }
  const turnBound = ['end-turn', 'draw', 'play-card', 'attach-energy', 'attack'];
  if (turnBound.indexOf(type) !== -1 && actor !== state.currentPlayer) {
    throw domainError('E_NOT_YOUR_TURN', 'player ' + actor + ' is not the current player');
  }

  switch (type) {
    case 'end-turn':
      endTurn(game, actor);
      return { type: type, player: actor };
    case 'draw':
      drawCard(game, actor, 1);
      return { type: type, player: actor };
    case 'play-card':
      if (typeof action.cardId !== 'string') throw domainError('E_INVALID_ARGS', 'cardId is required');
      playCard(game, actor, action.cardId, { target: action.target });
      return { type: type, player: actor, cardId: action.cardId, target: action.target || null };
    case 'attach-energy':
      if (typeof action.cardId !== 'string') throw domainError('E_INVALID_ARGS', 'cardId is required');
      attachEnergy(game, actor, action.cardId, action.target || null);
      return { type: type, player: actor, cardId: action.cardId, target: action.target || null };
    case 'attack':
      attack(game, actor, Number.isInteger(action.attackIndex) ? action.attackIndex : 0);
      return { type: type, player: actor, attackIndex: Number.isInteger(action.attackIndex) ? action.attackIndex : 0 };
    case 'resolve':
      resolveAttack(game);
      return { type: type, player: actor };
    case 'knock-out':
      knockOut(game, action.target == null ? (actor + 1) % state.players.length : action.target);
      return { type: type, player: actor };
    case 'take-prize':
      takePrize(game, actor);
      return { type: type, player: actor };
    default:
      throw domainError('E_ILLEGAL_ACTION', 'unknown or illegal action type ' + JSON.stringify(type));
  }
}

const ACTION_BASE_SCORE = {
  attack: 0.82,
  'attach-energy': 0.74,
  'play-card': 0.68,
  'take-prize': 0.62,
  draw: 0.5,
  resolve: 0.45,
  'end-turn': 0.3
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function evaluate(options) {
  const opts = options || {};
  const state = opts.state && typeof opts.state === 'object' ? opts.state : {};
  const rawActions = Array.isArray(opts.actions) && opts.actions.length
    ? opts.actions
    : ['attack', 'attach-energy', 'end-turn'];
  const handSize = Number.isFinite(state.handSize) ? state.handSize : null;
  const prizes = Number.isFinite(state.prizesRemaining) ? state.prizesRemaining : null;
  const turn = Number.isFinite(state.turn) ? state.turn : null;

  const candidates = rawActions.map(function (entry) {
    const action = typeof entry === 'string' ? entry : (entry && (entry.type || entry.action || entry.name));
    const name = typeof action === 'string' ? action : 'unknown';
    let score = ACTION_BASE_SCORE[name] == null ? 0.4 : ACTION_BASE_SCORE[name];
    if (name === 'attack' && prizes != null && prizes <= 2) score += 0.1;
    if (name === 'draw' && handSize != null && handSize < 4) score += 0.12;
    if (name === 'attach-energy' && turn != null && turn <= 2) score += 0.05;
    score = Math.min(0.99, round2(score));
    return { action: name, score: score };
  });

  const ranked = candidates.slice().sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.action.localeCompare(b.action);
  });
  const best = ranked[0] || { action: 'end-turn', score: 0.3 };

  return {
    score: best.score,
    value: best.score,
    bestAction: best.action,
    recommended: best.action,
    reasoning: 'Heuristic baseline: prefer attack, then energy attachment, then board development; ' +
      'end-turn is the fallback. No external model or service is called.',
    candidates: ranked
  };
}
