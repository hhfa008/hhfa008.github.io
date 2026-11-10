#!/usr/bin/env node
/*
 * verify-shipped: the five-gate acceptance check for boardgame entries.
 *
 * A game is `shipped` only when ALL five gates pass:
 *   process  design -> implementation -> unit tests -> perf assertion ->
 *            E2E evidence -> acceptance -> tracked in git
 *   art      local cover + OG + detail illustration (real raster, not emoji)
 *   realism  realism.json with passing count/dimension/proportion/color/
 *            material/rule checks
 *   mobile   390x844 AND 320x568 real-browser smoke (no overflow, >=44px
 *            touch targets, readable type, no console/external errors)
 *   mode     single: visible 「单人」 badge
 *            multi:  online implementation + dual-client same-game E2E
 *                    (room/invite/reconnect/timeout takeover/leaderboard)
 *
 * Usage:
 *   node games/boardgame/scripts/verify-shipped.mjs \
 *     [--smoke-390 audit/smoke-390.json] [--smoke-320 audit/smoke-320.json] \
 *     [--out games/boardgame/catalog-status.json] [--no-tests]
 *
 * Every number written to catalog-status.json and PROCESS-AUDIT.md comes from
 * these checks. Missing evidence is reported as missing, never inferred.
 */

import fs from 'node:fs';
import path from 'node:path';
import child from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BOARD_ROOT, catalog, readText } from './audit-catalog.mjs';
import gateArtifacts from './gate-artifacts.js';
import gateOnline from './gate-online.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i !== -1 ? args[i + 1] : fallback;
};
const smokePath = path.resolve(opt('smoke', path.join(BOARD_ROOT, 'audit', 'smoke-390.json')));
const smoke320Path = path.resolve(opt('smoke-320', path.join(BOARD_ROOT, 'audit', 'smoke-320.json')));
const outPath = path.resolve(opt('out', path.join(BOARD_ROOT, 'catalog-status.json')));
const listPath = path.resolve(opt('list', path.join(BOARD_ROOT, 'audit', 'status-list.json')));
const gateName = opt('gate', null);
const gateOutPath = path.resolve(opt('gate-out', path.join(BOARD_ROOT, 'audit', 'gate-' + (gateName || 'all') + '.json')));
const runTests = !args.includes('--no-tests');

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function smokeMap(file) {
  const data = readJson(file);
  if (!data) return { exists: false, file, games: new Map() };
  const games = new Map();
  (data.results || []).forEach((r) => games.set(r.slug, r));
  return { exists: true, file, summary: data.summary, games };
}

function stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function bodyText(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return stripTags(m ? m[1] : html);
}

function bytesOf(file) {
  try { return fs.statSync(file).size; } catch (e) { return 0; }
}

function testOne(game) {
  const testFile = path.join(game.dir, 'test.js');
  if (!fs.existsSync(testFile)) return { ok: false, assertions: 0, detail: 'test.js missing' };
  if (!runTests) return { ok: null, assertions: null, detail: 'not run (--no-tests)' };
  const res = child.spawnSync(process.execPath, [testFile], {
    cwd: path.resolve(BOARD_ROOT, '..'),
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    env: Object.assign({}, process.env, { NO_COLOR: '1' })
  });
  const stdout = res.stdout || '';
  const m = stdout.match(/(\d+)\s+passed(?:[^\d]+(\d+)\s+failed)?/i);
  const passed = m ? +m[1] : null;
  const failed = m && m[2] != null ? +m[2] : 0;
  return {
    ok: res.status === 0 && failed === 0,
    assertions: passed,
    detail: res.status === 0 ? `${passed == null ? 'ok' : passed + ' passed'}${failed ? ', ' + failed + ' failed' : ''}` : `exit ${res.status}`
  };
}

function hasPerfEvidence(game) {
  const names = ['perf.test.js', 'perf.json', 'perf-budget.json', 'performance.json'];
  for (const name of names) {
    if (fs.existsSync(path.join(game.dir, name))) return name;
  }
  const test = readText(game.slug, 'test.js');
  if (/PERF_BUDGET|性能预算|perf budget/i.test(test)) return 'test.js marker';
  return null;
}

function smokePass(result) {
  if (!result || result.status !== 'PASS') return false;
  const names = (result.checks || []).map((c) => c.name);
  return names.some((n) => n.indexOf('390') === 0) && names.some((n) => n.indexOf('320') === 0);
}

