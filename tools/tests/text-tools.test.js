'use strict';

/*
 * Tests for tools/text-tools/index.html
 * Run: node tools/tests/text-tools.test.js
 */

var path = require('path');
var lib = require('./lib');

var DIR = path.join(__dirname, '..', 'text-tools');
var html = lib.page(DIR);
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
var t = lib.suite('text-tools');

t.group('engine · stats', function () {
  var empty = E.stats('');
  t.eq('空文本 chars', empty.chars, 0);
  t.eq('空文本 charsNoWhitespace', empty.charsNoWhitespace, 0);
  t.eq('空文本 words', empty.words, 0);
  t.eq('空文本 lines', empty.lines, 0);
  t.eq('空文本 sentences', empty.sentences, 0);
  t.eq('空文本 paragraphs', empty.paragraphs, 0);
  t.eq('空文本 reading.minutes', empty.reading.minutes, 0);

  var cn = E.stats('你好世界');
  t.eq('纯中文 chars', cn.chars, 4);
  t.eq('纯中文 charsNoWhitespace', cn.charsNoWhitespace, 4);
  t.eq('纯中文 cjkChars', cn.cjkChars, 4);
  t.eq('纯中文 latinWords', cn.latinWords, 0);
  t.eq('纯中文 words', cn.words, 4);
  t.eq('纯中文 lines', cn.lines, 1);
  t.eq('纯中文 reading.minutes', cn.reading.minutes, 1);

  var mixed = E.stats('Hello 世界 2024');
  t.eq('混合 chars', mixed.chars, 13);
  t.eq('混合 charsNoWhitespace', mixed.charsNoWhitespace, 11);
  t.eq('混合 latinWords', mixed.latinWords, 2);
  t.eq('混合 cjkChars', mixed.cjkChars, 2);
  t.eq('混合 words', mixed.words, 4);
  t.eq('混合 reading.exactMinutes', Math.round(mixed.reading.exactMinutes * 1e6) / 1e6, 0.016667);

  var punct = E.stats('你好。世界！ Hello world. How are you?');
  t.eq('标点句子 sentences', punct.sentences, 4);
  t.eq('标点句子 paragraphs', punct.paragraphs, 1);
  t.eq('标点句子 words', punct.words, 9);

  var crlf = E.stats('a\r\nb\r\n');
  t.eq('CRLF lines', crlf.lines, 3);
  t.eq('CRLF chars', crlf.chars, 6);
  t.eq('CRLF charsNoWhitespace', crlf.charsNoWhitespace, 2);

  var para = E.stats('a\n\nb\n\n\nc\n');
  t.eq('多段落 paragraphs', para.paragraphs, 3);
  t.eq('多段落 lines', para.lines, 7);

  var emoji = E.stats('😀a');
  t.eq('emoji 按码点计', emoji.chars, 2);
  t.eq('emoji 去空白', emoji.charsNoWhitespace, 2);
  t.eq('emoji 后拉丁词', emoji.latinWords, 1);

  var ws = E.stats('a b\nc');
  t.eq('空白统计 chars', ws.chars, 5);
  t.eq('空白统计 charsNoWhitespace', ws.charsNoWhitespace, 3);
  t.eq('空白统计 lines', ws.lines, 2);
});

t.group('engine · reading time', function () {
  var latin = E.readingTime('word '.repeat(200));
  t.eq('200 拉丁词 minutes', latin.minutes, 1);
  t.eq('200 拉丁词 seconds', latin.seconds, 60);
  var cjk = E.readingTime('字'.repeat(300));
  t.eq('300 CJK minutes', cjk.minutes, 1);
  var mix = E.readingTime('w '.repeat(100) + '字'.repeat(150));
  t.eq('混合阅读 minutes', mix.minutes, 1);
  t.near('混合阅读 exactMinutes', mix.exactMinutes, 1, 1e-9);
  t.eq('单字符向上取整', E.readingTime('a').minutes, 1);
  t.eq('空文本阅读 0', E.readingTime('').minutes, 0);
});

t.group('engine · transform', function () {
  t.eq('转大写', E.transform('Hello 世界', 'upper'), 'HELLO 世界');
  t.eq('转小写', E.transform('Hello 世界', 'lower'), 'hello 世界');
  t.eq('标题格式', E.transform('hello world', 'title'), 'Hello World');
  t.eq('标题格式保留缩写', E.transform("dON'T stop", 'title'), "Don't Stop");
  t.eq('标题格式 CJK', E.transform('你好 world', 'title'), '你好 World');
  t.eq('句首大写', E.transform('hello. wORLD! 你好', 'sentence'), 'Hello. World! 你好');
  t.eq('句首大写换行', E.transform('hello\nworld', 'sentence'), 'Hello\nWorld');
  t.eq('去除行首尾空白', E.transform('  a  \r\n\tb\t', 'trimLines'), 'a\nb');
  t.eq('删除空行', E.transform('a\n\n  \nb', 'removeEmptyLines'), 'a\nb');
  t.eq('合并多余空格', E.transform('a   b\t\tc', 'collapseSpaces'), 'a b c');
  t.eq('去重保持首次顺序', E.transform('b\na\nb\nc\na', 'dedupeLines'), 'b\na\nc');
  t.eq('反转行序', E.transform('a\nb\nc', 'reverseLines'), 'c\nb\na');
  t.eq('删除行号前缀', E.transform('1. a\n2) b\n3\tc\n2024 report', 'stripLineNumbers'), 'a\nb\nc\n2024 report');
});

