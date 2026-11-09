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
SKIP_COUNT=0
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

mark_skip() {
  printf '[%s/%s] SKIP: %s\n' "$1" "$TOTAL" "$2"
  SKIP_COUNT=$((SKIP_COUNT + 1))
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

# --------------------------------------------- 4. CACHE_VERSION 是否随页面改动升级
section 4 "games/sw.js CACHE_VERSION 是否随页面改动升级"
if ROOT="$ROOT" node <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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
const version = m[1].trim();
console.log(`  当前 CACHE_VERSION=${version}`);

if (process.env.PREDEPLOY_SKIP_CACHE_BUMP === '1') {
  console.log('  ⚠️ 豁免已生效：PREDEPLOY_SKIP_CACHE_BUMP=1');
  console.log('  ⚠️ 本次跳过 CACHE_VERSION 升级检查；发布后用户可能继续拿到旧缓存。');
  process.exit(0);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let changedRaw;
try {
  git(['rev-parse', '--verify', 'HEAD~1']);
  changedRaw = git(['diff', 'HEAD~1', '--name-only', '--', 'games/', 'tools/']);
} catch (e) {
  console.log('  无法判断，已跳过：拿不到上一次提交（HEAD~1），可能是浅克隆或首个提交。');
  console.log('  这不是通过，只是本次无法验证 CACHE_VERSION 是否随页面改动升级。');
  process.exit(3);
}

const changed = changedRaw.split('\n').map(s => s.trim()).filter(Boolean);
// 页面内容变更：排除 service worker 自身与 tests/ 下的测试/脚手架文件。
const pageChanges = changed.filter(f =>
  f !== 'games/sw.js' &&
  !f.startsWith('games/tests/') &&
  !f.startsWith('tools/tests/') &&
  !/\.test\.js$/.test(f)
);

let previousVersion = null;
try {
  const prevSw = git(['show', 'HEAD~1:games/sw.js']);
  const pm = prevSw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (pm && pm[1].trim()) previousVersion = pm[1].trim();
} catch (e) {
  previousVersion = null;
}

if (previousVersion === null) {
  console.log('  无法判断，已跳过：上一次提交里没有可解析的 games/sw.js CACHE_VERSION。');
  console.log('  这不是通过，只是本次无法验证 CACHE_VERSION 是否随页面改动升级。');
  process.exit(3);
}

console.log(`  上一次提交（HEAD~1）CACHE_VERSION=${previousVersion}`);
if (!pageChanges.length) {
  console.log('  PASS 上一次提交以来 games/、tools/ 没有页面内容变更，无需升级版本。');
  process.exit(0);
}

if (version !== previousVersion) {
  console.log(`  PASS 页面有 ${pageChanges.length} 处内容变更，且 CACHE_VERSION 已从 ${previousVersion} 升到 ${version}。`);
  for (const f of pageChanges.slice(0, 8)) console.log(`    ${f}`);
  if (pageChanges.length > 8) console.log(`    …另有 ${pageChanges.length - 8} 个`);
  process.exit(0);
}

console.log(`  FAIL CACHE_VERSION 未变（仍为 ${version}），但上一次提交以来 games/、tools/ 有 ${pageChanges.length} 处页面内容变更：`);
for (const f of pageChanges.slice(0, 8)) console.log(`    ${f}`);
if (pageChanges.length > 8) console.log(`    …另有 ${pageChanges.length - 8} 个`);
console.log('  CACHE_VERSION 未变但 games/ 下有内容变更，请升版本后重跑');
console.log('  （升 games/sw.js 里的 CACHE_VERSION；确认无需升级时可显式设置 PREDEPLOY_SKIP_CACHE_BUMP=1）');
process.exit(1);
NODE
then
  CHECK4_RC=0
else
  CHECK4_RC=$?
fi
if [ "$CHECK4_RC" -eq 0 ]; then
  if [ "${PREDEPLOY_SKIP_CACHE_BUMP:-}" = "1" ]; then
    mark_skip 4 "已显式豁免 CACHE_VERSION 检查（PREDEPLOY_SKIP_CACHE_BUMP=1）"
  else
    mark_pass 4 "CACHE_VERSION 已升级，或本次无页面内容变更"
  fi
elif [ "$CHECK4_RC" -eq 3 ]; then
  mark_skip 4 "无法判断，已跳过（未验证 CACHE_VERSION）"
else
  mark_fail 4 "CACHE_VERSION 未变但 games/ 下有内容变更，请升版本后重跑"
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
  // 非收录页：PWA 离线兜底、shared/ 下的演示页、开发脚手架与模板、根 404。
  if (rel === 'games/offline.html') continue;
  if (rel.startsWith('games/shared/')) continue;
  if (rel.startsWith('tools/tests/')) continue;
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
  if [ "$SKIP_COUNT" -gt 0 ]; then
    printf 'PREDEPLOY OK（%d/%s 项通过，%d 项跳过）\n' "$PASS_COUNT" "$TOTAL" "$SKIP_COUNT"
  else
    printf 'PREDEPLOY OK（%d/%s 项通过）\n' "$PASS_COUNT" "$TOTAL"
  fi
  exit 0
fi
printf 'PREDEPLOY FAILED：%d 项失败\n' "${#FAILED_ITEMS[@]}"
for item in "${FAILED_ITEMS[@]}"; do printf '  - %s\n' "$item"; done
exit 1
