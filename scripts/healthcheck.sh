#!/usr/bin/env bash
# 站点可用性与内容一致性巡检。
# 结论只输出一行: HEALTHY 或 UNHEALTHY: <原因>；退出码 0/1。
# 适配 cron/launchd：不交互、有超时、无外部依赖。
# 兼容 macOS 自带 bash 3.2（不使用关联数组）。
set -uo pipefail

GH_BASE="${HEALTHCHECK_GH_BASE:-https://hhfa008.github.io}"
CF_BASE="${HEALTHCHECK_CF_BASE:-https://hhfa008-pages.pages.dev}"
# Cloudflare Pages 在本机需走 7899 代理；设为 none 可直连。
PAGES_PROXY="${PAGES_PROXY-http://127.0.0.1:7899}"
CURL_TIMEOUT="${CURL_TIMEOUT:-20}"
EXPECTED_CARDS="${EXPECTED_CARDS:-21}"

LANG_KEYS="zh en id"

lang_path() {
  case "$1" in
    zh) printf '/games/' ;;
    en) printf '/games/en/' ;;
    id) printf '/games/id/' ;;
  esac
}
lang_marker() {
  case "$1" in
    zh) printf '在线桌游大厅' ;;
    en) printf 'Free Online Board Games' ;;
    id) printf 'Game Papan Online Gratis' ;;
  esac
}
lang_attr() {
  case "$1" in
    zh) printf 'lang="zh-CN"' ;;
    en) printf 'lang="en"' ;;
    id) printf 'lang="id"' ;;
  esac
}
lang_name() {
  case "$1" in
    zh) printf '中文' ;;
    en) printf '英文' ;;
    id) printf '印尼语' ;;
  esac
}
site_base() {
  case "$1" in
    github) printf '%s' "$GH_BASE" ;;
    cloudflare) printf '%s' "$CF_BASE" ;;
  esac
}
site_proxy() {
  case "$1" in
    github) printf '' ;;
    cloudflare) printf '%s' "$PAGES_PROXY" ;;
  esac
}

RESOURCES="/games/sw.js /games/manifest.webmanifest /games/offline.html"
SITE_NAMES="github cloudflare"

JSON=0
usage() {
  cat <<'EOF'
用法: scripts/healthcheck.sh [选项]

检查两个线上域名（GitHub Pages / Cloudflare Pages）的可用性与一致性：
  1. 两站 /games/ 可访问
  2. 三语大厅各自包含语言特征串，卡片数一致
  3. 不存在的路径必须返回 404（两站）
  4. 两站 /games/ 内容 md5 相同
  5. 关键资源 sw.js / manifest.webmanifest / offline.html 可访问

选项:
  --json       输出机读 JSON（stdout 只有 JSON）
  -h, --help   显示本帮助

环境变量:
  PAGES_PROXY      Cloudflare 站点代理，默认 http://127.0.0.1:7899；none 表示直连
  CURL_TIMEOUT     单次请求超时秒数，默认 20
  EXPECTED_CARDS   期望的大厅卡片数，默认 21
  HEALTHCHECK_GH_BASE / HEALTHCHECK_CF_BASE  覆盖检查域名

结论: 输出一行 HEALTHY 或 UNHEALTHY: <原因>；退出码 0 健康 / 1 不健康。
适合 cron/launchd 每 30 分钟调用一次。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误: 未知参数 $1（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

if [[ "$PAGES_PROXY" == "none" ]]; then PAGES_PROXY=""; fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/healthcheck.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

FAILS=()
CHECKS=()

json_esc() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/ }"
  s="${s//$'\t'/ }"
  printf '%s' "$s"
}

record() { # name ok(true|false) detail
  local name="$1" ok="$2" detail="$3"
  CHECKS+=("{\"name\":\"$(json_esc "$name")\",\"ok\":$ok,\"detail\":\"$(json_esc "$detail")\"}")
  if [[ "$ok" != "true" ]]; then
    FAILS+=("$name: $detail")
  fi
}

