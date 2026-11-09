#!/usr/bin/env bash
# 一键部署到 Cloudflare Pages 并验证。
# 用法：scripts/deploy.sh [--dry-run]
#   --dry-run  只做干净快照与安全检查，不真正部署。
#
# 认证：使用本机 wrangler OAuth。仓库里的 CLOUDFLARE_API_TOKEN 对 Pages 不可用，
# 因此部署时明确 unset 掉它（否则 wrangler 会优先用 token 并失败）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="hhfa008-pages"
BRANCH="main"
CF_BASE="https://hhfa008-pages.pages.dev"
GH_BASE="https://hhfa008.github.io"
PROXY="http://127.0.0.1:7899"
SNAP="/tmp/cf-deploy-$$"
VERIFY_DIR="$(mktemp -d /tmp/cf-verify.XXXXXX)"
DEPLOY_LOG="$(mktemp -t cf-deploy-log.XXXXXX)"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "用法: scripts/deploy.sh [--dry-run]"
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      exit 2
      ;;
  esac
done

KEEP_DEPLOY_LOG=0
cleanup() {
  rm -rf "$SNAP" "$VERIFY_DIR"
  if [ "$KEEP_DEPLOY_LOG" -eq 0 ]; then rm -f "$DEPLOY_LOG"; fi
}
trap cleanup EXIT

fail() {
  local preserved=""
  if [ -s "$DEPLOY_LOG" ]; then
    preserved="/tmp/cf-deploy-failed-$$.log"
    cp "$DEPLOY_LOG" "$preserved"
    KEEP_DEPLOY_LOG=1
  fi
  printf '\nDEPLOY FAILED: %s\n' "$1"
  [ -n "$preserved" ] && printf '完整 wrangler 日志已保留: %s\n' "$preserved"
  exit 1
}

# ------------------------------------------------------------ 1. 干净快照
echo "== [1/4] 干净快照 =="
COMMIT="$(git rev-parse --short HEAD)" || fail "无法读取 HEAD（不是 git 仓库？）"
echo "  源提交: $COMMIT $(git log -1 --format=%s)"
rm -rf "$SNAP"
mkdir -p "$SNAP"
if ! git archive HEAD | tar -x -C "$SNAP"; then
  fail "git archive HEAD 失败"
fi
FILE_COUNT="$(find "$SNAP" -type f | wc -l | tr -d ' ')"
SNAP_SIZE="$(du -sh "$SNAP" | cut -f1)"
if [ "$FILE_COUNT" -eq 0 ]; then
  fail "快照为空"
fi
echo "  快照: ${SNAP}（$FILE_COUNT 个文件，${SNAP_SIZE}）"

MISSING=()
for required in index.html 404.html games/index.html games/sw.js sitemap-pages.xml; do
  [ -f "$SNAP/$required" ] || MISSING+=("$required")
done
if [ "${#MISSING[@]}" -ne 0 ]; then
  fail "快照缺少必需文件: ${MISSING[*]}"
fi

# ------------------------------------------------------- 2. 快照安全检查
echo "== [2/4] 快照安全检查 =="
BAD="$(find "$SNAP" \
  \( -name .git -o -name .env -o -name '.env.*' -o -name .dev.vars \
     -o -name .wrangler -o -name node_modules -o -name .ssh \
     -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name 'id_ed25519*' \) \
  -print 2>/dev/null)"
if [ -n "$BAD" ]; then
  printf '  FAIL 快照包含禁止内容：\n%s\n' "$BAD"
  fail "快照含敏感/无关文件"
fi

KEY_HITS="$(grep -rIl -E 'BEGIN [A-Z ]*PRIVATE KEY' "$SNAP" 2>/dev/null || true)"
if [ -n "$KEY_HITS" ]; then
  printf '  FAIL 快照包含私钥内容：\n%s\n' "$KEY_HITS"
  fail "快照含私钥"
fi
echo "  未发现 .git/.env/.wrangler/私钥/node_modules"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\nDRY-RUN OK：快照干净（%s 个文件），未执行部署。\n' "$FILE_COUNT"
  exit 0
