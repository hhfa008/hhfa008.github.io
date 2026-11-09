'use strict';

/*
 * Playable page for the Pokemon-style card battle sample.
 *
 * Engine: ../app/cardgame.js through ./card-engine-adapter.mjs (the single
 * engine also used by the tests). This page only handles presentation, input
 * and a very small opponent loop. No network requests, no external assets.
 *
 * Exposed for the CDP smoke test:
 *   window.__battle.getState()
 *   window.__battle.isBusy()
 */

import {
  createBattle,
  getState,
  drawCard,
  playCard,
  attachEnergy,
  attack,
  resolveAttack,
  knockOut,
  takePrize,
  endTurn
} from './card-engine-adapter.mjs';
import { createAudioManager } from '../app/audio.js';
import { createDealAnimation } from '../app/physics.js';
import { createResultTracker, newMatchId, shareOrCopy, trophyLabel } from './retention-result.mjs';
import {
  SAMPLE_CARDS,
  SAMPLE_RULES,
  TYPE_LABELS,
  STAGE_LABELS,
  buildSampleDeck
} from './cards.mjs';

const PLAYER = 0;
const OPPONENT = 1;
const INITIAL_SEED = 20261110;
const AI_STEP_DELAY = 170;

const TYPE_COLORS = {
  colorless: '#94a3b8',
  fire: '#ef4444',
  water: '#3b82f6',
  grass: '#22c55e',
  lightning: '#eab308',
  psychic: '#a855f7',
  fighting: '#b45309',
  darkness: '#475569',
  metal: '#64748b',
  fairy: '#ec4899',
  dragon: '#0d9488'
};

const CARD_BY_ID = new Map(SAMPLE_CARDS.map(function (card) { return [card.id, card]; }));

const dom = {};
let game = null;
let selectedId = null;
let aiBusy = false;
let attachedTurn = -1;
let announcedResult = false;
let audioReady = false;
let accessor = null;
let resultTracker = null;
let currentMatchId = '';
let matchStartedAt = 0;
let actionCount = 0;
let matchRecorded = false;

function $(id) {
  return document.getElementById(id);
}

function cacheDom() {
  [
    'turn-indicator', 'room-context', 'btn-sound', 'btn-reset',
    'opp-counts', 'opp-active', 'opp-bench', 'opp-hand', 'opp-hand-count', 'opp-prize-count', 'opp-deck-count',
    'my-counts', 'my-active', 'my-bench', 'my-hand', 'my-prize-count', 'my-deck-count', 'my-discard-count',
    'btn-draw', 'btn-end', 'selection-actions', 'btn-active', 'btn-bench', 'btn-energy',
    'attacks', 'status', 'log',
    'result-panel', 'result-title', 'rr-summary', 'rr-points', 'rr-level', 'rr-level-title',
    'rr-streak', 'rr-levelup', 'rr-daily', 'rr-anti', 'rr-board', 'rr-device',
    'rr-trophies', 'rr-share', 'rr-claim', 'rr-status'
  ].forEach(function (id) { dom[id] = $(id); });
}

function stateOf() {
  if (!game) return null;
  try {
    return getState(game);
  } catch (err) {
    return null;
  }
}

/* Rooms hand matches over as ?room=<roomId>&player=<playerId>. The match is
 * still fully local; this context is display-only and is exposed for E2E. */
function readRoomContext() {
  if (typeof window === 'undefined' || !window.location) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room') || '';
    const playerId = params.get('player') || '';
    if (!roomId && !playerId) return null;
    return { roomId: roomId, playerId: playerId };
  } catch (err) {
    return null;
  }
}

function playerName(index) {
  return index === PLAYER ? '你' : '对手';
}

function typeColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.colorless;
}

function cardName(id) {
  const card = CARD_BY_ID.get(id);
  return card ? card.name : String(id || '未知卡');
}

function isPokemon(card) {
  return Boolean(card && card.category === 'pokemon');
}

function isBasic(card) {
  return isPokemon(card) && card.stage === 'basic';
}

function isEnergy(card) {
  return Boolean(card && card.category === 'energy');
}

function setStatus(text, kind) {
  if (!dom.status) return;
  dom.status.textContent = text || '';
  dom.status.className = 'status' + (kind ? ' ' + kind : '');
}

function errorText(err) {
  if (!err) return '操作失败';
  const code = err.code ? '[' + err.code + '] ' : '';
  return code + (err.message || String(err));
}

