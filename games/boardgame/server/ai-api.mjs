#!/usr/bin/env node
'use strict';

/*
 * Machine-playable HTTP/JSON API for the boardgame section.
 *
 * Zero dependencies, Node built-ins only. Binds to loopback by default and
 * refuses non-loopback bind addresses as well as non-loopback peers/Hosts.
 *
 * Endpoints:
 *   GET  /                     service descriptor
 *   GET  /health               health check
 *   GET  /api/health           health check
 *   POST /api/matches          create a match
 *   GET  /api/matches          list match ids
 *   GET  /api/matches/:id      read state
 *   GET  /api/matches/:id/actions   list legal actions
 *   POST /api/matches/:id/actions   submit an action (idempotent)
 *   POST /api/ai/evaluate      heuristic evaluation / recommendation
 *
 * Environment:
 *   PORT / BOARDGAME_AI_PORT          default 8787
 *   BOARDGAME_AI_HOST                 default 127.0.0.1 (loopback only)
 *   BOARDGAME_API_TOKEN               optional Bearer token for /api/*
 *
 * Run: node games/boardgame/server/ai-api.mjs
 */

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtime from '../app/pokemon-runtime.mjs';

export const SERVICE = 'boardgame-ai-api';
export const NAME = 'boardgame-ai';
export const VERSION = '1.0.0';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const MATCH_TTL_MS = 30 * 60 * 1000;
const MAX_MATCHES = 200;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

function httpError(status, code, message, details) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function isLoopbackAddress(address) {
  if (!address) return false;
  return address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address === '127.0.0.1' ||
    /^127\./.test(address) ||
    /^::ffff:127\./.test(address);
}

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(host) || /^127\./.test(String(host));
}

function hostOf(req) {
  return String(req.headers.host || '');
}

function hostAllowed(hostHeader, port) {
  if (!hostHeader) return true;
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostHeader);
  if (!match) return false;
  const host = match[1];
  const hostPort = match[2] ? Number(match[2]) : null;
  if (!isLoopbackHost(host)) return false;
  if (hostPort != null && port != null && hostPort !== port) return false;
  return true;
}

function hasJsonContentType(req) {
  const type = String(req.headers['content-type'] || '');
  return type.length === 0 || /application\/json/i.test(type);
}

function readJsonBody(req, limit) {
  const max = limit || MAX_BODY_BYTES;
  return new Promise(function (resolve, reject) {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > max) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) {
        reject(httpError(413, 'E_BODY_TOO_LARGE', 'request body exceeds ' + max + ' bytes'));
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        reject(httpError(400, 'E_INVALID_JSON', 'request body is not valid JSON'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(httpError(400, 'E_INVALID_JSON', 'request body must be a JSON object'));
        return;
      }
      resolve(parsed);
    });
    req.on('error', function (err) {
      reject(httpError(400, 'E_BAD_REQUEST', err && err.message ? err.message : 'request stream error'));
    });
    req.on('aborted', function () {
      reject(httpError(400, 'E_BAD_REQUEST', 'request aborted'));
    });
  });
}

function sendJson(res, status, body, headers) {
  const payload = JSON.stringify(body);
  const merged = Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, headers || {});
  res.writeHead(status, merged);
  res.end(payload);
}

function errorBody(code, message, details) {
  const body = { error: { code: code, message: message } };
  if (details !== undefined) body.error.details = details;
  return body;
}

function matchStore(ttlMs) {
  const matches = new Map();
  return {
    create: function (record) {
      if (matches.size >= MAX_MATCHES) {
        const oldest = matches.keys().next();
        if (!oldest.done) matches.delete(oldest.value);
      }
      matches.set(record.id, record);
      return record;
    },
    get: function (id) {
      const record = matches.get(id);
      if (!record) throw httpError(404, 'E_MATCH_NOT_FOUND', 'no match with id ' + JSON.stringify(id));
      const now = Date.now();
      if (now - record.lastUsedAt > ttlMs) {
        matches.delete(id);
        throw httpError(404, 'E_MATCH_EXPIRED', 'match ' + JSON.stringify(id) + ' has expired');
      }
      record.lastUsedAt = now;
      return record;
    },
    list: function () {
      return Array.from(matches.values()).map(function (record) {
        return { matchId: record.id, game: record.game, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt };
      });
    },
    prune: function () {
      const now = Date.now();
      for (const entry of matches) {
        if (now - entry[1].lastUsedAt > ttlMs) matches.delete(entry[0]);
      }
      return matches.size;
    },
    size: function () {
      return matches.size;
    }
  };
}

