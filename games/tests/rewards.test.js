#!/usr/bin/env node
'use strict';

/*
 * Contract + robustness tests for games/shared/rewards.js.
 *
 * Run: node games/tests/rewards.test.js
 *
 * The engine talks to localStorage and Date.now at call time, so the suite
 * injects a mock store and a fake clock instead of touching the machine.
 * Fresh module instances are used wherever "reload the page" matters.
 */

var lib = require('./lib.js');
var ENGINE = '../shared/rewards.js';
var KEY = 'hhfa-rewards-v1';

var s = lib.suite('shared/rewards');

/* ------------------------------- test harness ------------------------------ */

function mockStore(raw) {
  var map = Object.create(null);
  if (raw !== undefined) map[KEY] = raw;
  return {
    getItem: function (k) { return k in map ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; },
    dump: function () { return map; }
  };
}

function freshEngine() {
  delete require.cache[require.resolve(ENGINE)];
  return require(ENGINE);
}

var clock = { ms: new Date(2026, 0, 10, 12, 0, 0).getTime() };
var realNow = Date.now;
Date.now = function () { return clock.ms; };
function setDay(y, m, d) { clock.ms = new Date(y, m - 1, d, 12, 0, 0).getTime(); }

function findTrophy(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function ids(list) { return list.map(function (t) { return t.id; }); }

var store = mockStore();
globalThis.localStorage = store;
var R = freshEngine();

/* -------------------------------- level curve ------------------------------ */

s.group('levelOf / tiers', function () {
  var l0 = R.levelOf(0);
  s.eq('levelOf(0).level', l0.level, 1);
  s.eq('levelOf(0).xpIntoLevel', l0.xpIntoLevel, 0);
  s.eq('levelOf(0).xpForNext', l0.xpForNext, 100);
  s.near('levelOf(0).progress', l0.progress, 0);
  s.eq('levelOf(0).tier', l0.tier.id, 'bronze');
  s.eq('tier has three names', [!!l0.tier.name.zh, !!l0.tier.name.en, !!l0.tier.name.id],
    [true, true, true]);

  s.eq('levelOf(99).level', R.levelOf(99).level, 1);
  s.eq('levelOf(99).into', R.levelOf(99).xpIntoLevel, 99);
  s.eq('levelOf(100).level', R.levelOf(100).level, 2);
  s.eq('levelOf(100).into', R.levelOf(100).xpIntoLevel, 0);
  s.eq('levelOf(100).next', R.levelOf(100).xpForNext, 170);
  s.eq('levelOf(269).level', R.levelOf(269).level, 2);
  s.eq('levelOf(269).into', R.levelOf(269).xpIntoLevel, 169);
  s.eq('levelOf(270).level', R.levelOf(270).level, 3);
  s.eq('levelOf(900).level', R.levelOf(900).level, 5);
  s.eq('levelOf(899).level', R.levelOf(899).level, 4);
  s.eq('levelOf(899).tier', R.levelOf(899).tier.id, 'bronze');
  s.eq('levelOf(900).tier', R.levelOf(900).tier.id, 'silver');
  s.eq('levelOf(3880).level', R.levelOf(3880).level, 9);
  s.eq('levelOf(3880).tier', R.levelOf(3880).tier.id, 'silver');
  s.eq('levelOf(5100).level', R.levelOf(5100).level, 10);
  s.eq('levelOf(5100).tier', R.levelOf(5100).tier.id, 'gold');
  s.eq('levelOf(33250).level', R.levelOf(33250).level, 20);
  s.eq('levelOf(33250).tier', R.levelOf(33250).tier.id, 'platinum');
  s.eq('levelOf(162349).level', R.levelOf(162349).level, 34);
  s.eq('levelOf(162349).tier', R.levelOf(162349).tier.id, 'platinum');
  s.eq('levelOf(162350).level', R.levelOf(162350).level, 35);
  s.eq('levelOf(162350).tier', R.levelOf(162350).tier.id, 'obsidian');

  var l1000 = R.levelOf(1000);
  s.eq('levelOf(1000).level', l1000.level, 5);
  s.eq('levelOf(1000).into', l1000.xpIntoLevel, 100);
  s.eq('levelOf(1000).next', l1000.xpForNext, 500);
  s.near('levelOf(1000).progress', l1000.progress, 0.2);
  s.eq('levelOf(1000).tier', l1000.tier.id, 'silver');

  var l10000 = R.levelOf(10000);
  s.eq('levelOf(10000).level', l10000.level, 12);
  s.eq('levelOf(10000).into', l10000.xpIntoLevel, 1750);
  s.eq('levelOf(10000).next', l10000.xpForNext, 1970);

  var mono = true, prev = 0;
  for (var x = 0; x <= 6000; x += 13) {
    var lv = R.levelOf(x).level;
    if (lv < prev) mono = false;
    prev = lv;
  }
  s.ok('levelOf monotonic over 0..6000', mono);

  var edges = [1, 99, 100, 101, 269, 270, 271, 899, 900, 901, 5099, 5100, 5101, 162349, 162350];
  var edgeOk = true;
  for (var e = 0; e < edges.length; e++) {
    if (R.levelOf(edges[e]).level < R.levelOf(edges[e] - 1).level) edgeOk = false;
  }
  s.ok('levelOf monotonic at every threshold', edgeOk);

  s.ok('levelOf(1e9) finite', isFinite(R.levelOf(1e9).level) && R.levelOf(1e9).level > 0);
  s.eq('levelOf negative is safe', R.levelOf(-5).level, 1);
  s.eq('levelOf NaN is safe', R.levelOf(NaN).level, 1);
  s.eq('levelOf not-a-number is safe', R.levelOf('oops').level, 1);
});

/* ------------------------------ xp accounting ------------------------------ */

s.group('xp accounting', function () {
  setDay(2026, 1, 10);
  R.reset();

  var r = R.record({ game: 'alpha', kind: 'play', meta: { nonce: 'a1' } });
  s.eq('first play xpGained (10 + 5 streak + 15 trophy)', r.xpGained, 30);
  s.eq('first play total xp', r.state.xp, 30);
  s.eq('first play plays', r.state.plays, 1);
  s.eq('first play levelUp', r.levelUp, false);
  s.eq('first play newTrophies', ids(r.newTrophies), ['first-play']);
  s.eq('new trophy has zh name', r.newTrophies[0].name.zh, '初次登场');

  r = R.record({ game: 'alpha', kind: 'play', meta: { nonce: 'a1' } });
  s.eq('duplicate nonce xpGained', r.xpGained, 0);
  s.eq('duplicate nonce xp unchanged', r.state.xp, 30);
  s.eq('duplicate nonce plays unchanged', r.state.plays, 1);
  s.eq('duplicate nonce no trophies', r.newTrophies.length, 0);

  r = R.record({ game: 'alpha', kind: 'play' });
  s.eq('same-day repeat gives no xp', r.xpGained, 0);
  s.eq('same-day repeat still counts a play', r.state.plays, 2);

  r = R.record({ game: 'alpha', kind: 'win', meta: { nonce: 'w1' } });
  s.eq('win xpGained (20 + 15 first-win)', r.xpGained, 35);
  s.eq('win total xp', r.state.xp, 65);
  s.eq('win count', r.state.wins, 1);
  s.eq('win increments plays', r.state.plays, 3);
  s.eq('win unlocks first-win', ids(r.newTrophies), ['first-win']);

  r = R.record({ game: 'alpha', kind: 'loss', meta: { nonce: 'l1' } });
  s.eq('loss pays participation xp', r.xpGained, 2);
  s.eq('loss count', r.state.losses, 1);

  r = R.record({ game: 'beta', kind: 'draw', meta: { nonce: 'd1' } });
  s.eq('draw on a new game (10 + 8)', r.xpGained, 18);
  s.eq('draw count', r.state.draws, 1);
  s.eq('perGame beta plays', r.state.perGame.beta.plays, 1);
  s.eq('perGame beta recorded', Object.keys(r.state.perGame).length, 2);

  r = R.record({ game: 'alpha', kind: 'complete', meta: { nonce: 'c1' } });
  s.eq('complete has no base xp', r.xpGained, 0);
  s.eq('complete counts a play', r.state.plays, 6);

  r = R.record({ game: 'alpha', kind: 'daily', meta: { nonce: 'day1' } });
  s.eq('daily xpGained (30 + 15 first-daily)', r.xpGained, 45);
  s.eq('daily leaves plays alone', r.state.plays, 6);
  s.ok('daily unlocks first-daily', findTrophy(R.trophies(), 'first-daily').unlocked);

  r = R.record({ game: 'alpha', kind: 'draw', meta: { nonce: 'w1' } });
  s.eq('same nonce reused for another kind still counts', r.xpGained, 8);

  var levelUpOnCross = false;
  for (var i = 0; i < 7; i++) {
    r = R.record({ game: 'alpha', kind: 'win', meta: { nonce: 'x' + i } });
    if (r.levelUp) levelUpOnCross = true;
  }
  // 130 + 8 (draw) + 7*20 = 278 -> level 3
  s.eq('level crossed to 3', r.state.level, 3);
  s.eq('xp after seven wins', r.state.xp, 278);
  s.ok('levelUp reports the crossing', levelUpOnCross);
  s.eq('wins counted', r.state.wins, 8);

  var before = R.getState().xp;
  var bad = R.record({ game: '../../etc/passwd', kind: 'win' });
  s.eq('invalid slug ignored', bad.xpGained, 0);
  s.eq('invalid slug does not change xp', R.getState().xp, before);
  s.eq('null event ignored', R.record(null).xpGained, 0);
  s.eq('unknown kind ignored', R.record({ game: 'alpha', kind: 'nope' }).xpGained, 0);
  s.ok('xp never decreases', R.getState().xp >= before);
});

/* ---------------------------------- streak --------------------------------- */

s.group('streak / clock defence', function () {
  setDay(2026, 1, 10);
  R.reset();

  var r = R.record({ game: 's', kind: 'play', meta: { nonce: 's1' } });
  s.eq('day one streak', r.state.streak.current, 1);
  s.eq('day one best', r.state.streak.best, 1);
  s.eq('day one lastDay', r.state.streak.lastDay, '2026-01-10');

  r = R.record({ game: 's', kind: 'win', meta: { nonce: 's2' } });
  s.eq('same day does not raise streak', r.state.streak.current, 1);
  s.eq('same day gives no streak bonus', r.xpGained, 35); // 20 win + 15 first-win

  setDay(2026, 1, 11);
  r = R.record({ game: 's', kind: 'play', meta: { nonce: 's3' } });
  s.eq('next day streak increments', r.state.streak.current, 2);
  s.eq('next day bonus is 5*2', r.xpGained, 10);

  setDay(2026, 1, 13); // skip the 12th
  r = R.record({ game: 's', kind: 'play', meta: { nonce: 's4' } });
  s.eq('gap resets streak to 1', r.state.streak.current, 1);
  s.eq('gap bonus is 5*1', r.xpGained, 5);
  s.eq('best streak is remembered', r.state.streak.best, 2);
  s.eq('lastDay after gap', r.state.streak.lastDay, '2026-01-13');

  setDay(2026, 1, 12); // clock moves backwards one day
  r = R.record({ game: 's', kind: 'play', meta: { nonce: 's5' } });
  s.eq('clock backwards gives no bonus', r.xpGained, 0);
  s.eq('clock backwards keeps streak', r.state.streak.current, 1);
  s.eq('clock backwards keeps lastDay', r.state.streak.lastDay, '2026-01-13');
  s.eq('clock backwards keeps best', r.state.streak.best, 2);

  setDay(2026, 1, 14);
  r = R.record({ game: 's', kind: 'play', meta: { nonce: 's6' } });
  s.eq('forward again resumes from lastDay', r.state.streak.current, 2);
  s.eq('forward again pays 5*2', r.xpGained, 10);

  // streak-3 trophy over three consecutive days
  setDay(2026, 2, 1);
  R.reset();
  R.record({ game: 't', kind: 'play', meta: { nonce: 't1' } });
  setDay(2026, 2, 2);
  R.record({ game: 't', kind: 'play', meta: { nonce: 't2' } });
  setDay(2026, 2, 3);
  r = R.record({ game: 't', kind: 'play', meta: { nonce: 't3' } });
  s.eq('third day streak', r.state.streak.current, 3);
  s.eq('third day bonus 5*3 plus trophy', r.xpGained, 30);
  s.ok('streak-3 unlocked', findTrophy(R.trophies(), 'streak-3').unlocked);
});

/* --------------------------------- trophies -------------------------------- */

s.group('trophies by counters', function () {
  setDay(2026, 3, 1);
  R.reset();

  var all = findTrophy(R.trophies(), 'games-all');
  s.eq('games-all default target is 24', all.progress.max, 24);

  var i;
  for (i = 1; i <= 5; i++) R.record({ game: 'g' + i, kind: 'play', meta: { nonce: 'p' + i } });
  s.ok('games-5 unlocked after five games', findTrophy(R.trophies(), 'games-5').unlocked);
  s.eq('games-5 progress', findTrophy(R.trophies(), 'games-5').progress, { cur: 5, max: 5 });
  s.ok('games-12 still locked', !findTrophy(R.trophies(), 'games-12').unlocked);

  for (i = 6; i <= 12; i++) R.record({ game: 'g' + i, kind: 'play', meta: { nonce: 'p' + i } });
  s.ok('games-12 unlocked', findTrophy(R.trophies(), 'games-12').unlocked);

  globalThis.GAMES_TOTAL = 13;
  R.record({ game: 'g13', kind: 'play', meta: { nonce: 'p13' } });
  s.ok('games-all uses GAMES_TOTAL', findTrophy(R.trophies(), 'games-all').unlocked);
  delete globalThis.GAMES_TOTAL;

  // one game, ten wins and then fifty
  R.reset();
  for (i = 1; i <= 10; i++) R.record({ game: 'solo', kind: 'win', meta: { nonce: 'w' + i } });
  s.ok('game-10-wins unlocked', findTrophy(R.trophies(), 'game-10-wins').unlocked);
  s.ok('wins-10 unlocked', findTrophy(R.trophies(), 'wins-10').unlocked);
  s.eq('wins-10 progress', findTrophy(R.trophies(), 'wins-10').progress, { cur: 10, max: 10 });
  s.ok('wins-100 still locked', !findTrophy(R.trophies(), 'wins-100').unlocked);

  for (i = 11; i <= 50; i++) R.record({ game: 'solo', kind: 'win', meta: { nonce: 'w' + i } });
  s.ok('game-50-wins unlocked', findTrophy(R.trophies(), 'game-50-wins').unlocked);
  s.ok('tier-silver unlocked on the way', findTrophy(R.trophies(), 'tier-silver').unlocked);
  s.eq('state has fifty wins', R.getState().wins, 50);
  s.eq('state has fifty plays', R.getState().plays, 50);

  for (i = 1; i <= 50; i++) R.record({ game: 'solo', kind: 'play', meta: { nonce: 'p' + i } });
  s.eq('state has one hundred plays', R.getState().plays, 100);
  s.ok('plays-100 unlocked', findTrophy(R.trophies(), 'plays-100').unlocked);

  // daily challenges
  R.reset();
  for (i = 1; i <= 10; i++) R.record({ game: 'dailygame', kind: 'daily', meta: { nonce: 'd' + i } });
  s.ok('daily-10 unlocked', findTrophy(R.trophies(), 'daily-10').unlocked);
  s.eq('daily-10 progress', findTrophy(R.trophies(), 'daily-10').progress, { cur: 10, max: 10 });

  // tier trophies through the whole curve
  R.reset();
  for (i = 1; i <= 8400; i++) R.record({ game: 'climber', kind: 'win', meta: { nonce: 'c' + i } });
  var st = R.getState();
  s.ok('grind reached obsidian level', st.level >= 35);
  s.eq('grind tier is obsidian', st.tier.id, 'obsidian');
  s.ok('tier-silver unlocked in grind', findTrophy(R.trophies(), 'tier-silver').unlocked);
  s.ok('tier-gold unlocked in grind', findTrophy(R.trophies(), 'tier-gold').unlocked);
  s.ok('tier-platinum unlocked in grind', findTrophy(R.trophies(), 'tier-platinum').unlocked);
  s.ok('tier-obsidian unlocked in grind', findTrophy(R.trophies(), 'tier-obsidian').unlocked);
  s.ok('wins-100 unlocked in grind', findTrophy(R.trophies(), 'wins-100').unlocked);
});

s.group('milestone trophies', function () {
  setDay(2026, 4, 1);
  R.reset();
  R.record({ game: 'm', kind: 'play', meta: { nonce: 'warm' } });
  var xp0 = R.getState().xp;

  var r = R.record({ game: 'm', kind: 'milestone', meta: { key: 'one-shot', nonce: 'm1' } });
  s.eq('milestone trophy gives its xp', r.xpGained, 15);
  s.eq('milestone id', ids(r.newTrophies), ['milestone-one-shot']);
  s.eq('milestone adds no base xp', r.state.xp - xp0, 15);

  r = R.record({ game: 'm', kind: 'milestone', meta: { key: 'one-shot', nonce: 'm1' } });
  s.eq('same milestone nonce is idempotent', r.xpGained, 0);
  r = R.record({ game: 'm', kind: 'milestone', meta: { key: 'one-shot', nonce: 'm2' } });
  s.eq('trophy does not pay twice', r.xpGained, 0);
  s.eq('trophy stays single', ids(r.newTrophies), []);

  var keys = ['flawless', 'comeback', 'full-house'];
  for (var i = 0; i < keys.length; i++) {
    r = R.record({ game: 'm', kind: 'milestone', meta: { key: keys[i], nonce: 'k' + i } });
    s.eq('milestone ' + keys[i] + ' unlocks', r.xpGained, 15);
  }
  var list = R.trophies();
  s.ok('one-shot unlocked', findTrophy(list, 'milestone-one-shot').unlocked);
  s.ok('flawless unlocked', findTrophy(list, 'milestone-flawless').unlocked);
  s.ok('comeback unlocked', findTrophy(list, 'milestone-comeback').unlocked);
  s.ok('full-house unlocked', findTrophy(list, 'milestone-full-house').unlocked);

  r = R.record({ game: 'm', kind: 'milestone', meta: { key: 'unknown-achievement', nonce: 'u1' } });
  s.eq('unknown milestone key is free', r.xpGained, 0);
  s.ok('unknown milestone key did not unlock anything', r.newTrophies.length === 0);
});

/* --------------------------------- storage --------------------------------- */

s.group('storage robustness', function () {
  setDay(2026, 5, 1);

  var st = mockStore();
  globalThis.localStorage = st;
  var A = freshEngine();
  A.reset();
  A.record({ game: 'persist', kind: 'play', meta: { nonce: 'p1' } });
  var raw = st.dump()[KEY];
  s.ok('storage key written', typeof raw === 'string' && raw.length > 0);
  var disk = JSON.parse(raw);
  s.eq('stored schema version', disk.v, 1);
  s.eq('stored xp', disk.xp, 30);

  var B = freshEngine();
  s.eq('reload keeps xp', B.getState().xp, 30);
  var dup = B.record({ game: 'persist', kind: 'play', meta: { nonce: 'p1' } });
  s.eq('seen nonce survives reload', dup.xpGained, 0);

  st.setItem(KEY, '{ this is not json');
  var C = freshEngine();
  var cState = null;
  try { cState = C.getState(); } catch (e) { cState = null; }
  s.ok('broken JSON does not throw', cState !== null);
  s.eq('broken JSON falls back to fresh', cState && cState.xp, 0);

  st.setItem(KEY, JSON.stringify({ v: 99, xp: 12345 }));
  var D = freshEngine();
  s.eq('unknown schema version falls back', D.getState().xp, 0);

  st.setItem(KEY, JSON.stringify({
    v: 1, xp: 50, plays: 'many',
    streak: { current: 'x', best: 'y', lastDay: 'not-a-day' },
    perGame: { ok: { plays: 2, wins: 1, bestStreak: 1 }, '__proto__': { wins: 99 } },
    trophies: { 'first-win': '2026-01-01', 'not-a-trophy': '2026-01-01' }
  }));
  var E = freshEngine();
  var eState = E.getState();
  s.eq('tampered counters are sanitised', eState.plays, 0);
  s.eq('tampered streak is sanitised', eState.streak.current, 0);
  s.eq('valid perGame survives tampering', eState.perGame.ok.plays, 2);
  s.ok('__proto__ slug rejected', !Object.prototype.hasOwnProperty.call(eState.perGame, '__proto__'));
  s.eq('prototype not polluted', Object.prototype.wins, undefined);
  s.eq('unknown trophy ignored', eState.trophyCount, 1);

  globalThis.localStorage = {
    getItem: function () { throw new Error('denied'); },
    setItem: function () { throw new Error('denied'); },
    removeItem: function () { throw new Error('denied'); }
  };
  var F = freshEngine();
  var threw = false, fState = null;
  try {
    F.record({ game: 'mem', kind: 'win', meta: { nonce: 'm1' } });
    fState = F.getState();
  } catch (e) { threw = true; }
  s.eq('throwing localStorage does not throw', threw, false);
  s.eq('memory state still works', fState && fState.wins, 1);
  s.ok('memory state gained xp', fState && fState.xp > 0);

  delete globalThis.localStorage;
  var G = freshEngine();
  var gState = null;
  try {
    G.record({ game: 'offline', kind: 'draw', meta: { nonce: 'd1' } });
    gState = G.getState();
  } catch (e) { gState = null; }
  s.eq('missing localStorage works in memory', gState && gState.draws, 1);

  var H = mockStore();
  globalThis.localStorage = H;
  var I = freshEngine();
  I.record({ game: 'resetme', kind: 'play', meta: { nonce: 'r1' } });
  s.ok('key exists before reset', KEY in H.dump());
  I.reset();
  s.ok('reset removes the key', !(KEY in H.dump()));
  s.eq('reset clears memory state', I.getState().xp, 0);
  s.eq('reset leaves trophies empty', I.getState().trophyCount, 0);
});

/* ------------------------------- encode/decode ----------------------------- */

s.group('encode / decode', function () {
  setDay(2026, 6, 1);
  globalThis.localStorage = mockStore();
  R = freshEngine();
  R.reset();
  R.record({ game: 'alpha', kind: 'play', meta: { nonce: 'e1' } });
  R.record({ game: 'alpha', kind: 'win', meta: { nonce: 'e2' } });
  R.record({ game: 'beta', kind: 'draw', meta: { nonce: 'e3' } });

  var before = R.getState();
  var enc = R.encodeState();
  s.ok('encode returns base64url', typeof enc === 'string' && /^[A-Za-z0-9_-]+$/.test(enc));
  var dec = R.decodeState(enc);
  s.ok('decode returns an object', dec !== null && typeof dec === 'object');
  s.eq('round-trip xp', dec.xp, before.xp);
  s.eq('round-trip level', dec.level, before.level);
  s.eq('round-trip tier', dec.tier.id, before.tier.id);
  s.eq('round-trip streak', dec.streak, before.streak);
  s.eq('round-trip counters', [dec.plays, dec.wins, dec.losses, dec.draws],
    [before.plays, before.wins, before.losses, before.draws]);
  s.eq('round-trip perGame', dec.perGame.alpha, before.perGame.alpha);
  s.eq('round-trip trophy count', dec.trophyCount, before.trophyCount);
  s.eq('round-trip trophy ids',
    dec.trophies.slice().sort(), ids(R.trophies().filter(function (t) { return t.unlocked; })).sort());
  s.eq('decode is read-only', R.getState().xp, before.xp);

  var emptyEnc = (R.reset(), R.encodeState());
  var emptyDec = R.decodeState(emptyEnc);
  s.eq('empty state round-trip xp', emptyDec && emptyDec.xp, 0);

  var b64 = function (text) {
    return Buffer.from(text, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  s.eq('decode rejects empty', R.decodeState(''), null);
  s.eq('decode rejects null', R.decodeState(null), null);
  s.eq('decode rejects undefined', R.decodeState(undefined), null);
  s.eq('decode rejects number', R.decodeState(42), null);
  s.eq('decode rejects object', R.decodeState({}), null);
  s.eq('decode rejects array', R.decodeState([]), null);
  s.eq('decode rejects bad chars', R.decodeState('abc$def'), null);
  s.eq('decode rejects whitespace', R.decodeState('abcd efgh'), null);
  s.eq('decode rejects non-JSON bytes', R.decodeState('zzzzzzzz'), null);
  s.eq('decode rejects overlong input', R.decodeState(new Array(20001).join('a')), null);
  s.eq('decode rejects wrong version', R.decodeState(b64('{"v":2,"x":1}')), null);
  s.eq('decode rejects negative xp', R.decodeState(
    b64('{"v":1,"x":-1,"s":[0,0,null],"c":[0,0,0,0,0]}')), null);
  s.eq('decode rejects missing counters', R.decodeState(
    b64('{"v":1,"x":1,"s":[0,0,null]}')), null);
  s.eq('decode rejects bad day', R.decodeState(
    b64('{"v":1,"x":1,"s":[0,0,"nope"],"c":[0,0,0,0,0]}')), null);
  s.eq('decode rejects bad perGame', R.decodeState(
    b64('{"v":1,"x":1,"s":[0,0,null],"c":[0,0,0,0,0],"g":[["ok","x",0,0]]}')), null);
  s.eq('decode rejects unknown trophy', R.decodeState(
    b64('{"v":1,"x":1,"s":[0,0,null],"c":[0,0,0,0,0],"t":[["nope","2026-01-01"]]}')), null);
  s.ok('decode never throws on random strings', (function () {
    var probe = ['a', '====', '____', 'Zg', '9_9', 'AAAA'];
    for (var i = 0; i < probe.length; i++) {
      try { R.decodeState(probe[i]); } catch (e) { return false; }
    }
    return true;
  })());
});

/* ------------------------------ public surface ----------------------------- */

s.group('getState / trophies surface', function () {
  globalThis.localStorage = mockStore();
  R = freshEngine();
  R.reset();
  var st = R.getState();

  s.eq('version', R.version, '1.0.0');
  s.eq('fresh xp', st.xp, 0);
  s.eq('fresh level', st.level, 1);
  s.eq('fresh tier', st.tier.id, 'bronze');
  s.eq('fresh xpIntoLevel', st.xpIntoLevel, 0);
  s.eq('fresh xpForNext', st.xpForNext, 100);
  s.eq('fresh progress', st.progress, 0);
  s.eq('fresh streak', st.streak, { current: 0, best: 0, lastDay: null });
  s.eq('fresh counters', [st.plays, st.wins, st.losses, st.draws], [0, 0, 0, 0]);
  s.eq('fresh perGame', st.perGame, {});
  s.eq('fresh trophyCount', st.trophyCount, 0);
  s.eq('fresh trophyTotal', st.trophyTotal, 24);

  st = R.record({ game: 'shape', kind: 'win', meta: { nonce: 'z1' } }).state;
  s.ok('getState has xp', typeof st.xp === 'number');
  s.ok('getState has tier names', !!(st.tier.name.zh && st.tier.name.en && st.tier.name.id));
  s.ok('getState progress within range', st.progress >= 0 && st.progress <= 1);
  s.eq('getState perGame keys', Object.keys(st.perGame), ['shape']);
  s.eq('perGame shape', Object.keys(st.perGame.shape).sort(), ['bestStreak', 'plays', 'wins']);

  var list = R.trophies();
  s.eq('trophy total is 24', list.length, 24);
  s.eq('trophyTotal agrees', st.trophyTotal, list.length);

  var idsSeen = Object.create(null), unique = true, shaped = true, shortNames = true;
  var icons = Object.create(null), iconsUnique = true;
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (idsSeen[t.id]) unique = false;
    idsSeen[t.id] = true;
    if (icons[t.icon]) iconsUnique = false;
    icons[t.icon] = true;
    if (!t.name || !t.name.zh || !t.name.en || !t.name.id) shaped = false;
    if (!t.desc || !t.desc.zh || !t.desc.en || !t.desc.id) shaped = false;
    if (typeof t.icon !== 'string' || !t.icon) shaped = false;
    if (typeof t.unlocked !== 'boolean') shaped = false;
    if (!t.progress || typeof t.progress.cur !== 'number' ||
      typeof t.progress.max !== 'number' || t.progress.max < 1) shaped = false;
    if (t.name.zh.length > 12) shortNames = false;
  }
  s.ok('trophy ids unique', unique);
  s.ok('trophy icons unique', iconsUnique);
  s.ok('trophy shape complete', shaped);
  s.ok('Chinese names are at most 12 chars', shortNames);

  var required = ['first-win', 'game-10-wins', 'game-50-wins', 'games-5', 'games-12',
    'games-all', 'streak-3', 'streak-7', 'streak-30', 'plays-100', 'plays-500',
    'daily-10', 'tier-silver', 'tier-gold', 'tier-platinum', 'tier-obsidian',
    'milestone-one-shot', 'milestone-flawless', 'milestone-comeback', 'milestone-full-house'];
  var missing = [];
  for (var j = 0; j < required.length; j++) if (!findTrophy(list, required[j])) missing.push(required[j]);
  s.eq('all required trophies exist', missing, []);

  var milestones = list.filter(function (t) { return t.id.indexOf('milestone-') === 0; });
  s.ok('at least four milestone slots', milestones.length >= 4);
  s.ok('milestone slot carries an icon', milestones[0].icon.indexOf('milestone') !== -1);

  s.eq('trophies() unlocked flags follow state',
    list.filter(function (t) { return t.unlocked; }).length, st.trophyCount);
});

/* ---------------------------------- finish --------------------------------- */

Date.now = realNow;
s.done();
