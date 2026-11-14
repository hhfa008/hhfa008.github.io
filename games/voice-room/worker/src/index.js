import { RoomDO } from './room.js';
import { LeaderboardDO } from './leaderboard.js';
import { GAME_SLUGS } from './premium-room.js';

export { RoomDO, LeaderboardDO };

const ICE_TTL_SECONDS = 3600;
const ICE_CACHE_MS = 55 * 60 * 1000;
let iceCache = { at: 0, body: null };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, Authorization',
  'Access-Control-Max-Age': '86400',
};

function originHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status = 200, extra = {}, origin = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(origin ? originHeaders(origin) : CORS_HEADERS),
      ...extra,
    },
  });
}

async function withCors(response, origin) {
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(origin ? originHeaders(origin) : CORS_HEADERS),
    },
  });
}

async function getIceServers(env) {
  const now = Date.now();
  if (iceCache.body && now - iceCache.at < ICE_CACHE_MS) {
    return { ...iceCache.body, cached: true };
  }
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    throw new Error('TURN is not configured');
  }
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ttl: ICE_TTL_SECONDS }),
    },
  );
  if (!res.ok) {
    throw new Error(`TURN API ${res.status}`);
  }
  const data = await res.json();
  const body = {
    iceServers: data.iceServers,
    ttl: ICE_TTL_SECONDS,
    expiresAt: now + ICE_TTL_SECONDS * 1000,
  };
  iceCache = { at: now, body };
  return body;
}

// Extra origins can be added with ALLOWED_ORIGINS="https://a.example,https://b.example".
function allowedOrigin(origin, env) {
  if (!origin) return true;
  const extra = env && env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',') : [];
  if (extra.some((entry) => entry.trim() === '*')) return true;
  try {
    const u = new URL(origin);
    if (extra.some((entry) => {
      const value = entry.trim();
      if (!value) return false;
      if (value === u.origin || value === u.hostname) return true;
      try { return new URL(value).hostname === u.hostname; } catch (e) { return false; }
    })) return true;
    if (u.hostname === 'hhfa008.github.io') return true;
    // Cloudflare Pages mirror of the same site (and its branch previews).
    if (u.hostname === 'hhfa008-pages.pages.dev') return true;
    if (u.hostname.endsWith('.hhfa008-pages.pages.dev')) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

function roomCodeFromKey(key) {
  if (/^\d{4}$/.test(key)) return key;
  const invite = /^inv-(\d{4})-[a-z0-9]+$/i.exec(key || '');
  return invite ? invite[1] : null;
}

function randomRoomCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

async function premiumCreate(request, env, origin) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, {}, origin);
  const text = await request.text();
  if (text.length > 64 * 1024) {
    return json({ ok: false, error: { code: 'E_BODY', message: 'body too large' } }, 413, {}, origin);
  }
  let body;
  try { body = JSON.parse(text || '{}'); } catch (e) { return json({ ok: false, error: { code: 'E_JSON', message: 'invalid JSON' } }, 400, {}, origin); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: { code: 'E_JSON', message: 'invalid JSON' } }, 400, {}, origin);
  }
  if (!GAME_SLUGS.includes(String(body.game || ''))) {
    return json({ ok: false, error: { code: 'E_GAME', message: 'unknown game' } }, 400, {}, origin);
  }
  // A 4-digit code names the Durable Object. Retry a few times if the random
  // code already belongs to a live room of any kind.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = randomRoomCode();
    const id = env.ROOMS.idFromName(`room:${code}`);
    const doUrl = new URL(request.url);
    doUrl.pathname = '/premium/create';
    doUrl.search = '?room=' + encodeURIComponent(code);
    const doReq = new Request(doUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    });
    const res = await env.ROOMS.get(id).fetch(doReq);
    if (res.status === 409) {
      let data = null;
      try { data = await res.clone().json(); } catch (e) { data = null; }
      if (data && data.error && data.error.code === 'E_EXISTS') continue;
    }
    return withCors(res, origin);
  }
  return json({ ok: false, error: { code: 'E_LIMIT', message: 'no room code available' } }, 503, {}, origin);
}

async function premiumRoom(request, url, env, origin, roomKey, action) {
  const code = roomCodeFromKey(roomKey);
  if (!code) return json({ ok: false, error: { code: 'E_NOT_FOUND', message: 'room not found' } }, 404, {}, origin);
  if (action && !['join', 'start', 'actions', 'reconnect', 'leave', 'invite', 'tick', 'restart'].includes(action)) {
    return json({ ok: false, error: { code: 'E_NOT_FOUND', message: 'not found' } }, 404, {}, origin);
  }
  const doUrl = new URL(request.url);
  doUrl.pathname = '/premium/room' + (action ? '/' + action : '');
  doUrl.searchParams.set('room', code);
  const id = env.ROOMS.idFromName(`room:${code}`);
  let doReq;
  if (request.method === 'GET' || request.method === 'DELETE') {
    doReq = new Request(doUrl.toString(), { method: request.method, headers: { 'content-type': 'application/json' } });
  } else if (request.method === 'POST') {
    const text = await request.text();
    doReq = new Request(doUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    });
  } else {
    return json({ error: 'method_not_allowed' }, 405, {}, origin);
  }
  const res = await env.ROOMS.get(id).fetch(doReq);
  return withCors(res, origin);
}

