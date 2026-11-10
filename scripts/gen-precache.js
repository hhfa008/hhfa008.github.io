#!/usr/bin/env node
/*
 * Generate games/precache-manifest.js for the /games/ service worker.
 *
 * Sources, in order of authority:
 *   1. A real directory scan of every games/<dir>/index.html (handles an incomplete
 *      registry — registry.json currently covers only part of the hall).
 *   2. The local <script src> / <link rel="stylesheet"> files those pages
 *      actually reference, plus their referenced img/icon/manifest assets.
 *   3. Runtime files under games/shared/ (modules, arcade runtime + kits),
 *      so dynamically-loaded shared code is not missed.
 *   4. games/registry.json as a hall-entry supplement only: registry data,
 *      icons and rules/guide pages for entries that exist on disk.
 *
 * Deliberately NOT included: the whole site. Test files, demo pages, unused
 * assets, other .html pages and external URLs are skipped.
 *
 * The manifest is split into three groups:
 *   shell   - install-time precache: the hall, offline fallback, web app
 *             manifest, hall/offline icons, and games/shared/ runtime.
 *             Hard budget: SHELL_BUDGET_BYTES (2 MB). Over budget => exit 1.
 *   lazy    - every other page, its scripts/styles, registry/data. Not
 *             precached; the service worker caches it on demand (SWR).
 *   runtime - images/fonts. Not precached; cached on demand (SWR).
 *
 * Idempotent: output has no timestamp and paths are sorted, so running this
 * twice produces byte-identical output ("无变化").
 *
 * No dependencies. Usage: node scripts/gen-precache.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const SW_FILE = path.join(GAMES_DIR, 'sw.js');
const OUT_FILE = path.join(GAMES_DIR, 'precache-manifest.js');
const REGISTRY_FILE = path.join(GAMES_DIR, 'registry.json');
const OFFLINE_URL = '/games/offline.html';

// Install-time shell budget. A cold offline launch needs the hall, the offline
// fallback, the web app manifest, hall/offline icons, and the shared runtime;
// game pages and their assets are cached on demand instead.
const SHELL_BUDGET_BYTES = 2 * 1024 * 1024;
const SHELL_EXACT_URLS = new Set(['/games/', OFFLINE_URL, '/games/manifest.webmanifest']);
const RUNTIME_EXT = /\.(?:svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;

// Build/test trees are not part of the offline site.
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'tests', '__tests__']);

const BUCKETS = ['pages', 'scripts', 'styles', 'assets', 'shared', 'registry', 'data'];

function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch (err) {
    return null;
  }
}

function isFile(file) {
  const st = statSafe(file);
  return !!st && st.isFile();
}

function isDir(file) {
  const st = statSafe(file);
  return !!st && st.isDirectory();
}

function isInsideGames(file) {
  const rel = path.relative(GAMES_DIR, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sortedEntries(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function urlForFile(file) {
  return '/games/' + toPosix(path.relative(GAMES_DIR, file));
}

function urlForPage(indexHtml) {
  const relDir = toPosix(path.relative(GAMES_DIR, path.dirname(indexHtml)));
  return relDir ? '/games/' + relDir + '/' : '/games/';
}

function readCacheVersion() {
  const source = fs.readFileSync(SW_FILE, 'utf8');
  const match = source.match(/var\s+CACHE_VERSION\s*=\s*'([^']+)'\s*;/);
  if (!match) {
    throw new Error('cannot find `var CACHE_VERSION = \'...\';` in games/sw.js');
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// Collection

const buckets = {};
BUCKETS.forEach(function (name) { buckets[name] = new Set(); });
const fileByUrl = new Map();
const shellIcons = new Set();
const networkRefs = [];
const dataRefs = [];
const outsideRefs = [];
const missingRefs = [];

function addUrl(bucket, url, file) {
  buckets[bucket].add(url);
  if (file && !fileByUrl.has(url)) fileByUrl.set(url, file);
}

function scanIndexPages() {
  const pages = [];
  (function walk(dir) {
    sortedEntries(dir).forEach(function (entry) {
      if (entry.name.charAt(0) === '.') return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) return;
        walk(abs);
      } else if (entry.name === 'index.html') {
        pages.push(abs);
      }
    });
  })(GAMES_DIR);
  return pages.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
}

function getAttr(tag, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const match = re.exec(tag);
  if (!match) return null;
  if (match[1] !== undefined) return match[1];
  if (match[2] !== undefined) return match[2];
  return match[3];
}

// Collect `<tag ...>` while respecting quoted attribute values. A plain
// /<tag[^>]*>/ would stop at the `>` inside inline SVG data: URIs and produce
// bogus local paths.
function findTags(html, tagName) {
  const tags = [];
  const re = new RegExp('<' + tagName + '\\b', 'gi');
  let match;
  while ((match = re.exec(html))) {
    let i = re.lastIndex;
    let quote = null;
    for (; i < html.length; i++) {
      const ch = html.charAt(i);
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        tags.push(html.slice(match.index, i + 1));
        re.lastIndex = i + 1;
        break;
      }
    }
  }
  return tags;
}

function resolveLocalRef(ref, pageDir) {
  const value = String(ref).trim();
  if (!value) return { skip: true };

  // Inline data/images and non-network schemes: nothing to fetch.
  if (/^data:/i.test(value)) return { data: true };
  if (/^(?:https?:)?\/\//i.test(value)) return { external: true };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { skip: true };

  const clean = value.split('#')[0].split('?')[0];
  if (!clean) return { skip: true };

  let abs;
  if (clean === '/games' || clean === '/games/') {
    abs = GAMES_DIR;
  } else if (clean.indexOf('/games/') === 0) {
    abs = path.join(GAMES_DIR, clean.slice('/games/'.length));
  } else if (clean.charAt(0) === '/') {
    return { outside: true };
  } else {
    abs = path.resolve(pageDir, clean);
  }

  if (!isInsideGames(abs)) return { outside: true };
  if (!isFile(abs)) return { missing: true };
  return { file: abs };
}

function recordRef(kind, ref, pageRel, pageDir) {
  const resolved = resolveLocalRef(ref, pageDir);
  if (resolved.data) {
    dataRefs.push({ page: pageRel, kind: kind, ref: String(ref) });
    return;
  }
  if (resolved.external) {
    networkRefs.push({ page: pageRel, kind: kind, ref: String(ref) });
    return;
  }
  if (resolved.outside) {
    outsideRefs.push({ page: pageRel, kind: kind, ref: String(ref) });
    return;
  }
  if (resolved.missing) {
    missingRefs.push({ page: pageRel, kind: kind, ref: String(ref) });
    return;
  }
  if (resolved.skip) return;

  const url = urlForFile(resolved.file);
  const bucket = kind === 'script' ? 'scripts' : kind === 'style' ? 'styles' : 'assets';
  addUrl(bucket, url, resolved.file);
  if (url.indexOf('/games/assets/art/premium/') === 0) {
    includeArtManifest(path.dirname(resolved.file));
  }
}

// 每套 premium 美术目录都带 art-manifest.json（img-gen 产物清单）。
// 页面只静态引用其中少数几张，其余（怪兽立绘、OG 等）靠 JS 动态拼接，
// 因此以清单为准把整组 page 文件纳入预缓存。
const includedArtDirs = new Set();
function includeArtManifest(artDir) {
  if (includedArtDirs.has(artDir)) return;
  includedArtDirs.add(artDir);
  const manifest = path.join(artDir, 'art-manifest.json');
  if (!isFile(manifest)) return;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (err) {
    missingRefs.push({ page: path.relative(GAMES_DIR, manifest), kind: 'art', ref: err.message });
    return;
  }
  Object.keys(parsed.assets || {}).forEach(function (key) {
    const page = parsed.assets[key] && parsed.assets[key].page;
    if (!page) return;
    const file = path.join(artDir, page);
    if (isFile(file)) addUrl('assets', urlForFile(file), file);
  });
}

function scanPages() {
  const pages = scanIndexPages();
  pages.forEach(function (pageAbs) {
    const pageRel = toPosix(path.relative(GAMES_DIR, pageAbs));
    const pageDir = path.dirname(pageAbs);
    addUrl('pages', urlForPage(pageAbs), pageAbs);

    const html = fs.readFileSync(pageAbs, 'utf8');

    (findTags(html, 'script')).forEach(function (tag) {
      const src = getAttr(tag, 'src');
      if (src) recordRef('script', src, pageRel, pageDir);
    });

    (findTags(html, 'link')).forEach(function (tag) {
      const rel = (getAttr(tag, 'rel') || '').toLowerCase();
      const href = getAttr(tag, 'href');
      if (!href) return;
      const tokens = rel.split(/\s+/);
      if (tokens.indexOf('stylesheet') !== -1) {
        recordRef('style', href, pageRel, pageDir);
      } else if (tokens.indexOf('manifest') !== -1 ||
                 tokens.some(function (t) { return t.indexOf('icon') !== -1; })) {
        recordRef('asset', href, pageRel, pageDir);
      }
    });

    (findTags(html, 'img')).forEach(function (tag) {
      const src = getAttr(tag, 'src');
      if (src) recordRef('asset', src, pageRel, pageDir);
    });

    // Sibling pages (e.g. online.html) and meta.json belong to the same game.
    sortedEntries(pageDir).forEach(function (entry) {
      if (!entry.isFile()) return;
      const abs = path.join(pageDir, entry.name);
      if (/\.html$/i.test(entry.name) && entry.name !== 'index.html') {
        addUrl('pages', urlForFile(abs), abs);
      } else if (entry.name === 'meta.json' || entry.name === 'realism.json') {
        addUrl('assets', urlForFile(abs), abs);
        // meta.json 的 serviceWorker.precacheIncludes 是游戏自己声明的离线资产契约；
        // 文件名相对游戏目录，找不到时回退到 assets/art/premium/<slug>/（去掉 -premium）。
        try {
          const meta = JSON.parse(fs.readFileSync(abs, 'utf8'));
          const listed = (meta.serviceWorker && meta.serviceWorker.precacheIncludes) || [];
          const slug = path.basename(pageDir).replace(/-premium$/, '');
          const artDir = path.join(GAMES_DIR, 'assets', 'art', 'premium', slug);
          listed.forEach(function (name) {
            const candidates = [path.join(pageDir, name), path.join(artDir, name)];
            const hit = candidates.find(function (file) { return isFile(file); });
            if (hit) addUrl('assets', urlForFile(hit), hit);
          });
        } catch (err) {
          missingRefs.push({ page: pageRel, kind: 'meta', ref: 'meta.json: ' + err.message });
        }
      }
    });

    // url() assets referenced from inline <style> and linked local stylesheets.
    collectCssUrls(html, pageRel, pageDir);
  });
  return pages.length;
}

function scanCssText(text, baseRel, baseDir) {
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let match;
  while ((match = re.exec(text))) {
    const ref = match[2].trim();
    if (!ref || /^(?:data:|https?:|\/\/|#)/i.test(ref)) continue;
    recordRef('asset', ref, baseRel, baseDir);
  }
}

function collectCssUrls(html, pageRel, pageDir) {
  const styleBlocks = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
  styleBlocks.forEach(function (block) { scanCssText(block, pageRel, pageDir); });
  (findTags(html, 'link')).forEach(function (tag) {
    const rel = (getAttr(tag, 'rel') || '').toLowerCase();
    if (rel.indexOf('stylesheet') === -1) return;
    const href = getAttr(tag, 'href');
    if (!href || /^(?:data:|https?:|\/\/|#)/i.test(href)) return;
    const abs = resolveGamesPath(href);
    if (!abs || !isFile(abs)) return;
    scanCssText(
      fs.readFileSync(abs, 'utf8'),
      toPosix(path.relative(GAMES_DIR, abs)),
      path.dirname(abs)
    );
  });
}

function scanSharedRuntime() {
  const sharedDir = path.join(GAMES_DIR, 'shared');
  if (!isDir(sharedDir)) return;
  (function walk(dir) {
    sortedEntries(dir).forEach(function (entry) {
      if (entry.name.charAt(0) === '.') return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) return;
        walk(abs);
      } else if (/\.(?:js|css|json)$/i.test(entry.name) && !/\.test\.js$/i.test(entry.name)) {
        addUrl('shared', urlForFile(abs), abs);
      }
    });
  })(sharedDir);
}

function resolveGamesPath(ref) {
  const value = String(ref);
  if (value.indexOf('/games/') === 0) return path.join(GAMES_DIR, value.slice('/games/'.length));
  if (value.charAt(0) === '/') return null;
  return path.resolve(GAMES_DIR, value);
}

function scanRegistry() {
  const result = { entries: 0, missing: [], error: null };
  if (!isFile(REGISTRY_FILE)) {
    result.error = 'registry.json not found';
    return result;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (err) {
    result.error = err.message;
    return result;
  }

  addUrl('data', '/games/registry.json', REGISTRY_FILE);

  const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.games) ? parsed.games : []);
  result.entries = entries.length;

  entries.forEach(function (game) {
    if (!game || typeof game !== 'object') return;
    const slug = typeof game.slug === 'string' ? game.slug : null;

    // Entry page. Normally already found by the directory scan; this keeps
    // the supplement working if a future registry entry lives elsewhere.
    if (slug) {
      const page = path.join(GAMES_DIR, slug, 'index.html');
      if (isFile(page)) addUrl('registry', urlForPage(page), page);
      else result.missing.push(slug + '/index.html');
    }

    if (typeof game.icon === 'string') {
      const icon = resolveGamesPath(game.icon);
      if (icon && isInsideGames(icon) && isFile(icon)) {
        addUrl('registry', urlForFile(icon), icon);
      } else {
        result.missing.push(game.icon);
      }
    }

    const rules = typeof game.rules === 'string'
      ? [game.rules]
      : (game.rules && typeof game.rules === 'object' ? Object.values(game.rules) : []);
    rules.forEach(function (rule) {
      if (typeof rule !== 'string') return;
      const ruleRef = slug ? slug + '/' + rule : rule;
      const ruleAbs = resolveGamesPath(ruleRef);
      if (ruleAbs && isInsideGames(ruleAbs) && isFile(ruleAbs)) {
        addUrl('registry', urlForFile(ruleAbs), ruleAbs);
      } else {
        result.missing.push(ruleRef);
      }
    });
  });

  return result;
}

function addStaticFiles() {
  // The hall reads registry.json at runtime; include other well-known data
  // files only when they actually exist (the old hand list contained paths
  // such as TASKS.json that are no longer in the tree).
  const dataFiles = [
    '/games/manifest.webmanifest',
    '/games/TASKS.json',
    '/games/ai-eval/board.json',
    '/games/tcg-sample/cards.json'
  ];
  dataFiles.forEach(function (url) {
    const abs = path.join(GAMES_DIR, url.slice('/games/'.length));
    if (isFile(abs)) addUrl('data', url, abs);
  });
}

// Icons that must exist before any game is opened. These are the only images
// in the shell: the hall page's 122 card images stay lazy/runtime (they alone
// are ~2.9 MB) and are cached the first time the hall renders under the SW.
function addShellIcon(ref, pageDir) {
  const resolved = resolveLocalRef(ref, pageDir);
  if (!resolved.file) return;
  const url = urlForFile(resolved.file);
  shellIcons.add(url);
  if (!fileByUrl.has(url)) fileByUrl.set(url, resolved.file);
}

function scanShellIcons() {
  // Web app manifest icons (home-screen/install artwork).
  const manifestFile = path.join(GAMES_DIR, 'manifest.webmanifest');
  if (isFile(manifestFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      (Array.isArray(parsed.icons) ? parsed.icons : []).forEach(function (icon) {
        if (icon && typeof icon.src === 'string') addShellIcon(icon.src, GAMES_DIR);
      });
    } catch (err) {
      // The manifest is still shipped as a shell URL; a malformed one is a
      // page-level problem, not a reason to fail the precache generator.
    }
  }

  // <link rel="icon"> on the shell pages, plus the (tiny) <img> icon strip on
  // offline.html so the offline fallback is not icon-less.
  const shellPages = [
    { file: path.join(GAMES_DIR, 'index.html'), images: false },
    { file: path.join(GAMES_DIR, 'offline.html'), images: true }
  ];
  shellPages.forEach(function (page) {
    if (!isFile(page.file)) return;
    const pageDir = path.dirname(page.file);
    const html = fs.readFileSync(page.file, 'utf8');
    findTags(html, 'link').forEach(function (tag) {
      const rel = (getAttr(tag, 'rel') || '').toLowerCase();
      const href = getAttr(tag, 'href');
      if (!href) return;
      if (rel.split(/\s+/).some(function (t) { return t.indexOf('icon') !== -1; })) {
        addShellIcon(href, pageDir);
      }
    });
    if (!page.images) return;
    findTags(html, 'img').forEach(function (tag) {
      const src = getAttr(tag, 'src');
      if (src) addShellIcon(src, pageDir);
    });
  });
}

function isRuntimeAsset(url) {
  return RUNTIME_EXT.test(url.split('?')[0]);
}

function groupFor(url) {
  if (SHELL_EXACT_URLS.has(url) || shellIcons.has(url)) return 'shell';
  if (buckets.shared.has(url)) return 'shell';
  if (isRuntimeAsset(url)) return 'runtime';
  return 'lazy';
}

// ---------------------------------------------------------------------------
// Render

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function uniqueRefs(refs, filter) {
  const seen = new Set();
  const out = [];
  refs.forEach(function (item) {
    if (filter && !filter(item)) return;
    const key = item.page + ' -> ' + item.ref;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function describeRefs(refs, filter) {
  const list = uniqueRefs(refs, filter);
  if (!list.length) return '无';
  const shown = list.slice(0, 10).map(function (item) { return item.page + ' -> ' + item.ref; });
  if (list.length > shown.length) shown.push('… 还有 ' + (list.length - shown.length) + ' 条');
  return shown.join('; ');
}

function main() {
  const version = readCacheVersion();
  const pageCount = scanPages();
  scanSharedRuntime();
  const registry = scanRegistry();
  addStaticFiles();
  scanShellIcons();

  // Exact shell URLs may not appear in any scanned bucket (offline.html is
  // deliberately not an index.html), but they still belong to the manifest.
  const offlineFile = path.join(GAMES_DIR, 'offline.html');
  if (isFile(offlineFile) && !fileByUrl.has(OFFLINE_URL)) fileByUrl.set(OFFLINE_URL, offlineFile);

  const allUrls = new Set();
  BUCKETS.forEach(function (name) {
    buckets[name].forEach(function (url) { allUrls.add(url); });
  });
  shellIcons.forEach(function (url) { allUrls.add(url); });
  SHELL_EXACT_URLS.forEach(function (url) {
    if (fileByUrl.has(url)) allUrls.add(url);
  });

  const groups = { shell: [], lazy: [], runtime: [] };
  Array.from(allUrls).sort().forEach(function (url) {
    groups[groupFor(url)].push(url);
  });

  function groupBytes(urls) {
    let bytes = 0;
    urls.forEach(function (url) {
      const file = fileByUrl.get(url);
      if (!file) return;
      const st = statSafe(file);
      if (st) bytes += st.size;
    });
    return bytes;
  }

  const bytes = {
    shell: groupBytes(groups.shell),
    lazy: groupBytes(groups.lazy),
    runtime: groupBytes(groups.runtime)
  };
  const totalBytes = bytes.shell + bytes.lazy + bytes.runtime;

  // Hard install budget gate: never ship a shell that defeats the point of
  // splitting the manifest. Fail loudly and show what is actually big.
  if (bytes.shell > SHELL_BUDGET_BYTES) {
    console.error(
      '预缓存预算超限: shell 组 ' + formatMB(bytes.shell) +
      '，超出上限 ' + formatMB(SHELL_BUDGET_BYTES) + '。'
    );
    console.error('shell 组最大的 10 个文件:');
    groups.shell
      .map(function (url) {
        const file = fileByUrl.get(url);
        const st = file ? statSafe(file) : null;
        return { url: url, size: st ? st.size : 0 };
      })
      .sort(function (a, b) { return b.size - a.size; })
      .slice(0, 10)
      .forEach(function (row) {
        console.error('  ' + formatMB(row.size) + '  ' + row.url);
      });
    console.error('请把大文件移出 shell（lazy/runtime 组）后再生成。');
    process.exit(1);
  }

  const counts = {
    shell: groups.shell.length,
    lazy: groups.lazy.length,
    runtime: groups.runtime.length,
    total: groups.shell.length + groups.lazy.length + groups.runtime.length
  };

  const facts = pageCount + ' game pages, ' + counts.shell + ' shell / ' +
    counts.lazy + ' lazy / ' + counts.runtime + ' runtime URLs, ~' +
    formatMB(totalBytes) + ' total, shell ~' + formatMB(bytes.shell) +
    ' / ' + formatMB(SHELL_BUDGET_BYTES) + ' budget';
  const content = [
    '/* AUTO-GENERATED FILE - DO NOT EDIT BY HAND.',
    ' * Generated by scripts/gen-precache.js from every games/<dir>/index.html',
    ' * plus each page\'s local <script src> / <link rel="stylesheet"> refs,',
    ' * runtimes under games/shared/, and games/registry.json as a supplement.',
    ' * Regenerate after changing pages or assets:',
    ' *   node scripts/gen-precache.js',
    ' * CACHE_VERSION is read from games/sw.js. Bump it there and regenerate in',
    ' * the same change; games/sw.js refuses to install if the versions differ.',
    ' *',
    ' * Groups:',
    ' *   shell   - install-time precache (hall, offline page, manifest, icons,',
    ' *             shared runtime). Must stay within shellLimitBytes.',
    ' *   lazy    - game pages, page scripts/styles, registry/data. Cached on',
    ' *             demand by the SW (stale-while-revalidate).',
    ' *   runtime - images/fonts. Cached on demand (stale-while-revalidate).',
    ' * ' + facts + '.',
    ' */',
    'self.GAMES_PRECACHE_MANIFEST = ' + JSON.stringify({
      schema: 2,
      version: version,
      generator: 'scripts/gen-precache.js',
      offlineUrl: OFFLINE_URL,
      budget: {
        shellLimitBytes: SHELL_BUDGET_BYTES,
        shellBytes: bytes.shell
      },
      counts: counts,
      bytes: bytes,
      groups: groups
    }, null, 2) + ';',
    ''
  ].join('\n');

  let previous = null;
  try {
    previous = fs.readFileSync(OUT_FILE, 'utf8');
  } catch (err) {
    previous = null;
  }

  const unchanged = previous === content;
  if (!unchanged) fs.writeFileSync(OUT_FILE, content);

  console.log((unchanged ? '无变化（幂等）: ' : '已写入: ') + 'games/precache-manifest.js');
  console.log('  CACHE_VERSION: ' + version);
  console.log('  页面 index.html: ' + pageCount + '（扫描总数）');
  console.log('  脚本 <script src>: ' + buckets.scripts.size);
  console.log('  样式 <link rel=stylesheet>: ' + buckets.styles.size);
  console.log('  页面资源 <img>/icon/manifest: ' + buckets.assets.size);
  console.log('  shared 运行时 js/css/json: ' + buckets.shared.size);
  console.log('  registry 入口补充: ' + buckets.registry.size);
  console.log('  运行时数据: ' + buckets.data.size);
  console.log('  shell（install 预缓存）: ' + counts.shell + ' 条，' + formatMB(bytes.shell) +
    ' / ' + formatMB(SHELL_BUDGET_BYTES) + ' 预算');
  console.log('  lazy（SWR 按需）: ' + counts.lazy + ' 条，' + formatMB(bytes.lazy));
  console.log('  runtime（SWR 按需）: ' + counts.runtime + ' 条，' + formatMB(bytes.runtime));
  console.log('  去重总数: ' + counts.total + '，估算体积: ' + formatMB(totalBytes));
  console.log('  外部网络引用跳过: ' + uniqueRefs(networkRefs).length +
    '（脚本/样式页面: ' + describeRefs(networkRefs, function (r) { return r.kind === 'script' || r.kind === 'style'; }) + '）');
  console.log('  内联 data: URI 跳过: ' + uniqueRefs(dataRefs).length);
  console.log('  /games/ 之外引用跳过: ' + uniqueRefs(outsideRefs).length +
    (outsideRefs.length ? '（' + describeRefs(outsideRefs) + '）' : ''));
  console.log('  本地缺失引用跳过: ' + uniqueRefs(missingRefs).length +
    (missingRefs.length ? '（' + describeRefs(missingRefs) + '）' : ''));
  if (registry.error) {
    console.log('  registry: 不可用（' + registry.error + '），已按目录扫描继续');
  } else {
    console.log('  registry: ' + registry.entries + ' 条，缺失图标/规则跳过 ' + registry.missing.length +
      (registry.missing.length ? '（' + registry.missing.slice(0, 10).join(', ') + '）' : ''));
  }
  console.log('  offline 页: ' + OFFLINE_URL + '（sw.js 单独处理重定向）');
}

main();
