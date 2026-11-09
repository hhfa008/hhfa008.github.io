// Pure-logic tests for the leaderboard worker.
// Run: node games/leaderboard/worker/test.js
//
// No network, no KV, no wrangler needed. Exits non-zero on failure.

import {
  GAME_SLUGS,
  LIMITS,
  AVATAR_SHAPES,
  cleanName,
  isProfane,
  validateScore,
  validateDevice,
  isValidGame,
  isBetter,
  rankRows,
  weekKey,
  deriveAvatar,
  hitCounter,
  hashDevice,
} from './src/index.js';

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${label}`);
  }
}

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  check(label, ok);
}

// --- nickname cleaning ------------------------------------------------------

eq('empty name rejected', cleanName('').error, 'bad_name');
eq('whitespace-only name rejected', cleanName('   ').error, 'bad_name');
eq('13-char name truncated to 12', cleanName('a'.repeat(13)), { ok: true, name: 'a'.repeat(12) });
eq('13 Chinese chars truncated to 12', cleanName('玩'.repeat(13)), { ok: true, name: '玩'.repeat(12) });
eq('emoji name rejected', cleanName('😀').error, 'bad_name');
eq('<script> rejected', cleanName('<script>').error, 'bad_name');
eq('HTML with letters rejected', cleanName('<b>abc</b>').error, 'bad_name');
eq('zero-width chars stripped', cleanName('ab​cd'), { ok: true, name: 'abcd' });
eq('zero-width-only rejected', cleanName('​‌').error, 'bad_name');
eq('control chars stripped', cleanName('ab\n\tcd'), { ok: true, name: 'abcd' });
eq('Chinese name accepted', cleanName('黄恒发'), { ok: true, name: '黄恒发' });
eq('12-char name accepted', cleanName('abcdefghijkl'), { ok: true, name: 'abcdefghijkl' });
eq('anonymous tag name 玩家 #A7F3 accepted', cleanName('玩家 #A7F3'), { ok: true, name: '玩家 #A7F3' });
eq('tag name with HTML still rejected', cleanName('#<script>').error, 'bad_name');
eq('hashes accepted verbatim', cleanName('####'), { ok: true, name: '####' });
eq('underscore/hyphen/digits accepted', cleanName('abc_-123'), { ok: true, name: 'abc_-123' });
eq('internal spaces collapsed', cleanName('a    b'), { ok: true, name: 'a b' });
eq('non-string rejected', cleanName(123).error, 'bad_name');
eq('Chinese profanity rejected', cleanName('傻逼').error, 'bad_name');
eq('embedded Chinese profanity rejected', cleanName('xx傻逼xx').error, 'bad_name');
eq('English profanity rejected (case-insensitive)', cleanName('FuCk').error, 'bad_name');
eq('spaced profanity evasion rejected', cleanName('f u c k').error, 'bad_name');
check('isProfane detects compacted English', isProfane('S_h-i-t'));

// --- numeric validation -----------------------------------------------------

eq('xp -1 rejected', validateScore('xp', -1).error, 'bad_value');
eq('xp 0 accepted', validateScore('xp', 0), { ok: true, value: 0 });
eq('xp at max accepted', validateScore('xp', 1_000_000), { ok: true, value: 1_000_000 });
eq('xp over max rejected', validateScore('xp', 1_000_001).error, 'bad_value');
eq('xp string rejected', validateScore('xp', '100').error, 'bad_value');
eq('xp NaN rejected', validateScore('xp', Number.NaN).error, 'bad_value');
eq('xp Infinity rejected', validateScore('xp', Infinity).error, 'bad_value');
eq('xp fraction rejected', validateScore('xp', 1.5).error, 'bad_value');
eq('xp null rejected', validateScore('xp', null).error, 'bad_value');
eq('time 0 rejected', validateScore('time', 0).error, 'bad_value');
eq('time under 1s rejected', validateScore('time', 0.999).error, 'bad_value');
eq('time 1s accepted', validateScore('time', 1), { ok: true, value: 1 });
eq('time 24h accepted', validateScore('time', 86_400), { ok: true, value: 86_400 });
eq('time over 24h rejected', validateScore('time', 86_400.5).error, 'bad_value');
eq('time rounded to 3 decimals', validateScore('time', 12.3456), { ok: true, value: 12.346 });
eq('streak at max accepted', validateScore('streak', 3_650), { ok: true, value: 3_650 });
eq('streak over max rejected', validateScore('streak', 3_651).error, 'bad_value');
eq('streak fraction rejected', validateScore('streak', 5.5).error, 'bad_value');
eq('unknown kind rejected', validateScore('coins', 10).error, 'bad_value');

// --- ranking ----------------------------------------------------------------

const xpRows = rankRows(
  [
    { device: 'a', name: 'A', value: 10, at: 3 },
    { device: 'b', name: 'B', value: 30, at: 2 },
    { device: 'c', name: 'C', value: 20, at: 1 },
  ],
  'xp',
);
eq('xp ranks descending', xpRows.map((r) => r.value), [30, 20, 10]);
eq('xp rank numbers', xpRows.map((r) => r.rank), [1, 2, 3]);

const timeRows = rankRows(
  [
    { device: 'a', name: 'A', value: 30, at: 1 },
    { device: 'b', name: 'B', value: 10, at: 2 },
    { device: 'c', name: 'C', value: 20, at: 3 },
  ],
  'time',
);
eq('time ranks ascending', timeRows.map((r) => r.value), [10, 20, 30]);
eq('time rank numbers', timeRows.map((r) => r.rank), [1, 2, 3]);

const tieRows = rankRows(
  [
    { device: 'a', name: 'A', value: 10, at: 30 },
    { device: 'b', name: 'B', value: 20, at: 20 },
    { device: 'c', name: 'C', value: 20, at: 10 },
  ],
  'xp',
);
eq('tied scores share rank (1,1,3)', tieRows.map((r) => r.rank), [1, 1, 3]);
eq('tie display order: earlier submitter first', tieRows.map((r) => r.device), ['c', 'b', 'a']);

const streakRows = rankRows(
  [
    { device: 'a', name: 'A', value: 5, at: 1 },
    { device: 'b', name: 'B', value: 9, at: 2 },
  ],
  'streak',
);
eq('streak ranks descending', streakRows.map((r) => r.value), [9, 5]);
check('isBetter xp higher wins', isBetter('xp', 11, 10) && !isBetter('xp', 9, 10));
check('isBetter time lower wins', isBetter('time', 9, 10) && !isBetter('time', 11, 10));
check('isBetter equal is not better', !isBetter('xp', 10, 10));
check('isBetter unknown kind defaults desc', isBetter('unknown', 11, 10));

// --- ISO week buckets (UTC, Monday start) -----------------------------------

eq('2025-12-29 is 2026-W01', weekKey(new Date(Date.UTC(2025, 11, 29))), '2026-W01');
eq('2026-01-01 shares week with 2025-12-29', weekKey(new Date(Date.UTC(2026, 0, 1))), '2026-W01');
eq('2026-01-05 starts 2026-W02', weekKey(new Date(Date.UTC(2026, 0, 5))), '2026-W02');
eq('Sunday 2026-01-04 still W01', weekKey(new Date(Date.UTC(2026, 0, 4, 23, 59))), '2026-W01');
eq('Monday 00:00 UTC rolls the week', weekKey(new Date(Date.UTC(2026, 0, 5, 0, 0))), '2026-W02');
eq('2025-12-28 is 2025-W52', weekKey(new Date(Date.UTC(2025, 11, 28))), '2025-W52');
eq(
  'timezone offset does not change bucket',
  weekKey(new Date('2025-12-28T21:00:00-08:00')),
  weekKey(new Date('2025-12-29T05:00:00Z')),
);
eq('both offset forms are 2026-W01', weekKey(new Date('2025-12-28T21:00:00-08:00')), '2026-W01');
eq('invalid date returns null', weekKey('not-a-date'), null);

// --- avatar derivation ------------------------------------------------------

const HASH_A = '0123456789abcdef'.repeat(4);
const HASH_B = 'fedcba9876543210'.repeat(4);
const avatarA1 = deriveAvatar(HASH_A);
const avatarA2 = deriveAvatar(HASH_A);
eq('same hash gives stable avatar', avatarA1, avatarA2);
check('different hashes give different avatars', JSON.stringify(deriveAvatar(HASH_A)) !== JSON.stringify(deriveAvatar(HASH_B)));
check('avatar hues in range', avatarA1.h1 >= 0 && avatarA1.h1 < 360 && avatarA1.h2 >= 0 && avatarA1.h2 < 360);
check('avatar hues differ', avatarA1.h1 !== avatarA1.h2);
check('avatar shape is from the allowed list', AVATAR_SHAPES.includes(avatarA1.shape));
check('avatar does not leak the hash', !JSON.stringify(avatarA1).includes(HASH_A) && !JSON.stringify(avatarA1).includes(HASH_A.slice(0, 8)));
eq('invalid hash gives null avatar', deriveAvatar('xyz'), null);
eq('short hash gives null avatar', deriveAvatar('abcd'), null);

// --- device validation ------------------------------------------------------

eq('valid 32-hex device accepted', validateDevice('0123456789abcdef0123456789abcdef'), {
  ok: true,
  device: '0123456789abcdef0123456789abcdef',
});
eq('uppercase device normalized', validateDevice('0123456789ABCDEF0123456789ABCDEF').device, '0123456789abcdef0123456789abcdef');
eq('31-hex device rejected', validateDevice('a'.repeat(31)).error, 'bad_device');
eq('non-hex device rejected', validateDevice('g'.repeat(32)).error, 'bad_device');
eq('numeric device rejected', validateDevice(12345678901234567890123456789012).error, 'bad_device');
eq('null device rejected', validateDevice(null).error, 'bad_device');

// --- game whitelist ---------------------------------------------------------

check('chess is a known game', isValidGame('chess'));
check('game check is case-insensitive', isValidGame('CHESS'));
check('unknown game rejected', !isValidGame('not-a-game'));
check('null game rejected', !isValidGame(null));
check('slug list is non-trivial', GAME_SLUGS.length >= 20);
check('every slug has a known kind contract', Object.keys(LIMITS).length === 3);

// --- rate limiting ----------------------------------------------------------

const store = new Map();
const t0 = 1_000_000;
eq('device first hit allowed', hitCounter(store, 'd1', t0, 1, 30_000), { ok: true, retryAfter: 0 });
const second = hitCounter(store, 'd1', t0 + 1_000, 1, 30_000);
check('device second hit within 30s denied', second.ok === false);
check('device retryAfter is whole seconds', Number.isInteger(second.retryAfter) && second.retryAfter >= 1 && second.retryAfter <= 30);
eq('device allowed after window', hitCounter(store, 'd1', t0 + 30_000, 1, 30_000), { ok: true, retryAfter: 0 });
eq('other device key independent', hitCounter(store, 'd2', t0 + 30_001, 1, 30_000), { ok: true, retryAfter: 0 });

const ipStore = new Map();
let ipAllowed = 0;
for (let i = 0; i < 20; i += 1) {
  if (hitCounter(ipStore, '1.2.3.4', t0 + i, 20, 60_000).ok) ipAllowed += 1;
}
eq('20 IP hits allowed in a minute', ipAllowed, 20);
const ipBlocked = hitCounter(ipStore, '1.2.3.4', t0 + 21, 20, 60_000);
check('21st IP hit denied', ipBlocked.ok === false);
check('IP retryAfter within the minute', ipBlocked.retryAfter >= 1 && ipBlocked.retryAfter <= 60);

// --- hashing ----------------------------------------------------------------

const h1 = await hashDevice('test-salt', '0123456789abcdef0123456789abcdef');
const h2 = await hashDevice('test-salt', '0123456789abcdef0123456789abcdef');
const h3 = await hashDevice('other-salt', '0123456789abcdef0123456789abcdef');
check('hash is 64 lowercase hex chars', /^[0-9a-f]{64}$/.test(h1));
eq('hash is deterministic for same salt+device', h1, h2);
check('hash changes with salt', h1 !== h3);
check('hash is not the raw device', h1 !== '0123456789abcdef0123456789abcdef');

// ---------------------------------------------------------------------------

console.log(`\n${passed} assertions passed, ${failed} failed`);
if (failed > 0) process.exit(1);
