#!/usr/bin/env node
/* 批量生成：按 families.mjs 的顺序逐款调用本地模型，断点续跑。
 *
 *   node tools/arcade/batch.mjs                 # 生成所有未完成的游戏
 *   node tools/arcade/batch.mjs --limit 5       # 本轮最多生成 5 款
 *   node tools/arcade/batch.mjs --only snake
 *   node tools/arcade/batch.mjs --force --only snake
 *
 * 单款失败不会中断批次；失败原因写入 tools/arcade/state.json 与 .test-failure.txt。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allGames } from './families.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = path.join(ROOT, 'tools/arcade/state.json');
const GEN = path.join(ROOT, 'tools/arcade/gen-game.mjs');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const limit = Number(arg('limit', '1000'));
const only = arg('only', null);
const port = arg('port', '8082');
const force = process.argv.includes('--force');
const shard = arg('shard', '1/1');
const [shardIdx, shardCount] = shard.split('/').map(Number);

function state() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}

const games = allGames().filter((g, i) => (only ? g.slug === only : (i % shardCount) === (shardIdx - 1)));
const st = state();
const todo = games.filter((g) => force || st[g.slug]?.status !== 'done').slice(0, limit);

console.log(`catalog=${games.length} todo=${todo.length} port=${port}`);
let started = Date.now();
for (let i = 0; i < todo.length; i++) {
  const g = todo[i];
  const t0 = Date.now();
  console.log(`\n=== [${i + 1}/${todo.length}] ${g.slug} (${g.zh}) ===`);
  const r = spawnSync(process.execPath, [GEN, '--slug', g.slug, '--port', port, '--attempts', '3', ...(force ? ['--force'] : [])], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`--- ${g.slug}: ${r.status === 0 ? 'OK' : 'FAILED'} in ${secs}s ---`);
}
console.log(`\nbatch done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