# fetch_body URL PROXY OUTFILE -> 打印 HTTP 状态码；失败打印 000。
# 错误详情写入文件（command substitution 是子 shell，变量传不出来）。
FETCH_ERR=""
fetch_body() {
  local url="$1" proxy="$2" out="$3"
  local errfile="$TMP/curl.err"
  local -a args=(-sS -L --max-redirs 5 --retry 1 --retry-delay 1 --retry-all-errors --max-time "$CURL_TIMEOUT" -o "$out" -w '%{http_code}')
  [[ -n "$proxy" ]] && args+=(-x "$proxy")
  local code rc
  code="$(curl "${args[@]}" "$url" 2>"$errfile")"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    printf 'curl 退出码 %s: %s' "$rc" "$(tr '\n' ' ' <"$errfile" | cut -c1-200)" >"$TMP/fetch.err"
    printf '000'
  else
    : >"$TMP/fetch.err"
    printf '%s' "$code"
  fi
}

read_fetch_err() {
  FETCH_ERR="$(cat "$TMP/fetch.err" 2>/dev/null || true)"
}

# 1) 可用性 + 取回 /games/（供内容与 md5 使用）
GH_LOBBY="$TMP/github-games.html"
CF_LOBBY="$TMP/cloudflare-games.html"
GH_LOBBY_OK=0
CF_LOBBY_OK=0
GH_ERR=""
CF_ERR=""
for site in $SITE_NAMES; do
  base="$(site_base "$site")"
  out="$TMP/$site-games.html"
  code="$(fetch_body "$base/games/" "$(site_proxy "$site")" "$out")"
  read_fetch_err
  if [[ "$code" == "200" ]]; then
    ok=1
    record "access-$site" true "$base/games/ -> 200"
  else
    ok=0
    if [[ "$code" == "000" ]]; then
      record "access-$site" false "$base/games/ 访问失败（${FETCH_ERR}）"
    else
      record "access-$site" false "$base/games/ 返回 ${code}（期望 200）"
    fi
  fi
  case "$site" in
    github) GH_LOBBY_OK=$ok; GH_LOBBY="$out"; GH_ERR="$FETCH_ERR" ;;
    cloudflare) CF_LOBBY_OK=$ok; CF_LOBBY="$out"; CF_ERR="$FETCH_ERR" ;;
  esac
done

# 2) 三语内容特征 + 卡片数（同一站点三语必须一致）
for site in $SITE_NAMES; do
  base="$(site_base "$site")"
  proxy="$(site_proxy "$site")"
  c_zh="?"
  c_en="?"
  c_id="?"
  for lang in $LANG_KEYS; do
    path="$(lang_path "$lang")"
    if [[ "$lang" == "zh" ]]; then
      if [[ "$site" == "github" ]]; then
        out="$GH_LOBBY"
        FETCH_ERR="$GH_ERR"
        [[ "$GH_LOBBY_OK" == "1" ]] && code=200 || code=000
      else
        out="$CF_LOBBY"
        FETCH_ERR="$CF_ERR"
        [[ "$CF_LOBBY_OK" == "1" ]] && code=200 || code=000
      fi
    else
      out="$TMP/$site-$lang.html"
      code="$(fetch_body "$base$path" "$proxy" "$out")"
      read_fetch_err
    fi

    if [[ "$code" != "200" ]]; then
      detail="$base$path 取页失败（"
      if [[ "$code" == "000" ]]; then detail+="访问失败: $FETCH_ERR"; else detail+="HTTP $code"; fi
      detail+="）"
      record "content-$site-$lang" false "$detail"
      continue
    fi

    problems=""
    if ! grep -qF -- "$(lang_marker "$lang")" "$out"; then
      problems="$problems 缺少语言特征串「$(lang_marker "$lang")」;"
    fi
    if ! grep -qF -- "$(lang_attr "$lang")" "$out"; then
      problems="$problems 缺少 $(lang_attr "$lang") 标记;"
    fi
    count="$(grep -c 'class="game-card"' "$out" 2>/dev/null || true)"
    count="$(printf '%s' "$count" | tr -d '[:space:]')"
    [[ -z "$count" ]] && count=0
    if [[ "$count" != "$EXPECTED_CARDS" ]]; then
      problems="$problems 卡片数 ${count}（期望 ${EXPECTED_CARDS}）;"
    fi

    if [[ -z "$problems" ]]; then
      record "content-$site-$lang" true "$base$path 特征串命中，卡片 $count 张"
    else
      record "content-$site-$lang" false "$base$path${problems%;}"
    fi

    case "$lang" in
      zh) c_zh="$count" ;;
      en) c_en="$count" ;;
      id) c_id="$count" ;;
    esac
  done

  if [[ "$c_zh" == "$c_en" && "$c_en" == "$c_id" && "$c_zh" != "?" ]]; then
    record "card-parity-$site" true "中/英/印尼卡片数一致：$c_zh"
  else
    record "card-parity-$site" false "三语卡片数不一致：中=$c_zh 英=$c_en 印尼=$c_id"
  fi
