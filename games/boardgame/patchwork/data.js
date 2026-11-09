/*
 * Patchwork（拼布）基础数据 — UMD
 *
 * 33 块基础拼布的形状、购买成本、时间成本与扣子收益，取自公开的
 * 开源实现所整理的原始游戏数据，并用三份独立实现交叉核对：
 *   - danzel/PatchworkSim · PieceDefinition.cs
 *   - adrianosmond/patchwork · src/constants/pieces.js
 *   - huynd2210/Tile-laying-Puzzle-Solver · patchwork_pieces.json（仅形状）
 *
 * 形状统一归一化到左上角原点，cells 为 [行, 列]。
 * buttons = 购买成本；income = 拼布上印的扣子数，经过时间轴扣子格时按
 * 自己棋盘上的 income 总和收钱。真实基础版成本为 0–10、时间 1–6，
 * 收益 0–3；这里保留真实数值，不截断。没有使用图片识别或截图分析。
 *
 * 时间轴扣子格采用公开规则与多个开源实现一致的位置：5, 11, 17, 23,
 * 29, 35, 41, 47, 53。基础版另有 5 个 1×1 皮革格；本实现按任务范围
 * 只做核心购买/跳过/7×7/计分，不加入皮革补丁。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PatchworkData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD_SIZE = 9;
  var LAST_SPACE = 53;
  var START_BUTTONS = 5;
  var MARKET_VISIBLE = 3;
  var SEVEN_BY_SEVEN_BONUS = 7;
  var EMPTY_PENALTY = 2;
  var INCOME_SPACES = [5, 11, 17, 23, 29, 35, 41, 47, 53];

  var RAW = [
    { id: 'P01', name: '2×1 起手布条', buttons: 2, time: 1, income: 0, cells: [[0, 0], [0, 1]] },
    { id: 'P02', name: '3×1 布条', buttons: 2, time: 2, income: 0, cells: [[0, 0], [0, 1], [0, 2]] },
    { id: 'P03', name: '4×1 布条', buttons: 3, time: 3, income: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: 'P04', name: '5×1 长条', buttons: 7, time: 1, income: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
    { id: 'P05', name: '2×2 方块', buttons: 6, time: 5, income: 2, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { id: 'P06', name: '凸角方块', buttons: 2, time: 2, income: 0, cells: [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]] },
    { id: 'P07', name: '长翼方块', buttons: 10, time: 5, income: 3, cells: [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2], [1, 3]] },
    { id: 'P08', name: '双翼方块', buttons: 7, time: 4, income: 2, cells: [[0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3]] },
    { id: 'P09', name: '错位方块', buttons: 4, time: 2, income: 0, cells: [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [1, 3]] },
    { id: 'P10', name: '下摆方块', buttons: 8, time: 6, income: 3, cells: [[0, 1], [0, 2], [1, 1], [1, 2], [2, 0], [2, 1]] },
    { id: 'P11', name: 'U 形槽', buttons: 1, time: 2, income: 0, cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]] },
    { id: 'P12', name: '宽 U 形槽', buttons: 1, time: 5, income: 1, cells: [[0, 0], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]] },
    { id: 'P13', name: 'Y 形叉', buttons: 3, time: 6, income: 2, cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2], [2, 1]] },
    { id: 'P14', name: '小 T 形', buttons: 2, time: 2, income: 0, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    { id: 'P15', name: '中 T 形', buttons: 5, time: 5, income: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]] },
    { id: 'P16', name: '长 T 形', buttons: 7, time: 2, income: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1], [3, 1]] },
    { id: 'P17', name: '十字长柄', buttons: 0, time: 3, income: 1, cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [3, 1]] },
    { id: 'P18', name: '低角 L', buttons: 4, time: 2, income: 1, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { id: 'P19', name: '高角 L', buttons: 4, time: 6, income: 2, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { id: 'P20', name: '长腿 L', buttons: 10, time: 3, income: 2, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]] },
    { id: 'P21', name: '侧钩 L', buttons: 3, time: 4, income: 1, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [3, 0]] },
    { id: 'P22', name: '十字', buttons: 5, time: 4, income: 2, cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
    { id: 'P23', name: '长柄十字', buttons: 1, time: 4, income: 1, cells: [[0, 1], [1, 1], [2, 0], [2, 1], [2, 2], [3, 1], [4, 1]] },
    { id: 'P24', name: '宽十字', buttons: 5, time: 3, income: 1, cells: [[0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1], [2, 2]] },
    { id: 'P25', name: 'H 形', buttons: 2, time: 3, income: 0, cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 2]] },
    { id: 'P26', name: '小角（扣）', buttons: 3, time: 1, income: 0, cells: [[0, 1], [1, 0], [1, 1]] },
    { id: 'P27', name: '小角（时）', buttons: 1, time: 3, income: 0, cells: [[0, 1], [1, 0], [1, 1]] },
    { id: 'P28', name: 'S 形（廉）', buttons: 3, time: 2, income: 1, cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },
    { id: 'P29', name: 'S 形（贵）', buttons: 7, time: 6, income: 3, cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },
    { id: 'P30', name: '长 S 形', buttons: 2, time: 3, income: 1, cells: [[0, 1], [1, 1], [2, 0], [2, 1], [3, 0]] },
    { id: 'P31', name: '宽 S 形', buttons: 1, time: 2, income: 0, cells: [[0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0]] },
    { id: 'P32', name: '翼形 S', buttons: 2, time: 1, income: 0, cells: [[0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]] },
    { id: 'P33', name: 'W 形', buttons: 10, time: 4, income: 3, cells: [[0, 2], [1, 1], [1, 2], [2, 0], [2, 1]] }
  ];

  function freezePatch(raw) {
    var cells = raw.cells.map(function (cell) { return [cell[0], cell[1]]; });
    var rows = 0;
    var cols = 0;
    cells.forEach(function (cell) {
      if (cell[0] + 1 > rows) rows = cell[0] + 1;
      if (cell[1] + 1 > cols) cols = cell[1] + 1;
    });
    return Object.freeze({
      id: raw.id,
      name: raw.name,
      buttons: raw.buttons,
      time: raw.time,
      income: raw.income,
      cells: Object.freeze(cells.map(function (cell) { return Object.freeze(cell); })),
      size: cells.length,
      rows: rows,
      cols: cols
    });
  }

  var PATCHES = Object.freeze(RAW.map(freezePatch));
  var PATCH_BY_ID = Object.create(null);
  PATCHES.forEach(function (patch) { PATCH_BY_ID[patch.id] = patch; });

  return Object.freeze({
    BOARD_SIZE: BOARD_SIZE,
    LAST_SPACE: LAST_SPACE,
    START_BUTTONS: START_BUTTONS,
    MARKET_VISIBLE: MARKET_VISIBLE,
    SEVEN_BY_SEVEN_BONUS: SEVEN_BY_SEVEN_BONUS,
    EMPTY_PENALTY: EMPTY_PENALTY,
    INCOME_SPACES: Object.freeze(INCOME_SPACES.slice()),
    PATCHES: PATCHES,
    PATCH_BY_ID: PATCH_BY_ID
  });
});
