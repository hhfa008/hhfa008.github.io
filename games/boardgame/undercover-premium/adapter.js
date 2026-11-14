/*
 * Undercover premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and any Worker backend
 * that loads the same module. Only maps Undercover seats onto engine.js; no
 * room state machine and no rule lives here.
 *
 * Hidden information: a viewer only receives its own role/word. Every other
 * seat is public status only (alive / revealed / votes / AI) until the match
 * is over. The word pair and the seed never leave the adapter.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'undercover-premium';
const AI_NAMES = ['AI · 播音员', 'AI · 侦探', 'AI · 演员', 'AI · 记者', 'AI · 教授', 'AI · 主持人'];
const MIN_SEATS = 4;
const MAX_SEATS = 6;

function clampSeats(n) {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number(n) || MIN_SEATS));
}
function seatName(match, index) {
  const seat = match && match.seats && match.seats[index];
  return (seat && (seat.name || seat.nickname)) || AI_NAMES[index] || ('座位 ' + (index + 1));
}
function movePayload(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.move && typeof action.move === 'object') return action.move;
  if (typeof action.type === 'string') return action;
  return null;
}
// The shared room server keeps the raw request action on the room's
// `lastAction`. Rewrite it in place to the public projection so an opponent
// never receives identity words, hand indices or unknown request fields.
function sanitizeInPlace(action, safe) {
  if (!action || typeof action !== 'object') return;
  try {
    Object.keys(action).forEach(function (key) { delete action[key]; });
    Object.assign(action, safe);
  } catch (err) { /* frozen input: view() never emits it */ }
}
function maskLastElim(lastElim, over) {
  if (!lastElim) return null;
  const out = {
    pid: lastElim.pid == null ? null : lastElim.pid,
    tie: !!lastElim.tie,
    round: lastElim.round,
    tally: Array.isArray(lastElim.tally)
      ? lastElim.tally.map(function (row) { return { index: row.index, votes: row.votes }; })
      : []
  };
  // Roles/words are public only after the match has ended.
  if (over) {
    out.role = lastElim.role;
    out.word = lastElim.word;
  }
  return out;
}
function publicHistory(state, over) {
  return (state.history || []).slice(-24).map(function (entry) {
    if (entry.type === 'eliminate') {
      const row = { type: entry.type, round: entry.round, pid: entry.pid, tally: entry.tally };
      if (over) row.role = entry.role;
      return row;
    }
    if (entry.type === 'vote') {
      return { type: entry.type, round: entry.round, from: entry.from, to: entry.to };
    }
    if (entry.type === 'tie') {
      return { type: entry.type, round: entry.round, tally: entry.tally };
    }
    return {
      type: entry.type,
      round: entry.round,
      pid: entry.pid,
      order: entry.order,
      winnerSide: entry.winnerSide,
      players: entry.players,
      undercover: entry.undercover,
      blank: entry.blank,
      category: entry.category
    };
  });
}

function publicState(state, match, seatIndex) {
  if (!state) return null;
  const over = !!state.over;
  const mine = seatIndex == null ? null : seatIndex;
  const votesVisible = state.phase === 'speak' || state.phase === 'over';
  return {
    version: state.version,
    phase: state.phase,
    round: state.round,
    current: state.current,
    over: over,
    winnerSide: state.winnerSide,
    playerCount: state.playerCount,
    revealIndex: state.revealIndex,
    voteOrder: (state.voteOrder || []).slice(),
    votedCount: state.votedCount,
    votes: votesVisible
      ? (state.votes || []).map(function (vote) { return { from: vote.from, to: vote.to, round: vote.round }; })
      : [],
    lastElim: maskLastElim(state.lastElim, over),
    eliminated: (state.eliminated || []).slice(),
    hint: state.hint ? state.pair.cat : null,
    players: state.players.map(function (p) {
      const seat = match && match.seats && match.seats[p.index];
      const own = mine === p.index;
      const row = {
        index: p.index,
        name: (seat && (seat.name || seat.nickname)) || p.name,
        alive: p.alive,
        revealed: p.revealed,
        votes: votesVisible ? p.votes : 0,
        isAI: seat ? Boolean(seat.ai) : Boolean(p.isAI)
      };
      // Own identity card, or every card once the match is over.
      if (over || own) {
        row.role = p.role;
        row.word = p.word;
      }
      return row;
    }),
    result: over ? (state.result || null) : null,
    history: publicHistory(state, over)
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, MAX_SEATS);
  const count = clampSeats(list.length || MIN_SEATS);
  const names = [];
  const isAI = [];
  for (let i = 0; i < count; i += 1) {
    const seat = list[i];
    names.push((seat && (seat.name || seat.nickname)) || AI_NAMES[i] || ('座位 ' + (i + 1)));
    isAI.push(seat ? Boolean(seat.ai) : true);
  }
  const state = E.createGame({
    seed: seed,
    playerCount: count,
    undercoverCount: E.recommendedUndercover(count),
    blankCount: 0,
    names: names,
    isAI: isAI,
    hint: false
  });
  return { state: state, seats: list, seed: seed, startedAt: Date.now() };
}

