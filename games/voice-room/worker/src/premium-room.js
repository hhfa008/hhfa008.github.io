/*
 * Generic premium-room HTTP API on top of RoomDO.
 *
 * The room lifecycle (password hashing, join tokens, reconnect, storage TTL)
 * stays in RoomDO. This module adds the short-polling HTTP contract used by
 * Kot / Azul / Codenames online.html and delegates every game rule to the
 * per-game pure adapter:
 *
 *   games/boardgame/kot-premium/adapter.js
 *   games/boardgame/azul-premium/adapter.js
 *   games/boardgame/codenames-premium/adapter.js
 */
import kot from '../../../boardgame/kot-premium/adapter.js';
import azul from '../../../boardgame/azul-premium/adapter.js';
import codenames from '../../../boardgame/codenames-premium/adapter.js';

export const ADAPTERS = {
  'kot-premium': kot.adapter,
  'azul-premium': azul.adapter,
  'codenames-premium': codenames.adapter
};

export const GAME_SLUGS = Object.keys(ADAPTERS);

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const INVITE_TTL_MS = 60 * 60 * 1000;
const CREATE_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const IDLE_TAKEOVER_MS = 30 * 1000;
const MAX_HISTORY = 60;
const MAX_AI_STEPS = 400;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 32;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS
    }
  });
}
function fail(code, message, status) {
  return json({ ok: false, error: { code: code, message: message } }, status || 409);
}
function nowMs() { return Date.now(); }
function cleanPid(raw) {
  return String(raw == null ? '' : raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}
function cleanName(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 24);
  return s || '玩家';
}
function randomToken(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i += 1) out += arr[i].toString(16).padStart(2, '0');
  return out;
}
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-client-ip') || 'unknown';
}
function sessionToken(body, url, request) {
  const b = body || {};
  const q = url ? url.searchParams : null;
  return b.session || b.token || b.playerSession || b.player_session ||
    (q && (q.get('session') || q.get('token') || q.get('playerSession'))) ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || '';
}
function playerIdOf(body, url) {
  const b = body || {};
  const q = url ? url.searchParams : null;
  return cleanPid(b.playerId || b.userId || (q && (q.get('playerId') || q.get('userId'))));
}
function isAiSeat(seat) { return !!(seat && (seat.ai || seat.takeover)); }
function seatIndex(seats, playerId) {
  for (let i = 0; i < (seats || []).length; i += 1) {
    if (seats[i].playerId === playerId) return i;
  }
  return -1;
}
function recordHistory(state, entry) {
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push(Object.assign({ at: nowMs(), stateVersion: state.stateVersion || 0 }, entry));
  while (state.history.length > MAX_HISTORY) state.history.shift();
}
function touch(state, seat) {
  if (!seat) return;
  seat.lastSeen = nowMs();
  if (seat.takeover) {
    seat.takeover = false;
    if (!seat.ai) seat.ai = false;
  }
}
function rememberSession(state, token, playerId) {
  if (!token || !playerId) return;
  if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
  state.sessions[token] = playerId;
  const keys = Object.keys(state.sessions);
  if (keys.length > 40) delete state.sessions[keys[0]];
}
function connected(seat) {
  return !!seat && (seat.ai || (seat.lastSeen && nowMs() - seat.lastSeen < IDLE_TAKEOVER_MS));
}

function hydrateState(state) {
  if (!state) return state;
  const adapter = ADAPTERS[state.game];
  if (adapter && typeof adapter.hydrate === 'function') adapter.hydrate(state.match);
  return state;
}

async function loadState(doc) {
  return hydrateState((await doc.state.storage.get('premium')) || null);
}
async function saveState(doc, state) {
  state.updatedAt = nowMs();
  // JSON round-trip drops non-cloneable engine closures (the Codenames rng);
  // hydrateState() restores them on the next request.
  await doc.state.storage.put('premium', JSON.parse(JSON.stringify(state)));
}
async function armExpiry(doc, state) {
  try {
    await doc.state.storage.setAlarm(state.expiresAt);
    doc.alarmAt = state.expiresAt;
  } catch (e) { /* alarm is best-effort */ }
}

