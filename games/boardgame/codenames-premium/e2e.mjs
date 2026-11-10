#!/usr/bin/env node
/* Codenames Premium browser smoke.
 *
 * Preferred path (per AGENTS.md):
 *   1. ~/.local/bin/chrome-ensure
 *   2. open one tab in the existing front Chrome window
 *   3. drive it with `urlrun tab js`, close only that tab
 *
 * If Chrome's "Allow JavaScript from Apple Events" is disabled, `urlrun tab`
 * cannot execute JS. In that case this script reuses an already-running
 * persistent Chrome with a DevTools endpoint (default 127.0.0.1:9222,
 * override with CHROME_CDP_PORT), creates one target, closes that target, and
 * never spawns a temporary Chrome or a temporary profile.
 *
 * The harness page (smoke.html) loads the real pages in iframes sized
 * 390x844, 320x568, 844x390 and 1024x768. All assertions are DOM/size/event
 * based; no screenshots, OCR or image analysis.
 */
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const CHROME_ENSURE = path.join(HOME, '.local/bin/chrome-ensure');
const URLRUN = path.join(HOME, '.local/bin/urlrun');
const CDP_PORT = Number(process.env.CHROME_CDP_PORT) || 9222;
const USE_URLRUN = process.env.USE_URLRUN === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : '';
    const stdout = err && err.stdout ? String(err.stdout).trim() : '';
    throw new Error((err && err.message || String(err)) + (stderr ? '\n' + stderr : '') + (stdout ? '\n' + stdout : ''));
  }
}
function osa(script) { return run('osascript', ['-e', script]); }
function osaStr(text) { return '"' + String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function openTab(url) {
  return osa([
    'tell application "Google Chrome"',
    '  if (count of windows) = 0 then error "Chrome has no window; open one Chrome window first."',
    '  set t to make new tab at end of front window with properties {URL:' + osaStr(url) + '}',
    '  set active tab index of front window to (count of tabs of front window)',
    '  return (count of tabs of front window)',
    'end tell'
  ].join('\n'));
}
function closeTabByUrl(prefix) {
  try {
    return osa([
      'tell application "Google Chrome"',
      '  if (count of windows) = 0 then return "no-window"',
      '  set win to front window',
      '  repeat with t in (tabs of win)',
      '    if (URL of t as text) starts with ' + osaStr(prefix) + ' then',
      '      close t',
      '      return "closed"',
      '    end if',
      '  end repeat',
      '  return "not-found"',
      'end tell'
    ].join('\n'));
  } catch (err) { return 'close-failed'; }
}
function parseLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) {}
  try {
    const once = JSON.parse(raw);
    if (typeof once === 'string') return JSON.parse(once);
    return once;
  } catch (err) {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (err) {}
  }
  return null;
}
function urlrunJs(expression) { return run(URLRUN, ['tab', 'js', expression]); }
function urlrunWorks() {
  try {
    const out = run(URLRUN, ['tab', 'js', '1+1']);
    return /^2(?:\.0)?$/.test(out.trim());
  } catch (err) { return false; }
}

async function runViaUrlrun(url, deadlineMs) {
  openTab(url);
  let state = null;
  let lastCurrent = '';
  const deadline = Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      await sleep(600);
      let out;
      try { out = urlrunJs('JSON.stringify(window.__smokeState)'); }
      catch (err) {
        throw new Error('urlrun tab js failed after a successful probe: ' + err.message);
      }
      state = parseLoose(out);
      if (!state) continue;
      if (state.current && state.current !== lastCurrent) {
        lastCurrent = state.current;
        console.log('smoke: ' + state.current + ' · ' + state.passed + ' passed, ' + state.failed + ' failed');
      }
      if (state.done) break;
    }
    if (!state || !state.done) throw new Error('smoke harness did not finish within ' + Math.round(deadlineMs / 1000) + 's');
    return state;
  } finally {
    const closed = closeTabByUrl(url);
    if (closed !== 'closed') console.log('smoke tab cleanup: ' + closed);
  }
}

async function cdpUrl() {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        return info.webSocketDebuggerUrl;
      }
    } catch (err) {}
    await sleep(300);
  }
  return null;
}

