#!/usr/bin/env node
/*
 * Undercover Premium — online room server.
 *
 * Thin wrapper around the shared authoritative server at ../app/online-game.mjs.
 * Rules live in engine.js. The public view hides every living player's role and
 * word; a session only receives its own private card through viewExtras. The
 * eliminated player's role/word and the final result are public.
 *
 *   node online-server.mjs --port 8787
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startGameOnlineServer } from '../app/online-game.mjs';
import { SOLO_AI_FILL, makeAiStep } from '../app/ai-seat.mjs';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const AI_NAMES = ['AI · 播音员', 'AI · 侦探', 'AI · 演员', 'AI · 记者', 'AI · 教授', 'AI · 主持人'];

export function publicState(state) {
  if (!state) return null;
  var over = !!state.over;
  return {
    version: state.version,
    phase: state.phase,
    round: state.round,
    current: state.current,
    over: over,
    winnerSide: state.winnerSide,
    playerCount: state.playerCount,
    revealIndex: state.revealIndex,
    voteOrder: state.voteOrder.slice(),
    votedCount: state.votedCount,
    votes: (state.phase === 'speak' || state.phase === 'over')
      ? state.votes.map(function (v) { return { from: v.from, to: v.to, round: v.round }; })
      : [],
    lastElim: state.lastElim,
    eliminated: state.eliminated.slice(),
    hint: state.hint ? state.pair.cat : null,
    players: state.players.map(function (p) {
      var row = {
        index: p.index,
        name: p.name,
        alive: p.alive,
        revealed: p.revealed,
        votes: (state.phase === 'speak' || state.phase === 'over') ? p.votes : 0,
        isAI: !!p.isAI
      };
      if (over || !p.alive) {
        row.role = p.role;
        row.word = p.word;
      }
      return row;
    }),
    result: state.result,
    history: state.history.filter(function (h) { return h.type !== 'vote'; }).slice(-24).map(function (h) {
      if (h.type === 'eliminate') {
        return { type: h.type, round: h.round, pid: h.pid, role: h.role, tally: h.tally };
      }
      if (h.type === 'vote') {
        return { type: h.type, round: h.round, from: h.from, to: h.to };
      }
      return {
        type: h.type,
        round: h.round,
        pid: h.pid,
        order: h.order,
        winnerSide: h.winnerSide,
        players: h.players,
        undercover: h.undercover,
        blank: h.blank
      };
    })
  };
}

export function createServer(options) {
  const opts = options || {};
  return startGameOnlineServer({
    game: 'undercover',
    dir: 'undercover-premium',
    port: opts.port,
    host: opts.host,
    engine: E,
    maxPlayers: 6,
    defaultPlayers: 6,
    minHumanPlayers: SOLO_AI_FILL.minHumanPlayers,
    aiNames: AI_NAMES,
    idleTimeoutMs: opts.idleTimeoutMs,
    aiDelayMs: opts.aiDelayMs,
    roomStore: opts.roomStore,
    createState: (seats, seed) => E.createGame({
      seed: seed,
      playerCount: seats.length,
      undercoverCount: E.recommendedUndercover(seats.length),
      blankCount: 0,
      names: seats.map((s) => s.nickname),
      isAI: seats.map((s) => s.ai),
      hint: false
    }),
    publicState: publicState,
    currentSeat: (state) => state.current,
    startingSeat: (state) => state.current || 0,
    moveOf: (body) => body.move || body.act || body,
    legalMoves: (state) => E.getLegalMoves(state),
    applyMove: (state, move) => E.applyMove(state, move),
    aiStep: makeAiStep(E, E.applyMove),
    viewExtras: (rs, state, playerId) => {
      if (!state) return {};
      const seat = rs.seats.find((s) => s.playerId === playerId);
      if (!seat) return {};
      const p = state.players[seat.index];
      if (!p) return {};
      return {
        mySeat: seat.index,
        privateWord: p.word,
        privateRole: p.role,
        privateAlive: p.alive,
        privateRevealed: p.revealed,
        privateHint: state.hint ? state.pair.cat : null
      };
    },
    resultRows: (state) => {
      if (!state || !state.result) return [];
      const win = state.result.winnerSide;
      return [
        { index: 0, name: win === 'civ' ? '平民阵营' : '卧底阵营', total: 1 },
        { index: 1, name: win === 'civ' ? '卧底阵营' : '平民阵营', total: 0 }
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
    console.log('[undercover-online] http://' + addr.address + ':' + addr.port + '/online.html  (联机大厅)');
    console.log('[undercover-online] http://' + addr.address + ':' + addr.port + '/index.html   (本地版)');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
