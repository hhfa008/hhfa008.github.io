'use strict';

/*
 * 构建冒烟测试：生成到临时目录，检查页面结构、详情页数量、来源链接白名单、
 * 零外部资源引用与重复构建字节稳定性。
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');
var t = require('../tests/lib.js');

var ROOT = __dirname;
var DATA = path.join(ROOT, 'data');
var BUILD = path.join(ROOT, 'build.mjs');
var s = t.suite('boardgame-build');

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function walk(dir, base, out) {
  var prefix = base || '';
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    var full = path.join(dir, ent.name);
    var rel = prefix ? prefix + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(full, rel, out);
    else out.push(rel);
  });
  return out;
}

function runBuild(out, label) {
  var result = cp.spawnSync(process.execPath, [BUILD, '--out', out], {
    cwd: ROOT, encoding: 'utf8'
  });
  s.ok(label + ' 退出码 0', result.status === 0, (result.stderr || '').trim());
  return result;
}

function auditExternal(html, label, expectedSourceLinks) {
  s.ok(label + ' 无 <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  s.ok(label + ' 无 stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  s.ok(label + ' 无 @import', !/@import/i.test(html));
  s.ok(label + ' 无远程 url()', !/url\(\s*["']?https?:/i.test(html));
  s.ok(label + ' 无 img/iframe/media 外链资源', !/<(img|iframe|video|audio|source|embed|object)\b/i.test(html));
  s.ok(label + ' 无 fetch/XHR/sendBeacon', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(html));

  var anchors = html.match(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/gi) || [];
  s.eq(label + ' 外链数量', anchors.length, expectedSourceLinks);
  anchors.forEach(function (tag, i) {
    s.ok(label + ' 外链 ' + (i + 1) + ' 带 noopener noreferrer', /rel="noopener noreferrer"/.test(tag), tag);
  });

  var stripped = html
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, '')
    .replace(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  s.ok(label + ' 白名单外无 http(s) URL', !/https?:\/\//.test(stripped),
    (stripped.match(/https?:\/\/[^\s"'<>]+/g) || []).slice(0, 3).join(', '));
}

(function () {
  var categories = readJson(path.join(DATA, 'categories.json'));
  var games = readJson(path.join(DATA, 'boardgames.json'));

  var tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-build-a-'));
  var tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-build-b-'));
  var outA = path.join(tmpA, 'out');
  var outB = path.join(tmpB, 'out');

  runBuild(outA, '第一次构建');
  runBuild(outB, '第二次构建');

  var indexA = path.join(outA, 'index.html');
  s.ok('列表页存在', fs.existsSync(indexA));
  var indexHtml = fs.readFileSync(indexA, 'utf8');

  s.group('list page', function () {
    s.ok('列表页含 title 特征串', /<title>桌游目录 · \d+ 款桌游/.test(indexHtml));
    s.ok('列表页 lang=zh-CN', /<html lang="zh-CN">/.test(indexHtml));
    s.ok('列表页含 viewport', /name="viewport"/.test(indexHtml) && /width=device-width/.test(indexHtml));
    s.ok('列表页含搜索框', /id="q"/.test(indexHtml) && /type="search"/.test(indexHtml));
    s.ok('列表页含品类筛选', /data-filter="category"/.test(indexHtml));
    s.ok('列表页含人数筛选', /data-filter="players"/.test(indexHtml));
    s.ok('列表页含时长筛选', /data-filter="time"/.test(indexHtml));
    s.ok('列表页含结果计数', /id="count"/.test(indexHtml));
    s.ok('列表页含空状态', /id="empty"/.test(indexHtml));
    s.ok('列表页卡片数 = 数据条数', (indexHtml.match(/class="card"/g) || []).length === games.length,
      'got ' + (indexHtml.match(/class="card"/g) || []).length);
    s.ok('列表页含移动端媒体查询', /@media \(max-width:520px\)/.test(indexHtml));
    s.ok('列表页触控目标 >=44px', /min-height:44px/.test(indexHtml));
    categories.forEach(function (c) {
      s.ok('列表页含品类 ' + c.key, indexHtml.indexOf('data-value="' + c.key + '"') !== -1);
      s.ok('列表页含品类中文名 ' + c.name.zh, indexHtml.indexOf(c.name.zh) !== -1);
    });
    s.ok('列表页不加载封面图', !/<img\b/i.test(indexHtml));
    auditExternal(indexHtml, '列表页', 0);
  });

  s.group('detail pages', function () {
    var boardDir = path.join(outA, 'board');
    s.ok('详情目录存在', fs.existsSync(boardDir));
    var files = fs.readdirSync(boardDir).filter(function (f) { return /\.html$/.test(f); });
    s.eq('详情页数 = 数据条数', files.length, games.length);

    games.forEach(function (game) {
      var file = path.join(boardDir, game.slug + '.html');
      s.ok(game.slug + ' 详情页存在', fs.existsSync(file));
      if (!fs.existsSync(file)) return;
      var html = fs.readFileSync(file, 'utf8');
      s.ok(game.slug + ' title 含中文名', html.indexOf('<title>' + escHtml(game.name.zh) + ' · 桌游详情</title>') !== -1);
      s.ok(game.slug + ' 含中文名', html.indexOf(escHtml(game.name.zh)) !== -1);
      s.ok(game.slug + ' 含原名', html.indexOf(escHtml(game.name.en)) !== -1);
      s.ok(game.slug + ' 含评分', html.indexOf(game.rating.toFixed(1)) !== -1);
      s.ok(game.slug + ' 含支持人数', html.indexOf(game.players.min + '–' + game.players.max + ' 人') !== -1
        || html.indexOf(game.players.min + ' 人') !== -1);
      s.ok(game.slug + ' 含返回列表', html.indexOf('href="../index.html"') !== -1);
      s.ok(game.slug + ' 含来源链接', html.indexOf(game.source.url) !== -1);
      s.ok(game.slug + ' 来源链接 rel 白名单', /<a class="source-link"[^>]*rel="noopener noreferrer"/.test(html));
      s.eq(game.slug + ' 同类推荐 3 条', (html.match(/class="rec-card"/g) || []).length, 3);
      s.ok(game.slug + ' 不加载封面图', !/<img\b/i.test(html));
      auditExternal(html, game.slug, 1);
    });
  });

  s.group('byte stability', function () {
    var a = walk(outA, '', []).sort();
    var b = walk(outB, '', []).sort();
    s.eq('两次构建文件清单一致', a, b);
    var same = true;
    var mismatch = '';
    a.forEach(function (rel) {
      var ma = md5(fs.readFileSync(path.join(outA, rel)));
      var mb = md5(fs.readFileSync(path.join(outB, rel)));
      if (ma !== mb) {
        same = false;
        mismatch = rel;
      }
    });
    s.ok('两次构建所有文件 md5 一致', same, mismatch);
    s.eq('列表页 md5 稳定', md5(fs.readFileSync(indexA)), md5(fs.readFileSync(path.join(outB, 'index.html'))));
  });

  fs.rmSync(tmpA, { recursive: true, force: true });
  fs.rmSync(tmpB, { recursive: true, force: true });

  s.done();
})();
