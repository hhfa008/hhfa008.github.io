/*
 * run-all wrapper for the real dual-browser-context online E2E.
 *
 * The suite lives next to the game (../codenames-premium/online-e2e.mjs) and
 * uses the resident Chrome through CDP (chrome-ensure first). This wrapper
 * exists so `node games/boardgame/tests/run-all.mjs` discovers, runs and
 * reports the same gate as the manual command.
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SUITE = path.join(ROOT, 'codenames-premium', 'online-e2e.mjs');

const child = spawnSync(process.execPath, [SUITE], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 110000,
  maxBuffer: 20 * 1024 * 1024,
  env: Object.assign({}, process.env)
});

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);

const output = String(child.stdout || '');
const matches = output.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/g);
if (child.error && child.error.code === 'ETIMEDOUT') {
  console.log('RESULT: 0 passed, 1 failed');
  console.error('online-e2e timeout after 110s');
  process.exit(1);
}
if (!matches || child.status !== 0) {
  console.log('RESULT: 0 passed, 1 failed');
  console.error('online-e2e did not finish successfully (exit ' + child.status + ')');
  process.exit(1);
}
process.exit(0);
