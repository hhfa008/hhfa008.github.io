'use strict';

/*
 * Tests for tools/loan-calculator/index.html
 * Run: node tools/tests/loan-calculator.test.js
 */

var path = require('path');
var fs = require('fs');
var lib = require('./lib.js');

var t = lib.suite('loan-calculator');

var dir = path.join(__dirname, '..', 'loan-calculator');
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
function sum(rows, key) {
  var s = 0;
  for (var i = 0; i < rows.length; i++) { s += rows[i][key]; }
  return s;
}

/* ------------------------------------------------------------------ */
t.group('monthly payment and annuity', function () {
  var pmt = E.monthlyPayment(100000, 6, 360);
  t.near('100000 / 6% / 360月 月供 ≈ 599.55', pmt, 599.55, 0.005);
  t.ok('monthlyPayment is rounded to cents', Math.abs(pmt * 100 - Math.round(pmt * 100)) < 1e-6, 'got ' + pmt);

  var s = E.summarize({ principal: 100000, annualRate: 6, months: 360, method: 'annuity' });
  t.near('总利息 ≈ 115838', s.totalInterest / 100, 115838, 1);
  t.eq('总还款 = 本金 + 总利息 (分)', s.totalPayment, s.totalInterest + s.principal);
  t.eq('首月月供 = 59955 分', s.firstPayment, 59955);
  t.eq('实际还清 360 期', s.actualMonths, 360);
  t.near('利息占本金比例 ≈ 1.15838', s.interestRatio, 1.1583845, 0.0001);
  t.eq('未设置额外还款时节省为 0', s.extraInterestSaved, 0);
  t.eq('未设置额外还款时缩短为 0', s.extraMonthsSaved, 0);

  t.near('0 利率月供 = P/n', E.monthlyPayment(100000, 0, 360), 277.78, 0.005);
  var z = E.summarize({ principal: 100000, annualRate: 0, months: 360, method: 'annuity' });
  t.eq('0 利率总利息为 0', z.totalInterest, 0);
  t.eq('0 利率总还款等于本金', z.totalPayment, 10000000);

  t.near('12% / 12 期 / 1000 的月供', E.monthlyPayment(1000, 12, 12), 88.85, 0.005);
  t.ok('期限越长月供越低',
    E.monthlyPayment(100000, 6, 120) > E.monthlyPayment(100000, 6, 240) &&
    E.monthlyPayment(100000, 6, 240) > E.monthlyPayment(100000, 6, 360));
  t.ok('利率越高月供越高',
    E.monthlyPayment(100000, 0, 360) < E.monthlyPayment(100000, 6, 360) &&
    E.monthlyPayment(100000, 6, 360) < E.monthlyPayment(100000, 12, 360));
  return 'PMT(100000,6%,360) = ' + pmt;
});

/* ------------------------------------------------------------------ */
t.group('equal principal', function () {
  t.near('等额本金首月 = P/n + P*r', E.equalPrincipalFirstPayment(100000, 6, 360), 777.78, 0.005);
  var s = E.summarize({ principal: 100000, annualRate: 6, months: 360, method: 'equal-principal' });
  t.eq('等额本金首月月供 77778 分', s.firstPayment, 77778);
  t.near('等额本金总利息 ≈ P*r*(n+1)/2 = 90250', s.totalInterest / 100, 90250, 2);
  t.ok('等额本金总利息低于等额本息',
    s.totalInterest < E.summarize({ principal: 100000, annualRate: 6, months: 360 }).totalInterest);
  t.eq('等额本金本金合计等于 P', s.totalPrincipal, 10000000);

  var rows = E.buildSchedule({ principal: 100000, annualRate: 6, months: 360, method: 'equal-principal' });
  var decreasing = true;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i].payment > rows[i - 1].payment) { decreasing = false; }
  }
  t.ok('等额本金月供逐月递减', decreasing);
  t.eq('等额本金本金合计逐期精确', sum(rows, 'principal'), 10000000);
  t.eq('等额本金最终余额为 0', rows[rows.length - 1].balance, 0);
  t.eq('等额本金计划覆盖 360 期', rows.length, 360);
  t.near('0 利率等额本金首月 = P/n', E.equalPrincipalFirstPayment(100000, 0, 360), 277.78, 0.005);
  return 'total interest ' + (s.totalInterest / 100);
});

