'use strict';

/*
 * L4 contract: dsh plugin packaging.
 *
 * A plugin is discovered by a manifest (plugin/manifest.json, dsh/manifest.json
 * or a root plugin.json). Missing manifest => SKIP.
 *
 * Manifest contract:
 *   { id|name, version (semver), main|entry, capabilities[], errorCodes{} }
 * Entry contract:
 *   activate(host) / deactivate() / invoke(tool, args) / tools
 * Invocation must reject unknown tools with E_UNKNOWN_TOOL and bad arguments
 * with E_INVALID_ARGS. No real dsh host is required: a fake host is injected.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createSuite } from './lib/suite.mjs';
import { ROOT, fnOf } from './lib/probe.mjs';
import { DSH, call } from './lib/contracts.mjs';

const MANIFESTS = [
  'plugin/manifest.json',
  'plugin/dsh-plugin.json',
  'dsh/manifest.json',
  'plugins/manifest.json',
  'manifest.dsh.json',
  'plugin.json',
  'dsh-plugin.json',
  'dsh.plugin.json'
];

const ENTRY_EXTENSIONS = ['', '.mjs', '.js', '/index.mjs', '/index.js'];

function findManifest() {
  for (const rel of MANIFESTS) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) return { rel: rel, abs: abs };
  }
  return null;
}

function resolveEntry(manifestRel, manifest) {
  const declared = manifest.main || manifest.entry || manifest.module || manifest.entryPoint;
  const baseDir = path.dirname(path.join(ROOT, manifestRel));
  const candidates = [];
  if (declared) {
    for (const ext of ENTRY_EXTENSIONS) candidates.push(path.join(baseDir, declared + ext));
    candidates.push(path.join(ROOT, declared));
  }
  candidates.push(path.join(baseDir, 'index.mjs'), path.join(baseDir, 'index.js'),
    path.join(baseDir, 'plugin.mjs'), path.join(baseDir, 'plugin.js'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function errorCodeOf(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value.code) return value.code;
  if (value.error) {
    if (typeof value.error === 'string') return value.code || value.error;
    return value.error.code || value.error.type;
  }
  return undefined;
}

async function invokeResult(invoke, thisArg, tool, args) {
  try {
    const value = await call(invoke, thisArg, [tool, args]);
    return { threw: false, value: value };
  } catch (err) {
    return { threw: true, error: err, code: errorCodeOf(err) };
  }
}

function isErrorResult(result) {
  if (result.threw) return true;
  const value = result.value;
  return Boolean(value && typeof value === 'object' &&
    (value.ok === false || value.success === false || value.error || value.code));
}

const s = createSuite('boardgame-dsh-plugin');

function freePort() {
  return new Promise(function (resolve, reject) {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      const port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitHealthy(base) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) {
        const body = await res.json();
        if (body && body.ok === true) return { ok: true, body: body };
      }
    } catch (err) { /* keep polling */ }
    await sleep(100);
  }
  return { ok: false };
}

/*
 * The plugin defaults to 127.0.0.1:3000. A developer may or may not have a
 * boardgame service there, so the contract starts its own loopback instance
 * and injects it through host.config.baseUrl. This keeps the invocation test
 * deterministic (no dependency on a stale local server).
 */
const port = await freePort();
const serviceBase = 'http://127.0.0.1:' + port;
const service = spawn(process.execPath, [path.join(ROOT, 'app', 'server.mjs'), '--port', String(port)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { BOARDGAME_API_TOKEN: '' })
});
let serviceStderr = '';
service.stderr.on('data', function (chunk) { serviceStderr += chunk.toString(); });
service.stdout.on('data', function () {});

