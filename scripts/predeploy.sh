#!/usr/bin/env bash
# 发布前闸门：任何一项不过就 exit 1。
# 用法：scripts/predeploy.sh
# 只读：不修改工作区、不部署、不联网。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED_ITEMS=()
PASS_COUNT=0
WARN_COUNT=0
TOTAL=7

section() {
  printf '\n== 检查 %s/%s: %s ==\n' "$1" "$TOTAL" "$2"
}

mark_pass() {
  printf '[%s/%s] PASS: %s\n' "$1" "$TOTAL" "$2"
  PASS_COUNT=$((PASS_COUNT + 1))
}

mark_fail() {
  printf '[%s/%s] FAIL: %s\n' "$1" "$TOTAL" "$2"
  FAILED_ITEMS+=("$1"": $2")
}

# ---------------------------------------------------------------- 1. 单元测试
section 1 "单元测试（games/tests/run-all.js）"
TEST_LOG="$(mktemp -t predeploy-tests.XXXXXX)"
if node games/tests/run-all.js >"$TEST_LOG" 2>&1; then
  TEST_RC=0
else
  TEST_RC=$?
fi
tail -n 6 "$TEST_LOG"
TEST_FAILED="$(grep -oE '失败文件:[[:space:]]*[0-9]+' "$TEST_LOG" | grep -oE '[0-9]+$' | tail -1)"
if [ "$TEST_RC" -eq 0 ] && [ "${TEST_FAILED:-0}" = "0" ]; then
  mark_pass 1 "测试全绿（失败文件 0）"
  rm -f "$TEST_LOG"
else
  mark_fail 1 "测试未通过（exit=${TEST_RC}，失败文件=${TEST_FAILED:-未知}）；完整日志：$TEST_LOG"
fi

# ------------------------------------------------- 2. HTML 外部资源（src/href）
section 2 "外部域名资源扫描（games/、tools/ 下所有 HTML）"
if ROOT="$ROOT" node <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;

const SAME_SITE = new Set([
  'hhfa008.github.io',
  'hhfa008-pages.pages.dev',
  'w3.org',
  'www.w3.org',
  'localhost',
  '127.0.0.1',
  '[::1]'
]);
// 明确允许的站外「导航链接」（不是页面加载的资源，不影响离线/隐私）。
const OUTBOUND_ALLOW = new Set(['devinspire734.gumroad.com']);

const RESOURCE_ATTRS = {
  script: ['src'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  iframe: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  input: ['src'],
  link: ['href'],
  image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href']
};

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && /\.html?$/i.test(ent.name)) out.push(full);
  }
  return out;
}

function hostOf(u) {
  try {
    const parsed = new URL(u, 'https://hhfa008.github.io/');
    return parsed.host.toLowerCase();
  } catch (e) { return null; }
}

function externalUrl(u) {
  const raw = u.trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw) || /^\/\/[^/]/.test(raw)) {
    const host = hostOf(raw);
    if (!host) return true;
    return !SAME_SITE.has(host);
  }
  return false;
}

function attrUrls(attr, value) {
  if (attr === 'srcset') {
    return value.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
  }
  return [value.trim()];
}

const files = [];
walk(path.join(ROOT, 'games'), files);
walk(path.join(ROOT, 'tools'), files);

const violations = [];
const outboundAllowed = [];
let scannedUrls = 0;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let tagMatch;
  while ((tagMatch = tagRe.exec(text)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    const attrsText = tagMatch[2];
    const line = text.slice(0, tagMatch.index).split('\n').length;
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let attrMatch;
    while ((attrMatch = attrRe.exec(attrsText)) !== null) {
      const attr = attrMatch[1].toLowerCase();
      const value = attrMatch[3] !== undefined ? attrMatch[3]
        : attrMatch[4] !== undefined ? attrMatch[4] : attrMatch[5];

      if (tag === 'a' && attr === 'href') {
        for (const u of attrUrls(attr, value)) {
          if (!externalUrl(u)) continue;
          scannedUrls++;
          const host = hostOf(u);
          if (host && OUTBOUND_ALLOW.has(host)) {
            outboundAllowed.push({ rel, line, url: u });
          } else {
            violations.push({ rel, line, kind: '<a href> 站外链接', url: u });
          }
        }
        continue;
      }

      const wanted = RESOURCE_ATTRS[tag];
      if (!wanted || !wanted.includes(attr)) continue;
      for (const u of attrUrls(attr, value)) {
        if (!externalUrl(u)) continue;
        scannedUrls++;
        violations.push({ rel, line, kind: `<${tag} ${attr}> 外部资源`, url: u });
      }
    }
  }
}

