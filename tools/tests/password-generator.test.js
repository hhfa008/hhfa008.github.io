'use strict';

var path = require('path');
var L = require('./lib.js');

var DIR = path.join(__dirname, '..', 'password-generator');
var html = L.page(DIR);
var E = L.evalScript(html, 'engine', 'ToolEngine');
var DICT = L.evalScript(html, 'i18n', 'TOOL_I18N');
var engineCode = L.scriptCode(html, 'engine');

var t = L.suite('password-generator');

var AMBIG = "0Oo1lI|`'\"";
var LANGS = ['zh', 'en', 'id'];

function opts(extra) {
  var o = {
    length: 16,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
    requireEach: true
  };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

function throws(fn, label) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  t.ok(label, threw);
}

t.group('引擎导出与字符池', function () {
  ['buildPool', 'generatePassword', 'generateBatch', 'entropyBits', 'strengthFor', 'shuffle'].forEach(function (name) {
    t.ok('导出了 ' + name, typeof E[name] === 'function');
  });

  var all = E.buildPool(opts());
  t.ok('四类全开成功', all.ok);
  t.eq('四类全开池大小', all.poolSize, 90);
  t.eq('类别顺序', all.categories, ['lower', 'upper', 'digits', 'symbols']);
  t.eq('仅小写', E.buildPool({ lower: true }).poolSize, 26);
  t.eq('仅小写排除混淆', E.buildPool({ lower: true, excludeAmbiguous: true }).poolSize, 24);
  t.eq('仅大写', E.buildPool({ upper: true }).poolSize, 26);
  t.eq('仅大写排除混淆', E.buildPool({ upper: true, excludeAmbiguous: true }).poolSize, 24);
  t.eq('仅数字', E.buildPool({ digits: true }).poolSize, 10);
  t.eq('仅数字排除混淆', E.buildPool({ digits: true, excludeAmbiguous: true }).poolSize, 8);
  t.eq('仅符号', E.buildPool({ symbols: true }).poolSize, 28);
  t.eq('仅符号排除混淆', E.buildPool({ symbols: true, excludeAmbiguous: true }).poolSize, 24);

  var excluded = E.buildPool(opts({ excludeAmbiguous: true }));
  t.eq('排除混淆后的总池', excluded.poolSize, 80);
  AMBIG.split('').forEach(function (ch) {
    t.eq('池中不含 ' + JSON.stringify(ch), excluded.pool.indexOf(ch), -1);
  });

  t.eq('空选项返回 no-sets', E.buildPool({}).error, 'no-sets');
  t.eq('null 选项返回 bad-options', E.buildPool(null).error, 'bad-options');
  t.eq('字符串选项返回 bad-options', E.buildPool('lower').error, 'bad-options');
  return '池 90 / 排除后 80';
});

t.group('生成：长度与每类字符', function () {
  var lower = E.generatePassword(opts({ upper: false, digits: false, symbols: false }), L.mulberry32(1));
  t.ok('仅小写生成成功', lower.ok);
  t.eq('默认长度 16', lower.password.length, 16);
  t.ok('仅小写内容合法', /^[a-z]+$/.test(lower.password), lower.password);
  t.eq('poolSize 随开关变化', lower.poolSize, 26);
  t.near('生成结果携带熵值', lower.entropy, 16 * Math.log2(26), 1e-9);

  var sets = E.buildPool(opts()).sets;
  var mixed = E.generatePassword(opts({ length: 32 }), L.mulberry32(2));
  t.ok('四类混合生成成功', mixed.ok);
  t.eq('长度 32', mixed.password.length, 32);
  ['lower', 'upper', 'digits', 'symbols'].forEach(function (key) {
    var found = false;
    for (var i = 0; i < mixed.password.length; i++) {
      if (sets[key].indexOf(mixed.password.charAt(i)) !== -1) { found = true; break; }
    }
    t.ok('包含字符集 ' + key, found, mixed.password);
  });

  t.eq('长度 8', E.generatePassword(opts({ length: 8 }), L.mulberry32(3)).password.length, 8);
  t.eq('长度 64', E.generatePassword(opts({ length: 64 }), L.mulberry32(4)).password.length, 64);

  var noEach = E.generatePassword(opts({ length: 3, requireEach: false }), L.mulberry32(5));
  t.ok('关闭每类至少一个后长度 3 可用', noEach.ok);
  t.eq('长度 3 的输出长度', noEach.password.length, 3);

  var tooShort = E.generatePassword(opts({ length: 3, requireEach: true }), L.mulberry32(6));
  t.eq('长度小于类别数返回 too-short', tooShort.error, 'too-short');

  var noSets = E.generatePassword({ length: 16 }, L.mulberry32(7));
  t.eq('未选字符集返回 no-sets', noSets.error, 'no-sets');

  [0, 65, 1.5, NaN, '16'].forEach(function (len) {
    var r = E.generatePassword(opts({ length: len }), L.mulberry32(8));
    t.eq('非法长度 ' + String(len) + ' 返回 bad-length', r.error, 'bad-length');
  });

  t.eq('缺少 rng 返回 bad-rng', E.generatePassword(opts(), null).error, 'bad-rng');
  return '长度 8 / 16 / 64 均覆盖';
});

