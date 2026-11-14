/*
 * Global premium-game leaderboard.
 *
 * One Durable Object (`idFromName('global')`) serialises every finish event so
 * the board is consistent without KV or an external database. Only the final
 * result rows are stored; no sessions, passwords or room state.
 */
const MAX_ENTRIES = 500;
const DEFAULT_LIMIT = 20;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, Authorization'
    }
  });
}

export class LeaderboardDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async load() {
    const stored = await this.state.storage.get('entries');
    return Array.isArray(stored) ? stored : [];
  }

  async save(entries) {
    await this.state.storage.put('entries', entries.slice(0, MAX_ENTRIES));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/add' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const incoming = Array.isArray(body && body.entries) ? body.entries : [];
      if (!incoming.length) return json({ ok: true, added: 0 });
      const entries = await this.load();
      incoming.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        // Avoid duplicate rows when a room retries a finish notification.
        if (entry.id && entries.some((row) => row.id === entry.id)) return;
        entries.unshift(entry);
      });
      await this.save(entries);
      return json({ ok: true, added: incoming.length });
    }
    if (url.pathname === '/list' && request.method === 'GET') {
      const game = url.searchParams.get('game') || '';
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
      const entries = await this.load();
      const filtered = game ? entries.filter((entry) => entry.game === game) : entries;
      return json({ ok: true, game: game || null, entries: filtered.slice(0, limit), total: filtered.length });
    }
    return json({ ok: false, error: 'not_found' }, 404);
  }
}