function evaluate(game, smoke390, smoke320) {
  const html = readText(game.slug, 'index.html');
  const images = gateArtifacts.imageArtifacts(game.dir).map((img) => Object.assign({ slug: game.slug }, img));
  const reasons = [];

  const design = fs.existsSync(path.join(game.dir, 'DESIGN.md')) &&
    bytesOf(path.join(game.dir, 'DESIGN.md')) >= 400;
  if (!design) reasons.push('DESIGN.md missing or <400 bytes');

  const unit = testOne(game);
  if (unit.ok !== true) reasons.push('unit tests: ' + unit.detail);

  const perf = hasPerfEvidence(game);
  if (!perf) reasons.push('no per-game performance assertion');

  const s390 = smoke390.games.get(game.slug);
  const s320 = smoke320.games.get(game.slug);
  const mobileOk = smokePass(s390) && smokePass(s320);
  const e2e = mobileOk;
  if (!e2e) {
    const f = (s390 && s390.failures && s390.failures.length) ? s390.failures : ['missing/failed smoke result'];
    reasons.push('E2E/mobile smoke not passing: ' + f.slice(0, 2).join('; '));
  }

  const acceptance = fs.existsSync(path.join(game.dir, 'ACCEPTANCE.md'));
  if (!acceptance) reasons.push('ACCEPTANCE.md missing');

  const artSet = gateArtifacts.classifyArt(images);
  const cover = artSet.cover;
  const og = artSet.og;
  const detail = artSet.detail;
  const art = !!(cover && og && detail);
  if (!cover) reasons.push('local cover image missing/too small');
  if (!og) reasons.push('local OG image missing/too small');
  if (!detail) reasons.push('local detail illustration missing/too small');

  const realism = readJson(path.join(game.dir, 'realism.json'));
  const realismChecks = realism && Array.isArray(realism.checks) ? realism.checks : [];
  const kinds = new Set(realismChecks.map((c) => c.kind).filter(Boolean));
  const realismOk = !!(realism && realism.pass === true && realismChecks.length >= 3 &&
    realismChecks.every((c) => c.ok === true) && kinds.size >= 3);
  if (!realismOk) reasons.push('realism.json missing or has <3 passing checks');

  let modeOk = false;
  if (game.mode === 'single') {
    modeOk = bodyText(html).indexOf('单人') !== -1;
    if (!modeOk) reasons.push('single-player page has no visible 「单人」 badge');
  } else {
    const online = gateOnline.onlineEvidence(game);
    modeOk = online.ok;
    if (!modeOk) reasons.push('multiplayer game has no online dual-client E2E evidence');
  }

  const gates = {
    process: !!(design && unit.ok === true && perf && e2e && acceptance),
    art,
    realism: realismOk,
    mobile: mobileOk,
    mode: modeOk
  };
  // Coordinator rule 2026-11-10: the 250 mini batch is held as draft even if a
  // page happens to satisfy the mechanical checks; it is not rendered or
  // counted until the batch is explicitly promoted.
  const policyDraft = game.kind === 'mini';
  if (policyDraft) reasons.push('policy: 250-game mini batch held as draft');
  const status = !policyDraft && Object.values(gates).every(Boolean) ? 'shipped' : 'draft';

  return {
    slug: game.slug,
    kind: game.kind,
    mode: game.mode,
    status,
    policyDraft,
    gates,
    evidence: {
      design: design ? 'DESIGN.md' : null,
      unit: { ok: unit.ok, assertions: unit.assertions, detail: unit.detail },
      perf,
      e2e: e2e ? { smoke390: s390.status, smoke320: s320.status } : null,
      acceptance: acceptance ? 'ACCEPTANCE.md' : null,
      art: { cover, og, detail },
      realism: realism ? { pass: realism.pass, checks: realismChecks.length, kinds: [...kinds] } : null,
      mode: game.mode === 'single'
        ? { badge: modeOk }
        : gateOnline.onlineEvidence(game)
    },
    reasons
  };
}

