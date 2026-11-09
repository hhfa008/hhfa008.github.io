'use strict';

/*
 * Tests for tools/json-formatter/index.html
 * Run: node tools/tests/json-formatter.test.js
 */

var path = require('path');
var lib = require('./lib');

var DIR = path.join(__dirname, '..', 'json-formatter');
var html = lib.page(DIR);
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
var t = lib.suite('json-formatter');

t.group('engine · validate', function () {
  var object = E.validate('{"a":1,"b":[true,null]}');
  t.ok('合法对象 ok', object.ok);
  t.eq('合法对象值', object.value.a, 1);
  t.eq('合法对象数组长度', object.value.b.length, 2);

  var array = E.validate('[1,2,3]');
  t.ok('合法数组 ok', array.ok);
  t.eq('合法数组长度', array.value.length, 3);

  t.eq('顶层数字', E.validate('42').value, 42);
  t.eq('顶层字符串', E.validate('"你好😀"').value, '你好😀');
  t.eq('顶层布尔', E.validate('true').value, true);
  t.eq('顶层 null', E.validate('null').value, null);

  t.eq('空字符串错误码', E.validate('').error, 'empty');
  t.eq('纯空白错误码', E.validate('   \n\t').error, 'empty');
  t.eq('非字符串错误码', E.validate(null).error, 'type');

  var trailing = E.validate('{"a":1,}');
  t.ok('尾随逗号非法', !trailing.ok);
  t.eq('尾随逗号错误码', trailing.error, 'invalid');
  t.eq('尾随逗号行', trailing.line, 1);
  t.eq('尾随逗号列', trailing.column, 8);

  var missingComma = E.validate('{"a": 1 "b": 2}');
  t.ok('缺逗号非法', !missingComma.ok);
  t.ok('缺逗号有列号', missingComma.column > 0);

  var trailingArray = E.validate('[1,2,]');
  t.ok('数组尾随逗号非法', !trailingArray.ok);

  var duplicate = E.validate('{"a":1,"a":2}');
  t.ok('重复键仍合法', duplicate.ok);
  t.eq('重复键后者覆盖前者', duplicate.value.a, 2);
  t.eq('重复键摘要只计一个键', E.summarize(duplicate.value).keys, 1);
});

t.group('engine · format', function () {
  var two = E.formatJson('{"b":1,"a":2}', { indent: 2 });
  t.ok('格式化 ok', two.ok);
  t.eq('缩进 2 空格', two.text, '{\n  "b": 1,\n  "a": 2\n}');

  var four = E.formatJson('{"b":1,"a":2}', { indent: 4 });
  t.eq('缩进 4 空格', four.text, '{\n    "b": 1,\n    "a": 2\n}');

  var tab = E.formatJson('{"b":1,"a":2}', { indent: 'tab' });
  t.eq('缩进 Tab', tab.text, '{\n\t"b": 1,\n\t"a": 2\n}');

  var def = E.formatJson('{"b":1,"a":2}');
  t.eq('默认缩进为 2', def.text, two.text);

  var nested = E.formatJson('[1,{"a":2}]', { indent: 2 });
  t.eq('嵌套格式化', nested.text, '[\n  1,\n  {\n    "a": 2\n  }\n]');

  var invalid = E.formatJson('{', { indent: 2 });
  t.ok('非法输入格式化失败', !invalid.ok);
  t.eq('非法输入格式化错误码', invalid.error, 'invalid');

  var mini = E.minify('{\n  "a": 1,\n  "b": [1, 2]\n}');
  t.ok('压缩 ok', mini.ok);
  t.eq('压缩为单行', mini.text, '{"a":1,"b":[1,2]}');

  var numbers = E.minify('{"n": 1.0, "e": 1e3}');
  t.eq('压缩规范化数字', numbers.text, '{"n":1,"e":1000}');

  t.ok('非法输入压缩失败', !E.minify('{').ok);
});

