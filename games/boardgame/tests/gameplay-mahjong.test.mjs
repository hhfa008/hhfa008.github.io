'use strict';

/*
 * L2 contract: Japanese mahjong core.
 *
 * Tile notation is fixed for the contract:
 *   man/pin/sou: "1m".."9m", "1p".."9p", "1s".."9s"
 *   honors:      "1z".."7z"
 * The wall is 136 tiles = 34 kinds x 4.
 *
 * Probes app/mahjong.mjs (or app/games/mahjong.*). Missing => SKIP.
 */

import fs from 'node:fs';
import { createSuite } from './lib/suite.mjs';
import { probeModule, fnOf, nameOf, describeMissing } from './lib/probe.mjs';
import { MAHJONG, call } from './lib/contracts.mjs';

const CANDIDATES = [
  'app/mahjong.mjs',
  'app/mahjong.js',
  'app/games/mahjong.mjs',
  'app/games/mahjong.js',
  'app/engine/mahjong.mjs'
];

function tilesOf(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['tiles', 'wall', 'remaining', 'deck']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return null;
}

function handList(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.hands)) return value.hands;
  if (Array.isArray(value.players)) {
    return value.players.map(function (player) { return player.hand || player.tiles || []; });
  }
  if (Array.isArray(value.seats)) {
    return value.seats.map(function (seat) { return seat.hand || seat.tiles || []; });
  }
  if (Array.isArray(value[0])) return value;
  return null;
}

function kindOf(tile) {
  if (tile == null) return null;
  if (typeof tile === 'string' || typeof tile === 'number') return String(tile);
  for (const key of ['kind', 'type', 'tile', 'id']) {
    if (tile[key] != null) return String(tile[key]);
  }
  if (typeof tile.suit === 'string' && typeof tile.rank === 'number') {
    return tile.rank + tile.suit;
  }
  return JSON.stringify(tile);
}

function yakuList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.yaku)) return value.yaku;
  if (Array.isArray(value.yakus)) return value.yakus;
  if (Array.isArray(value.patterns)) return value.patterns;
  if (value.yaku && typeof value.yaku === 'object') return Object.keys(value.yaku);
  if (value.fan > 0 || value.han > 0 || value.points > 0 || value.score > 0) return [value.name || 'yaku'];
  return [];
}

const STANDARD_WIN = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '5s', '5s'];
const SEVEN_PAIRS = ['1m', '1m', '2m', '2m', '3m', '3m', '4m', '4m', '5p', '5p', '6s', '6s', '7z', '7z'];
const NOT_WIN = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '4p', '5s', '7z'];
const FILLER = ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '1s', '2s', '3s', '4s'];
const CHI_MELD = [{ type: 'chi', tiles: ['1m', '2m', '3m'] }];

const s = createSuite('boardgame-gameplay-mahjong');

