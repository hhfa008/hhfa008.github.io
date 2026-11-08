import { RoomDO } from './room.js';

export { RoomDO };

const ICE_TTL_SECONDS = 3600;
const ICE_CACHE_MS = 55 * 60 * 1000;
let iceCache = { at: 0, body: null };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function originHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function allowedOrigin(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'hhfa008.github.io') return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!allowedOrigin(origin)) {
        return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
      }
      return new Response(null, {
        status: 204,
        headers: origin ? originHeaders(origin) : CORS_HEADERS,
      });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'voice-room', ts: Date.now() });
    }

    if (url.pathname === '/api/ice') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      // Only our page (and localhost during development) may mint TURN creds.
      const origin = request.headers.get('Origin');
      if (!allowedOrigin(origin)) {
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

    if (url.pathname === '/ws') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const origin = request.headers.get('Origin');
      if (!allowedOrigin(origin)) {
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
        endpoints: ['/health', '/api/ice', '/ws?room=1234&name=...'],
      });
    }

    return json({ error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    // Keep the isolate's ICE cache warm; not required for correctness.
    ctx.waitUntil(getIceServers(env).catch(() => {}));
  },
};
