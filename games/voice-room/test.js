'use strict';

/*
 * voice-room (语音房) test.
 *
 * Two layers, no network and no real Worker:
 *
 *   1. Page contract — index.html / guide.html / rules.html / registry.json are
 *      read as text. index.html has one large IIFE inline script with no
 *      __TEST_CORE_* or <script id="..."> extraction marker, and it touches
 *      location / DOM / WebRTC at load time, so per the repo convention the
 *      page side is covered with static assertions only (markup contract,
 *      three-language dictionary parity, a11y, endpoints, limits).
 *
 *   2. Worker logic — worker/src/room.js is an ES module with one side-effect
 *      import and only `RoomDO` exported; the pure helpers are module-private
 *      and Node cannot `require()` an ESM file from this CJS test. We load a
 *      derived in-memory copy through a data: URL ESM import: the side-effect
 *      import is replaced by a normal `require('../shared/rules.js')` (which
 *      publishes globalThis.GameRules, exactly like the browser/Worker), and
 *      the module-private helpers are re-exported for testing. Product files
 *      are never written.
 */

var fs = require('fs');
var path = require('path');
var nodeCrypto = require('crypto');
var lib = require('../tests/lib.js');

var s = lib.suite('voice-room');

var DIR = __dirname;
var INDEX_HTML = path.join(DIR, 'index.html');
var GUIDE_HTML = path.join(DIR, 'guide.html');
var RULES_HTML = path.join(DIR, 'rules.html');
var ROOM_JS = path.join(DIR, 'worker', 'src', 'room.js');
var WORKER_JS = path.join(DIR, 'worker', 'src', 'index.js');
var REGISTRY = path.join(DIR, '..', 'registry.json');

var html = lib.page(DIR);
var guide = fs.readFileSync(GUIDE_HTML, 'utf8');
var rulesPage = fs.readFileSync(RULES_HTML, 'utf8');
var roomSource = fs.readFileSync(ROOM_JS, 'utf8');
var workerSource = fs.readFileSync(WORKER_JS, 'utf8');
var registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

// ---------------------------------------------------------------------------
// Static parsing helpers
// ---------------------------------------------------------------------------

