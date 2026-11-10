#!/usr/bin/env node
/*
 * 6 Nimmt! / 谁是牛头王 premium — online room server adapter.
 *
 * Room, invite, password, reconnect, AI fill, timeout takeover, leaderboard and
 * rematch plumbing all live in games/shared/online-room-server.mjs. This file
 * only adapts the 6 Nimmt engine:
 *   createMatch / view / legalActions / applyAction / aiAction / isOver /
 *   result / restart
 *
 * Simultaneous picks: every human submits { type: 'pick', card }. The view
 * exposes only whether opponents have committed a card (picked: true), never
 * which card. AI seats are filled server-side. Row choices use
 * { type: 'row', row: 0..3 } and are only legal for the pending player.
 *
 *   node games/boardgame/six-nimmt-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'six-nimmt-premium';
const AI_NAMES = ['房主', '牛头猎手', '接龙赌徒', '黄铜守望者', '牧场主', '夜行牛仔', '绿呢术士', '计数员', '红丝绒客', '最后的牛仔'];

function scores(match) {
  const state = match.state;
  return state.players.map(function (_, i) { return E.score(state, i); });
}

export const adapter = {
  slug: SLUG,
  title: '6 Nimmt! 谁是牛头王',
  minPlayers: 2,
  maxPlayers: 10,
  defaultPlayers: 3,
  aiNames: AI_NAMES,

  // Single human fills to 3; two humans keep a 3-seat table (one AI). Three or
  // more humans play at the table size they brought, up to 10.
  seatCount({ humans }) {
    return Math.max(3, Math.min(10, Math.max(3, humans)));
  },

  createMatch({ seed, seats }) {
    const state = E.createGame({
      seed: seed,
      players: seats.length,
      names: seats.map(function (seat, i) { return seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)); })
    });
    const ai = seats.map(function (seat) { return Boolean(seat.ai); });
    return { state: state, seats: seats, ai: ai, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const viewer = seatIndex == null ? -1 : seatIndex;
    const view = E.publicView(match.state, viewer);
    view.you = viewer;
    view.pickPhase = match.state.phase === 'pick';
    view.pendingSeat = match.state.pending ? match.state.pending.player : null;
    view.players = view.players.map(function (player, i) {
      return Object.assign({}, player, { ai: Boolean(match.ai && match.ai[i]) });
    });
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match.state;
    if (!state || seatIndex == null || state.phase === 'over') return [];
    if (state.phase === 'pick') {
      if (state.picks[seatIndex] != null) return [];
      return state.players[seatIndex].hand.slice().sort(function (a, b) { return a - b; })
        .map(function (card) { return { type: 'pick', card: card }; });
    }
    if (state.phase === 'chooseRow' && state.pending && state.pending.player === seatIndex) {
      return state.rows.map(function (row, i) {
        return { type: 'row', row: i, points: E.rowPoints(row), cards: row.slice() };
      });
    }
    return [];
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    try {
      if (!action || (action.type !== 'pick' && action.type !== 'row')) {
        return { ok: false, error: 'unknown action', code: 'E_MOVE' };
      }
      if (state.phase === 'over') return { ok: false, error: 'game is over', code: 'E_STATE' };
      if (action.type === 'pick') {
        if (state.phase !== 'pick') return { ok: false, error: 'round is resolving', code: 'E_STATE' };
        if (state.picks[seatIndex] != null) return { ok: false, error: 'card already committed', code: 'E_PICK' };
        E.pickCard(state, seatIndex, Number(action.card));
        return { ok: true };
      }
      if (state.phase !== 'chooseRow') return { ok: false, error: 'no row choice pending', code: 'E_STATE' };
      if (!state.pending || state.pending.player !== seatIndex) {
        return { ok: false, error: 'not your row choice', code: 'E_TURN' };
      }
      E.chooseRow(state, seatIndex, Number(action.row));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_MOVE' };
    }
  },

  // Pure decision: returns the action, never mutates the match. The shared
  // room server applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase === 'over') return null;
    return E.aiDecision(state, seatIndex);
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const list = scores(match);
    const winnerSeats = state.winnerIds && state.winnerIds.length
      ? state.winnerIds.slice()
      : (state.winner == null ? [] : [state.winner]);
    return {
      winnerSeat: winnerSeats.length === 1 ? winnerSeats[0] : null,
      winnerSeats: winnerSeats,
      winnerName: winnerSeats.length === 1 ? state.players[winnerSeats[0]].name : null,
      tied: winnerSeats.length !== 1,
      scores: list,
      winners: winnerSeats.map(function (seat) {
        return { seat: seat, name: state.players[seat].name, score: list[seat] };
      }),
      losers: list.map(function (score, i) { return { seat: i, name: state.players[i].name, score: score }; }),
      rounds: state.round,
      turns: state.turnCount,
      unused: (state.unused || []).slice()
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)), ai: Boolean(seat.ai) };
      })
    });
  }
};

export function createSixNimmtServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startSixNimmtServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startSixNimmtServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[six-nimmt-online] http://' + addr.address + ':' + addr.port + '/boardgame/six-nimmt-premium/online.html');
    console.log('[six-nimmt-online] http://' + addr.address + ':' + addr.port + '/boardgame/six-nimmt-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
