'use strict';

/*
 * Retention integration contract for the playable result pages.
 *
 * Covers the wiring that card-battle and mahjong share through
 * play/retention-result.mjs:
 *   - deterministic match points formula
 *   - level thresholds / level-up signal
 *   - trophies are idempotent
 *   - streak + daily target + claimDaily
 *   - anonymous device id (stable, no PII)
 *   - validateScore anti-cheat (range / duration / turns / actions / device)
 *   - duplicate match ids are recorded exactly once
 *   - share payload fields and no personal information
 */

import { createSuite } from './lib/suite.mjs';
import {
  POINT_RULES,
  computeMatchPoints,
  createResultTracker,
  formatShortDeviceId,
  shareOrCopy,
  trophyLabel
} from '../play/retention-result.mjs';
import { levelForPoints, validateScore } from '../app/retention.js';
import { LEVELS } from '../app/rewards.js';

const s = createSuite('boardgame-retention-integration');
const DAY = 24 * 60 * 60 * 1000;
const PII_KEYS = ['email', 'phone', 'mobile', 'address', 'realName', 'fullName', 'idCard'];
const GOOD_DEVICE = 'dev_' + 'a'.repeat(32);

function fakeStorage() {
  const map = new Map();
  return {
    map: map,
    getItem: function (key) { return map.has(key) ? map.get(key) : null; },
    setItem: function (key, value) { map.set(key, String(value)); },
    removeItem: function (key) { map.delete(key); },
    clear: function () { map.clear(); }
  };
}

function piiHits(value) {
  const text = JSON.stringify(value || {});
  return PII_KEYS.filter(function (key) { return new RegExp(key, 'i').test(text); });
}

function boardEntries(storage) {
  const raw = storage.getItem('boardgame.leaderboard.v1');
  if (!raw) return [];
  try {
    return JSON.parse(raw).entries || [];
  } catch (err) {
    return [];
  }
}

function progressState(storage) {
  const raw = storage.getItem('boardgame.play-progress.v1');
  return raw ? JSON.parse(raw) : {};
}

function trackerFor(gameId, storage, clock) {
  return createResultTracker({
    gameId: gameId,
    storage: storage,
    now: function () { return clock.now; }
  });
}

const WIN_STATS = {
  result: 'win',
  remainingPrizes: 3,
  turns: 10,
  actions: 40,
  durationMs: 60000
};

