#!/usr/bin/env node
/*
 * Dou Dizhu premium — online room server (3 seats, empty seats AI-filled).
 *
 * Room / invite / password / reconnect / timeout takeover / leaderboard /
 * rematch plumbing lives in games/shared/online-room-server.mjs. This adapter
 * only maps three Doudizhu seats onto the engine and keeps every hidden hand
 * and the bottom identity inside the authoritative state.
 *
 *   node games/boardgame/doudizhu-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'doudizhu-premium';
const AI_NAMES = ['AI 右', 'AI 左', 'AI 丙'];
const SEATS = 3;

export const adapter = {
  slug: SLUG,
  title: '斗地主 · 叫分抢地主',
  minPlayers: 1,
  maxPlayers: 3,
  defaultPlayers: 3,
  aiNames: AI_NAMES,

  seatCount() { return SEATS; },

  createMatch({ seed, seats }) {
    const list = (seats || []).slice(0, SEATS);
    const names = [];
    for (let i = 0; i < SEATS; i += 1) {
      names.push((list[i] && list[i].name) || (i === 0 ? '玩家 1' : AI_NAMES[i] || ('玩家 ' + (i + 1))));
    }
    const human = [];
    for (let i = 0; i < SEATS; i += 1) human.push(Boolean(list[i] && !list[i].ai));
    const state = E.createGame({ seed: seed, names: names, human: human });
    return { state: state, seats: list, ai: list.map((seat) => Boolean(seat && seat.ai)), seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const viewer = seatIndex == null ? -1 : seatIndex;
    const view = E.publicView(match.state, viewer);
    view.turnSeat = E.currentSeat(match.state);
    view.turnName = view.turnSeat == null || view.turnSeat < 0 ? null : match.state.players[view.turnSeat].name;
    view.players = view.seats.map(function (seat, i) {
      return Object.assign({}, seat, {
        ai: Boolean(match.ai && match.ai[i]),
        seat: i
      });
    });
    return view;
  },

  legalActions(match, seatIndex) {
    return E.legalActions(match.state, seatIndex);
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.phase === 'over') return { ok: false, error: 'game is over', code: 'E_STATE' };
    if (E.currentSeat(state) !== seatIndex) return { ok: false, error: 'not your turn', code: 'E_TURN' };
    const result = E.applyAction(state, action, seatIndex);
    if (!result.ok) return { ok: false, error: result.error, code: result.code || 'E_ACTION' };
    return { ok: true, over: state.phase === 'over' };
  },

  aiAction(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase === 'over') return null;
    if (E.currentSeat(state) !== seatIndex) return null;
    return E.aiChoose(state, seatIndex, 2, function () { return E.nextRandom(state); });
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const score = E.scoreOf(state);
    const landlordWon = state.winnerSide === 'landlord';
    const winnerSeats = landlordWon
      ? [state.landlord]
      : [0, 1, 2].filter(function (i) { return i !== state.landlord; });
    return {
      winnerSeat: state.winner,
      winnerSeats: winnerSeats,
      winnerName: state.winner >= 0 ? state.players[state.winner].name : null,
      tied: false,
      scores: score.deltas || [0, 0, 0],
      rounds: null,
      turns: state.turns,
      bid: state.bid,
      bombs: state.bombsPlayed,
      multiplier: state.multiplier,
      points: score.points,
      winnerSide: state.winnerSide,
      landlord: state.landlord,
      details: state.players.map(function (p, i) {
        return {
          seat: i,
          name: p.name,
          role: i === state.landlord ? 'landlord' : 'farmer',
          bid: state.bid,
          delta: score.deltas ? score.deltas[i] : 0,
          handCount: state.hands[i].length
        };
      }),
      reason: state.reason
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x9e3779b9) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return {
          name: (seat && seat.name) || (i === 0 ? '玩家 1' : AI_NAMES[i] || ('玩家 ' + (i + 1))),
          ai: Boolean(seat && seat.ai)
        };
      })
    });
  }
};

export function createDoudizhuServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startDoudizhuServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startDoudizhuServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[doudizhu-online] http://' + addr.address + ':' + addr.port + '/boardgame/doudizhu-premium/online.html');
    console.log('[doudizhu-online] http://' + addr.address + ':' + addr.port + '/boardgame/doudizhu-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
