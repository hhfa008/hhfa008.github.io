'use strict';

/*
 * Tests for tools/date-calculator/index.html
 * Run: node tools/tests/date-calculator.test.js
 */

var path = require('path');
var fs = require('fs');
var lib = require('./lib.js');

var t = lib.suite('date-calculator');

var dir = path.join(__dirname, '..', 'date-calculator');
var html = lib.page(dir);
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');

function throwsCode(fn, code) {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof TypeError && e.message === code;
  }
}
function d(y, m, day) { return { y: y, m: m, d: day }; }

/* ------------------------------------------------------------------ */
t.group('parse and validate dates', function () {
  t.eq('解析 2024-02-29', E.parseDate('2024-02-29'), d(2024, 2, 29));
  t.eq('解析对象日期', E.parseDate({ y: 2024, m: 2, d: 29 }), d(2024, 2, 29));
  t.eq('拒绝 2024-02-30', E.parseDate('2024-02-30'), null);
  t.eq('拒绝 2023-02-29', E.parseDate('2023-02-29'), null);
  t.eq('拒绝 2024-04-31', E.parseDate('2024-04-31'), null);
  t.eq('拒绝非补零日期', E.parseDate('2024-2-1'), null);
  t.eq('拒绝空串', E.parseDate(''), null);
  t.eq('拒绝非日期文本', E.parseDate('not-a-date'), null);
  t.ok('闰年 2 月 29 日有效', E.isValidDate(2024, 2, 29));
  t.ok('平年 2 月 29 日无效', !E.isValidDate(2023, 2, 29));
  t.ok('4 月 31 日无效', !E.isValidDate(2024, 4, 31));
  t.ok('13 月无效', !E.isValidDate(2024, 13, 1));
  t.ok('0 月无效', !E.isValidDate(2024, 0, 1));
  t.ok('0 日无效', !E.isValidDate(2024, 1, 0));
  t.ok('年份 0 无效', !E.isValidDate(0, 1, 1));
  t.eq('闰年 2 月天数', E.daysInMonth(2024, 2), 29);
  t.eq('平年 2 月天数', E.daysInMonth(2023, 2), 28);
  t.eq('闰年判定 2000', E.isLeap(2000), true);
  t.eq('闰年判定 1900', E.isLeap(1900), false);
  t.eq('闰年判定 2024', E.isLeap(2024), true);
  return 'strict Gregorian validation';
});

/* ------------------------------------------------------------------ */
t.group('ordinals and day differences', function () {
  t.eq('1970-01-01 序数为 0', E.toOrdinal('1970-01-01'), 0);
  t.eq('序数 0 回到 1970-01-01', E.fromOrdinal(0), d(1970, 1, 1));
  t.eq('1969-12-31 序数为 -1', E.toOrdinal('1969-12-31'), -1);
  t.eq('序数往返 2024-02-29', E.fromOrdinal(E.toOrdinal('2024-02-29')), d(2024, 2, 29));
  t.eq('闰日前后相差 2 天', E.diffDays('2024-02-28', '2024-03-01'), 2);
  t.eq('平年闰日前后相差 1 天', E.diffDays('2023-02-28', '2023-03-01'), 1);

  var rnd = lib.mulberry32(42);
  var bad = 0;
  for (var i = 0; i < 300; i++) {
    var y = 1900 + Math.floor(rnd() * 201);
    var m = 1 + Math.floor(rnd() * 12);
    var day = 1 + Math.floor(rnd() * E.daysInMonth(y, m));
    var back = E.fromOrdinal(E.toOrdinal(d(y, m, day)));
    if (back.y !== y || back.m !== m || back.d !== day) { bad++; }
  }
  t.eq('300 个随机日期序数往返一致', bad, 0);
  return 'ordinal round-trips';
});

/* ------------------------------------------------------------------ */
t.group('interval day counts', function () {
  t.eq('2024-01-01 → 2024-03-01 = 60 天', E.diffDays('2024-01-01', '2024-03-01'), 60);
  t.eq('2023-01-01 → 2023-03-01 = 59 天', E.diffDays('2023-01-01', '2023-03-01'), 59);
  t.eq('跨年 2023-12-31 → 2024-01-01 = 1 天', E.diffDays('2023-12-31', '2024-01-01'), 1);
  t.eq('反向差值带负号', E.diffDays('2024-03-01', '2024-01-01'), -60);
  t.eq('同一天相差 0 天', E.diffDays('2024-06-01', '2024-06-01'), 0);
  t.eq('整年 2024-01-01 → 2025-01-01 = 366 天', E.diffDays('2024-01-01', '2025-01-01'), 366);
  t.eq('整年 2023-01-01 → 2024-01-01 = 365 天', E.diffDays('2023-01-01', '2024-01-01'), 365);
  return 'inclusive flag is applied outside this engine';
});

