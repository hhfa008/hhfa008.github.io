#!/usr/bin/env node
/* 把 arcade 家族生成到三语大厅：同步卡片区 + ItemList 计数。
 *
 *   node tools/arcade/sync-lobby.mjs                 # 默认：全部游戏，不过滤（123 张卡）
 *   node tools/arcade/sync-lobby.mjs --shipped-only  # 显式开启门禁：只收 shipped
 *   node tools/arcade/sync-lobby.mjs --check         # 只校验，不写
 *   node tools/arcade/sync-lobby.mjs --shipped-only --check
 *
 * 默认行为与旧版一致：100 款 arcade 全部进大厅，原站点静态卡片保留，
 * GAME_STATUS.json 只做状态记录，不参与默认大厅过滤。
 * --shipped-only 时才按 games/boardgame/catalog-status.json（唯一状态源）
 * 过滤 draft（未收录条目按 draft 处理），并重算分类计数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGames, families } from './families.mjs';
import { allTargets } from '../quality/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATUS_FILE = path.join(ROOT, 'games/boardgame/catalog-status.json');
const FAM = new Map(families.map((f) => [f.key, f]));
const CHECK = process.argv.includes('--check');
const SHIPPED_ONLY = process.argv.includes('--shipped-only');
const BEGIN = '<!-- ARCADE:START -->';
const END = '<!-- ARCADE:END -->';

const LANGS = [
  { key: 'zh', file: 'games/index.html', iconPrefix: '', title: '新游戏', sub: 'New', tag: ['1 人', '益智'] },
  { key: 'en', file: 'games/en/index.html', iconPrefix: '../', title: 'New games', sub: 'Arcade', tag: ['1 player', 'Puzzle'] },
  { key: 'id', file: 'games/id/index.html', iconPrefix: '../', title: 'Game baru', sub: 'Arkade', tag: ['1 pemain', 'Teka-teki'] },
];

const ALL_ARCADE = allGames();
const ALL_TARGETS = allTargets();

function loadStatusMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.games || [];
    const map = new Map();
    for (const g of list) if (g && g.slug) map.set(g.slug, g.status);
    return { map, present: true };
  } catch {
    // fail closed：没有状态表就当全部 draft。
    return { map: new Map(ALL_TARGETS.map((t) => [t.slug, 'draft'])), present: false };
  }
}

const { map: STATUS, present: STATUS_PRESENT } = loadStatusMap();

// 根游戏（/games/<slug>/）的 shipped 权威是 games/GAME_STATUS.json，不是
// boardgame/catalog-status.json。卡片 data-status 必须镜像它，避免出现
// shipped 游戏仍标注 draft 的漂移。
function loadGameStatusMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/GAME_STATUS.json'), 'utf8'));
    const map = new Map();
    for (const g of raw.games || []) if (g && g.slug) map.set(g.slug, g.status);
    return map;
  } catch {
    return new Map();
  }
}
const GAME_STATUS = loadGameStatusMap();
const dataStatusFor = (slug) => (GAME_STATUS.get(slug) === 'shipped' ? 'shipped' : 'draft');
if (SHIPPED_ONLY && !STATUS_PRESENT) {
  console.error('warning: games/boardgame/catalog-status.json missing; --shipped-only treats every game as draft');
}
const LOBBY_ARCADE = ALL_ARCADE.filter((g) => {
  if (!fs.existsSync(path.join(ROOT, 'games', g.slug, 'index.html'))) return false;
  return SHIPPED_ONLY ? STATUS.get(g.slug) === 'shipped' : true;
});
// 状态源里没有条目的旧站游戏同样视为未达标：shipped-only 只展示已核验
// 且明确标记 shipped 的游戏，避免大厅文案宣称未核验内容。
const DRAFT_SLUGS = SHIPPED_ONLY
  ? new Set(ALL_TARGETS.map((t) => t.slug).filter((slug) => STATUS.get(slug) !== 'shipped'))
  : new Set();
const ALL_ARCADE_SLUGS = new Set(ALL_ARCADE.map((g) => g.slug));

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function card(g, lang) {
  const fam = FAM.get(g.family) || {};
  const desc = (fam.desc && fam.desc[lang.key]) || '';
  const name = g[lang.key] || g.en;
  const localMulti = g.slug === 'pong-2p';
  const tags = localMulti
    ? { zh: ['双人', '街机'], en: ['2 players', 'Local'], id: ['2 pemain', 'Lokal'] }[lang.key]
    : { zh: ['单人', '益智'], en: ['1 player', 'Puzzle'], id: ['1 pemain', 'Teka-teki'] }[lang.key];
  const search = [g.slug, g.zh, g.en, g.id, fam.key].join(' ');
  // 与 GAME_STATUS.json 一致：shipped 才标 shipped，其余保持 draft preview。
  return `      <article class="game-card" data-search="${esc(search)}">
        <a href="/games/${g.slug}/" data-status="${dataStatusFor(g.slug)}">
          <div class="card-head"><img src="${lang.iconPrefix}assets/icons/${g.slug}.svg" alt="" width="44" height="44" loading="lazy" decoding="async"><div><h3>${esc(name)}</h3><span class="latin">${esc(g.en)}</span></div></div>
          <p class="desc">${esc(desc)}</p>
          <p class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
        </a>
      </article>`;
}

function section(lang) {
  if (LOBBY_ARCADE.length === 0) {
    return `${BEGIN}
  <!-- no shipped arcade games; drafts are excluded by GAME_STATUS.json -->
${END}`;
  }
  const body = LOBBY_ARCADE.map((g) => card(g, lang)).join('\n\n');
  return `${BEGIN}
  <section class="cat" id="arcade" data-cat="arcade" aria-labelledby="arcade-title">
    <div class="cat-head">
      <h2 id="arcade-title">${lang.title}</h2><span class="count">${LOBBY_ARCADE.length}</span><small>${lang.sub}</small>
    </div>
    <div class="grid">

${body}

    </div>
  </section>
${END}`;
}

function slugFromUrl(url) {
  const m = String(url || '').match(/\/games\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

function updateJsonLd(html, lang) {
  let changed = false;
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (full, raw) => {
    let obj;
    try { obj = JSON.parse(raw); } catch { return full; }
    const list = findItemList(obj);
    if (!list) return full;
    // 删除所有 arcade（稍后按当前模式重加），--shipped-only 时再删除 draft 条目。
    // 插入点放在第一个被删 arcade 条目的位置，保持原 ItemList 顺序
    // （arcade 在原站点条目之后、桌游目录之前），默认模式从而保持 123 条不变。
    const kept = [];
    let insertAt = -1;
    for (const x of list.itemListElement) {
      const slug = slugFromUrl(x.url);
      const isArcade = slug && ALL_ARCADE_SLUGS.has(slug);
      const isDraft = SHIPPED_ONLY && slug && DRAFT_SLUGS.has(slug) && !isArcade;
      if (isArcade || isDraft) {
        if (isArcade && insertAt === -1) insertAt = kept.length;
        continue;
      }
      kept.push(x);
    }
    if (insertAt === -1) insertAt = kept.length;
    const added = LOBBY_ARCADE.map((g) => ({
      '@type': 'ListItem',
      position: 0,
      name: g[lang.key] || g.en,
      url: `https://hhfa008.github.io/games/${g.slug}/`,
      image: `https://hhfa008.github.io/games/assets/icons/${g.slug}.svg`,
    }));
    const next = kept.slice(0, insertAt).concat(added, kept.slice(insertAt));
    let pos = 0;
    for (const x of next) {
      pos += 1;
      x.position = pos;
    }
    list.itemListElement = next;
    list.numberOfItems = next.length;
    changed = true;
    return '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n<\/script>';
  });
  return { html, changed };
}

function findItemList(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.itemListElement)) return obj;
  for (const v of Object.values(obj)) {
    const found = findItemList(v);
    if (found) return found;
  }
  return null;
}

/* 删除 draft 的静态卡片（按 data-slug 或 href 匹配）。 */
function removeDraftCards(html) {
  return html.replace(/<article class="game-card"[\s\S]*?<\/article>\s*/g, (block) => {
    const slugAttr = block.match(/data-slug="([^"]+)"/);
    const href = block.match(/href="\/games\/([^/"]+)\//);
    const slug = slugAttr ? slugAttr[1] : href ? href[1] : null;
    if (slug && DRAFT_SLUGS.has(slug)) return '';
    return block;
  });
}

