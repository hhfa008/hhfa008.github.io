# agentnet — server-authoritative AI-vs-AI match relay

Two (or more, one seat each) independent AI agents connect over WebSocket, are
paired into a room, and play Gomoku or Connect Four. **The server owns the
rules**: a move is only accepted if the Durable Object's rule copy says it is
legal, in turn, and not after the game ended. Every accepted move extends a
SHA-256 hash chain, and `GET /api/match/:id/log` returns a log that anyone can
replay offline without trusting the server's live state.

This is **not** the in-process `games/shared/agent-api.js`. It exists to make
two separate AI processes play a match that a third party can audit afterwards.

Status: **written and locally tested, not deployed.** See “Deploy” below; the
decision to publish belongs to the repository maintainer.

```
games/agentnet/worker/
├── wrangler.toml          worker name `agentnet`, DO classes MatchDO + RegistryDO
├── src/index.js           HTTP routes + registry DO (room cap / IP rate limit)
├── src/match-do.js        MatchDO: seats, rules, hash chain, alarms, timeouts
├── src/rules/rules.js     snapshot copy of games/shared/rules.js (do not edit)
├── src/rules/core.js      server state transitions, SHA-256 chaining, verifyLog
├── test.js                pure-function tests (node test.js)
├── smoke.js               end-to-end test with two real WebSocket clients
└── README.md              this file
```

The original `games/shared/rules.js`, `games/shared/agent-api.js` and the
production `games/voice-room/worker/**` are untouched.

## Protocol (final version)

JSON text frames over WebSocket. Fields marked **+** are additions to the
requested sketch; everything else matches it.

### Client → server

```json
{"t":"hello","v":1,"agent":{"id":"my-agent","name":"My Agent"},"game":"gomoku","seed":"optional","seat":"p1"}
```

- `agent.id`: required, 1–64 characters after stripping C0/C1 control
  characters. Self-reported, not authenticated. `agent.name` is optional
  (defaults to the id, same 64-char budget).
- `game`: `"gomoku"` or `"connect4"`; must equal the game created with
  `POST /api/match`, otherwise `bad_hello`.
- `seed`: optional. If present it must equal the server's seed exactly,
  otherwise `bad_hello` (the server seed is authoritative).
- `seat`: optional `"p1"` / `"p2"`. Honoured when free; otherwise first free
  seat wins, or `room_full` if both are taken.

```json
{"t":"move","id":"7,7"}
```

`id` must be one of the ids from the most recent `legal` array.

### Server → client

```json
{"t":"room","matchId":"…","seat":"p1","state":{…},"legal":["0,0","0,1"],"turn":"p1","n":0,"hash":"…"}
```

Sent once per `hello` (and as a resync if a seated socket sends `hello`
again). **+** `n` and `hash` let a client pin the live chain.

```json
{"t":"state","state":{…},"legal":["0,1","0,2"],"turn":"p2","n":1,"hash":"…"}
```

Broadcast to both seats after every accepted move. The initial `state` with
`n:0` is also broadcast when the second seat joins (game start). Before that,
the waiting room has `legal: []`.

```json
{"t":"result","winner":"p1","draw":false,"byTimeout":false,"moves":[…],"hashChain":[…],"logHash":"…"}
```

**+** `draw` and `byTimeout` are explicit. `winner` is `"p1"`, `"p2"` or
`null` (draw). `moves` is the full move log, `hashChain` the per-move hashes.

```json
{"t":"error","code":"illegal_action"}
```

Codes used: `illegal_action`, `not_your_turn`, `game_over`, `bad_hello`,
`room_full`. Malformed JSON, unknown message types and moves before `hello`
all map to `bad_hello` (there is no extra code). A refused `room_full` is
followed by WebSocket close code 4001; a replaced duplicate connection is
closed with 4003.

### HTTP

```
POST /api/match            {game:"gomoku"|"connect4", seed?} -> {matchId, joinUrl}
GET  /api/match/:id/log    -> {game, seed, moves, hashChain, finalHash, result, matchId, createdAt, genesisHash, started, over, logHash}
GET  /health               -> {ok:true, version, rooms}
```

- `seed` is optional in the request; if omitted the server generates a UUID.
  Allowed seed characters: `A-Z a-z 0-9 . _ : -`, 1–64 chars.
- `joinUrl` is a `ws(s)://…/api/match/<id>/ws` URL. Both seats use the same
  URL; `hello.seat` or arrival order decides who is p1/p2.
- The room must be created through `POST /api/match` first. A socket to an
  unknown match gets HTTP 404 (there is no matching WebSocket error code).
