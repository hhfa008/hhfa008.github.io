#!/usr/bin/env node
'use strict';

/*
 * Real-browser check for the three tool-hall pages.
 *
 *   node tools/tests/hall-check.js [--langs zh,en,id]
 *
 * Serves the repository over a throw-away localhost HTTP server (so the
 * halls' absolute /tools/... paths resolve), then drives headless Chrome via
 * the Chrome DevTools Protocol using Node's built-in WebSocket (Node >= 22).
 * No screenshots and no OCR: every assertion reads DOM geometry, computed
 * styles, text content, and network/console events.
 *
 * Checks per hall page (zh / en / id):
 *   - 320px and 390px: no horizontal scroll
 *   - every .lang-chip, header nav link, language switch, jump filter and
 *     the clear-search button is at least 44x44 CSS px when visible
 *   - light and dark (prefers-color-scheme) backgrounds differ correctly
 *   - no console errors, uncaught exceptions, or error-level log entries
 *   - no requests outside the local server (zero external requests)
 *   - 100 cards and a 100-item JSON-LD ItemList
 *   - language chips match the catalog's supportedLangs:
 *       screen-share-calc -> EN/ID/VI/TH (+ honest locale note, link chips)
 *       sari-sari-ledger  -> ZH/EN/ID/FIL (no "3 languages" tag)
 *       new tools         -> ZH/EN/ID
 *   - search filters the cards and the clear button restores all 100
 *
 * Exit code 1 if any check fails.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var net = require('net');
var http = require('http');
var child = require('child_process');

var TOOLS_ROOT = path.resolve(__dirname, '..');
var REPO_ROOT = path.resolve(TOOLS_ROOT, '..');
var CHROME_PATH = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var LANGS = ['en', 'id', 'zh'];
var LANG_TAG = { zh: 'zh-CN', en: 'en', id: 'id' };
var HALL_FILE = { zh: '/tools/index.html', en: '/tools/en/index.html', id: '/tools/id/index.html' };
var EXPECTED_CARDS = 100;
var TOUCH_MIN = 43.5;
var TOUCH_SELECTOR = '.lang-chip, .site-nav a, .lang-switch a, .jump a, #clear-search';
var LOAD_TIMEOUT_MS = 20000;
var CDP_TIMEOUT_MS = 20000;

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var opts = { langs: LANGS.slice(), help: false };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--langs') {
      var raw = argv[++i] || '';
      var picked = raw.split(',').map(function (s) { return s.trim(); })
        .filter(function (s) { return LANGS.indexOf(s) !== -1; });
      if (!picked.length) throw new Error('--langs 需要 zh/en/id 中至少一个');
      opts.langs = picked;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      throw new Error('未知参数: ' + a);
    }
  }
  return opts;
}

function usage() {
  console.log([
    '用法: node tools/tests/hall-check.js [--langs zh,en,id]',
    '',
    '用本地 HTTP 服务 + 无头 Chrome 校验三页工具大厅：',
    '320/390 无横向滚动、触控 >= 44px、深浅色、console error、外部请求、',
    '搜索筛选与清空、以及 supportedLangs 对应的语言 chips。'
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// Local static server (same-origin, no external requests)
// ---------------------------------------------------------------------------

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon'
};

function startServer(root) {
  var server = http.createServer(function (req, res) {
    var pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch (e) { res.writeHead(400); res.end('bad request'); return; }
    if (pathname.charAt(pathname.length - 1) === '/') pathname += 'index.html';
    var file = path.resolve(root, '.' + pathname);
    if (file !== root && file.indexOf(root + path.sep) !== 0) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, function (err, buf) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(buf);
    });
  });
  return new Promise(function (resolve, reject) {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

// ---------------------------------------------------------------------------
// Chrome / CDP plumbing (same shape as games/tests/browser-check.js)
// ---------------------------------------------------------------------------

function httpJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var req = http.get(url, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('非 JSON 响应: ' + body.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 1500, function () {
      req.destroy(new Error('HTTP 超时'));
    });
  });
}

function freePort() {
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      var port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
  });
}

var chromeProc = null;
var chromeStderr = '';
var tempDir = null;

function waitExit(proc, ms) {
  return new Promise(function (resolve) {
    if (proc.exitCode !== null) return resolve(true);
    var timer = setTimeout(function () { resolve(false); }, ms);
    proc.once('exit', function () { clearTimeout(timer); resolve(true); });
  });
}

async function cleanup() {
  try {
    if (chromeProc && chromeProc.exitCode === null) {
      chromeProc.kill('SIGTERM');
      var done = await waitExit(chromeProc, 3000);
      if (!done && chromeProc.exitCode === null) {
        chromeProc.kill('SIGKILL');
        await waitExit(chromeProc, 2000);
      }
    }
  } catch (e) { /* best effort */ }
  chromeProc = null;
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); }
    catch (e) { /* best effort */ }
    tempDir = null;
  }
}

