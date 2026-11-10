#!/usr/bin/env node
/*
 * One-shot audit fixes for the 284 boardgame pages. Idempotent.
 *
 *   node games/boardgame/scripts/audit-fix.mjs --dry-run
 *   node games/boardgame/scripts/audit-fix.mjs
 *   node games/boardgame/scripts/audit-fix.mjs --only meta,fonts,single
 *
 * Fixes:
 *   meta   add a missing <meta name="description"> derived from rules.html
 *   fonts  clamp CSS font-size below 12px (and <0.75rem) to 12px,
 *          and force form controls to 16px to stop iOS zoom-on-focus
 *   single add a visible 「单人」 badge to single-player game pages
 *
 * Only index.html is touched. Game logic (engine.js/test.js) is never edited.
 */

import fs from 'node:fs';
import path from 'node:path';
import { catalog, readText, BOARD_ROOT } from './audit-catalog.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyArg = args.indexOf('--only');
const only = onlyArg !== -1
  ? new Set(String(args[onlyArg + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
  : new Set(['meta', 'fonts', 'single']);

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function descriptionFor(game) {
  const rules = readText(game.slug, 'rules.html');
  const paragraphs = [...rules.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((p) => p.length >= 30 && !/^(提示|注|本作|本游戏)/.test(p));
  let text = paragraphs[0] || '';
  if (!text) {
    const index = readText(game.slug, 'index.html');
    const p = index.match(/<p[^>]*class="[^"]*lede[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    text = p ? stripTags(p[1]) : '';
  }
  if (!text) text = game.slug;
  // Keep whole sentences up to ~150 characters.
  if (text.length > 150) {
    const cut = text.slice(0, 150);
    const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    text = end >= 40 ? cut.slice(0, end + 1) : cut.replace(/[,，、;；]\s*$/, '') + '…';
  }
  return text;
}

function clampFonts(html) {
  let changed = 0;
  html = html.replace(/(font-size\s*:\s*)([\d.]+)px/gi, (m, head, raw) => {
    const n = parseFloat(raw);
    if (n > 0 && n < 12) { changed++; return head + '12px'; }
    return m;
  });
  html = html.replace(/(font-size\s*:\s*)([\d.]+)rem/gi, (m, head, raw) => {
    const n = parseFloat(raw);
    if (n > 0 && n < 0.75) { changed++; return head + '0.75rem'; }
    return m;
  });
  if (/<(input|select|textarea)\b/i.test(html) && !/audit-ios-font/.test(html)) {
    const rule = '\n/* audit-ios-font: keep form controls at 16px so iOS does not zoom */\ninput,select,textarea{font-size:16px!important}\n';
    const lastStyle = html.lastIndexOf('</style>');
    if (lastStyle !== -1) {
      html = html.slice(0, lastStyle) + rule + html.slice(lastStyle);
      changed++;
    }
  }
  return { html, changed };
}

function addSingleBadge(html) {
  if (html.indexOf('single-badge') !== -1) return { html, changed: 0 };
  const m = html.match(/<\/h1>/i);
  if (!m) return { html, changed: 0 };
  const badge = ' <span class="single-badge" style="display:inline-flex;align-items:center;min-height:24px;padding:0 8px;margin-left:8px;border:1px solid currentColor;border-radius:999px;font-size:12px;font-weight:650;vertical-align:middle">单人</span>';
  const at = m.index + m[0].length;
  return { html: html.slice(0, at) + badge + html.slice(at), changed: 1 };
}

function addDescription(html, desc) {
  if (/<meta\s+name=["']description["']/i.test(html)) return { html, changed: 0 };
  const meta = '\n<meta name="description" content="' + escapeAttr(desc) + '">';
  const title = html.match(/<title>[\s\S]*?<\/title>/i);
  if (title) {
    const at = title.index + title[0].length;
    return { html: html.slice(0, at) + meta + html.slice(at), changed: 1 };
  }
  const charset = html.match(/<meta\s+charset=[^>]*>/i);
  if (charset) {
    const at = charset.index + charset[0].length;
    return { html: html.slice(0, at) + meta + html.slice(at), changed: 1 };
  }
  return { html, changed: 0 };
}

const stats = { pages: 0, meta: 0, fonts: 0, single: 0, fontDecls: 0 };

for (const game of catalog()) {
  // Premium entries are upgraded on separate branches by user direction:
  // audit them, never edit them here.
  if (game.kind === 'premium') continue;
  const file = path.join(BOARD_ROOT, game.slug, 'index.html');
  if (!fs.existsSync(file)) continue;
  stats.pages++;
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  if (only.has('meta')) {
    const r = addDescription(html, descriptionFor(game));
    html = r.html;
    if (r.changed) stats.meta++;
  }
  if (only.has('fonts')) {
    const r = clampFonts(html);
    html = r.html;
    if (r.changed) stats.fonts++;
    stats.fontDecls += r.changed;
  }
  if (only.has('single') && game.mode === 'single') {
    const r = addSingleBadge(html);
    html = r.html;
    if (r.changed) stats.single++;
  }

  if (html !== before) {
    if (!dryRun) fs.writeFileSync(file, html);
  }
}

console.log(JSON.stringify({ dryRun, only: [...only], ...stats }, null, 2));