for (const item of outboundAllowed) {
  console.log(`  INFO 允许的站外导航链接: ${item.rel}:${item.line} ${item.url}`);
}
if (violations.length) {
  for (const v of violations) {
    console.log(`  FAIL ${v.kind}: ${v.rel}:${v.line} ${v.url}`);
  }
  console.log(`  共 ${violations.length} 处外部资源引用（扫描 ${files.length} 个 HTML 文件）。`);
  process.exit(1);
}
console.log(`  扫描 ${files.length} 个 HTML 文件，检查 ${scannedUrls} 个站外 URL：无违规。`);
NODE
then
  mark_pass 2 "无外部域名资源引用"
else
  mark_fail 2 "发现外部域名资源（见上方 FAIL 行）"
fi

# ------------------------------------------- 3. 三语大厅卡片数与本地链接存在性
section 3 "三语大厅卡片数一致 + 卡片链接本地存在"
if ROOT="$ROOT" node <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const HALLS = ['games/index.html', 'games/en/index.html', 'games/id/index.html'];

function resolveCardLink(hall, href) {
  let u = href.split('#')[0].split('?')[0];
  if (!u || /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return null;
  let target;
  if (u.startsWith('/')) target = path.join(ROOT, u);
  else target = path.resolve(path.dirname(path.join(ROOT, hall)), u);
  if (!target.startsWith(ROOT + path.sep) && target !== ROOT) return null;
  if (u.endsWith('/')) return path.join(target, 'index.html');
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return path.join(target, 'index.html');
  return target;
}

let failed = false;
const counts = [];
for (const hall of HALLS) {
  const full = path.join(ROOT, hall);
  if (!fs.existsSync(full)) {
    console.log(`  FAIL 大厅不存在: ${hall}`);
    failed = true;
    counts.push(null);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  const articles = [...text.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)];
  const cards = articles.filter(article => {
    const classMatch = article[1].match(/class="([^"]*)"/);
    return classMatch && classMatch[1].split(/\s+/).includes('game-card');
  });
  counts.push(cards.length);
  if (cards.length === 0) {
    console.log(`  FAIL ${hall}: 0 张卡片`);
    failed = true;
    continue;
  }
  let missing = 0;
  for (const card of cards) {
    const m = card[0].match(/<a\b[^>]*\bhref="([^"]+)"/i);
    if (!m) {
      console.log(`  FAIL ${hall}: 卡片缺少链接`);
      failed = true;
      missing++;
      continue;
    }
    const target = resolveCardLink(hall, m[1]);
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      console.log(`  FAIL ${hall}: 卡片链接在本地不存在: ${m[1]}`);
      failed = true;
      missing++;
    }
  }
  console.log(`  ${hall}: ${cards.length} 张卡片，链接缺失 ${missing} 个`);
}

const numeric = counts.filter(c => typeof c === 'number');
if (numeric.length === 3) {
  if (new Set(numeric).size !== 1) {
    console.log(`  FAIL 三语大厅卡片数不一致: ${HALLS.map((h, i) => `${h}=${counts[i]}`).join('，')}`);
    failed = true;
  } else {
    console.log(`  PASS 三语大厅卡片数一致: ${numeric[0]}`);
  }
}
process.exit(failed ? 1 : 0);
NODE
then
  mark_pass 3 "三语大厅卡片数一致，所有卡片链接本地存在"
else
  mark_fail 3 "大厅卡片数不一致或卡片链接缺失（见上方 FAIL 行）"
fi

# --------------------------------------------- 4. CACHE_VERSION 与页面改动时间
section 4 "sw.js CACHE_VERSION 与最近改动时间"
if ROOT="$ROOT" node <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const SW = path.join(ROOT, 'games/sw.js');

if (!fs.existsSync(SW)) {
  console.log('  FAIL games/sw.js 不存在');
  process.exit(1);
}
const swText = fs.readFileSync(SW, 'utf8');
const m = swText.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!m || !m[1].trim()) {
  console.log('  FAIL games/sw.js 中找不到有效的 CACHE_VERSION');
  process.exit(1);
}
const version = m[1];
const swMtime = fs.statSync(SW).mtimeMs;

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.wrangler' || ent.name === 'tests') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && full !== SW) out.push(full);
  }
  return out;
}

const files = walk(path.join(ROOT, 'games'), []);
const newer = files
  .map(f => ({ rel: path.relative(ROOT, f), mtime: fs.statSync(f).mtimeMs }))
  .filter(f => f.mtime > swMtime + 1000)
  .sort((a, b) => b.mtime - a.mtime);

