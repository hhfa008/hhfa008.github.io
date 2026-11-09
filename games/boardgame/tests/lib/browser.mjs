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
import { spawn } from 'node:child_process';

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

  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-cdp-'));
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
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port
  ].concat(Array.isArray(opts.args) ? opts.args : []).concat(['about:blank']);
  const proc = spawn(chromePath, args, { stdio: 'ignore' });
  let exitError = null;
  proc.on('exit', function (code, signal) {
    if (code !== 0 && code !== null) exitError = new Error('Chrome exited early: code ' + code + ' signal ' + signal);
  });

  let cdp = null;
  const userDataDir = profile;
  try {
    await waitForEndpoint(port, opts.timeoutMs || 9000);
    if (exitError) throw exitError;
    const targets = await httpJson('http://127.0.0.1:' + port + '/json/list', 1500);
    const pageTarget = targets.find(function (target) { return target.type === 'page'; }) || targets[0];
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) throw new Error('no page target from Chrome');

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
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (err) { /* ignore */ }
      cdp.close();
    }
    try { proc.kill('SIGKILL'); } catch (err) { /* ignore */ }
    await sleep(120);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  }
}
