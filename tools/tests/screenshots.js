#!/usr/bin/env node
'use strict';

/*
 * Screenshot harness for the tools hall and tool pages.
 *
 *   node tools/tests/screenshots.js [slug ...] [options]
 *
 *   --lang zh|en|id[,..]  tool-page language(s) (default zh)
 *                        (the hall is always captured in zh/en/id)
 *   --width 390          tool-page viewport width (hall is fixed at 1280)
 *   --height 844         tool-page viewport height (hall is fixed at 900)
 *   --full-page          capture the full hall page instead of the desktop first screen
 *   --out <dir>          override the output directory
 *
 * No puppeteer / playwright: headless Chrome is driven over the Chrome
 * DevTools Protocol using Node's built-in global WebSocket (Node >= 22).
 *
 * Default output (manifest merged across runs):
 *   tools/tests/screenshots/<slug>-<lang>-<width>.png
 *   tools/tests/screenshots/manifest.json
 *
 * Hall captures use slug "tools-hall" and the fixed desktop viewport 1280x900.
 * Tool pages always capture the first screen (no full-page) at 390x844 unless
 * --width/--height say otherwise. deviceScaleFactor is 2 for every capture.
 *
 * Network failures are ignored for rendering but recorded in the manifest.
 * This script does no OCR / image analysis: it only captures and measures.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var net = require('net');
var http = require('http');
var child = require('child_process');
var pathToFileURL = require('url').pathToFileURL;

var TOOLS_ROOT = path.resolve(__dirname, '..');
var DEFAULT_OUT = path.join(__dirname, 'screenshots');
var CHROME_PATH = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var LANGS = ['zh', 'en', 'id'];
var HALL_SLUG = 'tools-hall';
var HALL_WIDTH = 1280;
var HALL_HEIGHT = 900;
var DEVICE_SCALE = 2;
var LOAD_TIMEOUT_MS = 20000;
var CDP_TIMEOUT_MS = 20000;
var POST_LOAD_WAIT_MS = 500;

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var opts = {
    slugs: [],
    langs: ['zh'],
    width: 390,
    height: 844,
    fullPage: false,
    all: false,
    out: DEFAULT_OUT,
    help: false
  };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--lang' || a === '--langs') {
      var raw = argv[++i] || '';
      var picked = raw.split(',').map(function (s) { return s.trim(); })
        .filter(function (s) { return LANGS.indexOf(s) !== -1; });
      if (!picked.length) throw new Error('--lang 需要 zh/en/id 中至少一个');
      opts.langs = picked;
    } else if (a === '--width') {
      opts.width = parseInt(argv[++i], 10);
      if (!isFinite(opts.width) || opts.width < 200) throw new Error('--width 非法');
    } else if (a === '--height') {
      opts.height = parseInt(argv[++i], 10);
      if (!isFinite(opts.height) || opts.height < 300) throw new Error('--height 非法');
    } else if (a === '--full-page' || a === '--full') {
      opts.fullPage = true;
    } else if (a === '--all') {
      opts.all = true;
    } else if (a === '--out') {
      opts.out = path.resolve(argv[++i] || '');
      if (!argv[i]) throw new Error('--out 需要一个目录');
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a.charAt(0) === '-') {
      throw new Error('未知参数: ' + a);
    } else {
      if (!/^[A-Za-z0-9._-]+$/.test(a)) throw new Error('非法 slug: ' + a);
      opts.slugs.push(a);
    }
  }
  return opts;
}

function usage() {
  console.log([
    '用法: node tools/tests/screenshots.js [slug ...] [options]',
    '',
    '  不带 slug 时只截三个大厅；带 slug 时先截大厅，再截这些工具页。',
    '  --all             截 tools/tests/catalog.json 里的全部工具（缺目录会报出）',
    '',
    '  --lang zh,en,id   工具页语言（默认 zh；大厅固定 zh/en/id 三张）',
    '  --width 390       工具页视口宽度（大厅固定 1280）',
    '  --height 844      工具页视口高度（大厅固定 900）',
    '  --full-page       大厅截整页（工具页始终只截首屏）',
    '  --out <dir>       输出目录（默认 tools/tests/screenshots）',
    '',
    '输出: <slug>-<lang>-<width>.png + manifest.json（跨次运行合并）'
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// Chrome / CDP plumbing (adapted from games/tests/browser-check.js)
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
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error('找不到 Chrome: ' + CHROME_PATH);
  }
  var port = await freePort();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-screenshots-'));
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
    '--force-color-profile=srgb',
    'about:blank'
  ];
  chromeStderr = '';
  chromeProc = child.spawn(CHROME_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProc.stderr.on('data', function (d) {
    chromeStderr = (chromeStderr + d.toString()).slice(-8000);
  });
  var version = await waitForDevtools(port, chromeProc, 25000);
  return { port: port, wsUrl: version.webSocketDebuggerUrl,
    browser: version.Browser || 'unknown' };
}

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
    try { fn(sid, msg.method, params); } catch (e) { /* best effort */ }
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
// Capture
// ---------------------------------------------------------------------------

