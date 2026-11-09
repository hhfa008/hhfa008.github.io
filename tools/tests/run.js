'use strict';

/*
 * Tool suite: node tools/tests/run.js
 *
 * For every implemented tool: at least three valid inputs (manifest examples +
 * a boundary case) and at least one invalid input. Every valid case is also
 * replayed through tools/tests/parity.js, which extracts the original page
 * engine with vm and compares it to compute.js.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');
const manifest = require(path.join(__dirname, '..', 'manifest.json'));
const compute = require(path.join(__dirname, '..', 'shared', 'compute.js'));
const parity = require(path.join(__dirname, 'parity.js'));

const ROOT = path.join(__dirname, '..', '..');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function subset(expected, actual, at, diffs) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tol = 1e-9 + 1e-9 * Math.abs(expected);
    if (Math.abs(expected - actual) > tol) diffs.push(at + ': ' + actual + ' != ' + expected);
    return;
  }
  if (expected === null || expected === undefined) {
    if (expected !== actual) diffs.push(at + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { diffs.push(at + ': not an array'); return; }
    if (expected.length !== actual.length) { diffs.push(at + ': length ' + actual.length + ' != ' + expected.length); return; }
    expected.forEach((v, i) => subset(v, actual[i], at + '[' + i + ']', diffs));
    return;
  }
  if (typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) { diffs.push(at + ': not an object'); return; }
    Object.keys(expected).forEach(k => {
      if (!(k in actual)) diffs.push(at + '.' + k + ': missing');
      else subset(expected[k], actual[k], at + '.' + k, diffs);
    });
    return;
  }
  if (expected !== actual) diffs.push(at + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
}

const EXTRA = {
  'base64-encoder': [
    { input: { text: '你好', urlSafe: true }, expect: { text: '5L2g5aW9', bytes: 6 } },
    { input: { text: '' }, expect: { text: '', bytes: 0 } }
  ],
  'case-converter': [
    { input: { text: 'HTTP response code', mode: 'title' }, expect: { text: 'HTTP Response Code' } },
    { input: { text: 'foo bar', mode: 'constant' }, expect: { text: 'FOO_BAR' } }
  ],
  'slug-generator': [
    { input: { text: 'Hello, World!', maxLength: 5 }, expect: { slug: 'hello' } }
  ],
  'url-encoder': [
    { input: { action: 'decodeComponent', value: 'a+b%20c' }, expect: { value: 'a b c' } },
    { input: { action: 'buildQuery', pairs: [{ key: 'a', value: 1 }, { key: 'b', value: 'x y' }] }, expect: { value: 'a=1&b=x%20y', params: 2 } }
  ],
  'html-entity-encoder': [
    { input: { action: 'numeric', text: 'A你' }, expect: { text: '&#65;&#20320;' } },
    { input: { action: 'unescape', text: '&amp;lt;' }, expect: { text: '&lt;' } }
  ],
  'csv-to-json': [
    { input: { csv: '1,2\n3,4', hasHeader: false }, expect: { data: [['1', '2'], ['3', '4']], rowCount: 2 } },
    { input: { csv: 'a,b\n"x,y",2', inferTypes: true }, expect: { data: [{ a: 'x,y', b: 2 }], rowCount: 1 } }
  ],
  'json-to-csv': [
    { input: { data: [{ a: 1 }, { a: 2, b: 3 }] }, expect: { csv: 'a,b\r\n1,\r\n2,3\r\n', rowCount: 2 } },
    { input: { data: [{ a: 1 }], bom: true }, expect: { csv: '﻿a\r\n1\r\n', rowCount: 1 } }
  ],
  'json-formatter': [
    { input: { text: '{\n "a": 1\n}', minify: true }, expect: { text: '{"a":1}', minified: true } },
    { input: { text: '{"a":[1,2]}', indent: 4 }, expect: { summary: { type: 'object', arrays: 1, depth: 2 } } }
  ],
  'json-to-typescript': [
    { input: { text: '{"items":[{"id":1},{"id":2,"name":"x"}]}' }, expect: { rootName: 'Root', rootKind: 'object' } },
    { input: { text: '[1,2]', rootName: 'Nums' }, expect: { rootName: 'Nums', rootKind: 'array', interfaces: 0 } },
    { input: { text: '{"id":1}', mode: 'type' }, expect: { rootKind: 'object' } }
  ],
  'jwt-decoder': [
    { input: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJleHAiOjE3MDAwMDAwMDB9.sig', nowSeconds: 1700000001 }, expect: { status: { status: 'expired' } } },
    { input: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJleHAiOjE3MDAwMDAwMDB9.sig', nowSeconds: 1600000000 }, expect: { status: { status: 'active' } } }
  ],
  'text-diff': [
    { input: { a: 'a  b', b: 'a b', ignoreWhitespace: true }, expect: { stats: { changes: 0 } } },
    { input: { a: 'A\nb', b: 'a\nb', ignoreCase: true }, expect: { stats: { changes: 0, unchanged: 2 } } }
  ],
  'color-converter': [
    { input: { value: '#00ff00' }, expect: { hex: '#00ff00', rgb: { r: 0, g: 255, b: 0 }, hsl: { h: 120, s: 100, l: 50 }, name: 'lime' } }
  ],
  'number-base-converter': [
    { input: { value: '1010.11', fromBase: 2, toBase: 10 }, expect: { value: '10.75' } }
  ],
  'roman-numeral-converter': [
    { input: { value: 3999 }, expect: { roman: 'MMMCMXCIX', value: 3999 } },
    { input: { value: 'IV' }, expect: { value: 4, roman: 'IV' } }
  ],
  'fraction-calculator': [
    { input: { a: '3/4', op: '*', b: '2/5' }, expect: { fraction: '3/10', decimal: '0.3' } }
  ],
  'percentage-calculator': [
    { input: { mode: 'apply', a: 200, b: 10, direction: 'decrease' }, expect: { value: 180 } }
  ],
  'statistics-calculator': [
    { input: { text: '2, 4, 4, 6', sample: true }, expect: { count: 4, mean: 4, variance: 2.6666666666666665, stdev: 1.632993161855452, modes: [4] } }
  ],
  'unit-converter': [
    { input: { category: 'length', value: 1, from: 'mi' }, expect: { category: 'length', from: 'mi' } }
  ],
  'cooking-converter': [
    { input: { amount: 1, from: 'cup', to: 'g', ingredient: 'water' }, expect: { grams: 236.5882365, density: 1 } }
  ],
  'paper-size-converter': [
    { input: { mode: 'size', name: 'A4' }, expect: { name: 'A4', widthMm: 210, heightMm: 297, group: 'A' } }
  ],
  'aspect-ratio-calculator': [
    { input: { mode: 'scale', width: 1920, height: 1080, target: 1000, which: 'width' }, expect: { width: 1000, height: 562.5, scale: 0.5208333333333334 } }
  ],
  'loan-calculator': [
    { input: { principal: 100000, annualRate: 6, months: 12, extra: 1000 }, expect: { monthlyPayment: 8606.64 } }
  ],
  'compound-interest-calculator': [
    { input: { principal: 1000, annualRatePct: 5, years: 2, freq: 12, monthlyAdd: 100 }, expect: { principalTotal: 3400, deposits: 2400 } }
  ],
  'savings-goal-calculator': [
    { input: { mode: 'duration', target: 10000, current: 1000, annualRatePct: 3, monthly: 500 }, expect: { months: 18, projected: 10239.79, totalDeposits: 9000 } }
  ],
  'roi-calculator': [
    { input: { cost: 1000, return: 1500, years: 2 }, expect: { netGain: 500, roiPct: 50, annualizedPct: 22.474487139158896, multiple: 1.5, verdict: 'gain' } }
  ],
  'vat-calculator': [
    { input: { mode: 'extract', amount: 113, ratePct: 13 }, expect: { net: 100, tax: 13, gross: 113 } }
  ],
  'profit-margin-calculator': [
    { input: { mode: 'target', cost: 60, targetMarginPct: 40 }, expect: { price: 100, marginPct: 40 } }
  ],
  'bmi-calculator': [
    { input: { heightCm: 100, weightKg: 18.5 }, expect: { bmi: 18.5, category: 'normal' } },
    { input: { heightCm: 100, weightKg: 18.4 }, expect: { bmi: 18.4, category: 'underweight' } }
  ],
  'quadratic-solver': [
    { input: { a: 0, b: 2, c: -4 }, expect: { mode: 'linear', roots: [{ re: 2, im: 0 }] } },
    { input: { a: 1, b: 0, c: 1 }, expect: { mode: 'complex', roots: [{ re: 0, im: 1 }, { re: 0, im: -1 }] } }
  ],
  'gcd-lcm-calculator': [
    { input: { mode: 'lcm', values: [4, 6] }, expect: { value: '12' } },
    { input: { mode: 'factorize', values: [360] }, expect: { formatted: '2³ × 3² × 5', factors: [{ p: '2', e: 3 }, { p: '3', e: 2 }, { p: '5', e: 1 }] } }
  ],
  'date-calculator': [
    { input: { mode: 'add', from: '2024-02-29', days: 1 }, expect: { date: '2024-03-01', weekday: 4 } },
    { input: { mode: 'business', from: '2024-01-01', to: '2024-01-08' }, expect: { days: 5 } },
    { input: { mode: 'age', from: '1990-05-15', to: '2024-05-15' }, expect: { years: 34, months: 0, days: 0, isBirthdayToday: true } }
  ],
  'unix-timestamp-converter': [
    { input: { value: 1700000000, offsetMinutes: 480 }, expect: { unixSeconds: 1700000000, isoWithOffset: '2023-11-15T06:13:20.000+08:00' } }
  ],
  'timezone-converter': [
    { input: { local: '2024-03-10T01:30', from: 'America/New_York', to: 'UTC' }, expect: { epoch: 1710052200000, to: '2024-03-10T06:30:00', offsetFrom: '-05:00', offsetTo: '+00:00' } },
    { input: { local: '2024-01-01T09:00', from: 'Asia/Shanghai', to: 'UTC' }, expect: { epoch: 1704070800000, to: '2024-01-01T01:00:00', offsetFrom: '+08:00', dayDelta: 0 } }
  ],
  'hash-generator': [
    { input: { text: 'abc', algorithm: 'SHA-1' }, expect: { algorithm: 'SHA-1', bytes: 20, hex: 'a9993e364706816aba3e25717850c26c9cd0d89d' } }
  ],
  'uuid-generator': [
    { input: { count: 2, seed: 42 }, expect: { count: 2, uuids: ['9972daab-2c86-459f-9d78-3fe1be4e3280', 'af9c0078-d60d-4708-840f-2fc887062cd7'] } },
    { input: { count: 1, uppercase: true, hyphens: false, seed: 7 }, expect: { count: 1 } }
  ]
};

const INVALID = {
  'base64-encoder': [{ text: 123 }, { action: 'nope', text: 'x' }],
  'case-converter': [{ text: 123 }, { text: 'x', mode: 'nope' }],
  'slug-generator': [{ text: 123 }, { text: 'x', separator: '/' }],
  'url-encoder': [{ action: 'decodeComponent', value: '%E0%A4%A' }, { action: 'nope', value: 'x' }],
  'html-entity-encoder': [{ text: 123 }, { text: 'x', mode: 'nope' }],
  'csv-to-json': [{ csv: 123 }, { csv: 'a', delimiter: ';;' }],
  'json-to-csv': [{ json: '{bad}' }, { json: '123' }],
  'json-formatter': [{ text: '{bad}' }, { text: 123 }],
  'json-to-typescript': [{ text: '{bad}' }, { text: 123 }],
  'jwt-decoder': [{ token: 'abc' }, { token: 123 }],
  'text-diff': [{ a: 1, b: 'x' }],
  'color-converter': [{ value: 'notacolor' }, { value: 123 }],
  'number-base-converter': [{ value: '2', fromBase: 2, toBase: 10 }, { value: '1', fromBase: 1, toBase: 10 }],
  'roman-numeral-converter': [{ value: 4000 }, { value: 'ABC' }],
  'fraction-calculator': [{ a: '1/0', b: '1/2' }, { a: '1/2', op: '%', b: '1/3' }],
  'percentage-calculator': [{ mode: 'whatPercent', a: 1, b: 0 }, { mode: 'nope', a: 1, b: 2 }],
  'statistics-calculator': [{ values: [] }, { text: 'a,b' }],
  'unit-converter': [{ category: 'length', value: 1, from: 'parsec', to: 'm' }, { category: 'nope', value: 1, from: 'm', to: 'cm' }],
  'cooking-converter': [{ amount: -1, from: 'cup', to: 'g', ingredient: 'water' }, { amount: 1, from: 'cup', to: 'g', ingredient: 'nope' }],
  'paper-size-converter': [{ mode: 'size', name: 'Z9' }, { mode: 'pixels', name: 'A4', dpi: 0 }],
  'aspect-ratio-calculator': [{ mode: 'ratio', width: 0, height: 10 }, { mode: 'height', width: 10, ratioW: 0, ratioH: 9 }],
  'loan-calculator': [{ principal: 0, annualRate: 5, months: 12 }, { principal: 1000, annualRate: 5, months: 0 }],
  'compound-interest-calculator': [{ principal: 1000, annualRatePct: 5, years: 101 }, { principal: 1000, annualRatePct: 5, years: 2, freq: 3 }],
  'savings-goal-calculator': [{ mode: 'plan', target: 0, months: 12 }, { mode: 'duration', target: 1000, monthly: 0 }],
  'roi-calculator': [{ cost: 0, return: 100 }, { cost: 100, return: 150, years: 0 }],
  'vat-calculator': [{ mode: 'add', amount: -1, ratePct: 10 }, { mode: 'add', amount: 100, ratePct: 101 }],
  'profit-margin-calculator': [{ mode: 'calc', cost: 0, price: 10 }, { mode: 'target', cost: 10, targetMarginPct: 100 }],
  'bmi-calculator': [{ heightCm: 0, weightKg: 70 }, { heightCm: 175, weightKg: 70, sex: 'other', age: 30 }],
  'quadratic-solver': [{ a: 'x', b: 1, c: 1 }, { a: 1e13, b: 0, c: 1 }],
  'gcd-lcm-calculator': [{ mode: 'gcd', values: ['1', 'x'] }, { mode: 'nope', values: [1, 2] }],
  'date-calculator': [{ mode: 'diff', from: '2023-02-29', to: '2024-01-01' }, { mode: 'add', from: '2024-01-01' }],
  'unix-timestamp-converter': [{ value: 'not-a-date' }, { value: 1700000000, unit: 'minutes' }],
  'timezone-converter': [{ local: '2024-01-01T09:00', from: 'Mars/Base', to: 'UTC' }, { local: '2024-13-01T00:00', from: 'UTC', to: 'UTC' }],
  'hash-generator': [{ text: 123 }, { text: 'x', algorithm: 'MD5' }],
  'uuid-generator': [{ count: 0 }, { count: 101 }]
};

function foundTool(id) {
  return manifest.tools.find(t => t.id === id);
}

async function runToolCases() {
  const implemented = manifest.tools.filter(t => t.implemented);
  for (const tool of implemented) {
    const id = tool.id;
    const valid = tool.examples.map(e => ({ input: e.input, expect: e.output })).concat(EXTRA[id] || []);
    ok(id + ': has >=3 valid cases', valid.length >= 3, 'got ' + valid.length);
    const invalid = INVALID[id] || [];
    ok(id + ': has >=1 invalid case', invalid.length >= 1);

    for (const c of valid) {
      const label = id + ' ' + JSON.stringify(c.input);
      const result = await Promise.resolve(compute.run(id, c.input));
      ok(label + ' ok', result.ok === true, JSON.stringify(result).slice(0, 200));
      if (!result.ok) continue;
      ok(label + ' result is object', result.result !== null && typeof result.result === 'object' && !Array.isArray(result.result));

      const diffs = [];
      subset(c.expect, result.result, '$', diffs);
      ok(label + ' expected fields', diffs.length === 0, diffs.slice(0, 6).join('; '));

      if (id === 'uuid-generator' && c.input.hyphens === false) {
        const value = result.result.uuids[0];
        ok(label + ' uppercase/no-hyphen uuid', typeof value === 'string' && value === value.toUpperCase() && value.indexOf('-') === -1 && value.length === 32, value);
      }

      const parityResult = await parity.check(id, c.input);
      ok(label + ' parity with page engine', parityResult.ok, parityResult.diffs.slice(0, 5).join('; '));
    }

    for (const input of invalid) {
      const result = await Promise.resolve(compute.run(id, input));
      const label = id + ' invalid ' + JSON.stringify(input);
      ok(label + ' ok=false', result.ok === false, JSON.stringify(result).slice(0, 200));
      ok(label + ' code=invalid_input', result.code === 'invalid_input', 'got ' + result.code + ' (' + result.error + ')');
    }
  }
}

function testManifest() {
  ok('manifest has 101 tools', manifest.toolCount === 101, 'got ' + manifest.toolCount);
  ok('manifest tools length matches', manifest.tools.length === 101, 'got ' + manifest.tools.length);
  ok('implemented count >= 20', manifest.implementedCount >= 20, 'got ' + manifest.implementedCount);
  const ids = manifest.tools.map(t => t.id);
  ok('tool ids are unique', new Set(ids).size === ids.length);
  ok('all tools have page /tools/<id>/', manifest.tools.every(t => t.page === '/tools/' + t.id + '/'));
  ok('all tools have zh/en/id titles', manifest.tools.every(t => t.title && t.title.zh && t.title.en && t.title.id));
  ok('all tools have a summary', manifest.tools.every(t => typeof t.summary === 'string' && t.summary.length > 0));
  const impl = manifest.tools.filter(t => t.implemented);
  ok('implemented tools have inputs', impl.every(t => Array.isArray(t.inputs) && t.inputs.length > 0));
  ok('implemented tools have outputs', impl.every(t => Array.isArray(t.outputs) && t.outputs.length > 0));
  ok('implemented tools have examples', impl.every(t => Array.isArray(t.examples) && t.examples.length > 0));
  ok('implemented tools have cli string', impl.every(t => typeof t.cli === 'string' && t.cli.indexOf('tools/cli.js run') !== -1));
  ok('implemented tools have parity tag', impl.every(t => t.parity === 'extracted' || t.parity === 'recorded'));
  ok('example input keys are declared', impl.every(t => {
    const names = new Set(t.inputs.map(i => i.name));
    return t.examples.every(e => Object.keys(e.input).every(k => names.has(k)));
  }));
  ok('example output keys are declared', impl.every(t => {
    const names = new Set(t.outputs.map(o => o.name));
    return t.examples.every(e => Object.keys(e.output).every(k => names.has(k)));
  }));
  ok('example inputs carry all required fields', impl.every(t => {
    const required = t.inputs.filter(i => i.required).map(i => i.name);
    return t.examples.every(e => required.every(k => k in e.input));
  }));
  const blocked = manifest.tools.filter(t => !t.implemented);
  ok('unimplemented tools carry blockedBy', blocked.every(t => typeof t.blockedBy === 'string' && t.blockedBy.length > 0));
  ok('compute ids cover manifest implemented tools', impl.every(t => compute.has(t.id)));
  ok('compute exposes 35 ids', compute.ids.length === impl.length, 'got ' + compute.ids.length);
}

async function testCli() {
  const ids = ['base64-encoder', 'unit-converter', 'bmi-calculator', 'color-converter', 'hash-generator'];
  ok('CLI sample covers 5 tools', ids.length === 5);

  for (const id of ids) {
      const tool = foundTool(id);
      const input = tool.examples[0].input;
      const expected = await Promise.resolve(compute.run(id, input));
      let parsed = null;
      let exitCode = null;
      try {
        const out = execFileSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'run', id, '--json', JSON.stringify(input)], { cwd: ROOT, encoding: 'utf8' });
        parsed = JSON.parse(out);
        exitCode = 0;
      } catch (e) {
        exitCode = e.status;
        parsed = e.stdout ? JSON.parse(e.stdout) : null;
      }
      ok('CLI ' + id + ' exit 0', exitCode === 0, 'got ' + exitCode);
      ok('CLI ' + id + ' ok=true', parsed && parsed.ok === true);
      ok('CLI ' + id + ' result == compute', parsed && JSON.stringify(parsed.result) === JSON.stringify(expected.result));
    }

    const notImpl = spawnSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'run', 'qr-code-generator', '--json', '{}'], { cwd: ROOT, encoding: 'utf8' });
    ok('CLI not implemented exit 3', notImpl.status === 3, 'got ' + notImpl.status);
    const unknown = spawnSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'run', 'nope', '--json', '{}'], { cwd: ROOT, encoding: 'utf8' });
    ok('CLI unknown tool exit 4', unknown.status === 4, 'got ' + unknown.status);
    const badInput = spawnSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'run', 'bmi-calculator', '--json', '{"heightCm":0}'], { cwd: ROOT, encoding: 'utf8' });
    ok('CLI invalid input exit 2', badInput.status === 2, 'got ' + badInput.status);

    const list = JSON.parse(execFileSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'list'], { cwd: ROOT, encoding: 'utf8' }));
    ok('CLI list default only implemented', list.count === manifest.implementedCount, 'got ' + list.count);
    const listAll = JSON.parse(execFileSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'list', '--all'], { cwd: ROOT, encoding: 'utf8' }));
    ok('CLI list --all returns 101', listAll.count === 101, 'got ' + listAll.count);
    const schema = JSON.parse(execFileSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'schema', 'bmi-calculator'], { cwd: ROOT, encoding: 'utf8' }));
    ok('CLI schema returns inputs', schema.ok && schema.tool.inputs.length > 0);
    const search = JSON.parse(execFileSync(NODE, [path.join(ROOT, 'tools/cli.js'), 'search', 'base64'], { cwd: ROOT, encoding: 'utf8' }));
    ok('CLI search finds base64-encoder', search.tools.some(t => t.id === 'base64-encoder'));
}

async function testMcp() {
  const lines = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bmi-calculator', arguments: { heightCm: 175, weightKg: 70 } } })
  ].join('\n') + '\n';
  const child = spawnSync(NODE, [path.join(ROOT, 'tools/mcp-server.js')], { cwd: ROOT, input: lines, encoding: 'utf8' });
  ok('MCP server exits 0', child.status === 0, 'got ' + child.status + ' ' + (child.stderr || '').slice(0, 200));
  const replies = (child.stdout || '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const byId = {};
  replies.forEach(r => { byId[r.id] = r; });
  ok('MCP initialize protocolVersion', byId[1] && byId[1].result.protocolVersion === '2024-11-05');
  ok('MCP tools/list returns 101', byId[2] && byId[2].result.tools.length === 101, byId[2] ? String(byId[2].result.tools.length) : 'missing');
  const call = byId[3];
  ok('MCP tools/call isError=false', call && call.result && call.result.isError === false);
  let text = null;
  try { text = JSON.parse(call.result.content[0].text); } catch (e) { /* checked below */ }
  ok('MCP tools/call text is JSON', text !== null);
  ok('MCP tools/call result bmi', text && text.result && text.result.bmi === 22.8571, text ? JSON.stringify(text).slice(0, 200) : '');
  const schema = byId[2] && byId[2].result.tools.find(t => t.name === 'bmi-calculator');
  ok('MCP inputSchema required heightCm', schema && schema.inputSchema.required.indexOf('heightCm') !== -1);
  const blocked = byId[2] && byId[2].result.tools.find(t => t.name === 'qr-code-generator');
  ok('MCP non-implemented described as blocked', blocked && blocked.description.indexOf('[not implemented]') === 0);
}

