'use strict';

var path = require('path');
var L = require('./lib.js');

var DIR = path.join(__dirname, '..', 'tip-splitter');
var html = L.page(DIR);
var E = L.evalScript(html, 'engine', 'ToolEngine');
var DICT = L.evalScript(html, 'i18n', 'TOOL_I18N');
var engineCode = L.scriptCode(html, 'engine');

var t = L.suite('tip-splitter');
var LANGS = ['zh', 'en', 'id'];

function base(extra) {
  var o = {
    amount: 100,
    taxPct: 0,
    tipPct: 10,
    people: 3,
    tipOnTotal: false,
    rounding: 'exact',
    currency: 'CNY'
  };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

function sum(arr) {
  return arr.reduce(function (a, b) { return a + b; }, 0);
}

function throws(fn, label) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  t.ok(label, threw);
}

t.group('货币单位、舍入与格式化', function () {
  ['computeSplit', 'distribute', 'minorUnit', 'roundMinor', 'formatMoney'].forEach(function (name) {
    t.ok('导出了 ' + name, typeof E[name] === 'function');
  });

  t.eq('CNY 最小单位', E.minorUnit('CNY'), 100);
  t.eq('USD 最小单位', E.minorUnit('USD'), 100);
  t.eq('EUR 最小单位', E.minorUnit('EUR'), 100);
  t.eq('IDR 最小单位', E.minorUnit('IDR'), 1);
  t.eq('未知币种返回 null', E.minorUnit('GBP'), null);

  t.eq('roundMinor 2.4', E.roundMinor(2.4), 2);
  t.eq('roundMinor 2.5 向上', E.roundMinor(2.5), 3);
  t.eq('roundMinor 2.6', E.roundMinor(2.6), 3);
  t.eq('roundMinor 0', E.roundMinor(0), 0);
  throws(function () { E.roundMinor('2'); }, 'roundMinor 拒绝字符串');
  throws(function () { E.roundMinor(NaN); }, 'roundMinor 拒绝 NaN');

  t.eq('formatMoney CNY', E.formatMoney(11000, 'CNY'), '¥110.00');
  t.eq('formatMoney USD 0.05', E.formatMoney(5, 'USD'), '$0.05');
  t.eq('formatMoney IDR 千分位', E.formatMoney(123456, 'IDR'), 'Rp 123,456');
  t.eq('formatMoney EUR 千分位', E.formatMoney(1000000, 'EUR'), '€10,000.00');
  t.eq('formatMoney 负数', E.formatMoney(-5, 'USD'), '-$0.05');
  t.eq('formatMoney 零', E.formatMoney(0, 'CNY'), '¥0.00');
  throws(function () { E.formatMoney(100, 'GBP'); }, 'formatMoney 拒绝未知币种');
  throws(function () { E.formatMoney(1.5, 'CNY'); }, 'formatMoney 要求整数最小单位');
  return '分 / 0 位 IDR';
});

t.group('最大余数法分配', function () {
  t.eq('1000 分给 3 人', E.distribute(1000, 3), [334, 333, 333]);
  t.eq('100 分给 3 人', E.distribute(100, 3), [34, 33, 33]);
  t.eq('0 分给 3 人', E.distribute(0, 3), [0, 0, 0]);
  t.eq('1 分给 2 人', E.distribute(1, 2), [1, 0]);
  t.eq('999 分给 100 人总和', sum(E.distribute(999, 100)), 999);

  var many = E.distribute(999, 100);
  t.ok('999/100 的极差不超过 1', Math.max.apply(null, many) - Math.min.apply(null, many) <= 1);
  t.eq('1000 人分给 100 人', E.distribute(1000, 100).length, 100);

  throws(function () { E.distribute(100, 0); }, '分配拒绝 0 人');
  throws(function () { E.distribute(100, 101); }, '分配拒绝超过 100 人');
  throws(function () { E.distribute(100, 1.5); }, '分配拒绝非整数人数');
  throws(function () { E.distribute(-1, 2); }, '分配拒绝负总额');
  throws(function () { E.distribute(1.5, 2); }, '分配拒绝非整数总额');
  return '分项和恒等于总额';
});

