#!/usr/bin/env node
/*
 * Banqi premium — online room server (2 players, empty seat AI-filled).
 *
 * Room / invite / password / reconnect / timeout takeover / leaderboard /
 * rematch plumbing lives in games/shared/online-room-server.mjs. This adapter
 * only maps Banqi seats onto the red/black sides and keeps hidden identities
 * on the server.
 *
 *   node games/boardgame/banqi-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'banqi-premium';
const AI_NAMES = ['红方 · 云弈', '黑方 · 墨守'];
const SIDE_FOR_SEAT = [E.RED, E.BLACK];

function seatSide(seatIndex) { return SIDE_FOR_SEAT[seatIndex] || E.RED; }
function sideSeat(side) { return side === E.RED ? 0 : 1; }

export const adapter = {
  slug: SLUG,
  title: '暗棋 · 翻棋',
  minPlayers: 2,
  maxPlayers: 2,
  defaultPlayers: 2,
  aiNames: AI_NAMES,

  seatCount() { return 2; },

  createMatch({ seed, seats }) {
    const list = (seats || []).slice(0, 2);
    const names = list.map(function (seat, i) {
      return (seat && seat.name) || (SIDE_FOR_SEAT[i] === E.RED ? '红方' : '黑方');
    });
    while (names.length < 2) names.push(AI_NAMES[names.length] || ('玩家 ' + (names.length + 1)));
    const state = E.createGame({ seed: seed, names: names });
    const ai = list.map(function (seat) { return Boolean(seat && seat.ai); });
    while (ai.length < 2) ai.push(true);
    return { state: state, seats: list, ai: ai, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const viewer = seatSide(seatIndex == null ? 0 : seatIndex);
    const view = E.publicView(match.state, viewer);
    view.turnSeat = match.state.phase === 'playing' ? sideSeat(match.state.turn) : null;
    view.turnName = view.turnSeat == null ? null : (match.state.players[sideSeat(match.state.turn)].name);
    view.players = view.players.map(function (player, i) {
      return Object.assign({}, player, {
        seat: i,
        side: SIDE_FOR_SEAT[i],
        ai: Boolean(match.ai && match.ai[i])
      });
    });
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase !== 'playing') return [];
    return E.legalActionsForSeat(state, seatSide(seatIndex));
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.phase !== 'playing') return { ok: false, error: 'game is over', code: 'E_STATE' };
    if (state.turn !== seatSide(seatIndex)) return { ok: false, error: 'not your turn', code: 'E_TURN' };
    const result = E.applyAction(state, action);
    if (!result.ok) return { ok: false, error: result.error, code: result.code || 'E_MOVE' };
    return { ok: true, over: state.phase === 'over' };
  },

  aiAction(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase !== 'playing') return null;
    if (state.turn !== seatSide(seatIndex)) return null;
    return E.aiAction(state, 2, function () { return E.nextRandom(state); });
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const winnerSide = state.winner;
    const winnerSeat = winnerSide === 0 ? null : sideSeat(winnerSide);
    return {
      winnerSeat: winnerSeat,
      winnerSeats: winnerSeat == null ? [] : [winnerSeat],
      winnerName: winnerSeat == null ? null : state.players[winnerSeat].name,
      tied: winnerSeat == null,
      scores: state.players.map(function (player) { return E.count(state, player.side); }),
      details: state.players.map(function (player, i) {
        return { seat: i, side: player.side, pieces: E.count(state, player.side), captured: 16 - E.count(state, player.side) };
      }),
      rounds: null,
      turns: state.plies,
      flips: state.flips,
      captures: state.captures,
      reason: state.reason
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x85ebca6b) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: (seat && seat.name) || AI_NAMES[i] || ('玩家 ' + (i + 1)), ai: Boolean(seat && seat.ai) };
      })
    });
  }
};

export function createBanqiServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startBanqiServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startBanqiServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[banqi-online] http://' + addr.address + ':' + addr.port + '/boardgame/banqi-premium/online.html');
    console.log('[banqi-online] http://' + addr.address + ':' + addr.port + '/boardgame/banqi-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
