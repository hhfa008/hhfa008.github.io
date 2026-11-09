#!/usr/bin/env node
'use strict';

/*
 * 集石（gstonegames.com）桌游目录采集 / 离线重放。
 *
 *   # 实时采集（串行，默认 1s 间隔，最多重试 3 次，单次超时 15s）
 *   node games/boardgame/collector/fetch-gstone.mjs --live --limit 10 --out /tmp/boardgames.json
 *
 *   # 从快照离线重放（幂等，同一 fixture 永远产出同一份 JSON）
 *   node games/boardgame/collector/fetch-gstone.mjs \
 *     --fixture games/boardgame/collector/fixtures/gstone-2026-11-10.json \
 *     --out games/boardgame/data/boardgames.json
 *
 * 数据源限制（详见 README）：集石的 /game/ 列表接口要求登录，公开可抓的是
 * 首页与 /game/info-<id>.html 详情页。因此 id 由公开首页发现后人工精选，
 * 详情页逐条串行抓取。BGG XML API 在本机未认证时返回 401，未采用。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sortGames } from '../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURES = path.join(HERE, 'fixtures');
const DATA = path.join(ROOT, 'data');

const SITE = 'https://www.gstonegames.com';
const USER_AGENT = 'hhfa008.github.io boardgames importer (+https://hhfa008.github.io)';
const DEFAULT_DELAY = 1000;
const DEFAULT_RETRY = 3;
const DEFAULT_TIMEOUT = 15000;

/*
 * 人工精选的 43 条目录。slug / en 为策展字段；category 仅在集石原始类别
 * 不足以表达契约分类时覆盖（例如国际象棋在集石归为“抽象”，本目录归入
 * two-player）。id 全部来自公开详情页，评分、人数、时长、设计师等不手填。
 */
export const EDITORIAL = [
  // euro
  { sourceId: '550', slug: 'terraforming-mars', en: 'Terraforming Mars' },
  { sourceId: '4320', slug: 'brass-birmingham', en: 'Brass: Birmingham' },
  { sourceId: '32658', slug: 'castles-of-burgundy-special-edition', en: 'The Castles of Burgundy: Special Edition' },
  { sourceId: '29568', slug: 'ark-nova', en: 'Ark Nova' },
  { sourceId: '16127', slug: 'terra-mystica-big-box', en: 'Terra Mystica: Big Box' },
  { sourceId: '24495', slug: 'dune-imperium', en: 'Dune: Imperium' },
  { sourceId: '44191', slug: 'through-the-ages-new-story', en: 'Through the Ages: A New Story of Civilization' },
  { sourceId: '27980', slug: 'voidfall', en: 'Voidfall' },
  { sourceId: '41898', slug: 'harmonies', en: 'Harmonies' },
  { sourceId: '48135', slug: 'underwater-cities-big-box', en: 'Underwater Cities: Chinese Big Box' },

  // party
  { sourceId: '13275', slug: 'blood-on-the-clocktower', en: 'Blood on the Clocktower' },
  { sourceId: '1416', slug: 'decrypto', en: 'Decrypto' },
  { sourceId: '43846', slug: 'thunder-road-vendetta', en: 'Thunder Road: Vendetta' },
  { sourceId: '45792', slug: 'the-song-that-doesnt-exist', en: "The Song That Definitely Doesn't Exist" },
  { sourceId: '45793', slug: 'the-game-that-definitely-doesnt-exist', en: "The Game That Definitely Doesn't Exist" },
  { sourceId: '47066', slug: 'chaotic-sports-day', en: 'Chaotic Sports Day' },
  { sourceId: '47797', slug: 'dark-hotpot', en: 'Dark Hotpot' },

  // ameritrash
  { sourceId: '745', slug: 'gloomhaven', en: 'Gloomhaven' },
  { sourceId: '815', slug: 'war-of-the-ring-second-edition', en: 'War of the Ring: Second Edition' },
  { sourceId: '736', slug: 'pandemic-legacy-season-1', en: 'Pandemic Legacy: Season 1' },
  { sourceId: '654', slug: 'twilight-imperium-fourth-edition', en: 'Twilight Imperium: Fourth Edition' },
  { sourceId: '9216', slug: 'mage-knight-ultimate-edition', en: 'Mage Knight: Ultimate Edition' },
  { sourceId: '1104', slug: 'kingdom-death-monster', en: 'Kingdom Death: Monster' },
  { sourceId: '11640', slug: 'arydia-the-paths-we-dare-tread', en: 'Arydia: The Paths We Dare Tread' },
  { sourceId: '18025', slug: 'iss-vanguard', en: 'ISS Vanguard' },

  // card
  { sourceId: '782', slug: 'arkham-horror-card-game', en: 'Arkham Horror: The Card Game' },
  { sourceId: '977', slug: 'hero-realms', en: 'Hero Realms' },
  { sourceId: '10292', slug: 'sakura-arms-new-mode', en: 'Sakura Arms: New Mode' },
  { sourceId: '1393', slug: 'wall-street-1920', en: 'Wall Street 1920' },
  { sourceId: '47170', slug: 'shadowfall-omen-of-the-rift', en: 'Shadowfall: Omen of the Rift' },
  { sourceId: '28778', slug: 'arkham-horror-card-game-revised-core', en: 'Arkham Horror: The Card Game: Revised Core Set' },

  // two-player
  { sourceId: '679', slug: 'twilight-struggle', en: 'Twilight Struggle', category: 'two-player' },
  { sourceId: '569', slug: 'chess', en: 'Chess', category: 'two-player' },
  { sourceId: '44555', slug: 'patchwork-10th-anniversary', en: 'Patchwork: 10th Anniversary Edition', category: 'two-player' },
  { sourceId: '6229', slug: 'war-chest', en: 'War Chest', category: 'two-player' },
  { sourceId: '10465', slug: 'imperial-struggle', en: 'Imperial Struggle' },
  { sourceId: '31888', slug: 'pacific-war-1941-1945', en: 'Pacific War: The Struggle Against Japan 1941-1945' },

  // family
  { sourceId: '33628', slug: 'heat-pedal-to-the-metal', en: 'Heat: Pedal to the Metal' },
  { sourceId: '30026', slug: 'carcassonne-20th-anniversary', en: 'Carcassonne: 20th Anniversary Edition' },
  { sourceId: '19552', slug: 'unlock-epic-adventures', en: 'Unlock!: Epic Adventures' },
  { sourceId: '7956', slug: 'turing-tumble', en: 'Turing Tumble' },
  { sourceId: '35880', slug: 'spintronics', en: 'Spintronics' },
  { sourceId: '2135', slug: 'mahjong-japanese', en: 'Mahjong (Japanese Riichi)', category: 'family' }
];