function makeInitialSeats(adapter, playerId, nickname) {
  if (adapter.game === 'codenames' || typeof adapter.assignSeats === 'function') {
    const seats = adapter.assignSeats([playerId]);
    if (seats[0]) {
      seats[0].nickname = nickname;
      seats[0].lastSeen = nowMs();
    }
    return seats;
  }
  const count = Math.max(2, Number(adapter.maxPlayers) || 4);
  const seats = [];
  for (let i = 0; i < count; i += 1) {
    const ai = i !== 0;
    seats.push({
      index: i,
      playerId: ai ? null : playerId,
      nickname: ai ? (adapter.aiNames[i] || ('AI · 座位 ' + (i + 1))) : nickname,
      ai: ai,
      takeover: false,
      lastSeen: ai ? 0 : nowMs()
    });
  }
  return seats;
}

function seatList(adapter, state, playerId, count) {
  let seats = state.seats.slice();
  if (count && seats.length > count) seats = seats.slice(0, count);
  while (count && seats.length < count) {
    const i = seats.length;
    seats.push({
      index: i,
      playerId: null,
      nickname: adapter.aiNames[i] || ('AI · 座位 ' + (i + 1)),
      ai: true,
      takeover: false,
      lastSeen: 0
    });
  }
  return seats.map(function (seat, index) {
    const copy = Object.assign({}, seat, { index: index });
    copy.isHost = seat.playerId != null && seat.playerId === state.hostId;
    copy.isYou = seat.playerId != null && seat.playerId === playerId;
    copy.connected = connected(seat);
    if (adapter.game === 'codenames') {
      copy.name = seat.nickname;
    } else {
      copy.name = seat.nickname || ('座位 ' + (index + 1));
    }
    return copy;
  });
}

function markTakeovers(state) {
  if (!state.started || state.over) return;
  const now = nowMs();
  state.seats.forEach(function (seat) {
    if (!seat.playerId || seat.ai) return;
    if (state.takeover && state.takeover[String(seat.index)]) {
      seat.takeover = true;
      return;
    }
    if (seat.lastSeen && now - seat.lastSeen > IDLE_TAKEOVER_MS) {
      seat.takeover = true;
    }
  });
}

function applyGameAction(adapter, match, seats, index, action) {
  if (adapter.game === 'codenames') return adapter.applyAction(match, index, seats, action);
  return adapter.applyAction(match, index, action);
}

async function runAi(doc, state) {
  const adapter = ADAPTERS[state.game];
  if (!adapter || !state.started || !state.match) return;
  markTakeovers(state);
  let steps = 0;
  while (steps < MAX_AI_STEPS && !adapter.isOver(state.match)) {
    const index = adapter.actingSeat(state.match, state.seats);
    if (index == null) break;
    const seat = state.seats[index];
    if (!isAiSeat(seat)) break;
    const action = adapter.aiAction(state.match, index, state.seats);
    if (!action) break;
    const applied = applyGameAction(adapter, state.match, state.seats, index, action);
    if (!applied || applied.ok === false) break;
    state.stateVersion = (state.stateVersion || 0) + 1;
    state.lastAction = {
      type: 'ai', seat: index, at: nowMs(), stateVersion: state.stateVersion,
      action: action
    };
    if (applied.events) state.events = applied.events;
    recordHistory(state, {
      type: 'ai', seat: index,
      action: adapter.publicAction ? adapter.publicAction(action) : action
    });
    steps += 1;
    if (adapter.isOver(state.match)) break;
  }
  if (adapter.isOver(state.match)) await finishRoom(doc, state);
}