/* ------------------------------------------------------------------ */
t.group('schedule invariants', function () {
  var rows = E.buildSchedule({ principal: 100000, annualRate: 6, months: 360, method: 'annuity' });
  t.eq('计划表覆盖 360 期', rows.length, 360);
  t.eq('计划表本金合计 = P (分)', sum(rows, 'principal'), 10000000);
  t.eq('计划表最终余额 = 0', rows[rows.length - 1].balance, 0);
  var paced = true, nonNeg = true, ints = true;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].period !== i + 1) { paced = false; }
    if (rows[i].balance < 0) { nonNeg = false; }
    if (rows[i].payment !== rows[i].principal + rows[i].interest) { ints = false; }
    if (Math.floor(rows[i].payment) !== rows[i].payment) { ints = false; }
  }
  t.ok('期数从 1 连续到 n', paced);
  t.ok('余额从不为负', nonNeg);
  t.ok('每期 还款 = 本金 + 利息 且为整数分', ints);
  t.eq('首期利息 = P * 6% / 12', rows[0].interest, 50000);
  t.eq('前期本金与利息之和等于月供', rows[0].payment, 59955);

  var last = rows[rows.length - 1];
  t.ok('最后一期只还剩余本金与利息', last.principal === last.balance + last.principal && last.balance === 0);
  t.ok('最后一期期数不超过期限', last.period <= 360);

  var zero = E.buildSchedule({ principal: 100000, annualRate: 0, months: 360 });
  t.ok('0 利率每期利息为 0', zero.every(function (r) { return r.interest === 0; }));
  t.eq('0 利率本金合计等于 P', sum(zero, 'principal'), 10000000);
  t.eq('0 利率最终余额为 0', zero[zero.length - 1].balance, 0);
  return rows.length + ' rows';
});

/* ------------------------------------------------------------------ */
t.group('extra payments', function () {
  var base = E.summarize({ principal: 100000, annualRate: 6, months: 360 });
  var extra = E.summarize({ principal: 100000, annualRate: 6, months: 360, extra: 500 });
  t.ok('额外还款节省利息', extra.extraInterestSaved > 0, String(extra.extraInterestSaved));
  t.ok('额外还款缩短月数', extra.extraMonthsSaved > 0, String(extra.extraMonthsSaved));
  t.ok('额外还款后更早还清', extra.actualMonths < base.actualMonths);
  t.ok('额外还款后总利息更低', extra.totalInterest < base.totalInterest);
  t.eq('对比基准利息等于无额外还款利息', extra.baselineInterest, base.totalInterest);
  t.eq('节省利息 = 基准利息 - 实际利息', extra.extraInterestSaved, base.totalInterest - extra.totalInterest);
  t.eq('缩短月数 = 基准月数 - 实际月数', extra.extraMonthsSaved, base.actualMonths - extra.actualMonths);

  var rows = E.buildSchedule({ principal: 100000, annualRate: 6, months: 360, extra: 500 });
  t.eq('额外还款后本金合计仍等于 P', sum(rows, 'principal'), 10000000);
  t.eq('额外还款后余额归零', rows[rows.length - 1].balance, 0);
  t.eq('额外还款总额等于本金差额', sum(rows, 'extra'), 6055903);
  var payCheck = true;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].payment !== rows[i].principal + rows[i].interest) { payCheck = false; }
  }
  t.ok('额外还款计划每期还款 = 本金 + 利息', payCheck);

  var huge = E.summarize({ principal: 100000, annualRate: 6, months: 360, extra: 200000 });
  t.eq('一次性大额额外还款 1 期还清', huge.actualMonths, 1);
  t.eq('大额额外还款总利息 = 首月利息', huge.totalInterest, 50000);
  t.eq('大额额外还款总还款 = 本金 + 利息', huge.totalPayment, 10050000);
  t.eq('大额额外还款额外金额 = 本金 - 常规本金', huge.totalExtra, 9990045);
  return 'saved ' + (extra.extraInterestSaved / 100) + ', months ' + extra.extraMonthsSaved;
});

