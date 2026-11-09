'use strict';

/*
 * L2 contract: retention & rewards.
 *
 * The pages app splits this domain across three modules:
 *   app/retention.*   daily play / streak / loss-aversion state
 *   app/rewards.*     points / level / trophies
 *   app/leaderboard.* leaderboard / anonymous device id / anti-cheat
 *
 * Each module is probed independently. Missing modules are SKIPped; a module
 * that exists but violates its contract is a FAILURE. A single config-style
 * module (createRetentionConfig + named functions) is also accepted.
 */

import { createSuite } from './lib/suite.mjs';
import { probeModule, pick, fnOf, instantiate, describeMissing } from './lib/probe.mjs';
import { RETENTION, call } from './lib/contracts.mjs';

const MODULES = {
  retention: ['app/retention.mjs', 'app/retention.js', 'app/retention/index.mjs'],
  rewards: ['app/rewards.mjs', 'app/rewards.js', 'app/rewards/index.mjs'],
  leaderboard: ['app/leaderboard.mjs', 'app/leaderboard.js', 'app/leaderboard/index.mjs']
};

const PII_KEYS = ['email', 'phone', 'mobile', 'address', 'realName', 'fullName', 'idCard'];
const SHARE_NAMES = ['buildSharePayload', 'createSharePayload', 'sharePayload', 'createShareCard'];

const s = createSuite('boardgame-retention-rewards');

const previousLocalStorage = globalThis.localStorage;

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

function containsPii(value) {
  const text = JSON.stringify(value || {});
  return PII_KEYS.filter(function (key) { return new RegExp(key, 'i').test(text); });
}

function stateOf(value) {
  if (!value || typeof value !== 'object') return {};
  return value.state || value.data || value;
}