async function leaderboard(request, url, env, origin) {
  if (!env.LEADERBOARD) {
    return json({ ok: true, entries: [], total: 0 }, 200, {}, origin);
  }
  const doUrl = new URL(request.url);
  doUrl.pathname = '/list';
  const id = env.LEADERBOARD.idFromName('global');
  const res = await env.LEADERBOARD.get(id).fetch(doUrl.toString());
  return withCors(res, origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const premiumPath = url.pathname === '/api/rooms' || url.pathname.startsWith('/api/rooms/') ||
      url.pathname === '/api/leaderboard';

    if (request.method === 'OPTIONS') {
      // The premium room API is public and token-authenticated (no cookies), so
      // it accepts any origin. ICE/WS keep their narrower allow-list.
      if (premiumPath) return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (!allowedOrigin(origin, env)) {
        return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
      }
      return new Response(null, {
        status: 204,
        headers: origin ? originHeaders(origin) : CORS_HEADERS,
      });
    }

    if (url.pathname === '/rev') {
      return json({ rev: 'quality-reconnect-1', ts: Date.now() });
    }

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'voice-room',
        rev: 'premium-rooms-1',
        premium: true,
        games: GAME_SLUGS,
        ts: Date.now(),
      }, 200, {}, premiumPath ? origin : null);
    }

    // ---- Premium rooms (Kot / Azul / Codenames) -------------------------
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return leaderboard(request, url, env, origin);
    }
    if (url.pathname === '/api/rooms') {
      return premiumCreate(request, env, origin);
    }
    const roomMatch = /^\/api\/rooms\/([^/]+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (roomMatch) {
      const key = decodeURIComponent(roomMatch[1]);
      const action = roomMatch[2] ? decodeURIComponent(roomMatch[2]) : '';
      return premiumRoom(request, url, env, origin, key, action);
    }

    // ---- Voice room (ICE + WebSocket + password join) --------------------
    if (url.pathname === '/api/ice') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      // Only our page (and localhost during development) may mint TURN creds.
      if (!allowedOrigin(origin, env)) {
        return json({ error: 'origin_not_allowed' }, 403);
      }
      try {
        const data = await getIceServers(env);
        return json(data, 200, {}, origin || null);
      } catch (err) {
        // Never leak the TURN token or upstream response body.
        return json({ error: 'turn_unavailable' }, 502, {}, origin || null);
      }
    }

    if (url.pathname === '/api/join') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      if (!allowedOrigin(origin, env)) {
        return json({ error: 'origin_not_allowed' }, 403, {}, origin || null);
      }
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, code: 'bad_request' }, 400, {}, origin || null);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ ok: false, code: 'bad_request' }, 400, {}, origin || null);
      }
      const room = String(body.room == null ? '' : body.room);
      if (!/^\d{4}$/.test(room)) {
        return json({ ok: false, code: 'bad_room' }, 400, {}, origin || null);
      }
      // Bound the body before it reaches the DO; the real 4–32 check is there.
      if (typeof body.password === 'string' && body.password.length > 64) {
        return json({ ok: false, code: 'bad_password_format' }, 400, {}, origin || null);
      }
      const doUrl = new URL(request.url);
      doUrl.pathname = '/join';
      doUrl.search = '?room=' + encodeURIComponent(room);
      const headers = new Headers(request.headers);
      headers.set('content-type', 'application/json');
      const doReq = new Request(doUrl.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pid: body.pid,
          password: body.password,
          create: body.create === true,
        }),
      });
      const id = env.ROOMS.idFromName(`room:${room}`);
      const res = await env.ROOMS.get(id).fetch(doReq);
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...(origin ? originHeaders(origin) : CORS_HEADERS),
        },
      });
    }

    if (url.pathname === '/ws') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      if (!allowedOrigin(origin, env)) {
        return new Response('origin not allowed', { status: 403 });
      }
      const room = url.searchParams.get('room') || '';
      if (!/^\d{4}$/.test(room)) {
        return new Response('room must be 4 digits', { status: 400 });
      }
      const name = (url.searchParams.get('name') || '').slice(0, 12);
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('room', room);
      doUrl.searchParams.set('name', name);
      const id = env.ROOMS.idFromName(`room:${room}`);
      const stub = env.ROOMS.get(id);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    if (url.pathname === '/') {
      return json({
        ok: true,
        service: 'voice-room',
        endpoints: [
          '/health', '/api/ice', '/ws?room=1234&name=...',
          'POST /api/rooms', 'GET|DELETE /api/rooms/:id',
          'POST /api/rooms/:id/join|start|actions|reconnect|leave|invite|tick|restart',
          'GET /api/leaderboard?game=<slug>',
        ],
      });
    }

    return json({ error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    // Keep the isolate's ICE cache warm; not required for correctness.
    ctx.waitUntil(getIceServers(env).catch(() => {}));
  },
};