function testUmd() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'shared', 'compute.js'), 'utf8');
  const sandbox = {
    TextEncoder, TextDecoder, Intl, BigInt, Math, JSON, Array, Object, Date,
    String, Number, Boolean, RegExp, Map, Set, Uint8Array, ArrayBuffer, Promise, console,
    crypto: globalThis.crypto
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'compute.js' });
  ok('compute.js installs browser global ToolCompute', sandbox.ToolCompute && typeof sandbox.ToolCompute.run === 'function');
  const result = sandbox.ToolCompute && sandbox.ToolCompute.run('unit-converter', { category: 'length', value: 1, from: 'km', to: 'm' });
  ok('browser UMD path computes', result && result.ok === true && result.result.value === 1000, JSON.stringify(result));
}

async function main() {
  testManifest();
  testUmd();
  await runToolCases();
  await testCli();
  await testMcp();

  console.log('');
  console.log('tools=' + manifest.toolCount + ' implemented=' + manifest.implementedCount);
  console.log('总计: ' + passed + ' 通过, ' + failed + ' 失败');
  if (failures.length) {
    failures.slice(0, 60).forEach(f => console.log('  FAIL: ' + f));
    if (failures.length > 60) console.log('  ... ' + (failures.length - 60) + ' more');
  }
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