t.group('基础分账', function () {
  var r = E.computeSplit(base());
  t.ok('基础场景成功', r.ok);
  t.eq('账单 100 元 = 10000 分', r.billMinor, 10000);
  t.eq('0 税率', r.taxMinor, 0);
  t.eq('10% 小费 = 1000 分', r.tipMinor, 1000);
  t.eq('应付总额 11000 分', r.exactTotalMinor, 11000);
  t.eq('实收总额 11000 分', r.totalMinor, 11000);
  t.eq('精确模式差额 0', r.diffMinor, 0);
  t.eq('逐人条目数', r.shares.length, 3);
  t.eq('分项之和等于总额', sum(r.shares), 11000);
  t.eq('最小份额', r.minShareMinor, 3666);
  t.eq('最大份额', r.maxShareMinor, 3667);

  var ten = E.computeSplit(base({ amount: 10, tipPct: 0 }));
  t.eq('10 元账单 = 1000 分', ten.billMinor, 1000);
  t.eq('10 元 3 人最大余数', ten.shares, [334, 333, 333]);
  t.eq('10 元 3 人分项和', sum(ten.shares), 1000);

  var noTip = E.computeSplit(base({ tipPct: 0 }));
  t.eq('0 小费', noTip.tipMinor, 0);
  t.eq('0 小费总额', noTip.totalMinor, 10000);

  var fullTip = E.computeSplit(base({ tipPct: 100 }));
  t.eq('100% 小费', fullTip.tipMinor, 10000);
  t.eq('100% 小费总额', fullTip.totalMinor, 20000);

  var zeroBill = E.computeSplit(base({ amount: 0, tipPct: 0, people: 2 }));
  t.ok('0 元账单可用', zeroBill.ok);
  t.eq('0 元总额', zeroBill.totalMinor, 0);
  t.eq('0 元分项', zeroBill.shares, [0, 0]);
  return '100 元 / 10% / 3 人';
});

t.group('税前与含税小费', function () {
  var pre = E.computeSplit(base({ taxPct: 10, tipPct: 10, people: 1, tipOnTotal: false }));
  var inc = E.computeSplit(base({ taxPct: 10, tipPct: 10, people: 1, tipOnTotal: true }));

  t.eq('税前口径税额', pre.taxMinor, 1000);
  t.eq('含税口径税额', inc.taxMinor, 1000);
  t.eq('税前小费', pre.tipMinor, 1000);
  t.eq('含税小费', inc.tipMinor, 1100);
  t.eq('税前小费总额', pre.totalMinor, 12000);
  t.eq('含税小费总额', inc.totalMinor, 12100);
  t.eq('两种口径差额', inc.totalMinor - pre.totalMinor, 100);
  t.eq('税前标记', pre.tipOnTotal, false);
  t.eq('含税标记', inc.tipOnTotal, true);
  return '差额 100 分';
});

t.group('税额与小费舍入', function () {
  var r = E.computeSplit(base({ amount: 19.99, taxPct: 8.25, tipPct: 0 }));
  t.eq('19.99 元 = 1999 分', r.billMinor, 1999);
  t.eq('8.25% 税额 164.9175 → 165', r.taxMinor, 165);
  t.eq('税额加入总额', r.exactTotalMinor, 2164);

  var half = E.computeSplit(base({ amount: 100.10, taxPct: 5, tipPct: 5, people: 1 }));
  t.eq('税额 500.5 向上为 501', half.taxMinor, 501);
  t.eq('小费 500.5 向上为 501', half.tipMinor, 501);
  t.eq('半进位总额', half.exactTotalMinor, 11012);

  var floaty = E.computeSplit(base({ amount: 0.1 + 0.2, tipPct: 0, people: 1 }));
  t.eq('0.1 + 0.2 不产生浮点误差', floaty.billMinor, 30);
  return '0.5 向上';
});

