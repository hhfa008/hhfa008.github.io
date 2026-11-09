'use strict';

/*
 * Single-player mahjong UI. Drives app/mahjong.js through the play adapter;
 * no network access.
 * URL options (useful for the browser smoke run):
 *   ?players=2|3|4   seats (default 4)
 *   ?seed=123        deterministic shuffle
 *   ?delay=0         AI think delay in ms (default 320)
 *   ?test=win        deal a 13-tile ready hand, next draw wins (smoke only)
 */

import {
  TILE_KINDS,
  createGame,
  beginTurn,
  discardTile,
  canTsumo,
  canRon,
  declareTsumo,
  declareRon,
  chooseDiscard,
  remainingTiles,
  getGameState
} from './mahjong-engine-adapter.mjs';
import { createResultTracker, newMatchId, shareOrCopy, trophyLabel } from './retention-result.mjs';

const params = new URLSearchParams(window.location.search);
const TEST_WIN = params.get('test') === 'win';
const AI_DELAY = params.has('delay')
  ? Math.max(0, Math.min(5000, Number(params.get('delay')) || 0))
  : 320;

const SUIT_LABELS = { m: '万', p: '筒', s: '条' };
const HONOR_LABELS = ['', '東', '南', '西', '北', '白', '發', '中'];
const INDEX = new Map(TILE_KINDS.map((kind, index) => [kind, index]));

const el = (id) => document.getElementById(id);
const ui = {
  status: el('status'),
  wallCount: el('wallCount'),
  opponents: el('opponents'),
  rivers: el('rivers'),
  hand: el('hand'),
  hint: el('hint'),
  tsumo: el('tsumo'),
  ron: el('ron'),
  pass: el('pass'),
  newGame: el('newGame'),
  players: el('players'),
  overlay: el('overlay'),
  resultTitle: el('resultTitle'),
  resultKind: el('resultKind'),
  resultHan: el('resultHan'),
  resultPoints: el('resultPoints'),
  resultWall: el('resultWall'),
  resultYaku: el('resultYaku'),
  rrPoints: el('rr-points'),
  rrLevel: el('rr-level'),
  rrLevelTitle: el('rr-level-title'),
  rrStreak: el('rr-streak'),
  rrLevelup: el('rr-levelup'),
  rrTrophies: el('rr-trophies'),
  rrDaily: el('rr-daily'),
  rrAnti: el('rr-anti'),
  rrBoard: el('rr-board'),
  rrDevice: el('rr-device'),
  rrShare: el('rr-share'),
  rrClaim: el('rr-claim'),
  rrStatus: el('rr-status'),
  again: el('again')
};

let game = null;
let aiTimer = null;
let pendingRon = false;
let resultTracker = null;
let currentMatchId = '';
let matchStartedAt = 0;
let actionCount = 0;
let matchRecorded = false;

function parseTile(tile) {
  const rank = Number(String(tile).charAt(0));
  const suit = String(tile).charAt(1);
  return { rank, suit };
}

function labelParts(tile) {
  const parsed = parseTile(tile);
  if (parsed.suit === 'z') {
    return { rank: '', suit: HONOR_LABELS[parsed.rank] || '?', code: 'z', solo: true };
  }
  return {
    rank: String(parsed.rank),
    suit: SUIT_LABELS[parsed.suit] || '?',
    code: parsed.suit,
    solo: false
  };
}

function shortLabel(tile) {
  const parts = labelParts(tile);
  return parts.solo ? parts.suit : parts.rank + parts.suit;
}

function playerName(player) {
  return player === 0 ? '你' : '电脑' + player;
}

function makeHandTile(tile, enabled, onClick) {
  const parts = labelParts(tile);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile ' + parts.code;
  button.dataset.tile = tile;
  if (parts.solo) {
    const text = document.createElement('span');
    text.className = 'suitsolo';
    text.textContent = parts.suit;
    button.appendChild(text);
  } else {
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = parts.rank;
    const suit = document.createElement('span');
    suit.className = 'suit';
    suit.textContent = parts.suit;
    button.appendChild(rank);
    button.appendChild(suit);
  }
  button.setAttribute('aria-label', '打出' + shortLabel(tile));
  button.disabled = !enabled;
  button.addEventListener('click', onClick);
  if (!enabled) button.setAttribute('aria-disabled', 'true');
  return button;
}

function makeMiniTile(tile) {
  const parts = parseTile(tile);
  const span = document.createElement('span');
  span.className = 'mtile ' + parts.suit;
  span.textContent = parts.suit === 'z'
    ? (HONOR_LABELS[parts.rank] || '?')
    : parts.rank + (SUIT_LABELS[parts.suit] || '?');
  span.setAttribute('aria-label', shortLabel(tile));
  return span;
}