t.group('engine · sortDeep and sortKeys', function () {
  var source = { b: 1, a: 2 };
  var before = JSON.stringify(source);
  var sorted = E.sortDeep(source);
  t.eq('sortDeep 不修改原对象', JSON.stringify(source), before);
  t.eq('sortDeep 排序对象', JSON.stringify(sorted), '{"a":2,"b":1}');

  var deep = E.sortDeep({ b: 1, a: { d: 4, c: 3 }, arr: [3, 1, { z: 1, y: 2 }] });
  t.eq('sortDeep 递归排序', JSON.stringify(deep), '{"a":{"c":3,"d":4},"arr":[3,1,{"y":2,"z":1}],"b":1}');
  t.eq('sortDeep 保持数组顺序', JSON.stringify(deep.arr[0]), '3');

  var formatted = E.formatJson('{"b":1,"a":{"d":4,"c":3},"arr":[3,1],"num":"10"}', { indent: 2, sortKeys: true });
  t.ok('排序格式化 ok', formatted.ok);
  t.eq('排序格式化输出',
    formatted.text,
    '{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "arr": [\n    3,\n    1\n  ],\n  "b": 1,\n  "num": "10"\n}');
  t.ok('排序输出仍是合法 JSON', E.validate(formatted.text).ok);

  var numericKeys = E.formatJson('{"10":1,"2":2,"a":3}', { indent: 2, sortKeys: true });
  t.eq('数字形键按码点排序',
    numericKeys.text,
    '{\n  "10": 1,\n  "2": 2,\n  "a": 3\n}');

  var arrayRoot = E.formatJson('[{"b":1,"a":2},3]', { indent: 2, sortKeys: true });
  t.eq('数组根保持元素顺序',
    arrayRoot.text,
    '[\n  {\n    "a": 2,\n    "b": 1\n  },\n  3\n]');
});

t.group('engine · locateError', function () {
  var parseError;
  try { JSON.parse('{"a":1,}'); } catch (e) { parseError = e; }
  var loc = E.locateError('{"a":1,}', parseError);
  t.eq('V8 错误行', loc.line, 1);
  t.eq('V8 错误列', loc.column, 8);
  t.eq('V8 错误位置', loc.position, 7);
  t.eq('V8 出错行文本', loc.lineText, '{"a":1,}');
  t.eq('V8 caret 对齐', loc.caret, '       ^');

  var positionOnly = E.locateError('{\n  "a": 1,\n}', new Error('Unexpected token } in JSON at position 12'));
  t.eq('仅 position 行', positionOnly.line, 3);
  t.eq('仅 position 列', positionOnly.column, 1);
  t.eq('仅 position 行文本', positionOnly.lineText, '}');

  var lineColumnOnly = E.locateError('{\n  "a": 1,\n}', new Error('Bad value at line 2 column 3'));
  t.eq('仅行列行号', lineColumnOnly.line, 2);
  t.eq('仅行列列号', lineColumnOnly.column, 3);
  t.eq('仅行列推算位置', lineColumnOnly.position, 4);
  t.eq('仅行列行文本', lineColumnOnly.lineText, '  "a": 1,');
  t.eq('仅行列 caret', lineColumnOnly.caret, '  ^');

  var crlf = E.locateError('{\r\n  "a": 1,\r\n}', new Error('Unexpected token } in JSON at position 14'));
  t.eq('CRLF 行号', crlf.line, 3);
  t.eq('CRLF 列号', crlf.column, 1);
  t.eq('CRLF 行文本不含 \\r', crlf.lineText, '}');

  var emojiText = '{"a":"😀",}';
  var emojiError;
  try { JSON.parse(emojiText); } catch (e) { emojiError = e; }
  var emojiLoc = E.locateError(emojiText, emojiError);
  t.eq('emoji 错误位置', emojiLoc.position, 10);
  t.eq('emoji 错误列', emojiLoc.column, 11);
  t.eq('emoji 行文本', emojiLoc.lineText, emojiText);

  var endLoc = E.locateError('{"a":', new Error('Unexpected end of JSON input'));
  t.eq('意外结束位置', endLoc.position, 5);
  t.eq('意外结束列', endLoc.column, 6);
  t.eq('意外结束行文本', endLoc.lineText, '{"a":');
});