t.group('三种取整方式', function () {
  var up = E.computeSplit(base({ amount: 10, tipPct: 0, people: 3, rounding: 'person-up' }));
  t.eq('每人向上：未取整 1000', up.exactTotalMinor, 1000);
  t.eq('每人向上：每人 334', up.shares, [334, 334, 334]);
  t.eq('每人向上：实收 1002', up.totalMinor, 1002);
  t.eq('每人向上：差额 2', up.diffMinor, 2);
  t.ok('每人向上：差额小于人数 × 最小单位', up.diffMinor < 3);
  t.eq('每人向上：分项和', sum(up.shares), 1002);

  var totalUp = E.computeSplit(base({ amount: 10.03, tipPct: 0, people: 1, rounding: 'total-up' }));
  t.eq('总额取整：未取整 1003', totalUp.exactTotalMinor, 1003);
  t.eq('总额取整：实收 1100', totalUp.totalMinor, 1100);
  t.eq('总额取整：差额 97', totalUp.diffMinor, 97);
  t.eq('总额取整：分项', totalUp.shares, [1100]);

  var exact = E.computeSplit(base({ amount: 10.03, tipPct: 0, people: 1, rounding: 'exact' }));
  t.eq('精确模式实收', exact.totalMinor, 1003);
  t.eq('精确模式差额', exact.diffMinor, 0);

  var idrUp = E.computeSplit(base({ amount: 100000, tipPct: 0, people: 3, currency: 'IDR', rounding: 'person-up' }));
  t.ok('IDR 每人向上差额小于人数', idrUp.diffMinor < 3);
  t.eq('IDR 每人向上分项和', sum(idrUp.shares), idrUp.totalMinor);

  var idrTotal = E.computeSplit(base({ amount: 100000, tipPct: 0, people: 3, currency: 'IDR', rounding: 'total-up' }));
  t.eq('IDR 整元即 1 盾', idrTotal.totalMinor, idrTotal.exactTotalMinor);
  t.eq('IDR 总额取整差额 0', idrTotal.diffMinor, 0);
  return 'exact / person-up / total-up';
});

t.group('IDR 0 位小数与大额', function () {
  var idr = E.computeSplit(base({ amount: 150000, taxPct: 10, tipPct: 10, people: 3, currency: 'IDR' }));
  t.ok('IDR 场景成功', idr.ok);
  t.eq('IDR 小数位为 0', idr.decimals, 0);
  t.eq('IDR 账单', idr.billMinor, 150000);
  t.eq('IDR 税额', idr.taxMinor, 15000);
  t.eq('IDR 小费', idr.tipMinor, 15000);
  t.eq('IDR 总额', idr.totalMinor, 180000);
  t.eq('IDR 分项和', sum(idr.shares), 180000);
  idr.shares.forEach(function (s, i) {
    t.eq('IDR 第 ' + (i + 1) + ' 份为整数', Math.floor(s), s);
  });

  var big = E.computeSplit(base({ amount: 999999.99, taxPct: 10, tipPct: 20, people: 7 }));
  t.ok('大额场景成功', big.ok);
  t.eq('大额分项和等于总额', sum(big.shares), big.totalMinor);
  t.eq('大额总额 = 账单 + 税 + 小费', big.totalMinor, big.billMinor + big.taxMinor + big.tipMinor);
  t.ok('大额总额为正', big.totalMinor > 0);

  var million = E.computeSplit(base({ amount: 1000000, taxPct: 0, tipPct: 0, people: 3 }));
  t.eq('一百万账单', million.billMinor, 100000000);
  t.eq('一百万 3 人分项和', sum(million.shares), 100000000);
  return 'IDR 180000 / 大额 999999.99';
});

t.group('分账不变量（4 币种 × 5 人数 × 3 取整）', function () {
  var currencies = ['CNY', 'USD', 'EUR', 'IDR'];
  var peopleList = [1, 2, 3, 7, 100];
  var modes = ['exact', 'person-up', 'total-up'];

  currencies.forEach(function (currency) {
    peopleList.forEach(function (people) {
      modes.forEach(function (mode) {
        var label = currency + '/' + people + '/' + mode;
        var r = E.computeSplit(base({
          amount: 1234.56, taxPct: 7.5, tipPct: 12.5,
          people: people, rounding: mode, currency: currency
        }));
        t.ok('不变量场景成功 ' + label, r.ok);
        if (!r.ok) return;
        t.eq('分项之和等于总额 ' + label, sum(r.shares), r.totalMinor);
        t.ok('实收不少于应付 ' + label, r.totalMinor >= r.exactTotalMinor);
        if (mode === 'exact') {
          t.eq('精确模式差额为 0 ' + label, r.diffMinor, 0);
        } else if (mode === 'person-up') {
          t.ok('每人向上差额非负 ' + label, r.diffMinor >= 0);
          t.ok('每人向上差额小于人数 ' + label, r.diffMinor < people);
        } else {
          t.ok('总额取整差额小于一个货币单位 ' + label, r.diffMinor < E.minorUnit(currency));
        }
      });
    });
  });
  return '60 个组合 × 3 断言';
});

