'use strict';

/*
 * Minimal headless-Chrome driver over the DevTools Protocol.
 *
 * No puppeteer/playwright, no npm deps: Node >= 22 global WebSocket + fetch.
 * Chrome is launched with a throw-away profile under the OS temp dir; the
 * profile and process are cleaned up even when assertions throw.
 *
 * If Chrome is not installed, callers should SKIP browser checks rather than
 * fail. Nothing here touches the network: pages are opened via file://.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      // ignore unreadable paths
    }
  }
  return null;
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function httpJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 1200) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
  return response.json();
}

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await httpJson('http://127.0.0.1:' + port + '/json/version', 1000);
    } catch (err) {
      lastError = err;
      await sleep(120);
    }
  }
  throw new Error('Chrome DevTools endpoint did not start: ' + (lastError && lastError.message));
}

/* -------------------------------------------------------------------------
 * 常驻 Chrome 复用（用户规定：不反复启停，测试结束不 kill）
 * ---------------------------------------------------------------------- */
const RESIDENT_CACHE = path.join(os.homedir(), '.cache/games-quality-audit');
const RESIDENT_PORT_FILE = path.join(RESIDENT_CACHE, 'chrome-port');
const RESIDENT_PROFILE = path.join(RESIDENT_CACHE, 'chrome-profile');

function residentPorts() {
  const ports = [];
  if (process.env.GAMES_AUDIT_CDP) ports.push(Number(process.env.GAMES_AUDIT_CDP));
  try {
    const p = Number(fs.readFileSync(RESIDENT_PORT_FILE, 'utf8').trim());
    if (p) ports.push(p);
  } catch (err) { /* none */ }
  try {
    const ps = execFileSync('pgrep', ['-fl', 'Google Chrome'], { encoding: 'utf8' });
    for (const line of ps.split('\n')) {
      if (!/--remote-debugging-port=\d+/.test(line)) continue;
      if (!/--headless|game-smoke|games-quality|boardgame-cdp/.test(line)) continue;
      const m = line.match(/--remote-debugging-port=(\d+)/);
      if (m) ports.push(Number(m[1]));
    }
  } catch (err) { /* pgrep may fail */ }
  return Array.from(new Set(ports));
}

async function residentEndpoint() {
  for (const port of residentPorts()) {
    try {
      await httpJson('http://127.0.0.1:' + port + '/json/version', 1000);
      return port;
    } catch (err) { /* try next */ }
  }
  return null;
}

async function newPagetarget(port) {
  const url = 'http://127.0.0.1:' + port + '/json/new?about:blank';
  for (const method of ['PUT', 'GET']) {
    try {
      const response = await fetch(url, {
        method: method,
        signal: AbortSignal.timeout(2500)
      });
      if (!response.ok) continue;
      const target = await response.json();
      if (target && target.webSocketDebuggerUrl) return target;
    } catch (err) { /* try the other method */ }
  }
  throw new Error('could not create a new Chrome target on resident instance');
}