await s.run(async () => {
  const probe = await probeModule(CANDIDATES, 'mahjong');
  if (!probe.found) {
    s.skip('mahjong contract', describeMissing(probe, CANDIDATES));
    return;
  }
  if (probe.error) {
    s.ok('mahjong module imports without throwing', false,
      probe.path + ': ' + (probe.error.stack || probe.error.message || String(probe.error)));
    return;
  }

  const api = probe.api;
  const createWall = fnOf(api, MAHJONG.wall);
  const deal = fnOf(api, MAHJONG.deal);
  const draw = fnOf(api, MAHJONG.draw);
  const discard = fnOf(api, MAHJONG.discard);
  const win = fnOf(api, MAHJONG.win);
  const score = fnOf(api, MAHJONG.yaku);
  const kinds = api[MAHJONG.kinds[0]] || api[MAHJONG.kinds[1]] || api[MAHJONG.kinds[2]];

  await s.group('exports', async () => {
    s.ok('提供 createWall', typeof createWall === 'function', 'expected ' + MAHJONG.wall.join(' / '));
    s.ok('提供 dealHands/deal', typeof deal === 'function', 'expected ' + MAHJONG.deal.join(' / '));
    s.ok('提供 drawTile/draw', typeof draw === 'function', 'expected ' + MAHJONG.draw.join(' / '));
    s.ok('提供 discardTile/discard', typeof discard === 'function', 'expected ' + MAHJONG.discard.join(' / '));
    s.ok('提供胡牌判定', typeof win === 'function', 'expected ' + MAHJONG.win.join(' / '));
    s.ok('提供番型/计分接口', typeof score === 'function', 'expected ' + MAHJONG.yaku.join(' / '));
  });

  let wall = null;
  await s.group('wall: 136 tiles / 34 kinds x 4', async () => {
    if (!createWall) return;
    try {
      const created = await call(createWall, null, []);
      wall = tilesOf(created) || (Array.isArray(created) ? created : null);
      s.ok('createWall 返回牌墙数组', Array.isArray(wall));
    } catch (err) {
      s.ok('createWall 不抛错', false, err && err.message ? err.message : String(err));
      return;
    }
    if (!Array.isArray(wall)) return;
    s.eq('牌墙 136 张', wall.length, 136);

    const counts = {};
    for (const tile of wall) counts[kindOf(tile)] = (counts[kindOf(tile)] || 0) + 1;
    const distinct = Object.keys(counts);
    s.eq('牌墙 34 种', distinct.length, 34);
    const bad = distinct.filter(function (kind) { return counts[kind] !== 4; });
    s.eq('每种恰好 4 张', bad.map(function (kind) { return kind + '=' + counts[kind]; }), []);
    if (kinds) s.eq('导出的牌种常量 34', kinds.length, 34);
  });

  let dealt = null;
  const dealName = nameOf(api, MAHJONG.deal) || '';
  await s.group('deal: 4 players, wall 84', async () => {
    if (!deal) return;
    if (/createGame|startRound/i.test(dealName)) {
      let state;
      try {
        state = await call(deal, null, [{ seed: 20261110, dealer: 0 }]);
        s.ok('createGame/startRound 不抛错', state != null);
      } catch (err) {
        s.ok('createGame/startRound 不抛错', false, err && err.message ? err.message : String(err));
        return;
      }
      const hands = state && Array.isArray(state.hands) ? state.hands : null;
      s.ok('开局返回 4 手牌', Array.isArray(hands) && hands.length === 4,
        JSON.stringify(state && Object.keys(state)));
      if (!Array.isArray(hands) || hands.length !== 4) return;
      const counts = hands.map(function (hand) { return hand.length; });
      s.eq('四家起手总张数 53', counts.reduce(function (sum, n) { return sum + n; }, 0), 53);
      s.eq('三家 13 张', counts.filter(function (n) { return n === 13; }).length, 3);
      s.eq('庄家 14 张', counts.filter(function (n) { return n === 14; }).length, 1);
      const remaining = Array.isArray(state.wall) ? state.wall.length - state.wallIndex : null;
      s.eq('发牌后牌墙剩余 83 张（53 张已到四家）', remaining, 83);
      dealt = state;
      return;
    }

    if (!Array.isArray(wall)) return;
    let result;
    try {
      result = await call(deal, null, [wall.slice(), 4]);
      if (result === undefined) result = await call(deal, null, [{ wall: wall.slice(), players: 4 }]);
      s.ok('dealHands 不抛错', true);
    } catch (err) {
      s.ok('dealHands 不抛错', false, err && err.message ? err.message : String(err));
      return;
    }
    const hands = handList(result);
    s.ok('发牌返回 4 手牌', Array.isArray(hands) && hands.length === 4, JSON.stringify(result && Object.keys(result)));

    if (!Array.isArray(hands) || hands.length !== 4) return;
    hands.forEach(function (hand, i) {
      s.eq('玩家 ' + i + ' 起手 13 张', hand.length, 13);
    });
    const rest = tilesOf(result);
    s.ok('发牌后牌墙剩余 84 张', rest === null || rest.length === 84, String(rest && rest.length));
    dealt = result;
  });

  await s.group('draw and discard', async () => {
    // B-style engine state: {wall, wallIndex, hands, rivers, currentPlayer, phase}.
    if (dealt && Array.isArray(dealt.rivers) && Array.isArray(dealt.wall)) {
      const state = dealt;
      if (!discard) {
        s.skip('discard contract', 'no discardTile/discard export');
      } else {
        const player = state.currentPlayer;
        const handBefore = state.hands[player].length;
        const tile = state.hands[player][handBefore - 1];
        const riversBefore = state.rivers[player].length;
        try {
          const result = await call(discard, null, [state, tile]);
          s.ok('discard 不抛错', !result || result.ok !== false,
            JSON.stringify(result && result.code));
          s.eq('discard 后弃牌区 +1', state.rivers[player].length, riversBefore + 1);
          s.eq('discard 后原手牌 -1', state.hands[player].length, handBefore - 1);
        } catch (err) {
          s.ok('discard 不抛错', false, err && err.message ? err.message : String(err));
        }
      }

      if (!draw) {
        s.skip('draw contract', 'no drawTile/draw export');
      } else if (dealName && /createGame|startRound/i.test(dealName)) {
        // Rebuild a clean round, then use draw() on a 13-tile hand.
        const fresh = await call(deal, null, [{ seed: 7, dealer: 0 }]);
        const player = fresh.currentPlayer;
        fresh.hands[player].pop();
        const wallIndexBefore = fresh.wallIndex;
        try {
          const drawn = await call(draw, null, [fresh]);
          s.ok('draw 返回摸到的牌', drawn != null, String(drawn));
          s.eq('draw 后牌墙索引 +1', fresh.wallIndex, wallIndexBefore + 1);
          s.eq('draw 后手牌回到 14 张', fresh.hands[player].length, 14);
        } catch (err) {
          s.ok('draw 不抛错', false, err && err.message ? err.message : String(err));
        }
      }
      return;
    }

    if (!Array.isArray(wall)) return;
    const state = dealt && typeof dealt === 'object' && !Array.isArray(dealt)
      ? dealt
      : { wall: wall.slice(), hands: [[], [], [], []], discards: [[], [], [], []] };
    if (!Array.isArray(state.wall)) state.wall = wall.slice();
    if (!Array.isArray(state.hands)) state.hands = [[], [], [], []];

    if (draw) {
      const wallBefore = tilesOf(state) ? tilesOf(state).length : state.wall.length;
      const handBefore = state.hands[0].length;
      let result;
      try {
        result = await call(draw, null, [state, 0]);
        s.ok('drawTile 不抛错', true);
      } catch (err) {
        s.ok('drawTile 不抛错', false, err && err.message ? err.message : String(err));
      }
      if (result !== undefined) {
        const rest = tilesOf(result);
        const hand = result && (result.hand || result.tile);
        s.ok('draw 后牌墙 -1', rest === null || rest.length === wallBefore - 1,
          wallBefore + ' -> ' + (rest && rest.length));
        s.ok('draw 后手牌 +1', hand === undefined || state.hands[0].length === handBefore + 1,
          handBefore + ' -> ' + state.hands[0].length);
      }
    } else {
      s.skip('draw contract', 'no drawTile/draw export');
    }

    if (discard) {
      if (state.hands[0].length === 0) state.hands[0].push('1m');
      const handBefore = state.hands[0].length;
      const tile = state.hands[0][state.hands[0].length - 1];
      try {
        await call(discard, null, [state, 0, tile]);
        s.ok('discardTile 不抛错', true);
        s.eq('discard 后手牌 -1', state.hands[0].length, handBefore - 1);
        const discards = state.discards && state.discards[0];
        s.ok('discard 后弃牌区 +1', Array.isArray(discards) ? discards.length >= 1 : true);
      } catch (err) {
        s.ok('discardTile 不抛错', false, err && err.message ? err.message : String(err));
      }
    } else {
      s.skip('discard contract', 'no discardTile/discard export');
    }
  });

  await s.group('winning-hand detection', async () => {
    if (!win) return;
    s.eq('标准 4 面子 + 雀头判胡', await call(win, null, [STANDARD_WIN]), true);
    s.eq('七对子判胡', await call(win, null, [SEVEN_PAIRS]), true);
    s.eq('非胡牌 14 张判否', await call(win, null, [NOT_WIN]), false);
    s.eq('13 张不能判胡', await call(win, null, [STANDARD_WIN.slice(0, 13)]), false);
    const fiveCopies = ['1m', '1m', '1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '9m'];
    s.eq('非法 5 张同牌判否', await call(win, null, [fiveCopies]), false);
  });

  await s.group('yaku / score interface', async () => {
    if (!score) return;
    let result;
    try {
      result = await call(score, null, [STANDARD_WIN, {
        seatWind: 'east',
        prevalentWind: 'east',
        tsumo: true,
        riichi: true
      }]);
    } catch (err) {
      try {
        result = await call(score, null, [STANDARD_WIN]);
      } catch (inner) {
        s.ok('scoreHand 对合法胡牌不抛错', false,
          (inner && inner.message) || (err && err.message) || String(inner));
        return;
      }
    }
    s.ok('scoreHand 返回结果', result != null, JSON.stringify(result));
    if (result == null) return;

    const yaku = yakuList(result);
    s.ok('至少识别 1 个番型', yaku.length >= 1, JSON.stringify(yaku));
    const han = typeof result.han === 'number' ? result.han :
      (typeof result.fan === 'number' ? result.fan :
        (typeof result.totalHan === 'number' ? result.totalHan :
          (typeof result.score === 'number' ? result.score : null)));
    s.ok('返回 han/fan/score/points 之一', han !== null || result.points !== undefined,
      JSON.stringify(result));

    let invalid;
    try {
      invalid = await call(score, null, [NOT_WIN, { tsumo: true }]);
    } catch (err) {
      invalid = { thrown: true };
    }
    const rejected = invalid && (invalid.thrown === true || invalid.valid === false ||
      invalid.win === false || invalid.ok === false || invalid.error ||
      invalid.han === 0 || invalid.fan === 0 || invalid.points === 0);
    s.ok('非胡牌不给出正分', Boolean(rejected), JSON.stringify(invalid));
  });

  const createGame = fnOf(api, ['createGame']);
  const gameDiscard = fnOf(api, ['discard']);
  const gameDraw = fnOf(api, ['draw']);
  const evalHand = fnOf(api, ['evaluateHand']);
  const scoreHand = fnOf(api, ['scoreHand']);
  const claimChi = fnOf(api, ['claimChi']);
  const claimPong = fnOf(api, ['claimPong']);
  const claimKong = fnOf(api, ['claimKong']);
  const claimWin = fnOf(api, ['claimWin']);
  const claimPass = fnOf(api, ['passClaim']);
  const currentOffer = fnOf(api, ['currentClaimOffer']);
  const claimActionsFor = fnOf(api, ['claimActionsFor']);
  const selfDraw = fnOf(api, ['selfDrawWin']);
  const aiDiscard = fnOf(api, ['chooseAiDiscard']);
  const aiClaim = fnOf(api, ['chooseAiClaim']);
  const assetOf = fnOf(api, ['tileAsset']);

  function controlled(current, hands, overrides) {
    if (!createGame) return null;
    const state = createGame({ seed: 424242, dealer: 0 });
    state.phase = 'discard';
    state.currentPlayer = current;
    state.hands = hands.map(function (hand) { return hand.slice(); });
    state.melds = [[], [], [], []];
    state.rivers = [[], [], [], []];
    state.claimOffers = [];
    state.claimIndex = 0;
    state.lastDiscard = null;
    state.lastDrawn = null;
    state.winner = null;
    state.result = null;
    state.turn = 0;
    state.wallIndex = 53;
    Object.keys(overrides || {}).forEach(function (key) { state[key] = overrides[key]; });
    return state;
  }

  function actionsOf(offer) {
    return offer && Array.isArray(offer.actions) ? offer.actions.map(function (action) { return action.type; }) : [];
  }

  await s.group('opening: four hands, dealer 14, wall 83', async () => {
    if (!createGame) {
      s.skip('opening contract', 'missing createGame');
      return;
    }
    const state = createGame({ seed: 20261110, dealer: 0 });
    s.eq('开局：4 手牌', state.hands.length, 4);
    const counts = state.hands.map(function (hand) { return hand.length; });
    s.eq('开局：三家 13 张', counts.filter(function (n) { return n === 13; }).length, 3);
    s.eq('开局：庄家 14 张', counts.filter(function (n) { return n === 14; }).length, 1);
    s.eq('开局：牌山剩 83 张', state.wall.length - state.wallIndex, 83);
    s.eq('开局：庄家先出牌', state.currentPlayer, state.dealer);
    s.eq('开局：没有副露', state.melds.map(function (m) { return m.length; }), [0, 0, 0, 0]);
  });

  await s.group('chi: only from upstream, legal and illegal', async () => {
    if (!createGame || !gameDiscard || !claimChi || !currentOffer) {
      s.skip('chi contract', 'missing claimChi/createGame/discard');
      return;
    }
    const state = controlled(3, [
      ['1m', '2m'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      FILLER.slice(),
      ['3m'].concat(FILLER.slice(0, 13))
    ]);
    const discarded = gameDiscard(state, '3m');
    s.eq('吃：弃牌进入鸣牌阶段', discarded.phase, 'claim');
    const offer = currentOffer(state);
    s.eq('吃：上家弃牌给 1 号位吃', offer && offer.player, 0);
    s.ok('吃：动作列表包含 chi', actionsOf(offer).indexOf('chi') !== -1, JSON.stringify(actionsOf(offer)));
    const result = claimChi(state, 0, 0);
    s.ok('吃：合法组合执行成功', result.ok === true, JSON.stringify(result));
    s.eq('吃：副露类型 chi', state.melds[0][0] && state.melds[0][0].type, 'chi');
    s.eq('吃：副露 3 张', state.melds[0][0] && state.melds[0][0].tiles.length, 3);
    s.eq('吃：暗手剩 11 张', state.hands[0].length, 11);
    s.eq('吃：轮到吃牌者出牌', state.currentPlayer, 0);
    s.eq('吃：被吃的牌离开牌河', state.rivers[3].length, 0);

    const outOfTurn = controlled(3, [
      ['1m', '2m'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      FILLER.slice(),
      ['3m'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(outOfTurn, '3m');
    const wrongPlayer = claimChi(outOfTurn, 1, 0);
    s.eq('吃：非当前鸣牌者被拒', wrongPlayer.code, 'E_TURN');
    const badCombo = claimChi(outOfTurn, 0, 99);
    s.eq('吃：不存在的组合被拒', badCombo.code, 'E_CHI');

    const nonUpstream = controlled(3, [
      FILLER.slice(),
      ['1m', '2m'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      ['3m'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(nonUpstream, '3m');
    s.eq('吃：非上家不给吃', nonUpstream.claimOffers.length, 0);
    s.eq('吃：无鸣牌后继续摸打', nonUpstream.phase, 'discard');
  });

  await s.group('pong: any player with a pair', async () => {
    if (!createGame || !gameDiscard || !claimPong || !currentOffer) {
      s.skip('pong contract', 'missing claimPong/createGame/discard');
      return;
    }
    const state = controlled(3, [
      FILLER.slice(),
      ['5z', '5z'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(state, '5z');
    const offer = currentOffer(state);
    s.eq('碰：2 号位获得碰', offer && offer.player, 1);
    s.ok('碰：动作列表包含 pong', actionsOf(offer).indexOf('pong') !== -1, JSON.stringify(actionsOf(offer)));
    const result = claimPong(state, 1);
    s.ok('碰：执行成功', result.ok === true, JSON.stringify(result));
    s.eq('碰：副露类型 pong', state.melds[1][0] && state.melds[1][0].type, 'pong');
    s.eq('碰：暗手剩 11 张', state.hands[1].length, 11);
    s.eq('碰：轮到碰牌者出牌', state.currentPlayer, 1);

    const pongWinState = controlled(3, [
      FILLER.slice(),
      ['5z', '5z', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p'],
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(pongWinState, '5z');
    claimPong(pongWinState, 1);
    const pongWinHand = evalHand(pongWinState.hands[1], pongWinState.melds[1]);
    s.eq('碰：副露后牌型结构已完整', pongWinHand.win, true);
    s.eq('碰：没有摸牌不能自摸', selfDraw(pongWinState, 1).code, 'E_DRAW');
    if (claimActionsFor) {
      const pongActions = claimActionsFor(pongWinState, 1).map(function (action) { return action.type; });
      s.ok('碰：动作列表不含 tsumo', pongActions.indexOf('tsumo') === -1, JSON.stringify(pongActions));
    }

    const wrong = controlled(3, [
      FILLER.slice(),
      ['5z', '5z'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(wrong, '5z');
    s.eq('碰：其他玩家不能代碰', claimPong(wrong, 0).code, 'E_TURN');

    const onlyOne = controlled(3, [
      FILLER.slice(),
      ['5z', '1m', '4m', '7m', '2p', '5p', '8p', '2s', '5s', '8s', '3p', '6p', '9p'],
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(onlyOne, '5z');
    s.eq('碰：只有一张不能碰', onlyOne.phase, 'discard');
  });

  await s.group('kong: ming kong draws a replacement', async () => {
    if (!createGame || !gameDiscard || !claimKong || !currentOffer) {
      s.skip('kong contract', 'missing claimKong/createGame/discard');
      return;
    }
    const state = controlled(3, [
      FILLER.slice(),
      ['5z', '5z', '5z'].concat(FILLER.slice(0, 10)),
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(state, '5z');
    const offer = currentOffer(state);
    s.ok('杠：动作列表包含 kong', actionsOf(offer).indexOf('kong') !== -1, JSON.stringify(actionsOf(offer)));
    const wallBefore = state.wallIndex;
    const result = claimKong(state, 1);
    s.ok('杠：执行成功', result.ok === true, JSON.stringify(result));
    s.eq('杠：副露 4 张', state.melds[1][0] && state.melds[1][0].tiles.length, 4);
    s.eq('杠：暗手 11 张（含补牌）', state.hands[1].length, 11);
    s.eq('杠：牌山索引 +1', state.wallIndex, wallBefore + 1);
    s.eq('杠：补牌后轮到杠牌者出牌', state.currentPlayer, 1);
    s.eq('杠：补牌标记为最近摸牌', state.lastDrawn && state.lastDrawn.player, 1);

    const onlyPair = controlled(3, [
      FILLER.slice(),
      ['5z', '5z'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(onlyPair, '5z');
    s.eq('杠：两张只能碰不能杠', claimKong(onlyPair, 1).code, 'E_ACTION');
  });

  await s.group('meld-aware winning hands and fan stacking', async () => {
    if (!evalHand) {
      s.skip('meld-aware win contract', 'missing evaluateHand');
      return;
    }
    const chiWin = evalHand(
      ['4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '5s', '5s'],
      CHI_MELD
    );
    s.eq('副露：吃 + 11 张暗手可和', chiWin.win, true);
    s.ok('副露：识别平和', (chiWin.patterns || []).indexOf('平和') !== -1, JSON.stringify(chiWin.patterns));
    s.ok('副露：有吃不算门清', (chiWin.patterns || []).indexOf('门清') === -1, JSON.stringify(chiWin.patterns));
    s.eq('副露：平和 1 番', chiWin.fan, 1);

    const cleanHand = ['4m', '5m', '6m', '7m', '8m', '9m', '1m', '2m', '3m', '5m', '5m'];
    const cleanWin = evalHand(cleanHand, CHI_MELD);
    s.ok('副露：识别清一色', (cleanWin.patterns || []).indexOf('清一色') !== -1, JSON.stringify(cleanWin.patterns));
    s.eq('副露：平和 + 清一色 3 番', cleanWin.fan, 3);

    const pongMeld = [{ type: 'pong', tiles: ['1z', '1z', '1z'] }];
    const honorWin = evalHand(
      ['2z', '2z', '2z', '3z', '3z', '3z', '4z', '4z', '4z', '5z', '5z'],
      pongMeld
    );
    s.ok('副露：识别碰碰和', (honorWin.patterns || []).indexOf('碰碰和') !== -1, JSON.stringify(honorWin.patterns));
    s.ok('副露：识别字一色', (honorWin.patterns || []).indexOf('字一色') !== -1, JSON.stringify(honorWin.patterns));
    s.eq('副露：碰碰和 + 字一色 6 番', honorWin.fan, 6);

    const fourCopyPairs = evalHand([
      '1m', '1m', '1m', '1m', '2m', '2m', '3m', '3m',
      '4m', '4m', '5p', '5p', '6s', '6s'
    ]);
    s.ok('七对：四张相同按两对', fourCopyPairs.win === true, JSON.stringify(fourCopyPairs));
    s.eq('七对：2 番 + 门清 1 番', fourCopyPairs.fan, 3);

    const orphans = evalHand([
      '1m', '9m', '1p', '9p', '1s', '9s',
      '1z', '2z', '3z', '4z', '5z', '6z', '7z', '7z'
    ]);
    s.ok('十三幺：可和', orphans.win === true, JSON.stringify(orphans));
    s.eq('十三幺：5 番（含门清）', orphans.fan, 5);
    s.eq('十三幺：600 分', orphans.points, 600);

    const wrongCount = evalHand(
      ['4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '5s', '5s', '6s'],
      CHI_MELD
    );
    s.eq('副露：暗手张数必须匹配', wrongCount.win, false);
  });

  await s.group('scoring: fan and points', async () => {
    if (!scoreHand) {
      s.skip('score contract', 'missing scoreHand');
      return;
    }
    const standard = scoreHand(STANDARD_WIN);
    s.eq('计分：标准型 2 番', standard.han, 2);
    s.eq('计分：底分 100 + 2 番 = 300', standard.points, 300);
    s.ok('计分：列出平和', (standard.yaku || []).indexOf('平和') !== -1, JSON.stringify(standard.yaku));
    s.ok('计分：列出门清', (standard.yaku || []).indexOf('门清') !== -1, JSON.stringify(standard.yaku));

    const withMeld = scoreHand(
      ['4m', '5m', '6m', '7m', '8m', '9m', '1m', '2m', '3m', '5m', '5m'],
      { melds: CHI_MELD }
    );
    s.eq('计分：清一色平和 3 番', withMeld.han, 3);
    s.eq('计分：3 番 = 400', withMeld.points, 400);

    const loss = scoreHand(NOT_WIN);
    s.eq('计分：非和牌 0 分', loss.points, 0);
  });

  await s.group('tsumo, ron and claim priority', async () => {
    if (!createGame || !gameDiscard || !selfDraw || !claimWin || !currentOffer) {
      s.skip('win-flow contract', 'missing selfDrawWin/claimWin');
      return;
    }
    const tsumoState = controlled(0, [STANDARD_WIN.slice(), FILLER.slice(), FILLER.slice(), FILLER.slice()]);
    tsumoState.lastDrawn = { player: 0, tile: STANDARD_WIN[STANDARD_WIN.length - 1] };
    const tsumo = selfDraw(tsumoState, 0);
    s.ok('自摸：执行成功', tsumo.ok === true, JSON.stringify(tsumo));
    s.eq('自摸：结果类型 tsumo', tsumo.result && tsumo.result.type, 'tsumo');
    s.eq('自摸：2 番 300 分', tsumo.result && tsumo.result.points, 300);
    s.eq('自摸：本局结束', tsumoState.phase, 'ended');

    const badTsumo = controlled(0, [NOT_WIN.slice(), FILLER.slice(), FILLER.slice(), FILLER.slice()]);
    badTsumo.lastDrawn = { player: 0, tile: NOT_WIN[NOT_WIN.length - 1] };
    s.eq('自摸：未成和不能和', selfDraw(badTsumo, 0).code, 'E_WIN');

    const ronState = controlled(3, [
      STANDARD_WIN.slice(0, 13),
      FILLER.slice(),
      FILLER.slice(),
      ['5s'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(ronState, '5s');
    const offer = currentOffer(ronState);
    s.eq('点炮：1 号位可以荣和', offer && offer.player, 0);
    s.ok('点炮：动作包含 win', actionsOf(offer).indexOf('win') !== -1, JSON.stringify(actionsOf(offer)));
    const ron = claimWin(ronState, 0);
    s.ok('点炮：执行成功', ron.ok === true, JSON.stringify(ron));
    s.eq('点炮：结果类型 ron', ron.result && ron.result.type, 'ron');
    s.eq('点炮：放铳者是 4 号位', ron.result && ron.result.from, 3);
    s.eq('点炮：2 番 300 分', ron.result && ron.result.points, 300);

    const priority = controlled(3, [
      FILLER.slice(),
      ['5s', '5s'].concat(FILLER.slice(0, 11)),
      STANDARD_WIN.slice(0, 13),
      ['5s'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(priority, '5s');
    s.eq('鸣牌优先级：荣和排第一', priority.claimOffers[0] && priority.claimOffers[0].player, 2);
    s.ok('鸣牌优先级：第一家动作是 win', actionsOf(priority.claimOffers[0]).indexOf('win') !== -1);
    s.eq('鸣牌优先级：碰排第二', priority.claimOffers[1] && priority.claimOffers[1].player, 1);
    const passed = claimPass(priority, 2);
    s.ok('鸣牌优先级：荣和者可以过', passed.ok === true, JSON.stringify(passed));
    s.eq('鸣牌优先级：过牌后轮到碰', currentOffer(priority) && currentOffer(priority).player, 1);
    s.ok('鸣牌优先级：碰可以执行', claimPong(priority, 1).ok === true);
  });

  await s.group('wall exhaustion ends in a draw', async () => {
    if (!createGame || !gameDiscard || !gameDraw) {
      s.skip('draw-flow contract', 'missing draw/discard');
      return;
    }
    const state = controlled(0, [
      ['9s'].concat(FILLER.slice(0, 13)),
      FILLER.slice(),
      FILLER.slice(),
      FILLER.slice()
    ]);
    state.wallIndex = state.wall.length;
    const result = gameDiscard(state, '9s');
    s.ok('流局：最后一张打出不抛错', result.ok === true, JSON.stringify(result));
    s.eq('流局：牌山耗尽后结束', state.phase, 'ended');
    s.eq('流局：结果类型 draw', state.result && state.result.type, 'draw');
    s.eq('流局：没有和牌者', state.result && state.result.winner, null);

    const direct = controlled(0, [FILLER.slice(), FILLER.slice(), FILLER.slice(), FILLER.slice()]);
    direct.wallIndex = direct.wall.length;
    s.eq('流局：摸牌直接返回 null', gameDraw(direct), null);
    s.eq('流局：摸牌也会结束本局', direct.phase, 'ended');
  });

  await s.group('AI: discard shape and claim decisions', async () => {
    if (!aiDiscard || !aiClaim) {
      s.skip('AI contract', 'missing chooseAiDiscard/chooseAiClaim');
      return;
    }
    const aiHand = ['5m', '5m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '9s', '7z'];
    const pick = aiDiscard(aiHand);
    s.ok('AI：优先打孤张', pick === '9s' || pick === '7z', String(pick));
    s.ok('AI：不拆刻子/对子', pick !== '5m', String(pick));

    const winState = controlled(3, [
      STANDARD_WIN.slice(0, 13),
      FILLER.slice(),
      FILLER.slice(),
      ['5s'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(winState, '5s');
    s.eq('AI：能和则和', aiClaim(winState, 0).type, 'win');

    const pongState = controlled(3, [
      FILLER.slice(),
      ['5z', '5z'].concat(FILLER.slice(0, 11)),
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(pongState, '5z');
    s.eq('AI：字牌对子会碰', aiClaim(pongState, 1).type, 'pong');

    const kongState = controlled(3, [
      FILLER.slice(),
      ['5z', '5z', '5z'].concat(FILLER.slice(0, 10)),
      FILLER.slice(),
      ['5z'].concat(FILLER.slice(0, 13))
    ]);
    gameDiscard(kongState, '5z');
    s.eq('AI：有三张会杠', aiClaim(kongState, 1).type, 'kong');

    const idle = controlled(0, [FILLER.slice(), FILLER.slice(), FILLER.slice(), FILLER.slice()]);
    s.eq('AI：没有鸣牌机会就过', aiClaim(idle, 0).type, 'pass');
  });

  await s.group('34 local tile PNG mapping', async () => {
    if (!assetOf || !Array.isArray(kinds)) {
      s.skip('tile asset contract', 'missing tileAsset/TILE_KINDS');
      return;
    }
    const names = kinds.map(function (code) { return assetOf(code); });
    s.eq('牌图：34 种文件名', new Set(names).size, 34);
    s.ok('牌图：万子映射', names.indexOf('wan-1.png') !== -1 && names.indexOf('wan-9.png') !== -1);
    s.ok('牌图：筒子映射', names.indexOf('tong-1.png') !== -1 && names.indexOf('tong-9.png') !== -1);
    s.ok('牌图：索子映射', names.indexOf('tiao-1.png') !== -1 && names.indexOf('tiao-9.png') !== -1);
    s.ok('牌图：风牌映射', names.indexOf('wind-1.png') !== -1 && names.indexOf('wind-4.png') !== -1);
    s.ok('牌图：箭牌映射', names.indexOf('dragon-1.png') !== -1 && names.indexOf('dragon-3.png') !== -1);
    const missing = names.filter(function (name) {
      return !fs.existsSync(new URL('../assets/cardart/mahjong/' + name, import.meta.url));
    });
    s.eq('牌图：文件全部存在', missing, []);
  });
});