console.log(`  当前 CACHE_VERSION=${version}；sw.js 修改时间: ${new Date(swMtime).toISOString()}`);
if (newer.length) {
  console.log(`  WARN 有 ${newer.length} 个 games 文件比 sw.js 新，页面已改但 CACHE_VERSION 可能未升级：`);
  for (const f of newer.slice(0, 5)) {
    console.log(`    ${f.rel}  ${new Date(f.mtime).toISOString()}`);
  }
  if (newer.length > 5) console.log(`    …另有 ${newer.length - 5} 个`);
  console.log('  （WARN 非致命：确认是预期的页面改动后，发布前请升级 CACHE_VERSION）');
} else {
  console.log('  PASS 没有比 sw.js 更新的页面文件');
}
process.exit(0);
NODE
then
  mark_pass 4 "CACHE_VERSION 可解析；时间先后已检查（WARN 不影响闸门）"
else
  mark_fail 4 "CACHE_VERSION 缺失或无法解析"
fi

# ------------------------------------------------ 5. sitemap 覆盖（games/tools）
section 5 "sitemap 覆盖检查（games/、tools/ 页面均已收录）"
if ROOT="$ROOT" node <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const SITEMAP = path.join(ROOT, 'sitemap-pages.xml');

if (!fs.existsSync(SITEMAP)) {
  console.log('  FAIL sitemap-pages.xml 不存在');
  process.exit(1);
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && /\.html$/i.test(ent.name)) out.push(full);
  }
  return out;
}

function pagePath(rel) {
  let p = '/' + rel.split(path.sep).join('/');
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  return p;
}

const html = [...walk(path.join(ROOT, 'games'), []), ...walk(path.join(ROOT, 'tools'), [])];
const actual = new Set();
for (const file of html) {
  const rel = path.relative(ROOT, file);
  // 非收录页：PWA 离线兜底、shared/ 下的演示页、根 404。
  if (rel === 'games/offline.html') continue;
  if (rel.startsWith('games/shared/')) continue;
  if (rel === '404.html') continue;
  actual.add(pagePath(rel));
}

const xml = fs.readFileSync(SITEMAP, 'utf8');
const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].trim());
const sitemap = new Set();
for (const loc of locs) {
  let p;
  try { p = new URL(loc).pathname; } catch (e) { continue; }
  if (p.startsWith('/games/') || p.startsWith('/tools/')) sitemap.add(p);
}

const missing = [...actual].filter(p => !sitemap.has(p)).sort();
const extra = [...sitemap].filter(p => !actual.has(p)).sort();

console.log(`  实际可收录页面: ${actual.size}；sitemap 中 games/tools URL: ${sitemap.size}`);
if (extra.length) {
  console.log(`  WARN sitemap 中有 ${extra.length} 个 URL 没有对应本地页面：`);
  for (const p of extra.slice(0, 5)) console.log(`    ${p}`);
}
if (missing.length || sitemap.size < actual.size) {
  console.log(`  FAIL 有 ${missing.length} 个页面未收录进 sitemap：`);
  for (const p of missing) console.log(`    ${p}`);
  process.exit(1);
}
console.log('  PASS sitemap URL 数 ≥ 实际页面数，且所有实际页面均已收录');
process.exit(0);
NODE
then
  mark_pass 5 "sitemap 覆盖完整"
else
  mark_fail 5 "sitemap 漏收录页面（见上方 FAIL 行）"
fi

# ------------------------------------------ 6. registry 与实际文件一致
section 6 "registry 与实际文件一致"
if node scripts/check-registry.js; then
  mark_pass 6 "registry 覆盖全部游戏，目录/规则页/图标均存在"
else
  mark_fail 6 "registry 校验失败（见上方明细）"
fi

# ------------------------------------------ 7. 三语大厅与 registry 同步
section 7 "三语大厅与 registry 同步"
if node scripts/gen-hubs.js --check; then
  mark_pass 7 "三语大厅卡片区与 ItemList 均由 registry 生成"
else
  mark_fail 7 "三语大厅与 registry 不一致（运行 node scripts/gen-hubs.js --write）"
fi

# ------------------------------------------------------------------ 汇总
printf '\n----------------------------------------\n'
if [ "${#FAILED_ITEMS[@]}" -eq 0 ]; then
  printf 'PREDEPLOY OK（%d/%s 项通过）\n' "$PASS_COUNT" "$TOTAL"
  exit 0
fi
printf 'PREDEPLOY FAILED：%d 项失败\n' "${#FAILED_ITEMS[@]}"
for item in "${FAILED_ITEMS[@]}"; do printf '  - %s\n' "$item"; done
exit 1