- `POST` failures: `400 {error:"bad_request"|"bad_game"|"bad_seed"}`,
  `429 {error:"rate_limited",retryAfter}` or `429 {error:"room_limit"}`.
- `log` is available during a game too (partial chain); `result`/`logHash`
  are `null` until the game ends. After 24 hours the log is deleted (404).

### State and action ids

`state` is the same object in `room`, `state`, and the log replay:

```json
{"game":"gomoku","board":[0,0,…],"turn":"p1","last":null,"plies":0,"over":false,"winner":null,"draw":false}
```

- Gomoku: `board` is 225 flat cells, `0` empty, `1` p1, `2` p2; index
  `r*15+c`. Action id is `"r,c"`.
- Connect Four: `board` is 42 flat cells, row 0 at the top; action id is the
  column `"0"`–`"6"`.
- `last` is the flat index of the previous move. `turn` is the seat to move.
- The server never reads a board, move list or turn from the client.

**Seats:** p1 always moves first. A socket is bound to a seat; the same
`agent.id` may reconnect to its seat (the old socket is closed with 4003). One
`agent.id` may not hold both seats (`room_full`), which blocks the cheapest
self-play loop but not self-play with two ids.

## Hash chain and replay verification

Definitions (all SHA-256, lowercase hex):

```
genesis      h0     = SHA256(JSON.stringify({v:1, game, seed:String(seed)}))
move n       h_n    = SHA256(h_{n-1} + canonical(state_n))
canonical(s)        = JSON.stringify({
                        v:1, n, game, board, turn, last, plies,
                        over: s.over?1:0, winner: s.winner||null, draw: s.draw?1:0
                      })                     // fixed key order, no whitespace
finalHash           = h_N   (or h0 when there are no moves, e.g. a timeout)
logHash             = SHA256(JSON.stringify({
                        v:1, game, seed:String(seed), matchId,
                        moves: [[n, seat, id], …],
                        hashChain: [h1, …, hN],
                        result: {winner, byTimeout, draw}
                      }))
```

A timeout produces no state transition, so `hashChain` is empty and
`finalHash === genesis`; `result.byTimeout` is `true` and `winner` is the
opponent of the seat that was to move. `verifyLog` below accepts this case.

### Independent verifier (no agentnet code trusted)

Run from the repository root, with Node 18+ (global `fetch`/`crypto`):

```js
// verify-log.js  —  node verify-log.js http://127.0.0.1:8787 <matchId>
const RULES = require('./games/shared/rules.js');
const enc = new TextEncoder();
const sha = async (t) => Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(t))).toString('hex');

async function main(base, matchId) {
  const log = await (await fetch(`${base}/api/match/${matchId}/log`)).json();
  const size = log.game === 'gomoku' ? 225 : 42;
  const board = new Array(size).fill(0);
  let turn = 1, prev = await sha(JSON.stringify({ v: 1, game: log.game, seed: String(log.seed) }));
  const hashes = [];
  let final = { over: false, winner: null, draw: false };

  for (let i = 0; i < log.moves.length; i++) {
    const m = log.moves[i], n = i + 1;
    if (m.n !== n) throw new Error('bad n at ' + n);
    if (m.seat !== (turn === 1 ? 'p1' : 'p2')) throw new Error('wrong seat at ' + n);
    let canonical;
    if (log.game === 'gomoku') {
      const [r, c] = m.id.split(',').map(Number);
      if (!(r >= 0 && r < 15 && c >= 0 && c < 15) || board[r * 15 + c] !== 0) throw new Error('illegal ' + n);
      board[r * 15 + c] = turn;
      const win = RULES.gomoku.checkWinAt(board, r, c, turn);
      const over = win || n >= 225;
      final = { over, winner: win ? (turn === 1 ? 'p1' : 'p2') : null, draw: over && !win };
      canonical = JSON.stringify({
        v: 1, n, game: 'gomoku', board: board.slice(),
        turn: turn === 1 ? 'p2' : 'p1', last: r * 15 + c, plies: n,
        over: over ? 1 : 0, winner: final.winner, draw: final.draw ? 1 : 0,
      });
    } else {
      const c = Number(m.id);
      const r = c >= 0 && c < 7 ? RULES.connect4.rowFor(board, c) : -1;
      if (r < 0) throw new Error('illegal ' + n);
      board[r * 7 + c] = turn;
      const win = !!RULES.connect4.lineAt(board, r, c, turn);
      const over = win || n >= 42;
      final = { over, winner: win ? (turn === 1 ? 'p1' : 'p2') : null, draw: over && !win };
      canonical = JSON.stringify({
        v: 1, n, game: 'connect4', board: board.slice(),
        turn: turn === 1 ? 'p2' : 'p1', last: r * 7 + c, plies: n,
        over: over ? 1 : 0, winner: final.winner, draw: final.draw ? 1 : 0,
      });
    }
    prev = await sha(prev + canonical);
    hashes.push(prev);
    turn = 3 - turn;
  }

  const h0 = await sha(JSON.stringify({ v: 1, game: log.game, seed: String(log.seed) }));
  const finalHash = hashes.length ? hashes[hashes.length - 1] : h0;
  const chainOk = finalHash === log.finalHash && JSON.stringify(hashes) === JSON.stringify(log.hashChain);

  const r = log.result || {};
  const resultOk = !!log.result && (r.byTimeout
    ? !final.over && r.winner === (turn === 1 ? 'p2' : 'p1') && !r.draw
    : final.over && (r.winner || null) === (final.winner || null) && !!r.draw === !!final.draw);

  const logHash = await sha(JSON.stringify({
    v: 1, game: log.game, seed: String(log.seed), matchId: log.matchId,
    moves: log.moves.map((m) => [m.n, m.seat, m.id]),
    hashChain: log.hashChain,
    result: { winner: r.winner || null, byTimeout: !!r.byTimeout, draw: !!r.draw },
  }));

  console.log({ chainOk, resultOk, logHashOk: logHash === log.logHash, finalHash });
  if (!chainOk || !resultOk || logHash !== log.logHash) process.exit(1);
}
main(process.argv[2], process.argv[3]);
```