function main() {
  const smoke390 = smokeMap(smokePath);
  const smoke320Raw = smokeMap(smoke320Path);
  // One smoke pass measures both 390x844 and 320x568 per page. A second pass
  // (--smoke-320) is optional extra evidence; without it, reuse the first.
  const smoke320 = smoke320Raw.exists ? smoke320Raw : smoke390;
  const entries = catalog().map((game) => evaluate(game, smoke390, smoke320));

  if (gateName) {
    const key = gateName === 'online' ? 'mode' : gateName;
    if (['process', 'art', 'realism', 'mobile', 'mode'].indexOf(key) === -1) {
      throw new Error('unknown gate: ' + gateName);
    }
    const rows = entries.map((e) => ({
      slug: e.slug, kind: e.kind, mode: e.mode,
      ok: e.gates[key],
      reasons: e.gates[key] ? [] : e.reasons
    }));
    const pass = rows.filter((r) => r.ok).length;
    let control = null;
    if (key === 'art') control = gateArtifacts.control();
    if (gateName === 'online' || key === 'online') control = gateOnline.control();
    const allPass = pass === rows.length && (!control || control.ok);
    const report = {
      gate: gateName,
      generatedAt: new Date().toISOString(),
      total: rows.length,
      pass: pass,
      fail: rows.length - pass,
      control: control,
      allPass: allPass,
      games: rows
    };
    fs.mkdirSync(path.dirname(gateOutPath), { recursive: true });
    fs.writeFileSync(gateOutPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ gate: gateName, total: rows.length, pass, fail: rows.length - pass,
      control: control, allPass: allPass, out: gateOutPath }, null, 2));
    process.exit(allPass ? 0 : 1);
  }

  // card-battle is an extra hub entry outside the 284 baseline. It is gated
  // too so the hub cannot render an unaudited entry.
  const extra = evaluate({
    slug: 'card-battle',
    kind: 'extra',
    mode: 'multi',
    dir: path.join(BOARD_ROOT, 'card-battle')
  }, smoke390, smoke320);

  const summary = {
    total: entries.length,
    shipped: entries.filter((e) => e.status === 'shipped').length,
    draft: entries.filter((e) => e.status === 'draft').length,
    single: entries.filter((e) => e.mode === 'single').length,
    multi: entries.filter((e) => e.mode === 'multi').length,
    byKind: entries.reduce((out, e) => {
      out[e.kind] = out[e.kind] || { total: 0, shipped: 0, draft: 0 };
      out[e.kind].total++;
      out[e.kind][e.status]++;
      return out;
    }, {}),
    gates: ['process', 'art', 'realism', 'mobile', 'mode'].reduce((out, key) => {
      out[key] = entries.filter((e) => e.gates[key]).length;
      return out;
    }, {}),
    missing: {
      design: entries.filter((e) => !e.evidence.design).length,
      unit: entries.filter((e) => e.evidence.unit.ok !== true).length,
      perf: entries.filter((e) => !e.evidence.perf).length,
      e2e: entries.filter((e) => !e.evidence.e2e).length,
      acceptance: entries.filter((e) => !e.evidence.acceptance).length,
      cover: entries.filter((e) => !e.evidence.art.cover).length,
      og: entries.filter((e) => !e.evidence.art.og).length,
      detailArt: entries.filter((e) => !e.evidence.art.detail).length,
      realism: entries.filter((e) => !e.evidence.realism || e.evidence.realism.pass !== true).length,
      online: entries.filter((e) => e.mode === 'multi' && !e.evidence.mode.ok).length,
      singleBadge: entries.filter((e) => e.mode === 'single' && !e.evidence.mode.badge).length
    }
  };

  const report = {
    generatedAt: new Date().toISOString(),
    policy: {
      source: 'AGENTS.md 硬性质量要求 2026-11-10 (1-5)',
      shipped: 'all five gates pass',
      draft: 'any gate missing; not rendered in hub/mini and excluded from counts',
      widths: ['390x844', '320x568']
    },
    smoke: {
      '390': smoke390.exists ? { path: smokePath, summary: smoke390.summary } : { path: smokePath, missing: true },
      '320': smoke320Raw.exists ? { path: smoke320Path, summary: smoke320Raw.summary } : { path: smoke320Path, note: 'not run; 320x568 measured in the 390 pass' }
    },
    summary,
    games: entries,
    extras: [extra]
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(listPath, JSON.stringify({
    generatedAt: report.generatedAt,
    summary,
    shipped: entries.filter((e) => e.status === 'shipped').map((e) => e.slug),
    draft: entries.map((e) => ({ slug: e.slug, kind: e.kind, mode: e.mode, reasons: e.reasons })),
    extras: [extra]
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    out: outPath,
    list: listPath,
    smoke: smoke390.exists ? smoke390.summary : 'missing',
    summary
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
