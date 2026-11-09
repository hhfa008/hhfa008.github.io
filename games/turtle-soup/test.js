'use strict';

// AI Turtle Soup. The rules engine lives inline in index.html under
// <script id="engine"> and is extracted here, so the tests always exercise the
// same source the browser runs. No model is loaded and no network is used.

var fs = require('fs');
var path = require('path');
var lib = require('../tests/lib.js');

var s = lib.suite('turtle-soup');
var html = lib.page(__dirname);
var E = lib.evalScript(html, 'engine', 'globalThis.TurtleSoupEngine');
var BANK = require('./soups.js');

function findById(id) {
  for (var i = 0; i < BANK.soups.length; i++) {
    if (BANK.soups[i].id === id) return BANK.soups[i];
  }
  return null;
}

function countDifficulty(level) {
  return BANK.soups.filter(function (soup) { return soup.difficulty === level; }).length;
}

s.group('题库结构', function () {
  s.eq('version 为 1', BANK.version, 1);
  s.eq('共 36 道题', BANK.soups.length, 36);

  var validation = E.validateBank(BANK);
  s.ok('题库校验通过', validation.ok, JSON.stringify(validation.errors.slice(0, 3)));
  s.eq('校验数量为 36', validation.count, 36);
  s.eq('校验无错误', validation.errors, []);

  var ids = BANK.soups.map(function (soup) { return soup.id; });
  s.eq('id 唯一', ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length, 36);
  s.ok('id 命名规范', ids.every(function (id) { return /^(zh|en)-\d{3}$/.test(id); }));
  s.eq('中文题 28 道', BANK.soups.filter(function (soup) { return soup.lang === 'zh'; }).length, 28);
  s.eq('英文题 8 道', BANK.soups.filter(function (soup) { return soup.lang === 'en'; }).length, 8);
  s.ok('难度只有 1/2/3', BANK.soups.every(function (soup) {
    return soup.difficulty === 1 || soup.difficulty === 2 || soup.difficulty === 3;
  }));
  s.ok('每题都有答案关键词', BANK.soups.every(function (soup) {
    return Array.isArray(soup.answerKeywords) && soup.answerKeywords.length > 0;
  }));
  s.ok('每题都有提示', BANK.soups.every(function (soup) {
    return typeof soup.hint === 'string' && soup.hint.trim().length > 0;
  }));
  s.ok('每题三类线索齐全', BANK.soups.every(function (soup) {
    return ['yes', 'no', 'irrelevant'].every(function (kind) {
      return soup.clueRules.some(function (rule) { return rule.answer === kind; });
    });
  }));

  var broken = {
    soups: [{
      id: 'bad-001', lang: 'zh', title: 't', riddle: 'r', truth: 't', hint: 'h',
      difficulty: 2, answerKeywords: ['a'],
      clueRules: [{ keywords: ['a'], answer: 'yes' }]
    }]
  };
  s.ok('缺 no/irrelevant 规则会被发现', E.validateBank(broken).ok === false);
  s.ok('重复 id 会被发现', E.validateBank({ soups: [BANK.soups[0], BANK.soups[0]] }).ok === false);
  s.ok('空题库会被发现', E.validateBank(null).ok === false);
});

