'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES_DIR } from './probe.mjs';

export function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(input, random) {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/*
 * Expand the 13-card sample fixture into a legal 60-card deck:
 *   - up to `maxCopies` copies of every Pokémon card
 *   - the remainder filled with basic energy (unlimited copies)
 * This is fixture bookkeeping, not a game engine.
 */
export function buildPokemonDeck(fixture) {
  const rules = fixture.rules;
  const pokemon = fixture.cards.filter(function (card) { return card.category === 'pokemon'; });
  const energy = fixture.cards.find(function (card) { return card.category === 'energy'; });
  if (!energy) throw new Error('pokemon fixture needs at least one energy card');
  const deck = [];
  for (const card of pokemon) {
    for (let i = 0; i < rules.maxCopies; i += 1) deck.push(card);
  }
  while (deck.length < rules.deckSize) deck.push(energy);
  if (deck.length !== rules.deckSize) {
    throw new Error('cannot build a ' + rules.deckSize + '-card deck from fixture (got ' + deck.length + ')');
  }
  return deck;
}

export function drawCards(deck, count) {
  if (deck.length < count) throw new Error('not enough cards to draw ' + count);
  return { drawn: deck.slice(0, count), rest: deck.slice(count) };
}

export function hasCjk(value) {
  return /[㐀-鿿]/.test(String(value));
}
