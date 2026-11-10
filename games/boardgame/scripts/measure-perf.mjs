#!/usr/bin/env node
'use strict';

/*
 * Read-only performance measurement through the resident Chrome (CDP 9222).
 *
 *   node games/boardgame/scripts/measure-perf.mjs --url http://127.0.0.1:PORT/boardgame/<slug>/index.html --json /tmp/perf.json
 *
 * Opens one tab, waits for load, evaluates navigation/paint/resource timing,
 * then closes only that tab. The resident Chrome is never killed or restarted.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i !== -1 ? args[i + 1] : fallback;
};
const url = opt('url');
const out = opt('json', null);
const port = Number(opt('cdp-port', process.env.AUDIT_CDP_PORT || 9222));
if (!url) {
  console.error('usage: measure-perf.mjs --url <url> [--json file] [--cdp-port 9222]');
  process.exit(2);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function httpJson(pathname, method) {
  const res = await fetch('http://127.0.0.1:' + port + pathname, { method: method || 'GET' });
  const text = await res.text();
  try { return JSON.parse(text); } catch (err) { return text; }
}

async function main() {
  const tab = await httpJson('/json/new?' + encodeURIComponent(url), 'PUT');
  if (!tab || !tab.webSocketDebuggerUrl) throw new Error('cannot open tab: ' + JSON.stringify(tab).slice(0, 200));
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (err) { return; }
    if (msg.id != null) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result || {});
      return;
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].method === msg.method) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg.params || {});
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('devtools websocket failed')));
  });
  function send(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 20000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  function waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { method, resolve };
      w.timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i !== -1) waiters.splice(i, 1);
        reject(new Error('wait ' + method + ' timeout'));
      }, timeoutMs || 20000);
      waiters.push(w);
    });
  }
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    const loaded = waitFor('Page.loadEventFired', 20000);
    await send('Page.navigate', { url });
    await loaded;
    await sleep(900);
    const expression = `(function(){
      var nav = performance.getEntriesByType('navigation')[0] || {};
      var paints = {};
      performance.getEntriesByType('paint').forEach(function(p){ paints[p.name] = p.startTime; });
      var resources = performance.getEntriesByType('resource').map(function(r){
        return { name: r.name, type: r.initiatorType, bytes: r.transferSize || 0, duration: r.duration };
      });
      var external = resources.filter(function(r){ return /^https?:/.test(r.name) && r.name.indexOf(location.origin) !== 0; }).length;
      var imageBytes = resources.filter(function(r){ return /\\.(webp|png|jpe?g|avif)$/i.test(r.name); })
        .reduce(function(s,r){ return s + r.bytes; }, 0);
      return JSON.stringify({
        url: location.href,
        title: document.title,
        fcpMs: paints['first-contentful-paint'] || null,
        fpMs: paints['first-paint'] || null,
        domContentLoadedMs: nav.domContentLoadedEventEnd == null ? null : Math.round(nav.domContentLoadedEventEnd),
        loadEventEndMs: nav.loadEventEnd == null ? null : Math.round(nav.loadEventEnd),
        durationMs: nav.duration == null ? null : Math.round(nav.duration),
        domNodes: document.querySelectorAll('*').length,
        externalRequests: external,
        resourceCount: resources.length,
        materialBytes: imageBytes,
        resources: resources
      });
    })()`;
    const evalResult = await send('Runtime.evaluate', { expression, returnByValue: true });
    const value = evalResult.result && evalResult.result.value;
    if (!value) throw new Error('evaluation returned no value');
    const data = JSON.parse(value);
    data.generatedAt = new Date().toISOString();
    data.cdpPort = port;
    if (out) fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
    console.log(JSON.stringify({
      url: data.url, title: data.title, fcpMs: data.fcpMs, fpMs: data.fpMs,
      domContentLoadedMs: data.domContentLoadedMs, loadEventEndMs: data.loadEventEndMs,
      domNodes: data.domNodes, externalRequests: data.externalRequests,
      resourceCount: data.resourceCount, materialBytes: data.materialBytes
    }, null, 2));
  } finally {
    try { ws.close(); } catch (err) {}
    try { await httpJson('/json/close/' + tab.id, 'GET'); } catch (err) {}
  }
}
main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
