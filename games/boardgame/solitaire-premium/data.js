/*
 * Solitaire premium — presentation data shared by the page and tests.
 * UMD: browser globalThis.SolitaireData, Node module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolitaireData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return Object.freeze({
    title: '接龙 · Solitaire',
    subtitle: '经典 Klondike 单人纸牌',
    suits: Object.freeze([
      Object.freeze({ key: 'spade', symbol: '♠', zh: '黑桃', red: false }),
      Object.freeze({ key: 'heart', symbol: '♥', zh: '红桃', red: true }),
      Object.freeze({ key: 'diamond', symbol: '♦', zh: '方块', red: true }),
      Object.freeze({ key: 'club', symbol: '♣', zh: '梅花', red: false })
    ]),
    drawModes: Object.freeze([1, 3]),
    scoreRules: Object.freeze({
      wasteToTableau: 5,
      wasteToFoundation: 10,
      tableauToFoundation: 10,
      flip: 5,
      foundationToTableau: -15,
      recycleDraw1: 0,
      recycleDraw3: -20
    }),
    sources: Object.freeze([
      Object.freeze({ platform: 'Bilibili', id: 'BV1ag411x7nm', title: '自用 纸牌接龙' }),
      Object.freeze({ platform: 'Bilibili', id: 'BV1BC4y1q7sH', title: '经典纸牌接龙' }),
      Object.freeze({ platform: 'Bilibili', id: 'BV1pq4M6PEWC', title: '纸牌接龙' })
    ])
  });
});
