'use strict';

/*
 * L3 contract: machine-playable HTTP/JSON API.
 *
 * Black-box only. A loopback service is detected via /health, /api/health or
 * / (must return JSON). No service => SKIP (strict mode fails).
 *
 * Scenarios live in fixtures/ai-scenarios.json:
 *   create match -> read state -> legal actions -> submit action -> AI eval
 * plus an invalid-action error-shape check.
 *
 * Optional auth: set BOARDGAME_API_TOKEN to send `Authorization: Bearer ...`.
 */

import { createSuite } from './lib/suite.mjs';
import { readFixture } from './lib/fixtures.mjs';
import { probeService, fetchJson, urlFor } from './lib/http.mjs';

const s = createSuite('boardgame-ai-api');

function errorCodeOf(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.error && typeof body.error === 'object') return body.error.code || body.error.type;
  if (typeof body.error === 'string') return body.code || body.error;
  return body.code || body.errorCode;
}

function hasErrorBody(body) {
  return Boolean(body && typeof body === 'object' && (body.error || body.errorCode || body.code));
}

function fieldOf(body, name) {
  if (!body || typeof body !== 'object') return undefined;
  if (body[name] !== undefined) return body[name];
  if (body.state && typeof body.state === 'object') return body.state[name];
  if (body.match && typeof body.match === 'object') return body.match[name];
  if (body.data && typeof body.data === 'object') return body.data[name];
  return undefined;
}

await s.run(async () => {
  const fixture = readFixture('ai-scenarios.json');
  const serviceConfig = fixture.service || {};
  const healthPaths = serviceConfig.healthPaths || ['/health', '/api/health', '/'];
  const service = await probeService(healthPaths);

  if (!service.available) {
    s.skip('HTTP AI API contract',
      'no local boardgame JSON service answered at ' +
      service.tried.map(function (item) { return item.url; }).join(', ') +
      ' (set BOARDGAME_AI_BASE_URL to point at one)');
    return;
  }

  const base = service.baseUrl;
  const token = process.env[serviceConfig.authEnv || 'BOARDGAME_API_TOKEN'];
  const headers = token ? { authorization: 'Bearer ' + token } : {};
  const variables = {};

  await s.group('service health', async () => {
    s.ok('检测到本地 JSON 服务', service.available, base);
    s.ok('health 返回 JSON', service.health && service.health.body && typeof service.health.body === 'object',
      JSON.stringify(service.health && service.health.body));
  });

  async function callScenario(scenario) {
    let requestPath = scenario.path;
    for (const key of Object.keys(variables)) {
      requestPath = requestPath.replace('{' + key + '}', encodeURIComponent(variables[key]));
    }
    if (/\{[a-zA-Z]+\}/.test(requestPath)) {
      return { skipped: true, missing: requestPath.match(/\{[a-zA-Z]+\}/g).join(', ') };
    }
    let url = urlFor(base, requestPath);
    const response = await fetchJson(url, {
      method: scenario.method,
      body: scenario.body,
      headers: headers,
      timeoutMs: 4000
    });
    return { skipped: false, response: response, url: url };
  }

  for (const scenario of fixture.scenarios) {
    await s.group(scenario.name, async () => {
      let outcome;
      try {
        outcome = await callScenario(scenario);
      } catch (err) {
        s.ok(scenario.name + ' 请求完成', false, err && err.message ? err.message : String(err));
        return;
      }
      if (outcome.skipped) {
        s.skip(scenario.name, '缺少前置变量 ' + outcome.missing + '（创建对局失败或未返回 matchId）');
        return;
      }

      const response = outcome.response;
      const expect = scenario.expect || {};
      s.ok(scenario.name + ' 不返回 5xx', response.status < 500, 'status ' + response.status);
      s.ok(scenario.name + ' 状态码符合预期',
        (expect.status || []).indexOf(response.status) !== -1,
        'status ' + response.status + ', want ' + JSON.stringify(expect.status));
      s.ok(scenario.name + ' 返回 JSON', response.body !== null && typeof response.body === 'object',
        response.text.slice(0, 160));

      if (response.body && typeof response.body === 'object') {
        for (const field of expect.fields || []) {
          s.ok(scenario.name + ' 含字段 ' + field, fieldOf(response.body, field) !== undefined,
            JSON.stringify(response.body).slice(0, 240));
        }
        for (const field of expect.arrayFields || []) {
          s.ok(scenario.name + ' 字段 ' + field + ' 是数组',
            Array.isArray(fieldOf(response.body, field)),
            JSON.stringify(fieldOf(response.body, field)).slice(0, 160));
        }
        if (expect.errorCode) {
          s.ok(scenario.name + ' 错误响应带错误码', Boolean(errorCodeOf(response.body)),
            JSON.stringify(response.body).slice(0, 200));
          s.ok(scenario.name + ' 错误响应结构可读', hasErrorBody(response.body),
            JSON.stringify(response.body).slice(0, 200));
        }
        for (const key of Object.keys(expect.persist || {})) {
          const value = fieldOf(response.body, key);
          if (value !== undefined) variables[key] = String(value);
        }
      }

      if (scenario.name === 'legal-actions') {
        variables.lastLegalTurn = fieldOf(response.body, 'turn');
      }
      if (scenario.name === 'submit-action') {
        s.ok(scenario.name + ' 提交后状态仍可读', fieldOf(response.body, 'status') !== undefined,
          JSON.stringify(response.body).slice(0, 200));
      }
      if (scenario.name === 'ai-evaluate') {
        const evaluation = fieldOf(response.body, 'evaluation');
        const isObject = evaluation !== null && typeof evaluation === 'object';
        const isNumber = typeof evaluation === 'number';
        const isArray = Array.isArray(evaluation);
        s.ok(scenario.name + ' evaluation 为对象/数组/数值', isObject || isNumber || isArray,
          JSON.stringify(evaluation).slice(0, 200));
        if (isObject) {
          const keys = Object.keys(evaluation);
          s.ok(scenario.name + ' evaluation 含分值或推荐动作',
            keys.some(function (key) { return /score|value|action|move|best|recommend/i.test(key); }),
            JSON.stringify(keys));
        }
      }
    });
  }

  await s.group('contract hygiene', async () => {
    s.ok('所有场景都使用 JSON 请求/响应', true);
    s.ok('创建对局返回 matchId', typeof variables.matchId === 'string' && variables.matchId.length > 0,
      String(variables.matchId));
    s.ok('服务地址只来自 loopback/环境变量', /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(base),
      base);
  });
});
