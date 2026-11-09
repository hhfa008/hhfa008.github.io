#!/usr/bin/env node
'use strict';

/*
 * Real-browser contract check for the tool pages under tools/.
 *
 *   node games/tests/browser-check.js [slug ...] [--langs zh,en,id]
 *        [--width 390] [--height 844] [--json [out.json]]
 *
 * No puppeteer / playwright: it drives a headless Chrome over the Chrome
 * DevTools Protocol using Node's built-in global WebSocket (Node >= 22).
 * Chrome gets a throw-away user-data-dir under the OS temp directory and a
 * free remote-debugging port; both are cleaned up on exit.
 *
 * Slugs that do not exist are reported as failures. Without positional slugs
 * it scans tools/ for directories whose index.html contains <script id="engine">
 * (the new tool contract). Explicitly named pages that lack that marker get the
 * basic checks only: load, no console error, no external request, no 390px
 * horizontal overflow, non-empty title.
 *
 * `--json` accepts an optional path; without one the report goes to
 * games/tests/report.json (the same directory as the game runner report).
 *
 * A TOOLS_CHECK_ROOT env var (or --root) overrides the tools directory. It is
 * used by the self-test with a temporary sample page outside the repository.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var net = require('net');
var http = require('http');
var child = require('child_process');
var pathToFileURL = require('url').pathToFileURL;

var ROOT = path.resolve(__dirname, '..', '..');
var DEFAULT_TOOLS_ROOT = path.join(ROOT, 'tools');
var CHROME_PATH = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var REPORT_PATH = path.join(__dirname, 'report.json');
var LANGS = ['zh', 'en', 'id'];
var LANG_TAG = { zh: 'zh-CN', en: 'en', id: 'id' };
var LOAD_TIMEOUT_MS = 20000;
var CDP_TIMEOUT_MS = 20000;
var TOUCH_MIN = 43.5;
var TOUCH_SELECTOR = 'header button, header a.brand, main button, main .btn, ' +
  'main select, main input[type=checkbox]';

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// ---------------------------------------------------------------------------
// CLI / discovery
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var opts = {
    slugs: [],
    langs: LANGS.slice(),
    width: 390,
    height: 844,
    json: false,
    jsonPath: null,
    root: process.env.TOOLS_CHECK_ROOT ? path.resolve(process.env.TOOLS_CHECK_ROOT) : DEFAULT_TOOLS_ROOT,
    help: false
  };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--langs') {
      var raw = argv[++i] || '';
      var picked = raw.split(',').map(function (s) { return s.trim(); })
        .filter(function (s) { return LANGS.indexOf(s) !== -1; });
      if (!picked.length) throw new Error('--langs 需要 zh/en/id 中至少一个');
      opts.langs = picked;
    } else if (a === '--width') {
      opts.width = parseInt(argv[++i], 10);
      if (!isFinite(opts.width) || opts.width < 200) throw new Error('--width 非法');
    } else if (a === '--height') {
      opts.height = parseInt(argv[++i], 10);
      if (!isFinite(opts.height) || opts.height < 300) throw new Error('--height 非法');
    } else if (a === '--json') {
      opts.json = true;
      var next = argv[i + 1];
      if (next && next.charAt(0) !== '-') { opts.jsonPath = next; i++; }
    } else if (a === '--root') {
      opts.root = path.resolve(argv[++i] || '');
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a.charAt(0) === '-') {
      throw new Error('未知参数: ' + a);
    } else {
      if (!/^[A-Za-z0-9._-]+$/.test(a)) throw new Error('非法 slug: ' + a);
      opts.slugs.push(a);
    }
  }
  if (!opts.jsonPath) opts.jsonPath = REPORT_PATH;
  return opts;
}

function usage() {
  console.log([
    '用法: node games/tests/browser-check.js [slug ...] [options]',
    '',
    '  --langs zh,en,id   要检查的语言（默认三种都查）',
    '  --width 390        默认视口宽度（另会固定测 390 与 320）',
    '  --height 844       视口高度',
    '  --json [out.json]  输出 JSON 报告（默认 games/tests/report.json）',
    '  --root <dir>       覆盖工具目录（自测用）',
    '',
    '不带 slug 时扫描 tools/ 下含 <script id="engine"> 的新契约工具。'
  ].join('\n'));
}

function hasEngine(html) {
  return /<script\b[^>]*\bid\s*=\s*["']engine["'][^>]*>/i.test(html);
}

function discoverSlugs(root) {
  var entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return []; }
  return entries
    .filter(function (ent) { return ent.isDirectory(); })
    .map(function (ent) { return ent.name; })
    .filter(function (name) {
      var file = path.join(root, name, 'index.html');
      if (!fs.existsSync(file)) return false;
      return hasEngine(fs.readFileSync(file, 'utf8'));
    })
    .sort();
}

function pageUrl(root, slug, lang) {
  var file = path.join(root, slug, 'index.html');
  return pathToFileURL(file).href + '?lang=' + encodeURIComponent(lang);
}

// ---------------------------------------------------------------------------
// Chrome / CDP plumbing
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
var chromeExit = null;
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

async function launchChrome(opts) {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error('找不到 Chrome: ' + CHROME_PATH);
  }
  var port = await freePort();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-browser-check-'));
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
    '--metrics-recording-only',
    '--mute-audio',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=' + opts.width + ',' + opts.height,
    'about:blank'
  ];
  chromeStderr = '';
  chromeProc = child.spawn(CHROME_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProc.stderr.on('data', function (d) {
    chromeStderr = (chromeStderr + d.toString()).slice(-8000);
  });
  chromeProc.once('exit', function (code) { chromeExit = code; });
  var version = await waitForDevtools(port, chromeProc, 25000);
  return { proc: chromeProc, port: port, wsUrl: version.webSocketDebuggerUrl,
    browser: version.Browser || 'unknown' };
}

// Minimal CDP client over the built-in WebSocket. Supports flattened sessions.
function CDP(wsUrl) {
  this.ws = new WebSocket(wsUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.waiters = [];
  this.handlers = [];
  this.closed = false;
  var self = this;
  this.ws.addEventListener('message', function (ev) { self._message(ev.data); });
  this.ws.addEventListener('close', function () {
    self.closed = true;
    self._failAll(new Error('DevTools 连接已关闭'));
  });
}

CDP.prototype._message = function (data) {
  var text = typeof data === 'string' ? data : String(data);
  var msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
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
    try { fn(sid, msg.method, params); } catch (e) { /* listener is best effort */ }
  });
  for (var i = this.waiters.length - 1; i >= 0; i--) {
    var w = this.waiters[i];
    if (w.method === msg.method && w.sessionId === sid) {
      clearTimeout(w.timer);
      this.waiters.splice(i, 1);
      w.resolve(params);
    }
  }
};

