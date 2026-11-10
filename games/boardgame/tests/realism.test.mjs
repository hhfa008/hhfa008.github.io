'use strict';

/*
 * Realism gate for the two playable boardgame pages.
 *
 * Reads games/boardgame/realism/*.json and cross-checks the declared physical
 * numbers against:
 *   - app/cardgame.js RULES_META and app/mahjong.js
 *   - play/cards.mjs SAMPLE_RULES (the 60-card demo deck)
 *   - tests/fixtures/pokemon-sample.json (the in-repo official-TCG contract)
 *
 * A missing field or a mismatch is a hard failure; nothing here is generated.
 *
 *   node games/boardgame/tests/realism.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';
import { RULES_META, createGame, playCard, knockOut, CARD_MAP } from '../app/cardgame.js';
import { SAMPLE_RULES, buildSampleDeck } from '../play/cards.mjs';
import {
  TILE_KINDS,
  buildWall,
  createGame as createMahjongGame
} from '../app/mahjong.js';

const s = createSuite('boardgame-realism');
const REALM = path.join(ROOT, 'realism');

function readJson(name) {
  const file = path.join(REALM, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    s.ok(name + ' loads', false, err.message);
    return null;
  }
}

function requireKeys(label, obj, keys) {
  if (!obj || typeof obj !== 'object') return s.ok(label + ' object', false, 'missing object');
  keys.forEach(function (key) {
    s.ok(label + ' has ' + key, Object.prototype.hasOwnProperty.call(obj, key),
      'missing field ' + key);
  });
}

function crossCheck(label, declared, engine, fixture, engineName, fixtureName) {
  s.eq(label + ' = ' + engineName, declared, engine);
  if (fixture !== undefined) s.eq(label + ' = ' + fixtureName, declared, fixture);
}

/* ------------------------------------------------------------------ card */

