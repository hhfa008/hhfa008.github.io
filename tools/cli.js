#!/usr/bin/env node
'use strict';

/* Tool CLI — machine-readable front end for tools/manifest.json + shared/compute.js.
 *
 * Exit codes: 0 ok, 2 invalid input, 3 not implemented, 4 unknown tool.
 * stdout is always a single JSON document; diagnostics never go to stdout.
 */

const fs = require('fs');
const path = require('path');
const manifest = require(path.join(__dirname, 'manifest.json'));
const compute = require(path.join(__dirname, 'shared', 'compute.js'));

const EXIT = { OK: 0, INVALID: 2, NOT_IMPLEMENTED: 3, UNKNOWN: 4 };

function emit(value, code) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  process.exitCode = code == null ? 0 : code;
}

function fail(error, code) {
  emit({ ok: false, error: error }, code);
}

function findTool(id) {
  return manifest.tools.find(t => t.id === id) || null;
}

function summaryOf(tool) {
  return {
    id: tool.id,
    title: tool.title,
    summary: tool.summary,
    implemented: tool.implemented,
    page: tool.page,
    blockedBy: tool.blockedBy
  };
}

function parseArgs(argv) {
  const args = argv.slice();
  const opts = { json: null, stdin: false, all: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts.json = args[++i];
      } else {
        opts.json = '';
      }
    } else if (arg.startsWith('--json=')) {
      opts.json = arg.slice('--json='.length);
    } else if (arg === '--stdin') {
      opts.stdin = true;
    } else if (arg === '--all') {
      opts.all = true;
    } else if (arg.startsWith('--')) {
      throw new Error('unknown option: ' + arg);
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function cmdList(opts) {
  const tools = manifest.tools
    .filter(t => opts.all || t.implemented)
    .map(summaryOf);
  emit({
    ok: true,
    count: tools.length,
    implementedCount: manifest.implementedCount,
    toolCount: manifest.toolCount,
    tools
  }, EXIT.OK);
}

function cmdSchema(positional) {
  const id = positional[0];
  if (!id) return fail('usage: node tools/cli.js schema <id>', EXIT.INVALID);
  const tool = findTool(id);
  if (!tool) return fail('unknown tool: ' + id, EXIT.UNKNOWN);
  emit({ ok: true, tool }, EXIT.OK);
}

async function cmdRun(positional, opts) {
  const id = positional[0];
  if (!id) return fail('usage: node tools/cli.js run <id> --json {...} | --stdin', EXIT.INVALID);
  const tool = findTool(id);
  if (!tool) return fail('unknown tool: ' + id, EXIT.UNKNOWN);
  if (!tool.implemented) {
    emit({ ok: false, error: 'tool is not implemented in the compute core', tool: id, blockedBy: tool.blockedBy }, EXIT.NOT_IMPLEMENTED);
    return;
  }

  let raw;
  if (opts.stdin) raw = await readStdin();
  else if (opts.json != null) raw = opts.json;
  else return fail('missing input: pass --json {...} or --stdin', EXIT.INVALID);

  let input;
  try {
    input = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch (e) {
    return fail('invalid JSON input: ' + e.message, EXIT.INVALID);
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('input must be a JSON object', EXIT.INVALID);
  }

  const result = await Promise.resolve(compute.run(id, input));
  if (!result.ok) {
    emit({ ok: false, error: result.error, code: result.code, tool: id }, EXIT.INVALID);
    return;
  }
  emit({ ok: true, tool: id, result: result.result }, EXIT.OK);
}

function cmdSearch(positional, opts) {
  const keyword = positional.join(' ').trim().toLowerCase();
  if (!keyword) return fail('usage: node tools/cli.js search <keyword>', EXIT.INVALID);
  const matches = manifest.tools.filter(t => {
    if (!opts.all && !t.implemented) return false;
    const haystack = [
      t.id, t.summary,
      t.title && t.title.zh, t.title && t.title.en, t.title && t.title.id
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.indexOf(keyword) !== -1;
  }).map(summaryOf);
  emit({ ok: true, keyword: keyword, count: matches.length, tools: matches }, EXIT.OK);
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const command = positional.shift();

  if (command === 'list') return cmdList(opts);
  if (command === 'schema') return cmdSchema(positional);
  if (command === 'run') return cmdRun(positional, opts);
  if (command === 'search') return cmdSearch(positional, opts);
  if (command === 'help' || command === '--help' || command === '-h') {
    emit({
      ok: true,
      usage: [
        'node tools/cli.js list [--all]',
        'node tools/cli.js schema <id>',
        'node tools/cli.js run <id> --json {...}',
        'node tools/cli.js run <id> --stdin',
        'node tools/cli.js search <keyword> [--all]'
      ],
      exitCodes: { 0: 'ok', 2: 'invalid input', 3: 'not implemented', 4: 'unknown tool' }
    }, EXIT.OK);
    return;
  }
  fail('unknown command: ' + (command || '(none)') + '; try `node tools/cli.js help`', EXIT.INVALID);
}

main().catch(e => {
  fail('internal error: ' + (e && e.message ? e.message : String(e)), EXIT.INVALID);
});