async function startResidentChrome(chromePath) {
  fs.mkdirSync(RESIDENT_PROFILE, { recursive: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--mute-audio',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    '--user-data-dir=' + RESIDENT_PROFILE,
    'about:blank'
  ];
  const proc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  const activePortFile = path.join(RESIDENT_PROFILE, 'DevToolsActivePort');
  for (let i = 0; i < 120; i++) {
    try {
      const port = Number(fs.readFileSync(activePortFile, 'utf8').split('\n')[0].trim());
      if (port) {
        await waitForEndpoint(port, 1500);
        fs.mkdirSync(RESIDENT_CACHE, { recursive: true });
        fs.writeFileSync(RESIDENT_PORT_FILE, String(port));
        return port;
      }
    } catch (err) { /* not ready */ }
    await sleep(150);
  }
  throw new Error('resident Chrome failed to start');
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    const self = this;
    await new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { reject(new Error('CDP WebSocket open timeout')); }, 5000);
      self.ws.addEventListener('open', function () {
        clearTimeout(timer);
        resolve();
      });
      self.ws.addEventListener('error', function (event) {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket error: ' + (event && event.message ? event.message : 'unknown')));
      });
    });
    this.ws.addEventListener('message', function (event) {
      let message;
      try { message = JSON.parse(event.data); } catch (err) { return; }
      if (message.id && self.pending.has(message.id)) {
        const entry = self.pending.get(message.id);
        self.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else entry.resolve(message.result);
        return;
      }
      for (const listener of self.listeners) listener(message);
    });
  }

  send(method, params, sessionId) {
    const self = this;
    const id = this.nextId++;
    return new Promise(function (resolve, reject) {
      if (!self.ws || self.ws.readyState !== 1) {
        reject(new Error('CDP socket is not open (' + method + ')'));
        return;
      }
      const timer = setTimeout(function () {
        self.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, 15000);
      self.pending.set(id, {
        resolve: function (value) { clearTimeout(timer); resolve(value); },
        reject: function (err) { clearTimeout(timer); reject(err); }
      });
      const payload = { id: id, method: method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      self.ws.send(JSON.stringify(payload));
    });
  }

  on(listener) { this.listeners.push(listener); }

  close() {
    try { this.ws.close(); } catch (err) { /* ignore */ }
  }
}

/*
 * Open `url` in headless Chrome and run `fn(page)`.
 * page.evaluate(expression) -> JSON value
 * page.metrics({width,height}) -> {innerWidth, clientWidth, scrollWidth, overflow}
 * page.colors() -> {light, dark} body background colors
 * page.externalRequests, page.consoleErrors, page.pageErrors
 */
export async function withChrome(url, fn, options) {
  const opts = options || {};
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found');

  // 先复用常驻 Chrome；没有才启动一次常驻实例（不 kill，供后续复用）。
  let port = await residentEndpoint();
  let reused = Boolean(port);
  if (!port) {
    port = await startResidentChrome(chromePath);
  }
  const pageTarget = await newPagetarget(port);
  let cdp = null;
  try {
    cdp = new CDP(pageTarget.webSocketDebuggerUrl);
    await cdp.open();

    const externalRequests = [];
    const consoleErrors = [];
    const pageErrors = [];

    cdp.on(function (message) {
      if (message.method === 'Network.requestWillBeSent') {
        const requestUrl = message.params && message.params.request && message.params.request.url;
        if (!/^(file|data|about|blob):/.test(requestUrl || '')) {
          externalRequests.push(requestUrl);
        }
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        consoleErrors.push((message.params.args || []).map(function (arg) {
          return arg.value != null ? String(arg.value) : (arg.description || arg.type);
        }).join(' '));
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params.exceptionDetails || {};
        pageErrors.push(detail.text || (detail.exception && detail.exception.description) || 'exception');
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry || {};
        if (entry.level === 'error') consoleErrors.push(entry.text || 'log error');
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');

    const loaded = new Promise(function (resolve) {
      cdp.on(function (message) {
        if (message.method === 'Page.loadEventFired') resolve();
      });
    });
    await cdp.send('Page.navigate', { url: url });
    await Promise.race([loaded, sleep(6000)]);

    // 常驻 Chrome 会保留上次运行的 localStorage（例如主题偏好）；在 file://
    // 页面重新加载一次前清空，保证每个测试从干净状态开始。
    if (/^file:/.test(String(url))) {
      try {
        await cdp.send('Runtime.evaluate', {
          expression: 'try{localStorage.clear()}catch(e){}',
          returnByValue: true
        });
        const reloaded = new Promise(function (resolve) {
          cdp.on(function (message) {
            if (message.method === 'Page.loadEventFired') resolve();
          });
        });
        await cdp.send('Page.reload', { ignoreCache: true });
        await Promise.race([reloaded, sleep(6000)]);
      } catch (err) {
        // Storage may be unavailable for some file:// origins; continue.
      }
    }

    const page = {
      cdp: cdp,
      async evaluate(expression) {
        const result = await cdp.send('Runtime.evaluate', {
          expression: expression,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true
        });
        if (result.exceptionDetails) {
          throw new Error('evaluate failed: ' +
            (result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)));
        }
        return result.result ? result.result.value : undefined;
      },
      async metrics(viewport) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height || 800,
          deviceScaleFactor: 1,
          mobile: true
        });
        await sleep(120);
        return await page.evaluate('(function(){' +
          'var de=document.documentElement;' +
          'var vw=window.innerWidth||de.clientWidth;' +
          'var over=[];' +
          'document.querySelectorAll("body *").forEach(function(el){' +
          '  var s=getComputedStyle(el);' +
          '  if(s.position==="fixed"||s.position==="sticky") return;' +
          '  var r=el.getBoundingClientRect();' +
          '  if(r.width>0&&(r.right>de.clientWidth+1||r.left<-1)){' +
          '    over.push({tag:el.tagName,cls:String(el.className||"").slice(0,80),left:Math.round(r.left),right:Math.round(r.right)});' +
          '  }' +
          '});' +
          'return {innerWidth:vw,clientWidth:de.clientWidth,scrollWidth:de.scrollWidth,' +
          '  bodyScrollWidth:document.body?document.body.scrollWidth:0,' +
          '  overflow:over.slice(0,12)};' +
          '})()');
      },
      async colors() {
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'light' }]
        });
        await sleep(150);
        const light = await page.evaluate('getComputedStyle(document.body).backgroundColor');
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'dark' }]
        });
        await sleep(150);
        const dark = await page.evaluate('getComputedStyle(document.body).backgroundColor');
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
        return { light: light, dark: dark };
      },
      externalRequests: externalRequests,
      consoleErrors: consoleErrors,
      pageErrors: pageErrors
    };

    return await fn(page);
  } finally {
    // 只关自己开的标签；常驻 Chrome 进程保留（用户规定不 kill）。
    if (cdp) {
      try { await cdp.send('Page.close'); } catch (err) { /* ignore */ }
      cdp.close();
    }
    await sleep(80);
    void reused;
  }
}
