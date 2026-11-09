'use strict';

// Unit tests for the pure logic embedded in games/profile/index.html.
// Run: node games/profile/test.js
//
// The page keeps every DOM-free helper between __CORE_START__ / __CORE_END__,
// so this file can evaluate that block without a browser.

var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var a = html.indexOf('// __CORE_START__');
var b = html.indexOf('// __CORE_END__');
if (a < 0 || b < 0) throw new Error('core markers not found in profile/index.html');
var core = html.slice(a + '// __CORE_START__'.length, b);
var C = (0, eval)(core + '\n;ProfileCore');

var passed = 0;
var failed = 0;
var failures = [];
function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
}
function eq(label, actual, expected) {
  ok(label, actual === expected, JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
}
function group(name, fn) {
  var p0 = passed;
  var f0 = failed;
  fn();
  return { name: name, pass: passed - p0, fail: failed - f0 };
}

var results = [];

/* ------------------------------------------------------------------ */
/* 1. level / tier copy mapping                                        */
/* ------------------------------------------------------------------ */
results.push(group('tier mapping', function () {
  eq('level 1 is bronze', C.tierForLevel(1).id, 'bronze');
  eq('level 4 is bronze', C.tierForLevel(4).id, 'bronze');
  eq('level 5 is silver', C.tierForLevel(5).id, 'silver');
  eq('level 9 is silver', C.tierForLevel(9).id, 'silver');
  eq('level 10 is gold', C.tierForLevel(10).id, 'gold');
  eq('level 19 is gold', C.tierForLevel(19).id, 'gold');
  eq('level 20 is platinum', C.tierForLevel(20).id, 'platinum');
  eq('level 34 is platinum', C.tierForLevel(34).id, 'platinum');
  eq('level 35 is obsidian', C.tierForLevel(35).id, 'obsidian');
  eq('level 999 is obsidian', C.tierForLevel(999).id, 'obsidian');
  eq('negative level falls back to bronze', C.tierForLevel(-3).id, 'bronze');
  eq('unknown tier falls back to bronze', C.tierInfo('nope').id, 'bronze');
  eq('null tier falls back to bronze', C.tierInfo(null).id, 'bronze');
  eq('bronze tier label', C.tierInfo('bronze').zh, '青铜');
  eq('gold tier label', C.tierInfo('gold').zh, '黄金');
  eq('platinum tier label', C.tierInfo('platinum').zh, '铂金');
  eq('obsidian tier label', C.tierInfo('obsidian').zh, '曜石');
  eq('platinum sits between gold and obsidian', C.tierInfo('platinum').order, 4);
  eq('levelLabel(13, gold)', C.levelLabel(13, 'gold'), 'Lv.13 · 黄金段位');
  eq('levelLabel clamps zero', C.levelLabel(0, 'bronze'), 'Lv.1 · 青铜段位');
  eq('engine tier name overrides local label',
    C.tierNameOf({ tier: { id: 'gold', name: { zh: '赤金' } } }), '赤金');
  eq('string tier resolves local label', C.tierNameOf({ tier: 'silver' }), '白银');
  eq('missing tier resolves bronze', C.tierNameOf({}), '青铜');
  eq('tierIdOf object', C.tierIdOf({ id: 'obsidian' }), 'obsidian');
  eq('tierIdOf string', C.tierIdOf('silver'), 'silver');
  eq('tierIdOf null', C.tierIdOf(null), 'bronze');
}));

/* ------------------------------------------------------------------ */
/* 2. XP / progress / rate copy                                        */
/* ------------------------------------------------------------------ */
results.push(group('xp and progress copy', function () {
  eq('xp gap', C.xpGapText(2180, 3000), '还差 820 XP 升级');
  eq('xp gap at zero', C.xpGapText(0, 500), '还差 500 XP 升级');
  eq('xp gap when full', C.xpGapText(500, 500), '可以升级');
  eq('xp gap at cap', C.xpGapText(3000, 0), '已达段位顶端');
  eq('xp gap missing next', C.xpGapText(0, null), '已达段位顶端');
  eq('progress from ratio', C.progressPct({ xpIntoLevel: 250, xpForNext: 500 }), 0.5);
  eq('progress clamps above 1', C.progressPct({ progress: 1.4 }), 1);
  eq('progress clamps below 0', C.progressPct({ progress: -1, xpIntoLevel: 0, xpForNext: 0 }), 0);
  eq('progress with no data', C.progressPct({}), 0);
  eq('win rate 81/128', C.winRateText(81, 128), '63%');
  eq('win rate zero plays', C.winRateText(0, 0), '—');
  eq('win rate clamps wins above plays', C.winRateText(10, 5), '100%');
  eq('ratePct 1/3', C.ratePct(1, 3), 33);
  eq('ratePct no plays', C.ratePct(0, 0), null);
  eq('fmtNum thousands', C.fmtNum(1234567), '1,234,567');
  eq('fmtNum zero', C.fmtNum(0), '0');
  eq('fmtNum string', C.fmtNum('2500'), '2,500');
}));

/* ------------------------------------------------------------------ */
/* 3. locked trophy progress copy                                      */
/* ------------------------------------------------------------------ */
results.push(group('locked trophy progress', function () {
  eq('streak progress uses days',
    C.progressText({ id: 'streak-7', icon: 'streak-7', progress: { cur: 3, max: 7 } }), '3 / 7 天');
  eq('wins progress uses wins',
    C.progressText({ id: 'wins-25', icon: 'wins-25', progress: { cur: 3, max: 7 } }), '3 / 7 胜');
  eq('plays progress uses games',
    C.progressText({ id: 'plays-10', icon: 'plays-10', progress: { cur: 3, max: 10 } }), '3 / 10 局');
  eq('generic progress uses times',
    C.progressText({ id: 'mystery', icon: 'mystery', progress: { cur: 2, max: 5 } }), '2 / 5 次');
  eq('tier progress uses levels',
    C.progressText({ id: 'tier-gold', icon: 'tier-gold', progress: { cur: 3, max: 5 } }), '3 / 5 级');
  eq('distinct games progress uses titles',
    C.progressText({ id: 'games-5', icon: 'games-5', progress: { cur: 3, max: 5 } }), '3 / 5 款');
  eq('per-game wins use wins',
    C.progressText({ id: 'game-10-wins', icon: 'game-10-wins', progress: { cur: 3, max: 10 } }), '3 / 10 胜');
  eq('daily progress uses times',
    C.progressText({ id: 'daily-10', icon: 'daily-10', progress: { cur: 3, max: 10 } }), '3 / 10 次');
  eq('progress clamps above max',
    C.progressText({ id: 'streak-7', progress: { cur: 99, max: 7 } }), '7 / 7 天');
  eq('progress clamps below zero',
    C.progressText({ id: 'streak-7', progress: { cur: -2, max: 7 } }), '0 / 7 天');
  eq('unlocked without max says lit', C.progressText({ unlocked: true }), '已点亮');
  eq('locked without max says locked', C.progressText({ unlocked: false, progress: { cur: 0, max: 0 } }), '未解锁');
  eq('null trophy survives', C.progressText(null), '未解锁');
  eq('progressUnit streak', C.progressUnit({ id: 'streak-30' }), '天');
  eq('progressUnit games', C.progressUnit({ id: 'all-games' }), '款');
  eq('progressUnit wins', C.progressUnit({ id: 'wins-100' }), '胜');
  eq('progressUnit plays', C.progressUnit({ id: 'plays-500' }), '局');
  eq('progressUnit tier', C.progressUnit({ id: 'tier-platinum' }), '级');
  eq('progressUnit daily', C.progressUnit({ id: 'daily-10' }), '次');
}));

/* ------------------------------------------------------------------ */
/* 4. sorting / grouping / showcase                                    */
/* ------------------------------------------------------------------ */
var sampleTrophies = [
  { id: 'g-locked', tier: 'gold', unlocked: false, icon: 'wins-100', name: { zh: '百胜' }, progress: { cur: 81, max: 100 } },
  { id: 'b-lit', tier: 'bronze', unlocked: true, icon: 'first-win', name: { zh: '初胜' } },
  { id: 'g-lit', tier: 'gold', unlocked: true, icon: 'level-10', name: { zh: '十级高台' } },
  { id: 'o-locked', tier: 'obsidian', unlocked: false, icon: 'streak-100', name: { zh: '百日之火' }, progress: { cur: 11, max: 100 } },
  { id: 's-lit', tier: 'silver', unlocked: true, icon: 'streak-7', name: { zh: '七日之火' } },
  { id: 'o-lit', tier: 'obsidian', unlocked: true, icon: 'perfect', name: { zh: '一局全胜' } }
];

results.push(group('trophy ordering', function () {
  var sorted = C.sortTrophies(sampleTrophies);
  eq('unlocked sorts first', sorted[0].unlocked, true);
  eq('first unlocked is rarest', sorted[0].id, 'o-lit');
  eq('second unlocked is gold', sorted[1].id, 'g-lit');
  eq('third unlocked is silver', sorted[2].id, 's-lit');
  eq('fourth unlocked is bronze', sorted[3].id, 'b-lit');
  eq('locked obsidian follows unlocked', sorted[4].id, 'o-locked');
  eq('locked gold is last', sorted[5].id, 'g-locked');
  ok('sort does not mutate input', sampleTrophies[0].id === 'g-locked');

  var groups = C.groupTrophies(sampleTrophies);
  eq('four rarity groups', groups.length, 4);
  eq('groups ordered obsidian first', groups[0].tier.id, 'obsidian');
  eq('groups ordered gold second', groups[1].tier.id, 'gold');
  eq('groups ordered silver third', groups[2].tier.id, 'silver');
  eq('groups ordered bronze last', groups[3].tier.id, 'bronze');
  eq('gold group puts unlocked first', groups[1].items[0].id, 'g-lit');

  var missing = C.groupTrophies([{ id: 'x', tier: 'bronze', unlocked: true }]);
  eq('absent tiers are omitted', missing.length, 1);
  eq('absent-tier group is bronze', missing[0].tier.id, 'bronze');

  var show = C.pickShowcase(sampleTrophies, 3);
  eq('showcase has three', show.length, 3);
  eq('showcase rarest first', show[0].id, 'o-lit');
  eq('showcase excludes locked', show.every(function (t) { return t.unlocked; }), true);
  eq('showcase respects n', C.pickShowcase(sampleTrophies, 1).length, 1);
  eq('showcase empty when all locked',
    C.pickShowcase([{ id: 'x', unlocked: false }], 3).length, 0);
}));

/* ------------------------------------------------------------------ */
/* 5. responsive columns                                               */
/* ------------------------------------------------------------------ */
results.push(group('layout constants', function () {
  eq('390px uses 2 columns', C.colsFor(390), 2);
  eq('480px uses 2 columns', C.colsFor(480), 2);
  eq('619px uses 2 columns', C.colsFor(619), 2);
  eq('620px uses 3 columns', C.colsFor(620), 3);
  eq('899px uses 3 columns', C.colsFor(899), 3);
  eq('900px uses 4 columns', C.colsFor(900), 4);
  eq('1280px uses 4 columns', C.colsFor(1280), 4);
  eq('missing width defaults to 390', C.colsFor(0), 2);
}));

/* ------------------------------------------------------------------ */
/* 6. share card copy (pure, no canvas)                                */
/* ------------------------------------------------------------------ */
var state = {
  xp: 6180,
  level: 13,
  tier: { id: 'gold', name: { zh: '黄金' } },
  xpIntoLevel: 180,
  xpForNext: 500,
  progress: 0.36,
  streak: { current: 5, best: 11 },
  plays: 128,
  wins: 81,
  losses: 39,
  draws: 8,
  perGame: { xiangqi: { plays: 42, wins: 29, bestStreak: 6 } },
  trophyCount: 4,
  trophyTotal: 6
};
var copy = C.shareCopy(state, sampleTrophies, 'hhfa008.github.io');
var markdown = C.shareMarkdown(copy, 'https://hhfa008.github.io/games/profile/?r=abc');

results.push(group('share copy', function () {
  eq('share title', copy.title, '我的奖杯陈列馆');
  eq('level line', copy.levelLine, 'Lv.13 · 黄金段位');
  eq('total line', copy.totalLine, '解锁 4 / 6 枚奖杯');
  eq('streak line', copy.streakLine, '连续 5 天');
  eq('three trophy names', copy.trophyNames.length, 3);
  eq('first trophy name', copy.trophyNames[0], '一局全胜');
  eq('second trophy name', copy.trophyNames[1], '十级高台');
  eq('third trophy name', copy.trophyNames[2], '七日之火');
  eq('trophy ids follow names', copy.trophyIds.join(','), 'o-lit,g-lit,s-lit');
  eq('stats total plays', copy.stats[0].value, '128');
  eq('stats win rate', copy.stats[1].value, '63%');
  eq('stats best streak', copy.stats[2].value, '11 天');
  eq('watermark default', C.shareCopy(state, sampleTrophies).watermark, 'hhfa008.github.io');
  eq('empty trophy copy', C.shareCopy(state, []).trophyNames.length, 0);
  eq('copy computes count from list when missing',
    C.shareCopy({ xp: 10, level: 1, tier: 'bronze', trophyTotal: 6 }, sampleTrophies).totalLine,
    '解锁 4 / 6 枚奖杯');
  ok('markdown has title', markdown.indexOf('**我的奖杯陈列馆**') === 0);
  ok('markdown has level', markdown.indexOf('Lv.13 · 黄金段位') >= 0);
  ok('markdown has streak', markdown.indexOf('连续 5 天') >= 0);
  ok('markdown has trophies', markdown.indexOf('代表奖杯：一局全胜 · 十级高台 · 七日之火') >= 0);
  ok('markdown has link', markdown.indexOf('https://hhfa008.github.io/games/profile/?r=abc') >= 0);
}));

results.push(group('share privacy', function () {
  ok('no unix path', markdown.indexOf('/Users/') < 0);
  ok('no windows path', markdown.indexOf('C:\\') < 0);
  ok('no file scheme', markdown.indexOf('file://') < 0);
  ok('no timestamp', !/\d{4}-\d{2}-\d{2}/.test(markdown));
  ok('no fake challenger count', markdown.indexOf('人挑战') < 0 && markdown.indexOf('人已挑战') < 0);
  ok('no localhost', markdown.indexOf('localhost') < 0 && markdown.indexOf('127.0.0.1') < 0);
  ok('no tracking params', markdown.indexOf('utm_') < 0 && markdown.indexOf('?mock=') < 0);
  ok('no unlock date leaked', markdown.indexOf('2026-10') < 0);
}));

results.push(group('share url', function () {
  eq('append query', C.shareUrl('https://hhfa008.github.io/games/profile/', 'a b'),
    'https://hhfa008.github.io/games/profile/?r=a%20b');
  eq('append to query', C.shareUrl('https://hhfa008.github.io/games/profile/?mock=1', 'xy'),
    'https://hhfa008.github.io/games/profile/?mock=1&r=xy');
  eq('adds trailing slash', C.shareUrl('https://example.com/games/profile', 'x'),
    'https://example.com/games/profile/?r=x');
  eq('encodes reserved chars', C.shareUrl('https://example.com/p/', 'a&b=c'),
    'https://example.com/p/?r=a%26b%3Dc');
}));

/* ------------------------------------------------------------------ */
/* 7. shared-state parsing / invalid link behaviour                    */
/* ------------------------------------------------------------------ */
results.push(group('shared state parsing', function () {
  ok('null rejected', C.parseShared(null, function () { return { xp: 1 }; }).ok === false);
  ok('empty rejected', C.parseShared('', function () { return { xp: 1 }; }).ok === false);
  ok('missing decoder rejected', C.parseShared('abc', null).ok === false);
  var thrown = C.parseShared('abc', function () { throw new Error('bad'); });
  ok('throwing decoder rejected', thrown.ok === false);
  eq('throwing decoder reason', thrown.reason, 'decode');
  ok('null decode result rejected', C.parseShared('abc', function () { return null; }).ok === false);
  ok('empty object rejected', C.parseShared('abc', function () { return {}; }).ok === false);
  ok('non-numeric xp rejected', C.parseShared('abc', function () { return { xp: 'abc' }; }).ok === false);
  ok('non-numeric xp with level rejected', C.parseShared('abc', function () { return { xp: 'abc', level: 2 }; }).ok === false);
  ok('negative xp rejected', C.parseShared('abc', function () { return { xp: -1 }; }).ok === false);
  ok('array rejected', C.parseShared('abc', function () { return []; }).ok === false);
  ok('string payload rejected', C.parseShared('abc', function () { return 'state'; }).ok === false);
  var oversized = 'x'.repeat(20000);
  eq('oversized link reason', C.parseShared(oversized, function () { return { xp: 1 }; }).reason, 'too-long');

  var plain = C.parseShared('abc', function () { return { xp: 100, level: 2 }; });
  ok('plain state accepted', plain.ok === true);
  eq('plain state level', plain.state.level, 2);
  var wrapped = C.parseShared('abc', function () { return { state: { xp: 100, level: 2 } }; });
  ok('wrapped state accepted', wrapped.ok === true);
  eq('wrapped xp', wrapped.state.xp, 100);

  var n = C.normalizeShared({
    xp: 250,
    level: 3,
    plays: -5,
    trophyCount: 9999,
    streak: { current: 4, best: 9 },
    perGame: { xiangqi: { plays: '7', wins: 3, bestStreak: 2 } },
    trophyIds: ['first-win', 'bad id!', 42]
  });
  eq('clamps negative plays', n.plays, 0);
  eq('clamps trophy count', n.trophyCount, 999);
  eq('keeps per-game plays', n.perGame.xiangqi.plays, 7);
  eq('filters non-string trophy ids', n.unlockedIds.length, 2);
  eq('trophy ids known', n.trophyUnlockedKnown, true);
  eq('level-only state accepts zero xp', C.normalizeShared({ level: 4 }).xp, 0);
  eq('level-only state tier fallback', C.normalizeShared({ level: 4 }).tier.id, 'bronze');
  eq('null normalize', C.normalizeShared(null), null);
}));

/* ------------------------------------------------------------------ */
/* 8. icon semantics / labels / escaping                               */
/* ------------------------------------------------------------------ */
results.push(group('icon semantics', function () {
  eq('streak icon is flame', C.iconKeyFor('streak-7'), 'flame');
  eq('first win icon is cup', C.iconKeyFor('first-win'), 'cup');
  eq('win icon is cup', C.iconKeyFor('wins-25'), 'cup');
  eq('level icon is star', C.iconKeyFor('level-10'), 'star');
  eq('plays icon is dice', C.iconKeyFor('plays-50'), 'dice');
  eq('all-games icon is globe', C.iconKeyFor('all-games'), 'globe');
  eq('engine games-all icon is globe', C.iconKeyFor('games-all'), 'globe');
  eq('engine games-5 icon is dice', C.iconKeyFor('games-5'), 'dice');
  eq('perfect icon is diamond', C.iconKeyFor('perfect-run'), 'diamond');
  eq('engine flawless icon is diamond', C.iconKeyFor('milestone-flawless'), 'diamond');
  eq('streak-100 icon is flame', C.iconKeyFor('streak-100'), 'flame');
  eq('champion icon is crown', C.iconKeyFor('champion'), 'crown');
  eq('engine full-house icon is crown', C.iconKeyFor('milestone-full-house'), 'crown');
  eq('engine comeback icon is bolt', C.iconKeyFor('milestone-comeback'), 'bolt');
  eq('engine one-shot icon is target', C.iconKeyFor('milestone-one-shot'), 'target');
  eq('engine daily icon is hourglass', C.iconKeyFor('daily-10'), 'hourglass');
  eq('engine tier icon is medal', C.iconKeyFor('tier-gold'), 'medal');
  eq('unknown icon falls back to cup', C.iconKeyFor('mystery-badge'), 'cup');
  eq('null icon falls back to cup', C.iconKeyFor(null), 'cup');
}));

results.push(group('labels and escaping', function () {
  eq('known game label', C.gameLabel('xiangqi'), '中国象棋');
  eq('hyphenated game label', C.gameLabel('texas-holdem'), '德州扑克');
  eq('unknown game label keeps slug', C.gameLabel('mystery'), 'mystery');
  eq('missing game label', C.gameLabel(null), '未知游戏');
  eq('escape html', C.escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  eq('escape null', C.escapeHtml(null), '');
  eq('nameOf zh', C.nameOf({ zh: '初胜', en: 'First Win' }, 'zh'), '初胜');
  eq('nameOf falls back to zh', C.nameOf({ zh: '初胜' }, 'en'), '初胜');
  eq('nameOf string', C.nameOf('初胜', 'zh'), '初胜');
  eq('nameOf null', C.nameOf(null, 'zh'), '');
}));

results.push(group('svg contract', function () {
  var svg = C.iconSvg('streak-7', 'gold', false, 'ic-lit');
  ok('icon svg is inline', svg.indexOf('<svg') === 0);
  ok('icon uses gold gradient', svg.indexOf('url(#g-gold)') >= 0);
  ok('icon carries class', svg.indexOf('class="ic-lit"') >= 0);
  ok('icon is aria hidden', svg.indexOf('aria-hidden="true"') >= 0);
  var locked = C.iconSvg('first-win', 'bronze', true);
  ok('locked icon uses locked gradient', locked.indexOf('url(#g-locked)') >= 0);
  var medal = C.medallionSvg('obsidian');
  ok('medallion is an svg', medal.indexOf('<svg') === 0);
  ok('medallion uses obsidian gradient', medal.indexOf('url(#g-obsidian)') >= 0);
  ok('medallion has accessible label', medal.indexOf('曜石段位徽章') >= 0);
  var defs = C.gradientDefs('g-');
  ok('defs define every metal + locked',
    ['g-bronze', 'g-silver', 'g-gold', 'g-platinum', 'g-obsidian', 'g-locked'].every(function (id) {
      return defs.indexOf('id="' + id + '"') >= 0;
    }));
  var standalone = C.standaloneIconSvg('streak-7', 'gold');
  ok('standalone svg has xmlns', standalone.indexOf('xmlns="http://www.w3.org/2000/svg"') >= 0);
  ok('standalone svg embeds defs', standalone.indexOf('<defs>') >= 0);
}));

results.push(group('card format contract', function () {
  eq('card budget is 350000 bytes', C.CARD_MAX_BYTES, 350000);
  eq('first quality step is 0.9', C.CARD_QUALITY_STEPS[0], 0.9);
  ok('quality steps descend', C.CARD_QUALITY_STEPS.every(function (q, i, a) {
    return i === 0 || q < a[i - 1];
  }));
  eq('webp file name', C.cardFileName('webp'), 'trophy-card.webp');
  eq('jpeg file name', C.cardFileName('jpg'), 'trophy-card.jpg');
  eq('png file name', C.cardFileName('png'), 'trophy-card.png');
  eq('default file name', C.cardFileName(), 'trophy-card.webp');
  eq('webp mime', C.cardFormatFor('image/webp').mime, 'image/webp');
  eq('webp ext', C.cardFormatFor('image/webp').ext, 'webp');
  eq('jpeg ext', C.cardFormatFor('image/jpeg').ext, 'jpg');
  eq('png last resort', C.cardFormatFor('image/png').ext, 'png');
  ok('page requests webp then jpeg', html.indexOf("toBlobAsync(canvas, 'image/webp', 0.9)") >= 0 &&
    html.indexOf("toBlobAsync(canvas, 'image/jpeg', 0.9)") >= 0);
  ok('share File type follows format', html.indexOf("new File([blob], fileName, { type: fmt.mime })") >= 0);
  ok('download name follows format', html.indexOf('downloadBlob(blob, fileName)') >= 0);
  var defs = C.gradientDefs('g-');
  var silverDef = /id="g-silver"([\s\S]*?)<\/linearGradient>/.exec(defs);
  var platinumDef = /id="g-platinum"([\s\S]*?)<\/linearGradient>/.exec(defs);
  ok('silver gradient exists', !!silverDef);
  ok('platinum gradient exists', !!platinumDef);
  ok('silver keeps a cool highlight', silverDef && silverDef[1].indexOf('#d6e2f0') >= 0);
  ok('platinum uses warm champagne', platinumDef && platinumDef[1].indexOf('#fff8e8') >= 0 && platinumDef[1].indexOf('#efdfc0') >= 0);
  ok('silver and platinum gradients differ', silverDef && platinumDef && silverDef[1] !== platinumDef[1]);
}));

/* ------------------------------------------------------------------ */
/* 9. page contract checks                                             */
/* ------------------------------------------------------------------ */
results.push(group('page contract', function () {
  ok('loads rewards engine sibling', html.indexOf('<script src="../shared/rewards.js"></script>') >= 0);
  ok('canvas is 1080 wide', html.indexOf('width="1080"') >= 0);
  ok('canvas is 1350 tall', html.indexOf('height="1350"') >= 0);
  ok('prefers-reduced-motion handled', html.indexOf('prefers-reduced-motion:reduce') >= 0);
  ok('stagger interval <= 60ms', /animation-delay:calc\(var\(--i,0\) \* 45ms\)/.test(html));
  ok('has aria progressbar', html.indexOf('role="progressbar"') >= 0);
  ok('has share button', html.indexOf('id="btnShare"') >= 0);
  ok('has copy fallback', html.indexOf('id="btnCopy"') >= 0);
  ok('has dialog detail', html.indexOf('<dialog') >= 0);
  ok('uses no external font', html.indexOf('fonts.googleapis') < 0 && html.indexOf('@font-face') < 0);
  ok('uses no external cdn', html.indexOf('cdn.') < 0 && html.indexOf('unpkg') < 0 && html.indexOf('jsdelivr') < 0);
  ok('no remote images', html.indexOf('<img') < 0);
  ok('rules page has Article + FAQPage', fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8').indexOf('"Article"') >= 0 &&
    fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8').indexOf('"FAQPage"') >= 0);
  ok('rules page is Chinese', fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8').indexOf('lang="zh-CN"') >= 0);
}));

/* ------------------------------------------------------------------ */
/* summary                                                             */
/* ------------------------------------------------------------------ */
results.forEach(function (r) {
  console.log((r.fail === 0 ? 'PASS  ' : 'FAIL  ') + r.name + '  (' + r.pass + ' passed' + (r.fail ? ', ' + r.fail + ' failed' : '') + ')');
});
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
}
console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
