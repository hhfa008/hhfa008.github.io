/* 质量门禁的唯一游戏清单（审计、状态表与大厅门禁共用）。
 *
 * players 取值：
 *   single       单人（详情页必须明确标注「单人」）
 *   local-multi  本地双人/多人，无联机（按多人门禁处理，未补联机即 draft）
 *   multi        多人/联机（必须有房间、同步、AI 补位、重连、排行榜与 e2e）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGames } from '../arcade/families.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const VIEWPORTS = [
  { key: '390x844', width: 390, height: 844 },
  { key: '320x568', width: 320, height: 568 },
];

/* 原站点 22 款（不属于 arcade 家族，直接放在 games/<slug>/）。 */
export const LEGACY_PLAYERS = {
  '24game': 'single',
  aeroplane: 'local-multi',
  backgammon: 'local-multi',
  banqi: 'local-multi',
  'checkers-jump': 'local-multi',
  chess: 'local-multi',
  connect4: 'local-multi',
  doudizhu: 'local-multi',
  draughts: 'local-multi',
  freecell: 'single',
  go9: 'local-multi',
  gomoku: 'local-multi',
  pioneers: 'local-multi',
  reversi: 'local-multi',
  solitaire: 'single',
  spider: 'single',
  'tap-match': 'single',
  'texas-holdem': 'local-multi',
  'turtle-soup': 'single',
  undercover: 'local-multi',
  'voice-room': 'multi',
  xiangqi: 'local-multi',
};

/* 额外样板：麻将与卡牌对战（play/ 下的可玩页面）。 */
export const EXTRA_PLAYERS = {
  mahjong: 'multi',
  'card-battle': 'multi',
};

export const EXTRA_TARGETS = [
  {
    slug: 'mahjong',
    kind: 'extra',
    url: '/games/boardgame/play/mahjong.html',
    rules: '',
    name: '麻将 · 单机',
  },
  {
    slug: 'card-battle',
    kind: 'extra',
    url: '/games/boardgame/play/card-battle.html',
    rules: '',
    name: '卡牌对战',
  },
];

const ARCADE = allGames();

function arcadePlayers(slug) {
  return slug === 'pong-2p' ? 'local-multi' : 'single';
}

export function allTargets() {
  const arcade = ARCADE.map((g) => ({
    slug: g.slug,
    kind: 'arcade',
    url: `/games/${g.slug}/`,
    rules: `/games/${g.slug}/rules.html`,
    name: g.zh,
    family: g.family,
    players: arcadePlayers(g.slug),
  }));
  const legacy = Object.keys(LEGACY_PLAYERS).sort().map((slug) => ({
    slug,
    kind: 'legacy',
    url: `/games/${slug}/`,
    rules: `/games/${slug}/rules.html`,
    name: slug,
    players: LEGACY_PLAYERS[slug],
  }));
  const extras = EXTRA_TARGETS.map((t) => Object.assign({}, t, {
    players: EXTRA_PLAYERS[t.slug],
  }));
  return arcade.concat(legacy, extras);
}

export function targetBySlug(slug) {
  return allTargets().find((t) => t.slug === slug) || null;
}

/* 判断详情页（rules.html）有没有明确的「单人」标注。 */
export function singleLabelOf(target) {
  if (!target.rules) return { ok: true, note: 'extra: no rules page' };
  const file = path.join(ROOT, target.rules.replace(/^\//, ''));
  if (!fs.existsSync(file)) return { ok: false, note: 'rules.html missing' };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: text.includes('单人'), note: text.includes('单人') ? 'detail page says 单人' : 'detail page lacks 单人' };
}