async function finishRoom(doc, state) {
  if (state.over) return;
  const adapter = ADAPTERS[state.game];
  state.over = true;
  state.result = adapter.result(state.match, state.seats, state);
  if (state.result && typeof state.result === 'object') {
    state.result.roomId = state.room;
    state.result.roomCode = state.room;
    state.result.game = state.game === 'codenames-premium' ? 'codenames' : state.game;
  }
  state.stateVersion = (state.stateVersion || 0) + 1;
  state.lastAction = { type: 'over', at: nowMs(), stateVersion: state.stateVersion };
  recordHistory(state, {
    type: 'over',
    winner: state.result ? state.result.winner : null,
    scores: state.result ? state.result.scores : null
  });
  if (state.resultRecorded) return;
  state.resultRecorded = true;
  try { await recordLeaderboard(doc, state); } catch (e) { /* leaderboard is best-effort */ }
}

async function recordLeaderboard(doc, state) {
  const ns = doc.env && doc.env.LEADERBOARD;
  if (!ns) return;
  const adapter = ADAPTERS[state.game];
  let entries;
  if (state.game === 'codenames-premium') {
    const result = state.result || {};
    entries = [{
      id: 'result_' + state.room + '_' + nowMs(),
      roomId: state.room,
      roomCode: state.room,
      game: 'codenames',
      winner: result.winner,
      scores: result.scores || { red: 0, blue: 0 },
      turns: result.turns || 0,
      durationMs: result.durationMs || 0,
      finishedAt: result.finishedAt || new Date().toISOString(),
      seats: state.seats.map(function (seat) {
        return {
          id: seat.id, team: seat.team, role: seat.role,
          playerId: seat.playerId, nickname: seat.nickname, ai: !!seat.ai
        };
      })
    }];
  } else {
    entries = state.seats.map(function (seat, index) {
      return {
        game: adapter.slug,
        roomId: state.room,
        seat: index,
        name: seat.nickname || ('座位 ' + (index + 1)),
        ai: !!seat.ai,
        playerId: seat.playerId ? 'player:' + seat.playerId : null,
        winner: state.result && state.result.winnerSeat === index,
        score: state.result && Array.isArray(state.result.scores)
          ? state.result.scores[index] : null,
        at: nowMs()
      };
    });
  }
  const id = ns.idFromName('global');
  await ns.get(id).fetch('https://leaderboard/add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries: entries })
  });
}