async function waitForDevtools(port, proc, timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  var lastErr = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error('Chrome 提前退出 (code ' + proc.exitCode + ')' +
        (chromeStderr ? '\n' + chromeStderr.slice(-1200) : ''));
    }
    try {
      return await httpJson('http://127.0.0.1:' + port + '/json/version', 1200);
    } catch (e) {
      lastErr = e;
      await sleep(120);
    }
  }
  throw new Error('DevTools 端点未就绪: ' + (lastErr ? lastErr.message : 'timeout'));
}

async function launchChrome() {
  if (!fs.existsSync(CHROME_PATH)) throw new Error('找不到 Chrome: ' + CHROME_PATH);
  var port = await freePort();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-hall-check-'));
  var args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + tempDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--metrics-recording-only',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=390,844',
    'about:blank'
  ];
  chromeStderr = '';
  chromeProc = child.spawn(CHROME_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProc.stderr.on('data', function (d) {
    chromeStderr = (chromeStderr + d.toString()).slice(-8000);
  });
  var version = await waitForDevtools(port, chromeProc, 25000);
  return { port: port, wsUrl: version.webSocketDebuggerUrl, browser: version.Browser || 'unknown' };
}

function CDP(wsUrl) {
  this.ws = new WebSocket(wsUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.handlers = [];
  this.closed = false;
  var self = this;
  this.ws.addEventListener('message', function (ev) { self._message(ev.data); });
  this.ws.addEventListener('close', function () {
    self.closed = true;
    self.pending.forEach(function (p) { p.reject(new Error('DevTools 连接已关闭')); });
    self.pending.clear();
  });
}

CDP.prototype._message = function (data) {
  var msg;
  try { msg = JSON.parse(typeof data === 'string' ? data : String(data)); }
  catch (e) { return; }
  if (msg.id != null) {
    var p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || ('CDP error ' + msg.error.code)));
    else p.resolve(msg.result || {});
    return;
  }
  if (!msg.method) return;
  var sid = msg.sessionId || null;
  var params = msg.params || {};
  this.handlers.slice().forEach(function (fn) {
    try { fn(sid, msg.method, params); } catch (e) { /* best effort */ }
  });
};

CDP.prototype.open = function () {
  var self = this;
  return new Promise(function (resolve, reject) {
    if (self.ws.readyState === 1) return resolve();
    function done(err) {
      self.ws.removeEventListener('open', onOpen);
      self.ws.removeEventListener('error', onError);
      self.ws.removeEventListener('close', onClose);
      if (err) reject(err); else resolve();
    }
    function onOpen() { done(null); }
    function onError() { done(new Error('DevTools WebSocket 连接失败')); }
    function onClose() { done(new Error('DevTools WebSocket 在连接阶段关闭')); }
    self.ws.addEventListener('open', onOpen);
    self.ws.addEventListener('error', onError);
    self.ws.addEventListener('close', onClose);
  });
};

CDP.prototype.on = function (fn) { this.handlers.push(fn); };

CDP.prototype.send = function (method, params, sessionId, timeoutMs) {
  var self = this;
  if (this.closed || this.ws.readyState !== 1) {
    return Promise.reject(new Error('WebSocket 未连接 (' + method + ')'));
  }
  var id = this.nextId++;
  var msg = { id: id, method: method, params: params || {} };
  if (sessionId) msg.sessionId = sessionId;
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      self.pending.delete(id);
      reject(new Error(method + ' 超时'));
    }, timeoutMs || CDP_TIMEOUT_MS);
    self.pending.set(id, {
      resolve: function (v) { clearTimeout(timer); resolve(v); },
      reject: function (e) { clearTimeout(timer); reject(e); }
    });
    try { self.ws.send(JSON.stringify(msg)); }
    catch (e) {
      clearTimeout(timer);
      self.pending.delete(id);
      reject(e);
    }
  });
};

