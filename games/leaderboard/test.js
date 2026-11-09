'use strict';

/*
 * Contract tests for games/shared/leaderboard.js.
 *
 * Run: node games/leaderboard/test.js
 *
 * No npm dependencies. The fake localStorage / cookie / IndexedDB adapter let
 * us exercise the real recovery paths in Node, including "only localStorage
 * was deleted" without a browser.
 */

var crypto = require('node:crypto');
var L = require('../shared/leaderboard.js');

/* Minimal async-capable harness. games/tests/lib.js runs group callbacks
 * synchronously, which would report pending promises as passing; several
 * recovery tests here must await IndexedDB/fetch. Output keeps the
 * "RESULT: n passed, m failed" line that run-all.js parses. */
var passed = 0;
var failed = 0;
var failures = [];
var queue = [];

function ok(label, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
}
function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  ok(label, a === e, 'got ' + a + ', want ' + e);
}
function group(name, fn) {
  queue.push(async function () {
    var p0 = passed;
    var f0 = failed;
    try {
      await fn();
    } catch (e) {
      failed++;
      failures.push(name + ' 抛异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
    }
    console.log('[' + (failed === f0 ? 'PASS' : 'FAIL') + '] ' + name + ': ' +
      (passed - p0) + ' 项断言, ' + (failed - f0) + ' 失败');
  });
}
var s = { ok: ok, eq: eq, group: group };

/* -------------------------------------------------------------------------- *
 * Fake browser environment                                                   *
 * -------------------------------------------------------------------------- */

function FakeStorage() { this.map = Object.create(null); }
FakeStorage.prototype.getItem = function (k) {
  return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null;
};
FakeStorage.prototype.setItem = function (k, v) { this.map[k] = String(v); };
FakeStorage.prototype.removeItem = function (k) { delete this.map[k]; };
FakeStorage.prototype.clear = function () { this.map = Object.create(null); };

var ls = new FakeStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: ls, configurable: true, writable: true
});

var jar = Object.create(null);
var cookieWrites = [];
var fakeDocument = {};
Object.defineProperty(fakeDocument, 'cookie', {
  configurable: true,
  get: function () {
    return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
  },
  set: function (raw) {
    raw = String(raw);
    cookieWrites.push(raw);
    var pair = raw.split(';')[0];
    var eq = pair.indexOf('=');
    if (eq < 0) return;
    var name = pair.slice(0, eq).trim();
    var value = pair.slice(eq + 1).trim();
    var maxAge = /max-age=(-?\d+)/i.exec(raw);
    if ((maxAge && Number(maxAge[1]) <= 0) || value === '') delete jar[name];
    else jar[name] = value;
  }
});
Object.defineProperty(globalThis, 'document', {
  value: fakeDocument, configurable: true, writable: true
});

var locationStub = { search: '' };
Object.defineProperty(globalThis, 'location', {
  value: locationStub, configurable: true, writable: true
});

var idbMap = Object.create(null);
function fakeIdbAdapter() {
  return {
    get: function (k) { return Promise.resolve(idbMap[k] == null ? null : idbMap[k]); },
    set: function (k, v) { idbMap[k] = String(v); return Promise.resolve(true); },
    del: function (k) { delete idbMap[k]; return Promise.resolve(true); }
  };
}

var realFetch = globalThis.fetch;
function setFetch(fn) { globalThis.fetch = fn; }

function resetEnv() {
  L._resetForTest();
  L._setIdbAdapter(fakeIdbAdapter());
  ls.clear();
  Object.keys(jar).forEach(function (k) { delete jar[k]; });
  Object.keys(idbMap).forEach(function (k) { delete idbMap[k]; });
  cookieWrites.length = 0;
  locationStub.search = '';
  globalThis.fetch = realFetch;
}

function jsonResponse(status, data, headers) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: function (name) { return (headers || {})[name] || null; } },
    json: function () { return Promise.resolve(data); }
  };
}