s.group('规则裁判 judgeByRules', function () {
  var zh = findById('zh-001');

  s.eq('命中 yes', E.judgeByRules(zh, '和同伴有关吗？').answer, 'yes');
  s.eq('命中人肉 yes', E.judgeByRules(zh, '是不是吃了人肉？').answer, 'yes');
  s.eq('命中 no', E.judgeByRules(zh, '是外星人吗？').answer, 'no');
  s.eq('命中 irrelevant', E.judgeByRules(zh, '老板收了多少钱？').answer, 'irrelevant');
  s.eq('无命中默认无关', E.judgeByRules(zh, '今天天气怎么样？').answer, 'irrelevant');
  s.eq('空问题无关', E.judgeByRules(zh, '   ').answer, 'irrelevant');
  s.eq('空问题 matched=false', E.judgeByRules(zh, '').matched, false);
  s.eq('命中 matched=true', E.judgeByRules(zh, '和同伴有关吗？').matched, true);
  s.eq('来源为规则', E.judgeByRules(zh, '和同伴有关吗？').source, 'rules');
  s.ok('不返回命中关键词', !Object.prototype.hasOwnProperty.call(
    E.judgeByRules(zh, '和同伴有关吗？'), 'keyword'));

  var custom = {
    clueRules: [
      { keywords: ['猫'], answer: 'no' },
      { keywords: ['黑猫'], answer: 'yes' }
    ]
  };
  s.eq('长关键词优先（黑猫）', E.judgeByRules(custom, '黑猫出现了吗？').answer, 'yes');
  s.eq('短关键词仍可用（猫）', E.judgeByRules(custom, '有猫吗？').answer, 'no');

  var reversed = {
    clueRules: [
      { keywords: ['黑猫'], answer: 'yes' },
      { keywords: ['猫'], answer: 'no' }
    ]
  };
  s.eq('长关键词优先与顺序无关', E.judgeByRules(reversed, '黑猫出现了吗？').answer, 'yes');

  s.eq('否定词在前翻转 yes', E.judgeByRules(zh, '不是同伴吗？').answer, 'no');
  s.eq('否定词在后翻转 yes', E.judgeByRules(zh, '和同伴无关吗？').answer, 'no');
  s.eq('否定标记 recorded', E.judgeByRules(zh, '不是同伴吗？').negated, true);
  s.eq('「是不是」不算否定', E.judgeByRules(zh, '是不是因为同伴？').answer, 'yes');
  s.eq('「有没有」不算否定', E.judgeByRules(zh, '有没有同伴？').answer, 'yes');
  s.eq('「不同」不算否定', E.judgeByRules(zh, '不同的同伴出现了吗？').answer, 'yes');

  var negNo = { clueRules: [{ keywords: ['黑猫'], answer: 'no' }] };
  s.eq('否定词翻转 no 为 yes', E.judgeByRules(negNo, '不是黑猫吗？').answer, 'yes');

  var en = findById('en-001');
  s.eq('英文 yes 命中', E.judgeByRules(en, 'Was it a board game?').answer, 'yes');
  s.eq('英文 no 命中', E.judgeByRules(en, 'Was it a real car?').answer, 'no');
  s.eq('英文大小写不敏感', E.judgeByRules(en, 'MONOPOLY?').answer, 'yes');
  s.eq('英文无关命中', E.judgeByRules(en, 'How was the weather?').answer, 'irrelevant');
  s.eq('英文词边界：scar 不命中 car',
    E.judgeByRules({ clueRules: [{ keywords: ['car'], answer: 'no' }] }, 'Did he have a scar?').answer,
    'irrelevant');
  s.eq('英文整词命中 car',
    E.judgeByRules({ clueRules: [{ keywords: ['car'], answer: 'no' }] }, 'Did he see a car?').answer,
    'no');
});

s.group('答案判定 judgeAnswer', function () {
  var zh = findById('zh-001');
  s.eq('命中核心答案', E.judgeAnswer(zh, '当年吃的是同伴的肉').correct, true);
  s.eq('命中关键词子串', E.judgeAnswer(zh, '其实是人肉').correct, true);
  s.eq('命中完整短语', E.judgeAnswer(zh, '同伴牺牲自己救了他').correct, true);
  s.eq('无关答案不通过', E.judgeAnswer(zh, '我不知道').correct, false);
  s.eq('空答案不通过', E.judgeAnswer(zh, '   ').correct, false);
  s.eq('部分词不足以通过', E.judgeAnswer(findById('en-001'), 'hotel').correct, false);
  s.eq('英文答案命中', E.judgeAnswer(findById('en-001'),
    'he landed on a hotel and could not pay rent').correct, true);
  s.eq('英文大小写不敏感', E.judgeAnswer(findById('en-001'), 'PLAYING MONOPOLY').correct, true);
  s.eq('答案来源为规则', E.judgeAnswer(zh, '同伴的肉').source, 'rules');
});