function numberAt(value, keys) {
  const state = stateOf(value);
  for (const key of keys) {
    if (typeof state[key] === 'number') return state[key];
  }
  for (const nested of ['daily', 'streak', 'lossAversion', 'user', 'player']) {
    if (state[nested] && typeof state[nested] === 'object') {
      const found = numberAt(state[nested], keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function arraysAt(value, keys) {
  const state = stateOf(value);
  for (const key of keys) {
    if (Array.isArray(state[key])) return state[key];
  }
  return undefined;
}

await s.run(async () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;

  const probes = {};
  for (const key of Object.keys(MODULES)) {
    probes[key] = await probeModule(MODULES[key], key);
  }
  const anyFound = Object.keys(probes).some(function (key) { return probes[key].found; });
  if (!anyFound) {
    s.skip('retention/rewards contract',
      describeMissing(probes.retention, MODULES.retention) + '; ' +
      describeMissing(probes.rewards, MODULES.rewards) + '; ' +
      describeMissing(probes.leaderboard, MODULES.leaderboard));
    return;
  }

  for (const key of Object.keys(probes)) {
    if (probes[key].found && probes[key].error) {
      s.ok(key + ' module imports without throwing', false,
        probes[key].path + ': ' + (probes[key].error.stack || probes[key].error.message || String(probes[key].error)));
    }
  }

  // -------------------------------------------------------------------
  // retention: daily / streak / loss aversion
  // -------------------------------------------------------------------
  const retentionProbe = probes.retention;
  const retentionApi = retentionProbe.api;
  const namedDaily = retentionApi && (
    fnOf(retentionApi, ['recordDailyLogin', 'recordPlay', 'recordLogin']) ||
    fnOf(retentionApi, RETENTION.daily)
  );
  const configFactory = retentionApi && (fnOf(retentionApi, RETENTION.config) || fnOf(retentionApi, ['createRetention']));
  const configObject = configFactory ? instantiate(configFactory, {}) : null;
  const configStyle = Boolean(namedDaily && configObject &&
    configObject.daily && configObject.daily.points !== undefined);

  if (!retentionProbe.found) {
    s.skip('retention daily/streak contract', describeMissing(retentionProbe, MODULES.retention));
  } else if (retentionProbe.error) {
    // import failure already reported above
  } else if (configStyle) {
    const dailyConfig = configObject.daily || {};
    const streakConfig = configObject.streak || {};
    const lossConfig = configObject.lossAversion || configObject.loss || {};
    const cheatConfig = configObject.antiCheat || {};

    await s.group('retention config', async () => {
      s.ok('导出 createRetentionConfig/retentionConfig', configObject != null,
        JSON.stringify(Object.keys(configObject || {})));
      s.ok('daily 钩子启用', dailyConfig.enabled !== false, JSON.stringify(dailyConfig));
      s.ok('daily 奖励积分为正', dailyConfig.points > 0, JSON.stringify(dailyConfig));
      s.eq('daily 冷却 24h', dailyConfig.cooldownHours, 24);
      s.ok('streak 钩子启用', streakConfig.enabled !== false, JSON.stringify(streakConfig));
      s.ok('streak 每日加成为正', streakConfig.bonusPerDay > 0, JSON.stringify(streakConfig));
      s.ok('streak 有天数上限', streakConfig.maxDays > 0, JSON.stringify(streakConfig));
      s.ok('lossAversion 钩子启用', lossConfig.enabled !== false, JSON.stringify(lossConfig));
      s.ok('lossAversion 有 comeback/near-miss 奖励',
        (lossConfig.comebackBonus || 0) > 0 || (lossConfig.nearMissBonus || 0) > 0,
        JSON.stringify(lossConfig));
      s.ok('lossAversion 有到期时长', (lossConfig.expiresHours || 0) > 0, JSON.stringify(lossConfig));
      s.ok('antiCheat 分数上限为正', cheatConfig.maxScore > 0, JSON.stringify(cheatConfig));
      s.ok('antiCheat 最小间隔为正', cheatConfig.minIntervalMs > 0, JSON.stringify(cheatConfig));
      s.eq('antiCheat 服务端权威', cheatConfig.serverAuthoritative, true);
    });

    await s.group('daily login and streak', async () => {
      const state = { points: 0, streak: 0, lastLoginAt: null, trophies: [] };
      const day1 = Date.UTC(2026, 10, 10, 12, 0, 0);
      await call(namedDaily, null, [state, day1]);
      s.eq('首次登录发放 daily.points', state.points, dailyConfig.points);
      s.eq('首次登录连胜 = 1', state.streak, 1);

      await call(namedDaily, null, [state, day1 + 60 * 60 * 1000]);
      s.eq('同一天重复登录不重复发分', state.points, dailyConfig.points);
      s.eq('同一天连胜不重复增加', state.streak, 1);

      await call(namedDaily, null, [state, day1 + 24 * 60 * 60 * 1000]);
      s.eq('连续第二天积分 = 2 * points + bonus', state.points,
        dailyConfig.points * 2 + streakConfig.bonusPerDay);
      s.eq('连续第二天连胜 = 2', state.streak, 2);

      const updateStreak = fnOf(retentionApi, ['updateStreak']);
      const getStreak = fnOf(retentionApi, ['getStreak']);
      if (updateStreak) {
        const next = await call(updateStreak, null, [state, day1 + 2 * 24 * 60 * 60 * 1000]);
        s.eq('updateStreak 连续日返回 3', next && next.streak, 3);
      } else {
        s.skip('updateStreak contract', 'no updateStreak export');
      }
      if (getStreak) {
        s.eq('getStreak 读取当前连胜', await call(getStreak, null, [state]), state.streak);
      }

      await call(namedDaily, null, [state, day1 + 4 * 24 * 60 * 60 * 1000]);
      s.eq('断签后连胜重置为 1', state.streak, 1);
    });

    await s.group('loss aversion / anti-cheat', async () => {
      s.ok('comeback 补偿为正', (lossConfig.comebackBonus || 0) > 0, JSON.stringify(lossConfig));
      const validateScore = fnOf(retentionApi, RETENTION.antiCheat);
      if (!validateScore) {
        s.skip('anti-cheat validator', 'no validateScore export');
        return;
      }
      const tooHigh = await call(validateScore, null, [{ score: cheatConfig.maxScore + 1 }]);
      s.ok('超上限分数被拒绝', tooHigh && tooHigh.ok === false, JSON.stringify(tooHigh));
      const clientAuth = await call(validateScore, null, [{ score: 10, clientAuthoritative: true }]);
      s.ok('客户端权威分数被拒绝', clientAuth && clientAuth.ok === false, JSON.stringify(clientAuth));
      const normal = await call(validateScore, null, [{ score: 10 }]);
      s.ok('正常分数通过校验', normal && normal.ok !== false, JSON.stringify(normal));
    });
  } else {
    const clock = { now: Date.UTC(2026, 10, 10, 12, 0, 0) };
    const retention = configFactory
      ? instantiate(configFactory, { now: function () { return clock.now; }, storage: fakeStorage() })
      : configObject;

    const recordPlay = fnOf(retention, ['recordPlay', 'recordLogin', 'recordDailyLogin']) ||
      fnOf(retentionApi, RETENTION.daily);
    const claimDaily = fnOf(retention, ['claimDaily', 'claimDailyReward']) ||
      fnOf(retentionApi, ['claimDaily']);
    const getState = fnOf(retention, ['getState', 'state']) ||
      (retention ? function () { return retention; } : null);
    const reset = fnOf(retention, ['reset']);

    await s.group('retention config', async () => {
      s.ok('提供留存状态机/配置', retention != null, JSON.stringify(Object.keys(retention || {})));
      if (!retention) return;
      let state;
      try {
        state = (getState ? await call(getState, retention, []) : retention) || {};
      } catch (err) {
        s.ok('读取留存状态不抛错', false, err && err.message ? err.message : String(err));
        return;
      }
      const daily = state.daily || {};
      const streak = state.streak || {};
      const loss = state.lossAversion || state.loss || {};
      s.ok('状态含 daily', typeof daily === 'object', JSON.stringify(state).slice(0, 200));
      s.ok('daily 有目标或完成标记', (daily.target || daily.goal || 0) > 0 ||
        typeof daily.completed === 'boolean', JSON.stringify(daily));
      s.ok('状态含 streak', typeof streak === 'object', JSON.stringify(streak));
      s.ok('streak 有 current/best', typeof streak.current === 'number' || typeof streak.best === 'number',
        JSON.stringify(streak));
      s.ok('状态含 lossAversion', typeof loss === 'object', JSON.stringify(loss));
      s.ok('lossAversion 有 pendingReward/claimed/lost',
        loss.pendingReward !== undefined || loss.claimed !== undefined || loss.lost !== undefined,
        JSON.stringify(loss));
    });

    if (recordPlay && getState) {
      await s.group('daily login and streak', async () => {
        if (reset) await call(reset, retention, []);
        const day1 = clock.now;
        const first = await call(recordPlay, retention, [{ won: true }]);
        let state = (await call(getState, retention, [])) || stateOf(first);
        s.eq('首次记录后 daily.played = 1', state.daily && state.daily.played, 1);
        s.eq('首次记录后连胜 = 1', state.streak && state.streak.current, 1);
        await call(recordPlay, retention, [{ won: false }]);
        state = await call(getState, retention, []);
        s.eq('同一天再次记录累加 played', state.daily && state.daily.played, 2);
        s.eq('同一天连胜不重复增加', state.streak && state.streak.current, 1);
        if (claimDaily) {
          const beforeTarget = await call(claimDaily, retention, []);
          s.ok('未完成目标不能领奖', beforeTarget && beforeTarget.ok === false, JSON.stringify(beforeTarget));
          s.eq('未完成目标错误码', beforeTarget && beforeTarget.code, 'E_NOT_DONE');
          await call(recordPlay, retention, [{ won: true }]);
          state = await call(getState, retention, []);
          s.eq('达到目标后 completed = true', state.daily && state.daily.completed, true);
          const claimed = await call(claimDaily, retention, []);
          s.ok('完成后可领奖', claimed && claimed.ok === true, JSON.stringify(claimed));
          const second = await call(claimDaily, retention, []);
          s.ok('同一次奖励不能重复领', second && second.ok === false, JSON.stringify(second));
        } else {
          s.skip('claimDaily contract', 'no claimDaily export');
        }
        clock.now += 24 * 60 * 60 * 1000;
        await call(recordPlay, retention, [{ won: true }]);
        state = await call(getState, retention, []);
        s.eq('连续第二天连胜 +1', state.streak && state.streak.current, 2);
        clock.now += 2 * 24 * 60 * 60 * 1000;
        await call(recordPlay, retention, [{ won: true }]);
        state = await call(getState, retention, []);
        s.eq('断签后连胜重置为 1', state.streak && state.streak.current, 1);
      });
    } else {
      s.skip('daily login and streak', '没有 recordPlay/getState 接口');
    }
  }


  // -------------------------------------------------------------------
  // rewards: points / level / trophies
  // -------------------------------------------------------------------
  const rewardsProbe = probes.rewards;
  const rewardsApi = rewardsProbe.api;
  const rewardsFactory = rewardsApi && fnOf(rewardsApi, ['createRewards']);

  if (!rewardsProbe.found) {
    s.skip('rewards contract', describeMissing(rewardsProbe, MODULES.rewards));
  } else if (rewardsProbe.error) {
    // reported above
  } else if (!rewardsFactory && !fnOf(rewardsApi, RETENTION.points)) {
    s.ok('rewards 模块暴露 createRewards 或加分函数', false,
      'exports: ' + Object.keys(rewardsApi || {}).join(', '));
  } else {
    const rewards = rewardsFactory
      ? instantiate(rewardsFactory, { now: function () { return Date.UTC(2026, 10, 10); }, storage: fakeStorage() })
      : rewardsApi;
    const award = fnOf(rewards, ['award', 'addPoints', 'awardPoints']) || fnOf(rewardsApi, RETENTION.points);
    const grantTrophy = fnOf(rewards, ['grantTrophy', 'awardTrophy']) || fnOf(rewardsApi, RETENTION.trophies);
    const getRewardState = fnOf(rewards, ['getState', 'snapshot']) ||
      (rewards ? function () { return rewards; } : null);

    await s.group('points, level, trophies', async () => {
      if (!award) {
        s.skip('points contract', 'no award/addPoints export');
      } else {
        let state = getRewardState ? await call(getRewardState, rewards, []) : {};
        const startTotal = numberAt(state, ['total', 'points', 'score']) || 0;
        const startLevel = state.level || numberAt(state, ['level']) || 1;
        const result = await call(award, rewards, [{ points: 40, reason: 'contract-test', trophy: 'first-win' }]);
        s.ok('加 40 分成功', result && result.ok !== false, JSON.stringify(result));
        state = getRewardState ? await call(getRewardState, rewards, []) : stateOf(result);
        s.eq('总分 +40', numberAt(state, ['total', 'points', 'score']), startTotal + 40);
        const level = state.level || numberAt(state, ['level']) || 1;
        s.ok('等级不下降', level >= startLevel, level + ' vs ' + startLevel);

        const invalid = await call(award, rewards, [{ points: -5 }]);
        s.ok('非正分被拒绝', invalid && invalid.ok === false, JSON.stringify(invalid));

        if (grantTrophy) {
          await call(grantTrophy, rewards, ['first-win']);
          state = await call(getRewardState, rewards, []);
          const trophies = arraysAt(state, ['trophies', 'awards']) || [];
          s.eq('奖杯不重复发放', trophies.filter(function (id) { return id === 'first-win'; }).length, 1);
        } else {
          s.skip('trophy contract', 'no grantTrophy export');
        }

        const high = await call(award, rewards, [{ points: 100000 }]);
        s.ok('超过单次上限被拒绝', high && high.ok === false, JSON.stringify(high));
      }
    });
  }

  // -------------------------------------------------------------------
  // share payload
  // -------------------------------------------------------------------
  const shareSources = [retentionApi, rewardsApi, probes.leaderboard.api].filter(Boolean);
  let share = null;
  for (const api of shareSources) {
    share = share || fnOf(api, SHARE_NAMES);
  }
  await s.group('share payload', async () => {
    if (!share) {
      s.skip('share contract', 'retention/rewards/leaderboard 都没有 buildSharePayload');
      return;
    }
    const payload = await call(share, null, [{
      matchId: 'match-abc', result: 'win', score: 120, rank: 3, title: '桌游对局'
    }]);
    s.ok('返回分享对象', payload && typeof payload === 'object', JSON.stringify(payload));
    if (!payload) return;
    const text = JSON.stringify(payload);
    s.includes('分享数据包含对局 id', text, 'match-abc');
    s.ok('分享数据含标题或文案', typeof payload.title === 'string' || typeof payload.text === 'string',
      JSON.stringify(payload));
    s.ok('分享数据含链接或可拼链接字段',
      typeof payload.url === 'string' || typeof payload.shareUrl === 'string' || typeof payload.href === 'string',
      JSON.stringify(payload));
    s.eq('分享数据不含个人信息', containsPii(payload), []);
    s.ok('分享数据长度可控 (<2000)', text.length < 2000, String(text.length));
  });

  // -------------------------------------------------------------------
  // leaderboard / anti-cheat / anonymous device id
  // -------------------------------------------------------------------
  const lbProbe = probes.leaderboard;
  const lbApi = lbProbe.api;
  const lbFactory = lbApi && fnOf(lbApi, ['createLeaderboard']);
  const deviceIdFn = lbApi && (fnOf(lbApi, ['getOrCreateDeviceId']) || fnOf(lbApi, RETENTION.deviceId));

  if (!lbProbe.found) {
    s.skip('leaderboard contract', describeMissing(lbProbe, MODULES.leaderboard));
  } else if (lbProbe.error) {
    // reported above
  } else if (!lbFactory) {
    s.ok('leaderboard 模块暴露 createLeaderboard', false,
      'exports: ' + Object.keys(lbApi || {}).join(', '));
  } else {
    const maxScore = 1000;
    const maxPerMinute = 3;
    const boardStorage = fakeStorage();
    let clock = { now: Date.UTC(2026, 10, 10, 12, 0, 0) };
    const board = instantiate(lbFactory, {
      now: function () { return clock.now; },
      storage: boardStorage,
      maxScore: maxScore,
      maxPerMinute: maxPerMinute
    });
    const submit = fnOf(board, ['submit', 'submitScore']);
    const top = fnOf(board, ['top', 'getLeaderboard', 'list']);
    const reset = fnOf(board, ['reset']);

    await s.group('anonymous device id', async () => {
      if (!deviceIdFn) {
        s.skip('device id contract', 'no getOrCreateDeviceId export');
        return;
      }
      const idStorage = fakeStorage();
      const id = await call(deviceIdFn, null, [idStorage]);
      s.ok('设备 id 是非空字符串', typeof id === 'string' && id.length >= 8, String(id));
      if (typeof id !== 'string') return;
      s.ok('设备 id 不含个人信息', !/@|email|phone|name/i.test(id), id);
      const again = await call(deviceIdFn, null, [idStorage]);
      s.eq('同一 storage 返回稳定 id', again, id);
      const stored = Array.from(idStorage.map.entries()).map(function (entry) {
        return entry[0] + '=' + entry[1];
      }).join('\n');
      s.eq('storage 中不含个人信息', containsPii(stored), []);
      s.includes('storage 中持久化了 id', stored, id);
    });

    await s.group('leaderboard and anti-cheat', async () => {
      if (!submit) {
        s.skip('leaderboard contract', 'no submit/submitScore export');
        return;
      }
      const deviceId = deviceIdFn ? await call(deviceIdFn, null, [fakeStorage()]) : 'dev_test';
      if (reset) await call(reset, board, []);

      const ok = await call(submit, board, [{
        deviceId: deviceId, gameId: 'pokemon', nonce: 'n-1', score: 100, durationMs: 10000
      }]);
      s.ok('正常分数可提交', ok && ok.ok === true, JSON.stringify(ok));
      s.eq('正常分数不被标记', ok && ok.flagged, false);

      const replay = await call(submit, board, [{
        deviceId: deviceId, gameId: 'pokemon', nonce: 'n-1', score: 200, durationMs: 10000
      }]);
      s.ok('nonce 重放被拒绝', replay && replay.ok === false, JSON.stringify(replay));
      s.eq('重放错误码', replay && replay.code, 'E_REPLAY');

      const tooHigh = await call(submit, board, [{
        deviceId: deviceId, gameId: 'pokemon', nonce: 'n-2', score: maxScore + 1, durationMs: 10000
      }]);
      s.ok('超上限分数不进入榜单', tooHigh && tooHigh.ok === true && tooHigh.flagged === true,
        JSON.stringify(tooHigh));

      const tooFast = await call(submit, board, [{
        deviceId: deviceId, gameId: 'pokemon', nonce: 'n-3', score: 10, durationMs: 200
      }]);
      s.ok('异常时长（<1s）被标记', tooFast && tooFast.flagged === true, JSON.stringify(tooFast));

      if (top) {
        const list = await call(top, board, [10]);
        s.ok('排行榜返回数组', Array.isArray(list), JSON.stringify(list).slice(0, 200));
        if (Array.isArray(list)) {
          const sorted = list.every(function (entry, i) {
            return i === 0 || (list[i - 1].score || 0) >= (entry.score || 0);
          });
          s.ok('排行榜按分数降序', sorted);
          s.ok('超上限分数没有进入榜单', list.every(function (entry) { return entry.score <= maxScore; }),
            JSON.stringify(list.map(function (entry) { return entry.score; })));
          s.ok('榜单只存设备 hash，不落原始 deviceId',
            list.every(function (entry) { return entry.deviceId === undefined; }),
            JSON.stringify(list[0] || {}));
        }
      }

      const rateBoard = instantiate(lbFactory, {
        now: function () { return clock.now; },
        storage: fakeStorage(),
        maxScore: maxScore,
        maxPerMinute: maxPerMinute
      });
      const rateSubmit = fnOf(rateBoard, ['submit']);
      let rateRejected = null;
      for (let i = 0; i < maxPerMinute + 2; i += 1) {
        const result = await call(rateSubmit, rateBoard, [{
          deviceId: deviceId, gameId: 'pokemon', nonce: 'rate-' + i, score: 10, durationMs: 10000
        }]);
        if (result && result.ok === false && result.code === 'E_RATE') {
          rateRejected = result;
          break;
        }
        clock.now += 100;
      }
      s.ok('高频提交触发频率限制', rateRejected != null, JSON.stringify(rateRejected));
    });
  }
});

globalThis.localStorage = previousLocalStorage;