async function runViaPersistentCdp(url, deadlineMs) {
  const wsUrl = await cdpUrl();
  if (!wsUrl) {
    throw new Error('No persistent Chrome DevTools endpoint on 127.0.0.1:' + CDP_PORT +
      '. Start/reuse the persistent Chrome, or enable Apple Events JavaScript for urlrun tab. ' +
      'This script will not spawn a temporary Chrome/profile.');
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(p.method + ': ' + msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method && listeners.has(msg.method)) listeners.get(msg.method).forEach((fn) => fn(msg.params));
  });
  function send(method, params, sessionId) {
    const id = ++seq;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 20000);
    });
  }
  function on(method, fn) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
  }
  let targetId = null;
  let sessionId = null;
  const consoleErrors = [];
  try {
    const created = await send('Target.createTarget', { url: 'about:blank' }, undefined);
    targetId = created.targetId;
    const attached = await send('Target.attachToTarget', { targetId, flatten: true }, undefined);
    sessionId = attached.sessionId;
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value || a.description || a.type).join(' '));
    });
    on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push('exception: ' + (p.exceptionDetails && (p.exceptionDetails.text ||
        p.exceptionDetails.exception && p.exceptionDetails.exception.description) || ''));
    });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    }, sessionId);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    const loaded = new Promise((resolve) => on('Page.loadEventFired', resolve));
    await send('Page.navigate', { url }, sessionId);
    await Promise.race([loaded, sleep(10000)]);
    await sleep(600);
    let state = null;
    let lastCurrent = '';
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      const r = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__smokeState)',
        returnByValue: true
      }, sessionId);
      if (r.exceptionDetails) throw new Error('smoke evaluate: ' + r.exceptionDetails.text);
      state = parseLoose(r.result && r.result.value);
      if (state) {
        if (state.current && state.current !== lastCurrent) {
          lastCurrent = state.current;
          console.log('smoke: ' + state.current + ' · ' + state.passed + ' passed, ' + state.failed + ' failed');
        }
        if (state.done) break;
      }
      await sleep(600);
    }
    if (!state || !state.done) throw new Error('smoke harness did not finish within ' + Math.round(deadlineMs / 1000) + 's');
    if (consoleErrors.length) {
      state.results = (state.results || []).concat(consoleErrors.map((e) => ({ name: 'console error', ok: false, detail: e })));
      state.failed = (state.failed || 0) + consoleErrors.length;
    }
    return state;
  } finally {
    if (targetId) {
      try { await send('Target.closeTarget', { targetId }, undefined); } catch (err) {}
    }
    try { ws.close(); } catch (err) {}
  }
}

async function main() {
  const t0 = Date.now();
  try { run(CHROME_ENSURE, []); }
  catch (err) {
    console.error('chrome-ensure failed:', err.message);
    console.log('E2E RESULT: 0 passed, 1 failed');
    process.exitCode = 1;
    return;
  }

  const mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  const handle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 20000, aiDelayMs: 560 });
  const port = handle.address.port;
  const url = 'http://127.0.0.1:' + port + '/smoke.html';
  try {
    let mode = 'persistent-cdp-node';
    let state;
    if (USE_URLRUN && urlrunWorks()) {
      console.log('mode: persistent Chrome + urlrun tab (opt-in)');
      mode = 'urlrun-tab';
      state = await runViaUrlrun(url, 90000);
    } else {
      if (USE_URLRUN) console.log('USE_URLRUN=1 but urlrun tab is unavailable; using Node CDP.');
      console.log('mode: persistent Chrome CDP via Node (no python in the default chain)');
      state = await runViaPersistentCdp(url, 90000);
    }
    (state.results || []).forEach(function (r) {
      console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
    });
    const failed = (state.results || []).filter(function (r) { return !r.ok; });
    console.log('');
    console.log('smoke mode: ' + mode + ' · elapsed: ' + ((Date.now() - t0) / 1000).toFixed(2) + 's');
    console.log('E2E RESULT: ' + state.passed + ' passed, ' + state.failed + ' failed');
    if (failed.length || state.failed) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().then(function () {
  // Chrome DevTools/keep-alive sockets can keep Node's event loop alive for
  // ~20s after the assertions finish. This CLI owns no long-lived service
  // once main() settles, so exit with the assertion status.
  process.exit(process.exitCode || 0);
}).catch(function (err) {
  console.error('E2E ERROR:', err && err.stack || err);
  console.log('E2E RESULT: 0 passed, 1 failed');
  process.exit(1);
});