CDP.prototype._failAll = function (err) {
  var self = this;
  this.pending.forEach(function (p) { p.reject(err); });
  this.pending.clear();
  this.waiters.forEach(function (w) { clearTimeout(w.timer); w.reject(err); });
  this.waiters = [];
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

CDP.prototype.waitFor = function (sessionId, method, timeoutMs) {
  var self = this;
  return new Promise(function (resolve, reject) {
    var w = {
      sessionId: sessionId || null,
      method: method,
      resolve: resolve,
      reject: reject
    };
    w.timer = setTimeout(function () {
      var i = self.waiters.indexOf(w);
      if (i !== -1) self.waiters.splice(i, 1);
      reject(new Error('等待 ' + method + ' 超时'));
    }, timeoutMs || CDP_TIMEOUT_MS);
    self.waiters.push(w);
  });
};

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

CDP.prototype.close = function () {
  try { this.ws.close(); } catch (e) { /* ignore */ }
};

// ---------------------------------------------------------------------------
// In-page probes
// ---------------------------------------------------------------------------

var SNAPSHOT_EXPR = [
  '(function () {',
  '  "use strict";',
  '  function take(sel, attr) {',
  '    var out = [];',
  '    var els = document.querySelectorAll(sel);',
  '    for (var i = 0; i < els.length; i++) {',
  '      var el = els[i];',
  '      out.push({ key: el.getAttribute(attr), value: (el.textContent || "").trim() });',
  '    }',
  '    return out;',
  '  }',
  '  function takeAttr(sel, keyAttr, valueAttr) {',
  '    var out = [];',
  '    var els = document.querySelectorAll(sel);',
  '    for (var i = 0; i < els.length; i++) {',
  '      var el = els[i];',
  '      var v = el.getAttribute(valueAttr);',
  '      out.push({ key: el.getAttribute(keyAttr), value: v == null ? "" : String(v).trim() });',
  '    }',
  '    return out;',
  '  }',
  '  var out = {};',
  '  out.lang = document.documentElement.lang;',
  '  out.title = document.title;',
  '  out.dataI = take("[data-i]", "data-i");',
  '  out.dataIPh = takeAttr("[data-i-ph]", "data-i-ph", "placeholder");',
  '  out.dataIAria = takeAttr("[data-i-aria]", "data-i-aria", "aria-label");',
  '  out.langButtons = [];',
  '  var lbs = document.querySelectorAll("[data-lang]");',
  '  for (var j = 0; j < lbs.length; j++) {',
  '    var b = lbs[j];',
  '    out.langButtons.push({',
  '      lang: b.getAttribute("data-lang"),',
  '      pressed: b.getAttribute("aria-pressed"),',
  '      tag: b.tagName,',
  '      text: (b.textContent || "").trim()',
  '    });',
  '  }',
  '  var de = document.documentElement;',
  '  out.overflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };',
  '  var touch = [];',
  '  var nodes = document.querySelectorAll(' + JSON.stringify(TOUCH_SELECTOR) + ');',
  '  var seen = 0, skipped = 0;',
  '  for (var k = 0; k < nodes.length; k++) {',
  '    var el = nodes[k];',
  '    var r = el.getBoundingClientRect();',
  '    var cs = getComputedStyle(el);',
  '    var visible = true;',
  '    if (typeof el.checkVisibility === "function") {',
  '      try {',
  '        visible = el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true,',
  '          opacityProperty: true, visibilityProperty: true });',
  '      } catch (e) { visible = true; }',
  '    } else if (cs.display === "none" || cs.visibility === "hidden" ||',
  '        (r.width === 0 && r.height === 0)) {',
  '      visible = false;',
  '    }',
  '    if (!visible) { skipped++; continue; }',
  '    seen++;',
  '    if (r.width < ' + TOUCH_MIN + ' || r.height < ' + TOUCH_MIN + ') {',
  '      touch.push({',
  '        tag: el.tagName.toLowerCase(),',
  '        cls: el.getAttribute("class") || "",',
  '        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 24),',
  '        width: Math.round(r.width * 10) / 10,',
  '        height: Math.round(r.height * 10) / 10',
  '      });',
  '    }',
  '  }',
  '  out.touch = { total: nodes.length, checked: seen, skipped: skipped, violations: touch };',
  '  function parseColor(str) {',
  '    var m = /rgba?\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)(?:\\s*,\\s*([0-9.]+))?\\s*\\)/.exec(str || "");',
  '    if (!m) return null;',
  '    function lin(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }',
  '    return {',
  '      alpha: m[4] == null ? 1 : +m[4],',
  '      luminance: 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3])',
  '    };',
  '  }',
  '  var bg = getComputedStyle(document.body).backgroundColor;',
  '  var parsed = parseColor(bg);',
  '  if (!parsed || parsed.alpha === 0) {',
  '    var alt = getComputedStyle(document.documentElement).backgroundColor;',
  '    var p2 = parseColor(alt);',
  '    if (p2 && p2.alpha > 0) { bg = alt; parsed = p2; }',
  '  }',
  '  out.bodyBg = { color: bg, luminance: parsed ? parsed.luminance : null };',
  '  return out;',
  '})()'
].join('\n');

function dictTitleExpr(lang) {
  return '((typeof TOOL_I18N !== "undefined" && TOOL_I18N[' + JSON.stringify(lang) +
    '] && typeof TOOL_I18N[' + JSON.stringify(lang) + '].docTitle === "string")' +
    ' ? TOOL_I18N[' + JSON.stringify(lang) + '].docTitle : null)';
}

function clickLangExpr(lang) {
  return '(function () {' +
    ' var el = document.querySelector("[data-lang=\\"' + lang + '\\"]");' +
    ' if (!el) return false;' +
    ' el.click();' +
    ' return true;' +
    '})()';
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function translationIssues(list, field) {
  return list.filter(function (item) {
    var v = item[field] == null ? '' : String(item[field]).trim();
    return v === '' || (item.key != null && v === String(item.key).trim());
  });
}

function issueDetail(issues, field, limit) {
  if (!issues.length) return '无违规';
  var shown = issues.slice(0, limit || 8).map(function (i) {
    return i.key + '=' + JSON.stringify(i[field]);
  });
  return '共 ' + issues.length + ' 个: ' + shown.join('; ') +
    (issues.length > shown.length ? ' …' : '');
}

function langButtonDetail(buttons) {
  return buttons.map(function (b) {
    return b.lang + ':' + b.pressed;
  }).join(', ');
}

function langButtonsOk(buttons, lang) {
  if (buttons.length !== 3) return false;
  var keys = buttons.map(function (b) { return b.lang; }).sort().join(',');
  if (keys !== 'en,id,zh') return false;
  var current = buttons.filter(function (b) { return b.lang === lang; });
  if (current.length !== 1 || current[0].pressed !== 'true') return false;
  return buttons.every(function (b) { return b.lang === lang || b.pressed === 'false'; });
}

function touchDetail(touch) {
  var base = touch.checked + ' 个可见元素' +
    (touch.skipped ? '（跳过 ' + touch.skipped + ' 个隐藏元素）' : '');
  if (!touch.violations.length) return base + '均 >= ' + TOUCH_MIN + 'px';
  return base + '中违规: ' + touch.violations.map(function (v) {
    return v.tag + (v.cls ? '.' + v.cls.split(/\s+/).join('.') : '') +
      ' "' + v.text + '" ' + v.width + '×' + v.height;
  }).join('; ');
}

function dedupe(list) {
  var seen = Object.create(null);
  var out = [];
  list.forEach(function (s) {
    if (!seen[s]) { seen[s] = true; out.push(s); }
  });
  return out;
}

function externalRequests(requests) {
  return dedupe(requests.filter(function (u) {
    return !/^(file|data):/i.test(u);
  }));
}

function externalHosts(requests) {
  var hosts = [];
  requests.forEach(function (u) {
    if (/^(file|data):/i.test(u)) return;
    var host = u;
    try {
      var parsed = new URL(u);
      host = parsed.host || parsed.protocol;
    } catch (e) { /* keep raw url */ }
    hosts.push(host);
  });
  return dedupe(hosts);
}

function finishCase(slug, lang, mode, checks, start) {
  var failures = checks.filter(function (c) { return !c.ok; }).map(function (c) {
    return c.name + (c.detail ? ' — ' + c.detail : '');
  });
  return {
    slug: slug,
    lang: lang,
    mode: mode,
    status: failures.length ? 'FAIL' : 'PASS',
    durationMs: Date.now() - start,
    checks: checks,
    failures: failures
  };
}

var activeCollector = null;

function attachEventCollector(cdp, sessionId) {
  cdp.on(function (sid, method, params) {
    if (sid !== sessionId || !activeCollector) return;
    var c = activeCollector;
    if (method === 'Runtime.exceptionThrown') {
      var ed = params.exceptionDetails || {};
      var desc = (ed.exception && ed.exception.description) || ed.text || '未捕获异常';
      c.exceptions.push(String(desc).split('\n')[0].slice(0, 300));
    } else if (method === 'Runtime.consoleAPICalled') {
      if (params.type === 'error') {
        var args = (params.args || []).map(function (a) {
          if (a.value !== undefined) return String(a.value);
          return a.description || a.type || 'error';
        });
        c.console.push(args.join(' ').split('\n')[0].slice(0, 300));
      }
    } else if (method === 'Log.entryAdded') {
      var entry = params.entry || {};
      if (entry.level === 'error') {
        c.log.push((entry.text || 'log error') + (entry.url ? ' @' + entry.url : ''));
      }
    } else if (method === 'Network.requestWillBeSent') {
      c.requests.push((params.request && params.request.url) || '');
    }
  });
}

async function evaluate(cdp, sessionId, expression, timeoutMs) {
  var r = await cdp.send('Runtime.evaluate', {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, sessionId, timeoutMs || CDP_TIMEOUT_MS);
  if (r.exceptionDetails) {
    var d = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
      r.exceptionDetails.text || 'evaluate failed';
    throw new Error(d);
  }
  return r.result ? r.result.value : undefined;
}

async function navigate(cdp, sessionId, url, timeoutMs) {
  var loaded = cdp.waitFor(sessionId, 'Page.loadEventFired', timeoutMs || LOAD_TIMEOUT_MS);
  var res;
  try {
    res = await cdp.send('Page.navigate', { url: url }, sessionId);
  } catch (e) {
    loaded.catch(function () {});
    throw e;
  }
  if (res && res.errorText) {
    loaded.catch(function () {});
    throw new Error('导航失败: ' + res.errorText);
  }
  await loaded;
  await sleep(400);
}

async function setMetrics(cdp, sessionId, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: height
  }, sessionId);
}

async function setScheme(cdp, sessionId, scheme) {
  var features = scheme
    ? [{ name: 'prefers-color-scheme', value: scheme }]
    : [];
  await cdp.send('Emulation.setEmulatedMedia', { features: features }, sessionId);
  await sleep(100);
}

async function runFullCase(ctx, slug, lang) {
  var start = Date.now();
  var checks = [];
  function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  }
  var coll = { exceptions: [], console: [], log: [], requests: [] };
  activeCollector = coll;
  var cdp = ctx.cdp, sid = ctx.sid;
  var expectedLang = LANG_TAG[lang];

  try {
    await setMetrics(cdp, sid, ctx.opts.width, ctx.opts.height);
    await navigate(cdp, sid, pageUrl(ctx.opts.root, slug, lang));
    check('页面加载 (loadEventFired + 400ms)', true);
  } catch (e) {
    check('页面加载 (loadEventFired + 400ms)', false, e.message);
    activeCollector = null;
    return finishCase(slug, lang, 'full', checks, start);
  }

  // 390px: touch targets + overflow baseline.
  await setMetrics(cdp, sid, 390, ctx.opts.height);
  await sleep(80);
  var snap390 = await evaluate(cdp, sid, SNAPSHOT_EXPR);

  // 320px: no horizontal scrolling.
  await setMetrics(cdp, sid, 320, ctx.opts.height);
  await sleep(80);
  var snap320 = await evaluate(cdp, sid, SNAPSHOT_EXPR);

  // Dark then light via prefers-color-scheme.
  await setScheme(cdp, sid, 'dark');
  var darkSnap = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  await setScheme(cdp, sid, 'light');
  var lightSnap = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  await setScheme(cdp, sid, null);

  check('document.documentElement.lang = ' + expectedLang,
    snap390.lang === expectedLang, 'got ' + JSON.stringify(snap390.lang));

  check('document.title 非空', !!(snap390.title || '').trim(),
    'got ' + JSON.stringify(snap390.title));

  check('存在 data-i 元素', snap390.dataI.length > 0, '数量 ' + snap390.dataI.length);
  var di = translationIssues(snap390.dataI, 'value');
  check('data-i 全部已翻译', di.length === 0, issueDetail(di, 'value'));

  var ph = translationIssues(snap390.dataIPh, 'value');
  check('data-i-ph placeholder 非空', ph.length === 0,
    snap390.dataIPh.length + ' 个，' + issueDetail(ph, 'value'));

  var aria = translationIssues(snap390.dataIAria, 'value');
  check('data-i-aria aria-label 非空', aria.length === 0,
    snap390.dataIAria.length + ' 个，' + issueDetail(aria, 'value'));

  check('语言按钮 3 个且 aria-pressed 正确',
    langButtonsOk(snap390.langButtons, lang),
    langButtonDetail(snap390.langButtons));

  check('390px 无横向滚动',
    snap390.overflow.scrollWidth <= snap390.overflow.clientWidth + 1,
    'scrollWidth=' + snap390.overflow.scrollWidth + ', clientWidth=' + snap390.overflow.clientWidth);

  check('320px 无横向滚动',
    snap320.overflow.scrollWidth <= snap320.overflow.clientWidth + 1,
    'scrollWidth=' + snap320.overflow.scrollWidth + ', clientWidth=' + snap320.overflow.clientWidth);

  check('触控目标 >= ' + TOUCH_MIN + 'px', snap390.touch.violations.length === 0,
    touchDetail(snap390.touch));

  var darkLum = darkSnap.bodyBg.luminance;
  var lightLum = lightSnap.bodyBg.luminance;
  check('深色模式 body 背景亮度 < 0.5',
    darkLum != null && darkLum < 0.5,
    darkSnap.bodyBg.color + ' luminance=' + darkLum);
  check('浅色模式 body 背景亮度 > 0.5',
    lightLum != null && lightLum > 0.5,
    lightSnap.bodyBg.color + ' luminance=' + lightLum);

  // Language switching with real clicks.
  var prevTitle = snap390.title;
  var switchLangs = ['en', 'id'];
  for (var i = 0; i < switchLangs.length; i++) {
    var target = switchLangs[i];
    var clicked;
    try {
      clicked = await evaluate(cdp, sid, clickLangExpr(target));
    } catch (e) {
      clicked = false;
    }
    await sleep(150);
    var snap = await evaluate(cdp, sid, SNAPSHOT_EXPR);
    var expectedTitle = await evaluate(cdp, sid, dictTitleExpr(target));
    var tag = ' [切换 ' + target + ']';

    check('点击 [data-lang="' + target + '"]' + tag, clicked === true,
      clicked === true ? '' : '找不到该语言按钮');
    check('html lang' + tag, snap.lang === LANG_TAG[target],
      'got ' + JSON.stringify(snap.lang));
    // Clicking the language the page already uses is a no-op, so only demand a
    // changed title when the test actually switches away from the initial one.
    var mustChangeTitle = target !== lang;
    check('document.title 更新' + tag,
      !!(snap.title || '').trim() && (!mustChangeTitle || snap.title !== prevTitle),
      'got ' + JSON.stringify(snap.title) + ', previous ' + JSON.stringify(prevTitle) +
        (mustChangeTitle ? '' : ' (初始语言已是 ' + target + '，不要求变化)') +
        (expectedTitle != null ? ', dict docTitle ' + JSON.stringify(expectedTitle) : ''));
    check('语言按钮 aria-pressed' + tag,
      langButtonsOk(snap.langButtons, target), langButtonDetail(snap.langButtons));
    var sdi = translationIssues(snap.dataI, 'value');
    check('data-i 仍全部已翻译' + tag, sdi.length === 0, issueDetail(sdi, 'value'));
    var sph = translationIssues(snap.dataIPh, 'value');
    check('data-i-ph 仍非空' + tag, sph.length === 0, issueDetail(sph, 'value'));
    var saria = translationIssues(snap.dataIAria, 'value');
    check('data-i-aria 仍非空' + tag, saria.length === 0, issueDetail(saria, 'value'));
    prevTitle = snap.title;
  }

  var external = externalRequests(coll.requests);
  check('零外部请求 (仅 file:/data:)', external.length === 0, external.slice(0, 8).join('; '));
  var hosts = externalHosts(coll.requests);
  check('无外部 host', hosts.length === 0, hosts.join(', '));

  var runtimeErrors = dedupe(coll.exceptions.concat(coll.console, coll.log));
  check('无未捕获异常 / console error', runtimeErrors.length === 0,
    runtimeErrors.slice(0, 8).join('; '));

  activeCollector = null;
  return finishCase(slug, lang, 'full', checks, start);
}

