#!/usr/bin/env node
/*
 * Pioneers premium — online room server (2–4 seats, empty seats AI-filled).
 *
 * Room / invite / password / reconnect / timeout takeover / leaderboard /
 * rematch plumbing lives in games/shared/online-room-server.mjs. This adapter
 * maps seats onto engine players and keeps the dice stream on the server: a
 * client action is only { k: 'roll' }, and engine.roll() draws both dice from
 * state.rngState. publicView() never exposes rngState, so future rolls cannot
 * be predicted from the wire.
 *
 *   node games/boardgame/pioneers-premium/online-server.mjs --port 8788
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'pioneers-premium';
const AI_NAMES = ['赤帆 · 云策', '蓝港 · 潮生', '青禾 · 野望', '金穗 · 远航'];

function clampSeats(n) { return Math.max(2, Math.min(4, Number(n) || 2)); }

export const adapter = {
  slug: SLUG,
  title: '拓荒者 · 九岛',
  minPlayers: 2,
  maxPlayers: 4,
  defaultPlayers: 2,
  aiNames: AI_NAMES,

  seatCount(arg) {
    const humans = arg && typeof arg.humans === 'number' ? arg.humans : 1;
    return clampSeats(Math.max(2, humans));
  },

  createMatch({ seed, seats }) {
    const list = (seats || []).slice(0, 4);
    const count = clampSeats(list.length || 2);
    const names = list.map(function (seat, i) {
      return (seat && seat.name) || AI_NAMES[i] || ('拓荒者 ' + (i + 1));
    });
    while (names.length < count) names.push(AI_NAMES[names.length] || ('AI · 座位 ' + (names.length + 1)));
    const state = E.createGame({ players: count, humans: 0, seed: seed, names: names });
    state.players.forEach(function (p, i) {
      p.ai = list[i] ? Boolean(list[i].ai) : true;
    });
    return { state: state, seats: list, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const state = match.state;
    const viewer = seatIndex == null ? state.current : seatIndex;
    const view = E.publicView(state, viewer);
    view.turnSeat = state.phase === 'over' ? null : state.current;
    view.turnName = state.phase === 'over' ? null : state.players[state.current].name;
    view.players = view.players.map(function (player, i) {
      return Object.assign({}, player, {
        seat: i,
        ai: Boolean(state.players[i] && state.players[i].ai)
      });
    });
    view.setup = Object.assign({}, view.setup, {
      snake: state.setup.order.slice(),
      currentSeat: state.phase === 'setup' ? state.current : null
    });
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase === 'over') return [];
    if (state.current !== seatIndex) return [];
    return E.legalActions(state);
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.phase === 'over') return { ok: false, error: 'game is over', code: 'E_STATE' };
    if (state.current !== seatIndex) return { ok: false, error: 'not your turn', code: 'E_TURN' };
    if (!action || typeof action !== 'object') return { ok: false, error: 'invalid action', code: 'E_MOVE' };
    const result = E.applyAction(state, action);
    if (!result.ok) return { ok: false, error: result.error, code: result.code || 'E_MOVE' };
    return { ok: true, over: state.phase === 'over' };
  },

  aiAction(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase === 'over') return null;
    if (state.current !== seatIndex) return null;
    if (!state.players[seatIndex] || !state.players[seatIndex].ai) return null;
    return E.aiAction(state, 2);
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const winnerSeat = state.winner == null ? null : state.winner;
    return {
      winnerSeat: winnerSeat,
      winnerSeats: state.winners.slice(),
      winnerName: winnerSeat == null ? null : state.players[winnerSeat].name,
      tied: winnerSeat == null,
      scores: state.players.map(function (p) { return p.score; }),
      details: state.players.map(function (p, i) {
        return {
          seat: i, name: p.name, ai: p.ai, score: p.score,
          settlements: p.settlements.length, cities: p.cities.length, roads: p.roads.length,
          resources: E.cloneResources(p.resources), portEdges: p.portEdges.length
        };
      }),
      rounds: Math.min(state.round, state.maxRounds),
      roundsPlayed: state.round,
      turns: state.round * state.players.length + state.current,
      reason: state.result,
      playerCount: state.players.length
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x85ebca6b) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: (seat && seat.name) || AI_NAMES[i] || ('拓荒者 ' + (i + 1)), ai: Boolean(seat && seat.ai) };
      })
    });
  }
};

export function createPioneersServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startPioneersServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startPioneersServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8788;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[pioneers-online] http://' + addr.address + ':' + addr.port + '/boardgame/pioneers-premium/online.html');
    console.log('[pioneers-online] http://' + addr.address + ':' + addr.port + '/boardgame/pioneers-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