function handleError(err, sound) {
  setStatus(errorText(err), 'error');
  if (sound !== false) sfx('error');
}

/* ------------------------------------------------------------------ */
/* Audio                                                              */
/* ------------------------------------------------------------------ */

accessor = createAudioManager({ volume: 0.55 });

function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    accessor.init();
    accessor.unlock();
  } catch (err) {
    audioReady = false;
  }
}

function sfx(name) {
  if (!audioReady) return;
  try { accessor.play(name); } catch (err) { /* sound is optional */ }
}

function updateSoundButton() {
  if (!dom['btn-sound']) return;
  const muted = accessor.isMuted();
  dom['btn-sound'].textContent = muted ? '🔇' : '🔊';
  dom['btn-sound'].setAttribute('aria-pressed', muted ? 'false' : 'true');
  dom['btn-sound'].setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
}

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                  */
/* ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderActive(container, mon, label) {
  container.textContent = '';
  if (!mon) {
    const empty = el('div', 'active-card empty', label + '出战区为空');
    container.appendChild(empty);
    return;
  }
  const card = el('div', 'active-card');
  card.style.setProperty('--type-color', typeColor(mon.type));
  card.appendChild(el('span', 'card-name', mon.name || cardName(mon.id)));
  card.appendChild(el('span', 'card-meta',
    (TYPE_LABELS[mon.type] || mon.type || '无色') + ' · 能量 ' + (mon.energies ? mon.energies.length : 0)));
  card.appendChild(el('span', 'card-hp',
    'HP ' + Math.max(0, mon.hp == null ? mon.maxHp : mon.hp) + '/' + (mon.maxHp || mon.hp || 0)));
  const bar = el('div', 'hpbar');
  const fill = el('span');
  const ratio = mon.maxHp ? Math.max(0, Math.min(1, (mon.hp == null ? mon.maxHp : mon.hp) / mon.maxHp)) : 0;
  fill.style.width = Math.round(ratio * 100) + '%';
  if (ratio <= 0.3) fill.style.background = 'var(--danger)';
  bar.appendChild(fill);
  card.appendChild(bar);
  if (mon.knockedOut) {
    card.appendChild(el('span', 'card-hp', '已倒下'));
  }
  container.appendChild(card);
}

function renderBench(container, bench, slots) {
  container.textContent = '';
  const list = Array.isArray(bench) ? bench : [];
  for (let i = 0; i < slots; i += 1) {
    const mon = list[i];
    if (!mon) {
      container.appendChild(el('div', 'bench-slot empty', '空位'));
      continue;
    }
    const cell = el('div', 'bench-slot');
    cell.style.setProperty('--type-color', typeColor(mon.type));
    cell.appendChild(el('span', 'bench-name', mon.name || cardName(mon.id)));
    cell.appendChild(el('span', null, 'HP ' + Math.max(0, mon.hp) + '/' + (mon.maxHp || mon.hp)));
    cell.appendChild(el('span', null, '能量 ' + (mon.energies ? mon.energies.length : 0)));
    container.appendChild(cell);
  }
}

function renderHandbacks(container, count) {
  container.textContent = '';
  const total = Math.max(0, Number(count) || 0);
  for (let i = 0; i < total; i += 1) container.appendChild(el('span', 'card-back'));
}

function renderHand(hand, disabled) {
  dom['my-hand'].textContent = '';
  if (!Array.isArray(hand) || hand.length === 0) {
    dom['my-hand'].appendChild(el('p', 'status', '手牌为空'));
    return;
  }
  for (const card of hand) {
    const button = el('button', 'card');
    button.type = 'button';
    button.setAttribute('role', 'listitem');
    button.dataset.cardId = card.id;
    button.dataset.category = card.category || '';
    button.dataset.stage = card.stage || '';
    button.setAttribute('aria-pressed', selectedId === card.id ? 'true' : 'false');
    button.style.setProperty('--type-color', typeColor(card.type));
    if (disabled) button.disabled = true;
    button.appendChild(el('span', 'card-name', card.name || cardName(card.id)));
    let meta = TYPE_LABELS[card.type] || card.type || '';
    if (card.category === 'pokemon') meta += ' · ' + (STAGE_LABELS[card.stage] || card.stage || '');
    if (card.category === 'energy') meta += ' · 能量';
    button.appendChild(el('span', 'card-meta', meta));
    if (isPokemon(card)) button.appendChild(el('span', 'card-hp', (card.hp || 0) + ' HP'));
    button.addEventListener('click', function () { selectCard(card.id); });
    dom['my-hand'].appendChild(button);
  }
}

function renderAttacks(state) {
  dom.attacks.textContent = '';
  const me = state.players[PLAYER];
  const mon = me && me.active;
  if (!mon || mon.knockedOut || state.currentPlayer !== PLAYER || state.status !== 'active' || aiBusy) {
    if (mon && mon.knockedOut) dom.attacks.appendChild(el('p', 'status', '出战宝可梦已倒下，结束回合后由对手行动。'));
    return;
  }
  if (!Array.isArray(mon.attacks) || mon.attacks.length === 0) {
    dom.attacks.appendChild(el('p', 'status', '这个宝可梦没有招式。'));
    return;
  }
  const hasEnergy = Array.isArray(mon.energies) && mon.energies.length > 0;
  mon.attacks.forEach(function (move, index) {
    const button = el('button', 'attack');
    button.type = 'button';
    button.dataset.index = String(index);
    button.appendChild(el('span', null, move.name || ('招式 ' + (index + 1))));
    const cost = Array.isArray(move.cost) && move.cost.length
      ? move.cost.map(function (type) { return TYPE_LABELS[type] || type; }).join(' + ')
      : '无';
    button.appendChild(el('span', 'attack-cost', '费用：' + cost + ' · 伤害 ' + (move.damage || 0)));
    button.disabled = !hasEnergy;
    button.title = hasEnergy ? '使用这个招式' : '先给出战宝可梦附着 1 个能量';
    button.addEventListener('click', function () { useAttack(index); });
    dom.attacks.appendChild(button);
  });
  if (!hasEnergy) {
    dom.attacks.appendChild(el('p', 'status', '先选择一张能量卡并点击「附着能量」。'));
  }
}

function selectionInfo(state) {
  if (!selectedId) return null;
  const me = state.players[PLAYER];
  const card = (me.hand || []).find(function (entry) { return entry.id === selectedId; });
  if (!card) return null;
  return { card: card, me: me };
}

function renderSelection(state) {
  const info = selectionInfo(state);
  const row = dom['selection-actions'];
  if (!info) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  const card = info.card;
  const me = info.me;
  const canPlay = state.currentPlayer === PLAYER && state.status === 'active' && !aiBusy;

  const activeBtn = dom['btn-active'];
  const benchBtn = dom['btn-bench'];
  const energyBtn = dom['btn-energy'];

  const activeFree = !me.active && isBasic(card);
  activeBtn.hidden = !isPokemon(card);
  activeBtn.disabled = !canPlay || !activeFree;
  activeBtn.title = me.active ? '出战区已有宝可梦（进化暂未支持）' : '将基础宝可梦放入出战区';

  const benchFree = isBasic(card) && (me.bench || []).length < SAMPLE_RULES.benchSize;
  benchBtn.hidden = !isPokemon(card);
  benchBtn.disabled = !canPlay || !benchFree;
  benchBtn.title = (me.bench || []).length >= SAMPLE_RULES.benchSize ? '备战区已满' : '放入备战区';

  energyBtn.hidden = !isEnergy(card);
  const alreadyAttached = attachedTurn === state.turn;
  energyBtn.disabled = !canPlay || !me.active || alreadyAttached;
  energyBtn.title = !me.active ? '没有出战宝可梦' :
    (alreadyAttached ? '本回合已经附着过能量' : '附着到出战宝可梦');
}

function renderLog(state) {
  dom.log.textContent = '';
  const entries = Array.isArray(state.log) ? state.log.slice(-60).reverse() : [];
  for (const entry of entries) {
    const item = el('li', null, describeLog(entry));
    if (entry.type === 'attack' || entry.type === 'ko' || entry.type === 'knockOut') item.className = 'attack';
    if (entry.type === 'take-prize') item.className = 'ko';
    dom.log.appendChild(item);
  }
}

function describeLog(entry) {
  const who = playerName(entry.player);
  switch (entry.type) {
    case 'setup': return '对局开始（牌库 60 / 起手 7 / 奖赏 6）';
    case 'draw': return who + ' 抽了 ' + (entry.count || 1) + ' 张牌';
    case 'play-card': return who + ' 将 ' + cardName(entry.cardId) + ' 放入' + (entry.target === 'bench' ? '备战区' : '出战区');
    case 'attach-energy': return who + ' 给 ' + cardName(entry.targetId) + ' 附着了 ' + cardName(entry.cardId);
    case 'attack': return who + ' 的 ' + cardName(entry.attackerId) + ' 使用 ' + entry.attack + '，造成 ' + entry.damage + ' 伤害' + (entry.knockedOut ? '（击倒）' : '');
    case 'resolve': return '伤害结算完成';
    case 'knockOut': return who + ' 的 ' + cardName(entry.cardId) + ' 倒下';
    case 'take-prize': return who + ' 获得 1 张奖赏卡（剩余 ' + entry.remaining + '）';
    case 'end-turn': return '回合结束，轮到' + playerName(entry.to) + '（第 ' + entry.turn + ' 回合）';
    case 'deploy-active': return who + ' 派出 ' + cardName(entry.cardId) + ' 出战';
    case 'discard': return who + ' 弃掉 ' + cardName(entry.cardId);
    default: return who + ' · ' + (entry.type || '事件');
  }
}

function winnerText(state) {
  if (!state || state.status !== 'finished') return null;
  if (state.winner === PLAYER) return '你获胜！';
  if (state.winner === OPPONENT) return '对手获胜，你输了。';
  const mine = state.players[PLAYER];
  const theirs = state.players[OPPONENT];
  if (mine.prizes.length === 0) return '你拿完了奖赏卡，获胜！';
  if (theirs.prizes.length === 0) return '对手拿完了奖赏卡，你输了。';
  return '对局结束';
}

const RESULT_LABELS = { win: '胜利', loss: '惜败', draw: '平局' };
const FLAG_REASONS = {
  'match duration below minimum': '对局时长过短',
  'action count below minimum': '有效动作数过少',
  'turn count out of range': '回合数异常',
  'invalid device id': '匿名设备标识异常',
  'score out of range': '分数超出范围',
  'flagged by leaderboard': '榜单防作弊校验未通过',
  'client authoritative score rejected': '客户端自报分数不可信'
};

function flagReasonText(reason) {
  if (!reason) return '防作弊校验未通过';
  return FLAG_REASONS[reason] || String(reason);
}

function resultFromState(state) {
  if (!state || state.status !== 'finished') return null;
  if (state.winner === PLAYER) return 'win';
  if (state.winner === OPPONENT) return 'loss';
  if (state.players[PLAYER].prizes.length === 0) return 'win';
  if (state.players[OPPONENT].prizes.length === 0) return 'loss';
  return 'draw';
}

/* Record the finished match exactly once and render the retention panel. */
function finishMatch(state, override) {
  if (matchRecorded || !resultTracker) return null;
  const extra = override || {};
  const result = extra.result || resultFromState(state) || 'draw';
  const me = state && state.players ? state.players[PLAYER] : null;
  const stats = {
    matchId: extra.matchId || currentMatchId,
    result: result,
    remainingPrizes: Number.isFinite(extra.remainingPrizes) ? extra.remainingPrizes
      : (me ? me.prizes.length : 0),
    turns: Number.isFinite(extra.turns) ? extra.turns
      : (state && Number.isFinite(state.turn) ? state.turn : 1),
    actions: Number.isFinite(extra.actions) ? extra.actions : Math.max(1, actionCount),
    durationMs: Number.isFinite(extra.durationMs) ? extra.durationMs
      : Math.max(0, Date.now() - matchStartedAt)
  };
  matchRecorded = true;
  const record = resultTracker.recordMatch(stats);
  renderResult(record);
  sfx(result === 'win' ? 'win' : (result === 'loss' ? 'lose' : 'click'));
  return record;
}

