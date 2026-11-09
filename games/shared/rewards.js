/* Shared rewards engine: XP, levels, streaks and trophies for every game.
   UMD: window.Rewards in the browser, module.exports in Node. No deps.

   XP: first game record +10; win +20; draw +8; loss +2 (participation counts);
   daily challenge +30; new trophy +15; streak bonus +5 x min(streak, 7) once
   per local day. XP never decreases, and the same game + kind + meta.nonce is
   ignored, so reloads and retried reports cannot farm XP.

   Counters: play/win/loss/draw/complete count a round; daily counts a daily
   challenge only; milestone records meta.key. perGame.bestStreak is that
   game's longest win run.

   Level: xpForLevel(n) = 100 + 60(n-1) + 10(n-1)^2 is the XP from n to n+1;
   levelOf(xp) picks the largest level whose cumulative threshold is <= xp
   (level 1 starts at 0). Tiers: Lv1-4 bronze, 5-9 silver, 10-19 gold, 20-34
   platinum, 35+ obsidian.

   Streak: local days; a repeated day counts once, a one-day gap resets to 1,
   a backwards clock neither resets nor re-awards. Storage: one JSON key,
   hhfa-rewards-v1; bad reads/parses/versions/shapes and a missing or throwing
   localStorage fall back to a fresh in-memory state without throwing.

   Trophies are thresholds over counters or game-reported milestone keys, never
   game-specific code. "Play every game" uses window.GAMES_TOTAL or 24.
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Rewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VERSION = '1.0.0', SCHEMA = 1, KEY = 'hhfa-rewards-v1';
  var TROPHY_XP = 15, SEEN_MAX = 200, MAX_ENC = 16384;

  var TIERS = [
    { id: 'bronze', min: 1, name: { zh: '青铜', en: 'Bronze', id: 'Perunggu' } },
    { id: 'silver', min: 5, name: { zh: '白银', en: 'Silver', id: 'Perak' } },
    { id: 'gold', min: 10, name: { zh: '黄金', en: 'Gold', id: 'Emas' } },
    { id: 'platinum', min: 20, name: { zh: '铂金', en: 'Platinum', id: 'Platinum' } },
    { id: 'obsidian', min: 35, name: { zh: '曜石', en: 'Obsidian', id: 'Obsidian' } }
  ];
  function copyName(n) { return { zh: n.zh, en: n.en, id: n.id }; }
  function tierOf(level) {
    var t = TIERS[0];
    for (var i = 1; i < TIERS.length; i++) if (level >= TIERS[i].min) t = TIERS[i];
    return { id: t.id, name: copyName(t.name) };
  }

  /* threshold(m) is the XP to reach level m+1; m(m+1)(2m+1) is divisible by 6,
     so divide by 3 first to stay integral. */
  function xpForLevel(n) { var k = n - 1; return 100 + 60 * k + 10 * k * k; }
  function threshold(m) { return 5 * m * (m + 1) * (2 * m + 1) / 3 + 20 * m * (m + 1) + 50 * m; }
  function levelOf(xp) {
    var v = typeof xp === 'number' && isFinite(xp) ? Math.floor(xp) : 0;
    if (v < 0) v = 0;
    var lo = 0, hi = 1, guard = 0;
    while (threshold(hi) <= v && guard++ < 2048) hi *= 2;
    if (!isFinite(hi) || hi > 1e300) hi = 1e300;
    while (lo + 1 < hi) {
      var mid = Math.floor((lo + hi) / 2);
      if (mid <= lo) break;
      if (threshold(mid) <= v) lo = mid; else hi = mid;
    }
    var level = lo + 1, into = v - threshold(lo), next = xpForLevel(level);
    if (!isFinite(into) || into < 0) into = 0;
    var p = next > 0 ? into / next : 0;
    return { level: level, tier: tierOf(level), xpIntoLevel: into, xpForNext: next,
      progress: p < 0 ? 0 : (p > 1 ? 1 : p) };
  }

  /* One row per trophy: id, 中/英/印尼 names, same for descriptions, tier,
     goal, counter. */
  function cnt(k) { return function (c) { return c[k]; }; }
  function ms(key) { return function (c) { return c.ms(key); }; }
  function everyGame() { return totalGames(); }
  var DEFS = [
    ['first-play', '初次登场', 'First Steps', 'Langkah Pertama', '第一次开始游戏', 'Start your first game', 'Mulai permainan pertama', 'bronze', 1, cnt('plays')],
    ['first-win', '首胜', 'First Win', 'Kemenangan Pertama', '赢得第一局', 'Win your first round', 'Menangkan babak pertama', 'bronze', 1, cnt('wins')],
    ['first-daily', '日常试炼', 'Daily Starter', 'Tantangan Pertama', '完成首次每日挑战', 'Finish a daily challenge', 'Selesaikan tantangan harian', 'bronze', 1, cnt('daily')],
    ['wins-10', '十胜', 'Ten Wins', 'Sepuluh Menang', '累计赢得十局', 'Win 10 rounds in total', 'Menang 10 babak', 'bronze', 10, cnt('wins')],
    ['wins-100', '百胜', 'Hundred Wins', 'Seratus Menang', '累计赢得百局', 'Win 100 rounds in total', 'Menang 100 babak', 'gold', 100, cnt('wins')],
    ['game-10-wins', '专精入门', 'Game Specialist', 'Spesialis Game', '单款游戏赢十局', 'Win 10 in one game', 'Menang 10 di satu game', 'silver', 10, cnt('maxWins')],
    ['game-50-wins', '专精大师', 'Game Master', 'Master Game', '单款游戏赢五十局', 'Win 50 in one game', 'Menang 50 di satu game', 'gold', 50, cnt('maxWins')],
    ['games-5', '多面手', 'Explorer', 'Penjelajah', '玩过五款游戏', 'Play 5 different games', 'Main 5 game berbeda', 'silver', 5, cnt('distinct')],
    ['games-12', '环球玩家', 'Globetrotter', 'Pengelana', '玩过十二款游戏', 'Play 12 different games', 'Main 12 game berbeda', 'gold', 12, cnt('distinct')],
    ['games-all', '全制霸', 'Completionist', 'Kolektor Lengkap', '玩遍所有游戏', 'Play every game', 'Mainkan semua game', 'platinum', everyGame, cnt('distinct')],
    ['streak-3', '三日不断', 'Three-Day Streak', 'Tiga Hari', '连续玩三天', 'Play 3 days in a row', 'Main 3 hari berturut', 'bronze', 3, cnt('bestStreak')],
    ['streak-7', '一周全勤', 'Week Streak', 'Seminggu Penuh', '连续玩七天', 'Play 7 days in a row', 'Main 7 hari berturut', 'silver', 7, cnt('bestStreak')],
    ['streak-30', '月度传说', 'Month Streak', 'Legenda Sebulan', '连续玩三十天', 'Play 30 days in a row', 'Main 30 hari berturut', 'obsidian', 30, cnt('bestStreak')],
    ['plays-100', '百局', 'Century', 'Seratus Ronde', '累计完成百局', 'Finish 100 rounds', 'Selesaikan 100 babak', 'silver', 100, cnt('plays')],
    ['plays-500', '五百局', 'Marathon', 'Maraton', '累计完成五百局', 'Finish 500 rounds', 'Selesaikan 500 babak', 'gold', 500, cnt('plays')],
    ['daily-10', '日常达人', 'Daily Devotee', 'Penggemar Harian', '完成十次每日挑战', 'Finish 10 daily challenges', 'Selesaikan 10 tantangan harian', 'gold', 10, cnt('daily')],
    ['tier-silver', '白银段位', 'Silver Rank', 'Peringkat Perak', '达到白银段位', 'Reach Silver tier', 'Capai tier Perak', 'silver', 5, cnt('level')],
    ['tier-gold', '黄金段位', 'Gold Rank', 'Peringkat Emas', '达到黄金段位', 'Reach Gold tier', 'Capai tier Emas', 'gold', 10, cnt('level')],
    ['tier-platinum', '铂金段位', 'Platinum Rank', 'Peringkat Platinum', '达到铂金段位', 'Reach Platinum tier', 'Capai tier Platinum', 'platinum', 20, cnt('level')],
    ['tier-obsidian', '曜石段位', 'Obsidian Rank', 'Peringkat Obsidian', '达到曜石段位', 'Reach Obsidian tier', 'Capai tier Obsidian', 'obsidian', 35, cnt('level')],
    ['milestone-one-shot', '一击制胜', 'One Shot', 'Sekali Coba', '一次机会内取胜', 'Win in one attempt', 'Menang sekali coba', 'silver', 1, ms('one-shot')],
    ['milestone-flawless', '零失误', 'Flawless', 'Tanpa Cela', '全程没有失误', 'Finish without mistakes', 'Selesai tanpa kesalahan', 'gold', 1, ms('flawless')],
    ['milestone-comeback', '逆风翻盘', 'Comeback', 'Bangkit Kembali', '落后后反败为胜', 'Win after falling behind', 'Menang setelah tertinggal', 'gold', 1, ms('comeback')],
    ['milestone-full-house', '满堂彩', 'Full House', 'Full House', '拿下全部目标', 'Clear every objective', 'Tuntaskan semua target', 'platinum', 1, ms('full-house')]
  ];
  var TROPHIES = [], TROPHY_BY_ID = Object.create(null);
  for (var di = 0; di < DEFS.length; di++) {
    var d = DEFS[di], t = TROPHIES[di] = {
      id: d[0], name: { zh: d[1], en: d[2], id: d[3] },
      desc: { zh: d[4], en: d[5], id: d[6] },
      tier: d[7], icon: d[0], goal: d[8], cur: d[9]
    };
    TROPHY_BY_ID[t.id] = t;
  }
  function totalGames() {
    var n = root && root.GAMES_TOTAL;
    return typeof n === 'number' && isFinite(n) && n >= 1 ? Math.floor(n) : 24;
  }
  function goalOf(t) {
    var g = typeof t.goal === 'function' ? t.goal() : t.goal;
    return g > 0 ? g : 1;
  }

  /* Helpers */
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function safeInt(v, d) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : d; }
  function safeStr(v, max) {
    if (typeof v !== 'string' || v.length < 1 || v.length > max || !/^[A-Za-z0-9_.-]+$/.test(v)) return null;
    return v === '__proto__' || v === 'constructor' || v === 'prototype' ? null : v;
  }
  function safeSlug(v) { return safeStr(v, 64); }
  function safeKey(v) { return safeStr(v, 40); }
  function safeDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dayOf(msv) {
    var d = new Date(msv);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // Whole days from day a to day b, or null when a is malformed.
  function dayDiff(a, b) {
    var A = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a), B = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
    if (!A || !B) return null;
    return Math.round((Date.UTC(+B[1], B[2] - 1, +B[3]) - Date.UTC(+A[1], A[2] - 1, +A[3])) / 86400000);
  }

  /* State and storage */
  var state = null;
  function freshState() {
    return { v: SCHEMA, xp: 0, streak: { current: 0, best: 0, lastDay: null },
      plays: 0, wins: 0, losses: 0, draws: 0, daily: 0,
      perGame: Object.create(null), trophies: Object.create(null),
      milestones: Object.create(null), seen: Object.create(null) };
  }
  function sanitizeState(o) {
    if (!o || typeof o !== 'object' || o.v !== SCHEMA) return null;
    var s = freshState(), i, k, v, nums = ['xp', 'plays', 'wins', 'losses', 'draws', 'daily'];
    for (i = 0; i < nums.length; i++) s[nums[i]] = safeInt(o[nums[i]], 0);
    var st = o.streak;
    if (st && typeof st === 'object') {
      s.streak.current = safeInt(st.current, 0);
      s.streak.best = Math.max(safeInt(st.best, 0), s.streak.current);
      s.streak.lastDay = safeDay(st.lastDay);
    }
    var pg = o.perGame;
    if (pg && typeof pg === 'object') {
      var gk = Object.keys(pg).slice(0, 500);
      for (i = 0; i < gk.length; i++) {
        k = safeSlug(gk[i]); v = pg[gk[i]];
        if (k && v && typeof v === 'object') {
          s.perGame[k] = { plays: safeInt(v.plays, 0), wins: safeInt(v.wins, 0),
            winStreak: safeInt(v.winStreak, 0), bestStreak: safeInt(v.bestStreak, 0) };
        }
      }
    }
    var tr = o.trophies;
    if (tr && typeof tr === 'object') {
      var tk = Object.keys(tr);
      for (i = 0; i < tk.length && i < TROPHIES.length; i++) {
        if (TROPHY_BY_ID[tk[i]]) s.trophies[tk[i]] = safeDay(tr[tk[i]]);
      }
    }
    var mso = o.milestones;
    if (mso && typeof mso === 'object') {
      var mk = Object.keys(mso);
      for (i = 0; i < mk.length && i < 100; i++) {
        k = safeKey(mk[i]);
        if (k && mso[mk[i]]) s.milestones[k] = true;
      }
    }
    var se = o.seen;
    if (se && typeof se === 'object') {
      var sk = Object.keys(se).slice(-SEEN_MAX);
      for (i = 0; i < sk.length; i++) {
        if (typeof sk[i] === 'string' && sk[i].length <= 200 && se[sk[i]] && !hasOwn(s.seen, sk[i])) {
          s.seen[sk[i]] = true;
        }
      }
    }
    return s;
  }
  function getStore() {
    try {
      var st = root && root.localStorage;
      return st && typeof st.getItem === 'function' && typeof st.setItem === 'function' ? st : null;
    } catch (e) { return null; }
  }
  function load() {
    if (state) return;
    state = freshState();
    var st = getStore(), raw, clean;
    if (!st) return;
    try { raw = st.getItem(KEY); } catch (e) { return; }
    if (typeof raw !== 'string' || !raw) return;
    try { clean = sanitizeState(JSON.parse(raw)); } catch (e) { return; }
    if (clean) state = clean;
  }
  function persist() {
    var st = getStore();
    if (!st) return;
    try { st.setItem(KEY, JSON.stringify(state)); } catch (e) { /* memory only */ }
  }
  function rememberSeen(k) {
    if (hasOwn(state.seen, k)) return;
    state.seen[k] = true;
    var ks = Object.keys(state.seen);
    while (ks.length > SEEN_MAX) delete state.seen[ks.shift()];
  }

  /* Evaluation: trophy XP can push the player into a tier whose trophy unlocks
     on the next pass, so keep scanning until a pass adds nothing. */
  function context() {
    var distinct = 0, maxWins = 0, pgs = state.perGame;
    for (var k in pgs) {
      if (!hasOwn(pgs, k)) continue;
      distinct++;
      if (pgs[k].wins > maxWins) maxWins = pgs[k].wins;
    }
    return { plays: state.plays, wins: state.wins, losses: state.losses, draws: state.draws,
      daily: state.daily, distinct: distinct, maxWins: maxWins,
      level: levelOf(state.xp).level, bestStreak: state.streak.best,
      ms: function (key) { return state.milestones[key] ? 1 : 0; } };
  }
  function evaluateTrophies(today) {
    var out = [], added = true, guard = 0, i, t, c, goal;
    while (added && guard++ < 64) {
      added = false; c = context();
      for (i = 0; i < TROPHIES.length; i++) {
        t = TROPHIES[i];
        if (hasOwn(state.trophies, t.id)) continue;
        goal = goalOf(t);
        if (t.cur(c) >= goal) {
          state.trophies[t.id] = today; state.xp += TROPHY_XP;
          out.push(t.id); added = true;
        }
      }
    }
    return out;
  }
  function publicTrophy(t, c) {
    c = c || context();
    var goal = goalOf(t), cur = t.cur(c), unlocked = hasOwn(state.trophies, t.id);
    if (cur < 0) cur = 0;
    if (cur > goal) cur = goal;
    return { id: t.id, name: copyName(t.name), desc: copyName(t.desc),
      tier: t.tier, icon: t.icon, unlocked: unlocked,
      unlockedAt: unlocked ? state.trophies[t.id] : null,
      progress: { cur: cur, max: goal } };
  }

  /* Streak: today's bonus, or 0 when the day was already counted or the clock
     moved backwards. */
  function updateStreak(today) {
    var st = state.streak;
    if (!st.lastDay) {
      st.current = 1; st.best = Math.max(st.best, 1); st.lastDay = today; return 5;
    }
    var diff = dayDiff(st.lastDay, today);
    if (diff === null) {
      st.current = 1; st.best = Math.max(st.best, 1); st.lastDay = today; return 5;
    }
    if (diff <= 0) return 0;
    st.current = diff === 1 ? st.current + 1 : 1;
    if (st.current > st.best) st.best = st.current;
    st.lastDay = today;
    return 5 * Math.min(st.current, 7);
  }

  /* Record */
  var KINDS = ['play', 'win', 'loss', 'draw', 'complete', 'daily', 'milestone'];
  function record(evt) {
    load();
    var zero = { xpGained: 0, newTrophies: [], levelUp: false, state: getState() };
    if (!evt || typeof evt !== 'object') return zero;
    var slug = safeSlug(evt.game), kind = typeof evt.kind === 'string' ? evt.kind : '';
    if (!slug || KINDS.indexOf(kind) < 0) return zero;
    var meta = evt.meta && typeof evt.meta === 'object' ? evt.meta : {};
    var nonce = typeof meta.nonce === 'string' || typeof meta.nonce === 'number'
      ? String(meta.nonce).slice(0, 120) : null;
    var seenKey = nonce ? slug + '|' + kind + '|' + nonce : null;
    if (seenKey && hasOwn(state.seen, seenKey)) return zero;

    var xp0 = state.xp, level0 = levelOf(xp0).level, today = dayOf(Date.now());
    state.xp += updateStreak(today);
    var pg = hasOwn(state.perGame, slug) ? state.perGame[slug] : null;
    if (!pg) {
      pg = state.perGame[slug] = { plays: 0, wins: 0, winStreak: 0, bestStreak: 0 };
      state.xp += 10; // first time this game is recorded
    }
    if (kind === 'play') {
      state.plays++; pg.plays++;
    } else if (kind === 'win') {
      state.plays++; state.wins++; pg.plays++; pg.wins++; pg.winStreak++;
      if (pg.winStreak > pg.bestStreak) pg.bestStreak = pg.winStreak;
      state.xp += 20;
    } else if (kind === 'loss') {
      state.plays++; state.losses++; pg.plays++; pg.winStreak = 0; state.xp += 2;
    } else if (kind === 'draw') {
      state.plays++; state.draws++; pg.plays++; pg.winStreak = 0; state.xp += 8;
    } else if (kind === 'complete') {
      state.plays++; pg.plays++;
    } else if (kind === 'daily') {
      state.daily++; state.xp += 30;
    } else {
      var key = safeKey(meta.key);
      if (key) state.milestones[key] = true;
    }

    var ids = evaluateTrophies(today), gained = [], i, c = context();
    if (seenKey) rememberSeen(seenKey);
    persist();
    for (i = 0; i < ids.length; i++) gained.push(publicTrophy(TROPHY_BY_ID[ids[i]], c));
    return { xpGained: state.xp - xp0, newTrophies: gained,
      levelUp: levelOf(state.xp).level > level0, state: getState() };
  }

  /* Public API */
  function getState() {
    load();
    var info = levelOf(state.xp), perGame = {}, k;
    for (k in state.perGame) {
      if (!hasOwn(state.perGame, k)) continue;
      perGame[k] = { plays: state.perGame[k].plays, wins: state.perGame[k].wins,
        bestStreak: state.perGame[k].bestStreak };
    }
    return { xp: state.xp, level: info.level, tier: info.tier,
      xpIntoLevel: info.xpIntoLevel, xpForNext: info.xpForNext, progress: info.progress,
      streak: { current: state.streak.current, best: state.streak.best,
        lastDay: state.streak.lastDay },
      plays: state.plays, wins: state.wins, losses: state.losses, draws: state.draws,
      perGame: perGame, trophyCount: Object.keys(state.trophies).length,
      trophyTotal: TROPHIES.length };
  }
  function trophies() {
    load();
    var c = context(), out = [], i;
    for (i = 0; i < TROPHIES.length; i++) out.push(publicTrophy(TROPHIES[i], c));
    return out;
  }
  function reset() {
    state = freshState();
    var st = getStore();
    if (st) { try { st.removeItem(KEY); } catch (e) { /* memory only */ } }
  }

  /* Encode/decode. The compact JSON is ASCII (slugs, ids, days, numbers), so
     plain base64 over the binary string is enough; no UTF-8 codec needed. */
  function b64urlEncode(str) {
    var b;
    if (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.from === 'function') {
      b = Buffer.from(str, 'latin1').toString('base64');
    } else if (root && typeof root.btoa === 'function') {
      b = root.btoa(str);
    } else { throw new Error('no base64 encoder'); }
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.from === 'function') {
      return Buffer.from(s, 'base64').toString('latin1');
    }
    if (!root || typeof root.atob !== 'function') throw new Error('no base64 decoder');
    return root.atob(s);
  }
  function strictInt(v) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return null;
    v = Math.floor(v);
    return v <= Number.MAX_SAFE_INTEGER ? v : null;
  }
  function encodeState() {
    load();
    var games = [], ts = [], k, g, id;
    for (k in state.perGame) {
      if (!hasOwn(state.perGame, k)) continue;
      g = state.perGame[k];
      games.push([k, g.plays, g.wins, g.bestStreak]);
    }
    for (id in state.trophies) {
      if (hasOwn(state.trophies, id)) ts.push([id, state.trophies[id]]);
    }
    return b64urlEncode(JSON.stringify({ v: SCHEMA, x: state.xp,
      s: [state.streak.current, state.streak.best, state.streak.lastDay],
      c: [state.plays, state.wins, state.losses, state.draws, state.daily],
      g: games, t: ts }));
  }
  function decodeState(str) {
    if (typeof str !== 'string' || str.length < 1 || str.length > MAX_ENC ||
      !/^[A-Za-z0-9_-]+$/.test(str)) return null;
    var o;
    try { o = JSON.parse(b64urlDecode(str)); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== SCHEMA) return null;
    var s = o.s, c = o.c, i, n;
    if (!Array.isArray(s) || s.length < 3 || !Array.isArray(c) || c.length < 5) return null;
    var xp = strictInt(o.x), cur = strictInt(s[0]), best = strictInt(s[1]);
    var lastDay = s[2] === null || s[2] === undefined ? null : safeDay(s[2]);
    if (xp === null || cur === null || best === null) return null;
    if (lastDay === null && s[2] !== null && s[2] !== undefined) return null;
    var nums = [];
    for (i = 0; i < 5; i++) {
      n = strictInt(c[i]);
      if (n === null) return null;
      nums.push(n);
    }
    var perGame = {};
    if (o.g !== undefined) {
      if (!Array.isArray(o.g) || o.g.length > 500) return null;
      for (i = 0; i < o.g.length; i++) {
        var row = o.g[i];
        if (!Array.isArray(row) || row.length < 4) return null;
        var slug = safeSlug(row[0]), a = strictInt(row[1]), b = strictInt(row[2]),
          d = strictInt(row[3]);
        if (!slug || a === null || b === null || d === null) return null;
        perGame[slug] = { plays: a, wins: b, bestStreak: d };
      }
    }
    var ids = [], seen = Object.create(null);
    if (o.t !== undefined) {
      if (!Array.isArray(o.t) || o.t.length > TROPHIES.length) return null;
      for (i = 0; i < o.t.length; i++) {
        var tr = o.t[i];
        if (!Array.isArray(tr) || tr.length < 2 || !TROPHY_BY_ID[tr[0]] || seen[tr[0]]) return null;
        if (tr[1] !== null && safeDay(tr[1]) === null) return null;
        seen[tr[0]] = 1; ids.push(tr[0]);
      }
    }
    var info = levelOf(xp);
    return { xp: xp, level: info.level, tier: info.tier,
      xpIntoLevel: info.xpIntoLevel, xpForNext: info.xpForNext, progress: info.progress,
      streak: { current: cur, best: best, lastDay: lastDay },
      plays: nums[0], wins: nums[1], losses: nums[2], draws: nums[3], daily: nums[4],
      perGame: perGame, trophyCount: ids.length, trophyTotal: TROPHIES.length,
      trophies: ids };
  }

  return { version: VERSION, record: record, getState: getState, levelOf: levelOf,
    trophies: trophies, encodeState: encodeState, decodeState: decodeState, reset: reset };
});
