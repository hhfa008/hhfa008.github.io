/* Banqi premium — shared static data.
 *
 * UMD: browsers read window.BanqiPremiumData, Node reads module.exports.
 * Everything here is factual reference data used by the page, the rules page
 * and the tests. No rules logic lives in this file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BanqiPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD = {
    rows: 4,
    cols: 8,
    cells: 32,
    piecesPerSide: 16,
    ranks: 7,
    drawPlies: 120,
    pieceMillimetres: { diameter: 24, thickness: 7 },   // small travelling set
    boardMillimetres: { width: 300, height: 160 },
    cellMillimetres: { width: 37.5, height: 40 }
  };

  var ROSTER = [
    { type: 'K', rank: 7, red: '帥', black: '將', count: 1, value: 10, label: '帥/將' },
    { type: 'A', rank: 6, red: '仕', black: '士', count: 2, value: 5, label: '仕/士' },
    { type: 'B', rank: 5, red: '相', black: '象', count: 2, value: 4.5, label: '相/象' },
    { type: 'R', rank: 4, red: '車', black: '車', count: 2, value: 6, label: '車' },
    { type: 'N', rank: 3, red: '馬', black: '馬', count: 2, value: 4, label: '馬' },
    { type: 'C', rank: 2, red: '炮', black: '砲', count: 2, value: 3.5, label: '炮/砲' },
    { type: 'P', rank: 1, red: '兵', black: '卒', count: 5, value: 2, label: '兵/卒' }
  ];

  var CAPTURE_RULES = [
    { attacker: '帥/將', canTake: '仕/士、相/象、車、馬、炮/砲、兵/卒', except: '同級不可吃，遇到兵/卒反被吃' },
    { attacker: '仕/士', canTake: '相/象、車、馬、炮/砲、兵/卒', except: '同級不可吃' },
    { attacker: '相/象', canTake: '車、馬、炮/砲、兵/卒', except: '同級不可吃' },
    { attacker: '車', canTake: '馬、炮/砲、兵/卒', except: '同級不可吃' },
    { attacker: '馬', canTake: '炮/砲、兵/卒', except: '同級不可吃' },
    { attacker: '炮/砲', canTake: '隔一子後的任何明子', except: '緊鄰不能吃；只吃明子' },
    { attacker: '兵/卒', canTake: '帥/將（特例）、同級以下的無', except: '只能吃帥/將' }
  ];

  var TIPS = [
    '翻子有風險：翻出對方的子，等於白送對方一枚即戰力。',
    '炮不隔子不能吃，貼身反而是炮最危險的位置。',
    '兵/卒雖然最小，卻是唯一能吃掉帥/將的子，殘局要留兵。',
    '帥/將是最高級，但被兵/卒貼住時無法反吃，別讓它追兵。',
    '同級棋子互不相吃，先動手的一方反而吃虧。',
    '暗子擋路也當炮架：炮可以用未翻開的棋子做隔子。',
    '無進展 120 手判和；優勢方要主動製造吃子，不要原地繞。'
  ];

  var SOURCES = {
    bilibili: [
      'https://www.bilibili.com/video/BV1MZtgzaE7n',
      'https://www.bilibili.com/video/BV1ZfxS6KEuN',
      'https://www.bilibili.com/video/BV1yk4y1D7Q7'
    ],
    rules: '暗棋/翻棋通行民间规则；等级表、兵吃帥、炮隔子吃三项以公开教程与既有站点 rules.html 交叉核对'
  };

  return {
    BOARD: BOARD,
    ROSTER: ROSTER,
    CAPTURE_RULES: CAPTURE_RULES,
    TIPS: TIPS,
    SOURCES: SOURCES
  };
});
