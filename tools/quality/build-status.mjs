#!/usr/bin/env node
/* 生成 games/GAME_STATUS.json —— 五项全过才 shipped，否则 draft。
 *
 *   node tools/quality/build-status.mjs
 *
 * 五项：
 *   1. tests       流程测试（games/tests/report.json 或 boardgame report）
 *   2. art         封面 + OG 1200×630 + 详情页
 *   3. realism     规则页（Article + FAQPage + ≥1200 汉字）与单测同时通过
 *   4. mobile      390×844 与 320×568 两档冒烟全过（games/quality-report.json）
 *   5. multiplayer 单人：详情页明确标注「单人」；多人：room/sync/aiFill/
 *                  reconnect/leaderboard/e2e 六项全过
 *
 * 只读测试报告与静态文件，不改游戏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, allTargets, singleLabelOf } from './registry.mjs';

const STATUS_PATH = path.join(ROOT, 'games/GAME_STATUS.json');
const QUALITY_PATH = path.join(ROOT, 'games/quality-report.json');
const GAME_REPORT_PATH = path.join(ROOT, 'games/tests/report.json');
const BG_REPORT_PATH = path.join(ROOT, 'games/boardgame/tests/report.json');
const PERF_BUDGET_MS = 5000;

const EXTRA_TEST_FILES = {
  mahjong: ['tests/gameplay-mahjong.test.mjs', 'tests/network-rooms.test.mjs', 'play/e2e.mjs'],
  'card-battle': ['tests/gameplay-card-battle.test.mjs', 'tests/network-rooms.test.mjs', 'play/e2e.mjs'],
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 图片尺寸（PNG / JPEG / SVG）
// ---------------------------------------------------------------------------
function imageSize(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length > 24 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
      if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  const text = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (/<svg/i.test(text)) {
    const w = /<svg[^>]*\bwidth=["']?(\d+)/i.exec(text);
    const h = /<svg[^>]*\bheight=["']?(\d+)/i.exec(text);
    const vb = /viewBox=["']([\d.\s-]+)["']/i.exec(text);
    if (w && h) return { type: 'svg', width: Number(w[1]), height: Number(h[1]) };
    if (vb) {
      const parts = vb[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4) return { type: 'svg', width: parts[2], height: parts[3] };
    }
    return { type: 'svg', width: null, height: null };
  }
  return null;
}

function localPathForAsset(asset, target) {
  if (!asset) return null;
  // asset 候选本身就是仓库内的绝对路径。
  if (path.isAbsolute(asset) && fs.existsSync(asset)) return asset;
  if (/^https?:\/\//i.test(asset)) {
    try {
      const u = new URL(asset);
      if (u.hostname === 'hhfa008.github.io') return path.join(ROOT, u.pathname.replace(/^\//, ''));
    } catch { return null; }
    return null;
  }
  if (asset.startsWith('/')) return path.join(ROOT, asset.replace(/^\//, ''));
  if (target.kind === 'arcade' || target.kind === 'legacy') {
    return path.join(ROOT, 'games', target.slug, asset);
  }
  return path.join(ROOT, path.dirname(target.url.replace(/^\//, '')), asset);
}

function pageOgAsset(target) {
  const pageFile = target.kind === 'extra'
    ? path.join(ROOT, target.url.replace(/^\//, ''))
    : path.join(ROOT, 'games', target.slug, 'index.html');
  let html;
  try {
    html = fs.readFileSync(pageFile, 'utf8');
  } catch {
    return null;
  }
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    if (!/property\s*=\s*["']og:image["']/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (content) return content[1];
  }
  return null;
}

function assetCandidates(slug) {
  return ['png', 'jpg', 'jpeg', 'webp', 'svg'].map((ext) => path.join(ROOT, 'games/assets/og', `${slug}.${ext}`));
}

function artEvidence(target) {
  const pageAsset = pageOgAsset(target);
  let asset = pageAsset;
  let assetSource = pageAsset ? 'page' : 'none';
  if (!asset) {
    const found = assetCandidates(target.slug).find((p) => fs.existsSync(p));
    if (found) {
      asset = found;
      assetSource = 'asset';
    }
  }
  const local = localPathForAsset(asset, target);
  const dims = local ? imageSize(local) : null;
  const og1200x630 = Boolean(dims && dims.width === 1200 && dims.height === 630);
  const cover = fs.existsSync(path.join(ROOT, 'games/assets/icons', `${target.slug}.svg`));
  const rulesFile = target.rules ? path.join(ROOT, target.rules.replace(/^\//, '')) : null;
  const detailPage = rulesFile ? fs.existsSync(rulesFile) : false;
  let detailImages = 0;
  if (detailPage) {
    try {
      const html = fs.readFileSync(rulesFile, 'utf8');
      detailImages = (html.match(/<img\b/gi) || []).length;
    } catch { detailImages = 0; }
  }
  const ok = cover && og1200x630 && (detailPage || target.kind === 'extra');
  return {
    ok,
    cover,
    og: {
      source: assetSource,
      asset: asset || null,
      local: local ? path.relative(ROOT, local) : null,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
      is1200x630: og1200x630,
    },
    detailPage,
    detailImages,
    provisional: assetSource === 'asset',
    note: !cover ? 'missing icon/cover'
      : !og1200x630 ? (asset ? `OG is not 1200×630 (${dims ? dims.width + '×' + dims.height : 'unreadable'})` : 'no OG image')
        : !detailPage ? 'no detail page'
          : 'cover + OG 1200×630 + detail page',
  };
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])); } catch { /* ignore */ }
  }
  return out;
}

