#!/usr/bin/env node
'use strict';

/*
 * 从 games/registry.json 生成三语大厅的卡片区与 ItemList。
 *
 *   node scripts/gen-hubs.js --check   # 只校验，不一致 exit 1（CI / 预发布）
 *   node scripts/gen-hubs.js --write   # 写回三个大厅页
 *
 * 只替换标记块，其余结构（顶部随机按钮、搜索框、样式、页脚、脚本）不动：
 *   <!-- HUBS:ITEMLIST-START --> ... <!-- HUBS:ITEMLIST-END -->  JSON-LD 的 ItemList
 *   <!-- HUBS:AUTO-START -->     ... <!-- HUBS:AUTO-END -->      分类跳转 + 全部卡片
 *
 * 规则：
 *   - 只有 status === "live" 的游戏上大厅；
 *   - 卡片顺序 = registry.games 顺序，按 category 分组；
 *   - 图标、链接、标签、三语文案全部来自 registry。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const REGISTRY_PATH = path.join(GAMES_DIR, 'registry.json');
const SITE = 'https://hhfa008.github.io';

const LANGS = ['zh', 'en', 'id'];
const HALLS = {
  zh: 'games/index.html',
  en: 'games/en/index.html',
  id: 'games/id/index.html'
};

const MARKERS = {
  itemList: { start: '<!-- HUBS:ITEMLIST-START -->', end: '<!-- HUBS:ITEMLIST-END -->' },
  cards: { start: '<!-- HUBS:AUTO-START -->', end: '<!-- HUBS:AUTO-END -->' }
};

const CATEGORY_ORDER = ['board', 'cards', 'mahjong', 'euro', 'number', 'party', 'casual', 'online'];

const CATEGORY_META = {
  board: {
    zh: { anchor: 'board', label: '棋类', small: 'Board' },
    en: { anchor: 'board', label: 'Board' },
    id: { anchor: 'papan', label: 'Papan' }
  },
  cards: {
    zh: { anchor: 'cards', label: '卡牌', small: 'Cards' },
    en: { anchor: 'cards', label: 'Cards' },
    id: { anchor: 'kartu', label: 'Kartu' }
  },
  mahjong: {
    zh: { anchor: 'mahjong', label: '麻将', small: 'Mahjong' },
    en: { anchor: 'mahjong', label: 'Mahjong' },
    id: { anchor: 'mahjong', label: 'Mahjong' }
  },
  euro: {
    zh: { anchor: 'euro', label: '经营', small: 'Euro' },
    en: { anchor: 'euro', label: 'Euro / Strategy' },
    id: { anchor: 'euro', label: 'Euro / Strategi' }
  },
  number: {
    zh: { anchor: 'number', label: '数字', small: 'Number' },
    en: { anchor: 'number', label: 'Numbers' },
    id: { anchor: 'angka', label: 'Angka' }
  },
  party: {
    zh: { anchor: 'party', label: '聚会', small: 'Party' },
    en: { anchor: 'party', label: 'Party' },
    id: { anchor: 'pesta', label: 'Pesta' }
  },
  casual: {
    zh: { anchor: 'mini', label: '小游戏', small: 'Mini' },
    en: { anchor: 'casual', label: 'Casual' },
    id: { anchor: 'kasual', label: 'Kasual' }
  },
  online: {
    zh: { anchor: 'online', label: '在线联机', small: 'Online' },
    en: { anchor: 'online', label: 'Online voice' },
    id: { anchor: 'suara', label: 'Suara online' }
  }
};

const TEXT = {
  zh: {
    langTag: 'zh-CN',
    pageUrl: `${SITE}/games/`,
    collectionName: '在线桌游大厅',
    jumpLabel: '游戏分类',
    aiTag: '人机',
    onlineTag: '多人语音'
  },
  en: {
    langTag: 'en',
    pageUrl: `${SITE}/games/en/`,
    collectionName: 'Free Online Board Games',
    jumpLabel: 'Categories',
    aiTag: 'vs AI',
    onlineTag: 'Voice chat'
  },
  id: {
    langTag: 'id',
    pageUrl: `${SITE}/games/id/`,
    collectionName: 'Game Papan Online Gratis',
    jumpLabel: 'Kategori',
    aiTag: 'lawan AI',
    onlineTag: 'Obrolan suara'
  }
};

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(value) {
  return escHtml(value).replace(/"/g, '&quot;');
}

function readRegistry() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`无法读取 ${path.relative(ROOT, REGISTRY_PATH)}: ${err.message}`);
  }
  if (!data || !Array.isArray(data.games)) {
    throw new Error('registry.json 缺少 games 数组');
  }
  return data;
}

function liveGames(registry) {
  return registry.games.filter(game => game.status === 'live');
}

function playersLabel(players, lang) {
  const n = String(players).replace(/-/g, '–');
  if (lang === 'zh') return `${n} 人`;
  if (lang === 'id') return `${n} pemain`;
  return `${n} ${n === '1' ? 'player' : 'players'}`;
}

function latinFor(game, lang) {
  // 中文页用英文名做副标题；英/印尼页用中文名，避免与主标题重复。
  return lang === 'zh' ? game.names.en : (lang === 'id' ? game.names.en : game.names.zh);
}

function hrefFor(game, lang) {
  const query = game.slug === 'voice-room' && lang !== 'zh' ? `?lang=${lang}` : '';
  return `/games/${game.slug}/${query}`;
}

function iconSrcFor(game, lang) {
  return lang === 'zh' ? game.icon : `../${game.icon}`;
}

function findOgImage(slug) {
  const exts = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
  for (const ext of exts) {
    const rel = `assets/og/${slug}.${ext}`;
    if (fs.existsSync(path.join(GAMES_DIR, rel))) return rel;
  }
  return null;
}

function imageUrlFor(game) {
  const og = findOgImage(game.slug);
  const rel = og || game.icon;
  return rel ? `${SITE}/games/${rel}` : undefined;
}

function tagsFor(game, lang) {
  const parts = [`<span class="people">${escHtml(playersLabel(game.players, lang))}</span>`];
  if (Array.isArray(game.ai) && game.ai.length) {
    parts.push(`<span>${escHtml(TEXT[lang].aiTag)}</span>`);
  }
  if (game.category === 'online') {
    parts.push(`<span class="live">${escHtml(TEXT[lang].onlineTag)}</span>`);
  }
  return parts.join('');
}

function searchTextFor(game, lang, categoryLabel) {
  const words = [
    game.slug,
    game.names.zh,
    game.names.en,
    game.names.id,
    game.blurb.zh,
    game.blurb.en,
    game.blurb.id,
    playersLabel(game.players, lang),
    categoryLabel
  ];
  if (Array.isArray(game.ai) && game.ai.length) words.push(TEXT[lang].aiTag);
  return escAttr(words.join(' ').toLowerCase());
}

function smallFor(category, lang, count) {
  const meta = CATEGORY_META[category][lang];
  if (lang === 'zh') return meta.small;
  if (lang === 'id') return `${count} game`;
  return `${count} game${count === 1 ? '' : 's'}`;
}

function renderHalls(registry, lang) {
  const games = liveGames(registry);
  const grouped = new Map();
  for (const category of CATEGORY_ORDER) grouped.set(category, []);
  for (const game of games) {
    if (!grouped.has(game.category)) grouped.set(game.category, []);
    grouped.get(game.category).push(game);
  }
  const present = [...grouped.entries()].filter(([, list]) => list.length > 0);

  const lines = [];
  lines.push(`    <nav class="jump" aria-label="${escAttr(TEXT[lang].jumpLabel)}">`);
  for (const [category, list] of present) {
    const meta = CATEGORY_META[category][lang];
    lines.push(`      <a href="#${meta.anchor}">${escHtml(meta.label)} <span>${list.length}</span></a>`);
  }
  lines.push('    </nav>');
  lines.push('  </section>');

  for (const [category, list] of present) {
    const meta = CATEGORY_META[category][lang];
    lines.push('');
    lines.push(`  <section class="cat" id="${meta.anchor}" data-cat="${category}" aria-labelledby="${meta.anchor}-title">`);
    lines.push('    <div class="cat-head">');
    lines.push(`      <h2 id="${meta.anchor}-title">${escHtml(meta.label)}</h2><span class="count">${list.length}</span><small>${escHtml(smallFor(category, lang, list.length))}</small>`);
    lines.push('    </div>');
    lines.push('    <div class="grid">');
    lines.push('');
    for (const game of list) {
      const name = game.names[lang];
      lines.push(`      <article class="game-card" data-slug="${escAttr(game.slug)}" data-search="${searchTextFor(game, lang, meta.label)}">`);
      lines.push(`        <a href="${escAttr(hrefFor(game, lang))}">`);
      lines.push(`          <div class="card-head"><img src="${escAttr(iconSrcFor(game, lang))}" alt="" width="44" height="44" loading="lazy" decoding="async"><div><h3>${escHtml(name)}</h3><span class="latin">${escHtml(latinFor(game, lang))}</span></div></div>`);
      lines.push(`          <p class="desc">${escHtml(game.blurb[lang])}</p>`);
      lines.push(`          <p class="tags">${tagsFor(game, lang)}</p>`);
      lines.push('        </a>');
      lines.push('      </article>');
      lines.push('');
    }
    lines.push('    </div>');
    lines.push('  </section>');
  }

  return lines.join('\n').replace(/\n+$/, '');
}

function descriptionFor(registry, lang) {
  const games = liveGames(registry);
  const names = games.map(game => game.names[lang]);
  if (lang === 'zh') {
    return `${games.length} 款免费在线桌游：${names.join('、')}。无需登录，手机打开就能玩；除语音房外均可离线。`;
  }
  if (lang === 'id') {
    return `${games.length} game papan online gratis: ${names.join(', ')}. Tanpa daftar; main langsung di HP, dan semua kecuali ruang suara bisa offline.`;
  }
  return `${games.length} free online board games: ${names.join(', ')}. No sign-up; play in your browser, and all but the voice room work offline.`;
}

function renderItemList(registry, lang) {
  const games = liveGames(registry);
  const text = TEXT[lang];
  const lines = [];
  lines.push('<script type="application/ld+json">');
  lines.push('{');
  lines.push('  "@context": "https://schema.org",');
  lines.push('  "@type": "CollectionPage",');
  lines.push(`  "name": ${JSON.stringify(text.collectionName)},`);
  lines.push(`  "url": ${JSON.stringify(text.pageUrl)},`);
  lines.push(`  "inLanguage": ${JSON.stringify(text.langTag)},`);
  lines.push(`  "description": ${JSON.stringify(descriptionFor(registry, lang))},`);
  lines.push('  "isPartOf": { "@type": "WebSite", "name": "Devin", "url": "https://hhfa008.github.io/" },');
  lines.push('  "mainEntity": {');
  lines.push('    "@type": "ItemList",');
  lines.push(`    "numberOfItems": ${games.length},`);
  lines.push('    "itemListElement": [');
  games.forEach((game, index) => {
    const image = imageUrlFor(game);
    const comma = index === games.length - 1 ? '' : ',';
    lines.push(`      { "@type": "ListItem", "position": ${index + 1}, "name": ${JSON.stringify(game.names[lang])}, "url": ${JSON.stringify(`${SITE}/games/${game.slug}/`)}, "image": ${JSON.stringify(image)} }${comma}`);
  });
  lines.push('    ]');
  lines.push('  }');
  lines.push('}');
  lines.push('</script>');
  return lines.join('\n');
}

function locateRegion(text, markers, file) {
  const startAt = text.indexOf(markers.start);
  const endAt = text.indexOf(markers.end);
  if (startAt === -1 || endAt === -1) {
    throw new Error(`${file}: 缺少标记 ${markers.start} 或 ${markers.end}`);
  }
  if (endAt < startAt) {
    throw new Error(`${file}: 标记顺序错误（END 在 START 之前）`);
  }
  if (text.indexOf(markers.start, startAt + 1) !== -1) {
    throw new Error(`${file}: 标记 ${markers.start} 出现多次，无法确定替换范围`);
  }
  if (text.indexOf(markers.end, endAt + 1) !== -1) {
    throw new Error(`${file}: 标记 ${markers.end} 出现多次，无法确定替换范围`);
  }
  return { startAt, endAt: endAt + markers.end.length };
}

function replaceRegion(text, markers, body, file) {
  const { startAt, endAt } = locateRegion(text, markers, file);
  const replacement = `${markers.start}\n${body}\n${markers.end}`;
  return text.slice(0, startAt) + replacement + text.slice(endAt);
}

function firstDifference(current, expected) {
  const a = current.split('\n');
  const b = expected.split('\n');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      return { line: i + 1, current: a[i] === undefined ? '(行不存在)' : a[i], expected: b[i] === undefined ? '(行不存在)' : b[i] };
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const wantWrite = args.includes('--write');
  const wantCheck = args.includes('--check');
  if (wantWrite && wantCheck) {
    console.error('不能同时使用 --write 和 --check');
    process.exit(2);
  }
  if (!wantWrite && !wantCheck) {
    console.error('用法: node scripts/gen-hubs.js --check | --write');
    process.exit(2);
  }

  const registry = readRegistry();
  const live = liveGames(registry);
  let changed = 0;
  let mismatched = 0;

  for (const lang of LANGS) {
    const rel = HALLS[lang];
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      console.error(`FAIL 缺少大厅页: ${rel}`);
      mismatched++;
      continue;
    }
    const current = fs.readFileSync(file, 'utf8');
    let expected = current;
    try {
      expected = replaceRegion(expected, MARKERS.itemList, renderItemList(registry, lang), rel);
      expected = replaceRegion(expected, MARKERS.cards, renderHalls(registry, lang), rel);
    } catch (err) {
      console.error(`FAIL ${err.message}`);
      mismatched++;
      continue;
    }

    const diff = firstDifference(current, expected);
    if (!diff) {
      console.log(`OK   ${rel}: 与 registry 一致（${live.length} 张卡片）`);
      continue;
    }
    mismatched++;
    if (wantWrite) {
      fs.writeFileSync(file, expected);
      changed++;
      console.log(`WRITE ${rel}: 已更新（${live.length} 张卡片，首个变化在第 ${diff.line} 行）`);
    } else {
      console.log(`FAIL ${rel}: 与 registry 不一致（首个变化在第 ${diff.line} 行）`);
      console.log(`     当前: ${diff.current}`);
      console.log(`     应为: ${diff.expected}`);
    }
  }

  console.log('');
  if (wantWrite) {
    console.log(changed ? `GEN HALLS OK：写入 ${changed} 个页面，${live.length} 款 live 游戏` : `GEN HALLS OK：三个大厅已是最新（${live.length} 款 live 游戏）`);
    process.exit(0);
  }
  if (mismatched) {
    console.log(`GEN HALLS CHECK FAILED：${mismatched} 个页面不一致。运行 node scripts/gen-hubs.js --write 重新生成。`);
    process.exit(1);
  }
  console.log(`GEN HALLS CHECK OK：三个大厅与 registry 一致（${live.length} 款 live 游戏）`);
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`FAIL ${err.message}`);
    process.exit(1);
  }
}

module.exports = { renderHalls, renderItemList, HALLS, MARKERS, CATEGORY_META };