var activeCollector = null;

function attachNetworkCollector(cdp, sessionId) {
  cdp.on(function (sid, method, params) {
    if (sid !== sessionId || !activeCollector) return;
    var c = activeCollector;
    if (method === 'Network.requestWillBeSent') {
      c.urls[params.requestId] = (params.request && params.request.url) || '';
    } else if (method === 'Network.loadingFailed') {
      if (params.errorText === 'net::ERR_ABORTED') return; // normal navigation cancel
      c.errors.push({
        url: params.url || c.urls[params.requestId] || '',
        error: params.errorText || 'loadingFailed'
      });
    } else if (method === 'Network.responseReceived') {
      var res = params.response || {};
      if (res.status && res.status >= 400) {
        c.errors.push({ url: res.url || '', error: 'HTTP ' + res.status });
      }
    }
  });
}

function pngDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    return null;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
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
  await sleep(POST_LOAD_WAIT_MS);
}

async function setMetrics(cdp, sid, width, height, mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: DEVICE_SCALE,
    mobile: mobile,
    screenWidth: width,
    screenHeight: height
  }, sid);
}

async function capture(cdp, sid, entry) {
  var params = {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: !!entry.fullPage
  };
  if (entry.fullPage) {
    var metrics = await cdp.send('Page.getLayoutMetrics', {}, sid);
    var size = metrics.cssContentSize || metrics.contentSize || {};
    var w = Math.max(entry.viewportWidth, Math.ceil(size.width || entry.viewportWidth));
    var h = Math.max(entry.viewportHeight, Math.ceil(size.height || entry.viewportHeight));
    params.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    entry.clip = { width: w, height: h };
  }
  var shot = await cdp.send('Page.captureScreenshot', params, sid, 30000);
  var buf = Buffer.from(shot.data || '', 'base64');
  if (!buf.length) throw new Error('截图返回空数据');
  var dims = pngDimensions(buf);
  if (!dims) throw new Error('截图不是合法 PNG');
  entry.pngWidth = dims.width;
  entry.pngHeight = dims.height;
  entry.bytes = buf.length;
  fs.writeFileSync(entry.file, buf);
  return entry;
}

function hallUrl(lang) {
  var file = lang === 'zh'
    ? path.join(TOOLS_ROOT, 'index.html')
    : path.join(TOOLS_ROOT, lang, 'index.html');
  return pathToFileURL(file).href;
}

function toolUrl(slug, lang) {
  return pathToFileURL(path.join(TOOLS_ROOT, slug, 'index.html')).href +
    '?lang=' + encodeURIComponent(lang);
}

function outName(slug, lang, width) {
  return slug + '-' + lang + '-' + width + '.png';
}

async function runCapture(ctx, spec) {
  var entry = {
    slug: spec.slug,
    kind: spec.kind,
    lang: spec.lang,
    url: spec.url,
    viewportWidth: spec.width,
    viewportHeight: spec.height,
    deviceScaleFactor: DEVICE_SCALE,
    fullPage: !!spec.fullPage,
    file: path.join(ctx.opts.out, outName(spec.slug, spec.lang, spec.width)),
    capturedAt: new Date().toISOString(),
    networkErrors: []
  };
  var coll = { errors: [], urls: Object.create(null) };
  activeCollector = coll;
  try {
    await setMetrics(ctx.cdp, ctx.sid, spec.width, spec.height, spec.kind === 'tool');
    await navigate(ctx.cdp, ctx.sid, spec.url);
    await capture(ctx.cdp, ctx.sid, entry);
    entry.status = 'ok';
  } catch (e) {
    entry.status = 'failed';
    entry.error = e && e.message ? e.message : String(e);
  } finally {
    activeCollector = null;
  }
  entry.networkErrors = coll.errors;
  entry.file = path.relative(ctx.opts.out, entry.file) || entry.file;
  return entry;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function loadManifest(outDir) {
  var file = path.join(outDir, 'manifest.json');
  try {
    var data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && Array.isArray(data.entries)) return data;
  } catch (e) { /* first run */ }
  return { entries: [] };
}

