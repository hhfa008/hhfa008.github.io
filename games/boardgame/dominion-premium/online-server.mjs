#!/usr/bin/env node
/*
 * Dominion Premium — online room server.
 *
 * Thin wrapper around the shared authoritative server. Rules stay in
 * engine.js; this file decides what is public (supply, discard, play area,
 * counts) and reveals a player's own hand only to that session.
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
const AI_NAMES = ['你', 'AI · 摄政王'];

export function publicState(state) {
  if (!state) return null;
  return {
    seed: state.seed,
    turn: state.turn,
    phase: state.phase,
    actions: state.actions,
    buys: state.buys,
    coins: state.coins,
    moves: state.moves,
    over: state.over,
    pending: state.pending,
    result: state.result,
    supply: Object.assign({}, state.supply),
    players: state.players.map((p, pi) => ({
      name: p.name,
      isAI: p.isAI,
      score: E.score(state)[pi === 0 ? 'human' : 'ai'],
      hand: [],
      handCount: p.hand.length,
      deck: new Array(p.deck.length),
      deckCount: p.deck.length,
      discard: p.discard.slice(),
      playArea: p.playArea.slice()
    })),
    log: state.log.slice(-40),
    events: (state.events || []).slice(-8)
  };
}

export function createServer(options) {
  const opts = options || {};
  return startGameOnlineServer({
    game: 'dominion',
    dir: 'dominion-premium',
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
      humanFirst: true
    }),
    publicState: publicState,
    currentSeat: (state) => state.turn,
    startingSeat: () => 0,
    moveOf: (body) => body.move || body.act || body,
    legalMoves: (state) => E.legalMoves(state),
    // app/online-game.mjs expects aiStep(state) -> next state; engine.aiMove()
    // returns a move, so apply it here instead of returning it raw.
    aiStep: (state) => {
      if (!state || state.over) return state;
      return E.applyMove(state, E.aiMove(state));
    },
    viewExtras: (rs, state, playerId) => {
      const seat = rs.seats.find((s) => s.playerId === playerId);
      if (!seat || !state) return {};
      return {
        mySeat: seat.index,
        myHand: state.players[seat.index].hand.slice(),
        myDeckCount: state.players[seat.index].deck.length,
        myDiscardCount: state.players[seat.index].discard.length,
        myPlayArea: state.players[seat.index].playArea.slice()
      };
    },
    resultRows: (state) => {
      const sc = E.score(state);
      return [
        { index: 0, name: state.players[0].name, total: sc.human },
        { index: 1, name: state.players[1].name, total: sc.ai }
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
    console.log('[dominion-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[dominion-online] http://' + addr.address + ':' + addr.port + '/index.html   (牌桌)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
