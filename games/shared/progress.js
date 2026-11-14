/* 统一进度/留存模块（UMD）。
 *
 *   window.GameProgress / require('./progress.js')
 *
 * 目标：给 453 个入口页一条共同的留存回路——
 *   - 每日挑战：同一天同一游戏得到同一个种子（可复现、可比较）
 *   - 连胜：当天完成每日挑战记一次，断天归零
 *   - 最好成绩：本地历史最好分
 * 依赖 Store（games/shared/store.js）；没有 Store 时退回 localStorage。
 * 只做数据与规则，不碰 DOM。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GameProgress = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var NS = 'gp.v1.';

  function storage() {
    if (root && root.Store && typeof root.Store.get === 'function') return root.Store;
    if (root && root.localStorage) {
      return {
        get: function (k, d) { try { var v = root.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
        set: function (k, v) { try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
      };
    }
    var mem = {};
    return {
      get: function (k, d) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d; },
      set: function (k, v) { mem[k] = v; return true; }
    };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // Local calendar day (not UTC): daily reset follows the player's clock.
  function dayKey(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function hash(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // Same slug + same day -> same seed, so players see the same challenge.
  function dailySeed(slug, date) {
    return hash(String(slug) + '|' + dayKey(date)) % 1000000 + 1;
  }

  function key(slug, name) { return NS + slug + '.' + name; }

  function stats(slug) {
    var s = storage();
    return {
      best: Number(s.get(key(slug, 'best'), 0)) || 0,
      streak: Number(s.get(key(slug, 'streak'), 0)) || 0,
      lastDay: String(s.get(key(slug, 'lastDay'), '') || ''),
      dailyDone: String(s.get(key(slug, 'dailyDone'), '') || ''),
      runs: Number(s.get(key(slug, 'runs'), 0)) || 0
    };
  }

  /**
   * record({slug, mode:'daily'|'free', score, won, date})
   * - best: max(score)
   * - runs: +1
   * - daily: only once per day; counts streak (+1 if lastDay is yesterday,
   *   else 1). Free runs never touch streak.
   * 返回更新后的 stats 与本次是否计入每日。
   */
  function record(entry) {
    var s = storage();
    var slug = String(entry.slug || '');
    if (!slug) throw new Error('record: slug required');
    var cur = stats(slug);
    var score = Number(entry.score) || 0;
    var now = entry.date || new Date();
    var today = dayKey(now);
    var countedDaily = false;

    if (score > cur.best) { cur.best = score; s.set(key(slug, 'best'), cur.best); }
    cur.runs += 1;
    s.set(key(slug, 'runs'), cur.runs);

    if (entry.mode === 'daily' && cur.dailyDone !== today) {
      var yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      cur.streak = cur.lastDay === yesterday ? cur.streak + 1 : 1;
      cur.lastDay = today;
      cur.dailyDone = today;
      countedDaily = true;
      s.set(key(slug, 'streak'), cur.streak);
      s.set(key(slug, 'lastDay'), today);
      s.set(key(slug, 'dailyDone'), today);
    } else if (entry.mode === 'daily' && cur.dailyDone === today && entry.force) {
      countedDaily = false; // idempotent by default; force only records the run
    }

    return { stats: cur, countedDaily: countedDaily, today: today };
  }

  function dailyState(slug, date) {
    var today = dayKey(date);
    var cur = stats(slug);
    return { today: today, done: cur.dailyDone === today, streak: cur.streak, seed: dailySeed(slug, date) };
  }

  return {
    dayKey: dayKey,
    dailySeed: dailySeed,
    stats: stats,
    record: record,
    dailyState: dailyState,
    keyPrefix: NS
  };
});
