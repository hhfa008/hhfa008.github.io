#!/usr/bin/env node
'use strict';

/*
 * Site-wide quality gate for every HTML page under games/.
 *
 *   node games/tests/site-quality.mjs                 # human readable
 *   node games/tests/site-quality.mjs --json          # machine readable summary
 *   node games/tests/site-quality.mjs --no-browser    # static checks only (diagnostic)
 *   node games/tests/site-quality.mjs --filter=play   # limit pages by path substring
 *   node games/tests/site-quality.mjs --write-baseline
 *
 * Zero dependencies. The only "external" tool is the local Chrome used through
 * the existing DevTools helper (games/boardgame/tests/lib/browser.mjs).
 *
 * Checks, per page:
 *   static   doctype / html / head / body / charset / viewport / title /
 *            description / canonical (absolute) / og:title / og:description /
 *            og:type / og:url / duplicate ids / img alt / script onerror
 *   browser  console error / uncaught exception / resource >=400 or load
 *            failure (auto favicon excluded unless explicitly linked) /
 *            focusable controls with an accessible name / WCAG contrast on a
 *            deterministic sample of up to 5 visible text elements.
 *
 * Historical problems are listed explicitly in site-quality-baseline.json
 * (path + code + reason). A baseline match is reported as WARN and does not
 * fail the gate; anything else fails. Stale baseline entries are reported too.
 *
 * The share-card E2E also lives here so a single run-all row covers it:
 *   card-battle.html -> finishForTest('win') -> generate PNG -> verify the
 *   data URL, PNG signature, 1080x1350 IHDR, >10KB size and download trigger.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from '../boardgame/play/serve.mjs';
import { findChrome, withChrome } from '../boardgame/tests/lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GAMES_DIR = path.join(ROOT, 'games');
const BASELINE_PATH = path.join(HERE, 'site-quality-baseline.json');
const ARTIFACTS_DIR = path.join(HERE, 'site-quality-artifacts');
// The progress file is a resume checkpoint shared by every checker process in
// this working tree. SITE_QUALITY_PROGRESS lets the concurrency self-test point
// the same save path at a scratch file without touching the real checkpoint.
const PROGRESS_PATH = process.env.SITE_QUALITY_PROGRESS
  ? path.resolve(process.env.SITE_QUALITY_PROGRESS)
  : path.join(HERE, 'site-quality-progress.json');
const SAMPLE_PATH = 'games/boardgame/play/card-battle.html';
const MAX_RSS_MB = 2048;
const PAGE_INTERVAL_MS = 25;
const SHARE_CARD_WIDTH = 1080;
const SHARE_CARD_HEIGHT = 1350;
const VIEWPORTS = [
  { width: 390, height: 844, label: '390x844' },
  { width: 320, height: 568, label: '320x568' }
];

const STATIC_CODES = [
  'doctype', 'html-root', 'head', 'body', 'charset', 'viewport', 'title',
  'description', 'canonical', 'canonical-not-absolute', 'og-title',
  'og-description', 'og-type', 'og-url', 'duplicate-id', 'img-alt',
  'script-onerror', 'status-invalid', 'mode-invalid'
];
const BROWSER_CODES = [
  'console-error', 'page-error', 'resource-error', 'focusable', 'contrast',
  'overflow-x', 'touch-target', 'font-size', 'cta-viewport'
];
const ALL_CODES = STATIC_CODES.concat(BROWSER_CODES);

function parseArgs(argv) {
  const opts = { json: false, browser: true, filter: null, writeBaseline: false, verbose: false, artifacts: true, resume: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--no-browser') opts.browser = false;
    else if (arg === '--write-baseline') opts.writeBaseline = true;
    else if (arg === '--no-artifacts') opts.artifacts = false;
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice(9);
    else if (arg === '--filter') opts.filter = argv[++i] || null;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node games/tests/site-quality.mjs [--json] [--no-browser] [--filter=path] [--write-baseline]');
      process.exit(0);
    }
  }
  return opts;
}

function walkHtml(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function pageUrl(file) {
  return '/' + rel(file).split('/').map(encodeURIComponent).join('/');
}

function oneLine(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 320);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function stripScriptsAndStyles(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

function metaContent(html, attr, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const a = tag.match(new RegExp('\\b' + attr + '\\s*=\\s*["\']?([^"\'\\s>]+)', 'i'));
    if (!a || a[1].toLowerCase() !== key.toLowerCase()) continue;
    const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return c ? decodeEntities(c[1] != null ? c[1] : (c[2] != null ? c[2] : c[3])) : '';
  }
  return null;
}

function linkHref(html, relName) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const a = tag.match(/\brel\s*=\s*["']?([^"'\s>]+)/i);
    if (!a || a[1].toLowerCase() !== relName) continue;
    const h = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return h ? decodeEntities(h[1] != null ? h[1] : (h[2] != null ? h[2] : h[3])) : '';
  }
  return null;
}

function staticIssues(file) {
  const html = fs.readFileSync(file, 'utf8');
  const markup = stripScriptsAndStyles(html);
  const issues = [];

  if (!/^\s*<!doctype\s+html\b/i.test(html)) {
    issues.push({ code: 'doctype', detail: 'missing <!doctype html>' });
  }
  if (!/<html\b/i.test(html)) issues.push({ code: 'html-root', detail: 'missing <html>' });
  if (!/<head\b/i.test(html)) issues.push({ code: 'head', detail: 'missing <head>' });
  if (!/<body\b/i.test(html)) issues.push({ code: 'body', detail: 'missing <body>' });

  const charset = metaContent(html, 'charset', 'utf-8');
  if (!/<meta\b[^>]*\bcharset\s*=/i.test(html)) {
    issues.push({ code: 'charset', detail: 'missing <meta charset>' });
  }
  const viewport = metaContent(html, 'name', 'viewport');
  if (viewport == null || viewport.trim() === '') {
    issues.push({ code: 'viewport', detail: 'missing viewport meta' });
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  if (!title) issues.push({ code: 'title', detail: 'missing or empty <title>' });

  const description = metaContent(html, 'name', 'description');
  if (description == null || description.trim() === '') {
    issues.push({ code: 'description', detail: 'missing or empty meta description' });
  }

  const canonical = linkHref(html, 'canonical');
  if (canonical == null) {
    issues.push({ code: 'canonical', detail: 'missing <link rel="canonical">' });
  } else if (!/^https?:\/\/[^/\s]+/i.test(canonical)) {
    issues.push({ code: 'canonical-not-absolute', detail: 'canonical is not an absolute URL: ' + canonical });
  }

  for (const key of ['og:title', 'og:description', 'og:type', 'og:url']) {
    const value = metaContent(html, 'property', key);
    if (value == null || value.trim() === '') {
      issues.push({ code: key, detail: 'missing or empty <meta property="' + key + '">' });
    }
  }

  const ids = [];
  const idRe = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = idRe.exec(markup)) !== null) {
    const id = match[1] != null ? match[1] : (match[2] != null ? match[2] : match[3]);
    if (id && id.trim()) ids.push(id.trim());
  }
  const seen = new Set();
  const duplicates = new Set();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  if (duplicates.size) {
    issues.push({ code: 'duplicate-id', detail: 'duplicate id(s): ' + Array.from(duplicates).slice(0, 5).join(', ') });
  }

  const imgTags = markup.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgTags.filter((tag) => !/\balt\s*=/i.test(tag));
  if (noAlt.length) {
    issues.push({
      code: 'img-alt',
      detail: noAlt.length + ' <img> without alt: ' + oneLine(noAlt[0], 120)
    });
  }

  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  const onerrorScripts = scriptTags.filter((tag) => /\bonerror\s*=/i.test(tag));
  if (onerrorScripts.length) {
    issues.push({
      code: 'script-onerror',
      detail: onerrorScripts.length + ' loading script(s) with onerror: ' + oneLine(onerrorScripts[0], 120)
    });
  }

  // Ship/draft markers. Missing status means draft (never shipped by default).
  const statusRaw = metaContent(html, 'name', 'game-status');
  let status = 'draft';
  if (statusRaw != null) {
    const value = String(statusRaw).trim().toLowerCase();
    if (value === 'shipped' || value === 'draft') status = value;
    else issues.push({ code: 'status-invalid', detail: 'game-status must be shipped|draft, got ' + statusRaw });
  }

  // Game mode marker. Missing mode is unknown and therefore cannot ship.
  const modeRaw = metaContent(html, 'name', 'game-mode');
  let mode = '';
  if (modeRaw != null) {
    const value = String(modeRaw).trim().toLowerCase();
    if (value === 'multiplayer' || value === 'multi' || value === 'online') mode = 'multiplayer';
    else if (value === 'single-player' || value === 'single' || value === 'solo') mode = 'single-player';
    else issues.push({ code: 'mode-invalid', detail: 'game-mode must be multiplayer|single-player, got ' + modeRaw });
  }

  const markers = {
    process: (metaContent(html, 'name', 'game-process') || '').trim().toLowerCase(),
    art: (metaContent(html, 'name', 'game-art') || '').trim().toLowerCase(),
    realism: (metaContent(html, 'name', 'game-realism') || '').trim().toLowerCase(),
    mobile: (metaContent(html, 'name', 'game-mobile') || '').trim().toLowerCase(),
    multiplayer: (metaContent(html, 'name', 'game-multiplayer') || '').trim().toLowerCase()
  };
  const assets = {
    og: (metaContent(html, 'property', 'og:image') || '').trim(),
    cover: (metaContent(html, 'name', 'game-cover') || '').trim(),
    detail: (metaContent(html, 'name', 'game-image') || '').trim()
  };

  return {
    html,
    title,
    issues,
    status,
    mode,
    markers,
    assets,
    markupText: markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  };
}

function isGameEntry(pathName) {
  const NON_GAME_TOP = new Set(['boardgame', 'en', 'id', 'assets', 'shared', 'tests']);
  const NON_GAME_BOARDGAME = new Set([
    'play', 'demo', 'board', 'app', 'assets', 'collector', 'data', 'engine',
    'plugin', 'schema', 'server', 'tests'
  ]);
  let match = pathName.match(/^games\/boardgame\/([^/]+)\/index\.html$/);
  if (match) return !NON_GAME_BOARDGAME.has(match[1]);
  if (pathName === 'games/boardgame/play/card-battle.html' ||
    pathName === 'games/boardgame/play/mahjong.html') return true;
  match = pathName.match(/^games\/([^/]+)\/index\.html$/);
  if (match) return !NON_GAME_TOP.has(match[1]);
  return false;
}

function gameSlug(pathName) {
  let match = pathName.match(/^games\/boardgame\/play\/([^/]+)\.html$/);
  if (match) return match[1];
  match = pathName.match(/^games\/boardgame\/([^/]+)\/index\.html$/);
  if (match) return match[1];
  match = pathName.match(/^games\/([^/]+)\/index\.html$/);
  if (match) return match[1];
  return '';
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 &&
    buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: 'png' };
  }
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), type: 'gif' };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (marker === 0xda) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), type: 'jpeg' };
      }
      offset += 2 + length;
    }
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        type: 'webp'
      };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
        type: 'webp'
      };
    }
  }
  return null;
}

function assetCheck(htmlFile, url, kind, minWidth, minHeight, minBytes) {
  if (!url) return { ok: false, detail: kind + ' is missing' };
  if (/^data:/i.test(url)) return { ok: false, detail: kind + ' is a data: placeholder' };
  let local = null;
  let cleaned = String(url).split(/[?#]/)[0];
  if (/^https?:\/\//i.test(cleaned)) {
    const sameSite = cleaned.match(/^https?:\/\/hhfa008\.github\.io\/games\/(.+)$/i);
    if (!sameSite) return { ok: false, detail: kind + ' is an external URL: ' + cleaned };
    local = path.join(ROOT, 'games', sameSite[1]);
  } else if (cleaned.charAt(0) === '/') {
    local = path.join(ROOT, cleaned.replace(/^\/+/, ''));
  } else {
    local = path.resolve(path.dirname(htmlFile), cleaned);
  }
  if (!fs.existsSync(local)) return { ok: false, detail: kind + ' file not found: ' + rel(local) };
  let stat = null;
  try { stat = fs.statSync(local); } catch (err) { return { ok: false, detail: kind + ' unreadable: ' + rel(local) }; }
  if (!stat.isFile()) return { ok: false, detail: kind + ' is not a file: ' + rel(local) };
  if (stat.size < minBytes) {
    return { ok: false, detail: kind + ' placeholder too small: ' + rel(local) + ' (' + stat.size + ' bytes)' };
  }
  let buffer = null;
  try { buffer = fs.readFileSync(local); } catch (err) {
    return { ok: false, detail: kind + ' unreadable: ' + rel(local) };
  }
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
  if (/<svg[\s>]/i.test(head)) {
    const viewBox = head.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
    const attrs = head.match(/<svg\b[^>]*>/i);
    let width = viewBox ? Number(viewBox[1]) : 0;
    let height = viewBox ? Number(viewBox[2]) : 0;
    if ((!width || !height) && attrs) {
      const w = attrs[0].match(/\bwidth\s*=\s*["']([\d.]+)/i);
      const h = attrs[0].match(/\bheight\s*=\s*["']([\d.]+)/i);
      if (w) width = Number(w[1]);
      if (h) height = Number(h[1]);
    }
    if (width && height && (width < minWidth || height < minHeight)) {
      return { ok: false, detail: kind + ' SVG too small: ' + width + 'x' + height + ' (' + rel(local) + ')' };
    }
    return { ok: true, detail: kind + ' svg ' + (width ? width + 'x' + height : 'dimensionless') + ' ' + stat.size + ' bytes' };
  }
  const dims = imageDimensions(buffer);
  if (!dims) {
    return { ok: true, detail: kind + ' ' + stat.size + ' bytes (dimensions not parsed)' };
  }
  if (dims.width <= 1 || dims.height <= 1) {
    return { ok: false, detail: kind + ' 1x1 placeholder: ' + rel(local) };
  }
  if (dims.width < minWidth || dims.height < minHeight) {
    return { ok: false, detail: kind + ' too small: ' + dims.width + 'x' + dims.height + ' (' + rel(local) + ')' };
  }
  return { ok: true, detail: kind + ' ' + dims.type + ' ' + dims.width + 'x' + dims.height + ' ' + stat.size + ' bytes' };
}

function loadMultiplayerEvidence() {
  const file = path.join(ROOT, 'games', 'boardgame', 'tests', 'multiplayer-evidence.json');
  const out = { map: new Map(), error: null };
  if (!fs.existsSync(file)) {
    out.error = 'games/boardgame/tests/multiplayer-evidence.json missing';
    return out;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const games = raw && raw.games ? raw.games : {};
    Object.keys(games).forEach(function (slug) {
      out.map.set(slug, games[slug]);
    });
  } catch (err) {
    out.error = 'multiplayer-evidence.json invalid JSON: ' + err.message;
  }
  return out;
}

function multiplayerEvidenceFor(slug, evidence) {
  const entry = evidence.map.get(slug);
  if (!entry) {
    return { ok: false, shippedOk: false, missing: ['no evidence entry for ' + slug], missingShipped: [], entry: null };
  }
  const missing = [];
  ['twoClients', 'sameRoom', 'stateSync', 'resultConsistent'].forEach(function (key) {
    if (entry[key] !== true) missing.push(key);
  });
  if (!entry.testFile) missing.push('testFile');
  else {
    const testPath = path.join(ROOT, entry.testFile);
    if (!fs.existsSync(testPath)) missing.push('testFile not found: ' + entry.testFile);
    else {
      const runAll = fs.readFileSync(path.join(HERE, 'run-all.js'), 'utf8');
      const base = path.basename(entry.testFile);
      if (runAll.indexOf(entry.testFile) === -1 && runAll.indexOf(base) === -1) {
        missing.push('testFile not wired into run-all.js: ' + entry.testFile);
      }
    }
  }
  const missingShipped = [];
  ['crossDevice', 'aiMatchmaking', 'reconnect', 'trustee', 'leaderboard'].forEach(function (key) {
    if (entry[key] !== true) missingShipped.push(key);
  });
  return {
    ok: missing.length === 0,
    shippedOk: missing.length === 0 && missingShipped.length === 0,
    missing: missing,
    missingShipped: missingShipped,
    entry: entry
  };
}

function singlePlayerLabelPresent(staticResult) {
  return /单人/.test(staticResult.markupText || '');
}

function qualifyPage(pathName, staticResult, mobilePass, evidence) {
  if (!isGameEntry(pathName)) return null;
  const status = staticResult.status;
  const mode = staticResult.mode;
  const reasons = [];
  const failures = [];
  function add(code, detail) {
    reasons.push({ code: code, detail: detail });
    if (status === 'shipped') failures.push({ code: code, detail: detail });
  }
  if (!mode) add('shipped-marker', 'game-mode marker missing');
  if (mode === 'single-player' && !singlePlayerLabelPresent(staticResult)) {
    add('mode-label', 'single-player page has no visible 单人 label');
  }
  const specs = [
    ['og', 'og-image', 600, 315, 5000],
    ['cover', 'cover-image', 300, 200, 3000],
    ['detail', 'detail-image', 300, 200, 3000]
  ];
  specs.forEach(function (spec) {
    const check = assetCheck(path.join(ROOT, pathName), staticResult.assets[spec[0]], spec[1],
      spec[2], spec[3], spec[4]);
    if (!check.ok) add(spec[1], check.detail);
  });
  const markerKeys = ['process', 'art', 'realism', 'mobile'];
  if (mode === 'multiplayer') markerKeys.push('multiplayer');
  markerKeys.forEach(function (key) {
    if (staticResult.markers[key] !== 'validated') {
      add('shipped-marker', 'marker ' + key + ' is not validated');
    }
  });
  let multiplayer = { ok: true, shippedOk: true, missing: [], missingShipped: [], entry: null };
  if (mode === 'multiplayer') {
    multiplayer = multiplayerEvidenceFor(gameSlug(pathName), evidence);
    if (!multiplayer.ok) {
      add('multiplayer-evidence', 'multiplayer evidence incomplete: ' + multiplayer.missing.join(', '));
    } else if (!multiplayer.shippedOk) {
      add('multiplayer-shipped-evidence',
        'online multiplayer evidence incomplete: ' + multiplayer.missingShipped.join(', '));
    }
  }
  if (!mobilePass) add('mobile-smoke', 'one or both mobile viewports failed');
  const effectiveShipped = status === 'shipped' && reasons.length === 0;
  return {
    status: status,
    mode: mode || 'unknown',
    reasons: reasons,
    failures: failures,
    effectiveShipped: effectiveShipped,
    multiplayer: multiplayer
  };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { entries: [], map: new Map(), raw: null };
  }
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const map = new Map();
  for (const entry of entries) {
    if (!entry || !entry.path || !entry.code) {
      throw new Error('baseline entry needs path + code: ' + JSON.stringify(entry));
    }
    const key = entry.path + '::' + entry.code;
    if (map.has(key)) throw new Error('duplicate baseline entry: ' + key);
    map.set(key, entry);
  }
  return { entries, map, raw };
}

function newEvents() {
  return {
    console: [],
    page: [],
    responses: new Map(),
    failures: new Map()
  };
}

function attachTracker(page, eventsRef) {
  page.cdp.on(function (message) {
    if (message.sessionId) return;
    const events = eventsRef.current;
    if (!events) return;
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      events.console.push({
        text: (message.params.args || []).map(function (arg) {
          return arg.value != null ? String(arg.value) : (arg.description || arg.type);
        }).join(' '),
        url: ''
      });
    } else if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails || {};
      events.page.push(detail.text ||
        (detail.exception && detail.exception.description) || 'exception');
    } else if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry || {};
      if (entry.level === 'error') {
        events.console.push({ text: entry.text || 'log error', url: entry.url || '' });
      }
    } else if (message.method === 'Network.responseReceived') {
      const response = message.params.response || {};
      if (!/^(data|blob|about|file):/i.test(response.url || '')) {
        events.responses.set(message.params.requestId, {
          url: response.url,
          status: Number(response.status) || 0,
          type: message.params.type || ''
        });
      }
    } else if (message.method === 'Network.loadingFailed') {
      if (message.params.canceled) return;
      events.failures.set(message.params.requestId, {
        error: message.params.errorText || 'loadingFailed'
      });
    }
  });
}

function waitForLoad(page, timeoutMs) {
  return new Promise(function (resolve) {
    let done = false;
    function listener(message) {
      if (message.sessionId) return;
      if (message.method !== 'Page.loadEventFired') return;
      finish(true);
    }
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const index = page.cdp.listeners.indexOf(listener);
      if (index >= 0) page.cdp.listeners.splice(index, 1);
      resolve(value);
    }
    const timer = setTimeout(function () { finish(false); }, timeoutMs);
    page.cdp.on(listener);
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

const PAGE_AUDIT_EXPRESSION = `(function () {
  function visible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest('[inert]')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function accessibleName(el) {
    var label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var text = labelledby.split(/\\s+/).map(function (id) {
        var node = document.getElementById(id);
        return node ? node.textContent : '';
      }).join(' ').replace(/\\s+/g, ' ').trim();
      if (text) return text;
    }
    var own = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (own) return own;
    if (el.tagName === 'INPUT') {
      if (el.type === 'submit' || el.type === 'button' || el.type === 'reset') {
        return (el.value || el.getAttribute('value') || '').trim();
      }
      var ph = el.getAttribute('placeholder');
      if (ph && ph.trim()) return ph.trim();
    }
    if (el.tagName === 'IMG' && el.getAttribute('alt')) return el.getAttribute('alt');
    var title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '';
  }
  function inRovingGrid(el) {
    // A correct composite grid uses roving tabindex: exactly one cell is in
    // the tab order and arrow keys move focus between cells. Treat those
    // cells as reachable instead of demanding tabIndex >= 0 on all of them.
    if (el.getAttribute('role') !== 'gridcell') return false;
    var grid = el.closest('[role="grid"]');
    if (!grid) return false;
    var cells = grid.querySelectorAll('[role="gridcell"]');
    for (var i = 0; i < cells.length; i += 1) {
      if (cells[i] !== el && cells[i].tabIndex >= 0 && visible(cells[i])) return true;
    }
    return false;
  }
  function focusAudit() {
    var selector = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]';
    var elements = Array.prototype.slice.call(document.querySelectorAll(selector));
    var checked = 0;
    var bad = [];
    elements.forEach(function (el) {
      if (!visible(el)) return;
      if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
      var tag = el.tagName.toLowerCase();
      if (tag === 'a' && !el.hasAttribute('href')) return;
      checked += 1;
      var tabIndex = el.tabIndex;
      var name = accessibleName(el);
      var reachable = tabIndex >= 0 || inRovingGrid(el);
      if (!reachable || !name) {
        bad.push({
          tag: tag,
          id: el.id || '',
          cls: String(el.className || '').slice(0, 60),
          tabIndex: tabIndex,
          name: name.slice(0, 40)
        });
      }
    });
    return { checked: checked, bad: bad.slice(0, 6), badCount: bad.length };
  }

  function parseColor(value) {
    var match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);
    if (!match) return null;
    var parts = match[1].split(/[,/\\s]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(function (n) { return !isFinite(n); })) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  function composite(top, bottom) {
    var a = top[3];
    return [
      Math.round(top[0] * a + bottom[0] * (1 - a)),
      Math.round(top[1] * a + bottom[1] * (1 - a)),
      Math.round(top[2] * a + bottom[2] * (1 - a)),
      1
    ];
  }
  function luminance(rgb) {
    var values = [rgb[0], rgb[1], rgb[2]].map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  }
  function ratio(fg, bg) {
    var a = luminance(fg);
    var b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  function directText(el) {
    var text = '';
    for (var node = el.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) text += node.nodeValue;
    }
    return text.replace(/\\s+/g, ' ').trim();
  }
  function selectSample(items, count) {
    if (items.length <= count) return items.slice();
    var out = [];
    for (var i = 0; i < count; i += 1) {
      out.push(items[Math.round(i * (items.length - 1) / (count - 1))]);
    }
    return out;
  }
  function contrastAudit() {
    var skipTags = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1, SELECT: 1, TEXTAREA: 1, OPTION: 1 };
    var candidates = [];
    Array.prototype.slice.call(document.querySelectorAll('body *')).forEach(function (el) {
      if (skipTags[el.tagName]) return;
      if (!visible(el)) return;
      if (el.closest('[aria-hidden="true"]')) return;
      if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
      if (el.closest('button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled="true"]')) return;
      if (!directText(el)) return;
      candidates.push(el);
    });
    var sample = selectSample(candidates, 5);
    var results = [];
    sample.forEach(function (el) {
      var cs = getComputedStyle(el);
      // A transient inline opacity is an entrance animation (or a scripted
      // state change), not a static design token. Sampling it makes contrast
      // flaky, so leave it to the artifact and the final settled layout.
      var opacityCursor = el;
      var inlineOpacity = null;
      while (opacityCursor && opacityCursor.nodeType === 1) {
        if (opacityCursor.style && opacityCursor.style.opacity !== '') {
          inlineOpacity = opacityCursor.style.opacity;
          break;
        }
        opacityCursor = opacityCursor.parentElement;
      }
      if (inlineOpacity !== null) {
        results.push({ skipped: 'inline opacity ' + inlineOpacity, tag: el.tagName.toLowerCase(), id: el.id || '' });
        return;
      }
      var fg = parseColor(cs.webkitTextFillColor || cs.color);
      if (!fg || fg[3] === 0) {
        results.push({ skipped: 'transparent text', tag: el.tagName.toLowerCase(), id: el.id || '' });
        return;
      }
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
        results.push({ skipped: 'mix-blend-mode', tag: el.tagName.toLowerCase(), id: el.id || '' });
        return;
      }
      var opacity = 1;
      var node = el;
      while (node && node.nodeType === 1) {
        opacity *= Number(getComputedStyle(node).opacity) || 1;
        node = node.parentElement;
      }
      var layers = [];
      var backgroundUnknown = false;
      var cursor = el;
      var opaque = null;
      while (cursor) {
        var style = getComputedStyle(cursor);
        if (style.backgroundImage && style.backgroundImage !== 'none') backgroundUnknown = true;
        var color = parseColor(style.backgroundColor);
        if (!color) { backgroundUnknown = true; break; }
        layers.push(color);
        if (color[3] >= 1) { opaque = color; break; }
        cursor = cursor.parentElement;
      }
      if (backgroundUnknown) {
        results.push({ skipped: 'background-image or unparsable background', tag: el.tagName.toLowerCase(), id: el.id || '' });
        return;
      }
      var bg = opaque || [255, 255, 255, 1];
      for (var i = layers.length - 1; i >= 0; i -= 1) bg = composite(layers[i], bg);
      var effectiveFg = [fg[0], fg[1], fg[2], fg[3] * opacity];
      var shownFg = composite(effectiveFg, bg);
      var size = parseFloat(cs.fontSize) || 16;
      var weight = cs.fontWeight;
      var bold = weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 700;
      var large = size >= 24 || (bold && size >= 18.66);
      var need = large ? 3.0 : 4.5;
      var value = ratio(shownFg, bg);
      results.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: String(el.className || '').slice(0, 60),
        text: directText(el).slice(0, 40),
        fontSize: Math.round(size * 10) / 10,
        bold: bold,
        large: large,
        ratio: Math.round(value * 100) / 100,
        need: need,
        pass: value + 0.0001 >= need,
        fg: 'rgb(' + shownFg.slice(0, 3).join(',') + ')',
        bg: 'rgb(' + bg.slice(0, 3).join(',') + ')'
      });
    });
    var assessed = results.filter(function (item) { return !item.skipped; });
    return {
      checked: assessed.length,
      skipped: results.length - assessed.length,
      bad: assessed.filter(function (item) { return !item.pass; }).slice(0, 6),
      badCount: assessed.filter(function (item) { return !item.pass; }).length
    };
  }

  function mobileAudit() {
    var de = document.documentElement;
    var vw = de.clientWidth || window.innerWidth;
    var vh = window.innerHeight || de.clientHeight;
    var sw = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);

    var touchSelector = 'header button, header a.brand, main button, main a.btn, main a.cta, ' +
      'main [role=button], main input:not([type=hidden]), main select, main textarea';
    var controls = Array.prototype.slice.call(document.querySelectorAll(touchSelector));
    var touchChecked = 0;
    var touchBad = [];
    controls.forEach(function (el) {
      if (!visible(el)) return;
      if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
      // Dense game boards are a single composite widget; individual cells
      // cannot be 44x44 on a 320px screen. Their size is recorded in the
      // artifact, but they are not independent touch targets.
      if (el.matches('[role="gridcell"], .cell, .mjx-tile')) return;
      touchChecked += 1;
      var rect = el.getBoundingClientRect();
      if (rect.width + 0.5 < 44 || rect.height + 0.5 < 44) {
        touchBad.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: String(el.className || '').slice(0, 50),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30)
        });
      }
    });

    var bodySize = document.body ? parseFloat(getComputedStyle(document.body).fontSize) : 16;
    var mainEl = document.querySelector('main') || document.body;
    var mainSize = mainEl ? parseFloat(getComputedStyle(mainEl).fontSize) : bodySize;
    var textEls = Array.prototype.slice.call(document.querySelectorAll('p, li, dd, dt, td, th, blockquote, .lede'));
    var minText = null;
    var minTextTag = '';
    textEls.forEach(function (el) {
      if (!visible(el)) return;
      if (el.closest('[aria-hidden="true"]')) return;
      if (!directText(el)) return;
      var size = parseFloat(getComputedStyle(el).fontSize);
      if (minText === null || size < minText) {
        minText = size;
        minTextTag = el.tagName.toLowerCase();
      }
    });
    var fontPass = bodySize >= 13.99 && mainSize >= 13.99 && (minText === null || minText >= 12);

    function textOf(el) {
      return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    }
    function pickCta(selector, allowDisabled) {
      var list = Array.prototype.slice.call(document.querySelectorAll(selector));
      for (var i = 0; i < list.length; i += 1) {
        var el = list[i];
        if (!visible(el)) continue;
        if (!allowDisabled && (el.disabled === true || el.getAttribute('aria-disabled') === 'true')) continue;
        return el;
      }
      return null;
    }
    var ctaEl = pickCta('main a.cta, main button.primary, main .btn.primary, main [data-cta]', true) ||
      pickCta('main a.btn, main button', true) ||
      pickCta('main a.cta, main button.primary, main .btn.primary, main [data-cta]', false) ||
      pickCta('main a.btn, main button', false);
    var cta = null;
    if (ctaEl) {
      var rect = ctaEl.getBoundingClientRect();
      var inFirstScreen = rect.bottom > 0 && rect.top < vh;
      var verticalOk = rect.top >= 0 && rect.top <= vh * 0.8;
      var horizontalOk = rect.left >= 0 && rect.right <= vw + 1;
      cta = {
        tag: ctaEl.tagName.toLowerCase(),
        text: textOf(ctaEl),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        viewportHeight: vh,
        inFirstScreen: inFirstScreen,
        verticalOk: verticalOk,
        horizontalOk: horizontalOk,
        pass: Boolean(inFirstScreen && verticalOk && horizontalOk)
      };
    }

    return {
      viewport: { width: vw, height: vh },
      scroll: { scrollWidth: sw, clientWidth: vw, overflow: sw > vw + 1 },
      touch: { checked: touchChecked, violations: touchBad.slice(0, 8), badCount: touchBad.length },
      font: { bodySize: bodySize, mainSize: mainSize, minText: minText, minTextTag: minTextTag, pass: fontPass },
      cta: cta
    };
  }

  var icons = Array.prototype.slice.call(document.querySelectorAll('link[rel~="icon"]')).map(function (link) {
    return link.href || '';
  });
  return {
    url: location.href,
    icons: icons,
    focus: focusAudit(),
    contrast: contrastAudit(),
    mobile: mobileAudit()
  };
})()`;

function faviconExplicitlyLinked(url, icons) {
  if (!/\/favicon\.ico(?:[?#]|$)/i.test(url)) return true;
  return (icons || []).some(function (href) {
    return /\/favicon\.ico(?:[?#]|$)/i.test(href);
  });
}

function browserIssues(results, pathName) {
  const issues = [];
  const primary = results[0];
  const primaryAudit = primary.audit;

  const consoleSeen = new Set();
  const consoleErrors = [];
  results.forEach(function (result) {
    result.events.console.forEach(function (item) {
      const text = typeof item === 'string' ? item : item.text;
      const url = typeof item === 'string' ? '' : (item.url || '');
      const key = text + '|' + url;
      if (consoleSeen.has(key)) return;
      consoleSeen.add(key);
      if (/favicon\.ico/i.test(url) && !faviconExplicitlyLinked(url, result.audit.icons)) return;
      if (/favicon\.ico/i.test(text) &&
        !faviconExplicitlyLinked((text.match(/https?:\/\/[^\s"']+/) || [''])[0], result.audit.icons)) return;
      consoleErrors.push({ text: text, viewport: result.viewport.label });
    });
  });
  if (consoleErrors.length) {
    issues.push({
      code: 'console-error',
      detail: consoleErrors.length + ' console error(s): ' +
        oneLine(consoleErrors.slice(0, 3).map(function (item) {
          return item.viewport + ' ' + item.text;
        }).join(' | '))
    });
  }

  const pageSeen = new Set();
  const pageErrors = [];
  results.forEach(function (result) {
    result.events.page.forEach(function (text) {
      if (pageSeen.has(text)) return;
      pageSeen.add(text);
      pageErrors.push({ text: text, viewport: result.viewport.label });
    });
  });
  if (pageErrors.length) {
    issues.push({
      code: 'page-error',
      detail: pageErrors.length + ' uncaught exception(s): ' +
        oneLine(pageErrors.slice(0, 3).map(function (item) {
          return item.viewport + ' ' + item.text;
        }).join(' | '))
    });
  }

  const badResponses = [];
  const seenBad = new Set();
  results.forEach(function (result) {
    const icons = result.audit.icons || [];
    for (const response of result.events.responses.values()) {
      if (response.status < 400) continue;
      if (/\/favicon\.ico(?:[?#]|$)/i.test(response.url || '') &&
        !faviconExplicitlyLinked(response.url, icons)) continue;
      const key = response.url + '|' + response.status;
      if (seenBad.has(key)) continue;
      seenBad.add(key);
      badResponses.push({ url: response.url, status: response.status, viewport: result.viewport.label });
    }
    for (const [requestId, failure] of result.events.failures.entries()) {
      if (/ERR_ABORTED/i.test(failure.error)) continue;
      const response = result.events.responses.get(requestId);
      const url = response ? response.url : '';
      if (!url) continue;
      if (/\/favicon\.ico(?:[?#]|$)/i.test(url) && !faviconExplicitlyLinked(url, icons)) continue;
      const key = url + '|' + failure.error;
      if (seenBad.has(key)) continue;
      seenBad.add(key);
      badResponses.push({ url: url, status: 0, error: failure.error, viewport: result.viewport.label });
    }
  });
  if (badResponses.length) {
    issues.push({
      code: 'resource-error',
      detail: badResponses.length + ' failed resource(s): ' + oneLine(badResponses.slice(0, 4).map(function (item) {
        return item.viewport + ' ' + (item.status ? item.status : item.error) + ' ' + item.url;
      }).join(' | '), 560)
    });
  }

  const focusSeen = new Set();
  const focusBad = [];
  results.forEach(function (result) {
    (result.audit.focus && result.audit.focus.bad ? result.audit.focus.bad : []).forEach(function (item) {
      const key = [item.tag, item.id, item.cls, item.name, item.tabIndex].join('|');
      if (focusSeen.has(key)) return;
      focusSeen.add(key);
      focusBad.push(item);
    });
  });
  if (focusBad.length) {
    const maxChecked = Math.max.apply(null, results.map(function (result) {
      return (result.audit.focus && result.audit.focus.checked) || 0;
    }));
    issues.push({
      code: 'focusable',
      detail: focusBad.length + ' visible control(s) not focusable or unnamed (checked up to ' +
        maxChecked + '): ' + oneLine(focusBad.slice(0, 6).map(function (item) {
          return item.tag + (item.id ? '#' + item.id : '') +
            ' tabIndex=' + item.tabIndex + ' name=' + JSON.stringify(item.name);
        }).join(' | '), 560)
    });
  }

  const contrast = primaryAudit.contrast;
  if (contrast && contrast.badCount) {
    issues.push({
      code: 'contrast',
      detail: contrast.badCount + ' of ' + contrast.checked + ' sampled text element(s) below WCAG AA: ' +
        oneLine(contrast.bad.map(function (item) {
          return item.tag + (item.id ? '#' + item.id : '') + ' ' + item.ratio + ':1 < ' + item.need +
            ':1 (' + item.fontSize + 'px' + (item.bold ? ' bold' : '') + ', ' + item.fg + ' on ' + item.bg +
            ', "' + item.text + '")';
        }).join(' | '), 700)
    });
  }

  const overflow = [];
  results.forEach(function (result) {
    const mobile = result.audit.mobile;
    if (mobile && mobile.scroll && mobile.scroll.overflow) {
      overflow.push(result.viewport.label + ' scrollWidth=' + mobile.scroll.scrollWidth +
        ' > clientWidth=' + mobile.scroll.clientWidth);
    }
  });
  if (overflow.length) {
    issues.push({ code: 'overflow-x', detail: oneLine(overflow.join(' | ')) });
  }

  const touch = [];
  results.forEach(function (result) {
    const mobile = result.audit.mobile;
    if (!mobile || !mobile.touch || !mobile.touch.badCount) return;
    touch.push(result.viewport.label + ' ' + mobile.touch.badCount + '/' + mobile.touch.checked +
      ' control(s) <44x44: ' + mobile.touch.violations.slice(0, 5).map(function (item) {
        return item.tag + (item.id ? '#' + item.id : '') + ' ' + item.width + 'x' + item.height +
          ' "' + item.text + '"';
      }).join(', '));
  });
  if (touch.length) {
    issues.push({ code: 'touch-target', detail: oneLine(touch.join(' | '), 700) });
  }

  const fonts = [];
  results.forEach(function (result) {
    const font = result.audit.mobile && result.audit.mobile.font;
    if (!font || font.pass) return;
    fonts.push(result.viewport.label + ' body=' + font.bodySize + 'px main=' + font.mainSize +
      'px minText=' + (font.minText == null ? 'n/a' : font.minText + 'px ' + font.minTextTag));
  });
  if (fonts.length) {
    issues.push({ code: 'font-size', detail: oneLine(fonts.join(' | ')) });
  }

  const cta = [];
  const ctaApplies = isGameEntry(pathName);
  if (ctaApplies) {
    results.forEach(function (result) {
      const mobile = result.audit.mobile;
      if (!mobile || !mobile.cta || mobile.cta.pass) return;
      const item = mobile.cta;
      cta.push(result.viewport.label + ' ' + item.tag + ' "' + item.text + '" top=' + item.top +
        'px (limit ' + Math.round(item.viewportHeight * 0.8) + 'px) left=' + item.left +
        ' width=' + item.width + ' height=' + item.height +
        (item.horizontalOk ? '' : ' horizontal-overflow') +
        (item.inFirstScreen ? '' : ' below-first-screen'));
    });
  }
  if (cta.length) {
    issues.push({ code: 'cta-viewport', detail: oneLine(cta.join(' | '), 700) });
  }

  return issues;
}

async function auditAtViewport(page, url, viewport, eventsRef) {
  const startedAt = Date.now();
  await page.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: true
  });
  eventsRef.current = newEvents();
  const loaded = waitForLoad(page, 5000);
  try {
    await page.cdp.send('Page.navigate', { url: url });
  } catch (err) {
    eventsRef.current.page.push('navigation failed: ' + err.message);
  }
  const didLoad = await loaded;
  await sleep(140);
  let audit = {
    url: url,
    icons: [],
    focus: { checked: 0, bad: [], badCount: 0 },
    contrast: { checked: 0, bad: [], badCount: 0 },
    mobile: {
      viewport: { width: viewport.width, height: viewport.height },
      scroll: { scrollWidth: viewport.width, clientWidth: viewport.width, overflow: false },
      touch: { checked: 0, violations: [], badCount: 0 },
      font: { bodySize: 16, mainSize: 16, minText: null, minTextTag: '', pass: true },
      cta: null
    }
  };
  try {
    audit = await page.evaluate(PAGE_AUDIT_EXPRESSION);
  } catch (err) {
    eventsRef.current.page.push('audit evaluate failed: ' + err.message);
  }
  const events = eventsRef.current;
  eventsRef.current = null;
  return {
    viewport: viewport,
    audit: audit,
    events: events,
    loaded: didLoad,
    durationMs: Date.now() - startedAt
  };
}

async function auditPage(page, file, origin, eventsRef) {
  const url = origin + pageUrl(file);
  const results = [];
  for (const viewport of VIEWPORTS) {
    results.push(await auditAtViewport(page, url, viewport, eventsRef));
  }
  return results;
}

function shareCardChecks() {
  return {
    passed: 0,
    failed: 0,
    failures: []
  };
}

function runCheck(bucket, label, condition, detail) {
  if (condition) {
    bucket.passed += 1;
  } else {
    bucket.failed += 1;
    bucket.failures.push(label + (detail ? ' — ' + detail : ''));
  }
  return Boolean(condition);
}

async function shareCardE2E(page, origin) {
  const bucket = shareCardChecks();
  const url = origin + '/games/boardgame/play/card-battle.html';
  const loaded = waitForLoad(page, 6000);
  await page.cdp.send('Page.navigate', { url: url });
  await loaded;
  await sleep(200);

  const ready = await (async function () {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        if (await page.evaluate('Boolean(window.__battle)')) return true;
      } catch (err) { /* page may still be starting */ }
      await sleep(80);
    }
    return false;
  })();

  runCheck(bucket, 'card-battle exposes window.__battle', ready);
  if (!ready) return bucket;

  await page.evaluate('(function(){try{localStorage.clear();}catch(e){}return true;})()');
  const reloaded = waitForLoad(page, 6000);
  await page.cdp.send('Page.reload', { ignoreCache: true });
  await reloaded;
  await sleep(200);

  const readyAgain = await (async function () {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        if (await page.evaluate('Boolean(window.__battle && window.__battle.finishForTest)')) return true;
      } catch (err) { /* wait */ }
      await sleep(80);
    }
    return false;
  })();
  runCheck(bucket, 'card-battle ready after clean storage', readyAgain);
  if (!readyAgain) return bucket;

  await page.evaluate(`(function(){
    window.__downloads = [];
    if (!window.__anchorClickPatched) {
      window.__anchorClickPatched = true;
      var original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download')) {
          window.__downloads.push({ download: this.getAttribute('download'), href: this.href });
          return;
        }
        return original.apply(this, arguments);
      };
    }
    return true;
  })()`);

  const finished = await page.evaluate(
    'window.__battle.finishForTest("win", {durationMs:60000,turns:12,actions:40,remainingPrizes:2})');
  runCheck(bucket, 'finishForTest("win") records a match',
    Boolean(finished && finished.ok === true && finished.duplicate === false),
    finished ? JSON.stringify({ ok: finished.ok, duplicate: finished.duplicate }) : 'null');

  const panelVisible = await (async function () {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try {
        if (await page.evaluate('(function(){var p=document.getElementById("result-panel");return Boolean(p&&!p.hidden);})()')) return true;
      } catch (err) { /* wait */ }
      await sleep(60);
    }
    return false;
  })();
  runCheck(bucket, 'result panel visible', panelVisible);

  const clicked = await page.evaluate('(function(){var b=document.getElementById("rr-card");if(!b)return false;b.click();return true;})()');
  runCheck(bucket, 'share-card button exists and clicks', clicked);

  const card = await (async function () {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const value = await page.evaluate('window.__shareCard || null');
        if (value && value.dataURL) return value;
      } catch (err) { /* wait */ }
      await sleep(100);
    }
    return null;
  })();

  runCheck(bucket, 'window.__shareCard exposed', Boolean(card));
  if (!card) return bucket;

  runCheck(bucket, 'data URL is image/png',
    typeof card.dataURL === 'string' && card.dataURL.indexOf('data:image/png') === 0,
    String(card.dataURL || '').slice(0, 40));
  runCheck(bucket, 'declared width/height are ' + SHARE_CARD_WIDTH + 'x' + SHARE_CARD_HEIGHT,
    card.width === SHARE_CARD_WIDTH && card.height === SHARE_CARD_HEIGHT,
    card.width + 'x' + card.height);
  runCheck(bucket, 'declared bytes > 10KB', Number(card.bytes) > 10 * 1024, String(card.bytes));

  let buffer = null;
  try {
    const base64 = String(card.dataURL).split(',')[1] || '';
    buffer = Buffer.from(base64, 'base64');
  } catch (err) {
    buffer = null;
  }
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  runCheck(bucket, 'PNG signature is valid',
    Boolean(buffer && buffer.length >= 24 && buffer.subarray(0, 8).equals(pngMagic)),
    buffer ? buffer.subarray(0, 8).toString('hex') : 'no bytes');
  let ihdrWidth = 0;
  let ihdrHeight = 0;
  if (buffer && buffer.length >= 24) {
    ihdrWidth = buffer.readUInt32BE(16);
    ihdrHeight = buffer.readUInt32BE(20);
  }
  runCheck(bucket, 'PNG IHDR is ' + SHARE_CARD_WIDTH + 'x' + SHARE_CARD_HEIGHT,
    ihdrWidth === SHARE_CARD_WIDTH && ihdrHeight === SHARE_CARD_HEIGHT,
    ihdrWidth + 'x' + ihdrHeight);
  runCheck(bucket, 'PNG bytes > 10KB', Boolean(buffer && buffer.length > 10 * 1024),
    buffer ? buffer.length + ' bytes' : 'no bytes');

  const downloads = await page.evaluate('window.__downloads || []');
  const lastDownload = Array.isArray(downloads) && downloads.length ? downloads[downloads.length - 1] : null;
  runCheck(bucket, 'download anchor triggered', Boolean(lastDownload), JSON.stringify(downloads));
  runCheck(bucket, 'download filename ends with .png',
    Boolean(lastDownload && /\.png$/i.test(lastDownload.download || '')),
    lastDownload && lastDownload.download);

  const snapshot = await page.evaluate('window.__battle.snapshot()');
  const matchId = snapshot && snapshot.lastMatch ? snapshot.lastMatch.matchId : '';
  runCheck(bucket, 'card carries the current match id',
    Boolean(card.matchId && matchId && card.matchId === matchId),
    JSON.stringify({ card: card.matchId, match: matchId }));
  runCheck(bucket, 'card carries the win result and a positive score',
    card.result === 'win' && Number(card.score) > 0,
    JSON.stringify({ result: card.result, score: card.score }));

  const cardText = Array.isArray(card.text) ? card.text.join(' ') : '';
  const deviceId = snapshot && snapshot.deviceId ? String(snapshot.deviceId) : '';
  runCheck(bucket, 'card text contains no device id',
    !deviceId || cardText.indexOf(deviceId) === -1,
    deviceId ? 'device id length ' + deviceId.length : 'no device id');

  console.log('site-quality: share-card png=' + ihdrWidth + 'x' + ihdrHeight +
    ', bytes=' + (buffer ? buffer.length : 0) +
    ', signature=' + (buffer && buffer.subarray(0, 8).equals(pngMagic) ? 'ok' : 'bad') +
    ', download=' + (lastDownload ? 'ok' : 'missing'));

  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'share-card.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'games/boardgame/play/card-battle.html',
      width: ihdrWidth,
      height: ihdrHeight,
      bytes: buffer ? buffer.length : 0,
      dataUrlPrefix: String(card.dataURL || '').slice(0, 22),
      pngSignature: buffer && buffer.subarray(0, 8).equals(pngMagic) ? 'ok' : 'bad',
      downloadTriggered: Boolean(lastDownload),
      downloadFile: lastDownload ? lastDownload.download : null,
      matchId: card.matchId,
      result: card.result,
      score: card.score,
      textContainsDeviceId: Boolean(deviceId && cardText.indexOf(deviceId) !== -1)
    }, null, 2) + '\n');
  } catch (err) {
    console.log('site-quality: could not write share-card.json: ' + err.message);
  }

  return bucket;
}