try {
  const serviceHealth = await waitHealthy(serviceBase);
  s.ok('test boardgame service is up for plugin invocation', serviceHealth.ok, serviceBase);

  await s.run(async () => {
  const manifestFile = findManifest();
  if (!manifestFile) {
    s.skip('dsh plugin contract', 'none of ' + MANIFESTS.join(', ') + ' exist yet');
    return;
  }

  let manifest;
  await s.group('manifest', async () => {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile.abs, 'utf8'));
      s.ok('manifest 可解析为 JSON', manifest != null && typeof manifest === 'object');
    } catch (err) {
      s.ok('manifest 可解析为 JSON', false, err && err.message ? err.message : String(err));
      return;
    }
    if (!manifest) return;

    s.ok('manifest 有 id 或 name',
      typeof (manifest.id || manifest.name) === 'string' && String(manifest.id || manifest.name).length > 0,
      JSON.stringify(manifest.id || manifest.name));
    s.matches('version 是 semver', String(manifest.version || ''), /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    s.ok('声明入口 main/entry/module', typeof (manifest.main || manifest.entry || manifest.module) === 'string',
      JSON.stringify(manifest.main || manifest.entry || manifest.module));
    s.ok('capabilities 为数组', Array.isArray(manifest.capabilities), JSON.stringify(manifest.capabilities));
    s.ok('声明 errorCodes', manifest.errorCodes != null, JSON.stringify(manifest.errorCodes));
    const codes = JSON.stringify(manifest.errorCodes || {});
    s.includes('错误码含 E_UNKNOWN_TOOL', codes, 'E_UNKNOWN_TOOL');
    s.includes('错误码含 E_INVALID_ARGS', codes, 'E_INVALID_ARGS');
  });

  if (!manifest) return;

  const entry = resolveEntry(manifestFile.rel, manifest);
  await s.group('entry module', async () => {
    s.ok('入口文件存在', entry !== null, 'declared ' + String(manifest.main || manifest.entry || manifest.module));
  });
  if (!entry) return;

  let mod;
  try {
    mod = await import(pathToFileURL(entry).href);
  } catch (err) {
    s.ok('入口模块可导入', false, err && (err.stack || err.message || String(err)));
    return;
  }
  const api = mod.default && typeof mod.default === 'object' ? Object.assign({}, mod.default, mod) : mod;
  const activate = fnOf(api, DSH.activate);
  const deactivate = fnOf(api, DSH.deactivate);
  const invoke = fnOf(api, DSH.invoke);
  const tools = fnOf(api, DSH.tools);

  await s.group('plugin API', async () => {
    s.ok('导出 activate/register', typeof activate === 'function', 'expected ' + DSH.activate.join(' / '));
    s.ok('导出 invoke/handle', typeof invoke === 'function', 'expected ' + DSH.invoke.join(' / '));
    s.ok('导出 tools 列表（可选但推荐）', tools !== undefined, 'expected ' + DSH.tools.join(' / '));
    s.ok('导出 deactivate（可选）', deactivate === undefined || typeof deactivate === 'function');
  });

  if (!activate && !invoke) return;

  const host = {
    log: function () {},
    config: { env: 'test', baseUrl: serviceBase, timeoutMs: 2000, retries: 0 },
    storage: {
      get: function () { return undefined; },
      set: function () {},
      delete: function () {}
    },
    registerTool: function () {}
  };

  await s.group('activation', async () => {
    if (!activate) return;
    try {
      await call(activate, null, [host]);
      s.ok('activate(host) 不抛错', true);
    } catch (err) {
      s.ok('activate(host) 不抛错', false, err && err.message ? err.message : String(err));
    }
  });

  let toolList = [];
  await s.group('tool list', async () => {
    if (!tools) {
      s.skip('tools list', 'no tools/listTools export');
      return;
    }
    try {
      const value = await call(tools, null, []);
      toolList = Array.isArray(value) ? value : (value && Array.isArray(value.tools) ? value.tools : []);
      s.ok('tools() 返回数组', Array.isArray(toolList), JSON.stringify(value).slice(0, 200));
      const named = toolList.filter(function (tool) { return tool && typeof tool.name === 'string'; });
      s.eq('每个工具都有 name', named.length, toolList.length);
      if (toolList.length > 0) {
        s.ok('工具带描述或 inputSchema',
          toolList.every(function (tool) {
            return tool && (typeof tool.description === 'string' || tool.inputSchema || tool.parameters);
          }),
          JSON.stringify(toolList[0]).slice(0, 200));
      }
    } catch (err) {
      s.ok('tools() 不抛错', false, err && err.message ? err.message : String(err));
    }
  });

  if (!invoke) return;

  await s.group('invocation protocol', async () => {
    const unknown = await invokeResult(invoke, null, '__definitely_unknown_tool__', {});
    s.ok('未知工具被拒绝', isErrorResult(unknown), JSON.stringify(unknown.value));
    const unknownCode = unknown.threw ? unknown.code : errorCodeOf(unknown.value);
    s.eq('未知工具错误码 E_UNKNOWN_TOOL', unknownCode, 'E_UNKNOWN_TOOL');

    const tool = toolList.find(function (item) { return item && typeof item.name === 'string'; });
    if (!tool) {
      s.skip('known tool invocation', '工具列表为空或没有可调用工具');
      return;
    }

    const invalid = await invokeResult(invoke, null, tool.name, null);
    const required = tool.inputSchema && Array.isArray(tool.inputSchema.required)
      ? tool.inputSchema.required
      : (tool.required || []);
    if (required.length > 0 || isErrorResult(invalid)) {
      s.ok('缺少必填参数被拒绝', isErrorResult(invalid) || required.length === 0,
        JSON.stringify(invalid.value));
      if (isErrorResult(invalid)) {
        const code = invalid.threw ? invalid.code : errorCodeOf(invalid.value);
        s.eq('参数错误码 E_INVALID_ARGS', code, 'E_INVALID_ARGS');
      } else {
        s.skip('E_INVALID_ARGS 断言', '工具没有必填参数，无法构造参数错误');
      }
    } else {
      s.skip('E_INVALID_ARGS 断言', '工具没有必填参数，无法构造参数错误');
    }

    const valid = await invokeResult(invoke, null, tool.name, {});
    if (valid.threw) {
      s.ok('合法工具调用返回可读结果或领域错误',
        valid.code === 'E_INVALID_ARGS' || /required|invalid|missing/i.test(valid.error && valid.error.message || ''),
        String(valid.error && valid.error.message));
    } else {
      const value = valid.value;
      s.ok('合法工具调用返回对象', value != null && typeof value === 'object', JSON.stringify(value).slice(0, 200));
      s.ok('结果含 ok/success/result/error 之一',
        value && (value.ok !== undefined || value.success !== undefined ||
          value.result !== undefined || value.error !== undefined),
        JSON.stringify(value).slice(0, 200));
    }
  });

  await s.group('deactivation', async () => {
    if (!deactivate) {
      s.skip('deactivate', 'no deactivate export');
      return;
    }
    try {
      await call(deactivate, null, [host]);
      s.ok('deactivate() 不抛错', true);
    } catch (err) {
      s.ok('deactivate() 不抛错', false, err && err.message ? err.message : String(err));
    }
  });
  });
} finally {
  try { service.kill('SIGTERM'); } catch (err) { /* ignore */ }
  await sleep(150);
  try { service.kill('SIGKILL'); } catch (err) { /* ignore */ }
  if (serviceStderr) {
    process.stderr.write('[dsh-plugin] server stderr (tail):\n' + serviceStderr.slice(-2000) + '\n');
  }
}
