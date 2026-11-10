#!/usr/bin/env node
/*
 * Carcassonne Premium — online room server.
 *
 * Thin wrapper around the shared authoritative server. The engine exposes
 * applyMove/getLegalMoves for the three-step turn (place -> meeple/skip), so
 * both clients share exactly the same rule implementation as the local page.
 *
 *   node online-server.mjs --port 8787
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startGameOnlineServer } from '../app/online-game.mjs';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_NAMES = ['你', 'AI · 领主'];

export function publicState(state) {
  if (!state) return null;
  return {
    seed: state.seed,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    over: !!state.over || state.phase === 'over',
    turn: state.turn,
    currentTile: state.currentTile,
    lastPlaced: state.lastPlaced,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    board: state.board,
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      isAI: p.isAI,
      color: p.color,
      score: p.score,
      meeples: p.meeples
    })),
    events: (state.events || []).slice(-10),
    log: (state.log || []).slice(-50),
    result: state.result
  };
}

export function createServer(options) {
  const opts = options || {};
  return startGameOnlineServer({
    game: 'carcassonne',
    dir: 'carcassonne-premium',
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
      players: seats.map((s) => ({ name: s.nickname, isAI: s.ai }))
    }),
    publicState: publicState,
    currentSeat: (state) => state.currentPlayer,
    startingSeat: (state) => state.currentPlayer,
    moveOf: (body) => body.move || body.act || body,
    legalMoves: (state) => E.getLegalMoves(state),
    applyMove: (state, move) => E.applyMove(state, move),
    aiStep: (state) => {
      const next = JSON.parse(JSON.stringify(state));
      if (next.phase !== 'over') E.runAITurn(next);
      return next;
    },
    viewExtras: (rs, state, playerId) => {
      const seat = rs.seats.find((s) => s.playerId === playerId);
      return seat ? { mySeat: seat.index } : {};
    },
    resultRows: (state) => {
      const result = state.result;
      if (!result) return [];
      return result.scores.map((total, i) => ({ index: i, name: state.players[i].name, total: total }));
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  createServer({ port: port }).then((handle) => {
    const addr = handle.address;
    console.log('[carcassonne-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[carcassonne-online] http://' + addr.address + ':' + addr.port + '/index.html   (牌桌)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