/* 分类计数按剩余卡片重算，保证「计数与卡片一致」。 */
function syncCategoryCounts(html, lang) {
  return html.replace(/<section class="cat"([\s\S]*?)<\/section>/g, (full, inner) => {
    const count = (inner.match(/class="game-card"/g) || []).length;
    let out = full.replace(/<span class="count">\d+<\/span>/, `<span class="count">${count}</span>`);
    if (lang.key === 'en') {
      out = out.replace(/<small>\d+ games?<\/small>/, `<small>${count} game${count === 1 ? '' : 's'}</small>`);
    } else if (lang.key === 'id') {
      out = out.replace(/<small>\d+ game<\/small>/, `<small>${count} game</small>`);
    }
    return out;
  });
}

function ensureGateNote(html, lang) {
  if (html.includes('data-gate-note')) return html;
  const note = {
    zh: '仅展示已通过质量门禁（测试 / 美术 / realism / 手机两档 / 单人标注或联机证据）的游戏。',
    en: 'Only games that pass the quality gate (tests / art / realism / mobile / single-player label or multiplayer evidence) are listed.',
    id: 'Hanya game yang lolos gerbang kualitas (tes / seni / realisme / seluler / label pemain tunggal atau bukti multipemain) yang ditampilkan.',
  }[lang.key];
  const ledeEnd = html.indexOf('</p>', html.indexOf('<p class="lede"'));
  if (ledeEnd < 0) return html;
  return html.slice(0, ledeEnd + 4) +
    `\n    <p class="gate-note" data-gate-note>${note}</p>` +
    html.slice(ledeEnd + 4);
}