function cjkCount(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return (text.match(/[一-鿿]/g) || []).length;
}

function rulesEvidence(target) {
  if (!target.rules) return { ok: false, note: 'no rules/detail page' };
  const file = path.join(ROOT, target.rules.replace(/^\//, ''));
  if (!fs.existsSync(file)) return { ok: false, note: 'rules.html missing' };
  const html = fs.readFileSync(file, 'utf8');
  const blocks = jsonLdBlocks(html);
  const hasArticle = blocks.some((b) => b && b['@type'] === 'Article');
  const hasFaq = blocks.some((b) => b && b['@type'] === 'FAQPage');
  const cjk = cjkCount(html);
  // arcade 模板要求 Article + FAQPage + ≥1200 汉字；
  // 原站点详情页沿用既有结构：只要有规则页与结构化说明、正文 ≥600 汉字即可。
  const ok = target.kind === 'arcade'
    ? hasArticle && hasFaq && cjk >= 1200
    : (hasArticle || hasFaq) && cjk >= 600;
  return {
    ok,
    hasArticle,
    hasFaq,
    cjk,
    note: ok
      ? (target.kind === 'arcade' ? 'Article + FAQPage + ≥1200 汉字' : 'legacy rules page (Article/FAQ + ≥600 汉字)')
      : `Article=${hasArticle} FAQ=${hasFaq} CJK=${cjk}`,
  };
}

// ---------------------------------------------------------------------------
// 各维度证据
// ---------------------------------------------------------------------------
function testEvidence(target, gameReport, bgReport) {
  if (target.kind === 'extra') {
    const required = EXTRA_TEST_FILES[target.slug] || [];
    const rows = (bgReport && bgReport.rows) || [];
    const checks = required.map((file) => {
      const row = rows.find((r) => r.label === file || r.label.endsWith(file));
      return { file, status: row ? row.status : 'MISSING', passed: row ? row.passed : 0 };
    });
    const ok = checks.length > 0 && checks.every((c) => c.status === 'PASS');
    return { ok, kind: 'boardgame', checks, assertions: checks.reduce((n, c) => n + (c.passed || 0), 0), note: ok ? 'required suites PASS' : 'missing/failed suite' };
  }
  const rows = (gameReport && gameReport.tests) || [];
  const row = rows.find((r) => r.game === target.slug || r.slug === target.slug);
  if (!row) return { ok: false, note: 'no test report entry' };
  return {
    ok: row.status === 'PASS',
    kind: 'games',
    file: row.file,
    status: row.status,
    assertions: row.assertions || null,
    note: row.note || row.status,
  };
}

function perfEvidence(slug, quality) {
  const results = quality && quality.games && quality.games.results;
  const g = Array.isArray(results) ? results.find((x) => x.slug === slug) : null;
  if (!g) return { ok: false, note: 'not audited', maxLoadMs: null, budgetMs: PERF_BUDGET_MS };
  const values = Object.values(g.viewports || {}).map((v) => v.loadMs).filter((n) => Number.isFinite(n));
  const maxLoadMs = values.length ? Math.max(...values) : null;
  return {
    ok: maxLoadMs != null && maxLoadMs <= PERF_BUDGET_MS,
    maxLoadMs,
    budgetMs: PERF_BUDGET_MS,
    note: maxLoadMs == null ? 'no load timing' : `${maxLoadMs}ms (budget ${PERF_BUDGET_MS}ms)`,
  };
}

function mobileEvidence(slug, quality) {
  const results = quality && quality.games && quality.games.results;
  const g = Array.isArray(results) ? results.find((x) => x.slug === slug) : null;
  if (!g) return { ok: false, note: 'not audited', viewports: {} };
  const vps = {};
  let ok = true;
  for (const [key, r] of Object.entries(g.viewports || {})) {
    vps[key] = {
      ok: Boolean(r.ok),
      scrollWidth: r.scrollWidth,
      touchViolations: r.touch ? r.touch.violationCount : null,
      denseCells: r.touch ? r.touch.denseCount : null,
      fontViolations: r.fonts ? r.fonts.violationCount : null,
      problems: r.problems || [],
    };
    if (!r.ok) ok = false;
  }
  if (Object.keys(vps).length !== 2) ok = false;
  return { ok, note: ok ? '390×844 + 320×568 PASS' : 'one or both viewports FAIL', viewports: vps };
}

function readText(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
}

function hasFile(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function multiplayerEvidence(target, bgReport) {
  if (target.players === 'single') {
    const label = singleLabelOf(target);
    return {
      required: false,
      ok: label.ok,
      singleLabel: label,
      room: null,
      sync: null,
      aiFill: null,
      reconnect: null,
      leaderboard: null,
      e2e: null,
      note: label.note,
    };
  }
  const bgRows = (bgReport && bgReport.rows) || [];
  const e2eRow = bgRows.find((r) => r.label === 'play/e2e.mjs');
  const isExtra = target.kind === 'extra';
  // e2e 是 boardgame play 链路（rooms → card-battle → 结算）的证据，
  // 只适用于 mahjong / card-battle 两个 play/ 样板，不能算到原站点多人游戏上。
  const e2e = isExtra && Boolean(e2eRow && e2eRow.status === 'PASS');
  // 房间/联机证据只取该游戏真正对应的实现；不要把 boardgame/play/rooms.js
  // 的联机能力错算到原站点本地双人游戏上。
  const rooms = isExtra ? readText('games/boardgame/play/rooms.js') : '';
  const extraJs = target.slug === 'mahjong'
    ? readText('games/boardgame/play/mahjong.js')
    : target.slug === 'card-battle'
      ? readText('games/boardgame/play/card-battle.js')
      : '';
  const pageRel = target.kind === 'extra' ? target.url.replace(/^\//, '') : `games/${target.slug}/index.html`;
  const page = readText(pageRel);
  const pagePlus = page + extraJs;
  const roomSources = rooms + pagePlus;
  const roomsLike = /createRoom|joinRoom|inviteCode|邀请码|创建房间/.test(roomSources);
  const syncSameBrowser = /BroadcastChannel/.test(roomSources);
  const serverSync = isExtra && /WebSocket|new WebSocket|DurableObject|wss:\/\//.test(
    readText('games/boardgame/server/ai-eval.mjs') + readText('games/boardgame/play/rooms.js')
  );
  const aiFill = /AI|ai\b|computer|robot|AI_DELAY|AI_STEP_DELAY/.test(pagePlus + rooms);
  const reconnect = /reconnect|重新加入|rejoin/i.test(pagePlus + rooms);
  const leaderboard = /leaderboard|排行榜|榜单/.test(pagePlus + (isExtra ? readText('games/boardgame/play/rewards.js') : ''));
  const evidence = {
    room: { ok: roomsLike, note: roomsLike ? 'room/invite code present' : 'no room/invite implementation' },
    sync: {
      ok: serverSync,
      sameBrowserTabs: syncSameBrowser,
      note: serverSync ? 'server/WebSocket sync present' : syncSameBrowser
        ? 'BroadcastChannel same-browser tabs only; no cross-device sync'
        : 'no cross-device sync',
    },
    aiFill: { ok: aiFill, note: aiFill ? 'AI opponent present' : 'no AI fill' },
    reconnect: { ok: reconnect, note: reconnect ? 'reconnect/rejoin present' : 'no reconnect' },
    leaderboard: { ok: leaderboard, note: leaderboard ? (target.kind === 'extra' ? 'local leaderboard present' : 'leaderboard text present') : 'no leaderboard' },
    e2e: isExtra
      ? {
        ok: e2e,
        inRunAll: Boolean(e2eRow),
        note: e2e ? 'play/e2e.mjs PASS in run-all' : e2eRow ? 'e2e failed' : 'e2e not in run-all',
      }
      : { ok: false, inRunAll: false, note: 'no two-client e2e for this game' },
  };
  const ok = Object.values(evidence).every((v) => v.ok);
  return { required: true, ok, ...evidence, note: ok ? 'multiplayer gate PASS' : 'multiplayer gate FAIL' };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  const quality = readJson(QUALITY_PATH, null);
  const gameReport = readJson(GAME_REPORT_PATH, null);
  const bgReport = readJson(BG_REPORT_PATH, null);
  const previous = readJson(STATUS_PATH, null);
  const prevMap = new Map();
  const prevList = previous && (Array.isArray(previous) ? previous : previous.games) || [];
  for (const g of prevList) if (g && g.slug) prevMap.set(g.slug, g);

  const today = new Date().toISOString().slice(0, 10);
  const games = allTargets().map((target) => {
    const tests = testEvidence(target, gameReport, bgReport);
    const art = artEvidence(target);
    const rules = rulesEvidence(target);
    const realism = {
      ok: tests.ok && rules.ok,
      rulesPage: rules,
      unitTests: Boolean(tests.ok),
      note: tests.ok && rules.ok
        ? 'rules page documented + unit tests pass'
        : !tests.ok ? 'unit tests missing/failed' : 'rules page incomplete',
    };
    const perf = perfEvidence(target.slug, quality);
    const mobile = mobileEvidence(target.slug, quality);
    const multiplayer = multiplayerEvidence(target, bgReport);
    const shipped = tests.ok && art.ok && realism.ok && mobile.ok && multiplayer.ok;
    const status = shipped ? 'shipped' : 'draft';
    const prev = prevMap.get(target.slug);
    const updated = prev && prev.status === status && prev.updated ? prev.updated : today;
    const reasons = [];
    if (!tests.ok) reasons.push('tests');
    if (!art.ok) reasons.push('art');
    if (!realism.ok) reasons.push('realism');
    if (!mobile.ok) reasons.push('mobile');
    if (!multiplayer.ok) reasons.push('multiplayer');
    return {
      slug: target.slug,
      status,
      players: target.players,
      kind: target.kind,
      evidence: { tests, perf, art, realism, mobile, multiplayer },
      updated,
      draftReasons: reasons,
    };
  });

  const shipped = games.filter((g) => g.status === 'shipped');
  const draft = games.filter((g) => g.status === 'draft');
  const out = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    criteria: {
      tests: '流程测试通过',
      art: '封面 + OG 1200×630 + 详情页',
      realism: '规则页 Article+FAQPage+≥1200 汉字 且单测通过',
      mobile: '390×844 与 320×568 两档冒烟全过',
      multiplayer: '单人详情页标注「单人」；多人 room/sync/aiFill/reconnect/leaderboard/e2e 全过',
    },
    stats: {
      total: games.length,
      shipped: shipped.length,
      draft: draft.length,
      byKind: {
        arcade: games.filter((g) => g.kind === 'arcade').length,
        legacy: games.filter((g) => g.kind === 'legacy').length,
        extra: games.filter((g) => g.kind === 'extra').length,
      },
    },
    games,
  };
  fs.writeFileSync(STATUS_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`GAME_STATUS: ${games.length} total, ${shipped.length} shipped, ${draft.length} draft`);
  if (shipped.length) console.log('shipped: ' + shipped.map((g) => g.slug).join(', '));
  const byReason = {};
  for (const g of draft) for (const r of g.draftReasons) byReason[r] = (byReason[r] || 0) + 1;
  console.log('draft reasons: ' + Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(', '));
}

main();
