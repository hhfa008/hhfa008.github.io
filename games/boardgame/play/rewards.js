'use strict';

/* Retention rules live in app/retention.js and app/rewards.js; this page uses
 * the local compatibility adapter for its progress/mission view. */
import {
  buildSharePayload,
  claimComebackBonus,
  claimDailyMission,
  createEmptyProgress,
  createLeaderboardClient,
  getDailyMissions,
  getDeviceId,
  getLeaderboard,
  getReturnPrompt,
  levelDetails,
  loadProgress,
  recordDailyLogin,
  recordGameResult,
  recordMissionProgress,
  saveProgress,
  shareTextFor
} from './retention-engine-adapter.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

function utcDay(now) {
  return Math.floor((now == null ? Date.now() : now) / DAY_MS);
}

function randomInt(max) {
  const cap = Math.max(1, Math.floor(max));
  try {
    const bytes = new Uint32Array(1);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
      return bytes[0] % cap;
    }
  } catch (err) {
    // fall through
  }
  return Math.floor(Math.random() * cap);
}

const storage = safeStorage();
const deviceId = getDeviceId(storage);
let state = Object.assign(createEmptyProgress(Date.now()), loadProgress(storage) || {});

// Local anonymous demo opponents, clearly labelled. They are only data in the
// local mirror; no external request and no personal information is involved.
if (!state.demoSeeded) {
  state.entries = state.entries && state.entries.length
    ? state.entries
    : [
      { playerId: 'local-bot-ember', label: '匿名练习对手 A', score: 320, at: Date.now() - 3 * DAY_MS },
      { playerId: 'local-bot-owl', label: '匿名练习对手 B', score: 210, at: Date.now() - 2 * DAY_MS },
      { playerId: 'local-bot-reed', label: '匿名练习对手 C', score: 140, at: Date.now() - DAY_MS }
    ];
  state.demoSeeded = true;
}

// The remote adapter is injectable. This page deliberately wires in nothing so
// the static build stays offline; a host can pass a remote into the client.
const leaderboardClient = createLeaderboardClient({ config: undefined, remote: null });

function persist() {
  try {
    saveProgress(state, storage);
  } catch (err) {
    // saveProgress already guards; this is a last-resort guard for render paths.
  }
}

const els = {
  device: document.getElementById('device-id'),
  points: document.getElementById('points'),
  level: document.getElementById('level'),
  levelTitle: document.getElementById('level-title'),
  streak: document.getElementById('streak'),
  levelTrack: document.getElementById('level-track'),
  levelFill: document.getElementById('level-fill'),
  levelText: document.getElementById('level-progress-text'),
  comeback: document.getElementById('comeback'),
  comebackText: document.getElementById('comeback-text'),
  comebackBtn: document.getElementById('comeback-btn'),
  dailyText: document.getElementById('daily-text'),
  dailyBtn: document.getElementById('daily-btn'),
  missions: document.getElementById('missions'),
  playBtn: document.getElementById('play-btn'),
  shareBtn: document.getElementById('share-btn'),
  trophies: document.getElementById('trophies'),
  trophiesEmpty: document.getElementById('trophies-empty'),
  leaderboard: document.getElementById('leaderboard'),
  status: document.getElementById('status')
};

function setStatus(message) {
  if (els.status) els.status.textContent = message || '';
}

function formatPoints(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('zh-CN');
}

function shortDevice(id) {
  if (typeof id !== 'string' || id.length < 12) return '匿名';
  return id.slice(0, 8) + '…' + id.slice(-4);
}

function renderDevice() {
  if (!els.device) return;
  els.device.textContent = shortDevice(deviceId);
  els.device.title = deviceId;
  els.device.setAttribute('aria-label', '匿名设备标识 ' + deviceId);
}

function renderStats() {
  const details = levelDetails(state.points || 0);
  if (els.points) els.points.textContent = formatPoints(state.points);
  if (els.level) els.level.textContent = String(details.level);
  if (els.levelTitle) els.levelTitle.textContent = details.title;
  if (els.streak) els.streak.textContent = String(Math.max(0, state.streak || 0));

  const percent = Math.round(Math.max(0, Math.min(1, details.progress)) * 100);
  if (els.levelFill) els.levelFill.style.width = percent + '%';
  if (els.levelTrack) {
    els.levelTrack.setAttribute('aria-valuenow', String(percent));
    els.levelTrack.setAttribute('aria-valuetext', percent + '%（' + details.title + '）');
  }
  if (els.levelText) {
    els.levelText.textContent = details.nextAt == null
      ? '已达最高等级 ' + details.level
      : '再获得 ' + Math.max(0, details.nextAt - state.points) + ' 分升到下一级';
  }
}

