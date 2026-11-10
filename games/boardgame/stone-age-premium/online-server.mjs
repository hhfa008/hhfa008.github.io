#!/usr/bin/env node
/*
 * Stone Age Premium — online room server.
 *
 * Thin wrapper around the shared authoritative server. The engine exposes
 * applyMove/getLegalMoves for placement, per-player resolution and feeding;
 * public state hides the civilization deck and the face-down part of each
 * building stack.
 *
 *   node online-server.mjs --port 8787
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startGameOnlineServer } from '../app/online-game.mjs';
import { SOLO_AI_FILL } from '../app/ai-seat.mjs';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_NAMES = ['你', 'AI · 猎手', 'AI · 工匠', 'AI · 祭司'];

export function publicState(state) {
  if (!state) return null;
  return {
    playerCount: state.playerCount,
    round: state.round,
    turn: state.turn,
    startPlayer: state.startPlayer,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    over: !!state.over,
    spots: state.spots,
    villageUsed: state.villageUsed,
    buildingStacks: state.buildingStacks.map((stack) => stack.map((id, i) => (i === stack.length - 1 ? id : null))),
    civSlots: state.civSlots,
    civDeckCount: state.civDeck.length,
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      isAI: p.isAI,
      color: p.color,
      score: p.score,
      totalWorkers: p.totalWorkers,
      workersLeft: p.workersLeft,
      food: p.food,
      agriculture: p.agriculture,
      tools: p.tools.slice(),
      toolsUsed: p.toolsUsed.slice(),
      onceTools: p.onceTools.slice(),
      onceUsed: p.onceUsed.slice(),
      resources: Object.assign({}, p.resources),
      buildings: p.buildings.slice(),
      civCards: p.civCards.slice(),
      resolved: !!p.resolved
    })),
    resolveOrder: state.resolveOrder,
    resolveIndex: state.resolveIndex,
    lastResolve: state.lastResolve,
    lastFeed: state.lastFeed,
    log: state.log.slice(-60),
    events: (state.events || []).slice(-12),
    result: state.result
  };
}

export function createServer(options) {
  const opts = options || {};
  return startGameOnlineServer({
    game: 'stoneage',
    dir: 'stone-age-premium',
    port: opts.port,
    host: opts.host,
    engine: E,
    maxPlayers: 4,
    minHumanPlayers: SOLO_AI_FILL.minHumanPlayers,
    aiNames: AI_NAMES,
    idleTimeoutMs: opts.idleTimeoutMs,
    aiDelayMs: opts.aiDelayMs,
    roomStore: opts.roomStore,
    createState: (seats, seed) => E.createGame({
      seed: seed,
      playerCount: seats.length,
      names: seats.map((s) => s.nickname),
      isAI: seats.map((s) => s.ai)
    }),
    publicState: publicState,
    currentSeat: (state) => state.currentPlayer,
    startingSeat: (state) => state.startPlayer,
    moveOf: (body) => body.move || body.act || body,
    legalMoves: (state) => E.getLegalMoves(state),
    applyMove: (state, move) => E.applyMove(state, move),
    aiStep: (state) => {
      const next = JSON.parse(JSON.stringify(state));
      if (next.over) return next;
      if (next.phase === 'execute') return E.applyMove(next, { type: 'resolve' });
      if (next.phase === 'feed') return E.applyMove(next, { type: 'feed' });
      return E.applyMove(next, E.chooseAIMove(next));
    },
    viewExtras: (rs, state, playerId) => {
      const seat = rs.seats.find((s) => s.playerId === playerId);
      return seat ? { mySeat: seat.index } : {};
    },
    resultRows: (state) => {
      if (!state.result) return [];
      return state.result.scores.map((row) => ({ index: row.index, name: row.name, total: row.total }));
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  createServer({ port: port }).then((handle) => {
    const addr = handle.address;
    console.log('[stone-age-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[stone-age-online] http://' + addr.address + ':' + addr.port + '/index.html   (棋盘)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