/* ------------------------------------------------------------------ */
t.group('validation', function () {
  t.ok('合法输入通过校验', E.validateInputs({ principal: 100000, annualRate: 6, months: 360 }).ok);
  t.ok('0 利率合法', E.validateInputs({ principal: 100000, annualRate: 0, months: 360 }).ok);
  t.ok('0 额外还款合法', E.validateInputs({ principal: 100000, annualRate: 6, months: 360, extra: 0 }).ok);
  t.ok('等额本金合法', E.validateInputs({ principal: 1, annualRate: 0, months: 1, method: 'equal-principal' }).ok);

  t.eq('本金 0 报 principal', E.validateInputs({ principal: 0, annualRate: 6, months: 360 }).error, 'principal');
  t.eq('负利率报 rate', E.validateInputs({ principal: 100, annualRate: -1, months: 12 }).error, 'rate');
  t.eq('利率 101 报 rate', E.validateInputs({ principal: 100, annualRate: 101, months: 12 }).error, 'rate');
  t.eq('期限 0 报 months', E.validateInputs({ principal: 100, annualRate: 6, months: 0 }).error, 'months');
  t.eq('期限 601 报 months', E.validateInputs({ principal: 100, annualRate: 6, months: 601 }).error, 'months');
  t.eq('期限 12.5 报 months', E.validateInputs({ principal: 100, annualRate: 6, months: 12.5 }).error, 'months');
  t.eq('负额外还款报 extra', E.validateInputs({ principal: 100, annualRate: 6, months: 12, extra: -1 }).error, 'extra');
  t.eq('未知还款方式报 method', E.validateInputs({ principal: 100, annualRate: 6, months: 12, method: 'x' }).error, 'method');
  t.eq('非数字本金报 principal', E.validateInputs({ principal: '100', annualRate: 6, months: 12 }).error, 'principal');
  t.eq('NaN 利率报 rate', E.validateInputs({ principal: 100, annualRate: NaN, months: 12 }).error, 'rate');

  t.ok('buildSchedule 本金 0 抛 principal', throwsCode(function () {
    E.buildSchedule({ principal: 0, annualRate: 6, months: 12 });
  }, 'principal'));
  t.ok('buildSchedule 负利率抛 rate', throwsCode(function () {
    E.buildSchedule({ principal: 100, annualRate: -1, months: 12 });
  }, 'rate'));
  t.ok('buildSchedule 期限 0 抛 months', throwsCode(function () {
    E.buildSchedule({ principal: 100, annualRate: 6, months: 0 });
  }, 'months'));
  t.ok('buildSchedule 负额外还款抛 extra', throwsCode(function () {
    E.buildSchedule({ principal: 100, annualRate: 6, months: 12, extra: -1 });
  }, 'extra'));
  t.ok('buildSchedule 未知方式抛 method', throwsCode(function () {
    E.buildSchedule({ principal: 100, annualRate: 6, months: 12, method: 'x' });
  }, 'method'));
  t.ok('monthlyPayment 利率 101 抛 rate', throwsCode(function () {
    E.monthlyPayment(100, 101, 12);
  }, 'rate'));
  t.ok('monthlyPayment 期限 601 抛 months', throwsCode(function () {
    E.monthlyPayment(100, 6, 601);
  }, 'months'));
  t.ok('summarize 缺参数抛 input', throwsCode(function () { E.summarize(null); }, 'input'));
  return 'codes covered';
});

