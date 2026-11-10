#!/usr/bin/env node
/*
 * Avalon premium — online room server adapter (two humans + AI fill to 5).
 *
 * All room/invite/reconnect/timeout/leaderboard plumbing lives in
 * games/shared/online-room-server.mjs. This file only adapts the Avalon
 * engine: deal, propose/vote/mission/assassinate, per-seat hidden view,
 * AI decisions and settlement.
 *
 * Hidden information is enforced by the engine: every client receives
 * adapter.view(match, itsSeat), so a player only sees their own role plus the
 * role knowledge that role is entitled to. Role cards and the assassin target
 * are revealed only in result() after the match is over.
 *
 *   node games/boardgame/avalon-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'avalon-premium';
const AI_NAMES = ['你', '蓝骑士', '灰袍', '红隼', '夜莺'];
const PHASE_NAMES = {
  propose: '队长提名',
  vote: '全体投票',
  mission: '秘密任务',
  assassin: '刺客暗杀',
  over: '已结束'
};

function activeSeats(state) {
  if (!state) return [];
  if (state.phase === 'propose') return [state.leader];
  if (state.phase === 'vote') {
    const out = [];
    state.votes.forEach((vote, i) => { if (vote == null) out.push(i); });
    return out;
  }
  if (state.phase === 'mission') {
    return state.team.filter((seat) => state.missionVotes[seat] == null);
  }
  if (state.phase === 'assassin') {
    const assassin = E.assassinId(state);
    return assassin >= 0 ? [assassin] : [];
  }
  return [];
}

export const adapter = {
  slug: SLUG,
  title: 'Avalon 阿瓦隆',
  minPlayers: 5,
  maxPlayers: 5,
  defaultPlayers: 5,
  aiNames: AI_NAMES,

  // The official base game is exactly five players. Two humans are joined by
  // three AI seats; one human is joined by four AI seats.
  seatCount() {
    return 5;
  },

  createMatch({ seed, seats }) {
    const state = E.createGame({
      seed: seed,
      names: seats.map(function (seat, i) { return seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)); })
    });
    const ai = seats.map(function (seat) { return Boolean(seat.ai); });
    return { state: state, seats: seats, ai: ai, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const viewer = seatIndex == null ? 0 : seatIndex;
    const state = match.state;
    const view = E.publicView(state, viewer);
    const acting = activeSeats(state);
    view.phaseName = PHASE_NAMES[state.phase] || state.phase;
    view.turnSeat = acting.length ? acting[0] : null;
    view.turnName = acting.length ? state.players[acting[0]].name : null;
    view.actingSeats = acting.slice();
    view.you = viewer;
    view.players = view.players.map(function (player, i) {
      return Object.assign({}, player, { ai: Boolean(match.ai && match.ai[i]) });
    });
    return view;
  },

  legalActions(match, seatIndex) {
    if (!match || !match.state || match.state.phase === 'over') return [];
    return E.legalActionsFor(match.state, seatIndex);
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    try {
      if (!action || typeof action.type !== 'string') {
        return { ok: false, error: 'unknown action', code: 'E_MOVE' };
      }
      if (!state || state.phase === 'over') return { ok: false, error: 'game is over', code: 'E_STATE' };
      if (action.type === 'propose') {
        if (state.phase !== 'propose') return { ok: false, error: 'not the proposal phase', code: 'E_STATE' };
        if (seatIndex !== state.leader) return { ok: false, error: 'only the leader may propose', code: 'E_TURN' };
        E.proposeTeam(state, seatIndex, action.team);
        return { ok: true };
      }
      if (action.type === 'vote') {
        if (state.phase !== 'vote') return { ok: false, error: 'not the voting phase', code: 'E_STATE' };
        if (typeof action.approve !== 'boolean') return { ok: false, error: 'approve must be boolean', code: 'E_MOVE' };
        E.castVote(state, seatIndex, action.approve);
        return { ok: true };
      }
      if (action.type === 'mission') {
        if (state.phase !== 'mission') return { ok: false, error: 'not the mission phase', code: 'E_STATE' };
        if (typeof action.fail !== 'boolean') return { ok: false, error: 'fail must be boolean', code: 'E_MOVE' };
        E.castMission(state, seatIndex, action.fail);
        return { ok: true };
      }
      if (action.type === 'assassinate') {
        if (state.phase !== 'assassin') return { ok: false, error: 'not the assassination phase', code: 'E_STATE' };
        if (E.assassinId(state) !== seatIndex) return { ok: false, error: 'only the assassin may strike', code: 'E_TURN' };
        E.assassinate(state, seatIndex, action.target);
        return { ok: true };
      }
      return { ok: false, error: 'unknown action', code: 'E_MOVE' };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_MOVE' };
    }
  },

  aiAction(match, seatIndex) {
    if (!match || !match.state || match.state.phase === 'over') return null;
    return E.aiDecision(match.state, seatIndex);
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const winnerSide = state.winner;
    const winnerSeats = [];
    const roles = [];
    state.players.forEach(function (p, i) {
      roles.push(p.role);
      if (E.roleSide(p.role) === winnerSide) winnerSeats.push(i);
    });
    const scores = state.players.map(function (p) {
      return E.roleSide(p.role) === winnerSide ? 1 : 0;
    });
    return {
      winnerSeat: winnerSeats.length ? winnerSeats[0] : null,
      winnerSeats: winnerSeats,
      winnerName: winnerSide === 'good' ? '正义方' : '邪恶方',
      winnerSide: winnerSide,
      tied: false,
      scores: scores,
      losers: state.players.map(function (p, i) {
        return {
          seat: i,
          name: p.name,
          score: scores[i],
          role: p.role,
          side: E.roleSide(p.role)
        };
      }),
      reason: state.winReason,
      rounds: state.quests.filter(function (q) { return q.result; }).length,
      turns: state.proposalCount,
      missions: { good: state.missions.good, evil: state.missions.evil },
      quests: state.quests.map(function (q) {
        return { index: q.index, size: q.size, result: q.result, failCount: q.failCount, team: q.team.slice() };
      }),
      merlinSeat: E.merlinId(state),
      percivalSeat: E.percivalId(state),
      morganaSeat: E.morganaId(state),
      assassinSeat: E.assassinId(state),
      assassinTarget: state.assassinTarget,
      roles: roles
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x6a09e667) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)), ai: Boolean(seat.ai) };
      })
    });
  }
};

export function createAvalonServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startAvalonServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startAvalonServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[avalon-online] http://' + addr.address + ':' + addr.port + '/boardgame/avalon-premium/online.html');
    console.log('[avalon-online] http://' + addr.address + ':' + addr.port + '/boardgame/avalon-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
