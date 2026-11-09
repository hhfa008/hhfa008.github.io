'use strict';

/*
 * Tests for tools/pomodoro-timer/index.html.
 * Run with: node tools/tests/pomodoro-timer.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var dir = path.join(__dirname, '..', 'pomodoro-timer');
var html = lib.page(dir);
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var I = lib.evalScript(html, 'i18n', 'TOOL_I18N');
var t = lib.suite('pomodoro-timer');

function throws(fn) {
  try { fn(); return false; } catch (e) { return true; }
}
function throwsType(fn, type) {
  try { fn(); return false; } catch (e) { return e instanceof type; }
}

t.group('默认设置', function () {
  var d = E.defaultSettings();
  t.eq('专注 25 分钟', d.focus, 25);
  t.eq('短休 5 分钟', d.short, 5);
  t.eq('长休 15 分钟', d.long, 15);
  t.eq('每 4 个专注后长休', d.longEvery, 4);
  t.eq('自动开始默认关闭', d.autoStart, false);
  t.eq('提示音默认开启', d.sound, true);
  var d2 = E.defaultSettings();
  d.focus = 99;
  t.eq('每次返回新对象', d2.focus, 25);
});

t.group('设置夹取与回退', function () {
  var a = E.clampSettings({ focus: 0, short: 121, long: -5, longEvery: 1 });
  t.eq('专注下限 1', a.focus, 1);
  t.eq('短休上限 120', a.short, 120);
  t.eq('长休下限 1', a.long, 1);
  t.eq('长休周期下限 2', a.longEvery, 2);

  var b = E.clampSettings({ focus: 121, short: 0, long: 121, longEvery: 9 });
  t.eq('专注上限 120', b.focus, 120);
  t.eq('短休下限 1', b.short, 1);
  t.eq('长休上限 120', b.long, 120);
  t.eq('长休周期上限 8', b.longEvery, 8);

  var c = E.clampSettings({ focus: 25.6, short: '7', long: 15, longEvery: '3' });
  t.eq('小数四舍五入', c.focus, 26);
  t.eq('数字字符串可用', c.short, 7);
  t.eq('长休周期字符串可用', c.longEvery, 3);

  var d = E.clampSettings({ focus: 'abc', short: NaN, long: undefined, longEvery: null });
  t.eq('非法专注回退 25', d.focus, 25);
  t.eq('NaN 短休回退 5', d.short, 5);
  t.eq('undefined 长休回退 15', d.long, 15);
  t.eq('null 长休周期回退 4', d.longEvery, 4);

  var e = E.clampSettings(null);
  t.eq('null 返回默认专注', e.focus, 25);
  var f = E.clampSettings({ autoStart: 1, sound: 0 });
  t.eq('autoStart 转布尔 true', f.autoStart, true);
  t.eq('sound 转布尔 false', f.sound, false);
  var g = E.clampSettings({});
  t.eq('缺省 sound 保持 true', g.sound, true);
  t.eq('缺省 autoStart 保持 false', g.autoStart, false);
});

t.group('阶段时长', function () {
  var s = E.defaultSettings();
  t.eq('默认专注 1500 秒', E.phaseDuration('focus', s), 1500);
  t.eq('默认短休 300 秒', E.phaseDuration('short', s), 300);
  t.eq('默认长休 900 秒', E.phaseDuration('long', s), 900);
  t.eq('自定义专注 50 分钟 = 3000 秒', E.phaseDuration('focus', { focus: 50 }), 3000);
  t.eq('自定义短休 1 分钟 = 60 秒', E.phaseDuration('short', { short: 1 }), 60);
  t.ok('未知阶段抛 TypeError', throwsType(function () { E.phaseDuration('nap', s); }, TypeError));
});

t.group('下一阶段与长休周期', function () {
  var s = { longEvery: 4 };
  t.eq('第 1 个专注后短休', E.nextPhase('focus', 1, s), 'short');
  t.eq('第 3 个专注后短休', E.nextPhase('focus', 3, s), 'short');
  t.eq('第 4 个专注后长休', E.nextPhase('focus', 4, s), 'long');
  t.eq('第 5 个专注后短休', E.nextPhase('focus', 5, s), 'short');
  t.eq('第 8 个专注后长休', E.nextPhase('focus', 8, s), 'long');
  t.eq('短休后回到专注', E.nextPhase('short', 4, s), 'focus');
  t.eq('长休后回到专注', E.nextPhase('long', 8, s), 'focus');
  t.eq('完成数为 0 时短休', E.nextPhase('focus', 0, s), 'short');
  t.eq('自定义每 2 个长休', E.nextPhase('focus', 2, { longEvery: 2 }), 'long');
  t.eq('自定义每 6 个：第 6 个长休', E.nextPhase('focus', 6, { longEvery: 6 }), 'long');
  t.eq('自定义每 6 个：第 4 个短休', E.nextPhase('focus', 4, { longEvery: 6 }), 'short');
  t.ok('未知阶段抛 TypeError', throwsType(function () { E.nextPhase('nap', 1, s); }, TypeError));
});

t.group('formatTime', function () {
  t.eq('1500 秒 = 25:00', E.formatTime(1500), '25:00');
  t.eq('0 秒 = 00:00', E.formatTime(0), '00:00');
  t.eq('59 秒 = 00:59', E.formatTime(59), '00:59');
  t.eq('65 秒 = 01:05', E.formatTime(65), '01:05');
  t.eq('3599 秒 = 59:59', E.formatTime(3599), '59:59');
  t.eq('3600 秒 = 60:00', E.formatTime(3600), '60:00');
  t.eq('6000 秒 = 100:00', E.formatTime(6000), '100:00');
  t.eq('89.9 秒向下取整 = 01:29', E.formatTime(89.9), '01:29');
  t.eq('负数归零', E.formatTime(-5), '00:00');
  t.eq('NaN 归零', E.formatTime(NaN), '00:00');
  t.eq('非数字归零', E.formatTime('abc'), '00:00');
});

t.group('applyTick', function () {
  var s = E.defaultSettings();
  var base = { phase: 'focus', remaining: 100, completed: 0, settings: s };
  var a = E.applyTick(base, 30);
  t.eq('100 秒减 30 秒 = 70', a.remaining, 70);
  t.eq('未结束', a.ended, false);
  t.eq('不修改原 state', base.remaining, 100);

  var b = E.applyTick({ remaining: 70 }, 70);
  t.eq('正好到 0', b.remaining, 0);
  t.eq('触发结束', b.ended, true);

  var c = E.applyTick({ remaining: 10 }, 25);
  t.eq('超过剩余时间仍为 0', c.remaining, 0);
  t.eq('超过剩余时间触发结束', c.ended, true);

  var d = E.applyTick({ remaining: 0 }, 5);
  t.eq('已经为 0 保持 0', d.remaining, 0);
  t.eq('已经为 0 不重复触发结束', d.ended, false);

  var e = E.applyTick({ remaining: 100 }, 0.25);
  t.eq('支持小数秒', e.remaining, 99.75);

  t.ok('负数秒抛 TypeError', throwsType(function () { E.applyTick({ remaining: 10 }, -1); }, TypeError));
  t.ok('NaN 秒抛 TypeError', throwsType(function () { E.applyTick({ remaining: 10 }, NaN); }, TypeError));
  t.ok('非对象 state 抛 TypeError', throwsType(function () { E.applyTick(null, 1); }, TypeError));
  t.ok('缺省 remaining 视为 0', E.applyTick({}, 1).remaining === 0);
});

t.group('progress', function () {
  var s = E.defaultSettings();
  t.eq('开始时进度 0', E.progress({ phase: 'focus', remaining: 1500, settings: s }), 0);
  t.near('过半时进度 0.5', E.progress({ phase: 'focus', remaining: 750, settings: s }), 0.5, 1e-9);
  t.eq('结束时进度 1', E.progress({ phase: 'focus', remaining: 0, settings: s }), 1);
  t.eq('剩余超过总时长夹到 0', E.progress({ phase: 'focus', remaining: 3000, settings: s }), 0);
  t.eq('负剩余夹到 1', E.progress({ phase: 'focus', remaining: -5, settings: s }), 1);
  t.near('自定义 10 分钟剩余 5 分钟 = 0.5', E.progress({ phase: 'focus', remaining: 300, settings: { focus: 10 } }), 0.5, 1e-9);
  t.near('短休进度', E.progress({ phase: 'short', remaining: 150, settings: s }), 0.5, 1e-9);
  t.ok('未知阶段抛 TypeError', throwsType(function () { E.progress({ phase: 'nap', remaining: 10, settings: s }); }, TypeError));
  t.ok('非对象 state 抛 TypeError', throwsType(function () { E.progress(null); }, TypeError));
});

t.group('三语字典', function () {
  lib.checkI18n(t, I, [
    'docTitle', 'docDesc', 'appTitle', 'tagline', 'navTools', 'navGames',
    'phaseFocus', 'phaseShort', 'phaseLong', 'start', 'pause', 'reset', 'skip',
    'statusReady', 'statusRunning', 'statusPaused', 'todayLabel', 'settingsSummary',
    'settingsHint', 'focusLabel', 'shortLabel', 'longLabel', 'longEveryLabel',
    'autoStartLabel', 'soundLabel', 'progressLabel', 'timerLabel',
    'titleFmt', 'rulesTitle', 'faqTitle', 'footerNote', 'footerPrivacy', 'noscript'
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
    t.ok(lang + ' titleFmt has {time}', I[lang].titleFmt.indexOf('{time}') !== -1);
    t.ok(lang + ' titleFmt has {phase}', I[lang].titleFmt.indexOf('{phase}') !== -1);
  });
  t.ok('英文单数番茄单位', I.en.todayUnitOne === 'pomodoro');
  t.ok('英文复数番茄单位', I.en.todayUnit === 'pomodoros');
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
  t.ok('有 canonical', html.indexOf('<link rel="canonical" href="https://hhfa008.github.io/tools/pomodoro-timer/">') !== -1);
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
  t.ok('计时器 role=timer', html.indexOf('role="timer"') !== -1);
  t.ok('进度环 role=progressbar', html.indexOf('role="progressbar"') !== -1);
  t.ok('进度环 aria-valuenow', html.indexOf('aria-valuenow') !== -1);
  t.ok('有 aria-live 播报区', html.indexOf('aria-live="polite"') !== -1);
  t.ok('有设置面板 details', html.indexOf('<details class="card settings"') !== -1);
  t.ok('未使用 innerHTML', html.indexOf('innerHTML') === -1);
  t.ok('未使用 alert(', html.indexOf('alert(') === -1);
  t.ok('未使用 confirm(', html.indexOf('confirm(') === -1);
  t.ok('无 audio 元素', html.indexOf('<audio') === -1);
  t.ok('无 mp3 音频文件', html.indexOf('.mp3') === -1);
  t.ok('无 wav 音频文件', html.indexOf('.wav') === -1);
  t.ok('页脚链接工具大厅', html.indexOf('href="/tools/"') !== -1);
  t.ok('页脚链接桌游', html.indexOf('href="/games/"') !== -1);
  t.ok('页脚链接首页', /<a href="\/" data-i="footerHome">/.test(html));

  var ld = lib.jsonLd(html);
  t.eq('三条 JSON-LD', ld.length, 3);
  t.eq('JSON-LD 类型', ld.map(function (x) { return x['@type']; }), ['SoftwareApplication', 'FAQPage', 'BreadcrumbList']);
  t.eq('SoftwareApplication 免费', ld[0].offers.price, '0');
  t.eq('FAQ 四条', ld[1].mainEntity.length, 4);
  t.eq('面包屑三级', ld[2].itemListElement.length, 3);
  t.ok('JSON-LD URL 正确', ld[0].url === 'https://hhfa008.github.io/tools/pomodoro-timer/');

  var size = Buffer.byteLength(html, 'utf8');
  t.ok('文件不超过 90KB', size <= 90 * 1024, size + ' bytes');
});

t.done();