/* ------------------------------------------------------------------ */
t.group('formatting and parsing', function () {
  t.ok('CNY 格式化含千分位与两位小数', E.formatMoney(1234.5, 'CNY', 'zh').indexOf('1,234.50') !== -1,
    E.formatMoney(1234.5, 'CNY', 'zh'));
  t.ok('USD 格式化含 $', E.formatMoney(599.55, 'USD', 'en').indexOf('$599.55') !== -1,
    E.formatMoney(599.55, 'USD', 'en'));
  t.ok('IDR 按印尼格式显示', E.formatMoney(1000, 'IDR', 'id').indexOf('1.000') !== -1,
    E.formatMoney(1000, 'IDR', 'id'));
  t.ok('未知币种回退 CNY', E.formatMoney(10, 'XXX', 'en').length > 0);
  t.eq('parseAmount 去逗号', E.parseAmount('100,000.50'), 100000.5);
  t.eq('parseAmount 去空格', E.parseAmount('1 234'), 1234);
  t.eq('parseAmount 去货币符号', E.parseAmount('¥1,234'), 1234);
  t.eq('parseAmount 接受数字', E.parseAmount(360), 360);
  t.eq('parseAmount 支持科学计数法', E.parseAmount('3e2'), 300);
  t.ok('parseAmount 拒绝文本', isNaN(E.parseAmount('abc')));
  t.ok('parseAmount 拒绝空串', isNaN(E.parseAmount('')));
  t.eq('toCents 按分取整', E.toCents(599.556), 59956);
  t.eq('fromCents 还原', E.fromCents(59955), 599.55);
  return 'Intl + parse helpers';
});

/* ------------------------------------------------------------------ */
t.group('i18n dictionaries', function () {
  lib.checkI18n(t, dict, [
    'docTitle', 'docDesc', 'appTitle', 'privacy', 'amountLabel', 'rateLabel',
    'monthsLabel', 'methodAnnuity', 'methodEqualPrincipal', 'extraLabel',
    'copySummary', 'colPrincipal', 'colBalance', 'viewYearly', 'viewMonthly',
    'errPrincipal', 'errRate', 'errMonths', 'errExtra', 'summaryTitle'
  ]);
  var selfNamed = [];
  ['zh', 'en', 'id'].forEach(function (lang) {
    Object.keys(dict[lang]).forEach(function (k) {
      if (dict[lang][k] === k) { selfNamed.push(lang + '.' + k); }
    });
  });
  t.eq('没有值等于键名', selfNamed, []);

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
    crumbs.itemListElement[2].item, 'https://hhfa008.github.io/tools/loan-calculator/');

  t.ok('有 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  t.ok('有 canonical', /rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/loan-calculator\/"/.test(html));
  t.ok('有非空 title', /<title>[^<]+<\/title>/.test(html));
  t.ok('有 meta description', /meta name="description" content="[^"]{40,}"/.test(html));
  t.ok('有 OG/Twitter 卡片', /property="og:title"/.test(html) && /name="twitter:card"/.test(html));
  t.ok('有 noscript', /<noscript>/.test(html));
  t.ok('有深色模式', /prefers-color-scheme:dark/.test(html));
  t.ok('有 reduced-motion', /prefers-reduced-motion:reduce/.test(html));
  t.ok('表格容器可横向滚动', /\.table-wrap\{[^}]*overflow-x:auto/.test(html));
  t.ok('有复制摘要按钮', /id="copy-summary"/.test(html));
  t.ok('有 CSV 下载按钮', /id="download-csv"/.test(html));
  t.ok('有按年/逐月切换', /id="view-year"/.test(html) && /id="view-month"/.test(html));
  t.ok('脚本包含 engine 与 i18n', /<script id="engine">/.test(html) && /<script id="i18n">/.test(html));

  var bytes = fs.statSync(path.join(dir, 'index.html')).size;
  t.ok('文件 ≤ 90KB', bytes <= 90 * 1024, bytes + ' bytes');
  return bytes + ' bytes';
});

t.done();