function validatePlayers(value) {
  if (value === undefined) return 2;
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw httpError(400, 'E_INVALID_ARGS', 'players must be an integer between 1 and 4');
  }
  return value;
}

function validateSeed(value) {
  if (value === undefined) return 20261110;
  if (!Number.isSafeInteger(value)) {
    throw httpError(400, 'E_INVALID_ARGS', 'seed must be a safe integer');
  }
  return value;
}

function validateDeck(value) {
  if (value === undefined || value === null || value === 'pokemon-sample') return undefined;
  if (!Array.isArray(value)) {
    throw httpError(400, 'E_INVALID_DECK', 'deck must be "pokemon-sample" or an array of cards');
  }
  if (value.length !== 60) {
    throw httpError(400, 'E_INVALID_DECK', 'deck must contain exactly 60 cards');
  }
  return value;
}

function validateGame(value) {
  if (value === undefined) return runtime.GAME_DEFAULT;
  if (!runtime.isSupportedGame(value)) {
    throw httpError(400, 'E_UNSUPPORTED_GAME',
      'unsupported game ' + JSON.stringify(value) + '; supported: ' + runtime.SUPPORTED_GAMES.join(', '));
  }
  return value;
}

function domainToHttp(error) {
  if (!error) return httpError(500, 'E_INTERNAL', 'internal error');
  if (error.status) return error;
  const code = error.code || 'E_INTERNAL';
  const conflict = ['E_ILLEGAL_ACTION', 'E_NOT_YOUR_TURN', 'E_ACTIVE_OCCUPIED', 'E_BENCH_FULL',
    'E_CARD_NOT_IN_HAND', 'E_NO_ACTIVE', 'E_NO_PRIZES', 'E_DECK_EMPTY', 'E_NOT_ENERGY',
    'E_INVALID_TARGET'].indexOf(code) !== -1;
  return httpError(conflict ? 422 : 400, code, error.message || code);
}

