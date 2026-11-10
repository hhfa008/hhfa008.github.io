'use strict';

/*
 * Gate art contract: local images referenced from the page, including
 * `../../assets/...` paths, must be visible to the shipped gate.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var t = require('../../tests/lib.js');
var gateArt = require('../scripts/gate-artifacts.js');

var s = t.suite('boardgame-gate-art');

function fakePng(w, h, bytes) {
  var buf = Buffer.alloc(Math.max(bytes, 33));
  buf.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  buf[24] = 8;
  buf[25] = 6;
  return buf;
}

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-art-test-'));
var game = path.join(tmp, 'games', 'boardgame', 'fixture');
var artDir = path.join(tmp, 'games', 'assets', 'art', 'premium', 'fixture');
fs.mkdirSync(path.join(game, 'assets'), { recursive: true });
fs.mkdirSync(artDir, { recursive: true });

fs.writeFileSync(path.join(game, 'assets', 'cover.png'), fakePng(800, 600, 9000));
fs.writeFileSync(path.join(game, 'assets', 'og.png'), fakePng(1200, 630, 16000));
fs.writeFileSync(path.join(game, 'assets', 'detail.png'), fakePng(800, 600, 9000));
fs.writeFileSync(path.join(artDir, 'tile-blue.webp'), Buffer.alloc(9000));
fs.writeFileSync(path.join(game, 'index.html'), [
  '<meta property="og:image" content="assets/og.png">',
  '<img src="assets/cover.png">',
  '<style>.tile{background:url("../../assets/art/premium/fixture/tile-blue.webp")}</style>',
  '<img src="assets/detail.png">',
  '<img src="https://example.com/remote.png">',
  '<img src="data:image/png;base64,AAAA">',
  '<img src="assets/missing.png">'
].join('\n'));

var images = gateArt.imageArtifacts(game);

s.group('external reference resolution', function () {
  var external = images.filter(function (img) {
    return img.rel.indexOf('../../assets/art/premium/fixture/tile-blue.webp') !== -1;
  });
  s.eq('外部 ../../assets 引用被收集', external.length, 1);
  s.ok('外部引用指向真实文件', external.length === 1 && fs.existsSync(external[0].abs));
  s.eq('外部引用 source=ref', external.length === 1 && external[0].source, 'ref');
  s.ok('meta og:image 被收集', images.some(function (img) { return /og\.png$/.test(img.abs); }));
  s.ok('http(s) 引用被忽略', images.every(function (img) { return img.abs.indexOf('example.com') === -1; }));
  s.ok('data: 引用被忽略', images.every(function (img) { return img.abs.indexOf('data:') === -1; }));
  s.ok('不存在的引用不计入', images.every(function (img) { return img.abs.indexOf('missing.png') === -1; }));
});

s.group('roles', function () {
  var roles = gateArt.classifyArt(images);
  s.ok('找到封面', !!roles.cover);
  s.ok('找到 OG', !!roles.og);
  s.ok('找到详情图', !!roles.detail);
});

s.group('deliberate failing control', function () {
  var control = gateArt.control();
  s.ok('控制通过（缺文件/远程引用不会成为证据）', control.ok, JSON.stringify(control.detail));
  s.ok('控制覆盖正向外部引用', control.detail.positive_external_ref_and_three_roles === true);
  s.ok('控制覆盖缺失文件负例', control.detail.negative_missing_external_not_evidence === true);
  s.ok('控制覆盖远程引用负例', control.detail.negative_remote_ref_ignored === true);
});

fs.rmSync(tmp, { recursive: true, force: true });
s.done();