function shippedCardNames(html) {
  const names = [];
  const re = /<article class="game-card"([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    if (/data-slug="boardgame"/.test(block)) continue;
    const h3 = /<h3>([^<]+)<\/h3>/.exec(block);
    if (h3) names.push(h3[1].trim());
  }
  return names;
}

/* 大厅标题/描述/lede 只保留 shipped 游戏，避免文案继续宣称 draft 游戏在大厅。 */
function rewriteLobbyCopy(html, lang) {
  const names = shippedCardNames(html);
  // 100 款以上时不要把全部名字塞进 description：列前 8 个再给总数。
  const shown = names.length > 12 ? names.slice(0, 8) : names;
  const joined = shown.join(lang.key === 'zh' ? '、' : ', ') +
    (names.length > 12
      ? { zh: ` 等 ${names.length} 款`, en: ` and ${names.length} games in total`, id: ` dan total ${names.length} game` }[lang.key]
      : '');
  const text = names.length
    ? {
      zh: `已通过质量门禁的游戏：${joined}。手机打开就能玩。`,
      en: `Games that pass the quality gate: ${joined}. Open and play on your phone.`,
      id: `Game yang lolos gerbang kualitas: ${joined}. Buka dan mainkan di HP.`,
    }[lang.key]
    : {
      zh: '暂无通过质量门禁的游戏。',
      en: 'No games have passed the quality gate yet.',
      id: 'Belum ada game yang lolos gerbang kualitas.',
    }[lang.key];
  const title = {
    zh: '在线桌游大厅 · 通过质量门禁的游戏',
    en: 'Online game hall · quality-gated games',
    id: 'Aula game online · game lolos kualitas',
  }[lang.key];
  const attr = esc(text);
  const jsonText = JSON.stringify(text).slice(1, -1);
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${attr}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${attr}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${attr}$2`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${attr}$2`)
    .replace(/<p class="lede">[\s\S]*?<\/p>/, `<p class="lede">${attr}</p>`)
    .replace(/("description":\s*")[^"]*(")/, `$1${jsonText}$2`);
  return html;
}

function parseLobby(html) {
  const cards = (html.match(/class="game-card"/g) || []).length;
  const cardSlugs = [];
  const cardHrefs = [];
  const cardRe = /<article class="game-card"[\s\S]*?<\/article>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const block = m[0];
    const slugAttr = block.match(/data-slug="([^"]+)"/);
    const href = block.match(/href="([^"]+)"/);
    if (slugAttr) cardSlugs.push(slugAttr[1]);
    if (href) cardHrefs.push(href[1]);
  }
  const ldErrors = [];
  let itemList = null;
  const ldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  while ((m = ldRe.exec(html))) {
    try {
      const obj = JSON.parse(m[1]);
      const list = findItemList(obj);
      if (list) itemList = list;
    } catch (e) {
      ldErrors.push(String(e.message));
    }
  }
  const itemUrls = itemList && Array.isArray(itemList.itemListElement)
    ? itemList.itemListElement.map((x) => x.url || '')
    : [];
  const positions = itemList && Array.isArray(itemList.itemListElement)
    ? itemList.itemListElement.map((x) => x.position)
    : [];
  return {
    cards,
    cardSlugs,
    cardHrefs,
    itemList,
    itemUrls,
    positions,
    ldErrors,
    numberOfItems: itemList ? itemList.numberOfItems : null,
  };
}