function renderDaily() {
  const today = utcDay();
  const lastDay = typeof state.lastLoginDay === 'number' ? state.lastLoginDay : null;
  const claimedToday = lastDay === today;
  const gap = lastDay == null ? null : today - lastDay;
  const streak = Math.max(0, state.streak || 0);

  let text = '每天第一次进入可领取积分，连续登录有连胜加成。';
  if (claimedToday) {
    const award = Math.max(0, state.lastDailyAward || 0);
    text = '今日已领取' + (award > 0 ? ' +' + award + ' 积分' : '') +
      '，当前连胜 ' + streak + ' 天。明天再来。';
  } else if (gap != null && gap > 1 && streak > 0) {
    text = '连胜中断了（已有积分与奖杯保留，不会扣分）。今天登录即可重新开始连胜。';
  } else if (gap === 1 && streak > 0) {
    text = '连续登录第 ' + (streak + 1) + ' 天，今天登录有连胜加成。';
  } else if (streak > 0) {
    text = '当前连胜 ' + streak + ' 天，今天登录可继续累积。';
  }
  if (els.dailyText) els.dailyText.textContent = text;
  if (els.dailyBtn) {
    els.dailyBtn.disabled = claimedToday;
    els.dailyBtn.textContent = claimedToday ? '今日已领取' : '领取今日登录奖励';
  }
}

function renderMissions() {
  if (!els.missions) return;
  const missions = getDailyMissions(state, Date.now());
  els.missions.textContent = '';
  missions.forEach(function (mission) {
    const li = document.createElement('li');
    li.className = 'mission';

    const body = document.createElement('div');
    body.className = 'mission-body';
    const title = document.createElement('span');
    title.className = 'mission-title';
    title.textContent = mission.title + ' · +' + mission.points + ' 积分';
    const progress = document.createElement('span');
    progress.className = 'mission-progress';
    progress.textContent = '进度 ' + Math.min(mission.progress, mission.target) + ' / ' + mission.target +
      (mission.complete ? ' · 可领取' : '');
    body.appendChild(title);
    body.appendChild(progress);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.dataset.mission = mission.id;
    button.textContent = mission.claimed ? '已领取' : (mission.complete ? '领取 +' + mission.points : '进行中');
    button.disabled = mission.claimed || !mission.complete;
    button.setAttribute('aria-label', mission.title + (mission.claimed ? '，已领取' : (mission.complete ? '，领取 ' + mission.points + ' 积分' : '，进行中')));

    li.appendChild(body);
    li.appendChild(button);
    els.missions.appendChild(li);
  });
}

function renderComeback() {
  if (!els.comeback) return;
  const prompt = getReturnPrompt(state, Date.now());
  els.comeback.hidden = !prompt.eligible;
  if (!prompt.eligible) return;
  if (els.comebackText) {
    els.comebackText.textContent = '你已 ' + prompt.inactiveDays + ' 天没有上桌。回来就送 ' +
      prompt.bonus + ' 积分，仅限今天一次；不会扣分、不影响公平。';
  }
}

function renderTrophies() {
  if (!els.trophies || !els.trophiesEmpty) return;
  const trophies = Array.isArray(state.trophies) ? state.trophies : [];
  els.trophies.textContent = '';
  trophies.forEach(function (trophy) {
    const li = document.createElement('li');
    li.className = 'chip';
    li.textContent = trophy && (trophy.title || trophy.id) ? String(trophy.title || trophy.id) : '奖杯';
    els.trophies.appendChild(li);
  });
  els.trophiesEmpty.hidden = trophies.length > 0;
}

function renderLeaderboard() {
  if (!els.leaderboard) return;
  const board = leaderboardClient.read(state, { limit: 10 });
  els.leaderboard.textContent = '';
  board.forEach(function (entry) {
    const li = document.createElement('li');
    if (entry.playerId === deviceId) li.className = 'self';

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = '#' + entry.rank;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = entry.label || '匿名玩家';
    if (entry.playerId === deviceId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '我';
      who.appendChild(tag);
    }

    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = formatPoints(entry.score);

    li.appendChild(rank);
    li.appendChild(who);
    li.appendChild(score);
    els.leaderboard.appendChild(li);
  });
}

function render() {
  renderDevice();
  renderStats();
  renderDaily();
  renderMissions();
  renderComeback();
  renderTrophies();
  renderLeaderboard();
}