export const EDITORIAL_BY_ID = new Map(
  EDITORIAL.map(function (entry) { return [entry.sourceId, entry]; })
);

// 集石原始类别 -> 契约 6 分类。个别游戏用 EDITORIAL.category 覆盖。
export const CATEGORY_MAP = {
  '德式': 'euro',
  '聚会': 'party',
  '美式': 'ameritrash',
  '卡牌': 'card',
  '亲子': 'family',
  '战棋': 'two-player',
  '抽象': 'family',
  '解谜': 'family',
  '扮演': 'ameritrash'
};

export function mapCategory(rawCategory, sourceId) {
  const curated = EDITORIAL_BY_ID.get(String(sourceId));
  if (curated && curated.category) return curated.category;
  return CATEGORY_MAP[rawCategory] || 'family';
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
    .replace(/&#([0-9]+);/g, function (_, dec) { return String.fromCodePoint(parseInt(dec, 10)); })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'");
}

function text(fragment) {
  return decodeEntities(String(fragment).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function first(html, regex) {
  const match = html.match(regex);
  return match ? match[1] : null;
}

function splitPeople(fragment) {
  if (!fragment) return [];
  const names = [];
  const anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(fragment))) names.push(text(match[1]));
  if (!names.length) names.push(text(fragment));
  const out = [];
  names.join(' / ').split(/\s*[,，/]\s*/).forEach(function (name) {
    const value = name.trim();
    if (!value || value === '未知' || value === '未知作者') return;
    if (out.indexOf(value) === -1) out.push(value);
  });
  return out;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function localDate(date) {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/*
 * Parse one public /game/info-<id>.html page. Throws when a required field is
 * missing, so a changed upstream layout fails loudly instead of emitting
 * half-empty records.
 */
export function parsePage(html, sourceId, url, fetchedAt) {
  const playerMatch = html.match(/playerNumList:\s*(\{[^}]+\})/);
  if (!playerMatch) throw new Error('playerNumList missing for gstone-' + sourceId);
  let playerNumList;
  try {
    playerNumList = JSON.parse(playerMatch[1]);
  } catch (err) {
    throw new Error('playerNumList is not JSON for gstone-' + sourceId + ': ' + err.message);
  }

  const name = text(first(html, /<em class="crumbs-current">([\s\S]*?)<\/em>/) || '');
  if (!name) throw new Error('name missing for gstone-' + sourceId);

  const coverRaw = first(html, /background:url\('(\/\/oss\.gstonegames\.com\/[^']+)'\)/)
    || first(html, /<img[^>]+src="(\/\/oss\.gstonegames\.com\/[^"]+)"/);
  if (!coverRaw) throw new Error('cover missing for gstone-' + sourceId);

  const designersBlock = first(html, /<div class="programa02">\s*<span>设计师：<\/span>\s*<p>([\s\S]*?)<\/p>/);
  const publishersBlock = first(html, /<div class="programa02">\s*<span>出版社：<\/span>\s*<p>([\s\S]*?)<\/p>/);

  return {
    sourceId: String(sourceId),
    url: url,
    fetchedAt: fetchedAt,
    htmlSha256: crypto.createHash('sha256').update(html).digest('hex'),
    raw: {
      name: name,
      playerNumList: playerNumList,
      perCapita: text(first(html, /人均时长：\s*([^<]+)/) || ''),
      difficulty: text(first(html, /上手难度：\s*([^<]+)/) || ''),
      rating: text(first(html, /<div class="score textc">\s*<p>([0-9.]+)<\/p>/) || ''),
      rank: text(first(html, /排名\s*([0-9]+)/) || ''),
      year: text(first(html, /出版年份：<\/span>\s*<a[^>]*>([0-9]+)<\/a>/) || ''),
      designers: splitPeople(designersBlock),
      publishers: splitPeople(publishersBlock),
      category: text(first(html, /游戏类别：<\/span><a[^>]*>([^<]+)<\/a>/) || ''),
      mode: text(first(html, /游戏模式：<\/span><a[^>]*>([^<]+)<\/a>/) || ''),
      coverUrl: 'https:' + coverRaw
    }
  };
}

export function normalizeRecord(record) {
  const curated = EDITORIAL_BY_ID.get(String(record.sourceId));
  if (!curated) throw new Error('uncurated gstone id: ' + record.sourceId);
  const raw = record.raw;

  const supported = Object.keys(raw.playerNumList)
    .map(Number)
    .filter(function (n) {
      return raw.playerNumList[String(n)] > 0;
    })
    .sort(function (a, b) { return a - b; });
  if (!supported.length) throw new Error('no supported player count for gstone-' + record.sourceId);

  const minPlayers = supported[0];
  const maxPlayers = supported[supported.length - 1];
  const bestPlayers = Object.keys(raw.playerNumList)
    .map(Number)
    .filter(function (n) {
      return raw.playerNumList[String(n)] === 2 && n >= minPlayers && n <= maxPlayers;
    })
    .sort(function (a, b) { return a - b; });

  const perCapita = parseInt(raw.perCapita, 10);
  if (!Number.isFinite(perCapita) || perCapita <= 0) {
    throw new Error('per-capita play time missing for gstone-' + record.sourceId);
  }

  const difficulty = parseInt(raw.difficulty, 10);
  if (!Number.isFinite(difficulty) || difficulty < 1) {
    throw new Error('difficulty missing for gstone-' + record.sourceId);
  }

  const rating = parseFloat(raw.rating);
  if (!Number.isFinite(rating)) {
    throw new Error('rating missing for gstone-' + record.sourceId);
  }

  const year = parseInt(raw.year, 10);
  if (!Number.isFinite(year)) {
    throw new Error('year missing for gstone-' + record.sourceId);
  }

  const category = curated.category || mapCategory(raw.category, record.sourceId);
  const tags = [raw.category, raw.mode].filter(Boolean);

  return {
    id: 'gstone-' + record.sourceId,
    slug: curated.slug,
    name: { zh: raw.name, en: curated.en },
    category: category,
    players: { min: minPlayers, max: maxPlayers },
    bestPlayers: bestPlayers,
    playTime: {
      min: perCapita * minPlayers,
      max: perCapita * maxPlayers
    },
    weight: Math.max(1, Math.min(5, round1(difficulty / 2))),
    rating: round1(rating),
    designers: raw.designers.slice(),
    publishers: raw.publishers.slice(),
    year: year,
    coverUrl: encodeURI(raw.coverUrl),
    source: {
      site: 'gstone',
      url: record.url,
      fetchedAt: record.fetchedAt
    },
    tags: tags
  };
}

export function normalizeCatalog(records) {
  return sortGames(records.map(normalizeRecord));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function sleep(ms) {
  if (!ms || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function argValue(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (value == null || value.indexOf('--') === 0) return true;
  return value;
}

function fetchPage(sourceId, options) {
  const url = SITE + '/game/info-' + sourceId + '.html';
  const tmp = path.join(os.tmpdir(), 'gstone-' + process.pid + '-' + sourceId + '.html');
  const args = [
    '-sS',
    '--max-time', String(Math.ceil(options.timeout / 1000)),
    '-A', USER_AGENT,
    '-o', tmp,
    '-w', '%{http_code}'
  ];
  if (options.proxy) args.push('-x', options.proxy);
  args.push(url);

  for (let attempt = 1; attempt <= options.retry; attempt++) {
    const result = spawnSync('curl', args, { encoding: 'utf8', timeout: options.timeout + 5000 });
    const code = String(result.stdout || '').trim();
    if (result.status === 0 && code === '200' && fs.existsSync(tmp)) {
      const html = fs.readFileSync(tmp, 'utf8');
      fs.rmSync(tmp, { force: true });
      if (html.length < 1000) throw new Error('suspiciously small response for gstone-' + sourceId);
      return html;
    }
    fs.rmSync(tmp, { force: true });
    if (attempt === options.retry) {
      throw new Error(
        'fetch failed for gstone-' + sourceId + ' after ' + options.retry +
        ' attempts (curl=' + (result.status == null ? '?' : result.status) + ', http=' + (code || '?') + ')'
      );
    }
    sleep(options.delay);
  }
  throw new Error('unreachable');
}

function buildFixture(options) {
  const selected = options.ids && options.ids.length
    ? EDITORIAL.filter(function (entry) { return options.ids.indexOf(entry.sourceId) !== -1; })
    : EDITORIAL;
  const limited = options.limit ? selected.slice(0, options.limit) : selected;
  const records = [];

  for (let i = 0; i < limited.length; i++) {
    const entry = limited[i];
    const url = SITE + '/game/info-' + entry.sourceId + '.html';
    const fetchedAt = new Date().toISOString();
    process.stderr.write('[' + (i + 1) + '/' + limited.length + '] ' + entry.sourceId + ' ' + url + '\n');
    const html = fetchPage(entry.sourceId, options);
    records.push(parsePage(html, entry.sourceId, url, fetchedAt));
    if (i < limited.length - 1) sleep(options.delay);
  }

  return {
    site: 'gstone',
    generator: 'games/boardgame/collector/fetch-gstone.mjs',
    source: SITE + '/',
    userAgent: USER_AGENT,
    fetchedAt: records.length ? records[records.length - 1].fetchedAt : new Date().toISOString(),
    note: 'Parsed snapshot of public gstone game detail pages. Replay with --fixture; output is deterministic.',
    games: records
  };
}

function main() {
  const live = process.argv.includes('--live');
  const fixtureArg = argValue('fixture', null);
  const outArg = String(argValue('out', path.join(DATA, 'boardgames.json')));
  const retry = parseInt(argValue('retry', DEFAULT_RETRY), 10);
  const delay = parseInt(argValue('delay', DEFAULT_DELAY), 10);
  const timeout = parseInt(argValue('timeout', DEFAULT_TIMEOUT), 10);
  const limit = parseInt(argValue('limit', 0), 10) || 0;
  const proxy = argValue('proxy', '');
  const idsArg = argValue('ids', '');

  if (!live && !fixtureArg) {
    console.error('usage: fetch-gstone.mjs (--live | --fixture <path>) [--out <file>]');
    console.error('       [--limit N] [--delay ms] [--retry 3] [--proxy url] [--ids 550,4320]');
    process.exit(2);
  }

  let fixture;
  if (fixtureArg) {
    fixture = JSON.parse(fs.readFileSync(String(fixtureArg), 'utf8'));
  } else {
    fixture = buildFixture({
      retry: retry,
      delay: delay,
      timeout: timeout,
      proxy: proxy,
      limit: limit,
      ids: typeof idsArg === 'string' && idsArg ? idsArg.split(',').map(function (s) { return s.trim(); }) : []
    });
    const fixtureOut = String(argValue('fixture-out', path.join(FIXTURES, 'gstone-' + localDate(new Date()) + '.json')));
    writeJson(fixtureOut, fixture);
    process.stderr.write('fixture written: ' + fixtureOut + '\n');
  }

  const games = normalizeCatalog(fixture.games || []);
  writeJson(outArg, games);
  process.stderr.write('catalog written: ' + outArg + ' (' + games.length + ' games)\n');
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
