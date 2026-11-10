#!/usr/bin/env node
/*
 * Shared catalog for the 284-game audit.
 *
 * The baseline is 31 classic playable entries (build.mjs PLAYABLE_GAMES) +
 * 250 mini games + 3 premium entries. `card-battle/` is an extra hub entry
 * outside that 284 and is reported separately by the audit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BOARD_ROOT = path.resolve(HERE, '..');

export function classicSlugs() {
  const src = fs.readFileSync(path.join(BOARD_ROOT, 'build.mjs'), 'utf8');
  const block = src.match(/const PLAYABLE_GAMES = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('PLAYABLE_GAMES not found in build.mjs');
  return [...block[1].matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
}

export function miniSlugs() {
  return fs.readdirSync(BOARD_ROOT, { withFileTypes: true })
    .filter((ent) => ent.isDirectory() && /^mini-[a-z]+-[ab]-\d{2}$/.test(ent.name))
    .map((ent) => ent.name)
    .sort();
}

export const PREMIUM_SLUGS = [
  'xiangqi-premium',
  'draughts-premium',
  'checkers-jump-premium',
  'codenames-premium',
  'azul-premium',
  'kot-premium',
  'splendor-premium',
  'kingdomino-premium',
  'century-spice-road-premium',
  'jaipur-premium',
  'lost-cities-premium',
  'coup-premium',
  'stone-age-premium',
  'dominion-premium',
  'carcassonne-premium',
  'gomoku-premium',
  'reversi-premium',
  'undercover-premium',
  'love-letter-premium',
  'skull-premium',
  'dixit-premium',
  'for-sale-premium',
  'no-thanks-premium',
  'six-nimmt-premium',
  'avalon-premium',
  'hero-realms-premium',
  'patchwork-premium',
  'ticket-to-ride-premium',
  'war-chest-premium',
  'chess-premium',
  'connect4-premium',
  'backgammon-premium',
  'solitaire-premium',
  'freecell-premium',
  'spider-premium',
  '24game-premium',
  'doudizhu-premium',
  'aeroplane-premium',
  'pioneers-premium',
  'banqi-premium'
];

// Premium single-player entries: the fifth gate is the visible 「单人」 badge
// instead of online rooms. They are deliberately not classified as multi.
const SINGLE_PREMIUM = new Set([
  'solitaire-premium',
  'freecell-premium',
  'spider-premium',
  '24game-premium'
]);

export function modeOf(slug) {
  // The puzzle group and the four card/patience premium entries are authored
  // as true single-player games. Every other game is a 2+ player game played
  // against built-in AI, which the 2026-11-10 rule classifies as multiplayer
  // (online play required).
  if (SINGLE_PREMIUM.has(slug)) return 'single';
  return /^mini-puzzle-a-\d{2}$/.test(slug) ? 'single' : 'multi';
}

export function kindOf(slug) {
  if (PREMIUM_SLUGS.indexOf(slug) !== -1) return 'premium';
  if (/^mini-/.test(slug)) return 'mini';
  return 'classic';
}

export function catalog() {
  const seen = new Set();
  const out = [];
  const add = (slug, source) => {
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push({
      slug,
      kind: kindOf(slug),
      mode: modeOf(slug),
      source,
      dir: path.join(BOARD_ROOT, slug)
    });
  };
  classicSlugs().forEach((slug) => add(slug, 'classic'));
  miniSlugs().forEach((slug) => add(slug, 'mini'));
  PREMIUM_SLUGS.forEach((slug) => add(slug, 'premium'));
  return out;
}

export function hasFile(slug, name) {
  return fs.existsSync(path.join(BOARD_ROOT, slug, name));
}

export function readText(slug, name) {
  const file = path.join(BOARD_ROOT, slug, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function imageArtifacts(slug) {
  const dir = path.join(BOARD_ROOT, slug);
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const walk = (d, depth) => {
    if (depth > 2) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(d, ent.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (/\.(png|jpe?g|webp|avif|gif)$/i.test(ent.name)) {
        files.push({ rel, bytes: fs.statSync(full).size });
      }
    }
  };
  walk(dir, 0);
  return files;
}