s.group('难度筛选与选题', function () {
  var soups = BANK.soups;
  s.eq('all 返回全部', E.filterByDifficulty(soups, 'all').length, 36);
  s.eq('null 返回全部', E.filterByDifficulty(soups, null).length, 36);
  s.eq('0 返回全部', E.filterByDifficulty(soups, '0').length, 36);
  s.eq('1 星数量', E.filterByDifficulty(soups, 1).length, countDifficulty(1));
  s.eq('2 星数量', E.filterByDifficulty(soups, 2).length, countDifficulty(2));
  s.eq('3 星数量', E.filterByDifficulty(soups, 3).length, countDifficulty(3));
  s.eq('非法难度退回全部', E.filterByDifficulty(soups, '9').length, 36);
  s.ok('1 星结果难度全为 1', E.filterByDifficulty(soups, 1).every(function (soup) {
    return soup.difficulty === 1;
  }));

  var zh = E.soupsForLang(BANK, 'zh');
  var en = E.soupsForLang(BANK, 'en');
  var id = E.soupsForLang(BANK, 'id');
  s.eq('中文题库 28', zh.length, 28);
  s.eq('英文题库 8', en.length, 8);
  s.eq('印尼页面用英文题库', id.length, 8);
  s.ok('中文题库语言一致', zh.every(function (soup) { return soup.lang === 'zh'; }));
  s.ok('印尼题库语言为英文', id.every(function (soup) { return soup.lang === 'en'; }));

  var picked = E.pickSoups(BANK, 'zh', 1);
  s.ok('选题同时按语言和难度过滤', picked.every(function (soup) {
    return soup.lang === 'zh' && soup.difficulty === 1;
  }));
  s.eq('英文 3 星只有 1 题', E.pickSoups(BANK, 'en', 3).length, 1);

  var pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  var progress = { solved: { a: true }, best: {} };
  s.eq('优先未解题目（随机 0）', E.chooseSoup(pool, progress, function () { return 0; }).id, 'b');
  s.eq('优先未解题目（随机 1）', E.chooseSoup(pool, progress, function () { return 0.99; }).id, 'c');
  s.eq('全部解完仍可再选', E.chooseSoup(pool, { solved: { a: true, b: true, c: true }, best: {} },
    function () { return 0; }).id, 'a');
  s.eq('空池返回 null', E.chooseSoup([], progress, function () { return 0; }), null);
  s.eq('无进度时选第一题', E.chooseSoup(pool, E.newProgress(), function () { return 0; }).id, 'a');
  s.eq('随机值 1 不越界', E.chooseSoup(pool, E.newProgress(), function () { return 1; }).id, 'c');
});

s.group('进度与最佳成绩', function () {
  var fresh = E.newProgress();
  s.eq('新进度结构', fresh, { solved: {}, best: {} });
  s.eq('初始已解 0', E.solvedCount(fresh), 0);
  s.eq('未解题目 best 为 null', E.bestFor(fresh, 'zh-001'), null);

  var one = E.recordResult(fresh, 'zh-001', 8);
  s.eq('记录后已解', E.isSolved(one, 'zh-001'), true);
  s.eq('记录最佳 8', E.bestFor(one, 'zh-001'), 8);
  s.eq('已解数量 1', E.solvedCount(one), 1);
  s.eq('原进度未被修改', E.solvedCount(fresh), 0);

  var better = E.recordResult(one, 'zh-001', 5);
  s.eq('更少提问更新最佳', E.bestFor(better, 'zh-001'), 5);
  var worse = E.recordResult(better, 'zh-001', 12);
  s.eq('更多提问不覆盖最佳', E.bestFor(worse, 'zh-001'), 5);

  var zero = E.recordResult(fresh, 'zh-002', -3);
  s.eq('负数提问归零', E.bestFor(zero, 'zh-002'), 0);
  var badCount = E.recordResult(fresh, 'zh-003', 'abc');
  s.eq('非数字提问归零', E.bestFor(badCount, 'zh-003'), 0);

  var two = E.recordResult(one, 'zh-002', 3);
  s.eq('已解数量 2', E.solvedCount(two), 2);
  s.eq('无 id 不记录', E.solvedCount(E.recordResult(fresh, null, 3)), 0);

  var dirty = E.sanitizeProgress({
    solved: { good: true, bad: false },
    best: { good: 4, bad: -1, text: 'x' }
  });
  s.eq('清洗保留有效已解', Object.keys(dirty.solved), ['good']);
  s.eq('清洗保留有效最佳', Object.keys(dirty.best), ['good']);
});