function printIssueGroups(title, issues, limit) {
  if (!issues.length) return;
  console.log('');
  console.log(title + ' (' + issues.length + '):');
  issues.slice(0, limit || 200).forEach(function (issue) {
    console.log('  ' + issue.path + ':' + issue.code + ':' + oneLine(issue.detail, 520));
  });
  if (issues.length > (limit || 200)) {
    console.log('  ... ' + (issues.length - (limit || 200)) + ' more');
  }
}

function codeSummary(issues) {
  const counts = {};
  issues.forEach(function (issue) { counts[issue.code] = (counts[issue.code] || 0) + 1; });
  return summaryCounts(counts);
}

function summaryCounts(counts) {
  return Object.keys(counts).sort().map(function (code) {
    return code + '=' + counts[code];
  }).join(', ');
}

function artifactFileName(pathName) {
  return pathName.replace(/[^A-Za-z0-9._-]+/g, '__') + '.json';
}

function buildArtifact(pathName, results, durationMs) {
  return {
    path: pathName,
    generatedAt: new Date().toISOString(),
    durationMs: durationMs,
    viewports: results.map(function (result) {
      const mobile = result.audit.mobile || {};
      const scroll = mobile.scroll || {};
      const touch = mobile.touch || { checked: 0, violations: [], badCount: 0 };
      const font = mobile.font || {};
      const focus = result.audit.focus || { checked: 0, badCount: 0 };
      const contrast = result.audit.contrast || { checked: 0, badCount: 0 };
      const responses = Array.from(result.events.responses.values());
      return {
        viewport: result.viewport,
        loaded: result.loaded,
        durationMs: result.durationMs,
        scrollWidth: scroll.scrollWidth,
        clientWidth: scroll.clientWidth,
        overflowX: Boolean(scroll.overflow),
        touch: {
          checked: touch.checked,
          badCount: touch.badCount,
          violations: touch.violations
        },
        font: {
          bodySize: font.bodySize,
          mainSize: font.mainSize,
          minText: font.minText,
          minTextTag: font.minTextTag,
          pass: font.pass
        },
        cta: mobile.cta || null,
        focus: { checked: focus.checked, badCount: focus.badCount },
        contrast: { checked: contrast.checked, badCount: contrast.badCount },
        consoleErrors: result.events.console.length,
        pageErrors: result.events.page.length,
        resourceFailures: responses.filter(function (item) { return item.status >= 400; }).length
      };
    })
  };
}

