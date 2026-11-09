'use strict';

/*
 * Local-service helpers for black-box tests.
 *
 * No network access is required: the tests only look at loopback services that
 * a developer explicitly started. If nothing answers, callers SKIP.
 */

const DEFAULT_BASES = [
  'http://127.0.0.1:8787',
  'http://127.0.0.1:8788',
  'http://127.0.0.1:3000'
];

export function candidateBaseUrls() {
  const env = envBaseUrls();
  const all = env.concat(DEFAULT_BASES);
  return Array.from(new Set(all.map(function (u) { return u.replace(/\/+$/, ''); })));
}

function envBaseUrls() {
  return [
    process.env.BOARDGAME_AI_BASE_URL,
    process.env.BOARDGAME_API_BASE_URL,
    process.env.BOARDGAME_SERVER_URL
  ].filter(Boolean).map(function (u) { return u.replace(/\/+$/, ''); });
}

function looksLikeBoardgame(body) {
  if (!body || typeof body !== 'object') return false;
  const marker = [
    body.service,
    body.name,
    body.app,
    JSON.stringify(body.capabilities || body.features || '')
  ].filter(Boolean).join(' ');
  return /boardgame|board-game|tabletop|dsh|card[-_ ]?battle|mahjong|rooms?|matches?/i.test(marker);
}

export async function fetchJson(url, options) {
  const opts = options || {};
  const timeout = opts.timeoutMs == null ? 2000 : opts.timeoutMs;
  const init = {
    method: opts.method || 'GET',
    headers: Object.assign({ accept: 'application/json' }, opts.headers || {}),
    signal: AbortSignal.timeout(timeout)
  };
  if (opts.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  let parseError = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      parseError = err;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: text,
    body: body,
    parseError: parseError
  };
}

/*
 * A service counts as present only when it answers loopback HTTP with JSON at
 * one of the well-known health paths. Plain 404 HTML (e.g. an unrelated dev
 * server on the same port) is deliberately rejected.
 */
export async function probeService(paths) {
  const healthPaths = paths || ['/health', '/api/health', '/'];
  const tried = [];
  const trustedBases = envBaseUrls();
  for (const base of candidateBaseUrls()) {
    const trusted = trustedBases.indexOf(base) !== -1;
    for (const healthPath of healthPaths) {
      const url = base + healthPath;
      try {
        const res = await fetchJson(url, { timeoutMs: 600 });
        tried.push({ url: url, status: res.status });
        const looksJson = res.body !== null && typeof res.body === 'object';
        const explicitOk = looksJson && (
          res.body.ok === true ||
          res.body.status === 'ok' ||
          res.body.service !== undefined ||
          res.body.name !== undefined
        );
        // An explicitly configured base URL is trusted. Auto-discovered ports
        // must identify themselves as a boardgame service; this keeps unrelated
        // loopback dev servers (proxy consoles, TTS, etc.) from turning a SKIP
        // into a false contract failure.
        const identified = looksLikeBoardgame(res.body);
        const accepted = looksJson && (trusted
          ? (res.ok || explicitOk)
          : (res.ok && identified && (explicitOk || healthPath !== '/')));
        if (accepted) {
          return { available: true, baseUrl: base, healthUrl: url, health: res, tried: tried, trusted: trusted };
        }
      } catch (err) {
        tried.push({ url: url, error: err && err.message ? err.message : String(err) });
      }
    }
  }
  return { available: false, baseUrl: null, healthUrl: null, health: null, tried: tried };
}

export function urlFor(baseUrl, path, params) {
  const url = new URL(baseUrl.replace(/\/+$/, '') + path);
  if (params) {
    for (const key of Object.keys(params)) {
      if (params[key] != null) url.searchParams.set(key, String(params[key]));
    }
  }
  return url.toString();
}