export function premiumView(state, adapter, playerId, opts) {
  const options = opts || {};
  const viewerSeat = seatIndex(state.seats, playerId);
  const seat = viewerSeat >= 0 ? state.seats[viewerSeat] : null;
  const base = {
    ok: true,
    roomId: state.room,
    code: state.room,
    roomCode: state.room,
    game: state.game,
    hostId: state.hostId,
    visibility: state.visibility || 'public',
    hasPassword: !!state.hasPassword,
    maxPlayers: adapter.maxPlayers,
    started: !!state.started,
    over: !!state.over,
    playerCount: state.seats.length,
    stateVersion: state.stateVersion || 0,
    lastAction: state.lastAction || null,
    history: (state.history || []).slice(-20),
    result: state.result || null,
    canRestart: !!(state.over && playerId && playerId === state.hostId),
    takeover: state.seats.filter(function (s) { return s.takeover; }).map(function (s) { return s.index; }),
    aiSeats: state.seats.filter(function (s) { return s.ai; }).map(function (s) { return s.index; }),
    inviteCode: state.inviteCode || null,
    inviteToken: playerId && playerId === state.hostId ? (state.inviteCode || null) : null,
    // Frontends build the link from location + inviteCode so the page works
    // both at the repository root and under /games on GitHub Pages, and can
    // append their configured ?api= origin.
    inviteUrl: null,
    createdAt: state.createdAt || null,
    expiresAt: state.expiresAt || null,
    playerId: playerId || null,
    session: options.session || null,
    playerSession: options.session || null
  };

  if (state.game === 'codenames-premium') {
    const gameView = adapter.view(state.match, viewerSeat >= 0 ? viewerSeat : null, state.seats, {
      started: state.started,
      result: state.result,
      events: state.events || []
    });
    if (gameView) {
      Object.assign(base, gameView);
    } else {
      base.seats = state.seats.map(function (s) {
        return {
          id: s.id,
          team: s.team,
          role: s.role,
          label: STATE_ROLE_LABEL(s),
          playerId: s.playerId,
          nickname: s.nickname,
          ai: !!s.ai,
          takeover: !!s.takeover,
          controlledByAI: isAiSeat(s),
          current: false
        };
      });
      base.players = [];
      base.you = seat ? {
        playerId: seat.playerId, seat: seat.id, team: seat.team,
        role: seat.role, label: STATE_ROLE_LABEL(seat)
      } : null;
      base.turn = 'red';
      base.phase = 'waiting';
      base.turnNo = 0;
      base.clue = null;
      base.guessesLeft = 0;
      base.guessesMade = 0;
      base.scores = { red: 0, blue: 0 };
      base.remaining = { red: 9, blue: 8 };
      base.target = { red: 9, blue: 8 };
      base.winner = null;
      base.keyVisible = false;
      base.words = [];
      base.log = [];
      base.canClue = false;
      base.canGuess = false;
      base.canPass = false;
      base.suggestedClue = null;
      base.lastEvents = [];
      base.takeoverSeats = [];
      base.aiSeats = state.seats.filter(function (s) { return s.ai; }).map(function (s) { return s.id; });
      base.currentSeat = null;
      base.currentSeatLabel = null;
      base.currentPlayerId = null;
      base.currentSeatIsAI = false;
    }
    base.status = state.over ? 'finished' : (state.started ? 'playing' : 'waiting');
    base.roomStatus = base.status;
    base.seats = (base.seats || []).map(function (s) {
      const stored = state.seats.find(function (x) { return x.id === s.id; });
      return Object.assign({}, s, {
        isHost: !!stored && stored.playerId != null && stored.playerId === state.hostId,
        isYou: !!stored && stored.playerId != null && stored.playerId === playerId,
        connected: stored ? connected(stored) : false
      });
    });
    base.you = seat ? {
      playerId: seat.playerId, seat: seat.id, team: seat.team,
      role: seat.role,
      label: STATE_ROLE_LABEL(seat)
    } : null;
    base.playerId = playerId || null;
    return base;
  }

  base.seats = seatList(adapter, state, playerId);
  base.you = viewerSeat >= 0 ? viewerSeat : null;
  base.state = state.match ? adapter.view(state.match, viewerSeat >= 0 ? viewerSeat : null) : null;
  base.legalActions = state.match && !state.over && viewerSeat >= 0
    ? adapter.legalActions(state.match, viewerSeat)
    : [];
  if (state.match && state.match.seats) {
    base.seats.forEach(function (s, index) {
      const matchSeat = state.match.seats[index];
      if (matchSeat && matchSeat.name) s.name = matchSeat.name;
    });
  }
  return base;
}

function STATE_ROLE_LABEL(seat) {
  const team = seat.team === 'red' ? '红队' : '蓝队';
  return team + (seat.role === 'captain' ? '队长' : '队员');
}

async function authenticate(doc, state, request, body, url) {
  const token = sessionToken(body, url, request);
  let playerId = playerIdOf(body, url);
  // Reconnect (/reconnect) may carry only the bearer token. The room keeps a
  // small token -> playerId map so the session can identify its seat.
  if (!playerId && token && state.sessions && state.sessions[token]) {
    playerId = cleanPid(state.sessions[token]);
  }
  if (!playerId) return { ok: false, failure: fail('E_PLAYER', 'playerId is required', 401) };
  if (!token) return { ok: false, failure: fail('E_SESSION', 'session is required', 401) };
  const valid = await doc.verifyJoinToken(state.room, playerId, token);
  if (!valid) return { ok: false, failure: fail('E_SESSION', 'invalid or expired session', 401) };
  const index = seatIndex(state.seats, playerId);
  if (index < 0) return { ok: false, failure: fail('E_SEAT', 'player is not seated', 403) };
  return { ok: true, playerId: playerId, index: index, seat: state.seats[index], token: token };
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (text.length > 64 * 1024) return null;
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return null;
  }
}