await s.run(async () => {
  // -------------------------------------------------------------------
  // points formula
  // -------------------------------------------------------------------
  await s.group('points formula', async () => {
    s.eq('卡牌胜利 = 100 + 奖赏 30 + 速胜 40',
      computeMatchPoints({ game: 'card-battle', result: 'win', remainingPrizes: 3, turns: 10 }).total, 170);
    s.eq('卡牌胜利封顶（6 奖赏 / 50 回合）',
      computeMatchPoints({ game: 'card-battle', result: 'win', remainingPrizes: 9, turns: 50 }).total, 160);
    s.eq('卡牌负 = 20', computeMatchPoints({ game: 'card-battle', result: 'loss' }).total, 20);
    s.eq('卡牌平 = 50', computeMatchPoints({ game: 'card-battle', result: 'draw' }).total, 50);
    s.eq('麻将自摸胜利 = 100 + 番 30 + 余牌 4 + 自摸 20',
      computeMatchPoints({
        game: 'mahjong', result: 'win', han: 3, remainingTiles: 20, tsumo: true
      }).total, 154);
    s.eq('麻将荣和胜利（无自摸）', computeMatchPoints({
      game: 'mahjong', result: 'win', han: 3, remainingTiles: 20, tsumo: false
    }).total, 134);
    s.eq('麻将流局 = 50', computeMatchPoints({ game: 'mahjong', result: 'draw' }).total, 50);
    s.eq('麻将负 = 20', computeMatchPoints({ game: 'mahjong', result: 'loss', han: 8 }).total, 20);
    const junk = computeMatchPoints({
      game: 'card-battle', result: 'win', remainingPrizes: -5, turns: 'x'
    });
    s.ok('非法奖励字段被钳制且不产生负分', junk.total >= POINT_RULES.win && junk.bonus >= 0,
      JSON.stringify(junk));
  });

  // -------------------------------------------------------------------
  // levels
  // -------------------------------------------------------------------
  await s.group('levels', async () => {
    const cases = [[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [699, 3], [700, 4], [1499, 4], [1500, 5]];
    cases.forEach(function (pair) {
      s.eq('levelForPoints(' + pair[0] + ') = ' + pair[1], levelForPoints(pair[0]), pair[1]);
    });
    s.eq('LEVELS 阈值固定为 0/100/300/700/1500',
      LEVELS.map(function (lv) { return lv.min; }), [0, 100, 300, 700, 1500]);

    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const tracker = trackerFor('card-battle', storage, clock);
    const first = tracker.recordMatch(Object.assign({ matchId: 'level-1' }, WIN_STATS));
    s.eq('首局胜利后的等级 = 2（含每日登录 +50）', first.level, 2);
    s.eq('首局触发晋级', first.levelUp, true);
    s.eq('晋级起始等级', first.levelFrom, 1);
    s.eq('晋级目标等级', first.levelTo, 2);

    const second = tracker.recordMatch(Object.assign({ matchId: 'level-2' }, WIN_STATS));
    s.eq('累计 390 分升到 3 级', second.level, 3);
    s.eq('第二局再次晋级', second.levelUp, true);
  });

  // -------------------------------------------------------------------
  // trophies are idempotent
  // -------------------------------------------------------------------
  await s.group('trophies', async () => {
    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const tracker = trackerFor('card-battle', storage, clock);
    const first = tracker.recordMatch(Object.assign({ matchId: 'trophy-1' }, WIN_STATS));
    s.includes('首局解锁 first-play', JSON.stringify(first.trophies), 'first-play');
    s.includes('胜利解锁 first-win', JSON.stringify(first.trophies), 'first-win');
    s.includes('首局把 first-win 标为新增', JSON.stringify(first.newTrophies), 'first-win');

    const second = tracker.recordMatch(Object.assign({ matchId: 'trophy-2' }, WIN_STATS));
    const winCount = (second.trophies || []).filter(function (id) { return id === 'first-win'; }).length;
    s.eq('first-win 只保留一次', winCount, 1);
    s.eq('第二局不把 first-win 当新增', (second.newTrophies || []).indexOf('first-win'), -1);

    for (let i = 0; i < 8; i += 1) {
      tracker.recordMatch(Object.assign({ matchId: 'trophy-many-' + i }, WIN_STATS));
    }
    const state = progressState(storage);
    s.eq('10 局后 matches-10 只发一次',
      (state.trophies || []).filter(function (id) { return id === 'matches-10'; }).length, 1);
    s.eq('进度里 first-play 只出现一次',
      (state.trophies || []).filter(function (id) { return id === 'first-play'; }).length, 1);
    s.eq('奖杯有可读的中文名', trophyLabel('first-win'), '首次胜利');
    s.eq('未知奖杯回退为原 id', trophyLabel('custom-badge'), 'custom-badge');
  });

  // -------------------------------------------------------------------
  // streak / daily / claimDaily
  // -------------------------------------------------------------------
  await s.group('streak and daily', async () => {
    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const tracker = trackerFor('card-battle', storage, clock);

    const day1 = tracker.recordMatch(Object.assign({ matchId: 'streak-1' }, WIN_STATS));
    s.eq('首日连胜 = 1', day1.streak, 1);
    s.eq('首日对局进度 = 1', day1.daily.played, 1);
    s.eq('首日登录奖励 = daily.points', day1.dailyAward, 50);

    const again = tracker.recordMatch(Object.assign({ matchId: 'streak-2' }, WIN_STATS));
    s.eq('同日再战连胜不变', again.streak, 1);
    s.eq('同日对局进度累加', again.daily.played, 2);

    clock.now += DAY;
    const day2 = tracker.recordMatch(Object.assign({ matchId: 'streak-3' }, WIN_STATS));
    s.eq('第二天连胜 = 2', day2.streak, 2);
    s.eq('第二天对局进度重置为 1', day2.daily.played, 1);
    s.eq('第二天登录奖励含连胜加成 55', day2.dailyAward, 55);

    clock.now += DAY;
    tracker.recordMatch(Object.assign({ matchId: 'day3-1' }, WIN_STATS));
    tracker.recordMatch(Object.assign({ matchId: 'day3-2' }, WIN_STATS));
    const day3 = tracker.recordMatch(Object.assign({ matchId: 'day3-3' }, WIN_STATS));
    s.eq('第三天连胜 = 3', day3.streak, 3);
    s.eq('打满 3 局后 daily.completed', day3.daily.completed, true);
    s.ok('打满 3 局后出现待领奖励', day3.lossAversion && day3.lossAversion.pendingReward != null,
      JSON.stringify(day3.lossAversion));

    const claimed = tracker.claimDailyReward();
    s.ok('claimDaily 可领取每日奖励', claimed.ok === true, JSON.stringify(claimed));
    s.eq('每日奖励 50 分', claimed.points, 50);
    const claimedAgain = tracker.claimDailyReward();
    s.ok('同一奖励不能重复领取', claimedAgain.ok === false, JSON.stringify(claimedAgain));

    clock.now += 2 * DAY;
    const afterBreak = tracker.recordMatch(Object.assign({ matchId: 'streak-break' }, WIN_STATS));
    s.eq('断签后连胜重置为 1', afterBreak.streak, 1);
  });

  // -------------------------------------------------------------------
  // anonymous device id
  // -------------------------------------------------------------------
  await s.group('anonymous device id', async () => {
    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const first = trackerFor('card-battle', storage, clock);
    const second = trackerFor('mahjong', storage, clock);
    s.matches('设备 id 符合 dev_ + 32 hex', first.deviceId, /^dev_[a-f0-9]{32}$/);
    s.eq('同一 storage 返回稳定 id', second.deviceId, first.deviceId);
    s.eq('设备 id 不含个人信息', piiHits({ id: first.deviceId }), []);
    s.eq('短 id 不暴露完整内容', formatShortDeviceId(first.deviceId).indexOf(first.deviceId), -1);

    first.recordMatch(Object.assign({ matchId: 'device-1' }, WIN_STATS));
    const stored = storage.getItem('boardgame.play-progress.v1') || '';
    s.eq('本地进度不含个人信息', piiHits(stored), []);
    s.eq('设备 id 持久化在自己的键里', storage.getItem('boardgame.device.v1'), first.deviceId);
    s.eq('设备 id 键不含个人信息', piiHits({ id: storage.getItem('boardgame.device.v1') }), []);
  });

  // -------------------------------------------------------------------
  // anti-cheat: validateScore
  // -------------------------------------------------------------------
  await s.group('anti-cheat validation', async () => {
    const valid = validateScore({
      score: 120, durationMs: 60000, turns: 8, actions: 24, deviceId: GOOD_DEVICE
    });
    s.eq('正常对局通过校验', valid.ok, true);

    s.eq('超上限分数被拒绝',
      validateScore({ score: 100001 }).reason, 'score out of range');
    s.eq('负分被拒绝',
      validateScore({ score: -1 }).reason, 'score out of range');
    s.eq('客户端权威分数被拒绝',
      validateScore({ score: 10, clientAuthoritative: true }).reason,
      'client authoritative score rejected');
    s.eq('小于 1 秒的对局被拒绝',
      validateScore({ score: 10, durationMs: 500 }).reason, 'match duration below minimum');
    s.eq('非数字时长被拒绝',
      validateScore({ score: 10, durationMs: 'fast' }).reason, 'match duration below minimum');
    s.eq('0 回合被拒绝',
      validateScore({ score: 10, turns: 0 }).reason, 'turn count out of range');
    s.eq('超过最大回合被拒绝',
      validateScore({ score: 10, turns: 501 }).reason, 'turn count out of range');
    s.eq('0 动作被拒绝',
      validateScore({ score: 10, actions: 0 }).reason, 'action count below minimum');
    s.eq('伪造设备 id 被拒绝',
      validateScore({ score: 10, deviceId: 'user@example.com' }).reason, 'invalid device id');

    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const tracker = trackerFor('card-battle', storage, clock);
    const flagged = tracker.recordMatch({
      matchId: 'cheat-short', result: 'win', remainingPrizes: 6, turns: 1, actions: 1, durationMs: 200
    });
    s.eq('异常短局被标记', flagged.flagged, true);
    s.eq('异常短局不入榜', boardEntries(storage).length, 0);
    s.ok('异常短局仍保留本机积分（不吞正常进度）', flagged.total > 0, JSON.stringify({ total: flagged.total }));
    s.includes('异常短局给出可解释原因', String(flagged.flagReason), 'duration');
  });

  // -------------------------------------------------------------------
  // duplicate submission idempotency
  // -------------------------------------------------------------------
  await s.group('duplicate submission', async () => {
    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const tracker = trackerFor('card-battle', storage, clock);
    const first = tracker.recordMatch(Object.assign({ matchId: 'same-match' }, WIN_STATS));
    const totalAfterFirst = first.total;
    s.eq('首局入榜 1 条', boardEntries(storage).length, 1);

    const replay = tracker.recordMatch(Object.assign({ matchId: 'same-match' }, WIN_STATS));
    s.eq('同一局重复提交被识别', replay.duplicate, true);
    s.eq('重复提交不再加分', replay.points, 0);
    s.eq('重复提交不改变总分', replay.total, totalAfterFirst);
    s.eq('榜单仍然只有 1 条', boardEntries(storage).length, 1);

    const changedScore = tracker.recordMatch({
      matchId: 'same-match', result: 'win', remainingPrizes: 6, turns: 1,
      actions: 99, durationMs: 60000
    });
    s.eq('同 id 改分数也被拒绝', changedScore.duplicate, true);
    s.eq('同 id 改分数不改总分', changedScore.total, totalAfterFirst);

    const state = progressState(storage);
    s.eq('对局 id 只记录一次',
      (state.matchIds || []).filter(function (id) { return id === 'same-match'; }).length, 1);
  });

  // -------------------------------------------------------------------
  // share payload
  // -------------------------------------------------------------------
  await s.group('share payload', async () => {
    const storage = fakeStorage();
    const clock = { now: Date.UTC(2026, 10, 10, 12) };
    const tracker = trackerFor('mahjong', storage, clock);
    tracker.recordMatch({
      matchId: 'share-match', result: 'win', han: 3, remainingTiles: 30, tsumo: true,
      turns: 8, actions: 24, durationMs: 90000
    });
    const payload = tracker.lastShare();
    const text = JSON.stringify(payload);
    s.eq('分享标题存在', typeof payload.title, 'string');
    s.includes('分享文案包含对局 id', text, 'share-match');
    s.includes('分享文案包含结果', payload.text, '胜利');
    s.ok('分享链接是站内相对链接', payload.url.indexOf('share.html?match=') === 0, payload.url);
    s.eq('分享链接不含设备 id', text.indexOf('dev_'), -1);
    s.eq('分享数据不含个人信息', piiHits(payload), []);
    s.ok('分享数据不含追踪参数', !/utm_|deviceId|email=|phone=/.test(text), text);
    s.ok('分享数据长度可控 (<2000)', text.length < 2000, String(text.length));

    const calls = [];
    const outcome = await shareOrCopy(payload, {
      navigator: {
        share: function (data) {
          calls.push(data);
          return Promise.resolve();
        }
      }
    });
    s.eq('navigator.share 被调用一次', calls.length, 1);
    s.eq('优先使用系统分享', outcome.method, 'share');
    s.eq('系统分享携带标题', calls[0].title, payload.title);
    s.eq('系统分享携带文案', calls[0].text, payload.text);

    const copied = [];
    const fallback = await shareOrCopy(payload, {
      navigator: {},
      copy: function (value) {
        copied.push(value);
        return Promise.resolve(true);
      }
    });
    s.eq('无 navigator.share 时复制文案', fallback.method, 'copy');
    s.eq('复制内容包含完整分享文本', copied[0], outcome.text);

    const aborted = await shareOrCopy(payload, {
      navigator: {
        share: function () {
          const err = new Error('cancelled');
          err.name = 'AbortError';
          return Promise.reject(err);
        }
      },
      copy: function () { return Promise.resolve(true); }
    });
    s.eq('用户取消分享不触发复制', aborted.method, 'aborted');
  });
});
