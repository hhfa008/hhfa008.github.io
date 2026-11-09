#!/usr/bin/env node
'use strict';

/*
 * Self-checks for the Ember Coast deck builder (games/tcg-deck/index.html).
 *
 * The page keeps its rules and share codec inline. Instead of copying that
 * logic here, the test extracts the page's own <script id="deck-core"> block
 * and runs it inside node:vm with just enough DOM/browser stubs for init() to
 * boot. Every assertion therefore exercises the same code the browser runs.
 *
 * Covered:
 *   1. games/tcg-sample/cards.json: required fields, integer cost/atk/hp,
 *      unique ids, type/kind vocabulary, trilingual name/text, art files.
 *   2. Deck rules: 30 cards, max 3 copies of a name, at least 12 creatures.
 *   3. Add/remove limits and validate() rows.
 *   4. Export/import/encode/decode round-trips and malformed input.
 *   5. Share URL length and payload round-trip.
 *   6. Field alignment with games/shared/tcg.js (unit/spell/relic).
 *
 * Run: node games/tcg-deck/test.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var lib = require('../tests/lib');
var TCG = require('../shared/tcg.js');

var GAMES = path.resolve(__dirname, '..');
var PAGE_PATH = path.join(__dirname, 'index.html');
var CARDS_PATH = path.join(GAMES, 'tcg-sample', 'cards.json');
var TYPES = ['unit', 'spell', 'relic'];
var TYPE_KIND = { unit: 'creature', spell: 'spell', relic: 'relic' };
var RARITIES = ['common', 'rare', 'legendary'];

var RAW = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8')).cards;
var PAGE = lib.page(__dirname);

var s = lib.suite('tcg-deck');

function element() {
  var el = {
    innerHTML: '', textContent: '', value: '', hidden: false, open: false,
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
    setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return element(); },
    addEventListener: function () {}, appendChild: function () {}, remove: function () {},
    click: function () {}, focus: function () {},
    closest: function () { return null; }, style: {}
  };
  return el;
}

function loadPage() {
  var code = lib.scriptCode(PAGE, 'deck-core');
  var stored = new Map();
  var byId = Object.create(null);
  var document = {
    documentElement: element(),
    body: element(),
    readyState: 'complete',
    getElementById: function (id) { return byId[id] || (byId[id] = element()); },
    querySelectorAll: function () { return []; },
    querySelector: function () { return element(); },
    createElement: function () { return element(); },
    addEventListener: function () {}
  };
  var sandbox = {
    console: console,
    document: document,
    localStorage: {
      getItem: function (k) { return stored.has(k) ? stored.get(k) : null; },
      setItem: function (k, v) { stored.set(k, v); }
    },
    navigator: {
      language: 'zh',
      clipboard: { writeText: function () { return Promise.resolve(); } }
    },
    location: { origin: 'https://hhfa008.github.io', pathname: '/games/tcg-deck/', search: '' },
    fetch: function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ cards: RAW }); } });
    },
    btoa: btoa,
    atob: atob,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    URLSearchParams: URLSearchParams,
    URL: URL,
    Blob: Blob,
    // The page arms status-timers (up to 8 s). Unref them so the test process
    // can exit as soon as the assertions finish.
    setTimeout: function (fn, ms) {
      var t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout: clearTimeout
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(code, sandbox, { filename: 'games/tcg-deck/index.html#deck-core' });
  return sandbox;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function cloneDeck(deck) {
  return JSON.parse(JSON.stringify(deck));
}

function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

function unitIds(n) {
  return RAW.filter(function (c) { return c.type === 'unit'; }).slice(0, n).map(function (c) { return c.id; });
}
function otherIds(n) {
  return RAW.filter(function (c) { return c.type !== 'unit'; }).slice(0, n).map(function (c) { return c.id; });
}
function deckOf(units, others, unitCopies, otherCopies) {
  var cards = [];
  unitIds(units).forEach(function (id) { cards.push({ id: id, count: unitCopies }); });
  otherIds(others).forEach(function (id) { cards.push({ id: id, count: otherCopies }); });
  return { name: '测试牌组', cards: cards };
}
function totalOf(deck) {
  return deck.cards.reduce(function (n, c) { return n + c.count; }, 0);
}
function rowOf(result, key) {
  return result.rows.filter(function (r) { return r.key === key; })[0];
}
function b64urlDecode(str) {
  var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64');
}
function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  var sandbox = loadPage();
  var D = null;
  for (var wait = 0; wait < 40; wait++) {
    D = sandbox.TCGDeck;
    if (D && D.state && D.state.cards && D.state.cards.length) break;
    await sleep(5);
  }

  s.group('0. 页面核心可从 index.html 抽取并启动', function () {
    s.ok('window.TCGDeck 已发布', !!D);
    s.ok('cards.json 已载入 36 张', !!D && D.state.cards.length === 36,
      D ? String(D.state.cards.length) : 'no API');
    s.ok('byId 索引与卡片数一致', !!D && Object.keys(D.state.byId).length === RAW.length,
      D ? String(Object.keys(D.state.byId).length) : 'no API');
    return D ? 'deck-core 内联脚本 + DOM/browser 桩' : '未加载';
  });

  if (!D) {
    s.done();
    return;
  }

  /* ---------------------------------------------------------------- *
   * 1. Card data                                                     *
   * ---------------------------------------------------------------- */

  s.group('1. 卡牌数据：必填字段、整数费用/攻防、唯一 id、类型词表', function () {
    var ids = Object.create(null);
    var duplicates = [];
    var badType = [];
    var badKind = [];
    var badNumber = [];
    var badName = [];
    var badText = [];
    var badRarity = [];
    var badArt = [];
    var badEffects = [];
    var badUnitStats = [];
    var badNonUnit = [];
    var typeCounts = { unit: 0, spell: 0, relic: 0 };

    RAW.forEach(function (c) {
      if (typeof c.id !== 'string' || !/^[a-z]+-\d{3}$/.test(c.id)) duplicates.push('id:' + c.id);
      if (ids[c.id]) duplicates.push(c.id);
      ids[c.id] = true;

      if (TYPES.indexOf(c.type) < 0) badType.push(c.id);
      else typeCounts[c.type]++;
      if (TYPE_KIND[c.type] !== c.kind) badKind.push(c.id);

      if (!isInt(c.cost) || c.cost < 0 || !isInt(c.atk) || c.atk < 0 || !isInt(c.hp) || c.hp < 1) {
        badNumber.push(c.id);
      }
      ['zh', 'en', 'id'].forEach(function (lang) {
        if (!c.name || typeof c.name[lang] !== 'string' || !c.name[lang]) badName.push(c.id + '.' + lang);
        if (!c.text || typeof c.text[lang] !== 'string' || !c.text[lang]) badText.push(c.id + '.' + lang);
      });
      if (RARITIES.indexOf(c.rarity) < 0) badRarity.push(c.id);
      if (typeof c.art !== 'string' || !fs.existsSync(path.join(GAMES, 'tcg-sample', c.art))) badArt.push(c.id);
      if (!Array.isArray(c.effects)) badEffects.push(c.id);

      if (c.type === 'unit') {
        if (!c.stats || c.stats.atk !== c.atk || c.stats.hp !== c.hp) badUnitStats.push(c.id);
      } else if (c.atk !== 0 || c.hp !== 1) {
        badNonUnit.push(c.id);
      }
    });

    s.ok('卡片总数为 36', RAW.length === 36, String(RAW.length));
    s.ok('每张卡的 id 唯一且符合 <家族>-<三位数字>', duplicates.length === 0, duplicates.join(','));
    s.ok('type 只取 unit/spell/relic', badType.length === 0, badType.join(','));
    s.eq('type 分布 unit/spell/relic', typeCounts, { unit: 20, spell: 10, relic: 6 });
    s.ok('kind 与 type 一致（unit→creature）', badKind.length === 0, badKind.join(','));
    s.ok('cost/atk/hp 均为整数且范围合法', badNumber.length === 0, badNumber.join(','));
    s.ok('name 三语齐全且非空', badName.length === 0, badName.join(','));
    s.ok('text 三语齐全且非空', badText.length === 0, badText.join(','));
    s.ok('rarity 只取 common/rare/legendary', badRarity.length === 0, badRarity.join(','));
    s.ok('art 路径指向实际存在的文件', badArt.length === 0, badArt.join(','));
    s.ok('effects 均为数组', badEffects.length === 0, badEffects.join(','));
    s.ok('unit 的 stats 与 atk/hp 一致', badUnitStats.length === 0, badUnitStats.join(','));
    s.ok('非 unit 卡的 atk/hp 为占位值 0/1', badNonUnit.length === 0, badNonUnit.join(','));
    return RAW.length + ' 张卡逐字段校验';
  });

  /* ---------------------------------------------------------------- *
   * 2. Deck rules                                                    *
   * ---------------------------------------------------------------- */

  s.group('2. 组卡规则：30 张、同名最多 3、至少 12 张生物', function () {
    s.eq('RULES 常量', D.rules, { deckSize: 30, maxCopies: 3, minCreatures: 12 });

    var valid = deckOf(4, 6, 3, 3); // 12 units + 18 others = 30
    D.state.deck = cloneDeck(valid);
    var okResult = D.validate();
    s.ok('12 生物 + 18 非生物的 30 张牌组合法', okResult.ok, JSON.stringify(okResult.rows));
    s.eq('总张数行显示 30/30', rowOf(okResult, 'total').value, '30/30');
    s.eq('生物行显示 12/12', rowOf(okResult, 'creature').value, '12/12');
    s.eq('同名行显示 3/3', rowOf(okResult, 'copies').value, '3/3');

    var short = cloneDeck(valid);
    short.cards[short.cards.length - 1].count = 2; // drop a non-unit copy
    D.state.deck = short;
    s.ok('总张数 29 被拒绝', !D.validate().ok);
    s.ok('总张数 29 只红 total 行', !rowOf(D.validate(), 'total').ok && rowOf(D.validate(), 'creature').ok);

    var long = cloneDeck(valid);
    long.cards.push({ id: otherIds(7)[6], count: 1 });
    D.state.deck = long;
    s.ok('总张数 31 被拒绝', !D.validate().ok);
    s.ok('总张数 31 只红 total 行', !rowOf(D.validate(), 'total').ok);

    var tooMany = cloneDeck(valid);
    tooMany.cards[0].count = 4;
    tooMany.cards[1].count = 2; // keep total at 30
    D.state.deck = tooMany;
    s.ok('同名 4 张被拒绝', !D.validate().ok);
    s.ok('同名 4 张只红 copies 行',
      !rowOf(D.validate(), 'copies').ok && rowOf(D.validate(), 'total').ok);

    var fewUnits = { name: 'x', cards: [] };
    unitIds(3).forEach(function (id) { fewUnits.cards.push({ id: id, count: 3 }); });
    fewUnits.cards.push({ id: unitIds(4)[3], count: 2 }); // 11 creatures
    otherIds(6).forEach(function (id, i) { fewUnits.cards.push({ id: id, count: i === 5 ? 4 : 3 }); });
    D.state.deck = fewUnits;
    s.ok('生物 11 张被拒绝（总张数仍为 30）', !D.validate().ok && totalOf(fewUnits) === 30,
      'total=' + totalOf(fewUnits));
    s.ok('生物 11 张只红 creature 行', !rowOf(D.validate(), 'creature').ok);

    var spellsOnly = { name: 'x', cards: [] };
    otherIds(6).forEach(function (id) { spellsOnly.cards.push({ id: id, count: 3 }); });
    unitIds(2).forEach(function (id) { spellsOnly.cards.push({ id: id, count: 3 }); });
    spellsOnly.cards.push({ id: unitIds(3)[2], count: 3 });
    D.state.deck = spellsOnly;
    s.ok('只有 9 张生物时 creature 行失败', !rowOf(D.validate(), 'creature').ok,
      rowOf(D.validate(), 'creature').value);
    return '30/3/12 三条规则逐项造违规';
  });

  /* ---------------------------------------------------------------- *
   * 3. Add/remove limits                                             *
   * ---------------------------------------------------------------- */

  s.group('3. 添加/移除：同名上限、总张数上限、递减归零', function () {
    D.clearDeck();
    var id = unitIds(1)[0];
    s.ok('第 1 张加入成功', D.addCard(id) === true);
    s.ok('第 2 张加入成功', D.addCard(id) === true);
    s.ok('第 3 张加入成功', D.addCard(id) === true);
    s.ok('第 4 张同名被拒绝', D.addCard(id) === false);
    s.eq('同名计数停在 3', D.state.deck.cards[0].count, 3);

    D.clearDeck();
    var fill = deckOf(4, 6, 3, 3);
    D.state.deck = cloneDeck(fill);
    s.ok('已有 30 张时再添加被拒绝', D.addCard(otherIds(7)[6]) === false);
    s.eq('总张数仍为 30', totalOf(D.state.deck), 30);

    D.state.deck = cloneDeck(fill);
    var target = fill.cards[0].id;
    s.ok('移除一张成功', D.removeCard(target) === true);
    s.eq('移除后计数为 2', D.state.deck.cards[0].count, 2);
    D.removeCard(target);
    D.removeCard(target);
    s.ok('减到 0 时条目被删除', D.state.deck.cards.every(function (c) { return c.id !== target; }));
    s.ok('移除不存在的卡返回 false', D.removeCard('no-such-card') === false);
    return 'addCard/removeCard 边界';
  });

  /* ---------------------------------------------------------------- *
   * 4. Export / import / codec                                       *
   * ---------------------------------------------------------------- */

  s.group('4. 导出/导入：JSON 往返、非法输入不崩、压缩码往返', function () {
    var deck = deckOf(4, 6, 3, 3);
    deck.name = '  潮汐 牌组  ';
    D.state.deck = cloneDeck(deck);

    var payload = D.exportDeck();
    s.ok('合法牌组可导出', !!payload);
    s.eq('导出时名称被 trim', payload && payload.name, '潮汐 牌组');
    s.eq('导出卡片与状态一致', payload && payload.cards, deck.cards);
    s.ok('非法牌组导出返回 null', (function () {
      D.state.deck = { name: 'bad', cards: [{ id: unitIds(1)[0], count: 1 }] };
      return D.exportDeck() === null;
    })());

    D.state.deck = cloneDeck(deck);
    s.eq('空名称导出使用本地化兜底名', (function () {
      D.state.deck.name = '';
      return D.exportDeck().name;
    })(), '未命名牌组');

    var code = D.encodeDeck(deck);
    s.ok('encodeDeck 输出 base64url（无 + / =）', /^[A-Za-z0-9_-]+$/.test(code), code.slice(0, 24));
    s.eq('encode→decode 往返完全一致', D.decodeDeck(code), { name: deck.name, cards: deck.cards });
    s.ok('解码时保持卡片顺序', JSON.stringify(D.decodeDeck(code).cards) === JSON.stringify(deck.cards));

    s.ok('版本号不是 1 的码会抛错', (function () {
      var text = b64urlDecode(code).toString('utf8');
      var bumped = text.replace(/^1\|/, '2|');
      try { D.decodeDeck(b64urlEncode(Buffer.from(bumped, 'utf8'))); return false; }
      catch (e) { return true; }
    })());
    s.ok('非 base64 垃圾码会抛错而不是返回坏数据', (function () {
      try { D.decodeDeck('!!!not-a-deck'); return false; }
      catch (e) { return true; }
    })());
    s.ok('空字符串会抛错', (function () {
      try { D.decodeDeck(''); return false; }
      catch (e) { return true; }
    })());

    var imported = D.importDeck(JSON.stringify({ name: '导入牌组', cards: deck.cards }));
    s.ok('importDeck 接受合法 JSON', imported.ok === true);
    s.eq('导入后名称正确', D.state.deck.name, '导入牌组');
    s.eq('导入后总张数为 30', totalOf(D.state.deck), 30);

    var dup = D.importDeck(JSON.stringify({
      name: 'dup', cards: [{ id: unitIds(1)[0], count: 2 }, { id: unitIds(1)[0], count: 1 }]
    }));
    s.ok('重复 id 的导入会合并计数', dup.ok === true && D.state.deck.cards.length === 1);
    s.eq('合并后计数为 3', D.state.deck.cards[0].count, 3);

    var unknown = D.importDeck(JSON.stringify({ cards: [{ id: 'ghost-999', count: 1 }] }));
    s.ok('未知卡 id 被拒绝', unknown.ok === false && Array.isArray(unknown.unknown));
    s.eq('未知 id 被回传', unknown.unknown, ['ghost-999']);
    s.ok('非法 JSON 被拒绝', D.importDeck('{oops').ok === false);
    s.ok('缺少 cards 数组被拒绝', D.importDeck(JSON.stringify({ name: 'x' })).ok === false);
    s.ok('非法 count 被拒绝', (function () {
      var r = D.importDeck(JSON.stringify({ cards: [{ id: unitIds(1)[0], count: 0 }] }));
      return r.ok === false && r.error === 'bad count';
    })());
    return 'JSON 与压缩码双向覆盖';
  });

  /* ---------------------------------------------------------------- *
   * 5. Share URL                                                     *
   * ---------------------------------------------------------------- */

  s.group('5. 分享链接：携带可还原牌组且长度受限', function () {
    var deck = deckOf(4, 6, 3, 3);
    deck.name = '分享牌组';
    D.state.deck = cloneDeck(deck);
    var url = D.buildShareUrl();
    var code = D.encodeDeck(deck);

    s.ok('链接以页面地址开头', url.indexOf('https://hhfa008.github.io/games/tcg-deck/?deck=') === 0, url.slice(0, 60));
    s.ok('链接包含 lang 参数', url.indexOf('&lang=zh') > 0);
    s.ok('链接长度不超过 512 字符', url.length <= 512, String(url.length));
    s.ok('链接内嵌的码可还原同一套牌',
      JSON.stringify(D.decodeDeck(url.split('?deck=')[1].split('&lang=')[0])) === JSON.stringify(deck));
    s.eq('内嵌码与 encodeDeck 输出一致', url.split('?deck=')[1].split('&lang=')[0], code);
    return 'URL ' + url.length + ' 字符';
  });

  /* ---------------------------------------------------------------- *
   * 6. Alignment with games/shared/tcg.js                            *
   * ---------------------------------------------------------------- */

  s.group('6. 与 games/shared/tcg.js 字段对齐：unit/spell/relic', function () {
    var pool = Object.create(null);
    RAW.forEach(function (c) { pool[c.id] = c; });
    var deckIds = deckOf(4, 6, 3, 3).cards.map(function (c) { return c.id; });
    var match = TCG.createMatch({
      players: [{ deck: deckIds }, { deck: deckIds }],
      cardPool: pool,
      seed: 7
    });
    s.eq('引擎载入全部 36 张卡定义', Object.keys(match.state.defs).length, 36);

    var seen = {};
    var badType = [];
    RAW.forEach(function (c) {
      var def = match.state.defs[c.id];
      seen[def.type] = true;
      if (TYPES.indexOf(def.type) < 0 || def.type !== c.type) badType.push(c.id);
      if (def.cost !== c.cost || def.atk !== c.atk || def.hp !== c.hp) badType.push(c.id + '.stats');
    });
    s.ok('所有卡在引擎中的 type 与源数据一致且在词表内', badType.length === 0, badType.join(','));
    s.ok('引擎实际看到 unit/spell/relic 三种类型',
      !!seen.unit && !!seen.spell && !!seen.relic, JSON.stringify(Object.keys(seen)));
    s.ok('30 张合法牌组可创建对局（不抛错）', !!match.state.players[0]);
    s.eq('双方起手 5 张', [match.state.players[0].hand.length, match.state.players[1].hand.length], [5, 5]);
    return '共享引擎接受本页全部卡牌定义';
  });

  s.done();
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  s.ok('测试脚本整体执行未抛错', false, String(err && err.message));
  s.done();
  process.exitCode = 1;
});