/* ------------------------------------------------------------------ */
t.group('calendar differences', function () {
  t.eq('2024-01-01 → 2024-03-01 = 2 个月 0 天',
    E.calendarDiff('2024-01-01', '2024-03-01'), { years: 0, months: 2, days: 0, totalDays: 60, negative: false });
  t.eq('2024-01-31 → 2024-03-01 = 1 个月 1 天',
    E.calendarDiff('2024-01-31', '2024-03-01'), { years: 0, months: 1, days: 1, totalDays: 30, negative: false });
  t.eq('2000-05-15 → 2024-05-14 = 23 年 11 个月 29 天',
    E.calendarDiff('2000-05-15', '2024-05-14'),
    { years: 23, months: 11, days: 29, totalDays: 8765, negative: false });
  t.eq('整年 = 1 年 0 个月 0 天',
    E.calendarDiff('2024-01-01', '2025-01-01'), { years: 1, months: 0, days: 0, totalDays: 366, negative: false });
  t.eq('同一天 = 0 年 0 个月 0 天',
    E.calendarDiff('2024-06-01', '2024-06-01'), { years: 0, months: 0, days: 0, totalDays: 0, negative: false });
  var rev = E.calendarDiff('2024-01-02', '2024-01-01');
  t.eq('反向日历差标记 negative', rev.negative, true);
  t.eq('反向日历差 totalDays 为负', rev.totalDays, -1);
  t.eq('反向日历差各分量为正', [rev.years, rev.months, rev.days], [0, 0, 1]);
  return 'month stepping';
});

/* ------------------------------------------------------------------ */
t.group('business days', function () {
  t.eq('周一到下周一（不含结束日）5 个工作日',
    E.businessDays('2024-01-01', '2024-01-08'), 5);
  t.eq('周一到下周一（含首尾）6 个工作日',
    E.businessDays('2024-01-01', '2024-01-08', true), 6);
  t.eq('周六到周一（不含结束日）0 个工作日',
    E.businessDays('2024-01-06', '2024-01-08'), 0);
  t.eq('周六到周一（含首尾）1 个工作日',
    E.businessDays('2024-01-06', '2024-01-08', true), 1);
  t.eq('同一周一默认 0 个工作日',
    E.businessDays('2024-01-01', '2024-01-01'), 0);
  t.eq('同一周一含首尾 1 个工作日',
    E.businessDays('2024-01-01', '2024-01-01', true), 1);
  t.eq('周一单日区间（不含结束日）1 个工作日',
    E.businessDays('2024-01-01', '2024-01-02'), 1);
  t.eq('跨夏令时切换的周末不计工作日',
    E.businessDays('2024-03-09', '2024-03-11'), 0);
  t.eq('周末一周围天总数 7，工作日 5，周末 2',
    [E.diffDays('2024-01-01', '2024-01-08'), E.businessDays('2024-01-01', '2024-01-08')], [7, 5]);
  return 'weekday-only counting';
});

