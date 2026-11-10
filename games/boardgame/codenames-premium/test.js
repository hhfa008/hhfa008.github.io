'use strict';

/* Codenames Premium engine + page contract tests.
 * Run: node games/boardgame/codenames-premium/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var WORDS = require('./words.js');
var E = require('./engine.js');

var s = lib.suite('codenames-premium');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
var wordsSrc = fs.readFileSync(path.join(__dirname, 'words.js'), 'utf8');
var engineSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
var onlineHtml = fs.readFileSync(path.join(__dirname, 'online.html'), 'utf8');
var detailHtml = fs.readFileSync(path.join(__dirname, 'detail.html'), 'utf8');
var serverSrc = fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8');
var smokeSrc = fs.readFileSync(path.join(__dirname, 'smoke.html'), 'utf8');
var e2eSrc = fs.readFileSync(path.join(__dirname, 'e2e.mjs'), 'utf8');
var meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
var designMd = fs.readFileSync(path.join(__dirname, 'DESIGN.md'), 'utf8');
var e2eMd = fs.readFileSync(path.join(__dirname, 'E2E.md'), 'utf8');
var progressMd = fs.readFileSync(path.join(__dirname, '../progress/sample-codenames.md'), 'utf8');
var swSrc = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
var sharedShuffle = fs.readFileSync(path.join(__dirname, '../../shared/shuffle.js'), 'utf8');
var sharedSfx = fs.readFileSync(path.join(__dirname, '../../shared/sfx.js'), 'utf8');
var assetDir = path.join(__dirname, '../../assets/art/premium/codenames');

function pngSize(file) {
  var b = fs.readFileSync(file);
  if (b.toString('ascii', 1, 4) !== 'PNG') return [0, 0];
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function tinyFonts(source) {
  var hits = [];
  var re = /font-size:([^;}]+)/g;
  var m;
  while ((m = re.exec(source))) {
    var v = m[1].trim();
    var rem = v.match(/^([0-9.]+)rem$/);
    if (rem && parseFloat(rem[1]) < 0.75) hits.push(v);
    var px = v.match(/^([0-9.]+)px$/);
    if (px && parseFloat(px[1]) < 12) hits.push(v);
    var cr = v.match(/^clamp\(\s*([0-9.]+)rem/);
    if (cr && parseFloat(cr[1]) < 0.75) hits.push(v);
    var cp = v.match(/^clamp\(\s*([0-9.]+)px/);
    if (cp && parseFloat(cp[1]) < 12) hits.push(v);
  }
  return hits;
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

var RED9 = [];
var BLUE8 = [];
var NEUTRAL7 = [];
var i;
for (i = 0; i < 9; i++) RED9.push('red');
for (i = 0; i < 8; i++) BLUE8.push('blue');
for (i = 0; i < 7; i++) NEUTRAL7.push('neutral');
var FULL = RED9.concat(BLUE8, NEUTRAL7, ['assassin']);

function crafted(colors) {
  var g = E.createGame({ mode: 'auto', seed: 7 });
  g.words = colors.map(function (c, idx) {
    return { text: '词' + idx, tags: [], color: c, revealed: false };
  });
  g.scores = { red: 0, blue: 0 };
  g.turn = 'red';
  g.phase = 'clue';
  g.clue = null;
  g.guessesLeft = 0;
  g.guessesMade = 0;
  g.winner = null;
  g.turnNo = 1;
  g.log = [];
  g.stats = { clues: 0, guesses: 0, correct: 0, wrong: 0, passes: 0 };
  g.rng = E.mulberry32(5);
  return g;
}

function revealN(g, indexes) {
  indexes.forEach(function (idx) { g.words[idx].revealed = true; });
}

s.group('静态页面与离线约束', function () {
  s.ok('index 引用同源 words.js', /<script[^>]*src="words\.js"/.test(html));
  s.ok('index 引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 script', !/<script[^>]*src="https?:/i.test(html));
  s.ok('无外部样式表', !/<link[^>]*rel=["']?stylesheet/i.test(html));
  s.ok('无 @import', !/@import/i.test(html));
  s.ok('无远程 url()', !/url\(\s*["']?https?:/i.test(html));
  s.ok('无 fetch()', !/\bfetch\s*\(/.test(html));
  s.ok('无 XMLHttpRequest', !/XMLHttpRequest/.test(html));
  s.ok('无 sendBeacon', !/sendBeacon/.test(html));
  s.ok('无外部字体', !/fonts\.(googleapis|gstatic)\.com/i.test(html));
  s.ok('触控目标 >=44px', /min-height:\s*(44|48|52|56)px/.test(html));
  s.ok('词卡最小高度 >=44px', /min-height:\s*58px/.test(html));
  s.ok('存在 aria-label', /aria-label=/.test(html));
  s.ok('存在 aria-live', /aria-live=/.test(html));
  s.ok('有跳到棋盘链接', /class="skip"/.test(html));
  s.ok('5 列词卡网格', /grid-template-columns:\s*repeat\(5,/.test(html));
  s.ok('支持暗色/浅色主题', /prefers-color-scheme/.test(html) && /data-theme/.test(html));
  s.ok('支持 reduced-motion', /prefers-reduced-motion/.test(html));
  s.ok('至少 3 段 keyframes 动画', (html.match(/@keyframes/g) || []).length >= 3);
  s.ok('卡片翻转动画', /rotateY\(180deg\)/.test(html));
  s.ok('WebAudio 合成音效（共享 sfx）',
    /SFX\.play/.test(html) && /AudioContext/.test(sharedSfx) && /createOscillator/.test(sharedSfx));
  s.ok('音效可静音', /soundOn/.test(html) && /音效：开/.test(html));
  s.ok('键盘方向键导航', /ArrowLeft/.test(html) && /ArrowDown/.test(html));
  s.ok('点击卡片入口存在', /addEventListener\('click', onTileClick\)/.test(html));
  s.ok('线索表单存在', /id="clueForm"/.test(html));
  s.ok('队长/队员模式按钮', /id="modeCaptain"/.test(html) && /id="modeOperative"/.test(html));
  s.ok('队长视角切换按钮', /id="viewBtn"/.test(html));
  s.ok('新对局按钮', /id="newBtn"/.test(html));
  s.ok('结算弹层与再来一局', /id="overlay"/.test(html) && /id="overlayAgain"/.test(html));
  s.ok('规则页链接', /href="rules\.html"/.test(html));
});

s.group('词库规模与结构', function () {
  s.ok('词库为 UMD', /module\.exports/.test(wordsSrc) && /CodenamesWords/.test(wordsSrc));
  s.ok('至少 15 个主题分组', WORDS.GROUPS.length >= 15, 'groups=' + WORDS.GROUPS.length);
  s.eq('20 个主题分组', WORDS.GROUPS.length, 20);
  s.ok('至少 250 个唯一词', WORDS.all().length >= 250, 'words=' + WORDS.all().length);
  s.eq('词库大小为 275', WORDS.size(), 275);
  var all = WORDS.all();
  var texts = all.map(function (w) { return w.text; });
  s.eq('所有词唯一', new Set(texts).size, texts.length);
  s.ok('没有空词', all.every(function (w) { return typeof w.text === 'string' && w.text.trim().length > 0; }));
  s.ok('每个词至少一个标签', all.every(function (w) { return w.tags && w.tags.length >= 1; }));
  s.ok('每个分组都有解码别名', WORDS.GROUPS.every(function (g) {
    return g.clues && g.clues.length >= 1;
  }));
  s.ok('每个分组都有词', WORDS.GROUPS.every(function (g) { return g.words.length >= 10; }));
  s.ok('水果分组含苹果', WORDS.GROUPS.some(function (g) {
    return g.name === '水果' && g.words.indexOf('苹果') >= 0;
  }));
  s.ok('词库含多标签词（动物）', all.some(function (w) { return w.tags.indexOf('动物') >= 0; }));
  s.ok('词库含饮食标签', all.some(function (w) { return w.tags.indexOf('饮食') >= 0; }));
});

s.group('引擎 UMD 与棋盘构成', function () {
  s.ok('引擎为 UMD', /module\.exports/.test(engineSrc) && /CodenamesEngine/.test(engineSrc));
  s.ok('引擎导出 createGame', typeof E.createGame === 'function');
  s.ok('引擎导出 applyAction', typeof E.applyAction === 'function');
  s.ok('引擎导出 aiAction', typeof E.aiAction === 'function');
  s.ok('引擎导出 viewFor', typeof E.viewFor === 'function');
  s.eq('词库大小透传', E.wordCount, 275);

  var g = E.createGame({ mode: 'captain', seed: 42 });
  s.eq('25 张词卡', g.words.length, 25);
  var counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
  g.words.forEach(function (w) { counts[w.color]++; });
  s.eq('红 9 / 蓝 8 / 中立 7 / 刺客 1',
    [counts.red, counts.blue, counts.neutral, counts.assassin], [9, 8, 7, 1]);
  s.eq('棋盘 25 词不重复', new Set(g.words.map(function (w) { return w.text; })).size, 25);
  s.eq('红队先手', g.turn, 'red');
  s.eq('开局处于线索阶段', g.phase, 'clue');
  s.eq('开局比分 0:0', [g.scores.red, g.scores.blue], [0, 0]);
  s.eq('红队剩余 9', E.remaining(g, 'red'), 9);
  s.eq('蓝队剩余 8', E.remaining(g, 'blue'), 8);
  s.eq('红队目标 9', E.targetScore('red'), 9);
  s.eq('蓝队目标 8', E.targetScore('blue'), 8);
  s.eq('对手切换', E.other('red'), 'blue');
  s.eq('关键颜色数量', E.KEY_COUNTS, { red: 9, blue: 8, neutral: 7, assassin: 1 });
  s.eq('同种子开局完全一致',
    [g.words.map(function (w) { return w.text; }), g.words.map(function (w) { return w.color; })],
    (function () {
      var h = E.createGame({ mode: 'captain', seed: 42 });
      return [h.words.map(function (w) { return w.text; }), h.words.map(function (w) { return w.color; })];
    }()));
  s.ok('不同种子开局不同',
    E.createGame({ seed: 1 }).words.map(function (w) { return w.text; }).join() !==
    E.createGame({ seed: 2 }).words.map(function (w) { return w.text; }).join());
});

s.group('隐藏信息与视图', function () {
  var g = E.createGame({ mode: 'operative', seed: 43 });
  var pub = E.publicView(g);
  var cap = E.captainView(g);
  s.eq('公共视图隐藏未翻开颜色',
    pub.words.every(function (w) { return w.revealed || w.color === 'hidden'; }), true);
  s.ok('公共视图至少有一张隐藏牌', pub.words.some(function (w) { return w.color === 'hidden'; }));
  s.eq('公共视图不泄露主题标签',
    pub.words.every(function (w) { return w.tags.length === 0; }), true);
  s.eq('队长视图展示全部颜色',
    cap.words.every(function (w) { return w.color !== 'hidden'; }), true);
  s.eq('队长视图包含主题标签',
    cap.words.every(function (w) { return w.tags.length >= 1; }), true);
  s.eq('公共视图 keyVisible=false', pub.keyVisible, false);
  s.eq('队长视图 keyVisible=true', cap.keyVisible, true);
  s.ok('视图是独立副本', pub.words !== g.words && cap.words !== g.words);
  pub.words[0].text = '被篡改';
  s.ok('修改视图不影响引擎状态', g.words[0].text !== '被篡改');

  g.words[0].revealed = true;
  s.eq('已翻开的词在公共视图可见颜色', E.publicView(g).words[0].color, g.words[0].color);
  g.phase = 'over';
  g.winner = 'red';
  var over = E.publicView(g);
  s.eq('对局结束公开全部颜色',
    over.words.every(function (w) { return w.color !== 'hidden'; }), true);
  s.eq('对局结束公开主题标签',
    over.words.every(function (w) { return w.tags.length >= 1; }), true);
});

s.group('线索合法性', function () {
  var g = crafted(FULL);
  s.eq('合法线索通过', E.validClue(g, '水果', 2), true);
  s.eq('空线索拒绝', E.validClue(g, '  ', 1), false);
  s.eq('含空格线索拒绝', E.validClue(g, '水 果', 1), false);
  s.eq('超长线索拒绝', E.validClue(g, '这是一个非常非常非常非常长的线索', 1), false);
  s.eq('场上词作线索拒绝', E.validClue(g, '词3', 1), false);
  s.eq('数字 0 拒绝', E.validClue(g, '水果', 0), false);
  s.eq('数字 10 拒绝', E.validClue(g, '水果', 10), false);
  s.eq('非整数数字拒绝', E.validClue(g, '水果', 1.5), false);
  s.eq('非字符串线索拒绝', E.validClue(g, 123, 1), false);
  s.eq('纯符号线索拒绝', E.validClue(g, '!!!', 1), false);

  var r = E.applyAction(g, { type: 'clue', text: '提示', count: 2 });
  s.eq('提交线索成功', r.ok, true);
  s.eq('进入猜词阶段', g.phase, 'guess');
  s.eq('猜词次数 = 数字 + 1', g.guessesLeft, 3);
  s.eq('线索记录归属红队', g.clue.team, 'red');
  s.eq('线索事件类型', r.events[0].type, 'clue');
  s.eq('线索事件数字', r.events[0].count, 2);
  s.eq('猜词阶段不能再给线索',
    E.applyAction(g, { type: 'clue', text: '再来', count: 1 }).ok, false);
  s.eq('线索阶段不能直接猜词',
    E.applyAction(crafted(FULL), { type: 'guess', index: 0 }).ok, false);
});

s.group('翻牌结算', function () {
  var g = crafted(FULL);
  E.applyAction(g, { type: 'clue', text: '提示', count: 2 });
  var r = E.applyAction(g, { type: 'guess', index: 0 });
  s.eq('猜中己方词成功', r.ok, true);
  s.eq('己方词得分', g.scores.red, 1);
  s.eq('己方词翻面', g.words[0].revealed, true);
  s.eq('猜词次数递减', g.guessesLeft, 2);
  s.eq('已猜次数递增', g.guessesMade, 1);
  s.eq('翻牌事件颜色', r.events[0].color, 'red');
  s.eq('翻牌事件 correct=true', r.events[0].correct, true);

  E.applyAction(g, { type: 'guess', index: 9 });
  s.eq('翻到对方词给对方加分', g.scores.blue, 1);
  s.eq('猜错立即换边', g.turn, 'blue');
  s.eq('换边后回到线索阶段', g.phase, 'clue');
  s.eq('换边后清空线索', g.clue, null);
  s.eq('换边后回合数 +1', g.turnNo, 2);

  var n = crafted(FULL);
  E.applyAction(n, { type: 'clue', text: '提示', count: 1 });
  var nr = E.applyAction(n, { type: 'guess', index: 17 });
  s.eq('中立词不加分', n.scores.red, 0);
  s.eq('中立词结束回合', n.turn, 'blue');
  s.eq('中立事件 correct=false', nr.events[0].correct, false);

  var a = crafted(FULL);
  E.applyAction(a, { type: 'clue', text: '提示', count: 2 });
  var ar = E.applyAction(a, { type: 'guess', index: 24 });
  s.eq('刺客立即结束对局', a.phase, 'over');
  s.eq('红队踩刺客则蓝队胜', a.winner, 'blue');
  s.eq('刺客事件触发胜利', ar.events.some(function (e) { return e.type === 'win'; }), true);
  s.eq('刺客事件原因', ar.events.filter(function (e) { return e.type === 'win'; })[0].reason, 'assassin');
  s.eq('结束后不能再行动', E.applyAction(a, { type: 'guess', index: 0 }).ok, false);

  var m = crafted(FULL);
  E.applyAction(m, { type: 'clue', text: '提示', count: 1 });
  E.applyAction(m, { type: 'guess', index: 0 });
  E.applyAction(m, { type: 'guess', index: 1 });
  s.eq('数字 1 最多猜 2 次后换边', m.turn, 'blue');
  s.eq('换边后猜词次数归零', m.guessesLeft, 0);

  s.eq('不能重复翻已翻开的词',
    E.applyAction(g, { type: 'guess', index: 9 }).ok, false);
  s.eq('越界索引拒绝',
    E.applyAction(crafted(FULL), { type: 'guess', index: 99 }).ok, false);
  s.eq('负数索引拒绝',
    E.applyAction(crafted(FULL), { type: 'guess', index: -1 }).ok, false);
});

s.group('主动停止猜词', function () {
  var g = crafted(FULL);
  E.applyAction(g, { type: 'clue', text: '提示', count: 3 });
  s.eq('未猜前不能停止', E.applyAction(g, { type: 'pass' }).ok, false);
  E.applyAction(g, { type: 'guess', index: 0 });
  var r = E.applyAction(g, { type: 'pass' });
  s.eq('猜一次后可以停止', r.ok, true);
  s.eq('停止后换边', g.turn, 'blue');
  s.eq('停止事件触发', r.events[0].type, 'pass');
  s.eq('停止进入线索阶段', g.phase, 'clue');
  s.eq('线索阶段不能停止',
    E.applyAction(crafted(FULL), { type: 'pass' }).ok, false);
});

s.group('胜利条件与计分', function () {
  var g = crafted(FULL);
  revealN(g, [0, 1, 2, 3, 4, 5, 6, 7]);
  g.scores.red = 8;
  E.applyAction(g, { type: 'clue', text: '最后一词', count: 1 });
  E.applyAction(g, { type: 'guess', index: 8 });
  s.eq('红队第 9 词获胜', g.winner, 'red');
  s.eq('红队胜利后 phase=over', g.phase, 'over');
  s.eq('红队胜利比分 9', g.scores.red, 9);

  var b = crafted(FULL);
  revealN(b, [9, 10, 11, 12, 13, 14, 15]);
  b.scores.blue = 7;
  b.turn = 'blue';
  E.applyAction(b, { type: 'clue', text: '最后一词', count: 1 });
  E.applyAction(b, { type: 'guess', index: 16 });
  s.eq('蓝队第 8 词获胜', b.winner, 'blue');
  s.eq('蓝队胜利比分 8', b.scores.blue, 8);

  var x = crafted(FULL);
  revealN(x, [9, 10, 11, 12, 13, 14, 15]);
  x.scores.blue = 7;
  E.applyAction(x, { type: 'clue', text: '送分', count: 1 });
  E.applyAction(x, { type: 'guess', index: 16 });
  s.eq('红队翻开蓝队最后词则蓝队胜', x.winner, 'blue');
  s.eq('蓝队送分后比分 8', x.scores.blue, 8);

  var s1 = crafted(FULL);
  revealN(s1, [0, 1, 2]);
  s1.scores.red = 3;
  s1.guessesMade = 1;
  s1.phase = 'guess';
  var v = E.publicView(s1);
  s.eq('比分等于已翻开己方词', v.scores.red, 3);
  s.eq('剩余等于目标减比分', v.remaining.red, 6);
  s.eq('剩余目标一致', v.remaining.red + v.scores.red, v.target.red);
});

s.group('AI 合法性', function () {
  var g = crafted(FULL);
  var clue = E.aiClue(g);
  s.ok('AI 能给出线索', !!clue && clue.type === 'clue');
  s.eq('AI 线索合法', E.validClue(g, clue.text, clue.count), true);
  s.ok('AI 线索数字 1–9', clue.count >= 1 && clue.count <= 9, 'count=' + clue.count);
  s.eq('AI 线索不是场上词',
    g.words.some(function (w) { return w.text === clue.text; }), false);

  var c2 = E.applyAction(g, clue);
  s.eq('AI 线索可被引擎接受', c2.ok, true);

  var before = g.rng;
  var guess = E.aiGuess(g);
  s.ok('AI 能给出猜词', !!guess && guess.type === 'guess');
  s.ok('AI 猜词索引合法', Number.isInteger(guess.index) && guess.index >= 0 && guess.index < 25);
  s.eq('AI 不猜已翻开的词', g.words[guess.index].revealed, false);
  void before;

  var over = crafted(FULL);
  over.phase = 'over';
  over.winner = 'red';
  s.eq('结束后 AI 返回 null', E.aiAction(over), null);

  var noPeekA = crafted(FULL);
  var noPeekB = crafted(FULL);
  noPeekA.words.forEach(function (w, idx) {
    w.tags = ['水果'];
    noPeekB.words[idx].tags = ['水果'];
    noPeekA.words[idx].revealed = false;
    noPeekB.words[idx].revealed = false;
  });
  // Same tags, same clue, same RNG; only the hidden colours are swapped.
  noPeekB.words = noPeekB.words.map(function (w, idx) {
    return { text: w.text, tags: w.tags, color: noPeekA.words[(idx + 5) % 25].color, revealed: false };
  });
  noPeekA.phase = noPeekB.phase = 'guess';
  noPeekA.clue = noPeekB.clue = { text: '水果', count: 3, team: 'red' };
  noPeekA.rng = E.mulberry32(77);
  noPeekB.rng = E.mulberry32(77);
  s.eq('AI 猜词不读取隐藏颜色', E.aiGuess(noPeekA).index, E.aiGuess(noPeekB).index);

  var sameA = E.createGame({ mode: 'auto', seed: 55 });
  var sameB = E.createGame({ mode: 'auto', seed: 55 });
  var clueA = E.aiClue(sameA);
  var clueB = E.aiClue(sameB);
  s.eq('同种子 AI 线索文本一致', clueA.text, clueB.text);
  s.eq('同种子 AI 线索数字一致', clueA.count, clueB.count);
});

s.group('30 局 AI 自对弈', function () {
  var wins = { red: 0, blue: 0, none: 0 };
  var maxActions = 0;
  var allLegal = true;
  var allCluesValid = true;
  var allFinished = true;
  var actionTypes = { clue: 0, guess: 0, pass: 0 };
  for (var game = 0; game < 30; game++) {
    var g = E.createGame({ mode: 'auto', seed: 3000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 500) {
      var act = E.aiAction(g);
      if (!act) { allLegal = false; break; }
      if (act.type === 'clue' && !E.validClue(g, act.text, act.count)) allCluesValid = false;
      var r = E.applyAction(g, act);
      if (!r.ok) { allLegal = false; break; }
      actionTypes[act.type] = (actionTypes[act.type] || 0) + 1;
      steps++;
    }
    maxActions = Math.max(maxActions, steps);
    if (!E.isOver(g)) allFinished = false;
    if (g.winner === 'red') wins.red++;
    else if (g.winner === 'blue') wins.blue++;
    else wins.none++;
  }
  s.eq('30 局全部动作合法', allLegal, true);
  s.eq('30 局所有线索合法', allCluesValid, true);
  s.eq('30 局全部正常结束', allFinished, true);
  s.eq('30 局都有胜者', wins.none, 0);
  s.ok('红蓝双方都有胜局', wins.red > 0 && wins.blue > 0, JSON.stringify(wins));
  s.ok('单局动作数有界（<500）', maxActions < 500, 'max=' + maxActions);
  s.ok('AI 会使用线索动作', actionTypes.clue > 0);
  s.ok('AI 会使用猜词动作', actionTypes.guess > 0);
  s.ok('AI 会主动停止', actionTypes.pass > 0);
});

s.group('人机身份与流程', function () {
  var cap = E.createGame({ mode: 'captain', seed: 5 });
  s.eq('队长模式开局需要人类给线索', E.needsHuman(cap), true);
  E.applyAction(cap, { type: 'clue', text: '测试', count: 1 });
  s.eq('队长给线索后交给 AI 猜词', E.needsHuman(cap), false);

  var op = E.createGame({ mode: 'operative', seed: 6 });
  s.eq('队员模式开局由 AI 给线索', E.needsHuman(op), false);
  E.applyAction(op, E.aiAction(op));
  s.eq('AI 给线索后轮到人类猜词', E.needsHuman(op), true);
  var wrongIndex = -1;
  for (i = 0; i < op.words.length; i++) {
    if (!op.words[i].revealed && op.words[i].color !== 'red') { wrongIndex = i; break; }
  }
  E.applyAction(op, { type: 'guess', index: wrongIndex });
  s.eq('人类猜错后进入 AI 回合', E.needsHuman(op), false);

  var auto = E.createGame({ mode: 'auto', seed: 7 });
  s.eq('auto 模式不需要人类', E.needsHuman(auto), false);
  var acts = E.autoRun(auto);
  s.ok('autoRun 返回动作序列', acts.length > 0);
  s.eq('autoRun 结束对局', E.isOver(auto), true);
  s.eq('自动对局有胜者', ['red', 'blue'].indexOf(auto.winner) >= 0, true);
});

s.group('ART-GUIDE §1/§2/§6 视觉复核', function () {
  var symbols = html.match(/<symbol id="[^"]+"/g) || [];
  s.ok('内联 SVG symbol 图标 >=8 个', symbols.length >= 8, 'symbols=' + symbols.length);
  s.ok('SVG 使用 24×24 标准 viewBox',
    (html.match(/viewBox="0 0 24 24"/g) || []).length >= 8);
  s.ok('角色图标含旗帜/菱形/骷髅',
    /id="icon-flag"/.test(html) && /id="icon-diamond"/.test(html) && /id="icon-skull"/.test(html));
  s.ok('图标通过 use 引用', /<use href="#icon-/.test(html));
  s.ok('无 raster img 标签', !/<img\b/i.test(html));
  s.ok('无远程背景图', !/background(?:-image)?:[^;]*url\(\s*["']?https?:/i.test(html));
  s.ok('词卡字体 Songti SC', /--font-card:\s*"Songti SC"/.test(html));
  s.ok('词卡字重 Bold(700)', /\.tile-word\{[^}]*font-weight:\s*700/.test(html));
  s.ok('卡面纸纤维纹理（SVG turbulence）',
    /feTurbulence/.test(html) && /--paper-grain/.test(html));
  s.ok('左上主光渐变', /linear-gradient\(135deg,rgba\(255,255,255/.test(html));
  s.ok('卡面高光与内阴影',
    /inset 1px 1px 0/.test(html) && /inset -1px -1px 0/.test(html));
  s.ok('桌面材质与左上补光', /--table-a/.test(html) && /radial-gradient\(circle at 16% 6%/.test(html));
  s.ok('5×5 局面由代码生成',
    /function buildBoard\(\)/.test(html) && /i < 25; i\+\+/.test(html));
  s.ok('HTML 无静态词卡', (html.match(/class="tile"/g) || []).length === 0);
  s.ok('件数由状态计算',
    /function updatePieceSummary\(\)/.test(html) &&
    /counts\.red/.test(html) && /counts\.assassin/.test(html));
  s.ok('界面显示真实件数 9/8/7/1',
    /红 9/.test(html) && /蓝 8/.test(html) && /中立 7/.test(html) && /刺客 1/.test(html));
  s.ok('件数校验串 data-realism',
    /data-realism|dataset\.realism/.test(html));
  s.ok('角色图标按颜色映射',
    /#icon-skull/.test(html) && /#icon-diamond/.test(html) && /#icon-flag/.test(html));
  s.ok('红蓝队伍 SVG 旗帜', /class="team-icon"/.test(html));
  s.ok('棋盘摘要标注 5×5 · 25 张', /5×5 · 25 张/.test(html));
  s.ok('四类角色均有标准 SVG 图标',
    /icon-flag/.test(html) && /icon-diamond/.test(html) && /icon-skull/.test(html));
});

s.group('性能预算', function () {
  var t0 = performance.now();
  for (var n = 0; n < 500; n++) E.createGame({ mode: 'auto', seed: 9000 + n });
  var create500 = performance.now() - t0;
  s.ok('500 局发牌 <1000ms', create500 < 1000, create500.toFixed(1) + 'ms');

  var g = E.createGame({ mode: 'auto', seed: 5 });
  var t1 = performance.now();
  for (var v = 0; v < 2000; v++) E.viewFor(g, v % 2 === 0);
  var view2000 = performance.now() - t1;
  s.ok('2000 次视图 <500ms', view2000 < 500, view2000.toFixed(1) + 'ms');

  var t2 = performance.now();
  for (var a = 0; a < 30; a++) {
    var game = E.createGame({ mode: 'auto', seed: 7000 + a });
    var steps = 0;
    while (!E.isOver(game) && steps < 500) {
      var action = E.aiAction(game);
      if (!action) break;
      if (!E.applyAction(game, action).ok) break;
      steps++;
    }
  }
  var ai30 = performance.now() - t2;
  s.ok('30 局 AI 自对弈 <1000ms', ai30 < 1000, ai30.toFixed(1) + 'ms');
  s.ok('页面暴露性能计数器', /getPerf/.test(html) && /performance\.now/.test(html));
  return 'create500=' + create500.toFixed(1) + 'ms, view2000=' + view2000.toFixed(1) +
    'ms, ai30=' + ai30.toFixed(1) + 'ms';
});

s.group('共享模块复用与交付物', function () {
  s.ok('引擎 require 共享 shuffle',
    /require\('\.\.\/\.\.\/shared\/shuffle\.js'\)/.test(engineSrc));
  s.ok('引擎不再复制 mulberry32 常量',
    engineSrc.indexOf('0x6D2B79F5') === -1);
  s.ok('引擎使用 Shuffle.createRng', /Shuffle\.createRng/.test(engineSrc));
  s.ok('引擎使用 Shuffle.shuffleInPlace', /Shuffle\.shuffleInPlace/.test(engineSrc));
  s.ok('共享 shuffle 存在 createRng', /function createRng/.test(sharedShuffle));
  s.ok('共享 sfx 存在 play', /function play\(name, opts\)/.test(sharedSfx));
  s.ok('页面加载共享 shuffle', /src="\.\.\/\.\.\/shared\/shuffle\.js"/.test(html));
  s.ok('页面加载共享 sfx', /src="\.\.\/\.\.\/shared\/sfx\.js"/.test(html));
  s.ok('页面使用 Sfx 而非本地振荡器',
    /SFX\.play/.test(html) && html.indexOf('createOscillator') === -1);

  // 预缓存清单自 v20 起由 scripts/gen-precache.js 生成到 precache-manifest.js。
  var precacheSrc = (function () {
    var file = path.join(__dirname, '../../precache-manifest.js');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : swSrc;
  })();
  var swVersion = (swSrc.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  var manifestVersion = (precacheSrc.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
  s.ok('sw.js 与预缓存清单版本一致且不低于 v20',
    !!swVersion && swVersion === manifestVersion && Number(swVersion.replace('v', '')) >= 20);
  s.ok('预缓存清单含 codenames 入口',
    precacheSrc.indexOf('/games/boardgame/codenames-premium/') >= 0 &&
    precacheSrc.indexOf('/games/boardgame/codenames-premium/online.html') >= 0);
  s.ok('预缓存清单含 engine/words/meta',
    precacheSrc.indexOf('/games/boardgame/codenames-premium/engine.js') >= 0 &&
    precacheSrc.indexOf('/games/boardgame/codenames-premium/words.js') >= 0 &&
    precacheSrc.indexOf('/games/boardgame/codenames-premium/meta.json') >= 0);
  s.ok('预缓存清单含新 WebP 材质/配图',
    ['card-paper.webp', 'card-back.webp', 'table-felt.webp', 'cover.webp', 'og.webp',
      'detail-board.webp', 'detail-cards.webp'].every(function (name) {
      return precacheSrc.indexOf('/games/assets/art/premium/codenames/' + name) >= 0;
    }));

  s.ok('online.html 存在', fs.existsSync(path.join(__dirname, 'online.html')));
  s.ok('online-server.mjs 存在', fs.existsSync(path.join(__dirname, 'online-server.mjs')));
  s.ok('test-online.js 存在', fs.existsSync(path.join(__dirname, 'test-online.js')));
  s.ok('smoke.html 存在', fs.existsSync(path.join(__dirname, 'smoke.html')));
  s.ok('e2e.mjs 存在', fs.existsSync(path.join(__dirname, 'e2e.mjs')));
  s.ok('detail.html 存在', fs.existsSync(path.join(__dirname, 'detail.html')));
  s.ok('DESIGN.md 存在', fs.existsSync(path.join(__dirname, 'DESIGN.md')));
  s.ok('E2E.md 存在', fs.existsSync(path.join(__dirname, 'E2E.md')));
  s.ok('meta.json 存在', fs.existsSync(path.join(__dirname, 'meta.json')));
  s.ok('进度文件存在', fs.existsSync(path.join(__dirname, '../progress/sample-codenames.md')));

  s.ok('online-server 复用 app/rooms.js', /from '\.\.\/app\/rooms\.js'/.test(serverSrc));
  s.ok('online-server 使用 createRoomStoreInternal', /createRoomStoreInternal/.test(serverSrc));
  s.ok('online-server 有 AI 补位', /E\.aiClue/.test(serverSrc) && /E\.aiAction/.test(serverSrc));
  s.ok('online-server 有重连/托管/结果榜',
    /reconnect/.test(serverSrc) && /takeover/.test(serverSrc) && /recordResult/.test(serverSrc));
  s.ok('online-server 有邀请/密码/开始/重开',
    /consumeInvite/.test(serverSrc) && /password/.test(serverSrc) &&
    /actionName === 'start'/.test(serverSrc) && /actionName === 'restart'/.test(serverSrc));

  s.ok('online.html 标注房间/邀请/AI/重连/托管/结果榜',
    /创建房间/.test(onlineHtml) && /邀请/.test(onlineHtml) && /AI/.test(onlineHtml) &&
    /重连/.test(onlineHtml) && /托管/.test(onlineHtml) && /结果榜/.test(onlineHtml));
  s.ok('online.html 无外部脚本/样式',
    !/<script[^>]*src="https?:/i.test(onlineHtml) && !/<link[^>]*rel=["']?stylesheet/i.test(onlineHtml));
  s.ok('detail.html 本地配图 >=4',
    (detailHtml.match(/assets\/art\/premium\/codenames\/[^"]+\.webp/g) || []).length >= 4);
  s.ok('detail.html 标注单人/联机',
    /单人/.test(detailHtml) && /联机/.test(detailHtml));
  s.ok('index.html 链接联机与详情',
    /href="online\.html"/.test(html) && /href="detail\.html"/.test(html));
  s.ok('index.html 标注单人/联机',
    /单人/.test(html) && /联机/.test(html));

  s.ok('smoke.html 覆盖 390×844', /390×844/.test(smokeSrc));
  s.ok('smoke.html 覆盖 320×568', /320×568/.test(smokeSrc));
  s.ok('smoke.html 覆盖横屏/平板', /844×390/.test(smokeSrc) && /1024×768/.test(smokeSrc));
  s.ok('smoke.html 有触屏流程', /touchFlow/.test(smokeSrc) && /touchstart/.test(smokeSrc));
  s.ok('e2e 先 chrome-ensure', /chrome-ensure/.test(e2eSrc));
  s.ok('e2e 优先 urlrun tab', /urlrun/.test(e2eSrc) && /tab/.test(e2eSrc));
  s.ok('e2e 回退持久 CDP 且不 spawn Chrome',
    /persistent-cdp|persistent Chrome CDP/.test(e2eSrc) && e2eSrc.indexOf('spawn(CHROME') === -1);

  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 游戏类型 multiplayer', meta.gameType, 'multiplayer');
  s.eq('meta 单人/联机标注', [meta.labels.singlePlayer, meta.labels.multiplayer, meta.labels.detailMarksBoth], [true, true, true]);
  s.eq('meta 联机能力齐全',
    [meta.online.invite, meta.online.passwordRooms, meta.online.aiFillEmptySeats,
      meta.online.reconnect, meta.online.timeoutTakeover, meta.online.leaderboard,
      meta.online.rulesSimplified === false], [true, true, true, true, true, true, true]);
  s.ok('meta 双客户端 E2E 指向 test-online.js', meta.online.twoClientE2E === 'test-online.js' && meta.online.gateAlias === 'online-e2e.test.js');
  s.eq('meta realism 9/8/7/1',
    [meta.realism.red, meta.realism.blue, meta.realism.neutral, meta.realism.assassin], [9, 8, 7, 1]);
  s.eq('meta realism 5×5', meta.realism.grid, [5, 5]);
  s.eq('meta 手机矩阵含 390/320',
    meta.mobile.smokeViewports.indexOf('390x844') >= 0 && meta.mobile.smokeViewports.indexOf('320x568') >= 0, true);
  s.ok('meta 性能预算存在',
    meta.performance.engineCreateGame500Ms > 0 && meta.performance.uiBoardMs > 0);
  s.ok('meta 已记录实测性能',
    meta.performance.measured.engineCreateGame500Ms > 0 &&
    meta.performance.measured.uiNewGameMs > 0);
  s.ok('meta 已记录单测结果', /350 passed, 0 failed/.test(meta.tests.unitResult));
  s.ok('meta 已记录联机结果', /89 passed, 0 failed/.test(meta.tests.onlineResult));
  s.ok('meta 已记录冒烟结果', /80 passed, 0 failed/.test(meta.tests.browserSmokeResult));
  s.ok('meta 已记录全仓结果', /87249 passed, 0 failed/.test(meta.tests.runAll));
  s.eq('meta 已记录对照失败', meta.tests.controlFailure.exitCode, 1);
  s.ok('meta 已记录 SW 预缓存',
    /^v\d+$/.test(meta.serviceWorker.cacheVersion) &&
    meta.serviceWorker.precacheIncludes.indexOf('cover.webp') >= 0);
  s.ok('DESIGN.md 覆盖 ART-GUIDE/realism/性能/手机/联机',
    /ART-GUIDE/.test(designMd) && /realism/.test(designMd) && /性能/.test(designMd) &&
    /手机/.test(designMd) && /联机/.test(designMd));
  s.ok('E2E.md 记录 RESULT/视口/控制项',
    /RESULT:/.test(e2eMd) && /390×844/.test(e2eMd) && /320×568/.test(e2eMd));
  s.ok('进度文件含阻塞与可续跑', /阻塞/.test(progressMd) && /可续跑/.test(progressMd));
});

s.group('本地美术与材质技术校验', function () {
  var pngNames = ['card-paper', 'card-back', 'table-felt'];
  pngNames.forEach(function (name) {
    var png = path.join(assetDir, name + '.png');
    var webp = path.join(assetDir, name + '.webp');
    s.ok(name + '.png 存在', fs.existsSync(png));
    s.ok(name + '.webp 存在', fs.existsSync(webp));
    if (fs.existsSync(png)) s.eq(name + '.png 1024×1024', pngSize(png), [1024, 1024]);
    if (fs.existsSync(webp)) s.ok(name + '.webp ≤120KB', fs.statSync(webp).size <= 120 * 1024,
      fs.statSync(webp).size);
  });
  var shots = {
    cover: [1024, 1024], og: [1200, 630],
    'detail-board': [1200, 800], 'detail-cards': [1200, 800]
  };
  Object.keys(shots).forEach(function (name) {
    var png = path.join(assetDir, name + '.png');
    var webp = path.join(assetDir, name + '.webp');
    s.ok(name + '.png 存在', fs.existsSync(png));
    s.ok(name + '.webp 存在', fs.existsSync(webp));
    if (fs.existsSync(png)) s.eq(name + '.png 尺寸', pngSize(png), shots[name]);
    if (fs.existsSync(webp)) s.ok(name + '.webp ≤250KB', fs.statSync(webp).size <= 250 * 1024,
      fs.statSync(webp).size);
  });
  s.ok('页面引用本地纸面/卡背/绒布',
    html.indexOf('card-paper.webp') >= 0 && html.indexOf('card-back.webp') >= 0 &&
    html.indexOf('table-felt.webp') >= 0);
  s.ok('页面引用本地封面/OG 元数据',
    html.indexOf('og.webp') >= 0 && detailHtml.indexOf('cover.webp') >= 0);
  s.ok('art/render.html 存在且引用共享 shuffle/engine',
    fs.existsSync(path.join(__dirname, 'art/render.html')) &&
    /shared\/shuffle\.js/.test(fs.readFileSync(path.join(__dirname, 'art/render.html'), 'utf8')) &&
    /\.\.\/engine\.js/.test(fs.readFileSync(path.join(__dirname, 'art/render.html'), 'utf8')));
});

s.group('移动端与 iOS 静态约束', function () {
  s.ok('100dvh', /min-height:100dvh/.test(html) && /min-height:100dvh/.test(onlineHtml));
  s.ok('safe-area 四边',
    /safe-area-inset-top/.test(html) && /safe-area-inset-right/.test(html) &&
    /safe-area-inset-bottom/.test(html) && /safe-area-inset-left/.test(html));
  s.ok('横向短屏媒体查询',
    /max-height:520px/.test(html) && /orientation:landscape/.test(html));
  s.ok('无横向滚动', /overflow-x:hidden/.test(html));
  s.ok('触控 manipulation', /touch-action:manipulation/.test(html));
  s.ok('viewport-fit=cover',
    /viewport-fit=cover/.test(html) && /viewport-fit=cover/.test(onlineHtml) && /viewport-fit=cover/.test(detailHtml));
  s.ok('iOS webkitAudioContext 由共享 sfx 提供',
    /webkitAudioContext/.test(sharedSfx));
  s.ok('首次触摸解锁监听',
    /touchstart/.test(html) && /pointerdown/.test(html) && /touchend/.test(html));
  s.ok('词卡/按钮最小 44px',
    /min-height:\s*58px/.test(html) && /min-height:\s*44px/.test(html));
  s.ok('320 断点',
    /max-width:380px/.test(html) && /font-size:\.75rem/.test(html));
});

var controlFail = process.env.CONTROL_FAIL === '1' || process.argv.indexOf('--control') !== -1;
if (controlFail) {
  s.ok('故意失败对照项（--control）', false, '这是验收对照，正常运行时不会加 --control');
}

s.group('HANDOFF 修复验收', function () {
  s.eq('index 无 <12px 可见字号', tinyFonts(html), []);
  s.eq('online 无 <12px 可见字号', tinyFonts(onlineHtml), []);
  s.eq('detail 无 <12px 可见字号', tinyFonts(detailHtml), []);
  s.eq('rules 无 <12px 可见字号', tinyFonts(rules), []);
  s.ok('index 主容器 id=app（官方点击冒烟）', /<div class="app" id="app">/.test(html));

  var realism = readJson(path.join(__dirname, 'realism.json'));
  s.ok('realism.json 可解析', !!realism);
  s.eq('realism 顶层 pass=true', realism && realism.pass, true);
  s.ok('realism 检查 >=3 项', realism && realism.checks && realism.checks.length >= 3,
    realism && realism.checks ? realism.checks.length : 0);
  s.ok('realism 每项 ok=true', realism && realism.checks.every(function (c) {
    return c.ok === true;
  }));
  var kinds = realism && realism.checks ? realism.checks.map(function (c) { return c.kind; }).filter(Boolean) : [];
  s.ok('realism kind >=3 类互异', new Set(kinds).size >= 3, JSON.stringify(kinds));
  s.ok('realism 覆盖 count/dimension/rule/material/color', ['count', 'dimension', 'rule', 'material', 'color'].every(function (k) {
    return kinds.indexOf(k) >= 0;
  }));
  s.ok('realism 每项有 values/source', realism && realism.checks.every(function (c) {
    return c.values && c.source;
  }));

  s.ok('ACCEPTANCE.md 存在', fs.existsSync(path.join(__dirname, 'ACCEPTANCE.md')));
  var acceptance = fs.readFileSync(path.join(__dirname, 'ACCEPTANCE.md'), 'utf8');
  s.ok('ACCEPTANCE 覆盖官方 smoke/390/320/对照/联机',
    /game-smoke/.test(acceptance) && /390×844/.test(acceptance) && /320×568/.test(acceptance) &&
    /--control/.test(acceptance) && /online-e2e/.test(acceptance));

  s.ok('online-e2e.test.js 存在', fs.existsSync(path.join(__dirname, 'online-e2e.test.js')));
  var alias = fs.readFileSync(path.join(__dirname, 'online-e2e.test.js'), 'utf8');
  s.ok('online-e2e.test.js 复用真实联机套件',
    /require\('\.\/test-online\.js'\)/.test(alias) ||
    /spawnSync\(process\.execPath, \[path\.join\(__dirname, 'online-e2e\.mjs'\)\]/.test(alias));
  var onlineEvidence = readJson(path.join(__dirname, 'online-e2e.json'));
  s.ok('online-e2e.json 可解析', !!onlineEvidence);
  s.eq('online-e2e 状态 pass', onlineEvidence && onlineEvidence.status, 'pass');
  s.eq('online-e2e 双客户端', onlineEvidence && onlineEvidence.twoClients, true);
  s.eq('online-e2e 结果', onlineEvidence && onlineEvidence.result, '89 passed, 0 failed');

  [['390', 19], ['320', 19]].forEach(function (pair) {
    var tag = pair[0];
    var data = readJson(path.join(__dirname, 'audit/game-smoke-' + tag + '.json'));
    var result = data && (data.results || data)[0];
    s.ok('官方 smoke ' + tag + ' 可解析', !!result);
    s.eq('官方 smoke ' + tag + ' PASS', result && result.status, 'PASS');
    s.eq('官方 smoke ' + tag + ' 0 失败', result && result.failures.length, 0);
    s.eq('官方 smoke ' + tag + ' 检查数', result && result.checks.length, pair[1]);
    s.ok('官方 smoke ' + tag + ' 字号检查', result && result.checks.some(function (c) {
      return c.name.indexOf('字号可读') >= 0 && c.ok;
    }));
    s.ok('官方 smoke ' + tag + ' 点击冒烟', result && result.click && result.click.clicked === true);
    s.eq('官方 smoke ' + tag + ' 零外部请求', result && result.counts.externalRequests, 0);
  });

  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 指向 test-online.js', meta.online.twoClientE2E, 'test-online.js');
  s.eq('meta 记录 online-e2e.json', meta.tests.onlineEvidence, 'online-e2e.json');
  s.eq('meta 字号下限 12px', meta.mobile.fontMinPx, 12);
  s.eq('meta 记录官方 smoke 390', meta.tests.officialSmoke390.status, 'PASS');
  s.eq('meta 记录官方 smoke 320', meta.tests.officialSmoke320.status, 'PASS');
  s.ok('meta 记录 realism/acceptance',
    meta.realismFile === 'realism.json' && meta.acceptance === 'ACCEPTANCE.md');
});

s.group('规则页内容与 SEO', function () {
  s.ok('规则页 viewport', /name="viewport"[^>]*width=device-width/.test(rules));
  s.ok('规则页 FAQPage JSON-LD', /"@type"\s*:\s*"FAQPage"/.test(rules));
  s.ok('规则页 Article JSON-LD', /"@type"\s*:\s*"Article"/.test(rules));
  s.ok('规则页有回游戏 CTA', /href="index\.html"/.test(rules));
  var ld = lib.jsonLd(rules);
  s.ok('JSON-LD 至少 2 块', ld.length >= 2);
  s.ok('JSON-LD 含 Article', ld.some(function (x) { return x['@type'] === 'Article'; }));
  s.ok('JSON-LD 含 FAQPage', ld.some(function (x) { return x['@type'] === 'FAQPage'; }));
  var faq = ld.filter(function (x) { return x['@type'] === 'FAQPage'; })[0];
  s.ok('FAQ 至少 6 问', faq && faq.mainEntity && faq.mainEntity.length >= 6,
    'faq=' + (faq && faq.mainEntity ? faq.mainEntity.length : 0));
  var article = ld.filter(function (x) { return x['@type'] === 'Article'; })[0];
  s.ok('Article 引用 5 个 B 站来源', article && article.citation && article.citation.length >= 5);
  s.ok('规则页列出 5 个 B 站链接',
    (rules.match(/https:\/\/www\.bilibili\.com\/video\//g) || []).length >= 5);
  s.ok('规则页注明检索限制', /subtitle\.list/.test(rules) && /OCR/.test(rules));
  s.ok('规则页无外部脚本', !/<script[^>]*src="https?:/i.test(rules));
  s.ok('规则页无外部样式', !/<link[^>]*rel=["']?stylesheet/i.test(rules));
  var visible = rules.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  var cjk = (visible.match(/[一-鿿]/g) || []).length;
  s.ok('规则页中文正文 >=1200 字', cjk >= 1200, 'cjk=' + cjk);
  s.ok('规则覆盖 25 张牌', /25 张/.test(rules));
  s.ok('规则覆盖 9/8 词', /9 张/.test(rules) && /8 张/.test(rules));
  s.ok('规则覆盖刺客', /刺客/.test(rules));
  s.ok('规则覆盖变体', /变体/.test(rules));
});

s.done();