CDP.prototype.waitFor = function (sessionId, method, timeoutMs) {
  var self = this;
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('等待 ' + method + ' 超时')); },
      timeoutMs || CDP_TIMEOUT_MS);
    var fn = function (sid, name, params) {
      if (sid !== sessionId || name !== method) return;
      clearTimeout(timer);
      var i = self.handlers.indexOf(fn);
      if (i !== -1) self.handlers.splice(i, 1);
      resolve(params);
    };
    self.handlers.push(fn);
  });
};

CDP.prototype.close = function () {
  try { this.ws.close(); } catch (e) { /* ignore */ }
};

// ---------------------------------------------------------------------------
// In-page probes
// ---------------------------------------------------------------------------

var LUMINANCE_FN = [
  'function parseColor(str) {',
  '  var m = /rgba?\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)(?:\\s*,\\s*([0-9.]+))?\\s*\\)/.exec(str || "");',
  '  if (!m) return null;',
  '  function lin(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }',
  '  return { alpha: m[4] == null ? 1 : +m[4],',
  '    luminance: 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]) };',
  '}',
  'function bodyLuminance() {',
  '  var bg = getComputedStyle(document.body).backgroundColor;',
  '  var p = parseColor(bg);',
  '  if (!p || p.alpha === 0) {',
  '    var alt = getComputedStyle(document.documentElement).backgroundColor;',
  '    var p2 = parseColor(alt);',
  '    if (p2 && p2.alpha > 0) { bg = alt; p = p2; }',
  '  }',
  '  return { color: bg, luminance: p ? p.luminance : null };',
  '}'
].join('\n');