done

# 3) 404 对照
ghost="/this-path-should-not-exist-xyz/"
for site in $SITE_NAMES; do
  base="$(site_base "$site")"
  code="$(fetch_body "$base$ghost" "$(site_proxy "$site")" "$TMP/$site-404.html")"
  read_fetch_err
  if [[ "$code" == "404" ]]; then
    record "404-$site" true "$base$ghost -> 404"
  elif [[ "$code" == "000" ]]; then
    record "404-$site" false "$base$ghost 访问失败（${FETCH_ERR}）"
  else
    record "404-$site" false "$base$ghost 返回 ${code}（期望 404，可能存在 SPA 回退）"
  fi
done

# 4) 两站 /games/ md5 一致
if [[ "$GH_LOBBY_OK" == "1" && "$CF_LOBBY_OK" == "1" ]]; then
  if command -v md5sum >/dev/null 2>&1; then
    gh_md5="$(md5sum "$GH_LOBBY" | awk '{print $1}')"
    cf_md5="$(md5sum "$CF_LOBBY" | awk '{print $1}')"
  else
    gh_md5="$(md5 -q "$GH_LOBBY")"
    cf_md5="$(md5 -q "$CF_LOBBY")"
  fi
  if [[ "$gh_md5" == "$cf_md5" ]]; then
    record "md5-games" true "两站 /games/ md5 一致：$gh_md5"
  else
    record "md5-games" false "两站 /games/ md5 不同：GitHub=$gh_md5 Cloudflare=$cf_md5"
  fi
else
  record "md5-games" false "无法比对：至少一站 /games/ 未取到"
fi

# 5) 关键资源
for site in $SITE_NAMES; do
  base="$(site_base "$site")"
  for res in $RESOURCES; do
    code="$(fetch_body "$base$res" "$(site_proxy "$site")" "$TMP/res.out")"
    read_fetch_err
    if [[ "$code" == "200" ]]; then
      record "resource-$site$res" true "$base$res -> 200"
    elif [[ "$code" == "000" ]]; then
      record "resource-$site$res" false "$base$res 访问失败（${FETCH_ERR}）"
    else
      record "resource-$site$res" false "$base$res 返回 ${code}（期望 200）"
    fi
  done
done

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HEALTHY=1
[[ ${#FAILS[@]} -gt 0 ]] && HEALTHY=0

if [[ "$JSON" == "1" ]]; then
  checks_joined="$(IFS=,; printf '%s' "${CHECKS[*]}")"
  reasons_joined=""
  if [[ ${#FAILS[@]} -gt 0 ]]; then
    for i in "${!FAILS[@]}"; do
      [[ $i -gt 0 ]] && reasons_joined+=","
      reasons_joined+="\"$(json_esc "${FAILS[$i]}")\""
    done
  fi
  if [[ $HEALTHY -eq 1 ]]; then status="HEALTHY"; else status="UNHEALTHY"; fi
  printf '{"status":"%s","healthy":%s,"timestamp":"%s","expected_cards":%s,"checks":[%s],"reasons":[%s]}\n' \
    "$status" "$([[ $HEALTHY -eq 1 ]] && echo true || echo false)" "$TS" "$EXPECTED_CARDS" "$checks_joined" "$reasons_joined"
  [[ $HEALTHY -eq 1 ]] && exit 0 || exit 1
fi

if [[ $HEALTHY -eq 1 ]]; then
  echo "HEALTHY"
  exit 0
else
  reason_joined="$(IFS='; '; printf '%s' "${FAILS[*]}")"
  echo "UNHEALTHY: $reason_joined"
  exit 1
fi