export function createAiServer(options) {
  const opts = options || {};
  const port = opts.port == null ? DEFAULT_PORT : opts.port;
  const host = opts.host || DEFAULT_HOST;
  if (!isLoopbackHost(host)) {
    throw new Error('refusing to bind non-loopback host ' + JSON.stringify(host));
  }
  const token = opts.token !== undefined ? opts.token : process.env.BOARDGAME_API_TOKEN;
  const store = matchStore(opts.matchTtlMs || MATCH_TTL_MS);

  function authorize(req, pathname) {
    if (!token) return;
    if (pathname === '/health' || pathname === '/api/health' || pathname === '/') return;
    const header = String(req.headers.authorization || '');
    if (header !== 'Bearer ' + token) {
      throw httpError(401, 'E_UNAUTHORIZED', 'missing or invalid bearer token');
    }
  }

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (origin && LOOPBACK_ORIGIN.test(origin)) {
      return {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, idempotency-key',
        'access-control-max-age': '600',
        vary: 'origin'
      };
    }
    return {};
  }

  function healthPayload() {
    return {
      ok: true,
      status: 'ok',
      service: SERVICE,
      name: NAME,
      version: VERSION,
      capabilities: ['matches', 'legal-actions', 'ai-evaluate'],
      games: runtime.SUPPORTED_GAMES.slice(),
      matches: store.size(),
      limits: {
        maxBodyBytes: MAX_BODY_BYTES,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        matchTtlMs: opts.matchTtlMs || MATCH_TTL_MS
      }
    };
  }

  async function handleCreateMatch(req, res) {
    if (!hasJsonContentType(req)) {
      throw httpError(415, 'E_UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json');
    }
    const body = await readJsonBody(req, opts.maxBodyBytes);
    const game = validateGame(body.game);
    const players = validatePlayers(body.players);
    const seed = validateSeed(body.seed);
    const deck = validateDeck(body.deck);
    const matchId = 'm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    let engine;
    try {
      engine = runtime.createPokemonMatch({ players: players, seed: seed, matchId: matchId, deck: deck });
    } catch (err) {
      throw domainToHttp(err);
    }
    const record = {
      id: matchId,
      game: game,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      engine: engine,
      ai: body.ai === true,
      actionsApplied: 0,
      idempotency: new Map()
    };
    store.create(record);
    sendJson(res, 201, runtime.describeMatch(engine, matchId), corsHeaders(req));
  }

  function handleGetMatch(req, res, matchId) {
    const record = store.get(matchId);
    sendJson(res, 200, runtime.describeMatch(record.engine, record.id), corsHeaders(req));
  }

  function handleListActions(req, res, matchId) {
    const record = store.get(matchId);
    const state = record.engine.state;
    const actions = runtime.legalActions(record.engine);
    sendJson(res, 200, {
      matchId: record.id,
      turn: state.turn,
      currentPlayer: state.currentPlayer,
      actions: actions
    }, corsHeaders(req));
  }

  async function handleSubmitAction(req, res, matchId) {
    if (!hasJsonContentType(req)) {
      throw httpError(415, 'E_UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json');
    }
    const record = store.get(matchId);
    const body = await readJsonBody(req, opts.maxBodyBytes);
    if (body.type === undefined) {
      throw httpError(400, 'E_INVALID_ARGS', 'type is required');
    }
    if (typeof body.type !== 'string') {
      throw httpError(400, 'E_INVALID_ARGS', 'type must be a string');
    }
    if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') {
      throw httpError(400, 'E_INVALID_ARGS', 'idempotencyKey must be a string');
    }
    const key = body.idempotencyKey;
    if (key) {
      const previous = record.idempotency.get(key);
      if (previous) {
        sendJson(res, previous.status, previous.body, Object.assign(
          { 'idempotency-replayed': 'true' }, corsHeaders(req)));
        return;
      }
    }
    const action = {
      type: body.type,
      player: body.player,
      cardId: body.cardId,
      target: body.target,
      attackIndex: body.attackIndex
    };
    try {
      runtime.applyAction(record.engine, action);
    } catch (err) {
      throw domainToHttp(err);
    }
    record.actionsApplied += 1;
    const payload = Object.assign(runtime.describeMatch(record.engine, record.id), {
      applied: { type: body.type, player: action.player == null ? record.engine.state.currentPlayer : action.player },
      actionsApplied: record.actionsApplied
    });
    if (key) record.idempotency.set(key, { status: 200, body: payload });
    sendJson(res, 200, payload, corsHeaders(req));
  }

  async function handleEvaluate(req, res) {
    if (!hasJsonContentType(req)) {
      throw httpError(415, 'E_UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json');
    }
    const body = await readJsonBody(req, opts.maxBodyBytes);
    const game = validateGame(body.game);
    if (body.state !== undefined && (body.state === null || typeof body.state !== 'object' || Array.isArray(body.state))) {
      throw httpError(400, 'E_INVALID_ARGS', 'state must be an object');
    }
    if (body.actions !== undefined && !Array.isArray(body.actions)) {
      throw httpError(400, 'E_INVALID_ARGS', 'actions must be an array');
    }
    const evaluation = runtime.evaluate({ state: body.state, actions: body.actions });
    sendJson(res, 200, {
      game: game,
      evaluation: evaluation
    }, corsHeaders(req));
  }

  function handleListMatches(req, res) {
    sendJson(res, 200, { matches: store.list(), count: store.size() }, corsHeaders(req));
  }

  async function route(req, res) {
    const port = server.address() && typeof server.address() === 'object' ? server.address().port : null;
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      throw httpError(403, 'E_FORBIDDEN', 'loopback clients only');
    }
    if (!hostAllowed(hostOf(req), port)) {
      throw httpError(403, 'E_FORBIDDEN_HOST', 'Host header must be loopback');
    }

    const url = new URL(req.url || '/', 'http://' + (hostOf(req) || '127.0.0.1'));
    const pathname = url.pathname;
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'OPTIONS') {
      const headers = corsHeaders(req);
      if (!headers['access-control-allow-origin']) {
        throw httpError(403, 'E_FORBIDDEN_ORIGIN', 'only loopback origins are allowed');
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    authorize(req, pathname);

    if (req.method === 'GET' && (pathname === '/' || pathname === '/health' || pathname === '/api/health')) {
      sendJson(res, 200, healthPayload(), corsHeaders(req));
      return;
    }
    if (req.method === 'GET' && pathname === '/api/matches') {
      handleListMatches(req, res);
      return;
    }
    if (pathname === '/api/matches' && req.method === 'POST') {
      await handleCreateMatch(req, res);
      return;
    }
    if (parts[0] === 'api' && parts[1] === 'matches' && parts.length >= 3) {
      const matchId = parts[2];
      if (parts.length === 3) {
        if (req.method === 'GET') {
          handleGetMatch(req, res, matchId);
          return;
        }
        res.setHeader('allow', 'GET');
        throw httpError(405, 'E_METHOD_NOT_ALLOWED', 'use GET on /api/matches/:id');
      }
      if (parts.length === 4 && parts[3] === 'actions') {
        if (req.method === 'GET') {
          handleListActions(req, res, matchId);
          return;
        }
        if (req.method === 'POST') {
          await handleSubmitAction(req, res, matchId);
          return;
        }
        throw httpError(405, 'E_METHOD_NOT_ALLOWED', 'use GET or POST on /api/matches/:id/actions');
      }
      throw httpError(404, 'E_NOT_FOUND', 'no route ' + pathname);
    }
    if (pathname === '/api/ai/evaluate' && req.method === 'POST') {
      await handleEvaluate(req, res);
      return;
    }
    if (pathname.startsWith('/api/')) {
      throw httpError(404, 'E_NOT_FOUND', 'no route ' + pathname);
    }
    throw httpError(404, 'E_NOT_FOUND', 'no route ' + pathname);
  }

  const server = http.createServer(function (req, res) {
    route(req, res).catch(function (err) {
      const httpErr = domainToHttp(err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, httpErr.status || 500, errorBody(httpErr.code || 'E_INTERNAL', httpErr.message, httpErr.details), corsHeaders(req));
    });
  });

  server.requestTimeout = opts.requestTimeoutMs || REQUEST_TIMEOUT_MS;
  server.headersTimeout = (opts.requestTimeoutMs || REQUEST_TIMEOUT_MS) + 1000;
  server.keepAliveTimeout = 5000;

  const pruneTimer = setInterval(function () {
    store.prune();
  }, 60000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  let closed = false;
  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    clearInterval(pruneTimer);
    return new Promise(function (resolve) {
      server.close(function () { resolve(); });
    });
  }

  return {
    server: server,
    store: store,
    close: close,
    listen: function (listenPort) {
      const chosen = listenPort == null ? port : listenPort;
      return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(chosen, host, function () {
          server.removeListener('error', reject);
          const address = server.address();
          resolve({ server: server, host: host, port: address.port, url: 'http://' + host + ':' + address.port });
        });
      });
    }
  };
}

export async function startAiServer(options) {
  const opts = options || {};
  const envPort = Number(process.env.BOARDGAME_AI_PORT || process.env.PORT || '');
  const port = opts.port == null
    ? (Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_PORT)
    : opts.port;
  const host = opts.host || process.env.BOARDGAME_AI_HOST || DEFAULT_HOST;
  const instance = createAiServer(Object.assign({}, opts, { port: port, host: host }));
  const info = await instance.listen(port);
  return Object.assign({}, instance, info);
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startAiServer().then(function (instance) {
    process.stdout.write('boardgame-ai-api listening on ' + instance.url + '\n');
    process.stdout.write('health: ' + instance.url + '/health\n');
    function shutdown() {
      instance.close().then(function () { process.exit(0); });
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch(function (err) {
    process.stderr.write('boardgame-ai-api failed to start: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  });
}
