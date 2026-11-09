#!/usr/bin/env bash
# 双机同步：把本仓库的 games/、tools/ 通过远端裸库与 mac2 同步。
# 用法：scripts/sync-mac2.sh push|pull
#
#   push  推送当前分支到 mac2 的裸库；非快进被拒时自动 pull --rebase 后重试一次
#   pull  从 mac2 的裸库拉回（rebase）
#
# 注意：只同步“已提交”的内容。games/、tools/ 下未提交的改动会打印警告且不会同步。
# 远端 mac2 默认是 ssh://fa@192.168.18.127/Users/fa/.local/share/pa/workspace/hhfa008-bare.git，
# 可用环境变量 MAC2_URL 覆盖；远端名默认 mac2，可用 MAC2_REMOTE 覆盖。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"
REMOTE_NAME="${MAC2_REMOTE:-mac2}"
DEFAULT_URL="ssh://fa@192.168.18.127/Users/fa/.local/share/pa/workspace/hhfa008-bare.git"
REMOTE_URL="${MAC2_URL:-}"

if [ "$MODE" != "push" ] && [ "$MODE" != "pull" ]; then
  echo "用法: scripts/sync-mac2.sh push|pull" >&2
  exit 2
fi

fail() {
  printf 'SYNC FAILED: %s\n' "$1"
  exit 1
}

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || fail "不是 git 仓库"
if [ "$BRANCH" != "master" ]; then
  fail "当前分支是 ${BRANCH}，脚本只同步 master（请先 git switch master）"
fi

# --------------------------------------------------------- 远端配置与连通性
if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  URL="$(git remote get-url "$REMOTE_NAME")"
else
  URL="${REMOTE_URL:-$DEFAULT_URL}"
  git remote add "$REMOTE_NAME" "$URL" || fail "添加远端 $REMOTE_NAME 失败"
  echo "已添加远端 $REMOTE_NAME -> $URL"
fi
echo "远端 $REMOTE_NAME: $URL"

SSH_TARGET=""
BARE_PATH=""
if [[ "$URL" =~ ^ssh://([^@/]+@)?([^/:]+)(:([0-9]+))?(/.+)$ ]]; then
  SSH_USER="${BASH_REMATCH[1]% @}"
  SSH_USER="${SSH_USER%@}"
  SSH_HOST="${BASH_REMATCH[2]}"
  SSH_PORT="${BASH_REMATCH[4]:-22}"
  BARE_PATH="${BASH_REMATCH[5]}"
  SSH_TARGET="${SSH_USER:+$SSH_USER@}$SSH_HOST"
fi

if [ -n "$SSH_TARGET" ]; then
  echo "检查 mac2 连通性（$SSH_TARGET:${SSH_PORT}）…"
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$SSH_PORT" "$SSH_TARGET" true 2>/dev/null; then
    fail "无法 SSH 连接 ${SSH_TARGET}（mac2 是否开机 / 在同一网络？）"
  fi
fi

if [ "$MODE" = "push" ] && [ -n "$BARE_PATH" ] && [ -n "$SSH_TARGET" ]; then
  echo "确保裸库存在: $BARE_PATH"
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$SSH_PORT" "$SSH_TARGET" \
      "if [ ! -d '$BARE_PATH' ]; then git init --bare -q '$BARE_PATH' && git -C '$BARE_PATH' symbolic-ref HEAD refs/heads/master && echo CREATED; else echo EXISTS; fi"; then
    fail "在 mac2 上创建/检查裸库失败: $BARE_PATH"
  fi
fi

warn_dirty() {
  local dirty
  dirty="$(git status --porcelain -- games tools 2>/dev/null)"
  if [ -n "$dirty" ]; then
    echo "WARN games/、tools/ 下有未提交改动，这些改动不会被同步："
    printf '%s\n' "$dirty" | sed 's/^/  /'
  fi
}

remote_head() {
  git ls-remote "$REMOTE_NAME" "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}' | head -1
}

show_commits() { # label
  printf '%s local=%s remote=%s\n' "$1" \
    "$(git rev-parse --short HEAD)" \
    "$(remote_head | cut -c1-7)"
}

# ------------------------------------------------------------------- push
if [ "$MODE" = "push" ]; then
  echo ""
  echo "同步前: $(show_commits push-before)"
  warn_dirty

  PUSH_OUT="$(git push "$REMOTE_NAME" "$BRANCH:refs/heads/$BRANCH" 2>&1)"
  PUSH_RC=$?
  printf '%s\n' "$PUSH_OUT"
  if [ "$PUSH_RC" -ne 0 ]; then
    if printf '%s' "$PUSH_OUT" | grep -Eiq 'rejected|non-fast-forward|fetch first|failed to push'; then
      echo "push 被拒（远端有 mac2 自己的提交），执行 git pull --rebase 后重试一次…"
      if ! git pull --rebase "$REMOTE_NAME" "$BRANCH"; then
        if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
          git rebase --abort >/dev/null 2>&1 || true
          fail "rebase 冲突，已终止 rebase，本地未推送"
        fi
        fail "git pull --rebase 失败，未推送"
      fi
      echo "rebase 完成，本地新 HEAD: $(git rev-parse --short HEAD)"
      RETRY_OUT="$(git push "$REMOTE_NAME" "$BRANCH:refs/heads/$BRANCH" 2>&1)"
      RETRY_RC=$?
      printf '%s\n' "$RETRY_OUT"
      [ "$RETRY_RC" -eq 0 ] || fail "rebase 后重试 push 仍失败（exit=${RETRY_RC}）"
    else
      fail "git push 失败（exit=${PUSH_RC}，非快进冲突）"
    fi
  fi

  LOCAL_HEAD="$(git rev-parse HEAD)"
  REMOTE_HEAD="$(remote_head)"
  echo ""
  echo "同步后: $(show_commits push-after)"
  if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
    echo "SYNC OK: mac2 裸库 $BRANCH 已与本地一致（$(git rev-parse --short HEAD)）"
    exit 0
  fi
  fail "推送后远端 hash 与本地不一致（local=${LOCAL_HEAD:0:7} remote=${REMOTE_HEAD:0:7}）"
fi

# ------------------------------------------------------------------- pull
echo ""
echo "同步前: $(show_commits pull-before)"
warn_dirty

if ! git pull --rebase "$REMOTE_NAME" "$BRANCH"; then
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    git rebase --abort >/dev/null 2>&1 || true
    fail "rebase 冲突，已终止 rebase"
  fi
  fail "git pull --rebase 失败"
fi

echo ""
echo "同步后: $(show_commits pull-after)"
echo "SYNC OK: 已从 mac2 拉回 ${BRANCH}（本地 $(git rev-parse --short HEAD)）"