function writeArtifacts(artifacts, statusMap) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  let written = 0;
  for (const [pathName, artifact] of artifacts.entries()) {
    artifact.status = statusMap && statusMap.get(pathName) ? statusMap.get(pathName).status : 'draft';
    artifact.effectiveStatus = statusMap && statusMap.get(pathName)
      ? statusMap.get(pathName).effectiveStatus : 'draft';
    const file = path.join(ARTIFACTS_DIR, artifactFileName(pathName));
    fs.writeFileSync(file, JSON.stringify(artifact, null, 2) + '\n');
    written += 1;
  }
  return written;
}

function resolveLobbyHref(lobbyPath, href) {
  const cleaned = String(href).split(/[?#]/)[0];
  if (!cleaned) return null;
  let target = cleaned.charAt(0) === '/'
    ? path.resolve(ROOT, cleaned.replace(/^\/+/, ''))
    : path.resolve(ROOT, path.dirname(lobbyPath), cleaned);
  if (/\/$/.test(cleaned)) {
    target = path.join(target, 'index.html');
  } else if (!/\.html?$/i.test(cleaned)) {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    else target = path.join(target, 'index.html');
  }
  return fs.existsSync(target) ? target : null;
}

// Lobby links must be judged against the machine-readable status sources even
// when the filtered run did not audit the link target itself. Without this, a
// filtered sweep reports every shipped premium link as "not-audited".
function loadAuthoritativeLobbyStatus() {
  const map = new Map();
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/boardgame/catalog-status.json'), 'utf8'));
    (catalog.games || []).concat(catalog.extras || []).forEach(function (game) {
      if (game && game.slug) map.set('games/boardgame/' + game.slug + '/index.html', game.status);
    });
  } catch (err) { /* no catalog source: fall back to audited statusMap */ }
  try {
    const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/GAME_STATUS.json'), 'utf8'));
    (status.games || []).forEach(function (game) {
      if (game && game.slug) map.set('games/' + game.slug + '/index.html', game.status);
    });
  } catch (err) { /* no root status source: fall back to audited statusMap */ }
  return map;
}

function resourceSnapshot() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    at: new Date().toISOString(),
    rssMb: Math.round(memory.rss / 1024 / 1024 * 10) / 10,
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024 * 10) / 10,
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    loadAvg1: Math.round(os.loadavg()[0] * 100) / 100,
    freeMemMb: Math.round(os.freemem() / 1024 / 1024)
  };
}