function renderRivers(g) {
  ui.rivers.textContent = '';
  for (let player = 0; player < g.players; player += 1) {
    const pile = g.discards[player] || [];
    const block = document.createElement('div');
    block.className = 'river';

    const head = document.createElement('div');
    head.className = 'river-head';
    const name = document.createElement('span');
    name.textContent = playerName(player);
    const count = document.createElement('span');
    count.textContent = pile.length + ' 张';
    head.appendChild(name);
    head.appendChild(count);
    block.appendChild(head);

    const tiles = document.createElement('div');
    tiles.className = 'river-tiles';
    if (pile.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'river-empty';
      empty.textContent = '—';
      tiles.appendChild(empty);
    } else {
      for (const tile of pile) tiles.appendChild(makeMiniTile(tile));
    }
    block.appendChild(tiles);
    ui.rivers.appendChild(block);
  }
}

function renderOpponents(g) {
  ui.opponents.textContent = '';
  for (let player = 1; player < g.players; player += 1) {
    const card = document.createElement('div');
    card.className = 'opp' + (!g.winner && g.turn === player && g.phase !== 'ended' ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = playerName(player);
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = String(g.hands[player].length);
    const unit = document.createElement('small');
    unit.textContent = ' 张手牌';
    count.appendChild(unit);
    card.appendChild(name);
    card.appendChild(count);
    ui.opponents.appendChild(card);
  }
}

function resultHeadline(result) {
  if (!result) return '本局结束';
  if (result.type === 'draw') return '流局 · 牌墙已空';
  const winner = playerName(result.winner);
  if (result.type === 'tsumo') return winner + ' 自摸';
  if (result.type === 'ron') return winner + ' 荣和 · 来自 ' + playerName(result.from);
  return '本局结束';
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

function mahjongOutcome(result) {
  if (!result || result.type === 'draw') return 'draw';
  return result.winner === 0 ? 'win' : 'loss';
}

/* Record the finished hand exactly once and fill the retention block. */
function finishMahjongMatch(result) {
  if (matchRecorded || !resultTracker) return null;
  matchRecorded = true;
  const g = game;
  const outcome = mahjongOutcome(result);
  const discards = g && Array.isArray(g.discards)
    ? g.discards.reduce(function (sum, pile) { return sum + (Array.isArray(pile) ? pile.length : 0); }, 0)
    : 0;
  const record = resultTracker.recordMatch({
    matchId: currentMatchId,
    result: outcome,
    han: result && result.han != null ? result.han : 0,
    remainingTiles: g ? remainingTiles(g) : 0,
    tsumo: Boolean(result && result.type === 'tsumo' && result.winner === 0),
    turns: Math.max(1, discards + 1),
    actions: Math.max(1, actionCount || discards + 1),
    durationMs: Math.max(0, Date.now() - matchStartedAt)
  });
  renderMahjongRetention(record, outcome);
  return record;
}

function mahjongBoardList(entries) {
  if (!ui.rrBoard) return;
  ui.rrBoard.textContent = '';
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'rr-empty';
    empty.textContent = '本机暂无记录，完成一局即可上榜。';
    ui.rrBoard.appendChild(empty);
    return;
  }
  rows.forEach(function (entry) {
    const item = document.createElement('li');
    if (entry.self) item.className = 'self';
    const rank = document.createElement('span');
    rank.className = 'rr-rank';
    rank.textContent = '#' + entry.rank;
    const who = document.createElement('span');
    who.className = 'rr-who';
    who.textContent = entry.label;
    const score = document.createElement('span');
    score.className = 'rr-score';
    score.textContent = String(entry.score);
    item.appendChild(rank);
    item.appendChild(who);
    item.appendChild(score);
    ui.rrBoard.appendChild(item);
  });
}

function renderMahjongRetention(record, outcome) {
  if (!record) return;
  if (ui.rrPoints) ui.rrPoints.textContent = '+' + Math.max(0, record.points || 0);
  if (ui.rrLevel) ui.rrLevel.textContent = String(record.level || 1);
  if (ui.rrLevelTitle) ui.rrLevelTitle.textContent = record.levelTitle || '';
  if (ui.rrStreak) ui.rrStreak.textContent = String(record.streak || 0);

  if (ui.rrLevelup) {
    const levelUp = Boolean(record.levelUp) && !record.duplicate;
    ui.rrLevelup.hidden = !levelUp;
    if (levelUp) {
      ui.rrLevelup.textContent = '晋级！Lv.' + record.levelFrom + ' → Lv.' + record.levelTo +
        ' · ' + (record.levelTitle || '');
      ui.rrLevelup.classList.remove('flash');
      void ui.rrLevelup.offsetWidth;
      ui.rrLevelup.classList.add('flash');
    }
  }

  const daily = record.daily || {};
  const missions = Array.isArray(record.missions) ? record.missions : [];
  const done = missions.filter(function (mission) { return mission.complete; }).length;
  if (ui.rrDaily) {
    ui.rrDaily.textContent = '今日登录奖励 ' +
      (record.dailyAward > 0 ? '+' + record.dailyAward + ' 积分' : '已领取') +
      ' · 今日对局 ' + Math.max(0, daily.played || 0) + '/' + Math.max(1, daily.target || 3) +
      ' · 每日任务 ' + done + '/' + Math.max(1, missions.length || 3) + ' 完成';
  }

  if (ui.rrAnti) {
    const warn = record.duplicate || record.flagged;
    ui.rrAnti.hidden = !warn;
    ui.rrAnti.textContent = record.duplicate
      ? '本局成绩已提交过，不重复入榜。'
      : (record.flagged
        ? '本局成绩未计入：' + flagReasonText(record.flagReason) + '（本机积分仍保留）。'
        : '');
  }

  if (ui.rrTrophies) {
    const unlocked = Array.isArray(record.newTrophies) ? record.newTrophies : [];
    ui.rrTrophies.hidden = unlocked.length === 0 || record.duplicate;
    ui.rrTrophies.textContent = unlocked.length
      ? '解锁奖杯：' + unlocked.map(trophyLabel).join('、')
      : '';
  }

  mahjongBoardList(record.board);
  if (ui.rrDevice) {
    ui.rrDevice.textContent = '匿名设备 ' + (record.deviceShort || '匿名') +
      ' · 仅本机匿名记录 · 本地排行榜，清除浏览器缓存即重置';
  }
  if (ui.rrClaim) {
    const pending = record.lossAversion && record.lossAversion.pendingReward != null;
    const completed = record.daily && record.daily.completed;
    ui.rrClaim.disabled = !pending;
    ui.rrClaim.textContent = pending
      ? '领取每日奖励 +' + record.lossAversion.pendingReward
      : (completed ? '今日奖励已领取' : '打满 3 局可领奖励');
  }
  if (ui.rrStatus) {
    ui.rrStatus.textContent = '本局' + (RESULT_LABELS[outcome] || '结束') +
      (record.duplicate ? '（已记录）' : '，+' + Math.max(0, record.points || 0) + ' 积分') +
      (record.rank ? '，本机名次第 ' + record.rank + ' 名。' : '。');
  }
}

async function shareMahjongResult() {
  if (!resultTracker) return;
  if (ui.rrStatus) ui.rrStatus.textContent = '正在准备分享…';
  const payload = resultTracker.lastShare();
  const outcome = await shareOrCopy(payload, { location: window.location });
  if (!ui.rrStatus) return;
  if (outcome.method === 'share') {
    ui.rrStatus.textContent = '已调起系统分享。';
  } else if (outcome.method === 'copy') {
    ui.rrStatus.textContent = '分享文案已复制：' + payload.text;
  } else if (outcome.method === 'manual') {
    ui.rrStatus.textContent = '请手动复制：' + outcome.text;
  }
}

function claimMahjongDaily() {
  if (!resultTracker) return;
  const claimed = resultTracker.claimDailyReward();
  if (!ui.rrStatus) return;
  if (claimed.ok) {
    ui.rrStatus.textContent = '每日奖励领取成功，+' + claimed.points + ' 积分。';
    if (ui.rrClaim) {
      ui.rrClaim.disabled = true;
      ui.rrClaim.textContent = '今日奖励已领取';
    }
    if (claimed.levelUp && ui.rrLevel) ui.rrLevel.textContent = String(claimed.level);
  } else if (claimed.code === 'E_NOT_DONE') {
    ui.rrStatus.textContent = '还没打满今日目标，继续加油。';
  } else if (claimed.code === 'E_EXPIRED') {
    ui.rrStatus.textContent = '每日奖励已过期，明天再来。';
  } else {
    ui.rrStatus.textContent = '今日奖励已经领取过了。';
  }
}

function showResult(result) {
  const g = game;
  ui.resultTitle.textContent = resultHeadline(result);
  ui.resultKind.textContent = result && result.type === 'draw'
    ? '无人胡牌'
    : (result && result.type === 'ron' ? '荣和' : '自摸');
  ui.resultHan.textContent = result && result.han != null
    ? result.han + ' 番 / ' + (result.fu == null ? '—' : result.fu + ' 符')
    : '—';
  ui.resultPoints.textContent = result && result.points != null ? String(result.points) : '—';
  ui.resultWall.textContent = g ? String(remainingTiles(g)) : '—';
  const yaku = result && Array.isArray(result.yaku) ? result.yaku : [];
  ui.resultYaku.textContent = yaku.length
    ? '番型：' + yaku.map((item) => item.name + '（' + item.han + ' 番）').join('、')
    : '';
  if (result && result.tile) {
    ui.resultYaku.textContent += (ui.resultYaku.textContent ? '；' : '') + '和牌：' + shortLabel(result.tile);
  }
  ui.overlay.hidden = false;
  finishMahjongMatch(result);
}

function render() {
  const g = game;
  if (!g) return;

  ui.wallCount.textContent = '牌墙 ' + remainingTiles(g);
  const ended = g.phase === 'ended';
  let status;
  if (ended) {
    status = resultHeadline(g.result);
  } else if (pendingRon) {
    status = '可以荣和，请选择';
  } else if (g.turn === 0) {
    status = g.phase === 'discard' ? '轮到你出牌' : '轮到你摸牌';
  } else {
    status = playerName(g.turn) + ' 思考中…';
  }
  ui.status.textContent = status;

  renderOpponents(g);
  renderRivers(g);

  const canAct = !ended && g.turn === 0 && g.phase === 'discard' && !pendingRon;
  const sorted = g.hands[0].slice().sort((a, b) => (INDEX.get(a) || 0) - (INDEX.get(b) || 0));
  ui.hand.textContent = '';
  for (const tile of sorted) {
    ui.hand.appendChild(makeHandTile(tile, canAct, () => onHumanDiscard(tile)));
  }

  const tsumo = !ended && canTsumo(g, 0);
  const ron = !ended && pendingRon && canRon(g, 0);
  ui.tsumo.hidden = !tsumo;
  ui.ron.hidden = !ron;
  ui.pass.hidden = !pendingRon;
  ui.hint.textContent = ended
    ? '点击「新局」再来一局'
    : (pendingRon
      ? '选择荣和或过'
      : (g.turn === 0
        ? (g.phase === 'discard' ? '点击一张牌打出' : '正在摸牌')
        : '等待电脑出牌'));
}

function scheduleNext(delay) {
  clearTimeout(aiTimer);
  const expected = game;
  aiTimer = setTimeout(() => {
    if (game !== expected) return;
    step();
  }, delay == null ? AI_DELAY : delay);
}

function step() {
  const g = game;
  if (!g || g.phase === 'ended' || pendingRon) return;

  if (g.turn === 0) {
    if (g.phase === 'draw') {
      const drawn = beginTurn(g);
      if (!drawn.ok) {
        render();
        if (g.result) showResult(g.result);
        return;
      }
    }
    render();
    return;
  }

  if (g.phase === 'draw') {
    const drawn = beginTurn(g);
    if (!drawn.ok) {
      render();
      if (g.result) showResult(g.result);
      return;
    }
  }
  render();

  if (canTsumo(g, g.turn)) {
    declareTsumo(g, g.turn);
    actionCount += 1;
    render();
    if (g.result) showResult(g.result);
    return;
  }

  aiTimer = setTimeout(() => {
    if (game !== g || g.phase === 'ended') return;
    const tile = chooseDiscard(g, g.turn);
    const discarded = discardTile(g, g.turn, tile);
    if (!discarded.ok) {
      render();
      return;
    }
    actionCount += 1;

    if (canRon(g, 0)) {
      pendingRon = true;
      render();
      return;
    }
    for (let player = 1; player < g.players; player += 1) {
      if (canRon(g, player)) {
        declareRon(g, player);
        actionCount += 1;
        render();
        if (g.result) showResult(g.result);
        return;
      }
    }
    render();
    if (g.phase === 'ended' && g.result) {
      showResult(g.result);
      return;
    }
    scheduleNext(AI_DELAY);
  }, AI_DELAY);
}

function onHumanDiscard(tile) {
  const g = game;
  if (!g || g.phase === 'ended' || pendingRon) return;
  if (g.turn !== 0 || g.phase !== 'discard') return;

  const discarded = discardTile(g, 0, tile);
  if (!discarded.ok) {
    ui.status.textContent = discarded.error || '这张牌不能打出';
    return;
  }
  actionCount += 1;

  for (let player = 1; player < g.players; player += 1) {
    if (canRon(g, player)) {
      declareRon(g, player);
      render();
      if (g.result) showResult(g.result);
      return;
    }
  }

  render();
  if (g.phase === 'ended' && g.result) {
    showResult(g.result);
    return;
  }
  scheduleNext(AI_DELAY);
}

function onTsumo() {
  const g = game;
  if (!g || !canTsumo(g, 0)) return;
  declareTsumo(g, 0);
  actionCount += 1;
  render();
  if (g.result) showResult(g.result);
}

function onRon() {
  const g = game;
  if (!g || !pendingRon || !canRon(g, 0)) return;
  declareRon(g, 0);
  actionCount += 1;
  pendingRon = false;
  render();
  if (g.result) showResult(g.result);
}

function onPass() {
  if (!pendingRon) return;
  pendingRon = false;
  render();
  scheduleNext(AI_DELAY);
}

/*
 * Smoke/demo setup: replace the human hand with a 13-tile ready hand and put
 * the winning tile at the next wall index. createGame keeps a full wall plus
 * wallIndex, so no tiles need to be moved in or out of the wall.
 */
function rigReadyHand(g) {
  const targets = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '5s'];
  const from = Number.isInteger(g.wallIndex) ? g.wallIndex : 0;
  let winAt = -1;
  for (let index = from; index < g.wall.length; index += 1) {
    if (g.wall[index] === '5s') {
      winAt = index;
      break;
    }
  }
  if (winAt === -1) {
    if (from < g.wall.length) g.wall[from] = '5s';
  } else if (winAt !== from) {
    const swap = g.wall[from];
    g.wall[from] = g.wall[winAt];
    g.wall[winAt] = swap;
  }

  g.hands[0] = targets.slice();
  g.turn = 0;
  g.currentPlayer = 0;
  g.phase = 'draw';
  g.drawn = null;
  g.lastDraw = null;
  g.lastDiscard = null;
  g.discards = g.hands.map(() => []);
  g.rivers = g.discards;
  g.result = null;
  g.winner = null;
}