var SNAPSHOT_EXPR = [
  '(function () {',
  '  "use strict";',
  LUMINANCE_FN,
  '  function visible(el) {',
  '    if (!el) return false;',
  '    var r = el.getBoundingClientRect();',
  '    if (r.width === 0 && r.height === 0) return false;',
  '    if (typeof el.checkVisibility === "function") {',
  '      try { return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); }',
  '      catch (e) { return true; }',
  '    }',
  '    var cs = getComputedStyle(el);',
  '    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";',
  '  }',
  '  var de = document.documentElement;',
  '  // Force layout of content-visibility:auto cards so offscreen chips still',
  '  // report real geometry; removed before returning.',
  '  var probe = document.createElement("style");',
  '  probe.setAttribute("data-hall-check", "");',
  '  probe.textContent = ".tool-card{content-visibility:visible!important}";',
  '  document.head.appendChild(probe);',
  '  var touch = [];',
  '  var nodes = document.querySelectorAll(' + JSON.stringify(TOUCH_SELECTOR) + ');',
  '  var checked = 0, skipped = 0;',
  '  for (var i = 0; i < nodes.length; i++) {',
  '    var el = nodes[i];',
  '    if (!visible(el)) { skipped++; continue; }',
  '    checked++;',
  '    var r = el.getBoundingClientRect();',
  '    if (r.width < ' + TOUCH_MIN + ' || r.height < ' + TOUCH_MIN + ') {',
  '      touch.push({ tag: el.tagName.toLowerCase(), cls: el.getAttribute("class") || "",',
  '        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 24),',
  '        width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 });',
  '    }',
  '  }',
  '  function cardInfo(slug) {',
  '    var cards = document.querySelectorAll(".tool-card");',
  '    for (var j = 0; j < cards.length; j++) {',
  '      var link = cards[j].querySelector("a.tool-link");',
  '      var href = link ? link.getAttribute("href") : "";',
  '      if (href !== "/tools/" + slug + "/" && href.indexOf("/tools/" + slug + "/") !== 0) continue;',
  '      var chips = [], chipLinks = [], chipNodes = cards[j].querySelectorAll(".lang-chip");',
  '      for (var k = 0; k < chipNodes.length; k++) {',
  '        chips.push((chipNodes[k].textContent || "").trim());',
  '        if (chipNodes[k].tagName === "A") {',
  '          chipLinks.push({ text: (chipNodes[k].textContent || "").trim(),',
  '            href: chipNodes[k].getAttribute("href") || "",',
  '            hreflang: chipNodes[k].getAttribute("hreflang") || "" });',
  '        }',
  '      }',
  '      var notes = [], noteNodes = cards[j].querySelectorAll(".lang-note");',
  '      for (var n = 0; n < noteNodes.length; n++) {',
  '        notes.push((noteNodes[n].textContent || "").trim());',
  '      }',
  '      var tagsEl = cards[j].querySelector(".tags");',
  '      return { chips: chips, chipLinks: chipLinks, notes: notes,',
  '        tags: tagsEl ? (tagsEl.textContent || "").trim() : "", href: href };',
  '    }',
  '    return null;',
  '  }',
  '  var ld = null;',
  '  try {',
  '    var script = document.querySelector("script[type=\\"application/ld+json\\"]");',
  '    var data = JSON.parse(script.textContent);',
  '    ld = data && data.mainEntity ? {',
  '      type: data.mainEntity["@type"],',
  '      numberOfItems: data.mainEntity.numberOfItems,',
  '      items: Array.isArray(data.mainEntity.itemListElement) ? data.mainEntity.itemListElement.length : null',
  '    } : null;',
  '  } catch (e) { ld = null; }',
  '  var input = document.getElementById("tool-search");',
  '  var clear = document.getElementById("clear-search");',
  '  var clearRect = clear ? clear.getBoundingClientRect() : null;',
  '  document.head.removeChild(probe);',
  '  return {',
  '    lang: de.lang,',
  '    title: document.title,',
  '    cards: document.querySelectorAll(".tool-card").length,',
  '    visibleCards: document.querySelectorAll(".tool-card:not([hidden])").length,',
  '    overflow: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth },',
  '    touch: { checked: checked, skipped: skipped, violations: touch },',
  '    bodyBg: bodyLuminance(),',
  '    screenShare: cardInfo("screen-share-calc"),',
  '    sariSari: cardInfo("sari-sari-ledger"),',
  '    imageCompressor: cardInfo("image-compressor"),',
  '    jsonLd: ld,',
  '    search: {',
  '      value: input ? input.value : null,',
  '      status: (document.getElementById("search-status") || {}).textContent || "",',
  '      clearHidden: clear ? !!clear.hidden : null,',
  '      clearWidth: clearRect ? Math.round(clearRect.width * 10) / 10 : null,',
  '      clearHeight: clearRect ? Math.round(clearRect.height * 10) / 10 : null',
  '    }',
  '  };',
  '})()'
].join('\n');

async function evaluate(cdp, sid, expression) {
  var r = await cdp.send('Runtime.evaluate', {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, sid);
  if (r.exceptionDetails) {
    var d = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
      r.exceptionDetails.text || 'evaluate failed';
    throw new Error(d);
  }
  return r.result ? r.result.value : undefined;
}

async function setMetrics(cdp, sid, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: height
  }, sid);
  await sleep(80);
}

async function setScheme(cdp, sid, scheme) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : []
  }, sid);
  await sleep(100);
}