async function runBasicCase(ctx, slug, lang) {
  var start = Date.now();
  var checks = [];
  function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  }
  var coll = { exceptions: [], console: [], log: [], requests: [] };
  activeCollector = coll;
  var cdp = ctx.cdp, sid = ctx.sid;

  try {
    await setMetrics(cdp, sid, 390, ctx.opts.height);
    await navigate(cdp, sid, pageUrl(ctx.opts.root, slug, lang));
    check('页面加载', true);
  } catch (e) {
    check('页面加载', false, e.message);
    activeCollector = null;
    return finishCase(slug, lang, 'basic', checks, start);
  }

  var snap = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  check('document.title 非空', !!(snap.title || '').trim(),
    'got ' + JSON.stringify(snap.title));
  check('390px 无横向滚动',
    snap.overflow.scrollWidth <= snap.overflow.clientWidth + 1,
    'scrollWidth=' + snap.overflow.scrollWidth + ', clientWidth=' + snap.overflow.clientWidth);

  var external = externalRequests(coll.requests);
  check('零外部请求 (仅 file:/data:)', external.length === 0, external.slice(0, 8).join('; '));

  var runtimeErrors = dedupe(coll.exceptions.concat(coll.console, coll.log));
  check('无未捕获异常 / console error', runtimeErrors.length === 0,
    runtimeErrors.slice(0, 8).join('; '));

  activeCollector = null;
  return finishCase(slug, lang, 'basic', checks, start);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printCase(c) {
  var tag = c.mode === 'basic' ? ' [基础检查]' : '';
  console.log('[' + c.status + '] tools/' + c.slug + ' (' + c.lang + ')' + tag +
    ' — ' + c.checks.length + ' 项检查, ' + c.failures.length + ' 失败, ' +
    (c.durationMs / 1000).toFixed(2) + 's');
  c.failures.forEach(function (f) { console.log('    FAIL: ' + f); });
}