function computeFingerprint(files) {
  const hash = crypto.createHash('sha1');
  files.forEach(function (file) {
    const stat = fs.statSync(file);
    hash.update(rel(file) + '|' + stat.size + '|' + stat.mtimeMs + '\n');
  });
  if (fs.existsSync(BASELINE_PATH)) {
    const stat = fs.statSync(BASELINE_PATH);
    hash.update('baseline|' + stat.size + '|' + stat.mtimeMs + '\n');
  }
  try {
    const self = fs.statSync(fileURLToPath(import.meta.url));
    hash.update('checker|' + self.size + '|' + self.mtimeMs + '\n');
  } catch (err) { /* ignore */ }
  return hash.digest('hex');
}

function loadProgress(fingerprint) {
  if (!fs.existsSync(PROGRESS_PATH)) return { progress: null, mismatch: false };
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    if (!raw || raw.version !== 1 || raw.fingerprint !== fingerprint || !raw.done) {
      return { progress: null, mismatch: true };
    }
    return { progress: raw, mismatch: false };
  } catch (err) {
    return { progress: null, mismatch: true };
  }
}

let progressWriteSeq = 0;

// Unique temp name per writer (pid + sequence). Two concurrent checkers sharing
// the same PROGRESS_PATH used to race on `site-quality-progress.json.tmp`: the
// first rename removed the file the second was about to rename, so the second
// crashed with ENOENT. Distinct temp files make the rename safe; the last
// writer wins the fixed progress path, which is all resume needs.
function saveProgress(progress) {
  progress.updatedAt = new Date().toISOString();
  progressWriteSeq += 1;
  const tmp = PROGRESS_PATH + '.' + process.pid + '.' + progressWriteSeq + '.tmp';
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(progress, null, 2) + '\n');
  try {
    fs.renameSync(tmp, PROGRESS_PATH);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* best effort */ }
    throw err;
  }
}

