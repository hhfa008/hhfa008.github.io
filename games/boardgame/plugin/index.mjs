'use strict';

/*
 * dsh 插件入口：把本地桌游 HTTP/JSON API 暴露成 dsh 工具。
 *
 * 契约：activate(host) / deactivate() / invoke(tool, args) / tools()
 * - 未知工具：code = E_UNKNOWN_TOOL
 * - 参数缺失/非法：code = E_INVALID_ARGS
 * - 网络/5xx：自动重试（默认 2 次），最终 code = E_HTTP
 * - 可选鉴权：BOARDGAME_API_TOKEN 或 host.config.token，Bearer 头
 * - 超时：默认 3000ms，可用 host.config.timeoutMs 覆盖
 */

const DEFAULT_BASE = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT = 3000;
const DEFAULT_RETRIES = 2;

let activeHost = null;

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function configOf() {
  const config = (activeHost && activeHost.config) || {};
  return {
    baseUrl: config.baseUrl || process.env.BOARDGAME_API_BASE_URL || DEFAULT_BASE,
    token: config.token || process.env.BOARDGAME_API_TOKEN || '',
    timeoutMs: Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT,
    retries: Number.isInteger(config.retries) ? Math.max(0, config.retries) : DEFAULT_RETRIES
  };
}

async function request(path, options) {
  const opts = options || {};
  const config = configOf();
  const url = config.baseUrl.replace(/\/+$/, '') + path;
  const headers = { accept: 'application/json' };
  if (config.token) headers.authorization = 'Bearer ' + config.token;
  if (opts.deviceId) headers['x-device-id'] = opts.deviceId;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let lastError = null;
  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (err) { data = { raw: text }; }
      }
      if (response.status >= 500 && attempt < config.retries) {
        lastError = new Error('HTTP ' + response.status);
        await sleep(100 * (attempt + 1));
        continue;
      }
      return { ok: response.ok, status: response.status, data: data };
    } catch (err) {
      lastError = err;
      if (attempt < config.retries) {
        await sleep(100 * (attempt + 1));
        continue;
      }
    }
  }
  throw fail('E_HTTP', lastError && lastError.message ? lastError.message : 'HTTP request failed');
}

function asArgs(args) {
  if (args == null) throw fail('E_INVALID_ARGS', 'arguments object is required');
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw fail('E_INVALID_ARGS', 'arguments must be an object');
  }
  return args;
}

const TOOLS = [
  {
    name: 'boardgame_health',
    description: '检查本地桌游 API 是否可用。',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'boardgame_create_match',
    description: '创建一局匿名卡牌对战，返回 matchId。',
    inputSchema: {
      type: 'object',
      properties: {
        game: { type: 'string' },
        seed: { type: 'integer' },
        ai: { type: 'boolean' },
        deviceId: { type: 'string' }
      },
      required: []
    }
  },
  {
    name: 'boardgame_state',
    description: '读取对局状态（手牌/牌库/奖赏卡/出战区）。',
    inputSchema: {
      type: 'object',
      properties: { matchId: { type: 'string' }, deviceId: { type: 'string' } },
      required: ['matchId']
    }
  },
  {
    name: 'boardgame_actions',
    description: '列出当前玩家合法动作。',
    inputSchema: {
      type: 'object',
      properties: { matchId: { type: 'string' }, deviceId: { type: 'string' } },
      required: ['matchId']
    }
  },
  {
    name: 'boardgame_submit_action',
    description: '提交动作（end-turn / play / attach / attack / draw）。',
    inputSchema: {
      type: 'object',
      properties: {
        matchId: { type: 'string' },
        type: { type: 'string' },
        cardId: { type: 'string' },
        target: { type: 'string' },
        idempotencyKey: { type: 'string' }
      },
      required: ['matchId', 'type']
    }
  },
  {
    name: 'boardgame_evaluate',
    description: '对一组候选动作给出简单评估。',
    inputSchema: {
      type: 'object',
      properties: {
        game: { type: 'string' },
        state: { type: 'object' },
        actions: { type: 'array' }
      },
      required: []
    }
  }
];

function toolByName(name) {
  return TOOLS.find(function (tool) { return tool.name === name; }) || null;
}

export function activate(host) {
  activeHost = host || {};
  if (host && typeof host.registerTool === 'function') {
    TOOLS.forEach(function (tool) {
      try { host.registerTool(tool); } catch (err) { /* host may not support */ }
    });
  }
  if (host && typeof host.log === 'function') host.log('boardgame dsh plugin activated');
  return { ok: true, tools: TOOLS.map(function (tool) { return tool.name; }) };
}

export function deactivate() {
  activeHost = null;
  return { ok: true };
}

export function tools() {
  return TOOLS.map(function (tool) { return Object.assign({}, tool); });
}

export async function invoke(toolName, rawArgs) {
  if (!toolByName(toolName)) {
    throw fail('E_UNKNOWN_TOOL', 'unknown tool: ' + String(toolName));
  }
  const args = asArgs(rawArgs);

  if (toolName === 'boardgame_health') {
    const response = await request('/health');
    return { ok: response.ok, status: response.status, result: response.data };
  }

  if (toolName === 'boardgame_create_match') {
    const response = await request('/api/matches', {
      method: 'POST',
      deviceId: args.deviceId,
      body: {
        game: args.game || 'pokemon',
        players: 2,
        ai: args.ai !== false,
        seed: args.seed,
        deviceId: args.deviceId
      }
    });
    return { ok: response.ok, status: response.status, result: response.data };
  }

  if (toolName === 'boardgame_state') {
    if (!args.matchId) throw fail('E_INVALID_ARGS', 'matchId is required');
    const response = await request('/api/matches/' + encodeURIComponent(args.matchId), {
      deviceId: args.deviceId
    });
    return { ok: response.ok, status: response.status, result: response.data };
  }

  if (toolName === 'boardgame_actions') {
    if (!args.matchId) throw fail('E_INVALID_ARGS', 'matchId is required');
    const response = await request('/api/matches/' + encodeURIComponent(args.matchId) + '/actions', {
      deviceId: args.deviceId
    });
    return { ok: response.ok, status: response.status, result: response.data };
  }

  if (toolName === 'boardgame_submit_action') {
    if (!args.matchId) throw fail('E_INVALID_ARGS', 'matchId is required');
    if (!args.type) throw fail('E_INVALID_ARGS', 'type is required');
    const response = await request('/api/matches/' + encodeURIComponent(args.matchId) + '/actions', {
      method: 'POST',
      deviceId: args.deviceId,
      body: {
        type: args.type,
        cardId: args.cardId,
        target: args.target,
        idempotencyKey: args.idempotencyKey
      }
    });
    return { ok: response.ok, status: response.status, result: response.data };
  }

  if (toolName === 'boardgame_evaluate') {
    const response = await request('/api/ai/evaluate', {
      method: 'POST',
      deviceId: args.deviceId,
      body: {
        game: args.game || 'pokemon',
        state: args.state || {},
        actions: Array.isArray(args.actions) ? args.actions : []
      }
    });
    return { ok: response.ok, status: response.status, result: response.data };
  }

  throw fail('E_UNKNOWN_TOOL', 'unknown tool: ' + String(toolName));
}

export default {
  activate: activate,
  deactivate: deactivate,
  tools: tools,
  invoke: invoke
};
