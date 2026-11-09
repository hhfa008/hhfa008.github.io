#!/usr/bin/env node
'use strict';

/*
 * AI 自动对局评测（只走 HTTP，不 import 引擎）。
 *
 * 用法：
 *   node server/ai-eval.mjs \
 *     --base-url http://127.0.0.1:8787 \
 *     --game card-battle --seed 42 --max-turns 200 \
 *     --out /tmp/result.json
 *
 * 流程：POST /api/rooms -> POST /api/rooms/:id/join -> 轮询 GET /api/rooms/:id
 * -> 按确定性优先级选择 legalActions -> POST /api/rooms/:id/actions
 * -> 终局或达到 max-turns 后输出 JSON。
 *
 * stdout 只输出一份 JSON；进度与诊断写 stderr。--out 同时写文件。
 *
 * 退出码：
 *   0 评测完成（即使 max-turns 截断）
 *   2 连接失败（拒绝连接、DNS、TLS）
 *   3 非法响应（非 JSON、缺少 roomId/session、HTTP 5xx 等）
 *   4 请求超时
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXIT_CONNECTION = 2;
const EXIT_RESPONSE = 3;
const EXIT_TIMEOUT = 4;

class EvalError extends Error {
  constructor(exitCode, message, detail) {
    super(message);
    this.name = 'EvalError';
    this.exitCode = exitCode;
    this.detail = detail || null;
  }
}

function log(message) {
  process.stderr.write('[ai-eval] ' + message + '\n');
}

function usage() {
  return [
    'usage: node server/ai-eval.mjs [options]',
    '  --base-url <url>     default: BOARDGAME_AI_BASE_URL or http://127.0.0.1:8787',
    '  --game <name>        card-battle | mahjong (default: card-battle)',
    '  --seed <int>         deterministic game seed (default: 42)',
    '  --max-turns <int>    maximum actions to submit (default: 200)',
    '  --out <file>         also write the result JSON to this file',
    '  --timeout <ms>       per-request timeout (default: 10000)',
    '  --token <token>      Authorization: Bearer token (or BOARDGAME_API_TOKEN)'
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.BOARDGAME_AI_BASE_URL || 'http://127.0.0.1:8787',
    game: 'card-battle',
    seed: 42,
    maxTurns: 200,
    out: null,
    timeoutMs: 10000,
    token: process.env.BOARDGAME_API_TOKEN || null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = function () {
      i += 1;
      if (i >= argv.length) throw new EvalError(EXIT_RESPONSE, 'missing value for ' + arg);
      return argv[i];
    };
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--base-url') opts.baseUrl = next();
    else if (arg === '--game') opts.game = next();
    else if (arg === '--seed') opts.seed = Number(next());
    else if (arg === '--max-turns') opts.maxTurns = Number(next());
    else if (arg === '--out') opts.out = next();
    else if (arg === '--timeout') opts.timeoutMs = Number(next());
    else if (arg === '--token') opts.token = next();
    else throw new EvalError(EXIT_RESPONSE, 'unknown argument: ' + arg);
  }
  if (!Number.isFinite(opts.seed)) throw new EvalError(EXIT_RESPONSE, '--seed must be a number');
  if (!Number.isFinite(opts.maxTurns) || opts.maxTurns <= 0) {
    throw new EvalError(EXIT_RESPONSE, '--max-turns must be a positive number');
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new EvalError(EXIT_RESPONSE, '--timeout must be a positive number');
  }
  opts.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  opts.seed = opts.seed >>> 0;
  opts.maxTurns = Math.floor(opts.maxTurns);
  opts.timeoutMs = Math.floor(opts.timeoutMs);
  return opts;
}

async function requestJson(opts, method, route, body) {
  const url = new URL(opts.baseUrl + route);
  const headers = { accept: 'application/json' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  const init = {
    method: method,
    headers: headers,
    signal: AbortSignal.timeout(opts.timeoutMs)
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new EvalError(EXIT_TIMEOUT, 'request timed out: ' + method + ' ' + route, {
        timeoutMs: opts.timeoutMs
      });
    }
    throw new EvalError(EXIT_CONNECTION,
      'cannot connect to ' + opts.baseUrl + ': ' + (err && err.message ? err.message : String(err)),
      { cause: err && err.cause ? String(err.cause.code || err.cause.message || err.cause) : null });
  }
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new EvalError(EXIT_RESPONSE, 'non-JSON response from ' + method + ' ' + route,
        { status: response.status, body: text.slice(0, 400) });
    }
  }
  return { status: response.status, body: parsed, text: text };
}

function requireShape(value, label) {
  if (!value || typeof value !== 'object') {
    throw new EvalError(EXIT_RESPONSE, label + ' is not a JSON object');
  }
  return value;
}

function isEnded(state) {
  if (!state || typeof state !== 'object') return true;
  if (state.status === 'ended' || state.phase === 'ended' || state.phase === 'finished') return true;
  const summary = state.summary;
  return Boolean(summary && summary.phase === 'ended');
}

function normalizeType(action) {
  return String((action && (action.type || action.action)) || '')
    .toLowerCase().replace(/[_-]/g, '');
}

const CARD_PRIORITY = {
  attack: 100,
  play: 90,
  attach: 80,
  draw: 70,
  prize: 60,
  takeprize: 60,
  endturn: 10
};

const MAHJONG_PRIORITY = {
  tsumo: 100,
  selfdraw: 100,
  win: 100,
  claim: 90,
  discard: 80,
  draw: 70,
  pass: 10,
  passclaim: 10
};

function chooseAction(actions, game) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const table = game === 'mahjong' ? MAHJONG_PRIORITY : CARD_PRIORITY;
  let best = actions[0];
  let bestScore = -1;
  for (let i = 0; i < actions.length; i += 1) {
    const score = table[normalizeType(actions[i])] == null
      ? 0
      : table[normalizeType(actions[i])];
    if (score > bestScore) {
      bestScore = score;
      best = actions[i];
    }
  }
  return best;
}

function actionPayload(action) {
  const payload = { type: action.type || action.action };
  if (action.cardId) payload.cardId = action.cardId;
  if (action.target) payload.target = action.target;
  if (action.tile) payload.tile = action.tile;
  if (Number.isInteger(action.playerIndex)) payload.playerIndex = action.playerIndex;
  return payload;
}

function actorForAction(action, state) {
  if (Number.isInteger(action && action.playerIndex) && state.players) {
    const player = state.players[action.playerIndex];
    if (player && player.id) return player.id;
  }
  return state.currentPlayerId || null;
}

function resultOf(game, state, reason) {
  const summary = (state && state.summary) || {};
  if (game === 'mahjong') {
    const winner = summary.winner == null ? null : summary.winner;
    return {
      winner: winner == null ? null : 'P' + (winner + 1),
      winnerIndex: winner,
      score: summary.result
        ? { fan: summary.result.fan, patterns: summary.result.patterns }
        : { wallLeft: summary.wallLeft },
      reason: summary.result && summary.result.type ? summary.result.type : reason
    };
  }
  const players = Array.isArray(summary.players) ? summary.players : [];
  const winner = summary.winner == null ? null : summary.winner;
  const hp = {};
  players.forEach(function (player, index) {
    hp['P' + (index + 1)] = player.hp;
  });
  return {
    winner: winner == null ? null : 'P' + (winner + 1),
    winnerIndex: winner,
    score: hp,
    reason: winner == null ? reason : 'trainer-hp'
  };
}

async function createRoom(opts) {
  const created = await requestJson(opts, 'POST', '/api/rooms', {
    gameType: opts.game,
    playerId: 'ai-p1',
    visibility: 'public',
    seed: opts.seed
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new EvalError(EXIT_RESPONSE, 'create room failed with status ' + created.status,
      created.body);
  }
  const body = requireShape(created.body, 'create room response');
  if (typeof body.roomId !== 'string' || !body.roomId) {
    throw new EvalError(EXIT_RESPONSE, 'create room response has no roomId', body);
  }
  if (typeof body.playerSession !== 'string' || !body.playerSession) {
    throw new EvalError(EXIT_RESPONSE, 'create room response has no playerSession', body);
  }
  return body;
}

async function joinRoom(opts, roomId, inviteCode, playerId) {
  const joined = await requestJson(opts, 'POST',
    '/api/rooms/' + encodeURIComponent(roomId) + '/join',
    { playerId: playerId, inviteCode: inviteCode || undefined });
  if (joined.status !== 200) {
    throw new EvalError(EXIT_RESPONSE, 'join room failed with status ' + joined.status, joined.body);
  }
  const body = requireShape(joined.body, 'join room response');
  if (typeof body.playerSession !== 'string' || !body.playerSession) {
    throw new EvalError(EXIT_RESPONSE, 'join room response has no playerSession', body);
  }
  return body;
}

async function startRoom(opts, roomId, playerId, session) {
  const started = await requestJson(opts, 'POST',
    '/api/rooms/' + encodeURIComponent(roomId) + '/start',
    { playerId: playerId, session: session });
  if (started.status !== 200) {
    throw new EvalError(EXIT_RESPONSE, 'start room failed with status ' + started.status, started.body);
  }
  return requireShape(started.body, 'start room response');
}

async function readState(opts, roomId, sessions) {
  const query = new URLSearchParams();
  const playerId = sessions.order[0];
  query.set('playerId', playerId);
  query.set('session', sessions.byPlayer[playerId]);
  const state = await requestJson(opts, 'GET',
    '/api/rooms/' + encodeURIComponent(roomId) + '?' + query.toString());
  if (state.status !== 200) {
    throw new EvalError(EXIT_RESPONSE, 'read room state failed with status ' + state.status, state.body);
  }
  return requireShape(state.body, 'room state');
}

export async function runEvaluation(options) {
  const opts = options || parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const moves = [];
  const errors = [];
  const created = await createRoom(opts);
  const roomId = created.roomId;
  const sessions = {
    byPlayer: { 'ai-p1': created.playerSession },
    order: ['ai-p1']
  };
  log('room ' + roomId + ' created (game=' + opts.game + ', seed=' + opts.seed + ')');
  const isMahjong = String(opts.game).toLowerCase() === 'mahjong';
  const guests = isMahjong ? ['ai-p2', 'ai-p3', 'ai-p4'] : ['ai-p2'];
  let state = created;
  for (const guest of guests) {
    state = await joinRoom(opts, roomId, created.inviteCode, guest);
    sessions.byPlayer[guest] = state.playerSession;
    sessions.order.push(guest);
  }
  if (isMahjong) {
    state = await startRoom(opts, roomId, 'ai-p1', created.playerSession);
  }
  let stopReason = 'max-turns';
  while (moves.length < opts.maxTurns) {
    if (isEnded(state)) {
      stopReason = 'game-over';
      break;
    }
    if (state.status === 'waiting') {
      errors.push({ at: moves.length, code: 'E_WAITING', message: 'room is still waiting for players' });
      stopReason = 'waiting-for-players';
      break;
    }
    const actions = Array.isArray(state.legalActions) ? state.legalActions : [];
    if (actions.length === 0) {
      errors.push({ at: moves.length, code: 'E_NO_ACTIONS', message: 'no legal actions' });
      stopReason = 'no-legal-actions';
      break;
    }
    const action = chooseAction(actions, opts.game);
    const playerId = actorForAction(action, state);
    const actingTurn = state.turn;
    const session = playerId ? sessions.byPlayer[playerId] : null;
    if (!session) {
      errors.push({ at: moves.length, code: 'E_SESSION', message: 'no session for ' + playerId });
      stopReason = 'missing-session';
      break;
    }
    const payload = Object.assign(actionPayload(action), { playerId: playerId, session: session });
    let response;
    try {
      response = await requestJson(opts, 'POST',
        '/api/rooms/' + encodeURIComponent(roomId) + '/actions', payload);
    } catch (err) {
      if (err instanceof EvalError && (err.exitCode === EXIT_TIMEOUT || err.exitCode === EXIT_CONNECTION)) {
        throw err;
      }
      errors.push({ at: moves.length, code: 'E_REQUEST', message: err.message });
      stopReason = 'request-failed';
      break;
    }
    if (response.status !== 200) {
      errors.push({
        at: moves.length,
        code: (response.body && response.body.error && response.body.error.code) || 'E_ACTION',
        message: 'action rejected with status ' + response.status,
        action: payload
      });
      // 非法动作时用 end-turn 兜底一次，避免整轮评测卡死。
      if (normalizeType(action) !== 'endturn') {
        const fallback = await requestJson(opts, 'POST',
          '/api/rooms/' + encodeURIComponent(roomId) + '/actions',
          { type: 'endTurn', playerId: playerId, session: session });
        if (fallback.status === 200) {
          state = fallback.body;
          moves.push({
            turn: actingTurn,
            resultTurn: state.turn,
            playerId: playerId,
            action: { type: 'endTurn', fallback: true },
            result: { status: state.status, phase: state.phase, current: state.currentPlayerId }
          });
          continue;
        }
      }
      stopReason = 'action-rejected';
      break;
    }
    state = requireShape(response.body, 'action response');
    moves.push({
      turn: actingTurn,
      resultTurn: state.turn,
      playerId: playerId,
      action: actionPayload(action),
      result: {
        status: state.status,
        phase: state.phase,
        current: state.currentPlayerId,
        legalActions: Array.isArray(state.legalActions) ? state.legalActions.length : 0
      }
    });
  }
  if (isEnded(state) && stopReason !== 'game-over') stopReason = 'game-over';
  if (moves.length >= opts.maxTurns && !isEnded(state)) stopReason = 'max-turns';

  const payload = {
    schemaVersion: 1,
    baseUrl: opts.baseUrl,
    game: opts.game,
    seed: opts.seed,
    startedAt: startedAt,
    finishedAt: new Date().toISOString(),
    turns: moves.length,
    finalTurn: state && state.turn != null ? state.turn : null,
    maxTurns: opts.maxTurns,
    roomId: roomId,
    moves: moves,
    result: resultOf(opts.game, state, stopReason),
    finalState: {
      status: state && state.status,
      phase: state && state.phase,
      turn: state && state.turn,
      currentPlayerId: state && state.currentPlayerId,
      summary: state && state.summary ? state.summary : null
    },
    errors: errors
  };
  return payload;
}

function writeOut(file, payload) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n');
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    log(err.message);
    process.exitCode = err.exitCode || EXIT_RESPONSE;
    return;
  }
  try {
    const payload = await runEvaluation(opts);
    const text = JSON.stringify(payload, null, 2);
    if (opts.out) writeOut(opts.out, payload);
    process.stdout.write(text + '\n');
  } catch (err) {
    if (err instanceof EvalError) {
      log(err.message);
      if (err.detail) log(JSON.stringify(err.detail).slice(0, 2000));
      process.exitCode = err.exitCode;
      return;
    }
    log('unexpected failure: ' + (err && err.stack ? err.stack : String(err)));
    process.exitCode = EXIT_RESPONSE;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}

export default { runEvaluation: runEvaluation };
