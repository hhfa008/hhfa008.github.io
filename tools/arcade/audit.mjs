#!/usr/bin/env node
/* 100 款游戏交付审计：页面、规则页、测试、图标、静态合规。
 *
 *   node tools/arcade/audit.mjs            # 全量
 *   node tools/arcade/audit.mjs --slug x   # 单款
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allGames } from './families.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const only = (() => {
  const i = process.argv.indexOf('--slug');
  return i > 0 ? process.argv[i + 1] : null;
})();

function cjk(html) {
  const t = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  return (t.match(/[一-鿿]/g) || []).length;
}

const games = allGames().filter((g) => (only ? g.slug === only : true));
const rows = [];
for (const g of games) {
  const dir = path.join(ROOT, 'games', g.slug);
  const problems = [];
  const index = path.join(dir, 'index.html');
  const rules = path.join(dir, 'rules.html');
  const test = path.join(dir, 'test.js');
  const icon = path.join(ROOT, 'games/assets/icons', `${g.slug}.svg`);
  let bytes = 0;

  if (!fs.existsSync(index)) problems.push('no index.html');
  else {
    const html = fs.readFileSync(index, 'utf8');
    bytes = Buffer.byteLength(html);
    if (bytes > 70 * 1024) problems.push(`index ${bytes}B > 70KB`);
    if (!html.includes(`kits/${g.family}.js`)) problems.push('kit not loaded');
    if (!html.includes('ArcadeKit.create')) problems.push('CORE not injected');
    if (!html.includes(`arcade.${g.slug}.best`)) problems.push('best key');
    const ext = [...html.matchAll(/<(script|link|img|iframe)([^>]*)>/g)]
      .map((m) => {
        const attrs = m[2];
        const rel = (attrs.match(/rel="([^"]+)"/) || [])[1] || '';
        if (m[1] === 'link' && !/stylesheet|preload|prefetch|icon/i.test(rel)) return null;
        return (attrs.match(/(?:src|href)="(https?:\/\/[^"]+)"/) || [])[1] || null;
      })
      .filter(Boolean);
    if (ext.length) problems.push('external: ' + ext[0]);
  }

  if (!fs.existsSync(rules)) problems.push('no rules.html');
  else {
    const html = fs.readFileSync(rules, 'utf8');
    const n = cjk(html);
    if (n < 1200 || n > 2000) problems.push(`rules CJK ${n}`);
    if (!/"@type":\s*"Article"/.test(html)) problems.push('rules Article');
    if (!/"@type":\s*"FAQPage"/.test(html)) problems.push('rules FAQPage');
    const q = (html.match(/"@type":\s*"Question"/g) || []).length;
    if (q < 5) problems.push(`rules FAQ ${q}`);
  }

  if (!fs.existsSync(test)) problems.push('no test.js');
  else {
    const r = spawnSync(process.execPath, [test], { cwd: ROOT, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) problems.push('test failed: ' + (out.match(/RESULT:.*/) || [''])[0].trim());
    else {
      const m = out.match(/(\d+) passed/);
      rows.push({ slug: g.slug, assertions: m ? +m[1] : 0 });
    }
  }

  if (!fs.existsSync(icon)) problems.push('no icon');

  if (problems.length) {
    console.log(`FAIL ${g.slug}: ${problems.join('; ')}`);
  } else {
    console.log(`OK   ${g.slug} ${(bytes / 1024).toFixed(1)}KB`);
  }
}

const failed = games.length - rows.length;
const totalAssertions = rows.reduce((a, r) => a + r.assertions, 0);
console.log(`\n${games.length} games, ${rows.length} pass, ${failed} fail, ${totalAssertions} assertions`);
process.exit(failed ? 1 : 0);
