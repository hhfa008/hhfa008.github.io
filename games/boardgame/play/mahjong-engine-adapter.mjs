'use strict';

/*
 * Compatibility adapter for the single-player mahjong UI.
 *
 * Rules, wall building and win evaluation stay in ../app/mahjong.js. This
 * adapter only renames/reshapes its state machine to the smaller surface the
 * existing page was written against (phase 'draw'/'discard'/'ended', turn =
 * seat, typo-free result payload for the result overlay).
 */

import {
  TILE_KINDS,
  createGame as engineCreateGame,
  draw,
  discard,
  checkWin,
  claimWin,
  selfDrawWin,
  passClaim,
  legalActions,
  summarize,
  scoreHand
} from '../app/mahjong.js';

const SEATS = 4;

function mapResult(result) {
  if (!result) return null;
  if (result.type === 'draw') {
    return { type: 'draw', winner: null, from: null, tile: null, han: 0, fu: 0, points: 0, yaku: [] };
  }
  const score = result.hand ? scoreHand(result.hand) : { han: result.fan, fu: 30, points: (result.fan || 0) * 1000, yaku: result.patterns || [] };
  const patternHan = { '平胡': 1, '七对': 2, '碰碰胡': 2, '清一色': 2, '十三幺': 5 };
  const yaku = (result.patterns || []).map(function (name) {
    return { name: name, han: patternHan[name] == null ? 0 : patternHan[name] };
  });
  return {
    type: result.type === 'ron' ? 'ron' : 'tsumo',
    winner: result.winner,
    from: result.from == null ? null : result.from,
    tile: result.tile || null,
    han: score.han == null ? result.fan : score.han,
    fu: score.fu == null ? 30 : score.fu,
    points: score.points == null ? (result.fan || 0) * 1000 : score.points,
    yaku: yaku,
    fan: result.fan,
    patterns: (result.patterns || []).slice()
  };
}

function makeView(engine) {
  let phaseOverride = null;

  const view = {
    engine: engine,
    players: SEATS,
    drawn: null,
    lastDraw: null,
    _lastDiscard: null,

    get hands() { return engine.hands; },
    get wall() { return engine.wall; },
    get wallIndex() { return engine.wallIndex; },
    set wallIndex(value) { engine.wallIndex = value; },

    get turn() { return engine.currentPlayer; },
    set turn(value) { engine.currentPlayer = value; },
    get currentPlayer() { return engine.currentPlayer; },
    set currentPlayer(value) { engine.currentPlayer = value; },

    get discards() { return engine.rivers; },
    set discards(value) { engine.rivers = value; },
    get rivers() { return engine.rivers; },
    set rivers(value) { engine.rivers = value; },

    get phase() {
      if (engine.phase === 'ended') return 'ended';
      if (phaseOverride === 'draw') return 'draw';
      return 'discard';
    },
    set phase(value) {
      if (value === 'draw') phaseOverride = 'draw';
      else phaseOverride = null;
      if (value === 'ended') engine.phase = 'ended';
    },

    get winner() { return engine.winner; },
    set winner(value) { engine.winner = value; },

    get result() { return mapResult(engine.result); },
    set result(value) { engine.result = value; },

    get lastDiscard() { return engine.lastDiscard; },
    set lastDiscard(value) { engine.lastDiscard = value; },

    get claimOptions() { return Array.isArray(engine.claimOptions) ? engine.claimOptions.slice() : []; }
  };

  return view;
}

export function createGame(options) {
  const opts = options || {};
  // 主线引擎固定四人；UI 的座位选择器已收敛为 4 人。
  const engine = engineCreateGame({ seed: opts.seed });
  const view = makeView(engine);
  view.dealer = engine.dealer;
  return view;
}

export function beginTurn(view) {
  const engine = view.engine;
  if (!engine || engine.phase === 'ended') return { ok: false, error: '本局已结束' };
  const hand = engine.hands[engine.currentPlayer] || [];
  if (hand.length >= 14) {
    view.phase = 'discard';
    return { ok: true, tile: null };
  }
  const tile = draw(engine);
  if (engine.phase === 'ended') {
    return { ok: false, ended: true, result: mapResult(engine.result) };
  }
  if (tile == null) return { ok: false, error: '牌山已空' };
  view.phase = 'discard';
  view.drawn = tile;
  view.lastDraw = tile;
  return { ok: true, tile: tile };
}

export function discardTile(view, playerIndex, tile) {
  const engine = view.engine;
  if (!engine || engine.phase === 'ended') return { ok: false, error: '本局已结束' };
  if (playerIndex !== engine.currentPlayer) return { ok: false, error: '还没轮到你' };
  const result = discard(engine, tile);
  if (!result.ok) return { ok: false, error: result.message || '这张牌不能打出' };
  view.drawn = null;
  view.lastDraw = null;
  return { ok: true, tile: tile, phase: result.phase };
}

export function canTsumo(view, playerIndex) {
  const engine = view.engine;
  if (!engine || engine.phase === 'ended' || engine.phase === 'claim') return false;
  if (playerIndex !== engine.currentPlayer) return false;
  const hand = engine.hands[playerIndex] || [];
  if (hand.length !== 14) return false;
  return Boolean(checkWin(engine, playerIndex).win);
}

export function canRon(view, playerIndex) {
  const engine = view.engine;
  if (!engine || engine.phase !== 'claim') return false;
  return Array.isArray(engine.claimOptions) && engine.claimOptions.indexOf(playerIndex) !== -1;
}

export function declareTsumo(view, playerIndex) {
  const result = selfDrawWin(view.engine, playerIndex);
  if (!result.ok) return { ok: false, error: result.message };
  view.phase = 'discard';
  return { ok: true, result: mapResult(result.result) };
}

export function declareRon(view, playerIndex) {
  const result = claimWin(view.engine, playerIndex);
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, result: mapResult(result.result) };
}

export function pass(view) {
  const result = passClaim(view.engine);
  view.phase = 'discard';
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export function chooseDiscard(view, playerIndex) {
  const engine = view.engine;
  if (!engine || playerIndex !== engine.currentPlayer) return null;
  const hand = engine.hands[playerIndex] || [];
  if (!hand.length) return null;
  const actions = legalActions(engine);
  const action = actions.find(function (item) { return item.type === 'discard'; });
  // 优先打掉孤张：保留对子/顺子潜力，纯 AI 出牌偏好，不改变规则。
  if (!action) return hand[hand.length - 1];
  const counts = new Map();
  hand.forEach(function (tile) { counts.set(tile, (counts.get(tile) || 0) + 1); });
  const alone = hand.find(function (tile) { return action.tile === tile && counts.get(tile) === 1; });
  return alone || action.tile;
}

export function remainingTiles(view) {
  const engine = view && view.engine;
  if (!engine) return 0;
  return Math.max(0, engine.wall.length - engine.wallIndex);
}

export function getGameState(view) {
  const engine = view && view.engine;
  if (!engine) return null;
  const summary = summarize(engine);
  return {
    players: SEATS,
    turn: engine.currentPlayer,
    phase: view.phase,
    hands: summary.hands,
    discards: summary.rivers,
    handCounts: summary.handCounts,
    wallLeft: summary.wallLeft,
    winner: summary.winner,
    result: mapResult(engine.result),
    claimOptions: view.claimOptions
  };
}

export { TILE_KINDS };
