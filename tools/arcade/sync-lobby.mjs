#!/usr/bin/env node
/* 把 arcade 家族生成到三语大厅：追加卡片区 + 同步 ItemList 计数。
 *
 *   node tools/arcade/sync-lobby.mjs          # 写入
 *   node tools/arcade/sync-lobby.mjs --check  # 只校验
 *
 * 只写入已经有 index.html 的游戏；幂等（用 <!-- ARCADE:START --> 标记替换）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGames, families } from './families.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FAM = new Map(families.map((f) => [f.key, f]));
const CHECK = process.argv.includes('--check');
const BEGIN = '<!-- ARCADE:START -->';
const END = '<!-- ARCADE:END -->';

const LANGS = [
  { key: 'zh', file: 'games/index.html', iconPrefix: '', title: '新游戏', sub: 'New', tag: ['1 人', '益智'] },
  { key: 'en', file: 'games/en/index.html', iconPrefix: '../', title: 'New games', sub: 'Arcade', tag: ['1 player', 'Puzzle'] },
  { key: 'id', file: 'games/id/index.html', iconPrefix: '../', title: 'Game baru', sub: 'Arkade', tag: ['1 pemain', 'Teka-teki'] },
];

const games = allGames().filter((g) => fs.existsSync(path.join(ROOT, 'games', g.slug, 'index.html')));

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function card(g, lang) {
  const fam = FAM.get(g.family) || {};
  const desc = (fam.desc && fam.desc[lang.key]) || '';
  const name = g[lang.key] || g.en;
  const tags = lang.key === 'zh' ? (g.cat === 'board' ? ['1–2 人', '棋类'] : lang.tag) : lang.tag;
  const search = [g.slug, g.zh, g.en, g.id, fam.key].join(' ');
  return `      <article class="game-card" data-search="${esc(search)}">
        <a href="/games/${g.slug}/">
          <div class="card-head"><img src="${lang.iconPrefix}assets/icons/${g.slug}.svg" alt="" width="44" height="44" loading="lazy" decoding="async"><div><h3>${esc(name)}</h3><span class="latin">${esc(g.en)}</span></div></div>
          <p class="desc">${esc(desc)}</p>
          <p class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
        </a>
      </article>`;
}

function section(lang) {
  const body = games.map((g) => card(g, lang)).join('\n\n');
  return `${BEGIN}
  <section class="cat" id="arcade" data-cat="arcade" aria-labelledby="arcade-title">
    <div class="cat-head">
      <h2 id="arcade-title">${lang.title}</h2><span class="count">${games.length}</span><small>${lang.sub}</small>
    </div>
    <div class="grid">

${body}

    </div>
  </section>
${END}`;
}

function updateJsonLd(html, lang) {
  let changed = false;
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (full, raw) => {
    let obj;
    try { obj = JSON.parse(raw); } catch { return full; }
    const list = findItemList(obj);
    if (!list) return full;
    // 保留已有项，删除旧的 arcade 项（URL 在本批 slug 里）
    const slugs = new Set(games.map((g) => g.slug));
    const kept = list.itemListElement.filter((x) => {
      const m = (x.url || '').match(/\/games\/([^/]+)\/$/);
      return !(m && slugs.has(m[1]));
    });
    const next = kept.slice();
    let pos = Math.max(0, ...next.map((x) => x.position || 0));
    for (const g of games) {
      pos++;
      next.push({
        '@type': 'ListItem',
        position: pos,
        name: g[lang.key] || g.en,
        url: `https://hhfa008.github.io/games/${g.slug}/`,
        image: `https://hhfa008.github.io/games/assets/icons/${g.slug}.svg`,
      });
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

  const { html: withLd, changed } = updateJsonLd(html, lang);
  if (!changed) { console.error(`${lang.file}: ItemList not found`); failures++; continue; }
  html = withLd;

  if (CHECK) {
    const cards = (html.match(/class="game-card"/g) || []).length;
    const items = [...html.matchAll(/"position": \d+/g)].length;
    const arcadeMarkers = (html.match(/ARCADE:START/g) || []).length;
    const arcadeCount = (html.split(BEGIN)[1] || '').split('class="game-card"').length - 1;
    console.log(`${lang.key}: cards=${cards} itemlist=${items} arcadeCards=${arcadeCount} games=${games.length} markers=${arcadeMarkers}`);
    if (cards !== items || arcadeCount !== games.length || arcadeMarkers !== 1) failures++;
  } else if (html !== before) {
    fs.writeFileSync(file, html);
    console.log(`updated ${lang.file}: +${games.length} arcade games`);
  } else {
    console.log(`${lang.file}: unchanged`);
  }
}
process.exit(failures ? 1 : 0);
