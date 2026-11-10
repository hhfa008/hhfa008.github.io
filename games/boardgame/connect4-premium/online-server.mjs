#!/usr/bin/env node
/*
 * Connect 4 / 四子棋 premium — online room server adapter.
 *
 * Rooms, invites, passwords, reconnect, AI fill, timeout takeover, leaderboard,
 * idempotency and rematch plumbing all live in
 * games/shared/online-room-server.mjs. This file only adapts the Connect 4
 * engine. Two seats; seat 0 is red unless a rematch swaps first player.
 *
 *   node games/boardgame/connect4-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'connect4-premium';
const AI_NAMES = ['房主', '蓝框对手', '副对角线猎手', '中点守门员', '双威胁工匠', '重力研究员'];

function colorForSeat(match, seat) {
  return seat === match.firstSeat ? E.P1 : E.P2;
}
function seatForColor(match, color) {
  return color === E.P1 ? match.firstSeat : 1 - match.firstSeat;
}
function colorName(color) {
  return color === E.P1 ? 'red' : (color === E.P2 ? 'yellow' : null);
}

export const adapter = {
  slug: SLUG,
  title: '四子棋 Connect 4',
  minPlayers: 2,
  maxPlayers: 2,
  defaultPlayers: 2,
  aiNames: AI_NAMES,

  seatCount() { return 2; },

  createMatch({ seed, seats }) {
    const state = E.setup({ first: E.P1 });
    return {
      state: state,
      seats: seats,
      ai: seats.map(function (seat) { return Boolean(seat.ai); }),
      seed: seed,
      firstSeat: 0,
      startedAt: Date.now()
    };
  },

  view(match, seatIndex) {
    const viewer = seatIndex == null ? -1 : seatIndex;
    const state = match.state;
    const view = E.publicView(state, viewer);
    const st = E.status(state);
    view.you = viewer;
    view.firstSeat = match.firstSeat;
    view.colors = [colorName(colorForSeat(match, 0)), colorName(colorForSeat(match, 1))];
    view.yourColor = viewer < 0 ? null : colorName(colorForSeat(match, viewer));
    view.yourTurn = viewer >= 0 && !st.over && state.turn === colorForSeat(match, viewer);
    view.seats = match.seats.map(function (seat, i) {
      return {
        index: i,
        name: seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)),
        ai: Boolean(match.ai && match.ai[i]),
        color: colorName(colorForSeat(match, i))
      };
    });
    view.status = st.draw ? 'draw' : (st.over ? 'win' : 'playing');
    view.turnColor = colorName(state.turn);
    view.winnerSeat = st.over && !st.draw ? seatForColor(match, st.winner) : null;
    view.winnerColor = st.over ? (st.draw ? 'draw' : colorName(st.winner)) : null;
    return view;
  },

  legalActions(match, seatIndex) {
    if (seatIndex == null) return [];
    const st = E.status(match.state);
    if (st.over) return [];
    if (match.state.turn !== colorForSeat(match, seatIndex)) return [];
    return E.legalMoves(match.state).map(function (col) {
      return { type: 'drop', col: col };
    });
  },

  applyAction(match, seatIndex, action) {
    try {
      if (!action || action.type !== 'drop') {
        return { ok: false, error: 'unknown action', code: 'E_MOVE' };
      }
      const col = Number(action.col);
      if (!Number.isInteger(col)) {
        return { ok: false, error: 'column must be an integer', code: 'E_MOVE' };
      }
      const st = E.status(match.state);
      if (st.over) return { ok: false, error: 'game is over', code: 'E_STATE' };
      const color = colorForSeat(match, seatIndex);
      if (match.state.turn !== color) return { ok: false, error: 'not your turn', code: 'E_TURN' };
      if (!E.isLegal(match.state, col)) {
        return { ok: false, error: 'column ' + col + ' is not legal', code: 'E_COLUMN' };
      }
      const next = E.applyMove(match.state, col);
      if (!next) return { ok: false, error: 'illegal column', code: 'E_COLUMN' };
      match.state = next;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_MOVE' };
    }
  },

  // Pure decision; the shared server applies it exactly once.
  aiAction(match, seatIndex) {
    if (seatIndex == null) return null;
    const st = E.status(match.state);
    if (st.over) return null;
    if (match.state.turn !== colorForSeat(match, seatIndex)) return null;
    const col = E.aiMove(match.state, 3, 350);
    if (col == null) return null;
    return { type: 'drop', col: col };
  },

  isOver(match) {
    return !!(match && match.state && E.status(match.state).over);
  },

  result(match) {
    const st = E.status(match.state);
    const red = E.countOf(match.state.b, E.P1);
    const yellow = E.countOf(match.state.b, E.P2);
    const winnerSeat = st.over && !st.draw ? seatForColor(match, st.winner) : null;
    const scores = match.seats.map(function (_, i) {
      return colorForSeat(match, i) === E.P1 ? red : yellow;
    });
    return {
      winnerSeat: winnerSeat,
      winnerName: winnerSeat == null ? null : (match.seats[winnerSeat].name || AI_NAMES[winnerSeat]),
      tied: Boolean(st.draw || winnerSeat == null),
      draw: Boolean(st.draw),
      winnerColor: st.draw ? 'draw' : colorName(st.winner),
      winningLine: st.line ? st.line.slice() : null,
      scores: scores,
      rounds: 1,
      turns: match.state.plies,
      firstSeat: match.firstSeat,
      colors: [colorName(colorForSeat(match, 0)), colorName(colorForSeat(match, 1))]
    };
  },

  restart(match) {
    const firstSeat = match.firstSeat === 0 ? 1 : 0;
    const seats = (match.seats || []).map(function (seat, i) {
      return {
        name: seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)),
        ai: Boolean(match.ai ? match.ai[i] : seat.ai)
      };
    });
    const next = this.createMatch({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      seats: seats
    });
    next.firstSeat = firstSeat;
    return next;
  }
};

export function createConnect4Server(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startConnect4Server(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startConnect4Server;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[connect4-online] http://' + addr.address + ':' + addr.port + '/boardgame/connect4-premium/online.html');
    console.log('[connect4-online] http://' + addr.address + ':' + addr.port + '/boardgame/connect4-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
