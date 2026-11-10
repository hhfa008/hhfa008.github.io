/* Arcade shared: memory-pairs 卡面图案目录。
 *
 * 24 个图案 = 8 个形状（star/moon/leaf/drop/bolt/heart/diamond/ring）× 3 个配色
 * （amber/azure/rose）。形状路径来自 arcade 美术引擎的共享符号集
 * games/assets/art/arcade/engine/art-render.html#svgIcon；PNG 由
 * games/assets/art/arcade/memory-pairs/symbols/build.mjs 从同目录的
 * symbols.json 生成（透明底 192×192）。
 *
 * 顺序是 palette-major：同一配色下先排 8 个不同形状，因此 3×4（6 对）、
 * 4×4（8 对）拿到的必然是 6/8 个不同形状；最大 8×6（24 对）用满 24 个。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeMemorySymbols = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SHAPES = ['star', 'moon', 'leaf', 'drop', 'bolt', 'heart', 'diamond', 'ring'];
  var PALETTES = ['amber', 'azure', 'rose'];
  var DIR = '/games/assets/art/arcade/memory-pairs/symbols/';
  var KEYS = [];
  for (var p = 0; p < PALETTES.length; p++) {
    for (var s = 0; s < SHAPES.length; s++) KEYS.push(SHAPES[s] + '-' + PALETTES[p]);
  }

  function faceFor(pair) { return KEYS[pair % KEYS.length]; }
  function url(key) { return DIR + key + '.png'; }

  return {
    keys: KEYS,
    shapes: SHAPES,
    palettes: PALETTES,
    dir: DIR,
    count: KEYS.length,
    faceFor: faceFor,
    url: url,
  };
});
