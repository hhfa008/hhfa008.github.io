/* AgentNet: server-authoritative AI-vs-AI match relay.
 *
 *   POST /api/match            {game, seed?} -> {matchId, joinUrl}
 *   GET  /api/match/:id/log     -> replayable log + hash chain
 *   GET  /api/match/:id/ws      -> WebSocket, protocol in ./README.md
 *   GET  /health                -> {ok, version, rooms}
 *
 * Rooms live in MatchDO (one instance per match). A singleton RegistryDO only
 * keeps the global room count and a best-effort per-IP creation rate limit.
 * No IP is ever written to durable storage: the rate map is memory-only and
 * keyed by a salted hash that never leaves the object.
 */
import './rules/core.js';
import { MatchDO } from './match-do.js';

export { MatchDO };

const CORE = globalThis.AgentNetCore;
const VERSION = '1.0.0';
const MATCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEED_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60000;
const MAX_ROOMS = 200;
const ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_RATE_KEYS = 5000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

async function registryStub(env) {
  const id = env.REGISTRY.idFromName('registry');
  return env.REGISTRY.get(id);
}

export class RegistryDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._rooms = null;
    this._salt = null;
    this.rate = new Map();
    this._tail = Promise.resolve();
  }

  withLock(fn) {
    const run = this._tail.then(() => fn());
    this._tail = run.then(() => undefined, () => undefined);
    return run;
  }

  cap() {
    const n = Number(this.env && this.env.MAX_ROOMS);
    return Number.isFinite(n) && n > 0 ? n : MAX_ROOMS;
  }

  async rooms() {
    if (this._rooms) return this._rooms;
    const stored = await this.state.storage.get('rooms');
    this._rooms = stored && typeof stored === 'object' ? stored : {};
    return this._rooms;
  }

  async saveRooms(rooms) {
    this._rooms = rooms;
    await this.state.storage.put('rooms', rooms);
  }

  // In-memory only: salt + map die with the object, so raw IPs are never
  // persisted and hashes cannot be compared across instances.
  async rateKey(ip) {
    if (!this._salt) this._salt = crypto.randomUUID();
    return CORE.sha256Hex(String(ip) + '|' + this._salt);
  }

  pruneRooms(rooms, now) {
    let changed = false;
    for (const [id, room] of Object.entries(rooms)) {
      if (!room || !Number.isFinite(room.createdAt) || now - room.createdAt > ROOM_MAX_AGE_MS) {
        delete rooms[id];
        changed = true;
      }
    }
    return changed;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/create') {
      return this.withLock(async () => {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return json({ error: 'bad_request' }, 400);
        }
        return this.create(body || {});
      });
    }
    if (url.pathname === '/release') {
      return this.withLock(async () => {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return json({ error: 'bad_request' }, 400);
        }
        const rooms = await this.rooms();
        if (body && rooms[body.matchId]) {
          delete rooms[body.matchId];
          await this.saveRooms(rooms);
        }
        return json({ ok: true, rooms: Object.keys(rooms).length });
      });
    }
    if (url.pathname === '/count') {
      return this.withLock(async () => {
        const rooms = await this.rooms();
        return json({ rooms: Object.keys(rooms).length });
      });
    }
    return json({ error: 'not_found' }, 404);
  }

  async create(body) {
    const matchId = body.matchId;
    const game = body.game;
    if (typeof matchId !== 'string' || !CORE.isGame(game)) {
      return json({ error: 'bad_request' }, 400);
    }
    const now = Date.now();
    const key = await this.rateKey(body.ip || 'unknown');

    if (this.rate.size > MAX_RATE_KEYS) this.rate.clear(); // fail-open, bounded memory
    let hits = (this.rate.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT) {
      this.rate.set(key, hits);
      return json(
        { ok: false, code: 'rate_limited', retryAfter: Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000) },
        429,
      );
    }
    // Every accepted attempt counts, whether or not the room cap refuses it.
    hits.push(now);
    this.rate.set(key, hits);

    const rooms = await this.rooms();
    this.pruneRooms(rooms, now);
    if (Object.keys(rooms).length >= this.cap()) {
      return json({ ok: false, code: 'room_limit' }, 429);
    }
    rooms[matchId] = { createdAt: now, game: game };
    await this.saveRooms(rooms);
    await this.armPrune(now);
    return json({ ok: true, rooms: Object.keys(rooms).length });
  }

  async armPrune(now) {
    try {
      const current = await this.state.storage.getAlarm();
      if (current === null) await this.state.storage.setAlarm(now + PRUNE_INTERVAL_MS);
    } catch (e) {
      // Pruning is a safety net; /create also prunes on every call.
    }
  }

  async alarm() {
    await this.withLock(async () => {
      const now = Date.now();
      const rooms = await this.rooms();
      if (this.pruneRooms(rooms, now)) await this.saveRooms(rooms);
      if (Object.keys(rooms).length) {
        try {
          await this.state.storage.setAlarm(now + PRUNE_INTERVAL_MS);
        } catch (e) {}
      }
    });
  }
}