function tampered(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hasLoneSurrogate(s) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      var next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- *
 * 1. Challenge link round-trips                                              *
 * -------------------------------------------------------------------------- */

s.group('1. 挑战链接 buildChallenge / parseChallenge', function () {
  var state = { game: '24game', value: 32, kind: 'time', name: '小明', at: 1762700000000 };
  var code = L.buildChallenge(state);
  s.ok('生成非空 base64url', typeof code === 'string' && /^[A-Za-z0-9_-]+$/.test(code));
  s.eq('往返字段一致', L.parseChallenge(code), state);

  var xp = L.buildChallenge({ game: 'chess', value: 1840, kind: 'xp', name: 'Rook', at: 5 });
  s.eq('xp 往返一致', L.parseChallenge(xp), { game: 'chess', value: 1840, kind: 'xp', name: 'Rook', at: 5 });

  var streak = L.buildChallenge({ game: 'gomoku', value: 7, kind: 'streak', name: '连 胜', at: 9 });
  s.eq('中文名与空格往返一致', L.parseChallenge(streak).name, '连 胜');

  var emoji = L.buildChallenge({ game: 'solitaire', value: 200, kind: 'time', name: '玩家 🂡', at: 1 });
  s.eq('非 BMP 字符往返一致', L.parseChallenge(emoji).name, '玩家 🂡');

  s.eq('at 缺省为 0', L.parseChallenge(L.buildChallenge({ game: 'chess', value: 1, kind: 'xp', name: 'a' })).at, 0);
  s.eq('挑战展示名按码点截到 12', L.parseChallenge(L.buildChallenge({
    game: 'chess', value: 1, kind: 'xp', name: new Array(31).join('字')
  })).name.length, 12);

  var emoji13 = new Array(14).join('🂡');
  var emojiParsed = L.parseChallenge(L.buildChallenge({
    game: 'solitaire', value: 200, kind: 'time', name: emoji13
  }));
  s.eq('13 个 emoji 昵称截到 12 个完整码点', Array.from(emojiParsed.name).length, 12);
  s.eq('截断后没有半个 emoji', hasLoneSurrogate(emojiParsed.name), false);

  s.eq('null 输入返回 null', L.buildChallenge(null), null);
  s.eq('非对象输入返回 null', L.buildChallenge('x'), null);
  s.eq('非法 slug 返回 null', L.buildChallenge({ game: 'Bad Slug!', value: 1, kind: 'xp', name: 'a' }), null);
  s.eq('负分返回 null', L.buildChallenge({ game: 'chess', value: -1, kind: 'xp', name: 'a' }), null);
  s.eq('NaN 返回 null', L.buildChallenge({ game: 'chess', value: NaN, kind: 'xp', name: 'a' }), null);
  s.eq('非法 kind 返回 null', L.buildChallenge({ game: 'chess', value: 1, kind: 'score', name: 'a' }), null);
  s.eq('空昵称返回 null', L.buildChallenge({ game: 'chess', value: 1, kind: 'xp', name: '   ' }), null);
  s.eq('超长 game slug 返回 null', L.buildChallenge({ game: new Array(45).join('a'), value: 1, kind: 'xp', name: 'a' }), null);
  s.eq('time 0 秒返回 null（服务端下限 1 秒）', L.buildChallenge({ game: '24game', value: 0, kind: 'time', name: 'a' }), null);
  s.eq('xp 小数返回 null', L.buildChallenge({ game: 'chess', value: 1.5, kind: 'xp', name: 'a' }), null);
  s.eq('xp 超过 1,000,000 返回 null', L.buildChallenge({ game: 'chess', value: 1000001, kind: 'xp', name: 'a' }), null);
  s.eq('streak 超过 3650 返回 null', L.buildChallenge({ game: 'gomoku', value: 3651, kind: 'streak', name: 'a' }), null);

  s.eq('空串无法解析', L.parseChallenge(''), null);
  s.eq('乱码无法解析', L.parseChallenge('!!!!not-base64'), null);
  s.eq('超长串无法解析', L.parseChallenge(new Array(514).join('a')), null);
  s.eq('非对象 JSON 无法解析', L.parseChallenge(tampered([1, 2, 3])), null);
  s.eq('篡改 kind 无法解析', L.parseChallenge(tampered({
    game: 'chess', value: 1, kind: 'hack', name: 'a', at: 1
  })), null);
  s.eq('篡改负分无法解析', L.parseChallenge(tampered({
    game: 'chess', value: -5, kind: 'xp', name: 'a', at: 1
  })), null);
  s.eq('缺 at 无法解析', L.parseChallenge(tampered({
    game: 'chess', value: 1, kind: 'xp', name: 'a'
  })), null);
});

/* -------------------------------------------------------------------------- *
 * 2. Nicknames and the anonymous display name                                *
 * -------------------------------------------------------------------------- */

s.group('2. 昵称清洗与匿名名', function () {
  s.eq('首尾空白裁掉', L.cleanName('  小明  '), '小明');
  s.eq('内部连续空白折叠', L.cleanName('小   明'), '小 明');
  s.eq('控制字符去掉', L.cleanName('a\u0000b\u001fc'), 'a b c');
  s.eq('零宽字符去掉', L.cleanName('a​b'), 'a b');
  s.eq('非字符串返回空串', L.cleanName(null), '');
  s.eq('emoji 不在服务端字符集内，去掉', L.cleanName('a🂡b'), 'ab');
  s.eq('尖括号去掉', L.cleanName('<b>x</b>').indexOf('<'), -1);
  s.eq('井号保留（服务端已放行），其余标点去掉', L.cleanName('小明#1!'), '小明#1');
  s.eq('匿名名清洗后仍带 #', L.cleanName('玩家 #AB12'), '玩家 #AB12');

  var twelve = L.cleanName(new Array(30).join('字'));
  s.eq('按码点截到服务端上限 12', Array.from(twelve).length, 12);

  var thirteen = L.cleanName(new Array(14).join('字'));
  s.eq('13 个中文码点昵称截到 12', Array.from(thirteen).length, 12);
  s.eq('截取的是前 12 个码点', thirteen, Array.from(new Array(14).join('字')).slice(0, 12).join(''));
  s.eq('中文昵称截断后无半个 emoji', hasLoneSurrogate(thirteen), false);

  s.eq('setName 返回清洗后的值', L.setName('  阿发  '), '阿发');
  s.eq('getName 读回', L.getName(), '阿发');
  s.eq('setName 空值清掉昵称', L.setName('   '), '');
  s.eq('清掉后 getName 为空', L.getName(), '');

  var d = '0123456789abcdef0123456789abcdef';
  var expectedShort = '#' + crypto.createHash('sha256').update(d).digest('hex').slice(0, 4).toUpperCase();
  s.eq('短号取 SHA-256 前 4 位大写', L.shortId(d), expectedShort);
  s.ok('短号格式 #[0-9A-F]{4}', /^#[0-9A-F]{4}$/.test(L.shortId(d)));
  s.eq('匿名名格式', L.anonymousName(d), '玩家 ' + expectedShort);
  s.eq('匿名名稳定', L.anonymousName(d), L.anonymousName(d));
  s.ok('提交用匿名名含 # 且短号 4 位大写', /^玩家 #[0-9A-F]{4}$/.test(L.submitName(d)));
  s.eq('无昵称时 submitName 用带 # 的匿名名', L.submitName(d), L.anonymousName(d));
  s.eq('SHA-256 与 node:crypto 一致', L._sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  s.eq('无昵称时 displayName 用带 # 的匿名名', L.displayName(),
    '玩家 #' + crypto.createHash('sha256').update(L.device()).digest('hex').slice(0, 4).toUpperCase());
  L.setName('阿发');
  s.eq('有昵称时 displayName 用昵称', L.displayName(), '阿发');
  s.eq('有昵称时 submitName 用昵称', L.submitName(d), '阿发');
});

/* -------------------------------------------------------------------------- *
 * 3. Device id: format, idempotence, three-way recovery                      *
 * -------------------------------------------------------------------------- */

s.group('3. 设备编号生成与三处冗余', function () {
  resetEnv();
  s.eq('默认 API 指向已部署 worker', L.API, 'https://game-leaderboard.superapp-devin.workers.dev');
  var d = L.device();
  s.ok('32 位小写 hex', /^[0-9a-f]{32}$/.test(d));
  s.eq('连续调用同一个值', L.device(), d);
  s.eq('localStorage 已写入', ls.getItem('hhfa-device-v1'), d);
  s.eq('cookie 已写入', jar.hhfa_dev, d);
  s.eq('IndexedDB 已写入', idbMap['hhfa-device-v1'], d);
  s.ok('cookie 带 SameSite=Lax', cookieWrites.some(function (w) { return /SameSite=Lax/i.test(w); }));
  s.ok('cookie 有效期 400 天', cookieWrites.some(function (w) { return /Max-Age=34560000/.test(w); }));
});

s.group('4. 删除 localStorage 后从冗余恢复同一 device', async function () {
  resetEnv();
  var d0 = await L.ready();

  // Only localStorage disappears; cookie and IndexedDB both survive.
  ls.removeItem('hhfa-device-v1');
  L._resetForTest();
  L._setIdbAdapter(fakeIdbAdapter());
  var d1 = await L.ready();
  s.eq('只删 localStorage 仍恢复同一 device', d1, d0);
  s.eq('localStorage 被回填', ls.getItem('hhfa-device-v1'), d0);

  // Both localStorage and the cookie disappear; IndexedDB alone survives.
  ls.removeItem('hhfa-device-v1');
  delete jar.hhfa_dev;
  L._resetForTest();
  L._setIdbAdapter(fakeIdbAdapter());
  var d2 = await L.ready();
  s.eq('只靠 IndexedDB 恢复同一 device', d2, d0);
  s.eq('cookie 被回填', jar.hhfa_dev, d0);

  // localStorage and IndexedDB disappear; the cookie alone survives.
  ls.removeItem('hhfa-device-v1');
  delete idbMap['hhfa-device-v1'];
  L._resetForTest();
  L._setIdbAdapter(fakeIdbAdapter());
  var d3 = await L.ready();
  s.eq('只靠 cookie 恢复同一 device', d3, d0);
  s.eq('IndexedDB 被回填', idbMap['hhfa-device-v1'], d0);
});

/* -------------------------------------------------------------------------- *
 * 5. submit: anonymous name, payload, error mapping                          *
 * -------------------------------------------------------------------------- */

s.group('5. submit 提交匿名名与错误降级', async function () {
  resetEnv();
  var captured = null;
  var scoreCalls = 0;
  setFetch(function (url, init) {
    scoreCalls++;
    captured = { url: url, init: init, body: JSON.parse(init.body) };
    return Promise.resolve(jsonResponse(200, { ok: true, rank: 3, best: 940 }));
  });
  var res = await L.submit({ game: 'chess', value: 900, kind: 'xp' });
  s.ok('带 # 的匿名名一次提交成功', res.ok && res.rank === 3 && res.best === 940);
  s.eq('匿名提交只发一次请求', scoreCalls, 1);
  s.eq('请求打到 /api/score', captured.url.indexOf('/api/score') > 0, true);
  s.eq('payload.device 与主键一致', captured.body.device, L.device());
  s.eq('payload.name 使用带 # 的匿名名', captured.body.name, L.anonymousName(L.device()));
  s.ok('payload.name 短号格式 #[0-9A-F]{4}', /玩家 #[0-9A-F]{4}$/.test(captured.body.name));
  s.eq('payload 字段完整', [captured.body.game, captured.body.value, captured.body.kind],
    ['chess', 900, 'xp']);
  s.ok('credentials=omit', captured.init.credentials === 'omit');

  L.setName('阿发');
  await L.submit({ game: 'chess', value: 1000, kind: 'xp' });
  s.eq('有昵称时提交昵称', captured.body.name, '阿发');
  s.eq('有昵称时也只发一次请求', scoreCalls, 2);

  s.eq('非法 game 直接拒绝', (await L.submit({ game: 'Bad!', value: 1, kind: 'xp' })).error, 'bad_game');
  s.eq('负分直接拒绝', (await L.submit({ game: 'chess', value: -1, kind: 'xp' })).error, 'bad_value');
  s.eq('time 0 秒直接拒绝', (await L.submit({ game: 'chess', value: 0, kind: 'time' })).error, 'bad_value');
  s.eq('xp 小数直接拒绝', (await L.submit({ game: 'chess', value: 1.5, kind: 'xp' })).error, 'bad_value');
  s.eq('xp 超上限直接拒绝', (await L.submit({ game: 'chess', value: 1000001, kind: 'xp' })).error, 'bad_value');
  s.eq('streak 超上限直接拒绝', (await L.submit({ game: 'gomoku', value: 3651, kind: 'streak' })).error, 'bad_value');

  setFetch(function () {
    return Promise.resolve(jsonResponse(429, { ok: false, error: 'rate_limited', retryAfter: 30 }));
  });
  var limited = await L.submit({ game: 'chess', value: 1, kind: 'xp' });
  s.ok('429 映射为 rate_limited', limited.ok === false && limited.error === 'rate_limited');
  s.eq('429 带 retryAfter', limited.retryAfter, 30);

  setFetch(function () { return Promise.reject(new Error('network down')); });
  var offline = await L.submit({ game: 'chess', value: 1, kind: 'xp' });
  s.ok('网络失败不抛异常', offline.ok === false && offline.error === 'offline');
});

/* -------------------------------------------------------------------------- *
 * 6. Ranking and empty-state predicates                                     *
 * -------------------------------------------------------------------------- */

s.group('6. 榜单排序、并列名次与空态', function () {
  var xp = L.rankRows([
    { name: 'a', value: 10, kind: 'xp' },
    { name: 'b', value: 30, kind: 'xp' },
    { name: 'c', value: 20, kind: 'xp' }
  ], 'xp');
  s.eq('xp 降序', xp.map(function (r) { return r.value; }), [30, 20, 10]);
  s.eq('xp 名次', xp.map(function (r) { return r.rank; }), [1, 2, 3]);

  var time = L.rankRows([
    { name: 'a', value: 90, kind: 'time' },
    { name: 'b', value: 75, kind: 'time' },
    { name: 'c', value: 80, kind: 'time' }
  ], 'time');
  s.eq('time 升序', time.map(function (r) { return r.value; }), [75, 80, 90]);

  var tie = L.rankRows([
    { name: 'a', value: 100, kind: 'xp' },
    { name: 'b', value: 100, kind: 'xp' },
    { name: 'c', value: 90, kind: 'xp' },
    { name: 'd', value: 80, kind: 'xp' }
  ], 'xp');
  s.eq('并列共享名次且跳号 (1,1,3,4)', tie.map(function (r) { return r.rank; }), [1, 1, 3, 4]);
  s.eq('并列保持原顺序', tie.map(function (r) { return r.name; }), ['a', 'b', 'c', 'd']);

  var timeTie = L.rankRows([
    { name: 'a', value: 60, kind: 'time' },
    { name: 'b', value: 55, kind: 'time' },
    { name: 'c', value: 60, kind: 'time' }
  ], 'time');
  s.eq('time 并列名次', timeTie.map(function (r) { return r.rank; }), [1, 2, 2]);

  var original = [{ name: 'a', value: 1, kind: 'xp' }];
  L.rankRows(original, 'xp');
  s.eq('rankRows 不修改输入', original[0].rank, undefined);

  var dirty = L.rankRows([
    { name: 'ok', value: 5, kind: 'xp' },
    { name: 'bad', value: 'x', kind: 'xp' },
    null,
    { name: 'also', value: 7, kind: 'xp' }
  ], 'xp');
  s.eq('非法 value 被过滤', dirty.map(function (r) { return r.name; }), ['also', 'ok']);

  s.eq('空数组是空态', L.isEmptyBoard([]), true);
  s.eq('null 是空态', L.isEmptyBoard(null), true);
  s.eq('非数组是空态', L.isEmptyBoard('rows'), true);
  s.eq('有行不是空态', L.isEmptyBoard([{ name: 'a' }]), false);
});

/* -------------------------------------------------------------------------- *
 * 7. board() contract and failure degradation                                *
 * -------------------------------------------------------------------------- */

s.group('7. board 契约与失败降级', async function () {
  resetEnv();
  setFetch(function (url) {
    return Promise.resolve(jsonResponse(200, {
      ok: true,
      period: 'week',
      game: 'chess',
      updatedAt: '2026-11-10T00:00:00.000Z',
      total: 120,
      rows: [
        { rank: 9, name: '  low ', avatar: null, value: 10, kind: 'xp', at: 1 },
        { rank: 9, name: 'high', avatar: null, value: 90, kind: 'xp', at: '2026-11-10T00:00:00.000Z' },
        { rank: 9, name: 'mid', avatar: null, value: 50, kind: 'xp', at: 3 }
      ]
    }));
  });
  var b = await L.board({ game: 'chess', period: 'week', limit: 50 });
  s.ok('board 成功', b.ok === true && b.total === 120);
  s.eq('服务端未排序时客户端重排', b.rows.map(function (r) { return r.name; }), ['high', 'mid', 'low']);
  s.eq('名次重算', b.rows.map(function (r) { return r.rank; }), [1, 2, 3]);
  s.eq('昵称被清洗', b.rows[2].name, 'low');
  s.eq('服务端 ISO 时间解析为毫秒', b.rows[0].at, Date.parse('2026-11-10T00:00:00.000Z'));
  s.eq('period 回传', b.period, 'week');

  // A game should stick to one kind, but real boards can briefly mix them.
  // Each group is ranked on its own, matching the worker's KIND_ORDER.
  setFetch(function () {
    return Promise.resolve(jsonResponse(200, {
      ok: true, period: 'week', game: 'go9', updatedAt: '', total: 2,
      rows: [
        { rank: 1, name: 'xprow', avatar: null, value: 9, kind: 'xp', at: 1 },
        { rank: 1, name: 'timerow', avatar: null, value: 3600, kind: 'time', at: 2 }
      ]
    }));
  });
  var mixed = await L.board({ game: 'go9' });
  s.eq('混合 kind 按 xp→streak→time 分组', mixed.rows.map(function (r) { return r.name; }), ['xprow', 'timerow']);
  s.eq('混合 kind 各自从 1 名开始', mixed.rows.map(function (r) { return r.rank; }), [1, 1]);

  setFetch(function () { return Promise.reject(new Error('offline')); });
  var broken = await L.board({ game: 'chess', period: 'all', limit: 10 });
  s.ok('fetch reject 返回 {ok:false} 而非抛出', broken.ok === false && broken.error === 'offline');

  setFetch(function () { throw new Error('sync throw'); });
  var thrown = await L.board({ game: 'chess' });
  s.eq('fetch 同步抛错也降级', thrown.error, 'offline');

  setFetch(function () { return Promise.resolve(jsonResponse(500, { ok: false, error: 'boom' })); });
  var server = await L.board({ game: 'chess' });
  s.eq('5xx 映射服务端 error', server.error, 'boom');

  globalThis.fetch = undefined;
  var none = await L.board({ game: 'chess' });
  s.eq('无 fetch 时降级为 offline', none.error, 'offline');

  resetEnv();
  var calls = 0;
  setFetch(function () {
    calls++;
    return Promise.resolve(jsonResponse(200, { ok: true }));
  });
  s.eq('available 探测 true', await L.available(), true);
  s.eq('available 60 秒内复用缓存', await L.available(), true);
  s.eq('缓存期内只请求一次', calls, 1);
});

/* -------------------------------------------------------------------------- *
 * 8. deleteAll rotates the device after server confirmation                  *
 * -------------------------------------------------------------------------- */

s.group('8. 删除数据后重新生成设备', async function () {
  resetEnv();
  var old = await L.ready();
  L.setName('要被删掉的人');
  var calls = [];
  setFetch(function (url, init) {
    calls.push(JSON.parse(init.body));
    return Promise.resolve(jsonResponse(200, { ok: true }));
  });
  var res = await L.deleteAll();
  s.ok('删除成功', res.ok === true && res.localCleared === true);
  s.eq('/api/delete 收到旧 device', calls[0].device, old);
  s.ok('删除后 device 变化', res.device !== old);
  s.ok('新 device 仍是 32 位 hex', /^[0-9a-f]{32}$/.test(res.device));
  s.eq('本地昵称已清', ls.getItem('hhfa-name-v1'), null);
  s.eq('本地 device 更新', ls.getItem('hhfa-device-v1'), res.device);
  s.eq('cookie 更新', jar.hhfa_dev, res.device);
  s.eq('IndexedDB 更新为新 device', idbMap['hhfa-device-v1'], res.device);
  s.eq('再次 ready 仍是新 device', await L.ready(), res.device);

  resetEnv();
  var kept = await L.ready();
  setFetch(function () { return Promise.reject(new Error('offline')); });
  var failed = await L.deleteAll();
  s.ok('服务端失败时不旋转设备', failed.ok === false && failed.localCleared === false);
  s.eq('失败后 device 不变', L.device(), kept);
});

/* -------------------------------------------------------------------------- *
 * 9. ?mock=1 path (the page's self-test mode)                                *
 * -------------------------------------------------------------------------- */

s.group('9. ?mock=1 本地假数据', async function () {
  resetEnv();
  locationStub.search = '?mock=1';
  s.eq('isMock 识别参数', L.isMock(), true);

  var b = await L.board({ game: 'xiangqi', period: 'week', limit: 50 });
  s.ok('mock 榜单有数据', b.ok === true && b.rows.length >= 3);
  s.eq('mock 名次从 1 开始', b.rows[0].rank, 1);
  s.eq('mock 带头像三要素', Object.keys(b.rows[0].avatar).sort(), ['h1', 'h2', 'shape']);

  var empty = await L.board({ game: 'mahjong', period: 'week', limit: 50 });
  s.ok('mock 空榜单返回 0 行', empty.ok === true && empty.rows.length === 0);

  var sub = await L.submit({ game: 'xiangqi', value: 60, kind: 'time' });
  s.ok('mock 提交返回名次', sub.ok === true && sub.mock === true && sub.rank >= 1);
  s.eq('mock 提交不联网', globalThis.fetch, realFetch);

  var del = await L.deleteAll();
  s.ok('mock 删除后旋转 device', del.ok === true && del.localCleared === true);
});

resetEnv();

(async function () {
  for (var i = 0; i < queue.length; i++) await queue[i]();
  if (failures.length) {
    console.log('');
    failures.slice(0, 40).forEach(function (f) { console.log('  FAIL: ' + f); });
  }
  console.log('');
  console.log('总计: ' + passed + ' 通过, ' + failed + ' 失败');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