async function navigate(cdp, sid, url) {
  var loaded = cdp.waitFor(sid, 'Page.loadEventFired', LOAD_TIMEOUT_MS);
  var res;
  try {
    res = await cdp.send('Page.navigate', { url: url }, sid);
  } catch (e) {
    loaded.catch(function () {});
    throw e;
  }
  if (res && res.errorText) {
    loaded.catch(function () {});
    throw new Error('导航失败: ' + res.errorText);
  }
  await loaded;
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function dedupe(list) {
  var seen = Object.create(null);
  var out = [];
  list.forEach(function (s) {
    if (!seen[s]) { seen[s] = true; out.push(s); }
  });
  return out;
}

function touchDetail(touch) {
  var base = touch.checked + ' 个可见触控目标' +
    (touch.skipped ? '（跳过 ' + touch.skipped + ' 个隐藏元素）' : '');
  if (!touch.violations.length) return base + ' 均 >= ' + TOUCH_MIN + 'px';
  return base + ' 违规: ' + touch.violations.map(function (v) {
    return v.tag + (v.cls ? '.' + v.cls.split(/\s+/).join('.') : '') +
      ' "' + v.text + '" ' + v.width + '×' + v.height;
  }).join('; ');
}

function chipsEqual(actual, expected) {
  return Array.isArray(actual) && actual.join(',') === expected.join(',');
}

function searchExpr(query) {
  return '(function () {' +
    ' var input = document.getElementById("tool-search");' +
    ' if (!input) return false;' +
    ' input.value = ' + JSON.stringify(query) + ';' +
    ' input.dispatchEvent(new Event("input", { bubbles: true }));' +
    ' return true;' +
    '})()';
}

function clearExpr() {
  return '(function () {' +
    ' var clear = document.getElementById("clear-search");' +
    ' if (!clear || clear.hidden) return false;' +
    ' clear.click();' +
    ' return true;' +
    '})()';
}

async function runPage(ctx, lang) {
  var start = Date.now();
  var checks = [];
  var cdp = ctx.cdp;
  var sid = ctx.sid;
  var baseUrl = 'http://127.0.0.1:' + ctx.port;
  var coll = { exceptions: [], console: [], log: [], requests: [], failed: [] };

  function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  }

  var collector = function (sessionId, method, params) {
    if (sessionId !== sid) return;
    if (method === 'Runtime.exceptionThrown') {
      var ed = params.exceptionDetails || {};
      var desc = (ed.exception && ed.exception.description) || ed.text || '未捕获异常';
      coll.exceptions.push(String(desc).split('\n')[0].slice(0, 300));
    } else if (method === 'Runtime.consoleAPICalled') {
      if (params.type === 'error') {
        var args = (params.args || []).map(function (a) {
          if (a.value !== undefined) return String(a.value);
          return a.description || a.type || 'error';
        });
        coll.console.push(args.join(' ').split('\n')[0].slice(0, 300));
      }
    } else if (method === 'Log.entryAdded') {
      var entry = params.entry || {};
      if (entry.level === 'error') {
        coll.log.push((entry.text || 'log error') + (entry.url ? ' @' + entry.url : ''));
      }
    } else if (method === 'Network.requestWillBeSent') {
      coll.requests.push((params.request && params.request.url) || '');
    } else if (method === 'Network.loadingFailed') {
      if (params.errorText !== 'net::ERR_ABORTED') {
        coll.failed.push((params.errorText || 'loadingFailed') + ' ' + (params.url || ''));
      }
    }
  };
  cdp.on(collector);

  try {
    await setScheme(cdp, sid, null);
    await setMetrics(cdp, sid, 390, 844);
    await navigate(cdp, sid, baseUrl + HALL_FILE[lang]);
    check('页面加载 (loadEventFired)', true);
  } catch (e) {
    check('页面加载 (loadEventFired)', false, e.message);
    cdp.handlers.splice(cdp.handlers.indexOf(collector), 1);
    return finish(lang, checks, start);
  }

  var snap390 = await evaluate(cdp, sid, SNAPSHOT_EXPR);

  check('document.documentElement.lang = ' + LANG_TAG[lang],
    snap390.lang === LANG_TAG[lang], 'got ' + JSON.stringify(snap390.lang));
  check('100 张卡片', snap390.cards === EXPECTED_CARDS, 'got ' + snap390.cards);
  check('JSON-LD ItemList = 100',
    !!snap390.jsonLd && snap390.jsonLd.type === 'ItemList' &&
      snap390.jsonLd.numberOfItems === EXPECTED_CARDS &&
      snap390.jsonLd.items === EXPECTED_CARDS,
    JSON.stringify(snap390.jsonLd));

  // Language honesty, driven by catalog supportedLangs.
  check('screen-share: EN/ID/VI/TH chips',
    !!snap390.screenShare && chipsEqual(snap390.screenShare.chips, ['EN', 'ID', 'VI', 'TH']) &&
      snap390.screenShare.chips.indexOf('ZH') === -1,
    snap390.screenShare ? snap390.screenShare.chips.join(',') : 'card not found');
  var ssLinks = snap390.screenShare ? snap390.screenShare.chipLinks : [];
  check('screen-share: 4 个外链 chip 指向对应语言页',
    ssLinks.length === 4 && ssLinks.every(function (l) {
      var expected = l.text === 'EN' ? '/tools/screen-share-calc/'
        : l.text === 'ID' ? '/tools/screen-share-calc/id/'
          : l.text === 'VI' ? '/tools/screen-share-calc/vi/'
            : l.text === 'TH' ? '/tools/screen-share-calc/th/' : '';
      return !!expected && l.href === expected && l.hreflang === l.text.toLowerCase();
    }),
    JSON.stringify(ssLinks));
  check('sari-sari: ZH/EN/ID/FIL chips（静态，非链接）',
    !!snap390.sariSari && chipsEqual(snap390.sariSari.chips, ['ZH', 'EN', 'ID', 'FIL']) &&
      snap390.sariSari.chipLinks.length === 0,
    snap390.sariSari ? snap390.sariSari.chips.join(',') : 'card not found');
  check('sari-sari: 不再标注“三语/3 languages/3 bahasa”',
    !!snap390.sariSari && !/三语|3 languages|3 bahasa/i.test(snap390.sariSari.tags),
    snap390.sariSari ? snap390.sariSari.tags : 'card not found');
  check('新工具: ZH/EN/ID chips',
    !!snap390.imageCompressor && chipsEqual(snap390.imageCompressor.chips, ['ZH', 'EN', 'ID']) &&
      snap390.imageCompressor.chipLinks.length === 0,
    snap390.imageCompressor ? snap390.imageCompressor.chips.join(',') : 'card not found');
  if (lang === 'zh') {
    check('zh 页 screen-share 标注英文 + 中文提示',
      !!snap390.screenShare && snap390.screenShare.notes.join(' ').indexOf('英文') !== -1 &&
        snap390.screenShare.notes.join(' ').indexOf('中文提示') !== -1,
      snap390.screenShare ? snap390.screenShare.notes.join(' ') : 'no note');
  }

  check('390px 无横向滚动',
    snap390.overflow.scrollWidth <= snap390.overflow.clientWidth + 1,
    'scrollWidth=' + snap390.overflow.scrollWidth + ', clientWidth=' + snap390.overflow.clientWidth);
  check('390px 触控目标 >= ' + TOUCH_MIN + 'px',
    snap390.touch.violations.length === 0, touchDetail(snap390.touch));

  await setMetrics(cdp, sid, 320, 844);
  var snap320 = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  check('320px 无横向滚动',
    snap320.overflow.scrollWidth <= snap320.overflow.clientWidth + 1,
    'scrollWidth=' + snap320.overflow.scrollWidth + ', clientWidth=' + snap320.overflow.clientWidth);
  check('320px 触控目标 >= ' + TOUCH_MIN + 'px',
    snap320.touch.violations.length === 0, touchDetail(snap320.touch));

  // Search: 390px, type a query, then click the clear button.
  await setMetrics(cdp, sid, 390, 844);
  await evaluate(cdp, sid, searchExpr('json'));
  await sleep(120);
  var searched = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  check('搜索后卡片数变化 (输入 json)',
    searched.visibleCards > 0 && searched.visibleCards < EXPECTED_CARDS,
    'visible=' + searched.visibleCards + ', status=' + JSON.stringify(searched.search.status));
  check('搜索后清空按钮可见且 >= 44px',
    searched.search.clearHidden === false &&
      searched.search.clearWidth >= TOUCH_MIN && searched.search.clearHeight >= TOUCH_MIN,
    'hidden=' + searched.search.clearHidden + ', ' +
      searched.search.clearWidth + '×' + searched.search.clearHeight);
  var cleared = await evaluate(cdp, sid, clearExpr());
  await sleep(120);
  var restored = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  check('点击清空按钮恢复 100 张卡片',
    cleared === true && restored.visibleCards === EXPECTED_CARDS &&
      restored.search.value === '' && restored.search.clearHidden === true,
    'clicked=' + cleared + ', visible=' + restored.visibleCards +
      ', value=' + JSON.stringify(restored.search.value) +
      ', clearHidden=' + restored.search.clearHidden);

  // Dark then light.
  await setScheme(cdp, sid, 'dark');
  var dark = await evaluate(cdp, sid, '(function(){' + LUMINANCE_FN + ' return bodyLuminance(); })()');
  await setScheme(cdp, sid, 'light');
  var light = await evaluate(cdp, sid, '(function(){' + LUMINANCE_FN + ' return bodyLuminance(); })()');
  await setScheme(cdp, sid, null);
  check('深色模式 body 背景亮度 < 0.5',
    dark.luminance != null && dark.luminance < 0.5, dark.color + ' luminance=' + dark.luminance);
  check('浅色模式 body 背景亮度 > 0.5',
    light.luminance != null && light.luminance > 0.5, light.color + ' luminance=' + light.luminance);

  // Network / console.
  var external = dedupe(coll.requests.filter(function (u) {
    if (/^(data|about):/i.test(u)) return false;
    try {
      var parsed = new URL(u);
      return parsed.host !== '127.0.0.1:' + ctx.port && parsed.hostname !== '127.0.0.1';
    } catch (e) { return true; }
  }));
  check('零外部请求 (仅 127.0.0.1 本地服务)', external.length === 0,
    external.slice(0, 6).join('; '));
  check('无请求失败', coll.failed.length === 0, dedupe(coll.failed).slice(0, 6).join('; '));
  var runtimeErrors = dedupe(coll.exceptions.concat(coll.console, coll.log));
  check('无未捕获异常 / console error', runtimeErrors.length === 0,
    runtimeErrors.slice(0, 6).join('; '));

  cdp.handlers.splice(cdp.handlers.indexOf(collector), 1);
  return finish(lang, checks, start);
}