fi

# --------------------------------------------------------------- 3. 部署
echo "== [3/4] 部署到 Cloudflare Pages =="
echo "  项目: $PROJECT  分支: $BRANCH  认证: 本机 wrangler OAuth"
(
  cd "$ROOT"
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY -u CLOUDFLARE_EMAIL \
    wrangler pages deploy "$SNAP" \
      --project-name "$PROJECT" \
      --branch "$BRANCH" \
      --commit-hash "$(git rev-parse HEAD)" \
      --commit-message "$(git log -1 --format=%s)" \
      --commit-dirty=true
) >"$DEPLOY_LOG" 2>&1
DEPLOY_RC=$?
tail -n 15 "$DEPLOY_LOG"
if [ "$DEPLOY_RC" -ne 0 ]; then
  fail "wrangler pages deploy 失败（exit=${DEPLOY_RC}）；完整日志：$DEPLOY_LOG"
fi
DEPLOY_URL="$(grep -oE 'https://[a-z0-9-]+\.hhfa008-pages\.pages\.dev' "$DEPLOY_LOG" | tail -1)"
echo "  部署完成: ${DEPLOY_URL:-$CF_BASE}"

# ------------------------------------------------------------- 4. 验证
echo "== [4/4] 线上验证 =="
SLEEP_BEFORE_VERIFY="${SLEEP_BEFORE_VERIFY:-8}"
echo "  等待 ${SLEEP_BEFORE_VERIFY}s 让边缘生效…"
sleep "$SLEEP_BEFORE_VERIFY"

# 从快照中抽 5 个页面 + 标题特征串。
FEATURES="$VERIFY_DIR/features.tsv"
ROOT="$SNAP" node <<'NODE' >"$FEATURES"
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const PAGES = [
  ['index.html', '/'],
  ['games/index.html', '/games/'],
  ['games/xiangqi/index.html', '/games/xiangqi/'],
  ['games/solitaire/index.html', '/games/solitaire/'],
  ['tools/index.html', '/tools/']
];
for (const [file, url] of PAGES) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let sig = '';
  let m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) sig = m[1].replace(/\s+/g, ' ').trim();
  if (sig.length < 4) {
    m = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (m) sig = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  if (!sig) { sig = 'hhfa008'; }
  console.log(url + '\t' + sig);
}
NODE

SNAP_ZH="$(grep -c 'class="game-card"' "$SNAP/games/index.html")"
SNAP_EN="$(grep -c 'class="game-card"' "$SNAP/games/en/index.html")"
SNAP_ID="$(grep -c 'class="game-card"' "$SNAP/games/id/index.html")"

fetch_to() { # url outfile -> prints http code（直连 pages.dev 偶发超时，统一走 7899 代理）
  curl -sS -L --compressed --max-time 25 --retry 2 --retry-delay 1 -H 'Cache-Control: no-cache' -x "$PROXY" -o "$2" -w '%{http_code}' "$1" 2>/dev/null
}

fetch_proxy_to() { # url outfile -> prints http code（强制走 7899 代理；与 fetch_to 同源，保留语义）
  curl -sS -L --compressed --max-time 25 --retry 2 --retry-delay 1 -H 'Cache-Control: no-cache' -x "$PROXY" -o "$2" -w '%{http_code}' "$1" 2>/dev/null
}

count_cards() {
  local file="$1"
  grep -o 'class="game-card"' "$file" 2>/dev/null | wc -l | tr -d ' '
}

