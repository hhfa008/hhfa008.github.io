#!/usr/bin/env node
/*
 * Chess premium — online room server adapter.
 *
 * Room, invite, password, reconnect, AI fill, timeout takeover, leaderboard and
 * rematch plumbing all live in games/shared/online-room-server.mjs. This file
 * only adapts the FIDE engine:
 *   createMatch / view / legalActions / applyAction / aiAction / isOver /
 *   result / restart
 *
 * Chess is perfect information: both clients receive the same public board,
 * legal moves, captured trays and SAN history. The only viewer-specific data
 * is which seat / colour the viewer controls.
 *
 *   node games/boardgame/chess-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'chess-premium';
const AI_NAMES = ['房主', 'AI · 胡桃棋手'];

function seatColor(match, seatIndex) {
  return seatIndex === match.whiteSeat ? 'w' : 'b';
}
function seatOfColor(match, color) {
  return color === 'w' ? match.whiteSeat : 1 - match.whiteSeat;
}
function winnerSeat(match) {
  const status = match.game.status;
  if (!status || status.result !== 'checkmate' || !status.winner) return null;
  return seatOfColor(match, status.winner);
}
function updateOver(match) {
  match.over = !!(match.game && match.game.status && match.game.status.over);
  match.winnerSeat = match.over ? winnerSeat(match) : null;
}

export const adapter = {
  slug: SLUG,
  title: '国际象棋 · Chess Premium',
  minPlayers: 2,
  maxPlayers: 2,
  defaultPlayers: 2,
  aiNames: AI_NAMES,

  seatCount() { return 2; },

  createMatch({ seed, seats, swap }) {
    const whiteSeat = swap ? 1 : 0;
    const game = E.newGame();
    const list = (seats || []).slice(0, 2).map(function (seat, i) {
      return {
        name: (seat && seat.name) || AI_NAMES[i] || ('玩家 ' + (i + 1)),
        ai: Boolean(seat && seat.ai)
      };
    });
    while (list.length < 2) list.push({ name: AI_NAMES[list.length], ai: true });
    return {
      game: game,
      seats: list,
      whiteSeat: whiteSeat,
      seed: seed,
      over: false,
      winnerSeat: null,
      startedAt: Date.now(),
      turn: 0
    };
  },

  view(match, seatIndex) {
    const viewer = seatIndex == null ? -1 : seatIndex;
    const view = E.publicView(match.game, viewer);
    const status = match.game.status;
    view.game = 'chess';
    view.you = viewer;
    view.yourColor = viewer >= 0 ? seatColor(match, viewer) : null;
    view.whiteSeat = match.whiteSeat;
    view.seatColors = [seatColor(match, 0), seatColor(match, 1)];
    view.over = match.over;
    view.resultType = status.result;
    view.winnerColor = status.winner || null;
    view.winnerSeat = match.winnerSeat;
    view.moveCount = match.game.sanList.length;
    view.captured = { w: match.game.captured.w.slice(), b: match.game.captured.b.slice() };
    view.history = match.game.sanList.slice();
    view.seats = match.seats.map(function (seat, i) {
      return {
        index: i,
        name: seat.name,
        ai: seat.ai,
        color: seatColor(match, i),
        you: i === viewer
      };
    });
    return view;
  },

  legalActions(match, seatIndex) {
    if (!match || !match.game || match.over) return [];
    if (seatIndex == null || seatColor(match, seatIndex) !== match.game.pos.turn) return [];
    return E.legalMoves(match.game.pos).map(function (m) {
      const action = { type: 'move', from: m.from, to: m.to };
      if (m.promo) action.promotion = m.promo.toLowerCase();
      return action;
    });
  },

  applyAction(match, seatIndex, action) {
    if (!match || !match.game) return { ok: false, error: 'match has no game', code: 'E_STATE' };
    if (match.over) return { ok: false, error: 'game is over', code: 'E_STATE' };
    if (!action || action.type !== 'move') return { ok: false, error: 'unknown action', code: 'E_MOVE' };
    if (seatColor(match, seatIndex) !== match.game.pos.turn) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const from = Number(action.from);
    const to = Number(action.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) {
      return { ok: false, error: 'from/to must be square indices 0..63', code: 'E_MOVE' };
    }
    const promo = action.promotion ? String(action.promotion).toUpperCase() : '';
    if (promo && 'QRBN'.indexOf(promo) < 0) return { ok: false, error: 'promotion must be q/r/b/n', code: 'E_MOVE' };
    const legal = E.legalMoves(match.game.pos);
    let chosen = null;
    for (const m of legal) {
      if (m.from === from && m.to === to && (promo ? m.promo === promo : m.promo === '')) { chosen = m; break; }
    }
    if (!chosen) return { ok: false, error: 'illegal move', code: 'E_MOVE' };
    const applied = E.applyMove(match.game, chosen);
    if (!applied.ok) return { ok: false, error: applied.error || 'illegal move', code: 'E_MOVE' };
    match.turn += 1;
    updateOver(match);
    return { ok: true, over: match.over, san: applied.san };
  },

  // Pure: returns the action, never mutates the match. The shared room server
  // applies it exactly once. Chess has only one AI seat, so this is bounded.
  aiAction(match, seatIndex) {
    if (!match || !match.game || match.over) return null;
    if (seatColor(match, seatIndex) !== match.game.pos.turn) return null;
    const move = E.aiMove(match.game.pos, { level: 2, timeMs: 140, seed: 11 + match.turn });
    if (!move) return null;
    const action = { type: 'move', from: move.from, to: move.to };
    if (move.promo) action.promotion = move.promo.toLowerCase();
    return action;
  },

  isOver(match) {
    return !!(match && match.over);
  },

  result(match) {
    const status = match.game.status;
    const colors = [seatColor(match, 0), seatColor(match, 1)];
    const names = [match.seats[0] && match.seats[0].name, match.seats[1] && match.seats[1].name];
    const scores = colors.map(function (color, i) {
      if (status.result === 'checkmate') return status.winner === color ? 1 : 0;
      return 0.5;
    });
    return {
      winnerSeat: match.winnerSeat,
      winnerName: match.winnerSeat == null ? null : names[match.winnerSeat],
      tied: match.winnerSeat == null,
      scores: scores,
      rounds: Math.ceil(match.game.sanList.length / 2),
      turns: match.game.sanList.length,
      result: status.result,
      winnerColor: status.winner || null,
      colors: colors,
      moveHistory: match.game.sanList.slice()
    };
  },

  // Shared-server rematch: same two seats, colours swapped.
  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x9e3779b9) >>> 0,
      swap: true,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)), ai: Boolean(seat.ai) };
      })
    });
  }
};

export function createChessServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startChessServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startChessServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[chess-online] http://' + addr.address + ':' + addr.port + '/boardgame/chess-premium/online.html');
    console.log('[chess-online] http://' + addr.address + ':' + addr.port + '/boardgame/chess-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