/* ------------------------------------------------------------------ */
t.group('add days, months and years', function () {
  t.eq('2024-02-28 加 1 天 = 2024-02-29', E.addDays('2024-02-28', 1), d(2024, 2, 29));
  t.eq('2023-02-28 加 1 天 = 2023-03-01', E.addDays('2023-02-28', 1), d(2023, 3, 1));
  t.eq('2024-01-01 减 1 天 = 2023-12-31', E.addDays('2024-01-01', -1), d(2023, 12, 31));
  t.eq('2024-01-01 加 60 天 = 2024-03-01', E.addDays('2024-01-01', 60), d(2024, 3, 1));

  t.eq('2024-01-31 加 1 月 = 2024-02-29', E.addMonths('2024-01-31', 1), d(2024, 2, 29));
  t.eq('2023-01-31 加 1 月 = 2023-02-28', E.addMonths('2023-01-31', 1), d(2023, 2, 28));
  t.eq('2024-03-31 减 1 月 = 2024-02-29', E.addMonths('2024-03-31', -1), d(2024, 2, 29));
  t.eq('2024-01-31 加 13 月 = 2025-02-28', E.addMonths('2024-01-31', 13), d(2025, 2, 28));
  t.eq('2024-11-30 加 3 月 = 2025-02-28', E.addMonths('2024-11-30', 3), d(2025, 2, 28));
  t.eq('2024-01-15 加 12 月 = 2025-01-15', E.addMonths('2024-01-15', 12), d(2025, 1, 15));
  t.eq('2024-01-31 减 1 月 = 2023-12-31', E.addMonths('2024-01-31', -1), d(2023, 12, 31));

  t.eq('2024-02-29 加 1 年 = 2025-02-28', E.addYears('2024-02-29', 1), d(2025, 2, 28));
  t.eq('2024-02-29 加 4 年 = 2028-02-29', E.addYears('2024-02-29', 4), d(2028, 2, 29));
  t.eq('2024-03-01 减 1 年 = 2023-03-01', E.addYears('2024-03-01', -1), d(2023, 3, 1));

  t.ok('addMonths 非整数抛 number', throwsCode(function () { E.addMonths('2024-01-31', 1.5); }, 'number'));
  t.ok('addDays 非整数抛 number', throwsCode(function () { E.addDays('2024-01-31', '1'); }, 'number'));
  t.ok('addYears 非整数抛 number', throwsCode(function () { E.addYears('2024-02-29', 1.5); }, 'number'));
  t.ok('addDays 无效日期抛 date', throwsCode(function () { E.addDays('2024-02-30', 1); }, 'date'));
  t.ok('addMonths 无效日期抛 date', throwsCode(function () { E.addMonths('2023-02-29', 1); }, 'date'));
  t.ok('超出公元 9999 年抛 range', throwsCode(function () { E.addDays('9999-12-31', 1); }, 'range'));
  return 'clamping verified';
});

/* ------------------------------------------------------------------ */
t.group('weekdays', function () {
  t.eq('2024-01-01 是周一（0）', E.weekdayIndex('2024-01-01'), 0);
  t.eq('2024-01-06 是周六（5）', E.weekdayIndex('2024-01-06'), 5);
  t.eq('2024-01-07 是周日（6）', E.weekdayIndex('2024-01-07'), 6);
  t.eq('2000-01-01 是周六（5）', E.weekdayIndex('2000-01-01'), 5);
  t.eq('1969-12-31 是周三（2）', E.weekdayIndex('1969-12-31'), 2);
  t.eq('2024-03-10 是周日（6，美国夏令时切换日）', E.weekdayIndex('2024-03-10'), 6);
  t.eq('星期索引始终在 0–6', E.weekdayIndex('9999-12-31') >= 0 && E.weekdayIndex('9999-12-31') <= 6, true);
  return 'Monday = 0';
});

/* ------------------------------------------------------------------ */
t.group('age and next birthday', function () {
  var a = E.ageOn('2000-05-15', '2024-05-14');
  t.eq('生日前一天年龄 = 23 年 11 个月 29 天', [a.years, a.months, a.days], [23, 11, 29]);
  t.eq('生日前一天倒计时 1 天', a.daysToNextBirthday, 1);
  t.eq('生日前一天标记 tomorrow', a.isBirthdayTomorrow, true);
  t.eq('生日前一天标记 today = false', a.isBirthdayToday, false);

  var b = E.ageOn('2000-05-15', '2024-05-15');
  t.eq('生日当天年龄 = 24 年 0 个月 0 天', [b.years, b.months, b.days], [24, 0, 0]);
  t.eq('生日当天标记 today', b.isBirthdayToday, true);
  t.eq('生日当天下次生日就是今天', b.nextBirthday, d(2024, 5, 15));

  var c = E.ageOn('2000-05-15', '2024-05-16');
  t.eq('生日后一天年龄 = 24 年 0 个月 1 天', [c.years, c.months, c.days], [24, 0, 1]);
  t.eq('生日后下次生日在明年', c.nextBirthday, d(2025, 5, 15));
  t.eq('生日后倒计时 364 天', c.daysToNextBirthday, 364);

  var e = E.ageOn('2000-02-29', '2024-02-29');
  t.eq('闰日出生者在闰日当天过生日', e.isBirthdayToday, true);
  t.eq('闰日出生者当年 24 岁', e.years, 24);

  var f = E.ageOn('2000-02-29', '2023-03-01');
  t.eq('平年闰日生日按 2 月 28 日处理', f.nextBirthday, d(2024, 2, 29));
  t.eq('平年闰日年龄 = 23 年 0 个月 1 天', [f.years, f.months, f.days], [23, 0, 1]);

  var g = E.ageOn('2000-12-31', '2024-06-01');
  t.eq('生日未到时年龄 = 23 岁', g.years, 23);
  t.eq('生日未到时下次生日在当年', g.nextBirthday, d(2024, 12, 31));

  t.ok('出生晚于计算日期抛 order', throwsCode(function () {
    E.ageOn('2025-01-01', '2024-01-01');
  }, 'order'));
  t.ok('ageOn 无效日期抛 date', throwsCode(function () {
    E.ageOn('2024-02-30', '2024-03-01');
  }, 'date'));
  return 'today / tomorrow / countdown';
});

