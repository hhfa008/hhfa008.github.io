'use strict';

/* Batch-2 局内美术接线断言（80 款）。
 *
 * 每款 test.js 加一行：
 *   require('../shared/arcade/tests/art.js').check('<slug>', '<family>', s);
 *
 * 断言内容（进 game 的 test.js 汇总）：
 *   1. index.html 引入 /games/shared/arcade/board-art.js
 *   2. render() 里有 ArcadeBoardArt.decorate(E.board, '<family>')
 *   3. 该 family 的每张素材文件存在，且 sprite PNG 是 RGBA（IHDR color type 6）
 *
 * 「图真的渲染出来、naturalWidth>0、5 档视口无溢出」由浏览器审计
 * reports/arcade-art-batch2-20261110/audit-batch2.mjs 负责；Node 测试不假装
 * 能证明像素。
 */

var fs = require('fs');
var path = require('path');
var art = require('../board-art.js');

var ROOT = path.resolve(__dirname, '../../../..');

function pngHeader(file) {
  var b = fs.readFileSync(file);
  if (b.length < 26 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return {
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    bitDepth: b[24],
    colorType: b[25],
  };
}

function assetsFor(family) {
  var cfg = art.maps[family] || {};
  var out = [];
  Object.keys(cfg).forEach(function (key) {
    if (key === 'tiles') {
      Object.keys(cfg.tiles).forEach(function (k) { out.push(cfg.tiles[k]); });
    } else if (typeof cfg[key] === 'string' && cfg[key].indexOf('/games/assets/art/') === 0) {
      out.push(cfg[key]);
    }
  });
  return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
}

module.exports.check = function (slug, family, s) {
  var htmlPath = path.join(ROOT, 'games', slug, 'index.html');
  var html = fs.readFileSync(htmlPath, 'utf8');
  s.ok(slug + ' 局内美术：引入 board-art.js',
    html.indexOf('/games/shared/arcade/board-art.js') >= 0);
  s.ok(slug + ' 局内美术：render 调用 decorate(' + family + ')',
    html.indexOf("ArcadeBoardArt.decorate(E.board, '" + family + "')") >= 0);

  var missing = [];
  var badPng = [];
  assetsFor(family).forEach(function (url) {
    var file = path.join(ROOT, url);
    if (!fs.existsSync(file)) { missing.push(url); return; }
    if (path.extname(file) === '.png' && url.indexOf('/materials/') < 0) {
      var h = pngHeader(file);
      if (!h || h.colorType !== 6) badPng.push(file);
    }
  });
  s.ok(slug + ' 局内美术：' + family + ' 素材文件齐全且为 RGBA',
    missing.length === 0 && badPng.length === 0,
    (missing.length ? 'missing ' + missing.join(',') : '') +
    (badPng.length ? ' not-RGBA ' + badPng.join(',') : ''));
};