async function main() {
  var opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('参数错误: ' + e.message); process.exitCode = 1; return; }
  if (opts.help) { usage(); return; }
  if (!fs.existsSync(opts.root)) {
    console.error('工具目录不存在: ' + opts.root);
    process.exitCode = 1;
    return;
  }

  var slugs = opts.slugs.length ? opts.slugs : discoverSlugs(opts.root);
  var explicit = opts.slugs.length > 0;
  if (!slugs.length) {
    console.error('没有找到含 <script id="engine"> 的工具，且未显式指定 slug。');
    process.exitCode = 1;
    return;
  }

  var cdp = null;
  var pages = [];
  var browserInfo = 'unknown';
  try {
    var launched = await launchChrome(opts);
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
    attachEventCollector(cdp, sid);

    var ctx = { cdp: cdp, sid: sid, opts: opts, browser: browserInfo };
    console.log('');
    console.log('Chrome: ' + browserInfo + ' · root: ' + opts.root +
      ' · langs: ' + opts.langs.join(',') + ' · viewport: ' + opts.width + '×' + opts.height);

    for (var s = 0; s < slugs.length; s++) {
      var slug = slugs[s];
      var file = path.join(opts.root, slug, 'index.html');
      if (!fs.existsSync(file)) {
        var missing = {
          slug: slug, lang: '-', mode: 'missing', status: 'FAIL', durationMs: 0,
          checks: [{ name: 'index.html 存在', ok: false, detail: file }],
          failures: ['index.html 存在 — ' + file]
        };
        pages.push(missing);
        printCase(missing);
        continue;
      }
      var html = fs.readFileSync(file, 'utf8');
      var full = hasEngine(html);
      var mode = full ? 'full' : 'basic';
      if (!full && !explicit) mode = 'basic';
      for (var l = 0; l < opts.langs.length; l++) {
        var lang = opts.langs[l];
        var result;
        try {
          result = mode === 'full'
            ? await runFullCase(ctx, slug, lang)
            : await runBasicCase(ctx, slug, lang);
        } catch (e) {
          // A crashed page must not abort the remaining pages.
          var detail = e && e.message ? e.message : String(e);
          result = {
            slug: slug, lang: lang, mode: mode, status: 'FAIL', durationMs: 0,
            checks: [{ name: '检查执行完成', ok: false, detail: detail }],
            failures: ['检查执行完成 — ' + detail]
          };
        }
        pages.push(result);
        printCase(result);
      }
    }
  } catch (e) {
    console.error('\nbrowser-check 失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await cleanup();
  }

  var failed = pages.filter(function (p) { return p.status !== 'PASS'; });
  var checksTotal = pages.reduce(function (n, p) { return n + p.checks.length; }, 0);
  var checksFailed = pages.reduce(function (n, p) {
    return n + p.checks.filter(function (c) { return !c.ok; }).length;
  }, 0);
  console.log('');
  console.log('汇总: ' + pages.length + ' 个页面检查 · ' + (pages.length - failed.length) +
    ' PASS · ' + failed.length + ' FAIL · 检查项 ' + checksTotal + ' 个（失败 ' + checksFailed + '）');

  if (opts.json) {
    var report = {
      generatedAt: new Date().toISOString(),
      runner: 'games/tests/browser-check.js',
      chrome: browserInfo,
      chromePath: CHROME_PATH,
      toolsRoot: opts.root,
      viewport: { width: opts.width, height: opts.height },
      langs: opts.langs,
      pages: pages,
      summary: {
        pages: pages.length,
        passed: pages.length - failed.length,
        failed: failed.length,
        checks: checksTotal,
        checksFailed: checksFailed,
        ok: pages.length > 0 && failed.length === 0
      }
    };
    try {
      fs.mkdirSync(path.dirname(path.resolve(opts.jsonPath)), { recursive: true });
      fs.writeFileSync(path.resolve(opts.jsonPath), JSON.stringify(report, null, 2) + '\n');
      console.log('JSON 报告已写入 ' + path.resolve(opts.jsonPath));
    } catch (e) {
      console.error('写入 JSON 报告失败: ' + e.message);
      process.exitCode = 1;
    }
  }

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
  main().catch(function (e) {
    console.error('browser-check 异常: ' + (e && e.stack || e));
    cleanup().then(function () { process.exit(1); });
  });
}

module.exports = {
  parseArgs: parseArgs,
  discoverSlugs: discoverSlugs,
  hasEngine: hasEngine,
  externalRequests: externalRequests,
  externalHosts: externalHosts,
  translationIssues: translationIssues
};