function newInvite(state) {
  const token = 'inv-' + state.room + '-' + randomToken(12);
  if (!state.invites) state.invites = {};
  state.invites[token] = { expiresAt: nowMs() + INVITE_TTL_MS, usedBy: null };
  state.inviteCode = token;
  return token;
}

async function handleCreate(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const game = String(body.game || '').trim();
  const adapter = ADAPTERS[game];
  if (!adapter) return fail('E_GAME', 'unknown game', 400);
  const playerId = cleanPid(body.playerId || body.hostId);
  if (!playerId) return fail('E_PLAYER', 'playerId is required', 422);
  const nickname = cleanName(body.nickname || playerId);
  const room = url.searchParams.get('room') || doc.roomCode || '';
  if (!/^\d{4}$/.test(room)) return fail('E_ROOM', 'bad room code', 400);

  const existing = await loadState(doc);
  const meta = await doc.state.storage.get('meta');
  if (existing || meta) return fail('E_EXISTS', 'room already exists', 409);

  const password = typeof body.password === 'string' ? body.password : '';
  if (password && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    return fail('E_PASSWORD_FORMAT', 'password must be 4-32 characters', 422);
  }
  const auth = password ? await doc.makePasswordAuth(password) : null;
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  const createdAt = nowMs();
  await doc.state.storage.put('meta', {
    room: room,
    game: game,
    createdAt: createdAt,
    visibility: visibility,
    auth: auth || null
  });

  const seats = makeInitialSeats(adapter, playerId, nickname);
  doc.roomCode = room;
  const state = {
    game: game,
    room: room,
    hostId: playerId,
    visibility: visibility,
    hasPassword: !!auth,
    seats: seats,
    match: null,
    started: false,
    over: false,
    result: null,
    resultRecorded: false,
    stateVersion: 0,
    lastAction: null,
    history: [],
    events: [],
    invites: {},
    inviteCode: null,
    idempotency: {},
    sessions: {},
    createdAt: createdAt,
    expiresAt: createdAt + ROOM_TTL_MS,
    updatedAt: createdAt
  };
  newInvite(state);
  state.invites[state.inviteCode].expiresAt = createdAt + CREATE_INVITE_TTL_MS;
  const token = await doc.makeJoinToken(room, playerId);
  rememberSession(state, token, playerId);
  await saveState(doc, state);
  await armExpiry(doc, state);

  const view = premiumView(state, adapter, playerId, { session: token });
  return json(Object.assign(view, {
    ok: true,
    playerId: playerId,
    session: token,
    playerSession: token,
    inviteToken: state.inviteCode,
    inviteCode: state.inviteCode
  }), 201);
}