async function createMatch(request, env) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 2048) return json({ error: 'bad_request' }, 413);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad_request' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'bad_request' }, 400);
  }
  const game = body.game;
  if (!CORE.isGame(game)) return json({ error: 'bad_game' }, 400);

  let seed;
  if (body.seed === undefined) {
    seed = crypto.randomUUID();
  } else {
    seed = String(body.seed);
    if (!SEED_RE.test(seed)) return json({ error: 'bad_seed' }, 400);
  }

  const matchId = crypto.randomUUID();
  const registry = await registryStub(env);
  const regRes = await registry.fetch('https://registry.internal/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matchId: matchId, game: game, ip: clientIp(request) }),
  });
  const reg = await regRes.json();
  if (!reg.ok) {
    return json({ error: reg.code, retryAfter: reg.retryAfter }, regRes.status);
  }

  const matchStub = env.MATCH.get(env.MATCH.idFromName(matchId));
  const initRes = await matchStub.fetch('https://match.internal/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matchId: matchId, game: game, seed: seed }),
  });
  if (!initRes.ok) {
    try {
      await registry.fetch('https://registry.internal/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchId: matchId }),
      });
    } catch (e) {}
    return json({ error: 'match_init_failed' }, 500);
  }

  const wsOrigin = new URL(request.url).origin.replace(/^http/, 'ws');
  return json({
    matchId: matchId,
    joinUrl: wsOrigin + '/api/match/' + matchId + '/ws',
  });
}

async function proxyLog(request, env, matchId) {
  const stub = env.MATCH.get(env.MATCH.idFromName(matchId));
  const res = await stub.fetch(request);
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      let rooms = null;
      try {
        const registry = await registryStub(env);
        const res = await registry.fetch('https://registry.internal/count');
        const data = await res.json();
        rooms = data.rooms;
      } catch (e) {
        rooms = null;
      }
      return json({ ok: true, version: VERSION, rooms: rooms });
    }

    if (url.pathname === '/api/match') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return createMatch(request, env);
    }

    if (url.pathname.startsWith('/api/match/')) {
      const rest = url.pathname.slice('/api/match/'.length);
      const slash = rest.indexOf('/');
      const matchId = slash === -1 ? rest : rest.slice(0, slash);
      const sub = slash === -1 ? '' : rest.slice(slash + 1);
      if (!MATCH_ID_RE.test(matchId)) return json({ error: 'not_found' }, 404);

      if (sub === 'ws') {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return json({ error: 'upgrade_required' }, 426);
        }
        const stub = env.MATCH.get(env.MATCH.idFromName(matchId));
        return stub.fetch(request);
      }
      if (sub === 'log' && request.method === 'GET') {
        return proxyLog(request, env, matchId);
      }
      return json({ error: 'not_found' }, 404);
    }

    return json({ error: 'not_found' }, 404);
  },
};