function finish(lang, checks, start) {
  var failures = checks.filter(function (c) { return !c.ok; });
  return {
    lang: lang,
    status: failures.length ? 'FAIL' : 'PASS',
    durationMs: Date.now() - start,
    checks: checks,
    failures: failures.map(function (c) {
      return c.name + (c.detail ? ' — ' + c.detail : '');
    })
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printPage(page) {
  var passed = page.checks.filter(function (c) { return c.ok; }).length;
  console.log('[' + page.status + '] hall/' + page.lang + ' — ' +
    passed + '/' + page.checks.length + ' 项通过, ' +
    (page.durationMs / 1000).toFixed(2) + 's');
  page.failures.forEach(function (f) { console.log('    FAIL: ' + f); });
}

async function main() {
  var opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('参数错误: ' + e.message); process.exitCode = 1; return; }
  if (opts.help) { usage(); return; }

  var cdp = null;
  var local = null;
  var pages = [];
  var browserInfo = 'unknown';

  try {
    local = await startServer(REPO_ROOT);
    var launched = await launchChrome();
    browserInfo = launched.browser;
    cdp = new CDP(launched.wsUrl);
    await cdp.open();

    var target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    var attached = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });
    var sid = attached.sessionId;
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Log.enable', {}, sid);
    await cdp.send('Network.enable', {}, sid);

    var ctx = { cdp: cdp, sid: sid, port: local.port };
    console.log('Chrome: ' + browserInfo + ' · local: http://127.0.0.1:' + local.port +
      ' · langs: ' + opts.langs.join(','));

    for (var i = 0; i < opts.langs.length; i++) {
      var page = await runPage(ctx, opts.langs[i]);
      pages.push(page);
      printPage(page);
    }
  } catch (e) {
    console.error('hall-check 失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await cleanup();
    if (local) local.server.close();
  }

  var failed = pages.filter(function (p) { return p.status !== 'PASS'; });
  var totalChecks = pages.reduce(function (n, p) { return n + p.checks.length; }, 0);
  var failedChecks = pages.reduce(function (n, p) { return n + p.failures.length; }, 0);
  console.log('\n汇总: ' + pages.length + ' 页 · ' +
    (pages.length - failed.length) + ' PASS · ' + failed.length + ' FAIL · ' +
    totalChecks + ' 项检查（失败 ' + failedChecks + '）');
  if (!pages.length || failed.length) process.exitCode = 1;
}

var cleaning = false;
function onSignal() {
  if (cleaning) return;
  cleaning = true;
  cleanup().then(function () { process.exit(130); });
}
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

if (require.main === module) {
  main();
}