async function handleJoin(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const playerId = cleanPid(body.playerId || body.userId);
  if (!playerId) return fail('E_PLAYER', 'playerId is required', 422);
  const nickname = cleanName(body.nickname || playerId);
  const now = nowMs();

  const index = seatIndex(state.seats, playerId);
  if (index >= 0) {
    const seat = state.seats[index];
    seat.ai = false;
    seat.takeover = false;
    seat.nickname = nickname || seat.nickname;
    seat.lastSeen = now;
    const token = await doc.makeJoinToken(state.room, playerId);
    rememberSession(state, token, playerId);
    await saveState(doc, state);
    return json(Object.assign(premiumView(state, adapter, playerId, { session: token }), {
      ok: true, playerId: playerId, session: token, playerSession: token,
      seat: index, rejoin: true
    }));
  }
  if (state.started) return fail('E_STARTED', 'match already started', 409);

  let invited = false;
  let matchedInvite = null;
  const invite = String(body.inviteCode || body.inviteToken || body.code || '');
  if (invite && invite !== state.room) {
    const row = state.invites && state.invites[invite];
    if (!row || row.expiresAt < now || row.usedBy) {
      return fail('E_INVITE', 'invalid or expired invite', 403);
    }
    matchedInvite = row;
    invited = true;
  }

  if (!invited) {
    if (state.visibility === 'private') {
      return fail('E_PRIVATE', 'private room requires an invite', 403);
    }
    if (state.hasPassword) {
      const meta = await doc.state.storage.get('meta');
      const password = typeof body.password === 'string' ? body.password : '';
      const check = await doc.verifyPasswordWithRate(clientIp(request), password, meta && meta.auth);
      if (!check.ok) return fail(check.code, check.message || 'password rejected', check.status || 403);
    }
  }

  const free = state.seats.find(function (s) { return s.ai && !s.playerId; }) ||
    state.seats.find(function (s) { return !s.playerId; });
  if (!free) return fail('E_FULL', 'room is full', 409);
  if (matchedInvite) matchedInvite.usedBy = playerId;
  free.playerId = playerId;
  free.ai = false;
  free.takeover = false;
  free.nickname = nickname;
  free.lastSeen = now;
  state.stateVersion = (state.stateVersion || 0) + 1;
  recordHistory(state, { type: 'join', playerId: playerId });
  const token = await doc.makeJoinToken(state.room, playerId);
  rememberSession(state, token, playerId);
  await saveState(doc, state);
  return json(Object.assign(premiumView(state, adapter, playerId, { session: token }), {
    ok: true, playerId: playerId, session: token, playerSession: token,
    seat: free.index
  }));
}

async function handleStart(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  if (who.playerId !== state.hostId) return fail('E_HOST', 'only the host can start', 403);
  if (state.started) return fail('E_STARTED', 'match already started', 409);
  touch(state, who.seat);

  const humans = state.seats.filter(function (s) { return !s.ai && s.playerId; }).length;
  let count = adapter.seatCount({ humans: humans, seats: state.seats.slice() });
  if (state.game === 'codenames-premium') count = 4;
  count = Math.max(adapter.minPlayers, Math.min(adapter.maxPlayers, count));
  const matchSeats = seatList(adapter, state, who.playerId, count).map(function (s) {
    return { name: s.name, ai: !!s.ai };
  });
  state.seats = seatList(adapter, state, who.playerId, count).map(function (s) {
    const raw = state.seats.find(function (x) { return x.playerId && x.playerId === s.playerId; });
    return {
      index: s.index,
      id: s.id,
      team: s.team,
      role: s.role,
      playerId: s.playerId,
      nickname: s.nickname,
      ai: !!s.ai,
      takeover: false,
      lastSeen: raw && raw.lastSeen ? raw.lastSeen : (s.ai ? 0 : nowMs())
    };
  });
  const seed = (nowMs() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  state.match = adapter.createMatch({ seed: seed, seats: matchSeats });
  if (!state.match.seats) state.match.seats = matchSeats;
  state.started = true;
  state.startedAt = nowMs();
  state.over = false;
  state.result = null;
  state.resultRecorded = false;
  state.stateVersion = (state.stateVersion || 0) + 1;
  state.lastAction = { type: 'start', at: nowMs(), stateVersion: state.stateVersion };
  state.history = [];
  state.events = [];
  recordHistory(state, { type: 'start' });
  await runAi(doc, state);
  await saveState(doc, state);
  return json(premiumView(state, adapter, who.playerId, { session: who.token }));
}

async function handleGet(doc, request, url) {
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, {}, url);
  if (!who.ok) return who.failure;
  touch(state, who.seat);
  await runAi(doc, state);
  await saveState(doc, state);
  return json(premiumView(state, adapter, who.playerId, { session: who.token }));
}

