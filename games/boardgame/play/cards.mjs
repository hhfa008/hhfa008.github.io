'use strict';

/*
 * Presentation metadata for the playable card battle page.
 *
 * The rules live in ../app/cardgame.js (the single engine shared with the
 * HTTP/AI contracts). This file only describes labels and builds a 60-card
 * demo deck out of that engine's own card pool — there is no second engine
 * and no card is invented outside CARD_POOL.
 */

import { CARD_POOL } from '../app/cardgame.js';

export const TYPE_LABELS = {
  fire: '火',
  water: '水',
  grass: '草',
  electric: '电',
  normal: '无色',
  colorless: '无色'
};

export const STAGE_LABELS = {
  basic: '基础',
  stage1: '一阶',
  stage2: '二阶'
};

export const SAMPLE_RULES = {
  deckSize: 60,
  handSize: 7,
  prizeCards: 6,
  // 与 app/cardgame.js 的 RULES_META.benchSize 一致：5 个备战位。
  benchSize: 5
};

export const SAMPLE_CARDS = CARD_POOL.map(function (card) {
  return Object.assign({}, card);
});

export const CARD_BY_ID = new Map(SAMPLE_CARDS.map(function (card) { return [card.id, card]; }));

/*
 * 60 张演示牌库：10 种生物 × 4 张 = 40，另加 20 张基础能量。
 * 与官方 TCG 的「同名牌最多 4 张」和 60 张牌库契约一致；基础能量不受限制。
 */
export function buildSampleDeck() {
  const creatures = CARD_POOL.filter(function (card) {
    return card.category !== 'energy';
  }).map(function (card) { return card.id; });
  const energy = CARD_POOL.filter(function (card) {
    return card.category === 'energy';
  }).map(function (card) { return card.id; });
  const deck = [];
  for (let copy = 0; copy < 4; copy += 1) {
    creatures.forEach(function (id) { deck.push(id); });
  }
  const energyId = energy[0] || creatures[0];
  while (deck.length < SAMPLE_RULES.deckSize) deck.push(energyId);
  return deck.slice(0, SAMPLE_RULES.deckSize);
}
