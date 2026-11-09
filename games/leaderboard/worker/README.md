# Game leaderboard worker

Independent Cloudflare Worker for anonymous game leaderboards. It is **not**
connected to the voice-room worker (`games/voice-room/worker/`) in any way; that
worker and its Durable Objects are untouched.

## Privacy model

- No accounts, no email/phone, no cookies.
- Identity is a client-generated 32-hex `device` string (equivalent to a nickname
  token). The client stores it locally and sends it on writes/deletes.
- The server stores only `SHA-256(SALT + device)` as the device key. The raw
  `device` string is never persisted or logged.
- Stored fields per score: device hash (KV key), display name, game slug, value,
  timestamp.
- IP addresses are used only for an in-memory rate counter. They are not
  persisted, not included in KV writes, and not logged.
- Users can delete all of their scores with a single `POST /api/delete` using the
  same `device` string (proof of ownership).

## API

All responses are JSON. CORS is open (`*`) so the static site can call the worker.

### `POST /api/score`

```json
{ "device": "32 hex chars", "name": "昵称", "game": "chess", "value": 42, "kind": "xp" }
```

- `200 { ok: true, rank, best }`
- `400 { ok: false, error: "bad_name" | "bad_game" | "bad_value" | "bad_device" }`
- `429 { ok: false, error: "rate_limited", retryAfter }` (`Retry-After` header too)

`kind` is one of `xp` (higher is better), `time` (lower is better, seconds,
1..86400), `streak` (higher is better, 0..3650). Each device+game keeps one row:
only a better score of the same kind replaces it. A game is expected to stick to
one scoring kind.

### `GET /api/board?game=<slug>&period=week|all&limit=<=50`

```json
{
  "ok": true,
  "period": "week",
  "game": "chess",
  "updatedAt": "2026-11-10T00:00:00.000Z",
  "rows": [
    { "rank": 1, "name": "abc", "avatar": { "h1": 210, "h2": 34, "shape": "tri" }, "value": 42, "kind": "xp", "at": "2026-11-10T00:00:00.000Z" }
  ],
  "total": 1
}
```

- `period=week` uses the UTC ISO week bucket (Monday 00:00 UTC) and the KV key is
  14-day TTL. `period=all` is a separate permanent key.
- Rows are grouped by `kind`; ranks are competition ranks within each kind group
  (ties share a rank: 1, 1, 3).
- `limit` is clamped to 1..50 (default 50). `total` is the full row count before
  the limit.
- `avatar` is derived from the salted hash: two hues (0..359) and one of
  `circle`, `tri`, `square`, `star`, `hex`, `diamond`. It reveals nothing that
  lets a client recover the device string.

### `POST /api/delete`

```json
{ "device": "32 hex chars" }
```

- `200 { ok: true, deleted: n }` — removes the device's rows from all boards it
  is indexed on, plus a deterministic sweep of every game's all-time board and
  the current week board.

### `GET /health`

- `200 { ok: true, version }`

## Abuse controls

- Device rate limit: 1 submission per 30 seconds per `device`.
- IP rate limit: 20 submissions per 60 seconds per `CF-Connecting-IP`.
- Both counters are in-memory, per worker instance, intentionally approximate.
- Value bounds: `xp` 0..1,000,000 (integer), `time` 1..86,400 s (up to 3
  decimals), `streak` 0..3,650 (integer).
- Game slugs are validated against `GAME_SLUGS` in `src/index.js` (a manual copy
  of the live list in `games/registry.json`; keep it in sync).
- Nickname: 1..12 code points, truncated (not rejected) when longer; charset
  `[一-龥A-Za-z0-9 #_-]` (`#` is allowed so the anonymous `玩家 #A7F3`
  tag works), control and zero-width characters stripped, HTML angle brackets
  rejected, small hard-coded Chinese/English profanity blacklist (with
  space/underscore/hyphen compaction).

## Storage

Cloudflare KV, binding `LB`. Key layout (`v1:` prefix, easy to reset):

- `v1:board:<game>:week:<YYYY-Www>` — weekly board, TTL 14 days
- `v1:board:<game>:all` — all-time board, no TTL
- `v1:dev:<hash>` — small index of board keys per device (used by delete; capped
  at 128 keys)

Writes are read-modify-write. Concurrent submissions can lose an update; weekly
boards tolerate occasional loss, so no queue/DO is used by design.

## Local test

```sh
node games/leaderboard/worker/test.js
```

The test file imports the pure helpers from `src/index.js` (validation, name
cleaning, ranking, week buckets, avatar derivation, rate counters, hashing) and
needs no network, KV, or wrangler.

## Deploy

```sh
cd games/leaderboard/worker

# 1. Create the KV namespace and put the returned id into wrangler.toml
wrangler kv namespace create LB

# 2. One-time secret, random 32 bytes (do NOT commit this value)
openssl rand -hex 32 | wrangler secret put SALT

# 3. Deploy
wrangler deploy

# 4. Smoke test
curl -sS https://game-leaderboard.superapp-devin.workers.dev/health
curl -sS "https://game-leaderboard.superapp-devin.workers.dev/api/board?game=chess&period=week"
```

Required secret: `SALT`. If it is missing the worker answers
`500 { "ok": false, "error": "server_misconfigured" }` instead of hashing with an
empty salt.

## Known weaknesses

- No accounts: anyone can submit with a freshly generated `device`, so scores are
  forgeable. The value bounds and rate limits raise the cost but do not prove a
  game was played.
- The `device` string is a bearer token: anyone who obtains it can submit or
  delete scores for that identity. It lives in client storage only.
- Rate limits are per worker instance and reset on redeploy/instance churn; an
  attacker with many IPs or instances is not fully stopped.
- KV is eventually consistent; a just-written score can be missing from
  `/api/board` for a short time and from other regions for up to the KV
  propagation delay. `rank`/`best` are computed from the write path, so they can
  briefly disagree with a subsequent board read.
- Read-modify-write can drop a concurrent update. Weekly boards accept this.
- Deletion relies partly on a per-device index; a lost index write can leave a
  row until the deterministic sweep or the 14-day weekly TTL clears it.
- The profanity list is a small hard-coded baseline, not real moderation. Leetspeak
  and other evasions are not handled.
- Names are not unique, so two players can use the same nickname.
- Over-long nicknames are silently truncated to 12 code points; the client sees
  the cleaned name only on the board, not in the submit response.
