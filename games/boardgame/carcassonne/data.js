/*
 * Carcassonne（卡卡颂）基础瓦片集 — UMD
 *
 * 50 张自洽瓦片，四边地形只有 city（城市）/ road（道路）/ field（农田）
 * 三种，部分瓦片中央带 monastery（修道院）标记。每张瓦片另外记录：
 *   - cities / roads / fields：同一种地形在瓦片内部连通的边分组，
 *     数组元素是边方向下标（0=N, 1=E, 2=S, 3=W）；
 *   - fieldAdj：每个农田分组相邻的城市分组下标，用于终局农夫计分；
 *   - count：该瓦片在牌堆中的份数（本实现每张 1 份）。
 *
 * 规则按公开基础版整理并做少量简化（路口、农田计分见 rules.html）：
 * 城市边必须接城市边、道路接道路、农田接农田；修道院是中央地物，
 * 不改变四边匹配要求。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CarcassonneData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EDGE_TYPES = ['city', 'road', 'field'];

  function tile(id, name, edges, cities, roads, fields, fieldAdj, monastery) {
    var fieldList = fields || [];
    var adj = fieldAdj && fieldAdj.length === fieldList.length
      ? fieldAdj
      : fieldList.map(function () { return []; });
    return {
      id: id,
      name: name,
      edges: edges,
      cities: cities || [],
      roads: roads || [],
      fields: fieldList,
      fieldAdj: adj,
      monastery: !!monastery,
      count: 1
    };
  }

  var TILES = [
    /* T01 起始瓦片：北城、东西道路、南农田 */
    tile('T01', '起始路口', ['city', 'road', 'field', 'road'],
      [[0]], [[1, 3]], [[2]], [[0]]),

    /* 单边城市（四个方向） */
    tile('T02', '北城农田', ['city', 'field', 'field', 'field'],
      [[0]], [], [[1, 2, 3]], [[0]]),
    tile('T03', '东城农田', ['field', 'city', 'field', 'field'],
      [[1]], [], [[0, 2, 3]], [[0]]),
    tile('T04', '南城农田', ['field', 'field', 'city', 'field'],
      [[2]], [], [[0, 1, 3]], [[0]]),
    tile('T05', '西城农田', ['field', 'field', 'field', 'city'],
      [[3]], [], [[0, 1, 2]], [[0]]),

    /* 相邻双边城市（四个角） */
    tile('T06', '东北城角', ['city', 'city', 'field', 'field'],
      [[0, 1]], [], [[2, 3]], [[0]]),
    tile('T07', '东南城角', ['field', 'city', 'city', 'field'],
      [[1, 2]], [], [[0, 3]], [[0]]),
    tile('T08', '西南城角', ['field', 'field', 'city', 'city'],
      [[2, 3]], [], [[0, 1]], [[0]]),
    tile('T09', '西北城角', ['city', 'field', 'field', 'city'],
      [[0, 3]], [], [[1, 2]], [[0]]),

    /* 对边城市 */
    tile('T10', '南北穿城', ['city', 'field', 'city', 'field'],
      [[0, 2]], [], [[1], [3]], [[0], [0]]),
    tile('T11', '东西穿城', ['field', 'city', 'field', 'city'],
      [[1, 3]], [], [[0], [2]], [[0], [0]]),

    /* 三边城市 */
    tile('T12', '北东南城', ['city', 'city', 'city', 'field'],
      [[0, 1, 2]], [], [[3]], [[0]]),
    tile('T13', '东南西城', ['field', 'city', 'city', 'city'],
      [[1, 2, 3]], [], [[0]], [[0]]),
    tile('T14', '南西北城', ['city', 'field', 'city', 'city'],
      [[0, 2, 3]], [], [[1]], [[0]]),
    tile('T15', '西北东城', ['city', 'city', 'field', 'city'],
      [[0, 1, 3]], [], [[2]], [[0]]),

    /* 四边城市 */
    tile('T16', '完整 City', ['city', 'city', 'city', 'city'],
      [[0, 1, 2, 3]], [], [], []),

    /* 城市 + 道路 */
    tile('T17', '北城横路', ['city', 'road', 'field', 'road'],
      [[0]], [[1, 3]], [[2]], [[0]]),
    tile('T18', '北城断头路', ['city', 'field', 'road', 'field'],
      [[0]], [[2]], [[1], [3]], [[0], [0]]),
    tile('T19', '北城东路', ['city', 'road', 'field', 'field'],
      [[0]], [[1]], [[2, 3]], [[0]]),
    tile('T20', '北城双路', ['city', 'road', 'road', 'field'],
      [[0]], [[1], [2]], [[3]], [[0]]),
    tile('T21', '东城断头路', ['field', 'city', 'road', 'field'],
      [[1]], [[2]], [[0], [3]], [[0], [0]]),
    tile('T22', '南城西路', ['field', 'field', 'city', 'road'],
      [[2]], [[3]], [[0, 1]], [[0]]),
    tile('T23', '南城北路', ['road', 'field', 'city', 'field'],
      [[2]], [[0]], [[1], [3]], [[0], [0]]),
    tile('T24', '西城双路', ['road', 'road', 'field', 'city'],
      [[3]], [[0], [1]], [[2]], [[0]]),
    tile('T25', '南北城东路', ['city', 'road', 'city', 'field'],
      [[0, 2]], [[1]], [[3]], [[0]]),
    tile('T26', '东城南路', ['field', 'city', 'field', 'road'],
      [[1]], [[3]], [[0], [2]], [[0], [0]]),

    /* 纯道路 */
    tile('T27', '东西直路', ['field', 'road', 'field', 'road'],
      [], [[1, 3]], [[0], [2]]),
    tile('T28', '东北弯道', ['road', 'road', 'field', 'field'],
      [], [[0, 1]], [[2, 3]]),
    tile('T29', 'T 字路口', ['road', 'road', 'road', 'field'],
      [], [[0], [1], [2]], [[3]]),
    tile('T30', '十字路口', ['road', 'road', 'road', 'road'],
      [], [[0], [1], [2], [3]], []),
    tile('T31', '北路村口', ['road', 'field', 'field', 'field'],
      [], [[0]], [[1, 2, 3]]),
    tile('T32', '东路村口', ['field', 'road', 'field', 'field'],
      [], [[1]], [[0, 2, 3]]),
    tile('T33', '南路村口', ['field', 'field', 'road', 'field'],
      [], [[2]], [[0, 1, 3]]),
    tile('T34', '西路村口', ['field', 'field', 'field', 'road'],
      [], [[3]], [[0, 1, 2]]),
    tile('T35', '南北直路', ['road', 'field', 'road', 'field'],
      [], [[0, 2]], [[1], [3]]),
    tile('T36', '三路缺口西', ['road', 'field', 'road', 'road'],
      [], [[0], [2], [3]], [[1]]),
    tile('T37', '三路缺口南', ['road', 'road', 'field', 'road'],
      [], [[0], [1], [3]], [[2]]),
    tile('T38', '三路缺口北', ['field', 'road', 'road', 'road'],
      [], [[1], [2], [3]], [[0]]),
    tile('T39', '两断头路', ['road', 'field', 'field', 'road'],
      [], [[0], [3]], [[1, 2]]),
    tile('T40', '东南弯道', ['field', 'road', 'road', 'field'],
      [], [[1, 2]], [[0], [3]]),

    /* 修道院 */
    tile('T41', '修道院草原', ['field', 'field', 'field', 'field'],
      [], [], [[0, 1, 2, 3]], [], true),
    tile('T42', '修道院北路', ['road', 'field', 'field', 'field'],
      [], [[0]], [[1, 2, 3]], [], true),
    tile('T43', '修道院横路', ['field', 'road', 'field', 'road'],
      [], [[1, 3]], [[0], [2]], [], true),
    tile('T44', '修道院北城', ['city', 'field', 'field', 'field'],
      [[0]], [], [[1, 2, 3]], [[0]], true),
    tile('T45', '修道院南路', ['field', 'field', 'road', 'field'],
      [], [[2]], [[0, 1, 3]], [], true),
    tile('T46', '修道院弯道', ['road', 'road', 'field', 'field'],
      [], [[0, 1]], [[2, 3]], [], true),

    /* 补充组合 */
    tile('T47', '东北城西路', ['city', 'city', 'field', 'road'],
      [[0, 1]], [[3]], [[2]], [[0]]),
    tile('T48', '东南城西路', ['field', 'city', 'city', 'road'],
      [[1, 2]], [[3]], [[0]], [[0]]),
    tile('T49', '南北城西路', ['city', 'field', 'city', 'road'],
      [[0, 2]], [[3]], [[1]], [[0]]),
    tile('T50', '东西城北路', ['road', 'city', 'field', 'city'],
      [[1], [3]], [[0]], [[2]], [[0, 1]])
  ];

  var TOTAL = TILES.reduce(function (sum, t) { return sum + t.count; }, 0);

  return {
    EDGE_TYPES: EDGE_TYPES,
    TILES: TILES,
    TOTAL_TILES: TOTAL,
    START_TILE_ID: 'T01',
    MEEPLES_PER_PLAYER: 7,
    BOARD_MIN: -12,
    BOARD_MAX: 12,
    PLAYER_COLORS: ['#c0392b', '#2b6cb0'],
    PLAYER_NAMES: ['你', 'AI 对手']
  };
});
