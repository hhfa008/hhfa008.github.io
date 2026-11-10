#!/usr/bin/env node
/*
 * Gomoku Premium — online room server.
 *
 * Thin wrapper around the shared authoritative server. The engine owns the
 * rules and AI; this file only decides what is public (board, turn, result)
 * and maps engine colors (BLACK/WHITE) to seat indexes (0/1).
 *
 *   node online-server.mjs --port 8787
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startGameOnlineServer } from '../app/online-game.mjs';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const AI_NAMES = ['你', 'AI · 棋士'];

export function publicState(state) {
  if (!state) return null;
  return {
    version: state.version,
    size: state.size,
    board: state.board.slice(),
    current: state.current,
    over: !!state.over,
    winner: state.winner,
    winLine: state.winLine ? state.winLine.slice() : null,
    lastMove: state.lastMove ? { row: state.lastMove.row, col: state.lastMove.col, player: state.lastMove.player } : null,
    moveCount: state.moveCount,
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      isAI: !!p.isAI,
      color: p.color
    })),
    aiLevel: state.aiLevel,
    history: (state.history || []).slice(-12).map((h) => ({ row: h.row, col: h.col, player: h.player })),
    events: (state.events || []).slice(-8),
    // history is trimmed above; local undo is disabled in online mode.
    result: state.result
  };
}

function seatOfColor(color) { return color === E.BLACK ? 0 : 1; }

export function createServer(options) {
  const opts = options || {};
  return startGameOnlineServer({
    game: 'gomoku',
    dir: 'gomoku-premium',
    port: opts.port,
    host: opts.host,
    engine: E,
    maxPlayers: 2,
    minHumanPlayers: 1,
    aiNames: AI_NAMES,
    idleTimeoutMs: opts.idleTimeoutMs,
    aiDelayMs: opts.aiDelayMs,
    roomStore: opts.roomStore,
    createState: (seats, seed) => E.createGame({
      seed: seed,
      names: seats.map((s) => s.nickname),
      isAI: seats.map((s) => s.ai),
      aiLevel: 'normal'
    }),
    publicState: publicState,
    currentSeat: (state) => seatOfColor(state.current),
    // The shared server writes this value into state.current, so it must be
    // the engine's colour token (BLACK = 1), not the seat index (0).
    startingSeat: () => E.BLACK,
    moveOf: (body) => body.move || body.act || body,
    legalMoves: (state) => E.getLegalMoves(state),
    applyMove: (state, move) => E.applyMove(state, move),
    aiStep: (state) => {
      const move = E.chooseAIMove(state, 'normal');
      if (!move) return Object.assign({}, state, { over: true });
      return E.applyMove(state, move);
    },
    viewExtras: (rs, state, playerId) => {
      const seat = rs.seats.find((s) => s.playerId === playerId);
      return seat ? { mySeat: seat.index, myColor: seat.index === 0 ? E.BLACK : E.WHITE } : {};
    },
    resultRows: (state) => {
      if (!state.result) return [];
      const winner = state.result.winner;
      return state.players.map((p, i) => ({
        index: i,
        name: p.name,
        total: winner === 0 ? 0 : (winner === p.color ? 1 : 0)
      }));
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  createServer({ port: port }).then((handle) => {
    const addr = handle.address;
    console.log('[gomoku-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[gomoku-online] http://' + addr.address + ':' + addr.port + '/index.html   (棋盘)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