s.group('提示次数', function () {
  s.eq('提示上限 2', E.HINT_LIMIT, 2);
  s.eq('初始剩余 2', E.hintsLeft({ hintsUsed: 0 }), 2);
  s.eq('初始可用', E.canUseHint({ hintsUsed: 0 }), true);

  var first = E.useHint({ hintsUsed: 0, hint: '线索 A' });
  s.eq('第一次成功', first.ok, true);
  s.eq('第一次返回提示文本', first.hint, '线索 A');
  s.eq('第一次记录 1 次', first.hintsUsed, 1);

  var second = E.useHint({ hintsUsed: 1, hint: '线索 A' });
  s.eq('第二次成功', second.ok, true);
  s.eq('第二次记录 2 次', second.hintsUsed, 2);
  s.eq('用完后剩余 0', E.hintsLeft({ hintsUsed: 2 }), 0);

  var third = E.useHint({ hintsUsed: 2, hint: '线索 A' });
  s.eq('第三次被拒绝', third.ok, false);
  s.eq('拒绝后次数不变', third.hintsUsed, 2);
  s.eq('用完不可用', E.canUseHint({ hintsUsed: 2 }), false);
  s.eq('原始状态不变', E.hintsLeft({ hintsUsed: 1 }), 1);
});

var I18N = lib.evalBetween(html,
  '/* === I18N-START === */', '/* === I18N-END === */', 'I18N');
var i18nKeys = lib.checkI18n(s, I18N);

s.group('i18n 与页面标记', function () {
  s.ok('字典至少 80 个键', i18nKeys.length >= 80, 'got ' + i18nKeys.length);

  var required = ['docTitle', 'tagline', 'start', 'questionLabel', 'answerButton',
    'answerYes', 'answerNo', 'answerIrrelevant', 'judgeRules', 'judgeAI',
    'resultTruth', 'again', 'home', 'aiToggleLabel', 'aiEnable'];
  s.eq('关键键缺失', required.filter(function (key) { return i18nKeys.indexOf(key) < 0; }), []);

  var markupKeys = lib.dataIKeys(html);
  s.ok('页面标记含 data-i 键', markupKeys.length > 20, 'got ' + markupKeys.length);
  s.eq('标记键在字典中都有定义',
    markupKeys.filter(function (key) { return i18nKeys.indexOf(key) < 0; }), []);

  function placeholders(text) {
    var out = [];
    String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (_, key) { out.push(key); });
    return out.sort();
  }
  var mismatches = [];
  i18nKeys.forEach(function (key) {
    var zh = placeholders(I18N.zh[key]);
    ['en', 'id'].forEach(function (lang) {
      var other = placeholders(I18N[lang][key]);
      if (JSON.stringify(zh) !== JSON.stringify(other)) {
        mismatches.push(lang + '.' + key + ' ' + JSON.stringify(other) + ' != ' + JSON.stringify(zh));
      }
    });
  });
  s.eq('三语占位符一致', mismatches, []);

  var empty = [];
  ['zh', 'en', 'id'].forEach(function (lang) {
    i18nKeys.forEach(function (key) {
      if (typeof I18N[lang][key] !== 'string' || !I18N[lang][key].trim()) {
        empty.push(lang + '.' + key);
      }
    });
  });
  s.eq('没有空翻译', empty, []);
});

