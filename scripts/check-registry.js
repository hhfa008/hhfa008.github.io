#!/usr/bin/env node
'use strict';

/*
 * Registry 校验：games/registry.json 是三语大厅的唯一数据源。
 *
 *   node scripts/check-registry.js
 *
 * 任何一项不满足都会打印明细并 exit 1：
 *   - games/<slug>/ 目录（排除 assets/en/id/shared/tests）必须有 registry 条目；
 *   - 每条 registry 必须有对应目录与 index.html；
 *   - rules.zh 指向的文件必须存在；
 *   - icon 指向的文件必须存在；
 *   - 三语 names / blurb 都不能为空（blurb 每语言 ≤30 字）；
 *   - category / status / ai 取值合法，slug 不重复。
 *   - games/registry-unlisted.txt 里显式列出的目录允许未登记（不上大厅），
 *     但该文件列出的目录必须真实存在。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const REGISTRY_PATH = path.join(GAMES_DIR, 'registry.json');

const LANGS = ['zh', 'en', 'id'];
const CATEGORIES = new Set(['board', 'cards', 'mahjong', 'party', 'euro', 'number', 'casual', 'online']);
const STATUSES = new Set(['live', 'draft', 'retired']);
const AI_LEVELS = new Set(['easy', 'normal', 'hard']);
// agentnet/ 与 ai-play/ 是 Worker 与共享协议库，没有页面入口，不算游戏目录。
const NON_GAME_DIRS = new Set(['assets', 'en', 'id', 'shared', 'tests', 'agentnet', 'ai-play']);
const UNLISTED_PATH = path.join(GAMES_DIR, 'registry-unlisted.txt');
const BLURB_MAX = 30;

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function codePointLength(text) {
  return [...text].length;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function gameDirs() {
  return fs.readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter(ent => ent.isDirectory() && !NON_GAME_DIRS.has(ent.name))
    .map(ent => ent.name)
    .sort();
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    fail(`缺少 ${rel(REGISTRY_PATH)}`);
    return null;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    fail(`${rel(REGISTRY_PATH)} 不是合法 JSON: ${err.message}`);
    return null;
  }
  if (!data || !Array.isArray(data.games)) {
    fail(`${rel(REGISTRY_PATH)} 缺少 games 数组`);
    return null;
  }
  return data;
}

function loadUnlisted() {
  if (!fs.existsSync(UNLISTED_PATH)) return new Set();
  return new Set(
    fs.readFileSync(UNLISTED_PATH, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  );
}

function main() {
  const registry = loadRegistry();
  const dirs = gameDirs();
  const dirSet = new Set(dirs);

  if (registry) {
    const seen = new Set();

    registry.games.forEach((game, index) => {
      const where = `games[${index}]${game && game.slug ? ` (${game.slug})` : ''}`;

      if (!game || typeof game !== 'object' || Array.isArray(game)) {
        fail(`${where}: 条目必须是对象`);
        return;
      }
      if (!isNonEmptyString(game.slug) || !/^[a-z0-9][a-z0-9-]*$/.test(game.slug)) {
        fail(`${where}: slug 缺失或不合法（只允许小写字母、数字、连字符）`);
        return;
      }
      if (seen.has(game.slug)) {
        fail(`${where}: slug 重复`);
      }
      seen.add(game.slug);

      const gameDir = path.join(GAMES_DIR, game.slug);
      if (!fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) {
        fail(`${where}: 缺少目录 games/${game.slug}/`);
      } else if (!fs.existsSync(path.join(gameDir, 'index.html'))) {
        fail(`${where}: 缺少 games/${game.slug}/index.html`);
      }

      if (!CATEGORIES.has(game.category)) {
        fail(`${where}: category 必须是 ${[...CATEGORIES].join(' | ')}，实际为 ${JSON.stringify(game.category)}`);
      }
      if (!STATUSES.has(game.status)) {
        fail(`${where}: status 必须是 ${[...STATUSES].join(' | ')}，实际为 ${JSON.stringify(game.status)}`);
      }
      if (!isNonEmptyString(game.players)) {
        fail(`${where}: players 不能为空`);
      }
      if (!Array.isArray(game.ai)) {
        fail(`${where}: ai 必须是数组（无 AI 用 []）`);
      } else {
        const aiSeen = new Set();
        game.ai.forEach(level => {
          if (!AI_LEVELS.has(level)) {
            fail(`${where}: ai 含非法难度 ${JSON.stringify(level)}（只允许 easy/normal/hard）`);
          }
          if (aiSeen.has(level)) fail(`${where}: ai 中 ${level} 重复`);
          aiSeen.add(level);
        });
      }

      const names = game.names || {};
      const blurbs = game.blurb || {};
      LANGS.forEach(lang => {
        if (!isNonEmptyString(names[lang])) {
          fail(`${where}: names.${lang} 不能为空`);
        }
        if (!isNonEmptyString(blurbs[lang])) {
          fail(`${where}: blurb.${lang} 不能为空`);
        } else if (codePointLength(blurbs[lang]) > BLURB_MAX) {
          fail(`${where}: blurb.${lang} 超过 ${BLURB_MAX} 字（实际 ${codePointLength(blurbs[lang])} 字）`);
        }
      });

      if (game.rules === null) {
        notes.push(`NOTE ${where}: 未提供规则页（rules 为 null）`);
      } else if (!game.rules || typeof game.rules !== 'object' || Array.isArray(game.rules)) {
        fail(`${where}: rules 必须是对象或 null`);
      } else {
        if (!isNonEmptyString(game.rules.zh)) {
          fail(`${where}: rules.zh 不能为空（没有规则页请把 rules 置为 null）`);
        } else {
          const rulesFile = path.join(gameDir, game.rules.zh);
          if (!fs.existsSync(rulesFile) || !fs.statSync(rulesFile).isFile()) {
            fail(`${where}: rules.zh 指向的文件不存在: games/${game.slug}/${game.rules.zh}`);
          }
        }
        Object.keys(game.rules).forEach(lang => {
          if (!LANGS.includes(lang)) {
            fail(`${where}: rules 含未知语言 ${JSON.stringify(lang)}`);
          }
        });
      }

      if (game.icon === null) {
        notes.push(`NOTE ${where}: 未提供图标（icon 为 null）`);
      } else if (!isNonEmptyString(game.icon)) {
        fail(`${where}: icon 不能为空（没有图标请把 icon 置为 null）`);
      } else {
        const iconFile = path.join(GAMES_DIR, game.icon);
        if (!fs.existsSync(iconFile) || !fs.statSync(iconFile).isFile()) {
          fail(`${where}: icon 指向的文件不存在: games/${game.icon}`);
        }
      }
    });

    const unlisted = loadUnlisted();
    for (const slug of dirs) {
      if (!seen.has(slug)) {
        if (unlisted.has(slug)) {
          notes.push(`NOTE 目录 games/${slug}/ 未登记 registry（列于 games/registry-unlisted.txt，不上大厅）`);
        } else {
          fail(`目录 games/${slug}/ 没有 registry 条目`);
        }
      }
    }
    for (const slug of unlisted) {
      if (!dirSet.has(slug)) {
        fail(`games/registry-unlisted.txt 列出的 games/${slug}/ 不存在（请删除该行）`);
      }
    }

    if (registry.games.length !== dirs.length) {
      notes.push(`NOTE registry 条目 ${registry.games.length} 条；实际游戏目录 ${dirs.length} 个`);
    }
  }

  notes.forEach(line => console.log(line));
  if (failures.length) {
    failures.forEach(line => console.log(`FAIL ${line}`));
    console.log(`\nREGISTRY CHECK FAILED：${failures.length} 项不满足`);
    process.exit(1);
  }

  const count = registry ? registry.games.length : 0;
  console.log(`REGISTRY CHECK OK：${count} 款游戏，三语 names/blurb、rules.zh、icon 全部对上实际文件`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { gameDirs, CATEGORIES, STATUSES, AI_LEVELS };