function validateLobby(lang, html) {
  const info = parseLobby(html);
  const problems = [];
  if (info.ldErrors.length) problems.push(`JSON-LD parse: ${info.ldErrors[0]}`);
  if (!info.itemList) problems.push('ItemList missing');
  if (info.itemList && info.numberOfItems !== info.itemList.itemListElement.length) {
    problems.push(`numberOfItems ${info.numberOfItems} != entries ${info.itemList.itemListElement.length}`);
  }
  if (info.itemList && info.numberOfItems !== info.cards) {
    problems.push(`numberOfItems ${info.numberOfItems} != cards ${info.cards}`);
  }
  const expectedPositions = info.positions.map((_, i) => i + 1);
  if (info.positions.some((p, i) => p !== expectedPositions[i])) {
    problems.push('ItemList positions are not sequential');
  }
  // 大厅里不能出现 draft / 死链。boardgame 是目录入口，不是 GAME_STATUS 里的游戏。
  // 默认不过滤 draft；只有 --shipped-only 才把 draft 视为问题。
  for (const slug of [...info.cardSlugs, ...info.itemUrls.map(slugFromUrl).filter(Boolean)]) {
    if (SHIPPED_ONLY && STATUS.has(slug) && STATUS.get(slug) !== 'shipped') {
      problems.push(`draft in lobby: ${slug}`);
    }
  }
  for (const href of info.cardHrefs) {
    const clean = href.split('?')[0];
    const file = path.join(ROOT, clean.replace(/^\//, ''), clean.endsWith('/') ? 'index.html' : '');
    if (!fs.existsSync(file)) problems.push(`dead link: ${href}`);
  }
  // 分类计数与卡片数一致。
  const sectionRe = /<section class="cat"([\s\S]*?)<\/section>/g;
  let sec;
  while ((sec = sectionRe.exec(html))) {
    const inner = sec[1];
    const shown = inner.match(/<span class="count">(\d+)<\/span>/);
    if (!shown) continue;
    const actual = (inner.match(/class="game-card"/g) || []).length;
    if (Number(shown[1]) !== actual) problems.push(`section count ${shown[1]} != cards ${actual}`);
  }
  return { ok: problems.length === 0, problems, cards: info.cards, items: info.itemList ? info.itemList.itemListElement.length : 0 };
}

let failures = 0;
for (const lang of LANGS) {
  const file = path.join(ROOT, lang.file);
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  const sec = section(lang);
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  if (start >= 0 && end > start) {
    html = html.slice(0, start) + sec + html.slice(end + END.length);
  } else {
    const close = html.lastIndexOf('</main>');
    if (close < 0) { console.error(`${lang.file}: no </main>`); failures++; continue; }
    html = html.slice(0, close) + '\n' + sec + '\n\n' + html.slice(close);
  }

  html = removeDraftCards(html);
  if (SHIPPED_ONLY) {
    html = syncCategoryCounts(html, lang);
    html = rewriteLobbyCopy(html, lang);
    html = ensureGateNote(html, lang);
  }

  const { html: withLd, changed } = updateJsonLd(html, lang);
  if (!changed) { console.error(`${lang.file}: ItemList not found`); failures++; continue; }
  html = withLd;

  const check = validateLobby(lang, html);
  const mode = SHIPPED_ONLY ? 'shipped-only' : 'unfiltered';
  if (!check.ok) {
    failures++;
    console.error(`${lang.key}: FAIL cards=${check.cards} items=${check.items} -> ${check.problems.join('; ')}`);
  } else {
    console.log(`${lang.key}: cards=${check.cards} items=${check.items} arcade=${LOBBY_ARCADE.length} (${mode})`);
  }

  if (CHECK) {
    if (html !== before) console.log(`${lang.file}: would change`);
  } else if (html !== before) {
    fs.writeFileSync(file, html);
    console.log(`updated ${lang.file}: arcade=${LOBBY_ARCADE.length} (${mode})` +
      (SHIPPED_ONLY ? `, draft excluded=${DRAFT_SLUGS.size}` : ''));
  } else {
    console.log(`${lang.file}: unchanged`);
  }
}
process.exit(failures ? 1 : 0);