/* ------------------------------------------------------------------ */
t.group('i18n dictionaries', function () {
  lib.checkI18n(t, dict, [
    'docTitle', 'docDesc', 'appTitle', 'privacy', 'modeInterval', 'modeAdd',
    'modeAge', 'startLabel', 'endLabel', 'inclusiveLabel', 'businessDays',
    'weekendDays', 'addTitle', 'unitDay', 'unitWeek', 'unitMonth', 'unitYear',
    'ageTitle', 'birthLabel', 'nextBirthday', 'birthdayToday', 'birthdayTomorrow',
    'countdownDays', 'errOrder', 'errBirthFuture', 'wd0', 'wd1', 'wd2', 'wd3',
    'wd4', 'wd5', 'wd6', 'copyResult', 'businessNote'
  ]);
  var selfNamed = [];
  ['zh', 'en', 'id'].forEach(function (lang) {
    Object.keys(dict[lang]).forEach(function (k) {
      if (dict[lang][k] === k) { selfNamed.push(lang + '.' + k); }
    });
  });
  t.eq('没有值等于键名', selfNamed, []);
  t.eq('三种语言的星期键一致', ['wd0', 'wd1', 'wd2', 'wd3', 'wd4', 'wd5', 'wd6'].filter(function (k) {
    return Object.prototype.hasOwnProperty.call(dict.zh, k);
  }).length, 7);

  var keys = lib.dataIKeys(html);
  t.ok('页面引用了 data-i 键', keys.length > 20);
  var missing = keys.filter(function (k) { return dict.zh[k] == null; });
  t.eq('所有 data-i / data-i-ph / data-i-aria 键存在于字典', missing, []);
  t.ok('三种语言各有语言按钮', /data-lang="zh"/.test(html) && /data-lang="en"/.test(html) && /data-lang="id"/.test(html));
  return keys.length + ' markup keys';
});

/* ------------------------------------------------------------------ */
t.group('static page compliance', function () {
  var refs = lib.externalRefs(html);
  t.eq('无外部请求', refs, []);

  var ld = lib.jsonLd(html);
  t.eq('JSON-LD 共 3 条', ld.length, 3);
  var types = ld.map(function (x) { return x['@type']; });
  t.ok('含 SoftwareApplication', types.indexOf('SoftwareApplication') !== -1);
  t.ok('含 FAQPage', types.indexOf('FAQPage') !== -1);
  t.ok('含 BreadcrumbList', types.indexOf('BreadcrumbList') !== -1);
  var faq = ld.filter(function (x) { return x['@type'] === 'FAQPage'; })[0];
  t.ok('FAQ 有 3 个问题', faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length === 3);
  var crumbs = ld.filter(function (x) { return x['@type'] === 'BreadcrumbList'; })[0];
  t.eq('面包屑有 3 级', crumbs.itemListElement.length, 3);
  t.eq('面包屑最后一级指向本页',
    crumbs.itemListElement[2].item, 'https://hhfa008.github.io/tools/date-calculator/');

  t.ok('有 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  t.ok('有 canonical', /rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/date-calculator\/"/.test(html));
  t.ok('有非空 title', /<title>[^<]+<\/title>/.test(html));
  t.ok('有 meta description', /meta name="description" content="[^"]{40,}"/.test(html));
  t.ok('有 OG/Twitter 卡片', /property="og:title"/.test(html) && /name="twitter:card"/.test(html));
  t.ok('有 noscript', /<noscript>/.test(html));
  t.ok('有深色模式', /prefers-color-scheme:dark/.test(html));
  t.ok('有 reduced-motion', /prefers-reduced-motion:reduce/.test(html));
  t.ok('日期输入使用 type=date', (html.match(/type="date"/g) || []).length >= 4);
  t.ok('有今天按钮', (html.match(/data-target=/g) || []).length >= 3);
  t.ok('有交换起止日期按钮', /id="swap"/.test(html));
  t.ok('有复制结果按钮', (html.match(/data-copy=/g) || []).length === 3);
  t.ok('脚本包含 engine 与 i18n', /<script id="engine">/.test(html) && /<script id="i18n">/.test(html));

  var bytes = fs.statSync(path.join(dir, 'index.html')).size;
  t.ok('文件 ≤ 90KB', bytes <= 90 * 1024, bytes + ' bytes');
  return bytes + ' bytes';
});

t.done();
