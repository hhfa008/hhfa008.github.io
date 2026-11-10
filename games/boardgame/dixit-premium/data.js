/*
 * Dixit（妙语说书人）premium — original abstract deck data (UMD).
 * 84 original cards: 12 palettes × 12 motifs, deterministic variants.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DixitData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PALETTES = Object.freeze([
    Object.freeze({ key: 'midnight', bg: '#0b1c2c', mid: '#24506b', accent: '#e7b85c', ink: '#f3ead8' }),
    Object.freeze({ key: 'ember', bg: '#2a100d', mid: '#8d3a2c', accent: '#f0b36b', ink: '#f8e8d2' }),
    Object.freeze({ key: 'moss', bg: '#12261d', mid: '#406b4d', accent: '#d9c46d', ink: '#eef4df' }),
    Object.freeze({ key: 'plum', bg: '#241224', mid: '#5e3563', accent: '#e5a5c0', ink: '#f7e9f2' }),
    Object.freeze({ key: 'sand', bg: '#2b2115', mid: '#8b6a3e', accent: '#e8cf9a', ink: '#fbf1dc' }),
    Object.freeze({ key: 'ice', bg: '#10212a', mid: '#4b7d8d', accent: '#bfe5e0', ink: '#eef8f6' }),
    Object.freeze({ key: 'wine', bg: '#220b15', mid: '#7b2a3e', accent: '#e7a86f', ink: '#f9e7df' }),
    Object.freeze({ key: 'indigo', bg: '#11162e', mid: '#3c4a86', accent: '#e0c46c', ink: '#eef0fb' }),
    Object.freeze({ key: 'clay', bg: '#2a1a12', mid: '#a05a3c', accent: '#e8c48a', ink: '#fbeee0' }),
    Object.freeze({ key: 'teal', bg: '#0b2222', mid: '#2d6a63', accent: '#e3c98d', ink: '#eaf7f2' }),
    Object.freeze({ key: 'dusk', bg: '#1d1628', mid: '#564268', accent: '#d7a7a0', ink: '#f4ecf7' }),
    Object.freeze({ key: 'forest', bg: '#0e1a12', mid: '#335c3a', accent: '#c9b268', ink: '#f1f4e2' })
  ]);
  var MOTIFS = Object.freeze(['moon','tide','stairs','bird','key','door','thread','mask','constellation','fish','tree','lantern']);
  var TAGS = Object.freeze(['潮汐','纸月','玻璃雨','旧钥匙','红绳','夜航','空椅','回声','琥珀','远山','烛火','信笺','倒影','风铃','迷宫','羽毛','石阶','深海','晨雾','钟摆','花园','旅人','星图','门缝']);

  var CARDS = [];
  for (var i = 0; i < 84; i++) {
    var palette = PALETTES[Math.floor(i / 7) % PALETTES.length];
    var motif = MOTIFS[i % MOTIFS.length];
    var tagA = TAGS[(i * 3) % TAGS.length];
    var tagB = TAGS[(i * 7 + 5) % TAGS.length];
    CARDS.push(Object.freeze({
      id: i, palette: palette.key, motif: motif, variant: Math.floor(i / 7),
      seed: (i + 1) * 2654435761 >>> 0, title: tagA + '与' + tagB,
      tags: Object.freeze([tagA, tagB])
    }));
  }
  var BY_ID = {};
  CARDS.forEach(function (card) { BY_ID[card.id] = card; });

  return Object.freeze({
    PALETTES: PALETTES, MOTIFS: MOTIFS, TAGS: TAGS,
    CARDS: Object.freeze(CARDS), BY_ID: BY_ID,
    DECK_SIZE: CARDS.length, HAND_SIZE: 6, TARGET_SCORE: 30,
    MIN_PLAYERS: 3, MAX_PLAYERS: 6,
    NAMES: Object.freeze(['你','AI · 潮汐说书人','AI · 纸月说书人','AI · 玻璃雨说书人','AI · 旧钥匙说书人','AI · 红绳说书人'])
  });
}));