verify_once() {
  local bad=0 code body count
  echo "  -- 三语大厅卡片数 --"
  local hall_files=("$VERIFY_DIR/zh.html" "$VERIFY_DIR/en.html" "$VERIFY_DIR/id.html")
  local hall_urls=("$CF_BASE/games/" "$CF_BASE/games/en/" "$CF_BASE/games/id/")
  local hall_names=("zh" "en" "id")
  local expected=("$SNAP_ZH" "$SNAP_EN" "$SNAP_ID")
  local got=()
  for i in 0 1 2; do
    code="$(fetch_to "${hall_urls[$i]}" "${hall_files[$i]}")"
    count="$(count_cards "${hall_files[$i]}")"
    got+=("$count")
    if [ "$code" = "200" ] && [ "$count" = "${expected[$i]}" ]; then
      echo "     PASS ${hall_names[$i]}: HTTP ${code}，$count 张卡片（本地 ${expected[$i]}）"
    else
      echo "     FAIL ${hall_names[$i]}: HTTP ${code}，$count 张卡片（本地 ${expected[$i]}）"
      bad=1
    fi
  done
  if [ "${got[0]}" = "${got[1]}" ] && [ "${got[1]}" = "${got[2]}" ]; then
    echo "     PASS 三语卡片数一致: ${got[0]}"
  else
    echo "     FAIL 三语卡片数不一致: ${got[*]}"
    bad=1
  fi

  echo "  -- 5 个页面特征串 --"
  local url sig
  while IFS=$'\t' read -r url sig; do
    [ -n "$url" ] || continue
    body="$VERIFY_DIR/feature.html"
    code="$(fetch_to "$CF_BASE$url" "$body")"
    if [ "$code" = "200" ] && grep -qF -- "${sig}" "$body"; then
      echo "     PASS $url 包含特征串: ${sig}"
    else
      echo "     FAIL ${url}（HTTP ${code}）未找到特征串: ${sig}"
      bad=1
    fi
  done <"$FEATURES"

  echo "  -- 404 对照 --"
  local notfound_url="$CF_BASE/this-path-should-not-exist-xyz/"
  code="$(fetch_to "$notfound_url" "$VERIFY_DIR/404.html")"
  if [ "$code" = "404" ]; then
    echo "     PASS $notfound_url -> 404"
  else
    echo "     FAIL $notfound_url -> HTTP ${code}（应为 404；200 说明落到了首页）"
    bad=1
  fi

  echo "  -- md5 对照（pages.dev vs github.io，走 7899 代理）--"
  local page cf_md5 gh_md5 cf_code gh_code
  for page in /games/xiangqi/ /tools/; do
    cf_code="$(fetch_proxy_to "$CF_BASE$page" "$VERIFY_DIR/cf.md5.bin")"
    gh_code="$(fetch_proxy_to "$GH_BASE$page" "$VERIFY_DIR/gh.md5.bin")"
    cf_md5="$(md5 -q "$VERIFY_DIR/cf.md5.bin" 2>/dev/null || md5sum "$VERIFY_DIR/cf.md5.bin" | cut -d' ' -f1)"
    gh_md5="$(md5 -q "$VERIFY_DIR/gh.md5.bin" 2>/dev/null || md5sum "$VERIFY_DIR/gh.md5.bin" | cut -d' ' -f1)"
    if [ "$cf_code" = "200" ] && [ "$gh_code" = "200" ] && [ "$cf_md5" = "$gh_md5" ]; then
      echo "     PASS $page md5 一致: $cf_md5"
    else
      echo "     FAIL $page md5 不一致: cf=$cf_md5(HTTP $cf_code) gh=$gh_md5(HTTP $gh_code)"
      bad=1
    fi
  done

  return "$bad"
}

ATTEMPTS="${VERIFY_ATTEMPTS:-6}"
VERIFY_INTERVAL="${VERIFY_INTERVAL:-8}"
VERIFIED=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  echo ""
  echo "  验证第 $attempt/$ATTEMPTS 次"
  if verify_once; then
    VERIFIED=1
    break
  fi
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    echo "  本次有失败项，${VERIFY_INTERVAL}s 后重试…"
    sleep "$VERIFY_INTERVAL"
  fi
done

if [ "$VERIFIED" -ne 1 ]; then
  fail "线上验证未通过（已尝试 $ATTEMPTS 次）"
fi

printf '\nDEPLOY OK（commit %s，项目 %s，分支 %s）\n' "$COMMIT" "$PROJECT" "$BRANCH"