function boardList(entries) {
  const list = dom['rr-board'];
  if (!list) return;
  list.textContent = '';
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    const empty = el('li', 'rr-empty', '本机暂无记录，完成一局即可上榜。');
    list.appendChild(empty);
    return;
  }
  rows.forEach(function (entry) {
    const item = el('li', entry.self ? 'self' : null);
    item.appendChild(el('span', 'rr-rank', '#' + entry.rank));
    item.appendChild(el('span', 'rr-who', entry.label));
    item.appendChild(el('span', 'rr-score', String(entry.score)));
    list.appendChild(item);
  });
}

function dailyText(record) {
  const daily = record.daily || {};
  const missions = Array.isArray(record.missions) ? record.missions : [];
  const done = missions.filter(function (mission) { return mission.complete; }).length;
  const claimable = record.lossAversion && record.lossAversion.pendingReward != null;
  let text = '今日登录奖励 ' + (record.dailyAward > 0 ? '+' + record.dailyAward + ' 积分' : '已领取') +
    ' · 今日对局 ' + Math.max(0, daily.played || 0) + '/' + Math.max(1, daily.target || 3) +
    ' · 每日任务 ' + done + '/' + Math.max(1, missions.length || 3) + ' 完成';
  if (claimable) text += ' · 3 局奖励待领取';
  return text;
}