t.group('排除易混淆字符', function () {
  var bad = 0;
  for (var i = 0; i < 100; i++) {
    var r = E.generatePassword(opts({ excludeAmbiguous: true }), L.mulberry32(1000 + i));
    if (!r.ok) { bad = -1; break; }
    for (var j = 0; j < r.password.length; j++) {
      if (AMBIG.indexOf(r.password.charAt(j)) !== -1) bad++;
    }
  }
  t.eq('100 个密码共 1600 字符中无混淆字符', bad, 0);
  return '1600 字符检查通过';
});

t.group('批量生成', function () {
  var batch = E.generateBatch(5, opts(), L.mulberry32(7));
  t.ok('批量生成成功', batch.ok);
  t.eq('批量数量为 5', batch.passwords.length, 5);
  t.eq('每个密码长度 16', batch.passwords.every(function (p) { return p.length === 16; }), true);

  var seen = {};
  batch.passwords.forEach(function (p) { seen[p] = true; });
  t.eq('5 个密码互不相同', Object.keys(seen).length, 5);
  t.eq('批量结果携带池大小', batch.poolSize, 90);

  t.eq('批量 0 个返回 bad-count', E.generateBatch(0, opts(), L.mulberry32(1)).error, 'bad-count');
  t.eq('批量 51 个返回 bad-count', E.generateBatch(51, opts(), L.mulberry32(1)).error, 'bad-count');
  t.eq('批量非法选项透传 no-sets', E.generateBatch(2, { length: 8 }, L.mulberry32(1)).error, 'no-sets');

  var a = E.generateBatch(5, opts(), L.mulberry32(9));
  var b = E.generateBatch(5, opts(), L.mulberry32(9));
  t.eq('批量在同种子下确定', a.passwords, b.passwords);
  return '5 个不重复';
});

t.group('同种子确定性与 1000 次分布', function () {
  var a = E.generatePassword(opts({ length: 32 }), L.mulberry32(42));
  var b = E.generatePassword(opts({ length: 32 }), L.mulberry32(42));
  var c = E.generatePassword(opts({ length: 32 }), L.mulberry32(43));
  t.eq('同种子输出相同', a.password, b.password);
  t.ok('不同种子输出不同', a.password !== c.password);

  var counts = {};
  var chars = 0;
  var rng = L.mulberry32(20260209);
  for (var i = 0; i < 1000; i++) {
    var one = E.generatePassword({ length: 8, digits: true, requireEach: false }, rng);
    for (var j = 0; j < one.password.length; j++) {
      var ch = one.password.charAt(j);
      counts[ch] = (counts[ch] || 0) + 1;
      chars++;
    }
  }
  t.eq('1000 个密码共 8000 字符', chars, 8000);
  t.eq('只出现 10 种数字', Object.keys(counts).length, 10);
  ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (d) {
    t.ok('数字 ' + d + ' 的分布合理', counts[d] >= 700 && counts[d] <= 1300, String(counts[d]));
  });
  return '每类期望 800 次，允许 700–1300';
});

t.group('熵值与强度边界', function () {
  t.near('16 × log2(64) = 96', E.entropyBits(16, 64), 96, 1e-9);
  t.near('8 × log2(2) = 8', E.entropyBits(8, 2), 8, 1e-9);
  t.eq('长度 0 熵为 0', E.entropyBits(0, 64), 0);
  t.eq('池大小 1 熵为 0', E.entropyBits(10, 1), 0);
  t.near('默认 16 × log2(80)', E.entropyBits(16, 80), 16 * Math.log2(80), 1e-9);

  throws(function () { E.entropyBits(-1, 64); }, '熵拒绝负长度');
  throws(function () { E.entropyBits(10, 0); }, '熵拒绝零池');
  throws(function () { E.entropyBits('10', 64); }, '熵拒绝字符串长度');

  t.eq('0 bits 为弱', E.strengthFor(0), 'weak');
  t.eq('49.999 bits 为弱', E.strengthFor(49.999), 'weak');
  t.eq('50 bits 为一般', E.strengthFor(50), 'fair');
  t.eq('79.999 bits 为一般', E.strengthFor(79.999), 'fair');
  t.eq('80 bits 为强', E.strengthFor(80), 'strong');
  t.eq('119.999 bits 为强', E.strengthFor(119.999), 'strong');
  t.eq('120 bits 为很强', E.strengthFor(120), 'very-strong');
  t.eq('400 bits 为很强', E.strengthFor(400), 'very-strong');
  throws(function () { E.strengthFor(-1); }, '强度拒绝负数');
  throws(function () { E.strengthFor(NaN); }, '强度拒绝 NaN');
  return '边界 50 / 80 / 120';
});