async function handleAction(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  touch(state, who.seat);
  if (!state.started) return fail('E_STATE', 'match has not started', 409);
  if (state.over) return fail('E_STATE', 'match is over', 409);
  if (who.seat.ai) return fail('E_AI', 'seat is under AI control', 409);

  const key = body.idempotencyKey ? String(body.idempotencyKey) : null;
  const idemKey = key ? who.playerId + ':' + key : null;
  if (idemKey && state.idempotency && state.idempotency[idemKey]) {
    return json(state.idempotency[idemKey]);
  }

  let action;
  if (state.game === 'codenames-premium') {
    action = {
      type: body.type || body.action,
      text: body.text,
      count: body.count == null ? body.number : body.count,
      index: body.index
    };
  } else {
    action = body.action;
  }
  const applied = applyGameAction(adapter, state.match, state.seats, who.index, action);
  if (applied && applied.ok === false) {
    return fail(applied.code || 'E_ACTION', applied.error || 'illegal action', 409);
  }
  state.stateVersion = (state.stateVersion || 0) + 1;
  state.lastAction = {
    type: 'human', seat: who.index, at: nowMs(),
    stateVersion: state.stateVersion, action: action
  };
  if (applied && applied.events) state.events = applied.events;
  recordHistory(state, {
    type: 'human', seat: who.index,
    action: adapter.publicAction ? adapter.publicAction(action) : action
  });
  await runAi(doc, state);
  await saveState(doc, state);
  const view = premiumView(state, adapter, who.playerId, { session: who.token });
  if (idemKey) {
    if (!state.idempotency) state.idempotency = {};
    state.idempotency[idemKey] = view;
    await saveState(doc, state);
  }
  return json(view);
}

async function handleReconnect(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  touch(state, who.seat);
  await runAi(doc, state);
  rememberSession(state, who.token || sessionToken(body, url, request), who.playerId);
  await saveState(doc, state);
  return json(Object.assign(premiumView(state, adapter, who.playerId, { session: who.token }), {
    ok: true, reconnected: true, playerId: who.playerId, session: who.token,
    playerSession: who.token, seat: who.index
  }));
}

async function handleLeave(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  const seat = who.seat;
  if (state.started) {
    seat.ai = true;
    seat.takeover = true;
    seat.playerId = null;
    seat.nickname = state.game === 'codenames-premium'
      ? STATE_ROLE_LABEL(seat) + ' AI（托管）'
      : (adapter.aiNames[seat.index] || ('AI · 座位 ' + (seat.index + 1)));
  } else {
    seat.ai = true;
    seat.playerId = null;
    seat.takeover = false;
    seat.nickname = adapter.aiNames[seat.index] || ('AI · 座位 ' + (seat.index + 1));
    if (seat.id) seat.nickname = STATE_ROLE_LABEL(seat) + ' AI';
  }
  const human = state.seats.find(function (s) { return s.playerId && s.playerId !== who.playerId; });
  if (!state.started && who.playerId === state.hostId) {
    state.hostId = human ? human.playerId : null;
  }
  state.stateVersion = (state.stateVersion || 0) + 1;
  recordHistory(state, { type: 'leave', seat: seat.index });
  await runAi(doc, state);
  await saveState(doc, state);
  return json(Object.assign(premiumView(state, adapter, who.playerId, { session: who.token }), {
    ok: true, left: true, playerId: who.playerId, roomId: state.room
  }));
}

async function handleInvite(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  if (who.playerId !== state.hostId) return fail('E_HOST', 'only the host can invite', 403);
  const token = newInvite(state);
  await saveState(doc, state);
  return json({
    ok: true,
    roomId: state.room,
    game: state.game,
    inviteCode: token,
    inviteToken: token,
    expiresAt: state.invites[token].expiresAt,
    inviteUrl: null
  });
}