s.group('脚本与离线约束', function () {
  var mainCode = lib.scriptCode(html, 'main');
  var compiled = true;
  var compileError = '';
  try {
    new Function('return (async function () {\n' + mainCode + '\n})');
  } catch (e) {
    compiled = false;
    compileError = e.message;
  }
  s.ok('主脚本语法可解析', compiled, compileError);

  var engineCode = lib.scriptCode(html, 'engine');
  var engineCompiled = true;
  try { new Function(engineCode); } catch (e) { engineCompiled = false; }
  s.ok('引擎脚本语法可解析', engineCompiled);

  var soupSrc = fs.readFileSync(path.join(__dirname, 'soups.js'), 'utf8');
  s.ok('soups.js 支持 node require', /module\.exports\s*=\s*factory\(\)/.test(soupSrc));
  s.ok('soups.js 支持浏览器全局', /root\.SOUP_BANK\s*=\s*factory\(\)/.test(soupSrc));

  s.ok('WebLLM 固定 0.2.87', html.indexOf('@mlc-ai/web-llm@0.2.87') >= 0);
  s.ok('默认模型 ID 正确', html.indexOf('Qwen2.5-0.5B-Instruct-q4f16_1-MLC') >= 0);
  s.ok('更准模型 ID 正确', html.indexOf('Qwen2.5-1.5B-Instruct-q4f16_1-MLC') >= 0);
  s.ok('提供 ModelScope 回退', html.indexOf('modelscope.cn') >= 0);

  var mirrorStart = mainCode.indexOf('function mirrorLibURL');
  var mirrorEnd = mainCode.indexOf('function createEngine');
  var mirrorSource = mirrorStart >= 0 && mirrorEnd > mirrorStart
    ? 'var MODELSCOPE_HOST = "https://modelscope.cn/models/";\n' +
      mainCode.slice(mirrorStart, mirrorEnd) +
      '; return { mirrorLibURL: mirrorLibURL, mirrorAppConfig: mirrorAppConfig };'
    : '';
  var mirror = mirrorSource ? new Function(mirrorSource)() : null;
  s.ok('回退配置可解析', !!mirror);
  if (mirror) {
    var rawWasm = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/' +
      'web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';
    s.eq('raw.githubusercontent wasm 转为 jsdelivr gh',
      mirror.mirrorLibURL(rawWasm),
      'https://cdn.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main/' +
      'web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm');
    s.eq('非 raw wasm 地址保持不变',
      mirror.mirrorLibURL('https://cdn.jsdelivr.net/npm/x.wasm'),
      'https://cdn.jsdelivr.net/npm/x.wasm');
    var mirroredApp = mirror.mirrorAppConfig({
      prebuiltAppConfig: { model_list: [{
        model: 'https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        model_id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        model_lib: rawWasm
      }] }
    });
    s.eq('回退同时改写权重源',
      mirroredApp.model_list[0].model,
      'https://modelscope.cn/models/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/master/');
    s.ok('回退同时改写 model_lib',
      mirroredApp.model_list[0].model_lib.indexOf('https://cdn.jsdelivr.net/gh/') === 0,
      mirroredApp.model_list[0].model_lib);
    s.eq('回退不修改原配置',
      mirroredApp.model_list[0].model_lib === rawWasm, false);
  }

  s.ok('动态 import 只有一处', (mainCode.match(/\bimport\s*\(/g) || []).length === 1);
  s.ok('AI 仅在按钮点击后启动',
    mainCode.indexOf("$('ai-enable').addEventListener('click', startAI)") >= 0);

  var srcs = [];
  html.replace(/<script[^>]*\bsrc="([^"]+)"/g, function (_, src) { srcs.push(src); });
  s.eq('脚本均为同源', srcs, ['soups.js', '/games/shared/share.js']);

  var urls = html.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  var allowed = urls.filter(function (url) {
    return /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@0\.2\.87\//.test(url) ||
      /^https:\/\/cdn\.jsdelivr\.net\/gh\//.test(url) ||
      /^https:\/\/huggingface\.co\//.test(url) ||
      /^https:\/\/modelscope\.cn\//.test(url);
  });
  s.eq('外部 URL 仅限 WebLLM 与模型源', allowed.length, urls.length);
  s.ok('外部 URL 数量受控', urls.length <= 4, urls.join(', '));

  s.ok('分享按钮存在', /data-share-btn/.test(html));
  s.ok('分享脚本带三语名称',
    /data-name-zh="[^"]+"/.test(html) &&
    /data-name-en="[^"]+"/.test(html) &&
    /data-name-id="[^"]+"/.test(html));
  s.ok('aria-live 播报区存在', /aria-live="polite"/.test(html));
  s.ok('问题输入框有 label', /<label[^>]*for="question-input"/.test(html));

  var viewport = html.match(/<meta name="viewport" content="([^"]+)"/);
  s.ok('viewport 适配手机', !!viewport && viewport[1].indexOf('width=device-width') >= 0);

  var swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  s.ok('service worker 预缓存题库与入口',
    swSrc.indexOf("'/games/turtle-soup/soups.js'") >= 0 &&
    swSrc.indexOf("'/games/turtle-soup/'") >= 0 &&
    swSrc.indexOf("'/games/turtle-soup/rules.html'") >= 0);

  var rulesHtml = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('规则页提示次数与计分口径和引擎一致',
    rulesHtml.indexOf('2 次提示') >= 0 &&
    rulesHtml.indexOf('3 次提示') < 0 &&
    rulesHtml.indexOf('提示次数不进入成绩') >= 0);
});

s.done();