t.group('非法输入', function () {
  function bad(code, o, label) {
    t.eq(label, E.computeSplit(o).error, code);
  }

  bad('bad-amount', base({ amount: -0.01 }), '负账单');
  bad('bad-amount', base({ amount: NaN }), 'NaN 账单');
  bad('bad-amount', base({ amount: 1e12 + 1 }), '超过上限的账单');
  bad('bad-amount', base({ amount: '100' }), '字符串账单');

  bad('bad-tax', base({ taxPct: -1 }), '负税率');
  bad('bad-tax', base({ taxPct: 101 }), '超过 100% 的税率');
  bad('bad-tax', base({ taxPct: NaN }), 'NaN 税率');

  bad('bad-tip', base({ tipPct: -1 }), '负小费');
  bad('bad-tip', base({ tipPct: 101 }), '超过 100% 的小费');
  bad('bad-tip', base({ tipPct: NaN }), 'NaN 小费');

  bad('bad-people', base({ people: 0 }), '0 人');
  bad('bad-people', base({ people: 101 }), '101 人');
  bad('bad-people', base({ people: 1.5 }), '非整数人数');
  bad('bad-people', base({ people: NaN }), 'NaN 人数');

  bad('bad-currency', base({ currency: 'GBP' }), '未知币种');
  bad('bad-currency', base({ currency: 'cny' }), '大小写不匹配的币种');
  bad('bad-rounding', base({ rounding: 'nearest' }), '未知取整方式');
  bad('bad-options', null, 'null 选项');
  bad('bad-options', undefined, 'undefined 选项');
  bad('bad-currency', {}, '空对象先校验币种');

  t.ok('边界：税率 100 可用', E.computeSplit(base({ taxPct: 100 })).ok);
  t.ok('边界：小费 100 可用', E.computeSplit(base({ tipPct: 100 })).ok);
  t.ok('边界：人数 1 可用', E.computeSplit(base({ people: 1 })).ok);
  t.ok('边界：人数 100 可用', E.computeSplit(base({ people: 100 })).ok);
  return '金额 / 税率 / 人数 / 币种 / 取整';
});

t.group('三语键与 data-i', function () {
  var baseKeys = L.checkI18n(t, DICT, [
    'docTitle', 'docDesc', 'appTitle', 'tagline', 'heroNotice',
    'billLabel', 'taxLabel', 'tipLabel', 'peopleLabel', 'currencyLabel',
    'roundingExact', 'roundingPersonUp', 'roundingTotalUp',
    'collectedOut', 'perPersonOut', 'diffOut', 'sharesTitle',
    'copySplit', 'splitPersonLine', 'errorPeople', 'disclaimer',
    'faqQ1', 'faqA1', 'noscript'
  ]);

  var keys = L.dataIKeys(html);
  t.ok('data-i 键数量足够', keys.length >= 20, String(keys.length));
  keys.forEach(function (k) {
    LANGS.forEach(function (lang) {
      t.ok('data-i 键 ' + k + ' 在 ' + lang + ' 中存在', DICT[lang][k] != null);
    });
  });

  baseKeys.forEach(function (k) {
    LANGS.forEach(function (lang) {
      t.ok(lang + '.' + k + ' 不是键名本身', DICT[lang][k] !== k);
    });
  });
  return baseKeys.length + ' 个键 × 3 语言';
});

t.group('静态合规与 SEO', function () {
  t.eq('无外部请求', L.externalRefs(html), []);
  t.ok('有 viewport', /name="viewport"/.test(html));
  t.ok('有 canonical', /rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/tip-splitter\/"/.test(html));
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