async function handleTick(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  touch(state, who.seat);
  if (!state.started) return fail('E_STATE', 'match has not started', 409);
  await runAi(doc, state);
  await saveState(doc, state);
  return json(premiumView(state, adapter, who.playerId, { session: who.token }));
}

async function handleRestart(doc, request, url) {
  const body = await readBody(request);
  if (body == null) return fail('E_JSON', 'invalid JSON', 400);
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, body, url);
  if (!who.ok) return who.failure;
  if (who.playerId !== state.hostId) return fail('E_HOST', 'only the host can restart', 403);
  if (!state.over) return fail('E_STATE', 'match is not over', 409);
  const matchSeats = state.seats.map(function (s) {
    const seat = s.playerId ? s : s;
    return { name: seat.nickname || ('座位 ' + (s.index + 1)), ai: !!seat.ai };
  });
  state.match = adapter.restart(state.match, state.seats);
  if (!state.match.seats) state.match.seats = matchSeats;
  state.over = false;
  state.result = null;
  state.resultRecorded = false;
  state.started = true;
  state.startedAt = nowMs();
  state.stateVersion = (state.stateVersion || 0) + 1;
  state.lastAction = { type: 'restart', at: nowMs(), stateVersion: state.stateVersion };
  state.history = [];
  state.events = [];
  recordHistory(state, { type: 'restart' });
  await runAi(doc, state);
  await saveState(doc, state);
  return json(premiumView(state, adapter, who.playerId, { session: who.token }));
}

async function handleDelete(doc, request, url) {
  const state = await loadState(doc);
  if (!state) return fail('E_NOT_FOUND', 'room not found', 404);
  const adapter = ADAPTERS[state.game];
  const who = await authenticate(doc, state, request, {}, url);
  if (!who.ok) return who.failure;
  if (who.playerId !== state.hostId) return fail('E_HOST', 'only the host can close', 403);
  await doc.state.storage.deleteAll();
  doc.roomCode = null;
  return json({ ok: true, roomId: state.room, closed: true });
}

export async function handlePremiumRequest(doc, request, url) {
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/premium/create' && request.method === 'POST') return handleCreate(doc, request, url);
  if (path === '/premium/room' && request.method === 'GET') return handleGet(doc, request, url);
  if (path === '/premium/room' && request.method === 'DELETE') return handleDelete(doc, request, url);
  if (path === '/premium/room/join' && request.method === 'POST') return handleJoin(doc, request, url);
  if (path === '/premium/room/start' && request.method === 'POST') return handleStart(doc, request, url);
  if (path === '/premium/room/actions' && request.method === 'POST') return handleAction(doc, request, url);
  if (path === '/premium/room/reconnect' && request.method === 'POST') return handleReconnect(doc, request, url);
  if (path === '/premium/room/leave' && request.method === 'POST') return handleLeave(doc, request, url);
  if (path === '/premium/room/invite' && request.method === 'POST') return handleInvite(doc, request, url);
  if (path === '/premium/room/tick' && request.method === 'POST') return handleTick(doc, request, url);
  if (path === '/premium/room/restart' && request.method === 'POST') return handleRestart(doc, request, url);
  return fail('E_NOT_FOUND', 'not found', 404);
}

// Called by RoomDO.alarm(). Premium rooms expire after two hours even when no
// browser is polling; AI turns are advanced before re-arming the alarm.
export async function handlePremiumAlarm(doc) {
  const state = await loadState(doc);
  if (!state) return false;
  if (nowMs() >= state.expiresAt) {
    await doc.state.storage.deleteAll();
    doc.roomCode = null;
    return true;
  }
  await runAi(doc, state);
  await saveState(doc, state);
  await armExpiry(doc, state);
  return true;
}