function renderResult(record) {
  const panel = dom['result-panel'];
  if (!panel || !record) return;
  panel.hidden = false;

  const result = record.breakdown ? record.breakdown.result : 'draw';
  if (dom['result-title']) dom['result-title'].textContent = '本局' + (RESULT_LABELS[result] || '结束');
  if (dom['rr-summary']) {
    if (record.duplicate) {
      dom['rr-summary'].textContent = '本局已经记录过，不重复计分。';
    } else if (record.breakdown) {
      const parts = record.breakdown.parts.length ? '（' + record.breakdown.parts.join('，') + '）' : '';
      dom['rr-summary'].textContent = '本局积分 +' + record.points + parts + '。';
    }
  }
  if (dom['rr-points']) dom['rr-points'].textContent = '+' + Math.max(0, record.points || 0);
  if (dom['rr-level']) dom['rr-level'].textContent = String(record.level || 1);
  if (dom['rr-level-title']) dom['rr-level-title'].textContent = record.levelTitle || '';
  if (dom['rr-streak']) dom['rr-streak'].textContent = String(record.streak || 0);
  if (dom['rr-daily']) dom['rr-daily'].textContent = dailyText(record);

  if (dom['rr-levelup']) {
    const levelUp = Boolean(record.levelUp) && !record.duplicate;
    dom['rr-levelup'].hidden = !levelUp;
    if (levelUp) {
      dom['rr-levelup'].textContent = '晋级！Lv.' + record.levelFrom + ' → Lv.' + record.levelTo +
        ' · ' + (record.levelTitle || '');
      dom['rr-levelup'].classList.remove('flash');
      void dom['rr-levelup'].offsetWidth;
      dom['rr-levelup'].classList.add('flash');
    }
  }

  if (dom['rr-anti']) {
    const warn = record.duplicate || record.flagged;
    dom['rr-anti'].hidden = !warn;
    dom['rr-anti'].textContent = record.duplicate
      ? '本局成绩已提交过，不重复入榜。'
      : (record.flagged
        ? '本局成绩未计入：' + flagReasonText(record.flagReason) + '（本机积分仍保留）。'
        : '');
  }

  if (dom['rr-trophies']) {
    const unlocked = Array.isArray(record.newTrophies) ? record.newTrophies : [];
    dom['rr-trophies'].hidden = unlocked.length === 0 || record.duplicate;
    dom['rr-trophies'].textContent = unlocked.length
      ? '解锁奖杯：' + unlocked.map(trophyLabel).join('、')
      : '';
  }

  boardList(record.board);
  if (dom['rr-device']) {
    dom['rr-device'].textContent = '匿名设备 ' + (record.deviceShort || '匿名') +
      ' · 仅本机匿名记录 · 本地排行榜，清除浏览器缓存即重置';
  }

  if (dom['rr-claim']) {
    const pending = record.lossAversion && record.lossAversion.pendingReward != null;
    const completed = record.daily && record.daily.completed;
    dom['rr-claim'].disabled = !pending;
    dom['rr-claim'].textContent = pending
      ? '领取每日奖励 +' + record.lossAversion.pendingReward
      : (completed ? '今日奖励已领取' : '打满 3 局可领奖励');
  }

  if (dom['rr-status']) {
    dom['rr-status'].textContent = '本局' + (RESULT_LABELS[result] || '结束') +
      (record.duplicate ? '（已记录）' : '，+' + Math.max(0, record.points || 0) + ' 积分') +
      (record.rank ? '，本机名次第 ' + record.rank + ' 名。' : '。');
  }
}