t.group('engine · summarize', function () {
  var summary = E.summarize({ a: 1, b: [true, null], c: { d: 'x' } });
  t.eq('摘要节点数', summary.nodes, 7);
  t.eq('摘要键数', summary.keys, 4);
  t.eq('摘要对象数', summary.objects, 2);
  t.eq('摘要数组数', summary.arrays, 1);
  t.eq('摘要最大深度', summary.depth, 2);
  t.eq('摘要根类型', summary.type, 'object');

  var number = E.summarize(42);
  t.eq('原始值节点数', number.nodes, 1);
  t.eq('原始值键数', number.keys, 0);
  t.eq('原始值深度', number.depth, 0);
  t.eq('原始值类型', number.type, 'number');

  t.eq('null 类型', E.summarize(null).type, 'null');
  t.eq('数组类型', E.summarize([]).type, 'array');
  t.eq('字符串类型', E.summarize('x').type, 'string');
  t.eq('布尔类型', E.summarize(false).type, 'boolean');

  var nestedArrays = E.summarize([1, [2]]);
  t.eq('嵌套数组节点数', nestedArrays.nodes, 4);
  t.eq('嵌套数组深度', nestedArrays.depth, 2);
});

t.group('engine · deep nesting', function () {
  var deep = '['.repeat(100) + '1' + ']'.repeat(100);
  var result = E.validate(deep);
  t.ok('100 层数组合法', result.ok);
  var summary = E.summarize(result.value);
  t.eq('100 层节点数', summary.nodes, 101);
  t.eq('100 层最大深度', summary.depth, 100);
  var formatted = E.formatJson(deep, { indent: 2 });
  t.ok('100 层格式化成功', formatted.ok);
  t.ok('100 层输出可再解析', E.validate(formatted.text).ok);
});

t.group('engine · 5 MB limit', function () {
  var atLimit = 'a'.repeat(E.MAX_BYTES);
  var overLimit = 'a'.repeat(E.MAX_BYTES + 1);
  t.eq('MAX_BYTES 常量', E.MAX_BYTES, 5 * 1024 * 1024);
  t.eq('ASCII 字节数', E.byteLength('abc'), 3);
  t.eq('中文 UTF-8 字节数', E.byteLength('你'), 3);
  t.eq('emoji UTF-8 字节数', E.byteLength('😀'), 4);
  t.eq('恰好 5 MB 不超限', E.isTooLarge(atLimit), false);
  t.eq('超过 5 MB 判定', E.isTooLarge(overLimit), true);
  t.eq('validate 拒绝超限', E.validate(overLimit).error, 'too_large');
  t.eq('formatJson 拒绝超限', E.formatJson(overLimit).error, 'too_large');
  t.ok('正常内容不超限', !E.isTooLarge('{"a":1}'));
});

t.group('i18n', function () {
  lib.checkI18n(t, dict, ['docTitle', 'docDesc', 'appTitle', 'inputPh', 'btnFormat', 'validSummary', 'tooLarge', 'noscript']);
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
  t.ok('canonical', /rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/json-formatter\/"/.test(html));
  t.ok('title', /<title>[^<]+<\/title>/.test(html));
  t.ok('meta description', /<meta name="description" content="[^"]+"/.test(html));
  t.ok('og:title', /property="og:title"/.test(html));
  t.ok('twitter card', /name="twitter:card"/.test(html));
  t.ok('dark mode', /prefers-color-scheme:\s*dark/.test(html));
  t.ok('reduced motion', /prefers-reduced-motion/.test(html));
  t.ok('noscript', /<noscript>/.test(html));
  t.ok('无 innerHTML 赋值', !/innerHTML\s*=/.test(html));
  t.ok('无 alert()', !/\balert\s*\(/.test(html));
  t.ok('FileReader 本地读取', /new FileReader\(\)/.test(html));
  t.ok('Blob 下载', /new Blob\(/.test(html));
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
