#!/usr/bin/env node
/* Run all five acceptance gates sequentially and aggregate the result.
 * Exit 0 only when every gate passes for every game; otherwise exit 1.
 * Writes games/boardgame/audit/gates-all.json. */

import fs from 'node:fs';
import path from 'node:path';
import child from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.resolve(HERE, '..', 'verify-shipped.mjs');
const AUDIT = path.resolve(HERE, '..', '..', 'audit');
const GATES = ['process', 'art', 'realism', 'mobile', 'online'];

const results = [];
for (const gate of GATES) {
  const out = path.join(AUDIT, 'gate-' + gate + '.json');
  const args = [VERIFY, '--gate', gate, '--gate-out', out];
  if (gate !== 'process') args.push('--no-tests');
  const started = Date.now();
  const r = child.spawnSync(process.execPath, args, { stdio: 'inherit', timeout: 600000 });
  let report = null;
  try { report = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* gate may not have written */ }
  results.push({
    gate,
    exitCode: r.status === null ? 'timeout' : r.status,
    durationMs: Date.now() - started,
    total: report ? report.total : null,
    pass: report ? report.pass : null,
    fail: report ? report.fail : null
  });
}

const allPass = results.every((r) => r.exitCode === 0);
fs.mkdirSync(AUDIT, { recursive: true });
fs.writeFileSync(path.join(AUDIT, 'gates-all.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  allPass,
  results
}, null, 2) + '\n');
console.log(JSON.stringify({ allPass, results }, null, 2));
process.exit(allPass ? 0 : 1);