t.group('engine · sort', function () {
  t.eq('升序按码点', E.sortLines('b\nA\na\nB', 'asc'), 'A\nB\na\nb');
  t.eq('降序按码点', E.sortLines('b\na\nc', 'desc'), 'c\nb\na');
  t.eq('补码点排在 BMP 前', E.sortLines('😀\n～', 'asc'), '～\n😀');
  t.eq('排序稳定', E.sortLines('a\nb\na', 'asc'), 'a\na\nb');
  t.eq('sortLines 默认升序', E.sortLines('b\na'), 'a\nb');
  t.eq('transform sortAsc', E.transform('c\na\nb', 'sortAsc'), 'a\nb\nc');
  t.eq('transform sortDesc', E.transform('c\na\nb', 'sortDesc'), 'c\nb\na');
  t.eq('dedupeLines 导出', E.dedupeLines('x\ny\nx'), 'x\ny');
  t.eq('stripLineNumbers 导出', E.stripLineNumbers('10. ten\n11) eleven'), 'ten\neleven');
});

t.group('engine · findReplace', function () {
  t.eq('区分大小写字面量', E.findReplace('foo Foo foo', 'foo', 'x', { caseSensitive: true }), 'x Foo x');
  t.eq('不区分大小写字面量', E.findReplace('foo Foo foo', 'foo', 'x'), 'x x x');
  t.eq('正则捕获引用', E.findReplace('a1 b2', '([a-z])(\\d)', '$2$1', { regex: true }), '1a 2b');
  t.eq('正则不区分大小写', E.findReplace('A a', 'a', 'x', { regex: true }), 'x x');
  t.eq('空查找串不修改', E.findReplace('abc', '', 'x'), 'abc');
  t.eq('字面量中的 $ 不解释', E.findReplace('a', 'a', '$1', {}), '$1');

  var threw = false;
  try {
    E.findReplace('abc', '(', 'x', { regex: true });
  } catch (e) {
    threw = e instanceof SyntaxError;
  }
  t.ok('非法正则抛 SyntaxError', threw);

  var unknown = false;
  try {
    E.transform('abc', 'nope');
  } catch (e) {
    unknown = e instanceof TypeError;
  }
  t.ok('未知 action 抛 TypeError', unknown);
});

t.group('engine · large input', function () {
  var big = 'a '.repeat(125000);
  var stats = E.stats(big);
  t.eq('25 万字符 stats.chars', stats.chars, 250000);
  t.eq('25 万字符 stats.words', stats.words, 125000);
  t.eq('25 万字符 reading.minutes', E.readingTime(big).minutes, 625);
  t.eq('25 万字符 transform 正常', E.transform(big, 'upper').length, 250000);
});

t.group('i18n', function () {
  lib.checkI18n(t, dict, ['docTitle', 'docDesc', 'appTitle', 'inputPh', 'btnUpper', 'readingValue', 'regexError', 'noscript']);
});

t.group('markup i18n keys', function () {
  var used = lib.dataIKeys(html);
  var zhKeys = Object.keys(dict.zh);
  t.ok('存在 data-i 引用', used.length > 20, 'got ' + used.length);
  used.forEach(function (key) {
    t.ok('data-i 键存在: ' + key, zhKeys.indexOf(key) !== -1);
  });
});

t.group('static compliance', function () {
  t.eq('零外部请求', lib.externalRefs(html), []);
  t.ok('viewport', /<meta name="viewport" content="[^"]*width=device-width/.test(html));
  t.ok('canonical', /rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/text-tools\/"/.test(html));
  t.ok('title', /<title>[^<]+<\/title>/.test(html));
  t.ok('meta description', /<meta name="description" content="[^"]+"/.test(html));
  t.ok('og:title', /property="og:title"/.test(html));
  t.ok('twitter card', /name="twitter:card"/.test(html));
  t.ok('dark mode', /prefers-color-scheme:\s*dark/.test(html));
  t.ok('reduced motion', /prefers-reduced-motion/.test(html));
  t.ok('noscript', /<noscript>/.test(html));
  t.ok('无 innerHTML 赋值', !/innerHTML\s*=/.test(html));
  t.ok('无 alert()', !/\balert\s*\(/.test(html));
  t.ok('页脚工具大厅链接', /id="foot-tools"/.test(html));
  t.ok('页脚桌游链接', /id="foot-games"/.test(html));
  t.ok('页脚首页链接', /id="foot-home"/.test(html));
  t.ok('engine 脚本存在', /<script id="engine">/.test(html));
  t.ok('i18n 脚本存在', /<script id="i18n">/.test(html));
  t.ok('语言按钮三个', (html.match(/data-lang="/g) || []).length === 3);

  var lds = lib.jsonLd(html);
  t.ok('JSON-LD 至少三条', lds.length >= 3, 'got ' + lds.length);
  var types = lds.map(function (item) { return item['@type']; });
  t.ok('JSON-LD SoftwareApplication', types.indexOf('SoftwareApplication') !== -1);
  t.ok('JSON-LD FAQPage', types.indexOf('FAQPage') !== -1);
  t.ok('JSON-LD BreadcrumbList', types.indexOf('BreadcrumbList') !== -1);
  var faq = lds.filter(function (item) { return item['@type'] === 'FAQPage'; })[0];
  t.ok('FAQ 至少 3 问', faq && faq.mainEntity && faq.mainEntity.length >= 3, faq ? 'got ' + faq.mainEntity.length : 'missing');

  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('体积 ≤ 90KB', bytes <= 90 * 1024, bytes + ' bytes');
});

t.done();