const card = readJson('card-battle.json');
if (card) {
  ['game', 'version', 'sources', 'rules', 'evidence', 'materials', 'colors', 'deviations']
    .forEach(function (key) {
      s.ok('card-battle has ' + key, Object.prototype.hasOwnProperty.call(card, key),
        'missing top-level ' + key);
    });
  requireKeys('card-battle.rules', card.rules, [
    'deckCount', 'openingHand', 'prizeCards', 'benchSize', 'maxCopiesPerName',
    'basicEnergyUnlimited', 'playerCount', 'winCondition'
  ]);
  requireKeys('card-battle.materials', card.materials, ['card', 'cardBack']);
  requireKeys('card-battle.materials.card', card.materials && card.materials.card,
    ['sizeMm', 'stockGsm', 'finish', 'source']);
  requireKeys('card-battle.colors', card.colors, ['palette', 'typeColors']);

  // Every evidence entry must point at a declared source.
  Object.keys(card.evidence || {}).forEach(function (key) {
    const entry = card.evidence[key];
    s.ok('card-battle.evidence.' + key + ' has basis', Boolean(entry && entry.basis),
      'missing basis');
    s.ok('card-battle.evidence.' + key + ' source declared', Boolean(
      entry && card.sources && card.sources[entry.source]
    ), 'unknown source ' + (entry && entry.source));
  });

  const fixture = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'tests', 'fixtures', 'pokemon-sample.json'), 'utf8'));

  crossCheck('deckCount', card.rules.deckCount, RULES_META.deckSize, fixture.rules.deckSize,
    'app RULES_META.deckSize', 'fixture.rules.deckSize');
  crossCheck('openingHand', card.rules.openingHand, RULES_META.openingHand, fixture.rules.handSize,
    'app RULES_META.openingHand', 'fixture.rules.handSize');
  crossCheck('prizeCards', card.rules.prizeCards, RULES_META.prizeCards, fixture.rules.prizeCards,
    'app RULES_META.prizeCards', 'fixture.rules.prizeCards');
  crossCheck('benchSize', card.rules.benchSize, RULES_META.benchSize, fixture.rules.benchSize,
    'app RULES_META.benchSize', 'fixture.rules.benchSize');
  crossCheck('maxCopiesPerName', card.rules.maxCopiesPerName, RULES_META.maxCopiesPerName,
    fixture.rules.maxCopiesPerName, 'app RULES_META.maxCopiesPerName',
    'fixture.rules.maxCopiesPerName');
  s.eq('card rules.deckCount = play SAMPLE_RULES.deckSize', card.rules.deckCount,
    SAMPLE_RULES.deckSize);
  s.eq('card rules.openingHand = play SAMPLE_RULES.handSize', card.rules.openingHand,
    SAMPLE_RULES.handSize);
  s.eq('card rules.prizeCards = play SAMPLE_RULES.prizeCards', card.rules.prizeCards,
    SAMPLE_RULES.prizeCards);
  s.eq('card rules.benchSize = play SAMPLE_RULES.benchSize', card.rules.benchSize,
    SAMPLE_RULES.benchSize);

  // Physical card stock from ART-GUIDE.
  s.eq('card size 63x88mm', card.materials.card.sizeMm, [63, 88]);
  s.eq('card stock 300gsm', card.materials.card.stockGsm, 300);

  // The demo deck must actually contain 60 legal cards with <= 4 copies/name,
  // and 20 basic Energy (40 creatures + 20 energy).
  const deck = buildSampleDeck();
  s.eq('buildSampleDeck length 60', deck.length, 60);
  s.ok('buildSampleDeck cards all known', deck.every(function (id) {
    return Boolean(CARD_MAP[id]);
  }), 'deck contains an unknown card id');
  const counts = new Map();
  deck.forEach(function (id) { counts.set(id, (counts.get(id) || 0) + 1); });
  let overCopies = 0;
  counts.forEach(function (n, id) {
    // Basic Energy is exempt from the 4-copy rule.
    if (CARD_MAP[id] && CARD_MAP[id].category === 'energy') return;
    if (n > card.rules.maxCopiesPerName) overCopies += 1;
  });
  s.eq('buildSampleDeck respects max 4 copies', overCopies, 0);
  const energyCount = deck.filter(function (id) { return id === 'en-001'; }).length;
  s.eq('buildSampleDeck has 20 basic Energy', energyCount, 20);
  s.eq('buildSampleDeck has 40 creatures', deck.length - energyCount, 40);

  // Live engine: 60 cards per player, 6 prizes, 5 bench slots, auto-promotion.
  const live = createGame({
    seed: 20261110,
    deck: deck,
    handSize: card.rules.openingHand,
    prizeCards: card.rules.prizeCards,
    first: 0
  });
  live.players.forEach(function (player, index) {
    const total = player.hand.length + player.deck.length + player.prizes.length +
      player.discard.length + (player.active ? 1 : 0) + player.bench.length;
    s.eq('player ' + index + ' owns 60 cards', total, card.rules.deckCount);
    s.eq('player ' + index + ' has 6 prizes', player.prizes.length, card.rules.prizeCards);
  });

  const benchGame = createGame({
    seed: 7,
    deck: Array(60).fill('c1'),
    handSize: 10,
    prizeCards: card.rules.prizeCards,
    first: 0
  });
  benchGame.players[0].energy = 99;
  s.ok('active play succeeds', playCard(benchGame, 0, 'c1').ok);
  for (let i = 0; i < card.rules.benchSize; i += 1) {
    const placed = playCard(benchGame, 0, 'c1', { target: 'bench' });
    s.ok('bench slot ' + (i + 1) + ' accepts a Basic', placed.ok, placed.message);
  }
  const overflow = playCard(benchGame, 0, 'c1', { target: 'bench' });
  s.eq('6th bench play rejected', overflow.code, 'E_BENCH_FULL');
  s.eq('bench count capped at 5', benchGame.players[0].bench.length, card.rules.benchSize);

  const promoted = knockOut(benchGame, 0);
  s.ok('knockOut reports the KO', promoted.ok);
  s.ok('bench promotes after KO', Boolean(benchGame.players[0].active),
    'active slot stayed empty');
  s.eq('bench shrinks after promotion', benchGame.players[0].bench.length,
    card.rules.benchSize - 1);
}