function matchAll(text, re) {
  var out = [];
  var m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

// Slice out a balanced {...} starting at `open`, ignoring braces inside
// strings so interpolations like {room} do not disturb the depth count.
function extractObjectAt(text, open) {
  var depth = 0, quote = null, esc = false;
  for (var i = open; i < text.length; i++) {
    var c = text[i];
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced object starting at ' + open);
}

// Parse `key: 'value', key2: "value2"` entries of a flat object literal.
function parseStringEntries(objectText) {
  var out = Object.create(null);
  var i = 1, end = objectText.length - 1;
  while (i < end) {
    while (i < end && /[\s,]/.test(objectText[i])) i++;
    if (i >= end) break;
    var m = /^([A-Za-z0-9_]+)\s*:\s*/.exec(objectText.slice(i));
    if (!m) throw new Error('bad i18n entry near ' + JSON.stringify(objectText.slice(i, i + 40)));
    var key = m[1];
    i += m[0].length;
    var q = objectText[i];
    if (q !== "'" && q !== '"') throw new Error('non-string i18n value: ' + key);
    i++;
    var value = '';
    while (i < end) {
      var c = objectText[i++];
      if (c === '\\') { value += objectText[i++]; continue; }
      if (c === q) break;
      value += c;
    }
    out[key] = value;
  }
  return out;
}

function i18nDicts(source) {
  var start = source.indexOf('const I18N =');
  if (start < 0) throw new Error('const I18N not found');
  var outer = extractObjectAt(source, source.indexOf('{', start));
  var langs = {};
  ['zh', 'en', 'id'].forEach(function (lang) {
    var m = new RegExp('\\b' + lang + '\\s*:\\s*\\{').exec(outer);
    if (!m) throw new Error(lang + ' dictionary not found');
    langs[lang] = parseStringEntries(extractObjectAt(outer, outer.indexOf('{', m.index)));
  });
  return langs;
}

function placeholders(value) {
  var out = [];
  var m;
  var re = /\{([A-Za-z0-9_]+)\}/g;
  while ((m = re.exec(value))) if (out.indexOf(m[1]) === -1) out.push(m[1]);
  return out.sort();
}

function keysOf(dict) { return Object.keys(dict).sort(); }

var I18N = i18nDicts(html);

// The client keeps the Worker wire protocol as { code, message } and localizes
// known error codes before the toast. Parse that table so mapped keys count as
// referenced i18n entries.
function errorKeyMap(source) {
  var start = source.indexOf('const SERVER_ERR_KEYS =');
  if (start < 0) return null;
  return parseStringEntries(extractObjectAt(source, source.indexOf('{', start)));
}

var ERR_KEYS = errorKeyMap(html);
var WORKER_ERR_CODES = [
  'room_full', 'bad_json', 'room_mismatch', 'not_member', 'unknown_type',
  'bad_signal', 'signal_too_large', 'no_peer', 'host_only', 'bad_game',
  'waiting_peer', 'game_over', 'not_your_turn', 'bad_move', 'cell_taken',
  'column_full'
];

// Load room.js as a real ES module, without touching the product file.
function loadRoomCore() {
  require('../shared/rules.js'); // UMD: publishes globalThis.GameRules
  var imports = roomSource.match(/^import .*$/gm) || [];
  var body = roomSource.replace(/^import .*$/gm, '');
  var extra = [
    'MAX_MEMBERS', 'RECONNECT_GRACE_MS', 'PASSWORD_MIN', 'PASSWORD_MAX',
    'MAX_PASSWORD_FAILS', 'PASSWORD_LOCK_MS', 'JOIN_TOKEN_TTL_MS',
    'KINDS', 'DEFAULT_KIND', 'TTT_WIN_LINES',
    'cleanName', 'cleanPid', 'isIntIn', 'sortMembers', 'hostIdOf',
    'hostIdWithGrace', 'hostOfflineOf', 'seatsOf', 'publicMembers', 'kindOf',
    'emptyGame', 'scoreNum', 'normalizeGameShape', 'isEmptyBoard', 'tttWinnerOf',
    'toNumericBoard', 'fromNumericBoard', 'stoneCount', 'alignGame', 'roomState',
    'bytesToBase64Url', 'base64UrlToBytes', 'constantTimeEqual', 'passwordDigest'
  ];
  body += '\nexport { ' + extra.join(', ') + ' };\n';
  var dataUrl = 'data:text/javascript;base64,' +
    Buffer.from(body, 'utf8').toString('base64');
  return import(dataUrl).then(function (mod) {
    return { mod: mod, imports: imports };
  });
}

function fakeWs(attachment) {
  return {
    attachment: attachment,
    sent: [],
    deserializeAttachment: function () { return this.attachment; },
    serializeAttachment: function (a) { this.attachment = a; },
    send: function (raw) { this.sent.push(JSON.parse(raw)); },
    close: function () {}
  };
}

function mockStorage(initial) {
  var data = new Map(Object.entries(initial || {}));
  var storage = {
    data: data,
    alarm: null,
    get: function (key) { return Promise.resolve(data.get(key)); },
    put: function (key, value) { data.set(key, value); return Promise.resolve(); },
    delete: function (key) { data.delete(key); return Promise.resolve(); },
    deleteAll: function () { data.clear(); return Promise.resolve(); },
    setAlarm: function (at) { storage.alarm = at; return Promise.resolve(); },
    deleteAlarm: function () { storage.alarm = null; return Promise.resolve(); }
  };
  return storage;
}

function mockState(storage, sockets) {
  return {
    storage: storage,
    getWebSockets: function () { return sockets.slice(); },
    acceptWebSocket: function () {}
  };
}

function newRoom(RoomDO, storage, sockets) {
  var room = new RoomDO(mockState(storage, sockets), {});
  room.roomCode = '1234';
  return room;
}

// ---------------------------------------------------------------------------
// Entry page: static contract
// ---------------------------------------------------------------------------

s.group('页面静态契约', function () {
  s.ok('doctype html', /^\s*<!doctype html>/i.test(html));
  s.ok('html lang=zh-CN', /<html[^>]*\blang="zh-CN"/i.test(html));
  s.ok('charset utf-8', /<meta[^>]*charset="utf-8"/i.test(html));
  s.ok('viewport 含 width=device-width', /<meta[^>]*name="viewport"[^>]*content="[^"]*width=device-width/i.test(html));
  s.ok('viewport 含 initial-scale=1', /<meta[^>]*name="viewport"[^>]*content="[^"]*initial-scale=1/i.test(html));
  s.ok('viewport 含 viewport-fit=cover', /viewport-fit=cover/i.test(html));
  s.ok('title 有内容', /<title[^>]*>[^<]*语音房[^<]*<\/title>/.test(html));
  s.ok('theme-color 已设置', /<meta[^>]*name="theme-color"/i.test(html));

  var styles = matchAll(html, /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/gi);
  s.eq('只有 1 个样式表', styles.length, 1);
  s.eq('样式表为站内共享样式', styles, ['/games/shared/arcade/legacy-mobile.css']);

  var scripts = matchAll(html, /<script\b[^>]*\bsrc="([^"]+)"/gi);
  s.eq('3 个外链脚本', scripts, ['../shared/store.js', '../shared/i18n.js', '/games/shared/share.js']);
  s.eq('无协议/外站脚本', scripts.filter(function (src) {
    return /^(?:https?:)?\/\//i.test(src);
  }), []);
  s.ok('无 document.write', html.indexOf('document.write') === -1);
  s.ok('无 eval(', html.indexOf('eval(') === -1);
  s.ok('无 new Function(', html.indexOf('new Function(') === -1);

  s.ok('链接到 guide.html', /href="guide\.html"/.test(html));
  s.ok('链接到 rules.html', /href="rules\.html"/.test(html));
  s.ok('隐私说明写明不录音', /不录音/.test(html) && /不存储任何音频/.test(html));
  s.ok('房号输入限 4 位数字', /id="code"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\*"[^>]*maxlength="4"/.test(html));
  s.ok('昵称限 12 字符', /id="name"[^>]*maxlength="12"/.test(html));
  s.ok('密码输入限 32 字符', /id="createPw"[^>]*maxlength="32"/.test(html));

  s.ok('客户端人数上限 4', /const MAX_MEMBERS = 4;/.test(html));
  s.ok('随机房号为 1000–9999', /Math\.floor\(1000 \+ Math\.random\(\) \* 9000\)/.test(html));
  s.eq('客户端 4 位房号校验出现 2 次', (html.match(/\^\\d\{4\}\$/g) || []).length, 2);
  s.ok('默认 Worker 地址', html.indexOf('https://voice-room.superapp-devin.workers.dev') !== -1);
  s.ok('邀请基址为站点地址', html.indexOf("https://hhfa008.github.io/games/voice-room/") !== -1);
  s.ok('邀请链接对房号做 encodeURIComponent', /INVITE_BASE \+ '\?room=' \+ encodeURIComponent\(room\)/.test(html));

  s.ok('暴露 __vrDebug 测试面板', /window\.__vrDebug = \{/.test(html));
  ['get room', 'get selfId', 'get hostId', 'get game', 'get micInfo',
    'get wsState', 'async quality', 'async stats', 'disconnect']
    .forEach(function (member) {
      s.ok('__vrDebug 提供 ' + member, html.indexOf(member) !== -1);
    });
});

s.group('无障碍与三语标记', function () {
  var dataKeys = matchAll(html, /data-i="([^"]+)"/g);
  var phKeys = matchAll(html, /data-ip="([^"]+)"/g);
  s.ok('data-i 文本标记不少于 20 个', dataKeys.length >= 20, 'got ' + dataKeys.length);
  s.ok('data-ip 占位符标记不少于 3 个', phKeys.length >= 3, 'got ' + phKeys.length);

  s.ok('Lobby 状态区 role=status', /id="inviteHint"[^>]*role="status"/.test(html));
  s.ok('房内横幅 role=status', /id="banner"[^>]*role="status"/.test(html));
  s.ok('错误提示 role=alert', /id="lobbyErr"[^>]*role="alert"/.test(html));
  s.ok('游戏选择 role=group', /id="gamePicker"[^>]*role="group"/.test(html));
  s.ok('房号输入有 aria-label', /id="code"[^>]*aria-label="4 位房号"/.test(html));
  s.ok('分享按钮有 aria-label', /data-share-btn[^>]*aria-label="分享本页"/.test(html));
  s.ok('棋盘有 aria-label', /id="board"[^>]*aria-label="多人棋局棋盘"/.test(html));
  s.ok('密码显示按钮 aria-pressed', (html.match(/class="pw-toggle"[^>]*aria-pressed="false"/g) || []).length === 2);
  s.ok('密码显示按钮 aria-controls 指向输入框', /aria-controls="createPw"/.test(html) && /aria-controls="joinPw"/.test(html));
  s.ok('密码按钮 type=button', /id="createPwToggle"[^>]*type="button"/.test(html) && /id="joinPwToggle"[^>]*type="button"/.test(html));
  s.ok('装饰性 SVG aria-hidden', /<svg[^>]*aria-hidden="true"/.test(html));
  s.ok('电平条 aria-hidden', /class="q-bar" aria-hidden="true"/.test(html));
  s.ok('质量面板 summary aria-controls', /<summary aria-controls="qualityBody">/.test(html));
  s.ok('语言识别支持 ?lang=en', /indexOf\('en'\) === 0/.test(html));
  s.ok('语言识别支持 ?lang=id 与旧写法 in', /q\.indexOf\('id'\) === 0 \|\| q === 'in'/.test(html));
  s.ok('I18n 使用 data-i / data-ip / data-i-aria', /attrs: \{ text: 'data-i', ph: 'data-ip', aria: 'data-i-aria' \}/.test(html));
});