t.group('Fisher–Yates 洗牌', function () {
  var arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  var sh = E.shuffle(arr, L.mulberry32(11));
  t.eq('洗牌后长度不变', sh.length, 10);
  t.eq('洗牌是置换', sh.slice().sort(function (a, b) { return a - b; }), arr);
  t.eq('洗牌不修改原数组', arr, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  t.eq('洗牌在同种子下确定', E.shuffle(arr, L.mulberry32(11)), sh);
  t.ok('不同种子结果不同', JSON.stringify(E.shuffle(arr, L.mulberry32(12))) !== JSON.stringify(sh));
  t.eq('空数组', E.shuffle([], L.mulberry32(1)), []);
  t.eq('单元素数组', E.shuffle(['x'], L.mulberry32(1)), ['x']);
  throws(function () { E.shuffle(null, L.mulberry32(1)); }, '洗牌拒绝非数组');
  throws(function () { E.shuffle([1, 2], null); }, '洗牌拒绝非函数 rng');
  return '置换性 + 确定性';
});

t.group('三语键与 data-i', function () {
  var base = L.checkI18n(t, DICT, [
    'docTitle', 'docDesc', 'appTitle', 'tagline', 'privacy',
    'generate', 'copy', 'regenerate', 'strengthNote', 'poolInfo',
    'batchTitle', 'bitsUnit', 'errorNoSets', 'errorBadLength',
    'faqQ1', 'faqA1', 'disclaimer', 'noscript'
  ]);

  var keys = L.dataIKeys(html);
  t.ok('data-i 键数量足够', keys.length >= 20, String(keys.length));
  keys.forEach(function (k) {
    LANGS.forEach(function (lang) {
      t.ok('data-i 键 ' + k + ' 在 ' + lang + ' 中存在', DICT[lang][k] != null);
    });
  });

  base.forEach(function (k) {
    LANGS.forEach(function (lang) {
      t.ok(lang + '.' + k + ' 不是键名本身', DICT[lang][k] !== k);
    });
  });
  return base.length + ' 个键 × 3 语言';
});

t.group('静态合规与 SEO', function () {
  t.eq('无外部请求', L.externalRefs(html), []);
  t.ok('有 viewport', /name="viewport"/.test(html));
  t.ok('有 canonical', /rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/password-generator\/"/.test(html));
  t.ok('有 title', /<title>[^<]+<\/title>/.test(html));
  t.ok('有 meta description', /name="description"/.test(html));
  t.ok('默认 lang 为 zh-CN', /<html lang="zh-CN"/.test(html));
  t.ok('有 OG 标题', /property="og:title"/.test(html));
  t.ok('有 Twitter card', /name="twitter:card"/.test(html));
  t.ok('有 noscript', /<noscript>/.test(html));
  t.eq('三个语言按钮', (html.match(/data-lang="/g) || []).length, 3);

  var ld = L.jsonLd(html);
  t.eq('三个 JSON-LD 块', ld.length, 3);
  t.eq('JSON-LD 类型', ld.map(function (x) { return x['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  ld.forEach(function (x) {
    t.eq('JSON-LD @context', x['@context'], 'https://schema.org');
  });
  var app = ld.filter(function (x) { return x['@type'] === 'SoftwareApplication'; })[0];
  t.ok('SoftwareApplication 免费', app && app.offers && app.offers.price === '0');
  var faq = ld.filter(function (x) { return x['@type'] === 'FAQPage'; })[0];
  t.ok('FAQ 至少 3 条', faq && faq.mainEntity && faq.mainEntity.length >= 3);
  var bc = ld.filter(function (x) { return x['@type'] === 'BreadcrumbList'; })[0];
  t.eq('面包屑 3 级', bc.itemListElement.map(function (x) { return x.position; }), [1, 2, 3]);

  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('体积不超过 90KB', bytes <= 90 * 1024, bytes + ' bytes');
  var scripts = html.match(/<script(?![^>]*type="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/gi) || [];
  var js = scripts.filter(function (s) { return s.indexOf('id="i18n"') === -1; }).join('\n');
  t.ok('脚本不使用 Math.random', js.indexOf('Math.random') === -1);
  t.ok('引擎不碰 DOM', engineCode.indexOf('document') === -1 && engineCode.indexOf('window') === -1);
  t.ok('引擎不读时间', engineCode.indexOf('Date') === -1);
  return bytes + ' bytes';
});

t.done();