function writeArtifactOne(pathName, artifact, statusEntry) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  artifact.status = statusEntry ? statusEntry.status : 'draft';
  artifact.effectiveStatus = statusEntry ? statusEntry.effectiveStatus : 'draft';
  const file = path.join(ARTIFACTS_DIR, artifactFileName(pathName));
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2) + '\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const baseline = loadBaseline();
  const files = walkHtml(GAMES_DIR, []).filter(function (file) {
    if (!opts.filter) return true;
    return rel(file).indexOf(opts.filter) !== -1;
  });

  console.log('site-quality: root=' + ROOT);
  console.log('site-quality: pages=' + files.length + ', static checks/page=' + STATIC_CODES.length +
    ', browser checks/page=' + (opts.browser ? BROWSER_CODES.length : 0));

  let passed = 0;
  let failed = 0;
  let warnings = 0;
  const failures = [];
  const warningIssues = [];
  const usedBaseline = new Set();
  const shareResult = { passed: 0, failed: 0, failures: [] };
  let browserPages = 0;
  let browserVisits = 0;
  let contrastChecked = 0;
  const mobileOutcome = new Map();
  const staticResults = new Map();
  const statusMap = new Map();
  const evidence = loadMultiplayerEvidence();
  const draftReasonCounts = {};
  let draftPages = 0;
  let shippedPages = 0;
  let draftPreviewLinks = 0;
  let artifactsWritten = 0;

  const fingerprint = computeFingerprint(files);
  let progress = {
    version: 1,
    fingerprint: fingerprint,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    done: {},
    share: null
  };
  let resumedPages = 0;
  if (opts.resume) {
    const loaded = loadProgress(fingerprint);
    if (loaded.progress) {
      progress = loaded.progress;
      resumedPages = Object.keys(progress.done).length;
      console.log('site-quality: resume enabled, ' + resumedPages + ' page(s) already done');
    } else if (loaded.mismatch) {
      console.log('site-quality: resume ignored (page set or baseline changed), starting fresh');
    }
  }
  process.on('SIGINT', function () {
    try { saveProgress(progress); } catch (err) { /* ignore */ }
    console.log('\nsite-quality: interrupted; progress saved to ' + rel(PROGRESS_PATH));
    process.exit(130);
  });

  const pageAcc = {};
  let currentPage = null;

  function beginPage(pathName) {
    currentPage = pathName;
    pageAcc[pathName] = {
      passed: 0, failed: 0, warnings: 0,
      failures: [], warningIssues: [], baselineUsed: []
    };
  }

  function passCheck(pathName) {
    passed += 1;
    if (currentPage && pageAcc[currentPage]) pageAcc[currentPage].passed += 1;
  }

  function record(pathName, code, detail) {
    const key = pathName + '::' + code;
    const entry = baseline.map.get(key);
    if (entry) {
      usedBaseline.add(key);
      warnings += 1;
      const warning = { path: pathName, code: code, detail: detail, reason: entry.reason || '' };
      warningIssues.push(warning);
      if (currentPage && pageAcc[currentPage]) {
        pageAcc[currentPage].warnings += 1;
        pageAcc[currentPage].warningIssues.push(warning);
        pageAcc[currentPage].baselineUsed.push(key);
      }
    } else {
      failed += 1;
      const failure = { path: pathName, code: code, detail: detail };
      failures.push(failure);
      if (currentPage && pageAcc[currentPage]) {
        pageAcc[currentPage].failed += 1;
        pageAcc[currentPage].failures.push(failure);
      }
    }
  }

  function mergeDonePage(pathName, entry) {
    passed += entry.passed || 0;
    failed += entry.failed || 0;
    warnings += entry.warnings || 0;
    (entry.failures || []).forEach(function (item) { failures.push(item); });
    (entry.warningIssues || []).forEach(function (item) { warningIssues.push(item); });
    (entry.baselineUsed || []).forEach(function (key) { usedBaseline.add(key); });
    if (entry.status) {
      statusMap.set(pathName, entry.status);
      if (entry.status.effectiveStatus === 'shipped') {
        shippedPages += 1;
      } else {
        draftPages += 1;
        const seen = new Set();
        (entry.status.reasons || []).forEach(function (item) {
          if (seen.has(item.code)) return;
          seen.add(item.code);
          draftReasonCounts[item.code] = (draftReasonCounts[item.code] || 0) + 1;
        });
      }
    }
    if (fs.existsSync(path.join(ARTIFACTS_DIR, artifactFileName(pathName)))) {
      artifactsWritten += 1;
    }
  }

  function finishPage(pathName) {
    if (!pageAcc[pathName]) return;
    if (!opts.browser) { currentPage = null; return; }
    progress.done[pathName] = Object.assign({
      doneAt: new Date().toISOString(),
      status: statusMap.get(pathName) || null
    }, pageAcc[pathName]);
    saveProgress(progress);
    currentPage = null;
  }

  // Static pass. Kept separate so --no-browser still validates markup.
  for (const file of files) {
    const pathName = rel(file);
    if (opts.resume && progress.done[pathName]) {
      mergeDonePage(pathName, progress.done[pathName]);
      continue;
    }
    beginPage(pathName);
    const result = staticIssues(file);
    staticResults.set(pathName, result);
    const found = new Map();
    result.issues.forEach(function (issue) { found.set(issue.code, issue.detail); });
    for (const code of STATIC_CODES) {
      if (found.has(code)) record(pathName, code, found.get(code));
      else passCheck(pathName);
    }
    if (!opts.browser) finishPage(pathName);
  }
  currentPage = null;

  let shareFailure = null;
  const beforeResources = resourceSnapshot();
  let afterResources = null;
  let sampleFailed = false;

  if (opts.browser) {
    if (!findChrome()) {
      console.error('');
      console.error('site-quality: Chrome not found. Browser checks (console, resources, focus, contrast, share E2E) cannot run.');
      console.error('site-quality: set CHROME_PATH or install Chrome/Chromium, then retry.');
      failed += files.length * BROWSER_CODES.length;
      for (const file of files) {
        for (const code of BROWSER_CODES) {
          failures.push({ path: rel(file), code: code, detail: 'browser checks skipped: Chrome not found' });
        }
      }
    } else {
      const handle = await startServer({ port: 0, host: '127.0.0.1', root: ROOT });
      try {
        await withChrome('about:blank', async function (page) {
          await page.cdp.send('Emulation.setEmulatedMedia', {
            features: [
              { name: 'prefers-color-scheme', value: 'light' },
              // Freeze entrance animations so the contrast sample is stable
              // and reproducible instead of catching a fade-in frame.
              { name: 'prefers-reduced-motion', value: 'reduce' }
            ]
          });
          const eventsRef = { current: null };
          attachTracker(page, eventsRef);

          const pending = files.filter(function (file) {
            return !(opts.resume && progress.done[rel(file)]);
          });
          const sampleFile = files.find(function (file) { return rel(file) === SAMPLE_PATH; }) || pending[0];
          let processedSample = false;

          async function processBrowserPage(file) {
            const pathName = rel(file);
            if (opts.resume && progress.done[pathName]) return null;
            if (!pageAcc[pathName]) beginPage(pathName);
            currentPage = pathName;
            const pageStartedAt = Date.now();
            const results = await auditPage(page, file, handle.origin, eventsRef);
            browserPages += 1;
            browserVisits += results.length;
            contrastChecked += (results[0].audit.contrast && results[0].audit.contrast.checked) || 0;
            const issues = browserIssues(results, pathName);
            const found = new Map();
            issues.forEach(function (issue) { found.set(issue.code, issue.detail); });
            const staticResult = staticResults.get(pathName);
            const mobileCodes = ['overflow-x', 'touch-target', 'font-size', 'cta-viewport'];
            const draftGame = isGameEntry(pathName) && (!staticResult || staticResult.status !== 'shipped');
            for (const code of BROWSER_CODES) {
              if (!found.has(code)) {
                passCheck(pathName);
              } else if (draftGame && mobileCodes.indexOf(code) !== -1) {
                // A draft game does not ship; its mobile failures are draft
                // reasons, visible in the summary/artifact, not gate failures.
                draftReasonCounts[code] = (draftReasonCounts[code] || 0) + 1;
              } else {
                record(pathName, code, found.get(code));
              }
            }
            mobileOutcome.set(pathName, {
              pass: !issues.some(function (issue) {
                return mobileCodes.indexOf(issue.code) !== -1;
              }),
              issues: issues.filter(function (issue) {
                return mobileCodes.indexOf(issue.code) !== -1;
              })
            });

            // Shipped/draft qualification: process, art, realism, mobile and
            // multiplayer evidence. A draft page is reported, not failed.
            if (staticResult && isGameEntry(pathName)) {
              const mobile = mobileOutcome.get(pathName);
              const qualified = qualifyPage(pathName, staticResult, mobile ? mobile.pass : true, evidence);
              statusMap.set(pathName, {
                status: qualified.status,
                effectiveStatus: qualified.effectiveShipped ? 'shipped' : 'draft',
                mode: qualified.mode,
                reasons: qualified.reasons
              });
              if (qualified.status === 'shipped') {
                if (qualified.effectiveShipped) {
                  shippedPages += 1;
                  passCheck(pathName);
                } else {
                  qualified.failures.forEach(function (item) {
                    record(pathName, item.code, item.detail);
                  });
                }
              } else {
                draftPages += 1;
                const seen = new Set();
                qualified.reasons.forEach(function (item) {
                  if (seen.has(item.code)) return;
                  seen.add(item.code);
                  draftReasonCounts[item.code] = (draftReasonCounts[item.code] || 0) + 1;
                });
              }
            }

            if (opts.artifacts) {
              const artifact = buildArtifact(pathName, results, Date.now() - pageStartedAt);
              writeArtifactOne(pathName, artifact, statusMap.get(pathName));
              artifactsWritten += 1;
            }
            finishPage(pathName);

            const rssMb = process.memoryUsage().rss / 1024 / 1024;
            if (rssMb > MAX_RSS_MB) {
              throw new Error('memory limit exceeded after ' + pathName + ': RSS ' +
                Math.round(rssMb) + 'MB > ' + MAX_RSS_MB + 'MB');
            }
            if (opts.verbose) {
              console.log('  page ' + browserPages + '/' + pending.length + ' ' + pathName +
                ' ' + (Date.now() - pageStartedAt) + 'ms' +
                (issues.length ? ' issues=' + issues.map(function (issue) { return issue.code; }).join(',') : ''));
            }
            return pageAcc[pathName];
          }

          // Batch rule: one representative sample must pass every check
          // (static/SEO, resources, console, a11y, contrast, both mobile
          // viewports, share card) before the rest of the pages are scanned.
          if (sampleFile && pending.indexOf(sampleFile) !== -1) {
            const sampleAcc = await processBrowserPage(sampleFile);
            processedSample = true;
            if (sampleAcc && sampleAcc.failed > 0) {
              sampleFailed = true;
              console.error('');
              console.error('site-quality: sample page failed (' + SAMPLE_PATH + '); batch scan stopped.');
            } else if (files.some(function (file) { return rel(file) === SAMPLE_PATH; })) {
              try {
                shareResult.passed = 0;
                shareResult.failed = 0;
                shareResult.failures = [];
                const share = await shareCardE2E(page, handle.origin);
                shareResult.passed = share.passed;
                shareResult.failed = share.failed;
                shareResult.failures = share.failures;
                passed += share.passed;
                failed += share.failed;
                if (share.failures.length) {
                  share.failures.forEach(function (detail) {
                    failures.push({ path: SAMPLE_PATH, code: 'share-e2e', detail: detail });
                  });
                  sampleFailed = true;
                  console.error('');
                  console.error('site-quality: share-card E2E failed on the sample; batch scan stopped.');
                }
                progress.share = {
                  passed: shareResult.passed,
                  failed: shareResult.failed,
                  failures: shareResult.failures
                };
                saveProgress(progress);
              } catch (err) {
                shareFailure = err;
                sampleFailed = true;
                failed += 1;
                failures.push({
                  path: SAMPLE_PATH,
                  code: 'share-e2e',
                  detail: 'E2E crashed: ' + (err && err.message ? err.message : String(err))
                });
              }
            }
          } else if (opts.resume && progress.share) {
            shareResult.passed = progress.share.passed || 0;
            shareResult.failed = progress.share.failed || 0;
            shareResult.failures = progress.share.failures || [];
            passed += shareResult.passed;
            failed += shareResult.failed;
            shareResult.failures.forEach(function (detail) {
              failures.push({ path: SAMPLE_PATH, code: 'share-e2e', detail: detail });
            });
          }

          if (!sampleFailed) {
            const rest = pending.filter(function (file) {
              return !(processedSample && file === sampleFile);
            });
            for (const file of rest) {
              await processBrowserPage(file);
              await sleep(PAGE_INTERVAL_MS);
            }
          }
        }, {
          timeoutMs: 20000,
          args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding']
        });
      } finally {
        await handle.close();
      }
    }
  }
  afterResources = resourceSnapshot();

  // Lobby contract: the shipped lobby may only link shipped games. Anchors
  // explicitly marked data-status="draft" are rendered as draft previews and
  // are not part of the shipped lobby/statistics.
  const LOBBY_PATHS = [
    'games/index.html', 'games/en/index.html', 'games/id/index.html',
    'games/boardgame/index.html'
  ];
  const authoritativeLobbyStatus = loadAuthoritativeLobbyStatus();
  const fileSet = new Set(files.map(rel));
  LOBBY_PATHS.forEach(function (lobbyPath) {
    if (!fileSet.has(lobbyPath)) return;
    const html = fs.readFileSync(path.join(ROOT, lobbyPath), 'utf8');
    const anchors = html.match(/<a\b[^>]*>/gi) || [];
    const draftLinks = [];
    anchors.forEach(function (tag) {
      if (/\bdata-status\s*=\s*["']draft["']/i.test(tag)) {
        draftPreviewLinks += 1;
        return;
      }
      const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (!hrefMatch) return;
      const href = hrefMatch[1] != null ? hrefMatch[1] : (hrefMatch[2] != null ? hrefMatch[2] : hrefMatch[3]);
      if (!href || /^(?:https?:|mailto:|tel:|javascript:|#|data:)/i.test(href)) return;
      const target = resolveLobbyHref(lobbyPath, href);
      if (!target) return;
      const targetRel = rel(target);
      if (!isGameEntry(targetRel)) return;
      const state = statusMap.get(targetRel) ||
        (authoritativeLobbyStatus.has(targetRel)
          ? { effectiveStatus: authoritativeLobbyStatus.get(targetRel) }
          : null);
      if (!state || state.effectiveStatus !== 'shipped') {
        draftLinks.push(targetRel + ' (' + (state ? state.effectiveStatus : 'not-audited') + ')');
      }
    });
    if (draftLinks.length) {
      const baselineEntry = baseline.map.get(lobbyPath + '::lobby-draft-link');
      const detail = draftLinks.length + ' draft game link(s): ' + draftLinks.slice(0, 6).join(', ');
      if (baselineEntry && Number.isFinite(baselineEntry.maxCount) &&
        draftLinks.length > baselineEntry.maxCount) {
        // The historical baseline is a cap, not a blank check: a new draft
        // link added to a legacy lobby fails even though the old links remain
        // explicitly baselined.
        usedBaseline.add(lobbyPath + '::lobby-draft-link');
        failed += 1;
        failures.push({
          path: lobbyPath,
          code: 'lobby-draft-link',
          detail: 'draft links increased beyond baseline ' + baselineEntry.maxCount +
            ' → ' + draftLinks.length + ': ' + draftLinks.slice(0, 6).join(', ')
        });
      } else {
        record(lobbyPath, 'lobby-draft-link', detail);
      }
    } else {
      passed += 1;
    }
  });

  const durationMs = Date.now() - startedAt;
  const stale = baseline.entries.filter(function (entry) {
    return !usedBaseline.has(entry.path + '::' + entry.code);
  });

  if (opts.writeBaseline) {
    const entries = failures.filter(function (issue) {
      // Never baseline executable E2E or lobby-cap failures: those are new
      // regressions, not historical page debt.
      return issue.code !== 'share-e2e' && issue.code !== 'lobby-draft-link';
    }).map(function (issue) {
      return {
        path: issue.path,
        code: issue.code,
        reason: 'Observed in the first site-quality run. Historical page predates the gate; recorded explicitly so it is visible and does not silently fail new pages.'
      };
    }).concat(baseline.entries);
    const unique = new Map();
    entries.forEach(function (entry) {
      unique.set(entry.path + '::' + entry.code, entry);
    });
    const payload = {
      version: 1,
      description: 'Explicit historical baseline for games/tests/site-quality.mjs. Each entry is path + code + reason; a match is reported as WARN, never silently ignored.',
      entries: Array.from(unique.values()).sort(function (a, b) {
        return (a.path + '::' + a.code).localeCompare(b.path + '::' + b.code);
      })
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
    console.log('');
    console.log('site-quality: wrote ' + payload.entries.length + ' baseline entries to ' + rel(BASELINE_PATH));
  }

  if (opts.json) {
    console.log('');
    console.log(JSON.stringify({
      pages: files.length,
      browserPages: browserPages,
      checksPerPage: STATIC_CODES.length + (opts.browser ? BROWSER_CODES.length : 0),
      passed: passed,
      failed: failed,
      warnings: warnings,
      baselineEntries: baseline.entries.length,
      baselineUsed: usedBaseline.size,
      baselineStale: stale.length,
      contrastChecked: contrastChecked,
      artifacts: artifactsWritten,
      shippedPages: shippedPages,
      draftPages: draftPages,
      draftPreviewLinks: draftPreviewLinks,
      draftReasons: draftReasonCounts,
      resumedPages: resumedPages,
      resources: { before: beforeResources, after: afterResources },
      share: { passed: shareResult.passed, failed: shareResult.failed },
      durationMs: durationMs,
      failures: failures,
      warningsByCode: codeSummary(warningIssues),
      stale: stale
    }, null, 2));
  }

  printIssueGroups('FAIL', failures, 250);
  if (warningIssues.length) {
    console.log('');
    console.log('WARN (baseline, not failures): ' + warningIssues.length +
      (warningIssues.length ? ' [' + codeSummary(warningIssues) + ']' : ''));
    warningIssues.slice(0, 12).forEach(function (issue) {
      console.log('  ' + issue.path + ':' + issue.code + ': ' + oneLine(issue.reason, 140));
    });
    if (warningIssues.length > 12) console.log('  ... ' + (warningIssues.length - 12) + ' more baseline warnings');
  }
  if (stale.length) {
    console.log('');
    console.log('STALE baseline entries (' + stale.length + '):');
    stale.slice(0, 30).forEach(function (entry) {
      console.log('  ' + entry.path + ':' + entry.code);
    });
    if (stale.length > 30) console.log('  ... ' + (stale.length - 30) + ' more');
  }

  console.log('');
  console.log('site-quality: pages=' + files.length +
    ', browserPages=' + browserPages +
    ', browserVisits=' + browserVisits +
    ', checks=' + (passed + failed + warnings) +
    ', PASS=' + passed +
    ', FAIL=' + failed +
    ', WARN=' + warnings +
    ', baseline=' + usedBaseline.size + '/' + baseline.entries.length +
    ', stale=' + stale.length +
    ', contrastSamples=' + contrastChecked +
    ', artifacts=' + artifactsWritten);
  console.log('site-quality: shipped=' + shippedPages + ', draft=' + draftPages +
    ', draftPreviewLinks=' + draftPreviewLinks +
    (Object.keys(draftReasonCounts).length ? ', draftReasons=' + summaryCounts(draftReasonCounts) : ''));
  if (evidence.error) console.log('site-quality: multiplayer evidence manifest: ' + evidence.error);
  console.log('site-quality: batch=sequential interval=' + PAGE_INTERVAL_MS + 'ms, resumedPages=' + resumedPages +
    ', progress=' + rel(PROGRESS_PATH));
  console.log('site-quality: resources before=' + JSON.stringify(beforeResources));
  console.log('site-quality: resources after =' + JSON.stringify(afterResources));
  console.log('site-quality: duration=' + (durationMs / 1000).toFixed(1) + 's');
  if (shareResult.passed || shareResult.failed) {
    console.log('site-quality: share-card e2e assertions=' + (shareResult.passed + shareResult.failed) +
      ' (PASS=' + shareResult.passed + ', FAIL=' + shareResult.failed + ')');
  }
  if (shareFailure) {
    console.log('site-quality: share-card e2e crashed: ' + (shareFailure.message || String(shareFailure)));
  }
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

/*
 * Concurrency self-test: games/tests/site-quality.test.js starts two of these
 * at the same instant, both writing the same SITE_QUALITY_PROGRESS target. A
 * fixed `.tmp` name made the loser's rename fail with ENOENT; every writer now
 * uses its own temp file, so both must finish cleanly.
 */
async function progressSelfTest() {
  const rounds = Math.max(1, Number(process.env.SITE_QUALITY_PROGRESS_ROUNDS) || 40);
  const startAt = Number(process.env.SITE_QUALITY_PROGRESS_START_AT) || 0;
  while (Date.now() < startAt) {
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
  // Optional go-file barrier: the wrapper only creates it once both writers
  // have booted, so the write/rename windows really do overlap.
  const barrier = process.env.SITE_QUALITY_PROGRESS_BARRIER;
  if (barrier) {
    const ready = barrier + '.ready-' + process.pid;
    try { fs.writeFileSync(ready, String(process.pid)); } catch (err) { /* best effort */ }
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(barrier) && Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 10); });
    }
    try { fs.unlinkSync(ready); } catch (err) { /* best effort */ }
  }
  const progress = {
    version: 1,
    fingerprint: 'self-test-' + process.pid,
    done: {},
    share: null
  };
  for (let i = 0; i < rounds; i += 1) {
    progress.done['probe-' + process.pid + '-' + i] = { at: Date.now() };
    saveProgress(progress);
  }
  console.log('progress self-test: pid=' + process.pid + ', rounds=' + rounds +
    ', target=' + rel(PROGRESS_PATH));
  console.log('RESULT: ' + rounds + ' passed, 0 failed');
}

if (process.argv.indexOf('--progress-self-test') !== -1) {
  progressSelfTest().catch(function (err) {
    console.error('progress self-test crashed: ' + (err && err.stack ? err.stack : String(err)));
    console.log('RESULT: 0 passed, 1 failed');
    process.exitCode = 1;
  });
} else {
  main().catch(function (err) {
    console.error('site-quality crashed: ' + (err && err.stack ? err.stack : String(err)));
    console.log('RESULT: 0 passed, 1 failed');
    process.exitCode = 1;
  });
}