// Walk the body markup and report Chinese text that is not already bound to a
// translation hook. Script/style bodies and comments are dropped first, then
// any element carrying data-i / data-ip / data-i-aria (and its subtree) is
// treated as an i18n fallback rather than a residual literal.
function staticChineseResidue(bodyHtml) {
  var text = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  var voidTags = /^(?:br|hr|img|input|meta|link|source|area|base|col|embed|param|track|wbr)$/;
  var re = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g;
  var stack = [];
  var out = [];
  var last = 0;
  var m;
  while ((m = re.exec(text))) {
    var between = text.slice(last, m.index);
    if (!(stack.length && stack[stack.length - 1]) && /[一-鿿]/.test(between)) {
      out.push(between.trim());
    }
    last = re.lastIndex;
    var tag = m[0];
    var name = m[1].toLowerCase();
    if (/^<\//.test(tag)) {
      stack.pop();
      continue;
    }
    var selfClosing = /\/>\s*$/.test(tag) || voidTags.test(name);
    if (!selfClosing) {
      var marked = /\bdata-i(?:-aria|-ip)?\s*=/.test(tag);
      stack.push(marked || (stack.length > 0 && stack[stack.length - 1] === true));
    }
  }
  var tail = text.slice(last);
  if (!(stack.length && stack[stack.length - 1]) && /[一-鿿]/.test(tail)) out.push(tail.trim());
  return out;
}

s.group('静态 HTML 无中文残留（i18n 兜底除外）', function () {
  var bodyStart = html.indexOf('<body>');
  var bodyEnd = html.indexOf('</body>');
  s.ok('可定位 <body> 范围', bodyStart >= 0 && bodyEnd > bodyStart);
  var body = html.slice(bodyStart + 6, bodyEnd);
  // Only allowed residue: none. share.js keeps its localized game name in
  // data-name-zh (an attribute, not a text node) so it is out of this scan.
  s.eq('body 文本节点中文均挂在 data-i/data-ip/data-i-aria 上', staticChineseResidue(body), []);
});

s.group('三语词条一致性（静态解析）', function () {
  var zh = keysOf(I18N.zh), en = keysOf(I18N.en), id = keysOf(I18N.id);
  s.ok('zh 词条不少于 50 条', zh.length >= 50, 'got ' + zh.length);
  s.eq('en 键集合与 zh 一致', en, zh);
  s.eq('id 键集合与 zh 一致', id, zh);

  var empty = [];
  zh.forEach(function (key) {
    ['zh', 'en', 'id'].forEach(function (lang) {
      var v = I18N[lang][key];
      if (typeof v !== 'string' || !v.trim()) empty.push(lang + '.' + key);
    });
  });
  s.eq('所有词条均为非空字符串', empty, []);

  var badPlaceholders = [];
  zh.forEach(function (key) {
    var base = placeholders(I18N.zh[key]);
    ['en', 'id'].forEach(function (lang) {
      var other = placeholders(I18N[lang][key]);
      if (JSON.stringify(base) !== JSON.stringify(other)) {
        badPlaceholders.push(key + ':' + lang + '=' + JSON.stringify(other) + ' want ' + JSON.stringify(base));
      }
    });
  });
  s.eq('三语占位符完全一致', badPlaceholders, []);

  s.eq('邀请文案占位符 {room}{link}', placeholders(I18N.zh.inviteText), ['link', 'room']);
  s.eq('重连提示占位符 {n}', placeholders(I18N.zh.connReconnecting), ['n']);
  s.eq('连接失败提示占位符 {max}', placeholders(I18N.zh.connFailedBanner), ['max']);
  s.eq('重连横幅占位符 {n}{max}', placeholders(I18N.zh.reconnectingBanner), ['max', 'n']);

  var dataKeys = matchAll(html, /data-i="([^"]+)"/g);
  var ariaKeys = matchAll(html, /data-i-aria="([^"]+)"/g);
  var phKeys = matchAll(html, /data-ip="([^"]+)"/g);
  var tKeys = matchAll(html, /T\('([A-Za-z0-9_]+)'/g);
  var mappedKeys = Object.keys(ERR_KEYS || {}).map(function (code) { return ERR_KEYS[code]; });
  var referenced = dataKeys.concat(ariaKeys, phKeys, tKeys, mappedKeys);
  var seen = Object.create(null);
  var missing = [];
  referenced.forEach(function (key) {
    if (seen[key]) return;
    seen[key] = true;
    if (!(key in I18N.zh)) missing.push(key);
  });
  s.eq('标记与 T() 引用的键都有 zh 词条', missing, []);

  var unused = zh.filter(function (key) { return !seen[key]; });
  s.eq('所有词条均被引用', unused, []);
  s.ok('connTagIdle 用于未连接标签', /T\('connTagIdle'\)/.test(html));
  s.ok('copyFailed 用于复制失败提示', /toast\(T\('copyFailed'\)\)/.test(html));

  s.ok('定义服务端错误码→i18n 映射', !!ERR_KEYS);
  s.eq('错误码映射覆盖全部 Worker 错误码', Object.keys(ERR_KEYS || {}).sort(), WORKER_ERR_CODES.slice().sort());
  var missingMapped = [];
  ['zh', 'en', 'id'].forEach(function (lang) {
    mappedKeys.forEach(function (key) {
      if (!(key in I18N[lang])) missingMapped.push(lang + '.' + key);
    });
  });
  s.eq('错误码映射键三语齐全', missingMapped, []);
  s.ok('错误 toast 先按错误码本地化', /toast\(errorText\(msg\.code, msg\.message\)\)/.test(html));
  s.ok('未映射错误码回退服务端消息', /if \(key\) return T\(key\);/.test(html) &&
    /return message \|\| T\('opFailed'\);/.test(html));
});

