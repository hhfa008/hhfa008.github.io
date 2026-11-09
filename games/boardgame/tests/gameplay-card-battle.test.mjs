'use strict';

/*
 * L2 contract: card-battle minimal loop.
 *
 * Canonical contract (owned by C, see engine/card-battle.js and
 * tests/card-battle.test.js):
 *   20-card deck / 5-card opening hand / first to 3 points wins.
 *
 * This suite supersedes the earlier 60/7/6 Pokemon-TCG fixture assertions from
 * boardgame/50bdc849. It drives the real engine directly and checks the
 * 20/5/3 numbers plus play -> energy -> attack -> KO -> score -> win.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';

const require = createRequire(import.meta.url);
const CB = require(path.join(ROOT, 'engine', 'card-battle.js'));
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cards.json'), 'utf8'));
const byId = new Map(cards.map(function (card) { return [card.id, card]; }));

const SIDES = ['player', 'ai'];
const s = createSuite('boardgame-gameplay-card-battle');

function playerOf(state, side) {
  return state.sides[side];
}

function cardCount(state) {
  return state.sides.player.hand.length + state.sides.player.deck.length +
    state.sides.ai.hand.length + state.sides.ai.deck.length;
}

function legalHas(state, side, action) {
  return CB.legalActions(state, side).some(function (candidate) {
    return candidate.type === action.type &&
      candidate.cardId === action.cardId &&
      candidate.target === action.target &&
      candidate.attacker === action.attacker &&
      candidate.attackIndex === action.attackIndex;
  });
}

function fieldMon(cardId, energy, hp) {
  const def = byId.get(cardId);
  return {
    uid: 100 + Math.floor(Math.random() * 1000),
    id: cardId,
    hp: hp == null ? def.hp : hp,
    maxHp: def.hp,
    energy: energy || 0
  };
}

function blankSide(overrides) {
  return Object.assign({
    deck: [],
    hand: [],
    discard: [],
    field: [],
    score: 0,
    usedEnergy: false,
    playedPokemon: false,
    usedItem: false,
    attacked: false
  }, overrides || {});
}

function stateWith(cardsById, player, ai) {
  return {
    version: 1,
    seed: 1,
    turn: 'player',
    turnNumber: 1,
    winner: null,
    uidCounter: 2000,
    cards: cardsById,
    log: [],
    sides: { player: player, ai: ai }
  };
}

await s.run(async () => {
  await s.group('canonical 20/5/3 constants', async () => {
    s.eq('牌库 20 张', cards.length, 20);
    s.eq('起手 5 张', CB.OPENING_HAND, 5);
    s.eq('先到 3 分获胜', CB.WIN_SCORE, 3);
    s.eq('场上上限 3 只', CB.MAX_FIELD, 3);
    s.eq('宝可梦 12 张', cards.filter(function (c) { return c.type === 'pokemon'; }).length, 12);
    s.eq('能量 6 张', cards.filter(function (c) { return c.type === 'energy'; }).length, 6);
    s.eq('道具 2 张', cards.filter(function (c) { return c.type === 'item'; }).length, 2);
  });

  let game = null;
  await s.group('setup: deck 20 / hand 5', async () => {
    try {
      game = CB.createGame({ cards: cards, seed: 20261110, firstSide: 'player', drawOnStart: false });
      s.ok('createGame 不抛错', true);
    } catch (err) {
      s.ok('createGame 不抛错', false, err && err.message ? err.message : String(err));
      return;
    }
    s.eq('先手为 player', game.turn, 'player');
    s.eq('回合数从 1 开始', game.turnNumber, 1);
    s.eq('尚无胜者', game.winner, null);
    for (const side of SIDES) {
      const p = playerOf(game, side);
      s.eq(side + ' 起手 5 张', p.hand.length, 5);
      s.eq(side + ' 牌库 15 张', p.deck.length, 15);
      s.eq(side + ' 手牌 + 牌库 = 20', p.hand.length + p.deck.length, 20);
      s.eq(side + ' 初始 0 分', p.score, 0);
      s.eq(side + ' 初始空场', p.field.length, 0);
    }
    s.eq('双方牌数合计 40（各一套 20 张）', cardCount(game), 40);
    s.eq('卡牌映射覆盖 20 张', Object.keys(game.cards).length, 20);
    s.ok('状态可 JSON 往返', JSON.stringify(JSON.parse(JSON.stringify(game))) === JSON.stringify(game));
  });

  await s.group('legal actions and play', async () => {
    if (!game) return;
    const actions = CB.legalActions(game, 'player');
    s.ok('首回合有合法动作', actions.length > 0, 'got ' + actions.length);
    const play = actions.find(function (a) { return a.type === 'playCard'; });
    s.ok('首回合可以放置宝可梦', Boolean(play));
    if (!play) return;

    const before = playerOf(game, 'player').hand.length;
    const next = CB.playCard(game, 'player', play.cardId);
    const p = playerOf(next, 'player');
    s.eq('放置后场上 1 只', p.field.length, 1);
    s.eq('放置后手牌 -1', p.hand.length, before - 1);
    s.eq('放置的卡与动作一致', p.field[0].id, play.cardId);
    s.eq('本回合已放置标记', p.playedPokemon, true);

    let failed = false;
    try { CB.playCard(next, 'player', play.cardId); } catch (err) { failed = true; }
    s.ok('同回合不能放置第二只', failed);
    game = next;
  });

  await s.group('attach energy', async () => {
    if (!game) return;
    const actions = CB.legalActions(game, 'player');
    const attach = actions.find(function (a) { return a.type === 'attachEnergy'; });
    s.ok('有能量卡时可以附着', Boolean(attach));
    if (!attach) return;
    const next = CB.attachEnergy(game, 'player', attach.cardId, attach.target);
    s.eq('目标宝可梦能量 +1', playerOf(next, 'player').field[attach.target].energy, 1);
    s.eq('本回合已附着标记', playerOf(next, 'player').usedEnergy, true);
    game = next;
  });

  await s.group('attack, KO, score and win', async () => {
    const cardsById = {};
    cards.forEach(function (c) { cardsById[c.id] = c; });
    const start = stateWith(
      cardsById,
      blankSide({
        field: [fieldMon('mon-emberfox', 1, 80)],
        score: 2,
        playedPokemon: true,
        usedEnergy: true
      }),
      blankSide({ field: [fieldMon('mon-vinebud', 0, 40)] })
    );
    const next = CB.attack(start, 'player', 0, 0, 0);
    s.eq('击倒后玩家得 3 分', playerOf(next, 'player').score, 3);
    s.eq('先到 3 分获胜', next.winner, 'player');
    s.eq('被击倒宝可梦离场', playerOf(next, 'ai').field.length, 0);
    s.eq('被击倒宝可梦进弃牌堆', playerOf(next, 'ai').discard[0], 'mon-vinebud');
    s.ok('日志记录弱点双倍伤害', next.log.some(function (line) { return /弱点 ×2/.test(line.text || ''); }),
      next.log.slice(-2).map(function (line) { return line.text; }).join(' | '));
    s.ok('重放不修改入参', start.sides.player.score === 2 && start.sides.ai.field.length === 1);
  });

  await s.group('AI self-play invariants (20 games)', async () => {
    let crashed = 0;
    let illegal = 0;
    let unfinished = 0;
    let actionsPlayed = 0;
    let games = 0;
    let winners = { player: 0, ai: 0 };

    for (let seed = 1; seed <= 20; seed += 1) {
      let state = null;
      let guard = 0;
      games += 1;
      try {
        state = CB.createGame({ cards: cards, seed: seed });
        while (!CB.winner(state) && guard < 2000) {
          const side = state.turn;
          const action = CB.aiAction(state, side);
          if (!action || !legalHas(state, side, action)) { illegal += 1; break; }
          state = CB.applyAction(state, action);
          guard += 1;
          actionsPlayed += 1;
          for (const name of SIDES) {
            const p = playerOf(state, name);
            if (p.field.length > CB.MAX_FIELD) illegal += 1;
            if (p.score < 0 || p.score >= CB.WIN_SCORE && !state.winner) illegal += 1;
          }
        }
        if (guard >= 2000) unfinished += 1;
      } catch (err) {
        crashed += 1;
      }
      const winner = state ? CB.winner(state) : null;
      if (winner === 'player' || winner === 'ai') winners[winner] += 1;
    }

    s.eq('完成 20 局', games, 20);
    s.eq('无崩溃', crashed, 0);
    s.eq('无非法动作', illegal, 0);
    s.eq('均在有限步内结束', unfinished, 0);
    s.eq('每局都有胜者', winners.player + winners.ai, 20);
    s.ok('产生了足够多的动作', actionsPlayed > 100, 'actions=' + actionsPlayed);
  });
});