function claimDaily() {
  recordDailyLogin(state, Date.now());
  const awarded = state.dailyAwarded === true;
  const award = Math.max(0, state.lastDailyAward || 0);
  persist();
  render();
  setStatus(awarded
    ? '领取成功，+' + award + ' 积分；当前连胜 ' + Math.max(0, state.streak || 0) + ' 天。'
    : '今天已经领取过了，明天再来。');
}

function claimMission(missionId) {
  const result = claimDailyMission(state, missionId, Date.now());
  persist();
  render();
  if (result.ok) setStatus('任务奖励已领取，+' + result.points + ' 积分。');
  else if (result.reason === 'already_claimed') setStatus('这个任务今天已经领取过了。');
  else if (result.reason === 'not_complete') setStatus('任务还没完成。');
  else setStatus('暂时无法领取这个任务。');
}

function simulateGame() {
  const now = Date.now();
  const roll = randomInt(100);
  const result = roll < 34 ? 'win' : (roll < 67 ? 'near-miss' : 'loss');
  const score = 40 + randomInt(180);
  const cardsPlayed = 4 + randomInt(16);
  const outcome = recordGameResult(state, {
    result: result,
    score: score,
    cardsPlayed: cardsPlayed,
    nearMiss: result === 'near-miss'
  }, now);

  const submitted = getLeaderboard(state, {
    playerId: deviceId,
    score: score,
    at: now,
    durationMs: 60000
  }, { config: undefined });

  const rank = submitted && submitted.ok ? submitted.rank : (state.lastMatch && state.lastMatch.rank);
  state.lastMatch = {
    matchId: 'local-' + now.toString(36),
    result: result === 'near-miss' ? 'loss' : result,
    score: score,
    rank: rank,
    at: now
  };
  persist();
  render();

  const label = result === 'win' ? '获胜' : (result === 'loss' ? '惜败' : '差一点获胜');
  let message = '本局' + label + '，得分 ' + score + '。';
  if (outcome.playPoints > 0) message += ' 参与奖励 +' + outcome.playPoints + ' 积分。';
  if (outcome.bonus > 0) message += ' 差一点获胜的安慰奖励 +' + outcome.bonus + ' 积分。';
  if (submitted && submitted.ok) {
    message += ' 已进入匿名榜第 ' + submitted.rank + ' 名。';
  } else if (submitted && (submitted.reason || submitted.error)) {
    message += ' 分数提交被拦截（' + (submitted.reason || submitted.error) + '），积分不受影响。';
  }
  setStatus(message);
}

function copyText(text) {
  return (async function () {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      // fall through to the legacy path
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  })();
}

async function shareResult() {
  const match = state.lastMatch || {
    matchId: 'local',
    result: state.games > 0 ? 'played' : 'idle',
    score: Math.max(0, state.points || 0)
  };
  const payload = buildSharePayload(match);
  const text = shareTextFor(payload);
  const ok = await copyText(text);
  if (ok) {
    recordMissionProgress(state, 'share-once', 1, Date.now());
    persist();
    render();
    setStatus('分享文案与链接已复制：' + payload.text);
  } else {
    setStatus('复制失败，请手动复制：' + text);
  }
}

function claimComeback() {
  const result = claimComebackBonus(state, Date.now());
  persist();
  render();
  setStatus(result.ok
    ? '欢迎回来，+' + result.points + ' 积分。'
    : (result.reason === 'already_claimed' ? '今天的回归奖励已经领过了。' : '暂时没有可领取的回归奖励。'));
}

function bindEvents() {
  if (els.dailyBtn) els.dailyBtn.addEventListener('click', claimDaily);
  if (els.playBtn) els.playBtn.addEventListener('click', simulateGame);
  if (els.shareBtn) {
    els.shareBtn.addEventListener('click', function () {
      shareResult().catch(function () {
        setStatus('复制失败，请稍后重试。');
      });
    });
  }
  if (els.comebackBtn) els.comebackBtn.addEventListener('click', claimComeback);
  if (els.missions) {
    els.missions.addEventListener('click', function (event) {
      const button = event.target && event.target.closest ? event.target.closest('button[data-mission]') : null;
      if (!button) return;
      claimMission(button.dataset.mission);
    });
  }
}

// A tiny hook for acceptance tooling and future remote adapters. It is not
// used by the page UI, which stays fully offline.
globalThis.boardgameRewards = {
  get state() { return state; },
  get deviceId() { return deviceId; },
  render: render,
  persist: persist,
  submit: function (entry) { return getLeaderboard(state, entry, { config: undefined }); }
};

bindEvents();
render();
persist();