async function shareCurrentResult() {
  if (!resultTracker) return;
  if (dom['rr-status']) dom['rr-status'].textContent = '正在准备分享…';
  const payload = resultTracker.lastShare();
  const outcome = await shareOrCopy(payload, { location: window.location });
  if (!dom['rr-status']) return;
  if (outcome.method === 'share') {
    dom['rr-status'].textContent = '已调起系统分享。';
  } else if (outcome.method === 'copy') {
    dom['rr-status'].textContent = '分享文案已复制：' + payload.text;
  } else if (outcome.method === 'manual') {
    dom['rr-status'].textContent = '请手动复制：' + outcome.text;
  }
}

function claimDailyReward() {
  if (!resultTracker) return;
  const claimed = resultTracker.claimDailyReward();
  if (!dom['rr-status']) return;
  if (claimed.ok) {
    dom['rr-status'].textContent = '每日奖励领取成功，+' + claimed.points + ' 积分。';
    if (dom['rr-claim']) {
      dom['rr-claim'].disabled = true;
      dom['rr-claim'].textContent = '今日奖励已领取';
    }
    if (claimed.levelUp && dom['rr-level']) dom['rr-level'].textContent = String(claimed.level);
  } else if (claimed.code === 'E_NOT_DONE') {
    dom['rr-status'].textContent = '还没打满今日目标，继续加油。';
  } else if (claimed.code === 'E_EXPIRED') {
    dom['rr-status'].textContent = '每日奖励已过期，明天再来。';
  } else {
    dom['rr-status'].textContent = '今日奖励已经领取过了。';
  }
}