function newGame() {
  clearTimeout(aiTimer);
  aiTimer = null;
  pendingRon = false;
  matchRecorded = false;
  currentMatchId = newMatchId();
  matchStartedAt = Date.now();
  actionCount = 0;

  const players = Math.max(2, Math.min(4, Number(ui.players.value) || 4));
  const seedParam = params.get('seed');
  const seed = seedParam != null && seedParam !== ''
    ? Number(seedParam)
    : (Date.now() % 2147483647);

  game = createGame({ players, seed });
  if (TEST_WIN) rigReadyHand(game);
  ui.overlay.hidden = true;
  if (ui.rrLevelup) ui.rrLevelup.hidden = true;
  if (ui.rrStatus) ui.rrStatus.textContent = '';
  render();
  scheduleNext(0);
}

ui.newGame.addEventListener('click', newGame);
ui.again.addEventListener('click', newGame);
ui.tsumo.addEventListener('click', onTsumo);
ui.ron.addEventListener('click', onRon);
ui.pass.addEventListener('click', onPass);
ui.players.addEventListener('change', newGame);
if (ui.rrShare) {
  ui.rrShare.addEventListener('click', function () {
    shareMahjongResult().catch(function () {
      if (ui.rrStatus) ui.rrStatus.textContent = '分享失败，请稍后重试。';
    });
  });
}
if (ui.rrClaim) ui.rrClaim.addEventListener('click', claimMahjongDaily);

resultTracker = createResultTracker({ gameId: 'mahjong' });

/* Read-only debug surface for the browser smoke run; it cannot mutate rules. */
window.__mahjong = {
  get state() { return getGameState(game); },
  canTsumo: function canTsumoNow() { return Boolean(game && canTsumo(game, 0)); },
  canRon: function canRonNow() { return Boolean(game && pendingRon && canRon(game, 0)); },
  snapshot: function () { return resultTracker ? resultTracker.snapshot() : null; },
  // Smoke/demo hook: records a finished hand through the same result path.
  finishForTest: function (result, extra) {
    const merged = Object.assign({ type: 'tsumo', winner: 0 }, result || {}, extra || {});
    if (!game) game = createGame({ players: 2, seed: 1 });
    if (!game.result) game.result = merged;
    matchRecorded = false;
    actionCount = Math.max(1, actionCount);
    return finishMahjongMatch(merged);
  }
};

const initialPlayers = Number(params.get('players'));
if (Number.isInteger(initialPlayers) && initialPlayers >= 2 && initialPlayers <= 4) {
  ui.players.value = String(initialPlayers);
}

newGame();
