/*
 * Codenames Premium — pure game adapter.
 *
 * Shared by the Cloudflare Worker premium-room backend. All rules and the
 * hidden-key projection come from engine.js; this file only maps the four
 * fixed seats onto the engine and shapes the per-viewer payload. It does not
 * implement room state, passwords, invites, reconnect or AI scheduling.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'codenames-premium';
const GAME = 'codenames';
const TEAM_LABEL = { red: '红队', blue: '蓝队' };
const ROLE_LABEL = { captain: '队长', operative: '队员' };
const SEATS = [
  { id: 'red-captain', team: 'red', role: 'captain' },
  { id: 'red-operative', team: 'red', role: 'operative' },
  { id: 'blue-captain', team: 'blue', role: 'captain' },
  { id: 'blue-operative', team: 'blue', role: 'operative' }
];
const AI_NICKNAMES = SEATS.map(function (seat) {
  return TEAM_LABEL[seat.team] + ' AI' + ROLE_LABEL[seat.role];
});

function roleLabel(seat) {
  return seat ? TEAM_LABEL[seat.team] + ROLE_LABEL[seat.role] : '';
}

function makeAiSeat(def) {
  return {
    id: def.id,
    team: def.team,
    role: def.role,
    playerId: null,
    nickname: TEAM_LABEL[def.team] + ' AI' + ROLE_LABEL[def.role],
    ai: true,
    takeover: false
  };
}

function assignSeats(playerIds) {
  const list = Array.isArray(playerIds) ? playerIds : [];
  return SEATS.map(function (def, index) {
    const playerId = list[index] || null;
    if (!playerId) return makeAiSeat(def);
    return {
      id: def.id,
      team: def.team,
      role: def.role,
      playerId: playerId,
      nickname: String(playerId),
      ai: false,
      takeover: false
    };
  });
}

function seatIndexById(seats, id) {
  if (!id) return null;
  for (let i = 0; i < (seats || []).length; i += 1) {
    if (seats[i].id === id) return i;
  }
  return null;
}

// 'red-captain' in the clue phase, 'red-operative' in the guess phase.
function currentSeatId(state) {
  if (!state || state.phase === 'over') return null;
  return state.turn + '-' + (state.phase === 'clue' ? 'captain' : 'operative');
}

function actingSeat(match, seats) {
  return seatIndexById(seats, currentSeatId(match && match.state));
}

function isAiControlled(seat) {
  return !!(seat && (seat.ai || seat.takeover));
}

function createMatch(options) {
  const seed = options && options.seed != null ? options.seed : Date.now();
  return { state: E.createGame({ mode: 'auto', seed: seed }), seed: seed, startedAt: Date.now() };
}

function legalActions(match, seatIndex, seats) {
  const state = match && match.state;
  const seat = seats && seats[seatIndex];
  if (!state || state.phase === 'over' || !seat) return [];
  if (currentSeatId(state) !== seat.id) return [];
  if (state.phase === 'clue' && seat.role === 'captain') return [{ type: 'clue' }];
  if (state.phase === 'guess' && seat.role === 'operative') {
    const out = [];
    state.words.forEach(function (word, index) {
      if (!word.revealed) out.push({ type: 'guess', index: index });
    });
    if (state.guessesMade >= 1) out.push({ type: 'pass' });
    return out;
  }
  return [];
}

function applyAction(match, seatIndex, seats, action) {
  const state = match && match.state;
  if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
  if (state.phase === 'over') return { ok: false, error: '对局已结束', code: 'E_STATE' };
  const seat = seats && seats[seatIndex];
  if (!seat) return { ok: false, error: 'not seated', code: 'E_SEAT' };
  if (currentSeatId(state) !== seat.id) {
    return { ok: false, error: '还没轮到你', code: 'E_TURN' };
  }
  const input = action || {};
  const type = String(input.type || '').trim().toLowerCase();
  let engineAction = null;
  if (type === 'clue') {
    if (seat.role !== 'captain') return { ok: false, error: '只有队长可以给线索', code: 'E_ROLE' };
    engineAction = { type: 'clue', text: input.text, count: input.count == null ? input.number : input.count };
  } else if (type === 'guess') {
    if (seat.role !== 'operative') return { ok: false, error: '只有队员可以猜词', code: 'E_ROLE' };
    engineAction = { type: 'guess', index: input.index };
  } else if (type === 'pass') {
    if (seat.role !== 'operative') return { ok: false, error: '只有队员可以结束猜词', code: 'E_ROLE' };
    engineAction = { type: 'pass' };
  } else {
    return { ok: false, error: 'unknown action', code: 'E_ACTION' };
  }
  const result = E.applyAction(state, engineAction);
  if (!result.ok) return { ok: false, error: result.error || 'action rejected', code: 'E_ACTION' };
  return { ok: true, events: result.events || [], over: state.phase === 'over' };
}

function aiAction(match, seatIndex, seats) {
  const state = match && match.state;
  if (!state || state.phase === 'over') return null;
  if (actingSeat(match, seats) !== seatIndex) return null;
  return E.aiAction(state);
}

function isOver(match) {
  return !!(match && match.state && match.state.phase === 'over');
}

// Durable Object storage cannot structured-clone the engine's rng closure.
// saveState() drops it via a JSON round-trip; this restores a deterministic
// generator from the seed before any AI decision runs.
function hydrate(match) {
  if (!match || !match.state) return match;
  if (typeof match.state.rng !== 'function') {
    const seed = (Number(match.state.seed) >>> 0) ^
      (((Number(match.state.turnNo) || 0) * 2654435761) >>> 0) ^
      (((Number(match.state.guessesMade) || 0) * 2246822519) >>> 0);
    match.state.rng = E.mulberry32(seed >>> 0);
  }
  return match;
}

function result(match, seats, roomMeta) {
  const state = match && match.state;
  if (!state) {
    return { winner: null, winnerName: null, scores: { red: 0, blue: 0 }, turns: 0 };
  }
  return {
    winner: state.winner,
    winnerName: state.winner ? TEAM_LABEL[state.winner] : null,
    scores: { red: state.scores.red, blue: state.scores.blue },
    turns: state.turnNo,
    finishedAt: new Date().toISOString(),
    durationMs: roomMeta && roomMeta.startedAt ? Date.now() - roomMeta.startedAt : 0
  };
}

function publicAction(action) {
  const input = action || {};
  const type = String(input.type || 'move').toLowerCase();
  if (type === 'clue') return { type: 'clue', count: input.count, text: input.text };
  if (type === 'guess') return { type: 'guess', index: input.index };
  return { type: type };
}

// Per-viewer payload. `meta` carries room-level flags and the last AI events.
function view(match, seatIndex, seats, meta) {
  const state = match && match.state;
  if (!state) return null;
  const info = meta || {};
  const seat = seats && seats[seatIndex] || null;
  const reveal = !seat || seat.role === 'captain' || state.phase === 'over';
  const gameView = E.viewFor(state, reveal);
  const currentId = currentSeatId(state);
  const currentIndex = seatIndexById(seats, currentId);
  const currentSeat = currentIndex == null ? null : seats[currentIndex];
  const currentIsAI = currentSeat ? isAiControlled(currentSeat) : false;
  const now = Date.now();
  const publicSeats = (seats || []).map(function (s) {
    const controlled = isAiControlled(s);
    return {
      id: s.id,
      team: s.team,
      role: s.role,
      label: roleLabel(s),
      playerId: s.playerId,
      nickname: s.nickname,
      ai: !!s.ai,
      takeover: !!s.takeover,
      controlledByAI: controlled,
      current: currentId === s.id
    };
  });
  return {
    seats: publicSeats,
    players: publicSeats.map(function (s) {
      return {
        id: s.playerId || s.id,
        seat: s.id,
        nickname: s.nickname,
        team: s.team,
        role: s.role,
        ai: s.ai,
        takeover: s.takeover
      };
    }),
    you: seat ? {
      playerId: seat.playerId,
      seat: seat.id,
      team: seat.team,
      role: seat.role,
      label: roleLabel(seat)
    } : null,
    currentSeat: currentId,
    currentSeatLabel: currentSeat ? roleLabel(currentSeat) : null,
    currentPlayerId: currentSeat && !currentIsAI ? currentSeat.playerId : null,
    currentSeatIsAI: currentIsAI,
    takeoverSeats: publicSeats.filter(function (s) { return s.takeover; }).map(function (s) { return s.id; }),
    aiSeats: publicSeats.filter(function (s) { return s.ai; }).map(function (s) { return s.id; }),
    turn: state.turn,
    phase: state.phase,
    turnNo: state.turnNo,
    clue: gameView.clue,
    guessesLeft: gameView.guessesLeft,
    guessesMade: gameView.guessesMade,
    scores: gameView.scores,
    remaining: gameView.remaining,
    target: gameView.target,
    winner: gameView.winner,
    keyVisible: gameView.keyVisible,
    words: gameView.words,
    log: gameView.log,
    canClue: !!(seat && currentId === seat.id && seat.role === 'captain' &&
      state.phase === 'clue' && !isAiControlled(seat)),
    canGuess: !!(seat && currentId === seat.id && seat.role === 'operative' &&
      state.phase === 'guess' && !isAiControlled(seat)),
    canPass: !!(seat && currentId === seat.id && seat.role === 'operative' &&
      state.phase === 'guess' && state.guessesMade >= 1 && !isAiControlled(seat)),
    suggestedClue: reveal && state.phase === 'clue' ? E.aiClue(state) : null,
    lastEvents: info.events || [],
    result: info.result || null,
    now: now
  };
}

const adapter = {
  slug: SLUG,
  game: GAME,
  title: '行动代号 · 联机',
  minPlayers: 4,
  maxPlayers: 4,
  defaultPlayers: 4,
  aiNames: AI_NICKNAMES,
  seats: SEATS,
  assignSeats: assignSeats,
  seatCount: function () { return 4; },
  createMatch: createMatch,
  view: view,
  legalActions: legalActions,
  applyAction: applyAction,
  aiAction: aiAction,
  actingSeat: actingSeat,
  isOver: isOver,
  hydrate: hydrate,
  result: result,
  restart: function () { return createMatch({ seed: (Date.now() ^ 0x9e3779b9) >>> 0 }); },
  hiddenKeys: ['tags', 'rng', 'seed'],
  publicAction: publicAction
};

module.exports = {
  adapter: adapter,
  SEATS: SEATS,
  assignSeats: assignSeats,
  currentSeatId: currentSeatId,
  roleLabel: roleLabel
};