s.group('客户端脚本契约（静态）', function () {
  s.ok('断线最多重试 4 次', /const MAX_RECONNECT_ATTEMPTS = 4;/.test(html));
  s.ok('重连退避 1/2/4/8 秒', /1000 \* Math\.pow\(2, n - 1\)/.test(html));
  s.ok('心跳每 20 秒', /20000/.test(html) && /type:'ping'/.test(html));
  s.ok('质量采样每 2 秒', /const QUALITY_INTERVAL_MS = 2000;/.test(html));
  s.ok('WS 连接携带 room/name/pid/token', /\/ws\?room=' \+ encodeURIComponent\(S\.room\)/.test(html) &&
    /&name=' \+ encodeURIComponent\(S\.name\)/.test(html) &&
    /&pid=' \+ encodeURIComponent\(PID\)/.test(html) &&
    /&token=' \+ encodeURIComponent\(S\.joinToken\)/.test(html));
  s.ok('客户端消费 welcome/room_state/game_state/signal/error', ['welcome', 'room_state', 'game_state', 'signal', 'error'].every(function (t) {
    return html.indexOf("msg.type === '" + t + "'") !== -1;
  }));
  s.ok('客户端发送 ping/mic/signal/game_move/game_reset/game_select', ['ping', 'mic', 'signal', 'game_move', 'game_reset', 'game_select'].every(function (t) {
    return html.indexOf("type:'" + t + "'") !== -1 || html.indexOf("type: '" + t + "'") !== -1;
  }));
  s.ok('客户端密码长度 4–32', /pw\.length < 4 \|\| pw\.length > 32/.test(html));
  s.ok('房号输入即时过滤非数字', /replace\(\/\\D\/g,''\)\.slice\(0,4\)/.test(html));
  s.ok('客户端拒绝跨房间消息', /msg\.room && msg\.room !== S\.room/.test(html));
  s.ok('客户端三种棋局规格与服务端一致', /ttt: \{ labelKey: 'kindTtt', cols: 3, rows: 3, size: 9 \}/.test(html) &&
    /gomoku: \{ labelKey: 'kindGomoku', cols: 15, rows: 15, size: 225 \}/.test(html) &&
    /connect4: \{ labelKey: 'kindConnect4', cols: 7, rows: 6, size: 42 \}/.test(html));
  s.ok('客户端处理 4001 room_full / 4003 replaced', /ev\.code === 4001/.test(html) && /ev\.code === 4003/.test(html));
});

s.group('注册表、引导页与规则页', function () {
  var entry = (registry.games || []).filter(function (g) { return g.slug === 'voice-room'; })[0];
  s.ok('registry 有 voice-room 条目', !!entry);
  if (!entry) return;
  s.eq('registry 状态 live', entry.status, 'live');
  s.eq('分类 online', entry.category, 'online');
  s.eq('三语名称齐全', Object.keys(entry.names || {}).sort(), ['en', 'id', 'zh']);
  s.eq('人数 2-4', entry.players, '2-4');
  s.eq('无 AI 对手', entry.ai, []);
  s.eq('中文规则指向 guide.html', entry.rules && entry.rules.zh, 'guide.html');
  s.ok('图标文件存在', fs.existsSync(path.join(DIR, '..', 'assets', 'icons', 'voice-room.svg')));
  s.ok('index.html 存在', fs.existsSync(INDEX_HTML));
  s.ok('guide.html 存在', fs.existsSync(GUIDE_HTML));
  s.ok('rules.html 存在', fs.existsSync(RULES_HTML));

  [['guide.html', guide], ['rules.html', rulesPage]].forEach(function (pair) {
    var name = pair[0], page = pair[1];
    s.ok(name + ' 有 viewport', /<meta[^>]*name="viewport"[^>]*width=device-width/i.test(page));
    s.ok(name + ' 有 canonical', new RegExp('<link rel="canonical" href="https://hhfa008\\.github\\.io/games/voice-room/' +
      name.replace('.', '\\.') + '"').test(page));
    s.eq(name + ' 无外站脚本', matchAll(page, /<script\b[^>]*\bsrc="([^"]+)"/gi).filter(function (src) {
      return /^(?:https?:)?\/\//i.test(src);
    }), []);
  });

  s.ok('规则写明 4 位数字房号', /4 位数字/.test(rulesPage));
  s.ok('规则写明最多 4 人', /最多 4 人/.test(rulesPage));
  s.ok('规则写明密码 4–32 位', /4–32 位密码/.test(rulesPage));
  s.ok('规则写明连错 5 次限流 60 秒', /连续输错 5 次/.test(rulesPage) && /60 秒/.test(rulesPage));
  s.ok('规则写明 WebRTC 点对点与 TURN 中继', /WebRTC/.test(rulesPage) && /点对点/.test(rulesPage) && /TURN/.test(rulesPage));
  s.ok('规则写明服务器不录制', /不录制/.test(rulesPage) && /不存储/.test(rulesPage));
  s.ok('规则声明与单机版共用 shared/rules.js', /shared\/rules\.js/.test(rulesPage));
  s.ok('规则页回链首页/教程', /href="guide\.html"/.test(rulesPage) && /href="\.\/"/.test(rulesPage));

  var lds = [];
  try {
    lds = lib.jsonLd(guide);
    s.ok('guide JSON-LD 可解析', true);
  } catch (e) {
    s.ok('guide JSON-LD 可解析', false, e.message);
  }
  var types = lds.map(function (d) { return d && d['@type']; });
  s.ok('guide 含 Article 结构化数据', types.indexOf('Article') !== -1);
  s.ok('guide 含 FAQPage 结构化数据', types.indexOf('FAQPage') !== -1);
  var faq = lds.filter(function (d) { return d && d['@type'] === 'FAQPage'; })[0];
  s.eq('guide FAQ 有 3 个问题', faq && faq.mainEntity ? faq.mainEntity.length : -1, 3);
  s.ok('guide 写明 1000–9999 房号范围', /1000–9999/.test(guide));
  s.ok('guide 写明 iOS Safari 需点击解锁音频', /iOS Safari/.test(guide) && /点击/.test(guide));
  s.ok('guide 写明密码只存加盐 SHA-256', /SHA-256\(salt \+ password\)/.test(guide));
});

