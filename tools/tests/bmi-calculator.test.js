'use strict';

/*
 * Tests for tools/bmi-calculator/index.html.
 * Run with: node tools/tests/bmi-calculator.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var dir = path.join(__dirname, '..', 'bmi-calculator');
var html = lib.page(dir);
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var I = lib.evalScript(html, 'i18n', 'TOOL_I18N');
var t = lib.suite('bmi-calculator');

function throws(fn) {
  try { fn(); return false; } catch (e) { return true; }
}
function throwsType(fn, type) {
  try { fn(); return false; } catch (e) { return e instanceof type; }
}

t.group('BMI 计算', function () {
  t.near('70kg / 175cm = 22.857…', E.bmi(70, 175), 22.857142857142858, 1e-9);
  t.near('70kg / 175cm 显示到 2 位 = 22.86', E.bmi(70, 175), 22.86, 0.005);
  t.near('50kg / 160cm = 19.53125', E.bmi(50, 160), 19.53125, 1e-9);
  t.near('100kg / 200cm = 25', E.bmi(100, 200), 25, 1e-9);
  t.ok('体重为 0 抛错', throws(function () { E.bmi(0, 175); }));
  t.ok('身高为负抛错', throws(function () { E.bmi(70, -1); }));
  t.ok('NaN 体重抛错', throws(function () { E.bmi(NaN, 175); }));
  t.ok('字符串体重抛 TypeError', throwsType(function () { E.bmi('70', 175); }, TypeError));
});

t.group('BMI 分类边界', function () {
  t.eq('18.49 偏瘦', E.bmiCategory(18.49), 'under');
  t.eq('18.5 正常', E.bmiCategory(18.5), 'normal');
  t.eq('24.9 正常', E.bmiCategory(24.9), 'normal');
  t.eq('25 超重', E.bmiCategory(25), 'over');
  t.eq('29.9 超重', E.bmiCategory(29.9), 'over');
  t.eq('30 肥胖', E.bmiCategory(30), 'obese');
  t.eq('35 肥胖', E.bmiCategory(35), 'obese');
  t.ok('NaN 分类抛错', throws(function () { E.bmiCategory(NaN); }));
  t.ok('负数分类抛错', throws(function () { E.bmiCategory(-1); }));
});

t.group('健康体重范围', function () {
  var r = E.healthyWeightRange(175);
  t.near('175cm 下限 = 18.5 × 1.75²', r.min, 56.65625, 1e-9);
  t.near('175cm 上限 = 24.9 × 1.75²', r.max, 76.25625, 1e-9);
  t.ok('下限小于上限', r.min < r.max);
  var r2 = E.healthyWeightRange(160);
  t.near('160cm 下限', r2.min, 47.36, 1e-9);
  t.near('160cm 上限', r2.max, 63.744, 1e-9);
  t.ok('身高 0 抛错', throws(function () { E.healthyWeightRange(0); }));
});

t.group('Mifflin–St Jeor BMR', function () {
  t.near('男 30 岁 175cm 70kg = 1648.75', E.bmrMifflin('male', 70, 175, 30), 1648.75, 1e-9);
  t.near('女 30 岁 175cm 70kg = 1482.75', E.bmrMifflin('female', 70, 175, 30), 1482.75, 1e-9);
  t.near('男女差值 = 166', E.bmrMifflin('male', 70, 175, 30) - E.bmrMifflin('female', 70, 175, 30), 166, 1e-9);
  t.near('20 岁男性 +50 岁差异', E.bmrMifflin('male', 70, 175, 20) - E.bmrMifflin('male', 70, 175, 40), 100, 1e-9);
  t.ok('未知性别抛 TypeError', throwsType(function () { E.bmrMifflin('other', 70, 175, 30); }, TypeError));
  t.ok('负年龄抛错', throws(function () { E.bmrMifflin('male', 70, 175, -1); }));
  t.ok('NaN 年龄抛错', throws(function () { E.bmrMifflin('male', 70, 175, NaN); }));
});

t.group('TDEE 与活动系数', function () {
  t.near('1648.75 × 1.55 = 2555.5625', E.tdee(1648.75, 'moderate'), 2555.5625, 1e-9);
  t.near('久坐系数 1.2', E.tdee(1000, 'sedentary'), 1200, 1e-9);
  t.near('轻度系数 1.375', E.tdee(1000, 'light'), 1375, 1e-9);
  t.near('高度系数 1.725', E.tdee(1000, 'active'), 1725, 1e-9);
  t.near('极高系数 1.9', E.tdee(1000, 'veryActive'), 1900, 1e-9);
  t.near('也接受数字系数', E.tdee(1000, 1.2), 1200, 1e-9);
  t.ok('未知活动代码抛 TypeError', throwsType(function () { E.tdee(1000, 'nope'); }, TypeError));
  t.ok('BMR 为 0 抛错', throws(function () { E.tdee(0, 'moderate'); }));
  t.ok('负系数抛错', throws(function () { E.tdee(1000, -1.2); }));
});

t.group('四个热量目标', function () {
  var g = E.calorieTargets(2500);
  t.near('维持 2500', g.maintain, 2500, 1e-9);
  t.near('温和减脂 2250', g.mildLoss, 2250, 1e-9);
  t.near('减脂 2000', g.loss, 2000, 1e-9);
  t.near('增重 2800', g.gain, 2800, 1e-9);
  t.near('维持 = TDEE', g.maintain, 2500, 0);
  t.near('减脂比维持少 500', g.maintain - g.loss, 500, 1e-9);
  t.near('增重比维持多 300', g.gain - g.maintain, 300, 1e-9);
  t.ok('TDEE 为 0 抛错', throws(function () { E.calorieTargets(0); }));
});

t.group('英制换算', function () {
  t.near('154 lb = 69.85322498 kg', E.kgFromLb(154), 69.85322498000001, 1e-9);
  t.near('1100 lb = 498.951607 kg', E.kgFromLb(1100), 498.951607, 1e-9);
  t.near('5 ft 9 in = 175.26 cm', E.cmFromFtIn(5, 9), 175.26, 1e-9);
  t.near('5 ft 0 in = 152.4 cm', E.cmFromFtIn(5, 0), 152.4, 1e-9);
  t.near('0 ft 107 in = 271.78 cm', E.cmFromFtIn(0, 107), 271.78, 1e-9);
  t.near('154 lb 往返保持', E.kgFromLb(154) / 0.45359237, 154, 1e-9);
  t.near('175.26 cm 往返保持', E.cmFromFtIn(5, 9) / 2.54, 69, 1e-9);
  t.ok('负磅抛错', throws(function () { E.kgFromLb(-1); }));
  t.ok('负英寸抛错', throws(function () { E.cmFromFtIn(5, -1); }));
  t.ok('NaN 英尺抛错', throws(function () { E.cmFromFtIn(NaN, 9); }));
});

t.group('三语字典', function () {
  lib.checkI18n(t, I, [
    'docTitle', 'docDesc', 'appTitle', 'tagline', 'medicalNotice',
    'navTools', 'navGames', 'inputTitle', 'resultsTitle', 'copy',
    'categoryUnder', 'categoryNormal', 'categoryOver', 'categoryObese',
    'healthyRangeLabel', 'bmrLabel', 'tdeeLabel', 'targetsTitle',
    'formulaTitle', 'assumptionsTitle', 'faqTitle', 'footerNote',
    'errHeightMetric', 'errWeightMetric', 'errAge'
  ]);

  var base = Object.keys(I.zh);
  base.forEach(function (k) {
    t.ok('key ' + k + ' is not the value itself', I.zh[k] !== k && I.en[k] !== k && I.id[k] !== k);
  });

  function hasCJK(s) { return /[一-鿿]/.test(s); }
  base.forEach(function (k) {
    t.ok('en.' + k + ' has no untranslated Chinese', !hasCJK(I.en[k]), I.en[k]);
    t.ok('id.' + k + ' has no untranslated Chinese', !hasCJK(I.id[k]), I.id[k]);
  });

  ['zh', 'en', 'id'].forEach(function (lang) {
    t.ok(lang + ' rangeKg has {min} and {max}', I[lang].rangeKg.indexOf('{min}') !== -1 && I[lang].rangeKg.indexOf('{max}') !== -1);
    t.ok(lang + ' rangeLb has {min} and {max}', I[lang].rangeLb.indexOf('{min}') !== -1 && I[lang].rangeLb.indexOf('{max}') !== -1);
  });

  t.ok('中文医疗免责声明完整', I.zh.medicalNotice.indexOf('不构成医疗建议') !== -1);
  t.ok('英文医疗免责声明完整', I.en.medicalNotice.indexOf('not medical advice') !== -1);
});

t.group('data-i 键引用', function () {
  var keys = lib.dataIKeys(html);
  t.ok('页面至少引用 30 个 data-i 键', keys.length >= 30, String(keys.length));
  keys.forEach(function (key) {
    t.ok('zh 存在 ' + key, Object.prototype.hasOwnProperty.call(I.zh, key));
    t.ok('en 存在 ' + key, Object.prototype.hasOwnProperty.call(I.en, key));
    t.ok('id 存在 ' + key, Object.prototype.hasOwnProperty.call(I.id, key));
  });
});

t.group('静态合规', function () {
  var refs = lib.externalRefs(html);
  t.eq('零外部请求', refs, []);
  t.ok('有 viewport', /<meta[^>]+name="viewport"[^>]*>/.test(html));
  t.ok('有 canonical', html.indexOf('<link rel="canonical" href="https://hhfa008.github.io/tools/bmi-calculator/">') !== -1);
  t.ok('有 title', /<title>[^<]{8,}<\/title>/.test(html));
  t.ok('有 meta description', /<meta name="description" content="[^"]{40,}"/.test(html));
  t.ok('默认 lang 为 zh-CN', /<html lang="zh-CN">/.test(html));
  t.ok('有 noscript', html.indexOf('<noscript>') !== -1);
  t.ok('有深色模式', html.indexOf('prefers-color-scheme:dark') !== -1);
  t.ok('有 reduced-motion', html.indexOf('prefers-reduced-motion:reduce') !== -1);
  t.ok('有 OG 标题', html.indexOf('property="og:title"') !== -1);
  t.ok('有 OG 描述', html.indexOf('property="og:description"') !== -1);
  t.ok('有 Twitter card', html.indexOf('name="twitter:card"') !== -1);
  t.ok('有内联 favicon', html.indexOf('rel="icon" href="data:image/svg+xml') !== -1);
  t.ok('有 engine 脚本', html.indexOf('<script id="engine">') !== -1);
  t.ok('有 i18n 脚本', html.indexOf('<script id="i18n">') !== -1);
  t.ok('有 role=alert 错误区', html.indexOf('role="alert"') !== -1);
  t.ok('有 aria-live 结果区', html.indexOf('aria-live="polite"') !== -1);
  t.ok('未使用 innerHTML', html.indexOf('innerHTML') === -1);
  t.ok('未使用 alert(', html.indexOf('alert(') === -1);
  t.ok('未使用 confirm(', html.indexOf('confirm(') === -1);
  t.ok('页脚链接工具大厅', html.indexOf('href="/tools/"') !== -1);
  t.ok('页脚链接桌游', html.indexOf('href="/games/"') !== -1);
  t.ok('页脚链接首页', /<a href="\/" data-i="footerHome">/.test(html));

  var ld = lib.jsonLd(html);
  t.eq('三条 JSON-LD', ld.length, 3);
  t.eq('JSON-LD 类型', ld.map(function (x) { return x['@type']; }), ['SoftwareApplication', 'FAQPage', 'BreadcrumbList']);
  t.eq('SoftwareApplication 免费', ld[0].offers.price, '0');
  t.eq('FAQ 四条', ld[1].mainEntity.length, 4);
  t.eq('面包屑三级', ld[2].itemListElement.length, 3);
  t.ok('JSON-LD URL 正确', ld[0].url === 'https://hhfa008.github.io/tools/bmi-calculator/');

  var size = Buffer.byteLength(html, 'utf8');
  t.ok('文件不超过 90KB', size <= 90 * 1024, size + ' bytes');
});

t.done();