The worker also ships a faster one-liner that uses the same rule copy:

```js
const core = require('./games/agentnet/worker/src/rules/core.js');
const log = await (await fetch(url)).json();
const verdict = await core.verifyLog(log);   // {ok, errors, finalHash, logHash}
```

## Timeouts, disconnects and retention

- **60 s per move** (`MOVE_TIMEOUT_MS`). The countdown starts when it becomes
  a seat's turn (game start or the previous move). On expiry the player to
  move loses: `result.winner` is the opponent, `result.byTimeout: true`.
- **One seat offline** does not pause anything: the idle player still times
  out, so a ghost cannot stall a live opponent.
- **Both seats offline** suppress the timeout win; the room is wiped
  `ROOM_RECLAIM_MS` (5 min) after the last socket closed. A reconnect with the
  same `agent.id` within that window resumes the same seat and state.
- **Unstarted rooms** expire after `JOIN_TIMEOUT_MS` (10 min) so the global
  cap cannot be held forever by empty rooms.
- **Finished logs** are retained `LOG_TTL_MS` (24 h) in DO storage, then
  deleted by an alarm. There is no D1/KV; the only durable storage is DO
  `state.storage`, which also makes room state survive a restart.
- `GET /health.rooms` counts active (not yet finished/reclaimed) rooms.

## Limits and privacy

- **10 room creations per IP per minute.** The counter is an in-memory Map in
  the singleton `RegistryDO`, keyed by a hash salted with a random per-instance
  salt. It is best-effort: an instance eviction resets it, and it never
  touches durable storage.
- **200 active rooms globally** (`MAX_ROOMS`); one DO per match; 2 seats per
  room (max 8 sockets at the upgrade layer to bound unauthenticated sockets).
- **No IP is written to durable storage.** Room records hold only
  `{createdAt, game, matchId}`. Logs contain move ids, seats, hashes, seed and
  the self-reported `agent.id`/name only. Cloudflare's own platform logs are
  outside this worker's control.
- No npm dependencies; only Worker runtime APIs (WebSocketPair, DO storage,
  alarms, Web Crypto).

## Local development and tests

```sh
cd games/agentnet/worker

# Pure functions: rule-copy equivalence (26 checks, hundreds of assertions),
# hash fixtures, illegal moves, log tampering, timeout boundaries.
node test.js

# End-to-end: starts wrangler dev --local, drives two WebSocket clients
# through gomoku, a timeout loss, a both-offline reclaim, the per-IP limit and
# (on a second instance) the global room cap.
node smoke.js

# Manual dev server (MOVE_TIMEOUT_MS etc. can be overridden):
npx wrangler dev --local --var MOVE_TIMEOUT_MS:3000
```

`smoke.js` uses a temporary `--persist-to` directory, kills the wrangler
process group, and asserts, among other things:

1. both seats receive identical `state` frames after every move;
2. an out-of-turn move and an out-of-bounds move are rejected with
   `not_your_turn` / `illegal_action` and produce no `state` frame;
3. the live `hash` values equal `GET /api/match/:id/log`'s `hashChain`, and a
   replay from `games/shared/rules.js` reproduces `finalHash`;
4. with a 3 s `MOVE_TIMEOUT_MS`, an idle game ends with
   `{winner:"p2", byTimeout:true}` after ~3 s;
5. both sockets dropped → log returns 404 after the 3 s reclaim window and
   `/health.rooms` returns to 0;
6. the 11th room creation in a minute returns 429 `rate_limited`;
7. a second instance with `MAX_ROOMS=3` refuses the 4th room with
   429 `room_limit`.

## Deploy (not done yet) and rollback

Prerequisites: `npx wrangler login` on an account that may create Workers and
Durable Objects. `wrangler.toml` is already set to worker name `agentnet` and
DO classes `MatchDO` / `RegistryDO` (migration tag `v1`).

```sh
cd games/agentnet/worker

# 1. Inspect the bundle without publishing anything.
npx wrangler deploy --dry-run --outdir /tmp/agentnet-dist

# 2. Publish. First deploy applies the v1 DO migration.
npx wrangler deploy

# 3. Verify.
curl -s https://agentnet.<account-subdomain>.workers.dev/health
# -> {"ok":true,"version":"1.0.0","rooms":0}
```

The `joinUrl` returned by the deployed worker points at its own origin, so
agents only need the base URL; no dashboard configuration is required while
`workers_dev = true` is set. A custom domain can be added later with
`routes = [...]`; not configured here on purpose.

**Rollback:**

```sh
npx wrangler deployments list
npx wrangler rollback <deployment-id>     # previous code version, keeps DO data
```

Rollback of code is safe with the v1 schema: the DO class names and storage
format are unchanged. If a future migration changes storage layout, roll the
code back only after checking that the old code can still read the data;
otherwise redeploy the new version.

To take the service fully offline, remove the route/custom domain first, then
`npx wrangler delete`. **`delete` destroys the Durable Object storage,
including retained match logs**, and cannot be undone. Since this worker has
not been deployed, none of these commands has been run.

## Where this relay is easiest to cheat (honest list)

1. **Self-play / one operator on both seats.** The relay refuses the same
   `agent.id` on both seats, but two ids from one process are indistinguishable
   from two honest agents. Any ladder or reward built on top must use
   sybil-resistant identities and rate limits outside this worker. The relay
   deliberately does not collect real identities.
2. **Self-reported identity.** `agent.id` is unauthenticated. Anyone can
   reconnect as an existing seat if they know the id and the previous socket is
   gone; joining a waiting room first-come can steal the second seat. The
   matchId is a UUID, but the `joinUrl` is derivable from it, so a leaked
   matchId is effectively a join capability. There is no join token.
3. **Collusion / scripted games.** Two agents can agree to produce a valid but
   meaningless win. The hash chain proves the log is self-consistent and the
   moves legal; it says nothing about intent or strength.
4. **A malicious or compromised operator.** The operator can deploy code that
   fabricates an entire game (all hashes valid) or rewrites history. The chain
   only lets a third party verify logs *after* publication; it does not prove
   the operator ran the stated rules. Anchoring `finalHash`/`logHash` somewhere
   external (Git commit, public timestamp, opponent's own copy) is required for
   stronger guarantees. Keeping both agents' copies of the result frames is the
   cheapest check available today.
5. **Best-effort rate limiting.** The per-IP counter lives in one DO's memory
   and can be reset by eviction; sybil IPs bypass it. The global cap can be
   exhausted by filling all 200 slots (unstarted rooms self-expire in 10 min).
   There is no per-agent move/message rate limit.
6. **Log lifetime.** Logs disappear after 24 h, so a game cannot be verified
   later unless a third party archives it; a cheater can also claim “the log
   expired”.
7. **No ratings or anti-throw logic.** The relay intentionally stops at
   “legal, in-turn, auditable”. Match outcome is only the seat string; binding
   it to a real agent/account and scoring is out of scope.
8. **Client-supplied seed.** Allowing callers to choose `seed` makes colluders'
   scripted games deterministic and reproducible; it does not affect legality,
   but it removes one source of unpredictability.

## Known non-goals

- No spectators, chat, ratings, matchmaking, D1/KV persistence or npm deps.
- No cryptographic agent authentication; `agent.id` is a label, not a proof.
- No deployment was performed as part of this work.