// ---------------------------------------------------------------------------
// Worker source: static contract
// ---------------------------------------------------------------------------

s.group('Worker 源码静态契约', function () {
  s.ok('room.js 仅一个依赖：shared/rules.js', /^import '\.\.\/\.\.\/\.\.\/shared\/rules\.js';$/m.test(roomSource));
  s.ok('room.js 导出 RoomDO', /export class RoomDO/.test(roomSource));
  s.ok('index.js 导出默认 fetch 与 RoomDO', /import \{ RoomDO \} from '\.\/room\.js';/.test(workerSource) &&
    /export default \{/.test(workerSource) && /export \{ RoomDO \};/.test(workerSource));

  s.ok('房间人数上限常量 4', /const MAX_MEMBERS = 4;/.test(roomSource));
  s.ok('密码长度 4–32', /const PASSWORD_MIN = 4;/.test(roomSource) && /const PASSWORD_MAX = 32;/.test(roomSource));
  s.ok('密码连错 5 次', /const MAX_PASSWORD_FAILS = 5;/.test(roomSource));
  s.ok('密码锁定 60 秒', /const PASSWORD_LOCK_MS = 60 \* 1000;/.test(roomSource));
  s.ok('断线保留席位 60 秒', /const RECONNECT_GRACE_MS = 60 \* 1000;/.test(roomSource));
  s.ok('加入令牌 24 小时', /const JOIN_TOKEN_TTL_MS = 24 \* 60 \* 60 \* 1000;/.test(roomSource));
  s.ok('三种棋局规格', /ttt: \{ label: '井字棋', size: 9, cols: 3, rows: 3 \}/.test(roomSource) &&
    /gomoku: \{ label: '五子棋', size: 225, cols: 15, rows: 15 \}/.test(roomSource) &&
    /connect4: \{ label: '四子棋', size: 42, cols: 7, rows: 6 \}/.test(roomSource));

  ['/health', '/api/ice', '/api/join', '/ws'].forEach(function (route) {
    s.ok('index.js 路由 ' + route, workerSource.indexOf("'" + route + "'") !== -1);
  });
  s.ok('TURN 失败不回传上游错误', /turn_unavailable/.test(workerSource) && workerSource.indexOf('err.message') === -1);
  s.ok('CORS 白名单含 github.io/pages.dev/localhost', ['hhfa008.github.io', 'hhfa008-pages.pages.dev', 'localhost', '127.0.0.1'].every(function (host) {
    return workerSource.indexOf(host) !== -1;
  }));
  s.ok('index.js 预校验 4 位房号', /\^\\d\{4\}\$/.test(workerSource));

  ['ping', 'signal', 'mic', 'game_move', 'game_reset', 'game_select'].forEach(function (type) {
    s.ok('room.js 处理 ' + type, roomSource.indexOf("case '" + type + "'") !== -1);
  });
  ['room_full', 'bad_json', 'room_mismatch', 'not_member', 'unknown_type',
    'host_only', 'bad_game', 'waiting_peer', 'game_over', 'not_your_turn',
    'bad_move', 'cell_taken', 'column_full'].forEach(function (code) {
    s.ok('room.js 错误码 ' + code, roomSource.indexOf("'" + code + "'") !== -1);
  });
  s.ok('WS 升级校验', /Upgrade.*websocket/.test(roomSource));
  s.ok('落子由服务端校验轮次', /if \(sender\.id !== turnId\)/.test(roomSource));
  s.ok('房间满/被顶替关闭码 4001/4003', /close\(4001, 'room_full'\)/.test(roomSource) &&
    /close\(4003, 'replaced'\)/.test(roomSource));
});

// ---------------------------------------------------------------------------
// Worker runtime
// ---------------------------------------------------------------------------

loadRoomCore().then(function (loaded) {
  var M = loaded.mod;
  s.group('room.js 可加载性与导出（运行时）', function () {
    s.eq('仅剥离 1 个 ESM 依赖', loaded.imports, ["import '../../../shared/rules.js';"]);
    s.eq('RoomDO 是构造函数', typeof M.RoomDO, 'function');
    ['cleanName', 'cleanPid', 'isIntIn', 'sortMembers', 'hostIdOf', 'hostIdWithGrace',
      'seatsOf', 'publicMembers', 'kindOf', 'emptyGame', 'normalizeGameShape',
      'tttWinnerOf', 'alignGame', 'roomState', 'passwordDigest']
      .forEach(function (name) {
        s.ok('导出可测试函数 ' + name, typeof M[name] === 'function');
      });
    s.ok('房间状态可从 globalThis.GameRules 取得棋规', !!globalThis.GameRules &&
      typeof globalThis.GameRules.gomoku.lineAt === 'function' &&
      typeof globalThis.GameRules.connect4.applyMove === 'function');
  });

  s.group('房间常量与游戏规格', function () {
    s.eq('最多 4 人', M.MAX_MEMBERS, 4);
    s.eq('密码最短 4', M.PASSWORD_MIN, 4);
    s.eq('密码最长 32', M.PASSWORD_MAX, 32);
    s.eq('连错 5 次锁定', M.MAX_PASSWORD_FAILS, 5);
    s.eq('锁定 60 秒', M.PASSWORD_LOCK_MS, 60000);
    s.eq('断线宽限 60 秒', M.RECONNECT_GRACE_MS, 60000);
    s.eq('井字棋 9 格', M.KINDS.ttt.size, 9);
    s.eq('五子棋 15×15', [M.KINDS.gomoku.cols, M.KINDS.gomoku.rows, M.KINDS.gomoku.size], [15, 15, 225]);
    s.eq('四子棋 7×6', [M.KINDS.connect4.cols, M.KINDS.connect4.rows, M.KINDS.connect4.size], [7, 6, 42]);
    s.eq('井字棋 8 条获胜线', M.TTT_WIN_LINES.length, 8);
    s.ok('获胜线索引均合法且去重', (function () {
      var seen = {};
      for (var i = 0; i < M.TTT_WIN_LINES.length; i++) {
        var line = M.TTT_WIN_LINES[i];
        if (line.length !== 3) return false;
        var k = line.slice().sort().join(',');
        if (seen[k]) return false;
        seen[k] = true;
        for (var j = 0; j < line.length; j++) {
          if (!Number.isInteger(line[j]) || line[j] < 0 || line[j] > 8) return false;
        }
      }
      return true;
    })());
  });

  s.group('身份、座位与输入清洗', function () {
    s.eq('cleanName 去除控制字符与首尾空白', M.cleanName('  a\u0001b\u007f  '), 'ab');
    s.eq('cleanName 截断到 12 字符', M.cleanName('abcdefghijklmnopqrst'), 'abcdefghijkl');
    s.eq('cleanName 空值回退玩家', M.cleanName(''), '玩家');
    s.eq('cleanName undefined 回退玩家', M.cleanName(undefined), '玩家');
    s.eq('cleanPid 只保留字母数字下划线横线', M.cleanPid('ab$%^cd--_X'), 'abcd--_X');
    s.eq('cleanPid 截断到 64 字符', M.cleanPid(new Array(101).join('a')).length, 64);

    s.ok('isIntIn 接受边界值', M.isIntIn(0, 0, 2) && M.isIntIn(2, 0, 2));
    s.ok('isIntIn 拒绝越界/小数/字符串', !M.isIntIn(3, 0, 2) && !M.isIntIn(1.5, 0, 2) && !M.isIntIn('1', 0, 2));

    var members = [
      { id: 'b', joinedAt: 2 },
      { id: 'a', joinedAt: 1 },
      { id: 'c', joinedAt: 2 }
    ];
    s.eq('座位按 joinedAt 再按 id 排序', M.sortMembers(members).map(function (m) { return m.id; }), ['a', 'b', 'c']);
    s.eq('房主是最早加入者', M.hostIdOf(members), 'a');
    s.eq('空房间无房主', M.hostIdOf([]), null);
    s.eq('宽限期内断线房主仍保留', M.hostIdWithGrace(members, [members[2]]), 'a');
    s.eq('名册清空后才移交', M.hostIdWithGrace([], [{ id: 'z', joinedAt: 9 }]), 'z');
    s.ok('房主离线可识别', M.hostOfflineOf('a', members.filter(function (m) { return m.id !== 'a'; })) === true);
    s.ok('房主在线不误报', M.hostOfflineOf('a', members) === false);
    s.ok('无房主不算离线', M.hostOfflineOf(null, members) === false);

    s.eq('两人对局分 X/O 座位', M.seatsOf(members), { xId: 'a', oId: 'b' });
    s.eq('一人时只有 X', M.seatsOf([members[0]]), { xId: 'b', oId: null });
    s.eq('空名册无座位', M.seatsOf([]), { xId: null, oId: null });

    var pub = M.publicMembers([
      { id: 'a', name: 'A', mic: 1, joinedAt: 1 },
      { id: 'b', name: 'B', mic: 0, joinedAt: 2 }
    ]);
    s.eq('公开成员按座位顺序', pub.map(function (m) { return m.id; }), ['a', 'b']);
    s.eq('公开成员标记房主', pub.map(function (m) { return m.host; }), [true, false]);
    s.eq('公开成员话筒状态布尔化', pub.map(function (m) { return m.mic; }), [true, false]);
  });

  s.group('棋局形状、落子与胜负纯函数', function () {
    var g = M.emptyGame('ttt', { xId: 'a', oId: 'b' }, 3);
    s.eq('空棋局默认井字棋', [g.kind, g.turn, g.round], ['ttt', 'X', 3]);
    s.eq('空棋局棋盘长度', g.board.length, 9);
    s.ok('空棋局无胜者', g.winner === null && g.line === null);
    s.eq('空棋局比分归零', g.scores, { X: 0, O: 0 });
    s.eq('未知棋种回退井字棋', M.emptyGame('chess', {}, 0).kind, 'ttt');
    s.eq('round 0 回退第 1 局', M.emptyGame('ttt', {}, 0).round, 1);

    s.eq('TTT 一行三子获胜', M.tttWinnerOf(['X', 'X', 'X', null, null, null, null, null, null]),
      { winner: 'X', line: [0, 1, 2] });
    s.eq('TTT 主对角线获胜', M.tttWinnerOf(['O', null, null, null, 'O', null, null, null, 'O']),
      { winner: 'O', line: [0, 4, 8] });
    s.eq('TTT 未成线', M.tttWinnerOf(['X', 'X', null, null, null, null, null, null, null]),
      { winner: null, line: null });

    var board = ['X', null, 'O', null, 'X', null, null, null, 'O'];
    s.eq('棋盘数字编码', Array.from(M.toNumericBoard(board)), [1, 0, 2, 0, 1, 0, 0, 0, 2]);
    s.eq('数字编码还原棋盘', M.fromNumericBoard(M.toNumericBoard(board)), board);
    s.eq('棋子计数', M.stoneCount(board), 4);
    s.ok('空棋盘判定', M.isEmptyBoard(Array(9).fill(null)) && !M.isEmptyBoard(board));

    s.eq('非法棋局返回 null（数组）', M.normalizeGameShape([]), null);
    s.eq('非法棋局返回 null（棋盘长度不符）', M.normalizeGameShape({ kind: 'ttt', board: [null] }), null);
    var dirty = M.normalizeGameShape({
      kind: 'chess',
      board: Array(9).fill('Z'),
      turn: 'O',
      winner: 'Y',
      line: [0, 99],
      scores: { X: -1, O: 2.7 },
      round: 0,
      xId: 7,
      oId: 'b'
    });
    s.eq('未知棋种归一为 ttt', dirty.kind, 'ttt');
    s.ok('非法棋格归一为空', dirty.board.every(function (v) { return v === null; }));
    s.eq('非法胜者归一为空', dirty.winner, null);
    s.eq('越界获胜线被过滤', dirty.line, [0]);
    s.eq('比分取整且负数归零', dirty.scores, { X: 0, O: 2 });
    s.eq('非法 round 归一为 1', dirty.round, 1);
    s.eq('非字符串座位置空', [dirty.xId, dirty.oId], [null, 'b']);
  });

  s.group('座位对齐与房间状态', function () {
    var roster = [{ id: 'a', name: 'A', joinedAt: 1 }, { id: 'b', name: 'B', joinedAt: 2 }];
    var game = M.emptyGame('ttt', { xId: 'a', oId: 'b' }, 1);
    game.board[0] = 'X';
    s.eq('座位仍在时棋盘保留', M.alignGame(game, roster, roster).board[0], 'X');

    var departed = M.alignGame(game, [roster[1]], [roster[1]]);
    s.eq('X 已离开时重开棋局', [departed.kind, departed.xId, departed.oId, departed.round],
      ['ttt', 'b', null, 1]);
    s.ok('重开后棋盘为空', departed.board.every(function (v) { return v === null; }));

    var emptySeat = M.emptyGame('ttt', { xId: 'a', oId: null }, 2);
    var seated = M.alignGame(emptySeat, roster, roster);
    s.eq('空棋盘自动补齐第二座位', [seated.xId, seated.oId], ['a', 'b']);
    s.eq('补座位不重置局数', seated.round, 2);

    var noGame = M.alignGame(null, roster, roster);
    s.eq('无棋局时按名册开新局', [noGame.kind, noGame.xId, noGame.oId], ['ttt', 'a', 'b']);

    var state = M.roomState('1234', roster, [roster[1]]);
    s.eq('房间状态类型', state.type, 'room_state');
    s.eq('房间号回传', state.room, '1234');
    s.eq('房主保留但标记离线', [state.hostId, state.hostOffline], ['a', true]);
    s.eq('成员列表只含在线玩家', state.members.map(function (m) { return m.id; }), ['b']);
  });

  // ---- RoomDO state transitions (mock Durable Object state) ----------------

  var normalize = null;
  var mic = null;
  var reset = null;

  var now = Date.now();
  var graceMembers = [
    { id: 'a', name: 'A', joinedAt: 1 },
    { id: 'b', name: 'B', joinedAt: 2 },
    { id: 'c', name: 'C', joinedAt: 3, leftAt: now - 61000 },
    { id: 'd', name: 'D', joinedAt: 4, leftAt: now - 10000 }
  ];
  var graceStorage = mockStorage({ members: graceMembers });
  var graceSockets = [fakeWs({ id: 'a' })];
  var graceRoom = newRoom(M.RoomDO, graceStorage, graceSockets);

  var base = { graceMembers: graceMembers, storage: graceStorage };

  var micRoster = [
    { id: 'a', name: 'A', joinedAt: 1, mic: false },
    { id: 'b', name: 'B', joinedAt: 2, mic: false }
  ];
  var micA = fakeWs({ id: 'a' });
  var micB = fakeWs({ id: 'b' });
  var micRoom = newRoom(M.RoomDO, mockStorage({ members: micRoster.slice() }), [micA, micB]);

  var resetRoster = [
    { id: 'a', name: 'A', joinedAt: 1 },
    { id: 'b', name: 'B', joinedAt: 2 }
  ];
  var resetGame = M.emptyGame('ttt', { xId: 'a', oId: 'b' }, 3);
  resetGame.board[0] = 'X';
  resetGame.turn = 'O';
  resetGame.scores = { X: 2, O: 1 };
  var resetStorage = mockStorage({ game: resetGame, members: resetRoster.slice() });
  var resetA = fakeWs({ id: 'a' });
  var resetB = fakeWs({ id: 'b' });
  var resetRoom = newRoom(M.RoomDO, resetStorage, [resetA, resetB]);

  Promise.all([
    graceRoom.normalizeRoster().then(function (roster1) {
      var saved1 = graceStorage.data.get('members');
      var alarm1 = graceStorage.alarm;
      graceSockets.push(fakeWs({ id: 'b' }));
      return graceRoom.normalizeRoster().then(function (roster2) {
        normalize = { roster1: roster1, saved1: saved1, alarm1: alarm1, roster2: roster2, storage: graceStorage };
      });
    }),
    micRoom.handleMic(micRoster, micRoster[0], { on: true }).then(function () {
      var afterFirst = micA.sent.slice();
      return micRoom.handleMic(micRoster, micRoster[0], { on: true }).then(function () {
        mic = { roster: micRoster, a: micA, b: micB, afterFirst: afterFirst, afterSecond: micA.sent.slice() };
      });
    }),
    resetRoom.handleReset(resetRoster, resetRoster[0], {}).then(function () {
      var afterReset = resetA.sent.slice();
      var stored = resetStorage.data.get('game');
      return resetRoom.handleReset(resetRoster, resetRoster[1], {}).then(function () {
        var hostError = resetB.sent[resetB.sent.length - 1];
        var aSentAfterNonHostReset = resetA.sent.length;
        return resetRoom.handleSelect(resetRoster, resetRoster[0], { kind: 'gomoku' }).then(function () {
          var selectMsg = resetA.sent[resetA.sent.length - 1];
          return resetRoom.handleSelect(resetRoster, resetRoster[0], { kind: 'chess' }).then(function () {
            reset = {
              afterReset: afterReset,
              stored: stored,
              hostError: hostError,
              selectMsg: selectMsg,
              badGame: resetA.sent[resetA.sent.length - 1],
              aSentAfterNonHostReset: aSentAfterNonHostReset
            };
          });
        });
      });
    }),
    // password digest runs in parallel with the state transitions
    (function () {
      var salt = new Uint8Array(16);
      for (var i = 0; i < salt.length; i++) salt[i] = i;
      return M.passwordDigest(salt, 'abcd').then(function (digest) {
        var want = nodeCrypto.createHash('sha256')
          .update(Buffer.concat([Buffer.from(salt), Buffer.from('abcd')]))
          .digest();
        return M.passwordDigest(salt, 'abcde').then(function (other) {
          return { digest: digest, want: want, other: other, salt: salt };
        });
      });
    })()
  ]).then(function (all) {
    s.group('RoomDO 断线宽限期状态迁移', function () {
      var n = normalize;
      s.eq('过期成员被移除', n.roster1.map(function (m) { return m.id; }), ['a', 'b', 'd']);
      s.ok('在线成员保持在线', n.roster1[0].leftAt == null);
      s.ok('离线成员记录 leftAt', Number.isInteger(n.roster1[1].leftAt) && n.roster1[1].leftAt <= Date.now());
      s.eq('宽限期内的 leftAt 不被重写', n.roster1[2].leftAt, base.graceMembers[3].leftAt);
      s.eq('清理结果写回存储', n.saved1.map(function (m) { return m.id; }), ['a', 'b', 'd']);
      s.eq('按最早到期成员设置 alarm', n.alarm1, base.graceMembers[3].leftAt + M.RECONNECT_GRACE_MS + 50);
      s.eq('重连后清除 leftAt', n.roster2[1].leftAt, null);
      s.eq('重连后成员数不变', n.roster2.length, 3);
    });

    s.group('RoomDO 麦克风广播状态迁移', function () {
      s.eq('发送者话筒状态更新', mic.roster[0].mic, true);
      s.eq('房内广播 room_state', mic.afterFirst.map(function (m) { return m.type; }), ['room_state']);
      s.eq('双方都收到广播', [mic.a.sent.length, mic.b.sent.length], [1, 1]);
      s.eq('广播中带麦克风状态', mic.afterFirst[0].members.filter(function (m) { return m.id === 'a'; })[0].mic, true);
      s.eq('状态相同不重复广播', mic.afterSecond.length, 1);
    });

    s.group('RoomDO 开新局/换游戏状态迁移', function () {
      var msg = reset.afterReset[0];
      s.eq('房主开新局广播 game_state', msg.type, 'game_state');
      s.eq('局数加一', msg.game.round, 4);
      s.eq('保留比分', msg.game.scores, { X: 2, O: 1 });
      s.ok('清空棋盘', msg.game.board.every(function (v) { return v === null; }));
      s.eq('保留棋种与座位', [msg.game.kind, msg.game.xId, msg.game.oId], ['ttt', 'a', 'b']);
      s.eq('新局写入存储', reset.stored.round, 4);
      s.eq('非房主被拒绝', [reset.hostError.type, reset.hostError.code], ['error', 'host_only']);
      s.eq('房主换五子棋', [reset.selectMsg.game.kind, reset.selectMsg.game.board.length, reset.selectMsg.game.round],
        ['gomoku', 225, 5]);
      s.eq('换游戏重置比分', reset.selectMsg.game.scores, { X: 0, O: 0 });
      s.eq('非法棋种被拒绝', [reset.badGame.type, reset.badGame.code], ['error', 'bad_game']);
      s.eq('非房主开新局不向房主广播', reset.aSentAfterNonHostReset, 1);
    });

    var pw = all[3];
    s.group('口令摘要与令牌工具', function () {
      s.eq('passwordDigest 等于 SHA-256(salt+password)', Array.from(pw.digest), Array.from(pw.want));
      s.ok('不同密码摘要不同', Buffer.compare(Buffer.from(pw.digest), Buffer.from(pw.other)) !== 0);
      s.ok('摘要 32 字节', pw.digest.length === 32);

      var bytes = new Uint8Array([251, 255, 190, 0, 1]);
      var b64 = M.bytesToBase64Url(bytes);
      s.ok('Base64URL 不含 + / =', !/[+/=]/.test(b64), b64);
      s.eq('Base64URL 可逆', Array.from(M.base64UrlToBytes(b64)), Array.from(bytes));
      s.ok('constantTimeEqual 相等为真', M.constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])));
      s.ok('constantTimeEqual 不同为假', !M.constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])));
      s.ok('constantTimeEqual 长度不同为假', !M.constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 0])));
      s.ok('constantTimeEqual 空值为假', !M.constantTimeEqual(null, new Uint8Array([1])));
    });

    s.group('共享棋规（Worker 依赖）', function () {
      var R = globalThis.GameRules;
      var gb = new Int8Array(225);
      for (var c = 3; c <= 7; c++) gb[7 * 15 + c] = 1;
      s.ok('五子棋五连判定', R.gomoku.checkWinAt(gb, 7, 5, 1));
      s.eq('五子棋返回获胜线', R.gomoku.lineAt(gb, 7, 5, 1), [7 * 15 + 3, 7 * 15 + 4, 7 * 15 + 5, 7 * 15 + 6, 7 * 15 + 7]);
      var gState = R.gomoku.setup();
      var gAfter = R.gomoku.applyMove(gState, 7 * 15 + 7);
      s.eq('五子棋落子后换手', gAfter.turn, 2);
      s.eq('五子棋状态继续', R.gomoku.status(gAfter), 'playing');

      var cState = R.connect4.setup();
      var applied = R.connect4.applyMove(cState, 3);
      s.eq('四子棋落子受重力约束', applied.b[5 * 7 + 3], 1);
      s.eq('四子棋落子后换手', applied.turn, 2);
      s.eq('四子棋状态继续', R.connect4.status(applied).over, false);
      var full = R.connect4.setup();
      for (var i = 0; i < 6; i++) full = R.connect4.applyMove(full, 3);
      s.eq('落满一列后该列不可落子', R.connect4.applyMove(full, 3), null);
    });

    s.done();
  });
}).catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