/* --------------------------------------------------------------- mahjong */

const mahjong = readJson('mahjong.json');
if (mahjong) {
  ['game', 'version', 'sources', 'rules', 'evidence', 'materials', 'colors', 'deviations']
    .forEach(function (key) {
      s.ok('mahjong has ' + key, Object.prototype.hasOwnProperty.call(mahjong, key),
        'missing top-level ' + key);
    });
  requireKeys('mahjong.rules', mahjong.rules, [
    'tileCount', 'kindCount', 'copiesPerKind', 'suits', 'players',
    'handSize', 'dealerHandSize', 'wallAfterDeal', 'winCondition'
  ]);
  requireKeys('mahjong.rules.suits', mahjong.rules && mahjong.rules.suits,
    ['man', 'pin', 'sou', 'honors']);
  requireKeys('mahjong.materials', mahjong.materials, ['tile', 'table']);
  requireKeys('mahjong.materials.tile', mahjong.materials && mahjong.materials.tile,
    ['sizeMm', 'material', 'source']);
  requireKeys('mahjong.colors', mahjong.colors,
    ['palette', 'tileFace', 'pinPips', 'souPips', 'whiteDragonBorder']);

  Object.keys(mahjong.evidence || {}).forEach(function (key) {
    const entry = mahjong.evidence[key];
    s.ok('mahjong.evidence.' + key + ' has basis', Boolean(entry && entry.basis),
      'missing basis');
    s.ok('mahjong.evidence.' + key + ' source declared', Boolean(
      entry && mahjong.sources && mahjong.sources[entry.source]
    ), 'unknown source ' + (entry && entry.source));
  });

  const kinds = TILE_KINDS.length;
  const wall = buildWall(20261110);
  s.eq('TILE_KINDS count = 34', kinds, mahjong.rules.kindCount);
  s.eq('buildWall length = 136', wall.length, mahjong.rules.tileCount);
  s.eq('136 = 34 kinds x 4 copies', kinds * mahjong.rules.copiesPerKind,
    mahjong.rules.tileCount);

  const perKind = new Map();
  wall.forEach(function (tile) { perKind.set(tile, (perKind.get(tile) || 0) + 1); });
  s.eq('every tile kind has 4 copies', perKind.size, mahjong.rules.kindCount);
  s.ok('no tile kind has != 4 copies', Array.from(perKind.values())
    .every(function (n) { return n === mahjong.rules.copiesPerKind; }));

  const suits = mahjong.rules.suits;
  const suited = (suits.man + suits.pin + suits.sou) * mahjong.rules.copiesPerKind;
  const honors = suits.honors * mahjong.rules.copiesPerKind;
  s.eq('suited tiles = 108', suited, 108);
  s.eq('honor tiles = 28', honors, 28);
  s.eq('suited + honors = 136', suited + honors, mahjong.rules.tileCount);

  const live = createMahjongGame({ seed: 20261110 });
  s.eq('mahjong creates 4 hands', live.hands.length, mahjong.rules.players);
  s.eq('dealer hand = 14', live.hands[live.dealer].length, mahjong.rules.dealerHandSize);
  live.hands.forEach(function (hand, index) {
    if (index === live.dealer) return;
    s.eq('non-dealer hand ' + index + ' = 13', hand.length, mahjong.rules.handSize);
  });
  s.eq('wallIndex after deal = 53', live.wallIndex, 53);
  s.eq('wall after deal = 83', live.wall.length - live.wallIndex, mahjong.rules.wallAfterDeal);
  s.eq('wallAfterDeal matches 136-53', mahjong.rules.wallAfterDeal,
    mahjong.rules.tileCount - live.wallIndex);

  // Physical tile from ART-GUIDE: 26 x 19 x 16 mm.
  s.eq('mahjong tile 26x19x16mm', mahjong.materials.tile.sizeMm, [26, 19, 16]);
  s.eq('pin pips use three ink colors', mahjong.colors.pinPips.length, 3);
}

s.finish();