function writeManifest(outDir, entries) {
  var file = path.join(outDir, 'manifest.json');
  var keep = entries.filter(function (e) {
    return e && e.file && fs.existsSync(path.join(outDir, e.file));
  });
  keep.sort(function (a, b) {
    return String(a.file).localeCompare(String(b.file));
  });
  var doc = {
    generatedAt: new Date().toISOString(),
    runner: 'tools/tests/screenshots.js',
    deviceScaleFactor: DEVICE_SCALE,
    count: keep.length,
    totalBytes: keep.reduce(function (n, e) { return n + (e.bytes || 0); }, 0),
    entries: keep
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  var opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('参数错误: ' + e.message); process.exitCode = 1; return; }
  if (opts.help) { usage(); return; }

  fs.mkdirSync(opts.out, { recursive: true });

  var wantedSlugs = opts.slugs.slice();
  var catalogCount = 0;
  if (opts.all) {
    var catalogPath = path.join(__dirname, 'catalog.json');
    try {
      var catalogRaw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      var catalog = Array.isArray(catalogRaw) ? catalogRaw : (catalogRaw && catalogRaw.tools);
      if (!Array.isArray(catalog)) throw new Error('catalog.json 不是工具数组（或缺少 tools 数组）');
      catalogCount = catalog.length;
      catalog.forEach(function (item) {
        if (item && typeof item.slug === 'string' && item.slug) {
          wantedSlugs.push(item.slug);
        }
      });
    } catch (e) {
      console.error('读取 catalog.json 失败: ' + e.message);
      process.exitCode = 1;
      return;
    }
  }
  var seenSlug = Object.create(null);
  wantedSlugs = wantedSlugs.filter(function (s) {
    if (seenSlug[s]) return false;
    seenSlug[s] = true;
    return true;
  });

  var specs = [];
  // Halls: always captured, fixed desktop viewport, optional full page.
  for (var h = 0; h < LANGS.length; h++) {
    specs.push({
      slug: HALL_SLUG,
      kind: 'hall',
      lang: LANGS[h],
      url: hallUrl(LANGS[h]),
      width: HALL_WIDTH,
      height: HALL_HEIGHT,
      fullPage: opts.fullPage
    });
  }
  // Tool pages: explicit slugs only, first screen only.
  var missing = [];
  for (var s = 0; s < wantedSlugs.length; s++) {
    var slug = wantedSlugs[s];
    if (!fs.existsSync(path.join(TOOLS_ROOT, slug, 'index.html'))) {
      missing.push(slug);
      continue;
    }
    for (var l = 0; l < opts.langs.length; l++) {
      specs.push({
        slug: slug,
        kind: 'tool',
        lang: opts.langs[l],
        url: toolUrl(slug, opts.langs[l]),
        width: opts.width,
        height: opts.height,
        fullPage: false
      });
    }
  }

  var cdp = null;
  var entries = [];
  try {
    var launched = await launchChrome();
    cdp = new CDP(launched.wsUrl);
    await cdp.open();

    var target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    var attached = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });
    var sid = attached.sessionId;
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Network.enable', {}, sid);
    attachNetworkCollector(cdp, sid);

    var ctx = { cdp: cdp, sid: sid, opts: opts };
    console.log('Chrome: ' + launched.browser + ' · out: ' + opts.out +
      ' · scale: ' + DEVICE_SCALE + 'x');
    for (var i = 0; i < specs.length; i++) {
      var entry = await runCapture(ctx, specs[i]);
      entries.push(entry);
      if (entry.status === 'ok') {
        console.log('[ok] ' + entry.file + ' ' + entry.pngWidth + '×' +
          entry.pngHeight + 'px ' + entry.bytes + 'B' +
          (entry.networkErrors.length ? ' (网络错误 ' + entry.networkErrors.length + ')' : ''));
      } else {
        console.log('[FAIL] ' + entry.slug + ' (' + entry.lang + ') — ' + entry.error);
      }
    }
  } catch (e) {
    console.error('截图失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await cleanup();
  }

  // Merge into any existing manifest (incremental runs).
  var manifest = loadManifest(opts.out);
  var byFile = Object.create(null);
  manifest.entries.forEach(function (e) {
    if (e && e.file) byFile[e.file] = e;
  });
  entries.forEach(function (e) {
    byFile[e.file] = e;
  });
  var merged = Object.keys(byFile).map(function (k) { return byFile[k]; });
  var doc = writeManifest(opts.out, merged);

  console.log('');
  if (opts.all) {
    var toolOk = entries.filter(function (e) {
      return e.kind === 'tool' && e.status === 'ok';
    }).length;
    console.log('catalog: ' + catalogCount + ' 个工具 · 本次工具截图 ' + toolOk +
      ' 张 · 缺目录 ' + missing.length);
  }
  console.log('汇总: ' + entries.length + ' 张本次截图 · ' +
    entries.filter(function (e) { return e.status === 'ok'; }).length + ' 成功 · ' +
    entries.filter(function (e) { return e.status !== 'ok'; }).length + ' 失败 · ' +
    'manifest ' + doc.count + ' 条 (' + doc.totalBytes + 'B)');
  if (missing.length) {
    var shownMissing = missing.slice(0, 10).join(', ');
    console.log('缺少目录 ' + missing.length + ' 个: ' + shownMissing +
      (missing.length > 10 ? ' …' : ''));
    process.exitCode = 1;
  }
  if (entries.some(function (e) { return e.status !== 'ok'; })) {
    process.exitCode = 1;
  }
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
    console.error('screenshots 异常: ' + (e && e.stack || e));
    cleanup().then(function () { process.exit(1); });
  });
}

module.exports = {
  parseArgs: parseArgs,
  pngDimensions: pngDimensions,
  outName: outName
};