function render() {
  const state = stateOf();
  if (!state) return;
  const me = state.players[PLAYER];
  const opp = state.players[OPPONENT];
  const winner = winnerText(state);

  if (dom['turn-indicator']) {
    if (winner) dom['turn-indicator'].textContent = winner;
    else if (aiBusy) dom['turn-indicator'].textContent = '对手思考中…';
    else if (state.currentPlayer === PLAYER) dom['turn-indicator'].textContent = '你的回合 · 第 ' + state.turn + ' 回合';
    else dom['turn-indicator'].textContent = '对手回合 · 第 ' + state.turn + ' 回合';
  }

  dom['opp-counts'].textContent = '手牌 ' + opp.hand.length + ' · 奖赏 ' + opp.prizes.length + ' · 牌库 ' + opp.deck.length;
  dom['my-counts'].textContent = '手牌 ' + me.hand.length + ' · 奖赏 ' + me.prizes.length + ' · 牌库 ' + me.deck.length;
  dom['opp-hand-count'].textContent = String(opp.hand.length);
  dom['opp-prize-count'].textContent = String(opp.prizes.length);
  dom['opp-deck-count'].textContent = String(opp.deck.length);
  dom['my-prize-count'].textContent = String(me.prizes.length);
  dom['my-deck-count'].textContent = String(me.deck.length);
  dom['my-discard-count'].textContent = String(me.discard.length);

  renderActive(dom['opp-active'], opp.active, '对手');
  renderActive(dom['my-active'], me.active, '你的');
  renderBench(dom['opp-bench'], opp.bench, SAMPLE_RULES.benchSize);
  renderBench(dom['my-bench'], me.bench, SAMPLE_RULES.benchSize);
  renderHandbacks(dom['opp-hand'], opp.hand.length);

  const handDisabled = aiBusy || state.currentPlayer !== PLAYER || state.status !== 'active';
  renderHand(me.hand, handDisabled);
  renderSelection(state);
  renderAttacks(state);

  const canAct = !aiBusy && state.status === 'active' && state.currentPlayer === PLAYER && !winner;
  dom['btn-draw'].disabled = !canAct;
  dom['btn-end'].disabled = !canAct;
  renderLog(state);

  if (winner && !announcedResult) {
    announcedResult = true;
    finishMatch(state);
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

function selectCard(cardId) {
  ensureAudio();
  selectedId = selectedId === cardId ? null : cardId;
  sfx('select');
  setStatus('');
  render();
}

function playSelected(target) {
  ensureAudio();
  if (!selectedId) return;
  try {
    playCard(game, PLAYER, selectedId, { target: target });
    actionCount += 1;
    sfx('play');
    setStatus('已放入' + (target === 'bench' ? '备战区' : '出战区') + '。', 'good');
    selectedId = null;
    render();
  } catch (err) {
    handleError(err);
    render();
  }
}

function attachSelected() {
  ensureAudio();
  if (!selectedId) return;
  const state = stateOf();
  const me = state && state.players[PLAYER];
  if (!me || !me.active) {
    setStatus('没有出战宝可梦可以附着能量。', 'error');
    return;
  }
  try {
    attachEnergy(game, PLAYER, selectedId, me.active.id);
    attachedTurn = state.turn;
    actionCount += 1;
    sfx('energy');
    setStatus('能量已附着。', 'good');
    selectedId = null;
    render();
  } catch (err) {
    handleError(err);
    render();
  }
}

function useAttack(index) {
  ensureAudio();
  try {
    attack(game, PLAYER, index);
    resolveAttack(game);
    actionCount += 1;
    sfx('attack');
    sfx('hit');
    let state = stateOf();
    const defender = state && state.players[OPPONENT];
    if (defender && defender.active && defender.active.knockedOut) {
      sfx('ko');
      try { knockOut(game, OPPONENT); } catch (err) { /* already removed */ }
      try { takePrize(game, PLAYER); } catch (err) { /* no prizes */ }
      setStatus('击倒对手宝可梦，获得 1 张奖赏卡！', 'good');
    } else {
      setStatus('攻击完成。', 'good');
    }
    render();
  } catch (err) {
    handleError(err);
    render();
  }
}

function doDraw() {
  ensureAudio();
  try {
    drawCard(game, PLAYER);
    actionCount += 1;
    sfx('draw');
    setStatus('抽了 1 张牌。', 'good');
    render();
  } catch (err) {
    handleError(err);
    render();
  }
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function findBasicInHand(hand) {
  return (hand || []).find(function (card) { return isBasic(card); }) || null;
}

async function runOpponentTurn() {
  aiBusy = true;
  setStatus('对手回合…');
  render();
  try {
    await delay(AI_STEP_DELAY);
    try { drawCard(game, OPPONENT); } catch (err) { /* empty deck ends the match */ }
    render();
    await delay(AI_STEP_DELAY);

    let state = stateOf();
    let opp = state.players[OPPONENT];
    if (!opp.active) {
      let basic = findBasicInHand(opp.hand);
      let guard = 0;
      while (!basic && guard < 8) {
        try { drawCard(game, OPPONENT); } catch (err) { break; }
        state = stateOf();
        opp = state.players[OPPONENT];
        basic = findBasicInHand(opp.hand);
        guard += 1;
      }
      if (basic) {
        try { playCard(game, OPPONENT, basic.id, { target: 'active' }); sfx('play'); } catch (err) { /* keep going */ }
        render();
        await delay(AI_STEP_DELAY);
      }
    }

    state = stateOf();
    opp = state.players[OPPONENT];
    if (opp.active && !attachedTurnForOpponent(state)) {
      const energy = opp.hand.find(isEnergy);
      if (energy) {
        try {
          attachEnergy(game, OPPONENT, energy.id, opp.active.id);
          sfx('energy');
        } catch (err) { /* keep going */ }
        render();
        await delay(AI_STEP_DELAY);
      }
    }

    state = stateOf();
    opp = state.players[OPPONENT];
    const challenger = state.players[PLAYER];
    if (opp.active && opp.active.energies.length > 0 && !opp.attacksThisTurn &&
      state.status === 'active') {
      try {
        attack(game, OPPONENT, 0);
        resolveAttack(game);
        sfx('attack');
        sfx('hit');
        const after = stateOf();
        if (after.players[PLAYER].active && after.players[PLAYER].active.knockedOut) {
          sfx('ko');
          try { knockOut(game, PLAYER); } catch (err) { /* ignore */ }
          try { takePrize(game, OPPONENT); } catch (err) { /* ignore */ }
        }
        render();
        await delay(AI_STEP_DELAY);
      } catch (err) {
        // no legal attack: fall through to end turn
      }
    }
    void challenger;
  } catch (err) {
    handleError(err, false);
  }

  const state = stateOf();
  if (state && state.status === 'active') {
    try { endTurn(game, OPPONENT); } catch (err) { /* ignore */ }
  }
  attachedTurn = -1;
  aiBusy = false;
  render();
}

/* The engine tracks attacksThisTurn but not energy, so the page keeps the
 * one-energy-per-turn rule itself. The opponent attaches exactly once per
 * AI turn, so this helper only documents the intent. */
function attachedTurnForOpponent() {
  return false;
}

function endMyTurn() {
  ensureAudio();
  const state = stateOf();
  if (!state || state.currentPlayer !== PLAYER || state.status !== 'active' || aiBusy) return;
  try {
    endTurn(game, PLAYER);
    actionCount += 1;
    attachedTurn = -1;
    selectedId = null;
    sfx('click');
    render();
  } catch (err) {
    handleError(err);
    render();
    return;
  }
  runOpponentTurn();
}

function newGame(seed) {
  try {
    game = createBattle({
      deck: buildSampleDeck(),
      cardPool: SAMPLE_CARDS,
      rules: SAMPLE_RULES,
      players: 2,
      seed: seed == null ? INITIAL_SEED : seed
    });
    selectedId = null;
    aiBusy = false;
    attachedTurn = -1;
    announcedResult = false;
    matchRecorded = false;
    currentMatchId = newMatchId();
    matchStartedAt = Date.now();
    actionCount = 0;
    if (dom['result-panel']) dom['result-panel'].hidden = true;
    if (dom['rr-status']) dom['rr-status'].textContent = '';
    setStatus('对局开始：点击手牌选择，再选择出战/后备/附着能量。');
    render();
    animateDeal();
  } catch (err) {
    game = null;
    handleError(err, false);
  }
}

function animateDeal() {
  if (typeof window === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cards = Array.prototype.slice.call(dom['my-hand'].querySelectorAll('.card'));
  if (cards.length === 0) return;
  const animation = createDealAnimation({ cards: cards, duration: 0.34, stagger: 0.045 });
  cards.forEach(function (node) {
    node.style.opacity = '0.25';
    node.style.transform = 'translateY(10px)';
  });
  let previous = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    const snapshot = animation.step(dt);
    snapshot.cards.forEach(function (cardState, index) {
      const node = cards[index];
      if (!node) return;
      node.style.opacity = String(0.25 + 0.75 * cardState.progress);
      node.style.transform = 'translateY(' + ((1 - cardState.progress) * 10).toFixed(2) + 'px)';
    });
    if (snapshot.settled) {
      cards.forEach(function (node) {
        node.style.opacity = '';
        node.style.transform = '';
      });
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function bind() {
  dom['btn-draw'].addEventListener('click', doDraw);
  dom['btn-end'].addEventListener('click', endMyTurn);
  dom['btn-active'].addEventListener('click', function () { playSelected('active'); });
  dom['btn-bench'].addEventListener('click', function () { playSelected('bench'); });
  dom['btn-energy'].addEventListener('click', attachSelected);
  dom['btn-reset'].addEventListener('click', function () {
    ensureAudio();
    sfx('click');
    newGame(Date.now() % 2147483647);
  });
  dom['btn-sound'].addEventListener('click', function () {
    ensureAudio();
    accessor.setMuted(!accessor.isMuted());
    updateSoundButton();
    sfx('click');
  });
  if (dom['rr-share']) {
    dom['rr-share'].addEventListener('click', function () {
      shareCurrentResult().catch(function () {
        if (dom['rr-status']) dom['rr-status'].textContent = '分享失败，请稍后重试。';
      });
    });
  }
  if (dom['rr-claim']) dom['rr-claim'].addEventListener('click', claimDailyReward);
  document.addEventListener('pointerdown', ensureAudio, { once: true, passive: true });
  document.addEventListener('keydown', ensureAudio, { once: true });
}

function start() {
  cacheDom();
  resultTracker = createResultTracker({ gameId: 'card-battle' });
  bind();
  updateSoundButton();
  newGame(INITIAL_SEED);
  const roomContext = readRoomContext();
  if (roomContext) {
    if (dom['room-context']) {
      dom['room-context'].hidden = false;
      dom['room-context'].textContent = '房间 ' + (roomContext.roomId || '—') +
        ' · 玩家 ' + (roomContext.playerId || '—');
    }
    setStatus('已从房间 ' + (roomContext.roomId || '—') + ' 进入对局。', 'good');
  }
  window.__battle = {
    getState: function () { return stateOf(); },
    isBusy: function () { return aiBusy; },
    room: roomContext,
    // Smoke/demo hook: records a finished match through the same result path.
    finishForTest: function (result, extra) {
      const state = stateOf();
      const override = Object.assign({}, extra || {}, { result: result });
      if (state) state.status = 'finished';
      announcedResult = true;
      return finishMatch(state, override);
    },
    snapshot: function () { return resultTracker ? resultTracker.snapshot() : null; },
    seed: INITIAL_SEED
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
