#!/usr/bin/env node
/*
 * Reversi Premium — online room server.
 *
 * Thin wrapper around the shared authoritative server
 * (../app/online-game.mjs). Rules stay in engine.js; this file only decides
 * what is public and how seat indices map to black (1) and white (2).
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
const AI_NAMES = ['AI · 黑石', 'AI · 白磐'];

export function publicState(state) {
  return E.publicState(state);
}

export function createServer(options) {
  const opts = options || {};
  return startGameOnlineServer({
    game: 'reversi',
    dir: 'reversi-premium',
    port: opts.port,
    host: opts.host,
    engine: E,
    maxPlayers: 2,
    minHumanPlayers: 1,
    aiNames: AI_NAMES,
    idleTimeoutMs: opts.idleTimeoutMs,
    aiDelayMs: opts.aiDelayMs,
    roomStore: opts.roomStore,
    roomTtlMs: opts.roomTtlMs,
    createState: (seats, seed) => E.createGame({
      seed: seed,
      names: seats.map((s) => s.nickname),
      isAI: seats.map((s) => s.ai),
      aiLevel: 'normal'
    }),
    publicState: publicState,
    currentSeat: (state) => (state.current === E.WHITE ? 1 : 0),
    moveOf: (body) => body.move || body.act || body,
    legalMoves: (state) => E.getLegalMoves(state),
    applyMove: (state, move) => E.applyMove(state, move),
    aiStep: (state) => {
      if (!state || state.over) return state;
      const move = E.chooseAIMove(state, 'normal');
      if (!move) return state;
      return E.applyMove(state, move);
    },
    viewExtras: (rs, state, playerId) => {
      const seat = rs.seats.find((s) => s.playerId === playerId);
      if (!seat) return {};
      return {
        mySeat: seat.index,
        myColor: seat.index === 0 ? 'black' : 'white'
      };
    },
    resultRows: (state) => {
      if (!state || !state.result) return [];
      return [
        { index: 0, name: state.players[0].name, total: state.result.black },
        { index: 1, name: state.players[1].name, total: state.result.white }
      ];
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  createServer({ port: port }).then((handle) => {
    const addr = handle.address;
    console.log('[reversi-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[reversi-online] http://' + addr.address + ':' + addr.port + '/index.html   (棋盘)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
