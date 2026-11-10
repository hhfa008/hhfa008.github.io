'use strict';

/*
 * Pokemon adapter shared by the HTTP service and the dsh plugin.
 *
 * It wires the card-battle engine to the sample fixture and exposes a small,
 * transport-neutral API:
 *
 *   loadPokemonFixture()
 *   createPokemonMatch({ players, seed, matchId, deck })
 *   legalActions(game)
 *   applyAction(game, action)
 *   evaluate({ game, state, actions })
 *   describeMatch(game, matchId)
 *
 * The fixture (tests/fixtures/pokemon-sample.json) is input data, not test
 * code: it defines the card pool and rules the contract says the engine eats.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as engine from './card-battle.mjs';

const FIXTURE_PATH = fileURLToPath(new URL('../tests/fixtures/pokemon-sample.json', import.meta.url));

export const SUPPORTED_GAMES = ['pokemon'];
export const GAME_DEFAULT = 'pokemon';

let cachedFixture = null;

export function loadPokemonFixture() {
  if (cachedFixture) return cachedFixture;
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const fixture = JSON.parse(raw);
  if (!fixture || !Array.isArray(fixture.cards) || !fixture.rules) {
    throw new Error('pokemon fixture is malformed: expected cards[] and rules');
  }
  cachedFixture = fixture;
  return cachedFixture;
}

export function isSupportedGame(game) {
  return game == null || SUPPORTED_GAMES.indexOf(game) !== -1;
}

export function buildSampleDeck(fixture) {
  const source = fixture || loadPokemonFixture();
  return engine.buildDeckFromPool(source.cards, source.rules);
}

export function createPokemonMatch(options) {
  const opts = options || {};
  const fixture = loadPokemonFixture();
  const deck = Array.isArray(opts.deck) ? opts.deck : buildSampleDeck(fixture);
  return engine.createBattle({
    deck: deck,
    cardPool: fixture.cards,
    rules: fixture.rules,
    players: Number.isInteger(opts.players) ? opts.players : 2,
    seed: Number.isSafeInteger(opts.seed) ? opts.seed : 20261110,
    matchId: opts.matchId || null
  });
}

export function legalActions(game) {
  return engine.legalActions(game);
}

export function applyAction(game, action) {
  return engine.applyAction(game, action);
}

export function evaluate(options) {
  const opts = options || {};
  let state = opts.state;
  if (!state && opts.game && opts.game.state) state = opts.game.state;
  return engine.evaluate({ state: state, actions: opts.actions });
}

export function describeMatch(game, matchId) {
  return engine.describeMatch(game, matchId);
}

export function snapshot(game) {
  return engine.getState(game);
}

export { engine };