const adapter = {
  slug: SLUG,
  title: '谁是卧底 · 联机',
  minPlayers: MIN_SEATS,
  maxPlayers: MAX_SEATS,
  defaultPlayers: MAX_SEATS,
  aiNames: AI_NAMES,

  // A full six-player AI table when fewer than four humans joined; from four
  // humans up, the human count is the table size (4, 5 or 6).
  seatCount(options) {
    const humans = Number(options && options.humans) || 0;
    return humans >= MIN_SEATS ? clampSeats(humans) : MAX_SEATS;
  },

  createMatch(options) {
    return buildMatch(options.seed, options.seats);
  },

  view(match, seatIndex) {
    return publicState(match && match.state, match, seatIndex);
  },

  legalActions(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || seatIndex == null) return [];
    if (state.current == null || state.current !== seatIndex) return [];
    return E.getLegalMoves(state).map(function (move) {
      if (move.type === 'vote') return { type: 'vote', target: move.target };
      return { type: move.type };
    });
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.over) return { ok: false, error: 'match is already over', code: 'E_STATE' };
    if (seatIndex == null || state.current !== seatIndex) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const move = movePayload(action);
    if (!move) return { ok: false, error: 'move payload required', code: 'E_ACTION' };
    const payload = { type: move.type };
    if (move.type === 'vote') payload.target = move.target;
    try {
      const next = E.applyMove(state, payload);
      match.state = next;
      sanitizeInPlace(action, adapter.publicAction(payload));
      return { ok: true, over: !!next.over };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal move', code: 'E_ACTION' };
    }
  },

  // Pure decision; the shared room server applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || seatIndex == null) return null;
    if (state.current == null || state.current !== seatIndex) return null;
    try {
      return E.chooseAIMove(state) || null;
    } catch (err) {
      return null;
    }
  },

  actingSeat(match) {
    const state = match && match.state;
    return state && state.current != null ? state.current : null;
  },

  isOver(match) {
    return !!(match && match.state && match.state.over);
  },

  result(match) {
    const state = match && match.state;
    if (!state || !state.over || !state.result) {
      return { winnerSeat: null, winnerName: null, tied: true, scores: [], rounds: 0, turns: 0 };
    }
    const winnerSide = state.result.winnerSide;
    const scores = state.players.map(function (player) {
      if (winnerSide === 'civ') return player.role === 'c' ? 1 : 0;
      return player.role === 'c' ? 0 : 1;
    });
    return {
      winnerSeat: null,
      winnerName: winnerSide === 'civ' ? '平民阵营' : '卧底阵营',
      tied: false,
      reason: winnerSide === 'civ' ? '卧底方全部出局' : '卧底方人数不少于平民',
      scores: scores,
      rounds: state.round,
      turns: (state.eliminated || []).length
    };
  },

  restart(match, seats) {
    const source = Array.isArray(seats) && seats.length ? seats : ((match && match.seats) || []);
    const list = source.map(function (seat, index) {
      return {
        name: (seat && (seat.name || seat.nickname)) || seatName(match, index),
        ai: Boolean(seat && seat.ai)
      };
    });
    return buildMatch((Date.now() ^ 0x85ebca6b) >>> 0, list);
  },

  hiddenKeys: ['hand', 'hands', 'deck', 'seed', 'role', 'roles', 'word', 'words', 'known', 'lastAction'],

  // Spectator log action: phase transitions and vote targets are public;
  // identity words, roles and the raw request body are never copied.
  publicAction(action) {
    const move = movePayload(action);
    if (!move) return { type: 'move' };
    if (move.type === 'vote') return { type: 'vote', target: move.target };
    if (move.type === 'reveal') return { type: 'reveal' };
    if (move.type === 'beginVote') return { type: 'beginVote' };
    return { type: String(move.type || 'move') };
  }
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  buildMatch: buildMatch
};
