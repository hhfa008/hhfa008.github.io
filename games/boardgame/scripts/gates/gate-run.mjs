#!/usr/bin/env node
/* Shared runner for the five acceptance gates. Each gate script exits 0 only
 * when every one of the 284 games passes that gate, and writes
 * games/boardgame/audit/gate-<name>.json with per-game evidence. */

import path from 'node:path';
import child from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.resolve(HERE, '..', 'verify-shipped.mjs');

export function runGate(gate) {
  const out = path.resolve(HERE, '..', '..', 'audit', 'gate-' + gate + '.json');
  const args = [VERIFY, '--gate', gate, '--gate-out', out];
  // Only the process gate needs the per-game unit-test run; the other four
  // read static artifacts + the committed smoke evidence.
  if (gate !== 'process') args.push('--no-tests');
  const result = child.spawnSync(process.execPath, args, {
    stdio: 'inherit',
    timeout: 600000
  });
  process.exit(result.status === 0 ? 0 : 1);
}
