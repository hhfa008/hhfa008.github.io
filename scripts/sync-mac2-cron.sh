#!/usr/bin/env bash
# 定时同步：主力机 -> mac2 裸库 /Users/fa/games.git（launchd 每 30 分钟一次）
#
# 与 scripts/sync-mac2.sh 的分工：
#   sync-mac2.sh      交互式，默认远端是 mac2（hhfa008-bare.git），被拒时会自动 rebase 重试
#   sync-mac2-cron.sh 无人值守，远端是 mac2repo（/Users/fa/games.git），被拒只记录、绝不 force/rebase
#
# 行为：
#   1. 8 秒超时探测 mac2；离线记 SKIP offline，exit 0（不积累告警）
#   2. 本地处于合并/变基/拣选态时记 SKIP merging，exit 0
#   3. 推送 master 与 mac2-merge，绝不加 --force
#   4. 被拒（non-fast-forward）记 REJECTED，exit 1，不自动 rebase/reset
#   5. 每次运行向 $HOME/.local/share/pa/logs/sync-mac2.log 追加一行（时间、结果、两侧哈希、耗时）
#   6. 日志超过 1MB 轮转为 .1
#   7. mkdir 原子锁防重入；锁持有进程已死则接管残留锁
#
# 只同步已提交内容，不碰任何工作区。可用环境变量覆盖：MAC2_ROOT / MAC2_REMOTE / MAC2_URL
# / MAC2_LOG_FILE / MAC2_LOCK_DIR。
set -uo pipefail

ROOT="${MAC2_ROOT:-/Users/fa/projects/hhfa008.github.io}"
REMOTE_NAME="${MAC2_REMOTE:-mac2repo}"
CANONICAL_URL="${MAC2_URL:-ssh://fa@192.168.18.127/Users/fa/games.git}"
BRANCHES="master mac2-merge"
LOG_DIR="${MAC2_LOG_DIR:-$HOME/.local/share/pa/logs}"
LOG_FILE="${MAC2_LOG_FILE:-$LOG_DIR/sync-mac2.log}"
LOCK_DIR="${MAC2_LOCK_DIR:-$HOME/.local/share/pa/run/sync-mac2.lock.d}"
PROBE_SECS=8
LOG_MAX=1048576

START_EPOCH="$(date +%s)"
LOCK_HELD=0

# 无人值守：绝不允许 ssh 因口令/交互卡住；网络中途黑洞也能自己断开
export GIT_LFS_SKIP_PUSH=1
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2}"

# ------------------------------------------------------------------ 基础设施
with_timeout() { # 秒数 命令...
  local secs="$1"; shift
  if command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  else
    "$@"
  fi
}

cleanup() {
  if [ "$LOCK_HELD" = 1 ]; then
    rm -rf "$LOCK_DIR"
    LOCK_HELD=0
  fi
}
trap cleanup EXIT INT TERM HUP

rotate_log() {
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  [ -f "$LOG_FILE" ] || return 0
  local size
  size="$(wc -c < "$LOG_FILE" 2>/dev/null | tr -d ' ')"
  [ -n "$size" ] || return 0
  if [ "$size" -gt "$LOG_MAX" ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi
}

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_DIR")" 2>/dev/null || true
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_HELD=1
    return 0
  fi
  local pid=""
  [ -f "$LOCK_DIR/pid" ] && pid="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 1   # 上一轮仍在跑
  fi
  # 持有进程已不存在：残留锁，接管（只删自己的锁目录）
  printf 'stale lock (pid=%s) reclaimed\n' "${pid:-none}" >&2
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_HELD=1
    return 0
  fi
  return 1
}

# 本地/远端短哈希
local_short() { git rev-parse --short=7 "refs/heads/$1" 2>/dev/null; }

skip_seg() { # 本地哈希 远端标签
  local lb="$1" rb="$2"
  [ -n "$lb" ] || lb="none"
  [ -n "$rb" ] || rb="none"
  printf '(local:%s->%s remote:%s->%s)' "$lb" "$lb" "$rb" "$rb"
}

remote_snapshot() { # 填充 R_MASTER / R_MAC2MERGE（不存在则为空）
  local out
  out="$(git ls-remote "$PUSH_TARGET" refs/heads/master refs/heads/mac2-merge 2>/dev/null)"
  R_MASTER="$(printf '%s\n' "$out" | awk '$2=="refs/heads/master"{print substr($1,1,7)}')"
  R_MAC2MERGE="$(printf '%s\n' "$out" | awk '$2=="refs/heads/mac2-merge"{print substr($1,1,7)}')"
}

# 本仓库 + 持有 master/mac2-merge 的 worktree 的 git dir
git_dirs_to_check() {
  local wt="" line gd
  git rev-parse --absolute-git-dir 2>/dev/null
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }" ;;
      "branch refs/heads/master"|"branch refs/heads/mac2-merge")
        gd="$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)" && printf '%s\n' "$gd"
        ;;
    esac
  done < <(git worktree list --porcelain 2>/dev/null)
}

merging_reason() { # 输出合并/变基态的文件名，否则空
  local gd f
  while IFS= read -r gd; do
    [ -n "$gd" ] || continue
    for f in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD sequencer; do
      if [ -e "$gd/$f" ]; then
        printf '%s/%s' "$gd" "$f"
        return 0
      fi
    done
  done < <(git_dirs_to_check)
  return 0
}

finish() { # result reason exit_code
  local result="$1" reason="$2" code="$3"
  local dur=$(( $(date +%s) - START_EPOCH ))
  local line
  line="$(date '+%Y-%m-%dT%H:%M:%S%z') result=${result} reason=${reason:-none} exit=${code} dur=${dur}s"
  [ -n "${SEG_MASTER:-}" ] && line="$line master${SEG_MASTER}"
  [ -n "${SEG_MAC2MERGE:-}" ] && line="$line mac2-merge${SEG_MAC2MERGE}"
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  printf '%s\n' "$line" >> "$LOG_FILE"
  printf '%s\n' "$line"
  exit "$code"
}

# ------------------------------------------------------------------ 主流程
acquire_lock || {
  rotate_log
  SEG_MASTER="$(skip_seg "$(cd "$ROOT" 2>/dev/null && local_short master)" unknown)"
  SEG_MAC2MERGE="$(skip_seg "$(cd "$ROOT" 2>/dev/null && local_short mac2-merge)" unknown)"
  finish "SKIP" "locked" 0
}

rotate_log

cd "$ROOT" 2>/dev/null || finish "FAIL" "root-missing" 1
git rev-parse --git-dir >/dev/null 2>&1 || finish "FAIL" "not-a-git-repo" 1

# 1) 探测 mac2（硬 8 秒）
if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  PUSH_URL="$(git remote get-url "$REMOTE_NAME")"
  if [ "$PUSH_URL" = "$CANONICAL_URL" ]; then
    PUSH_TARGET="$REMOTE_NAME"
  else
    printf 'WARN remote %s -> %s != %s, 直接按 URL 推送\n' "$REMOTE_NAME" "$PUSH_URL" "$CANONICAL_URL" >&2
    PUSH_TARGET="$CANONICAL_URL"
  fi
else
  PUSH_URL="$CANONICAL_URL"
  PUSH_TARGET="$CANONICAL_URL"
fi

SSH_USERHOST=""
SSH_PORT=22
if [[ "$PUSH_URL" =~ ^ssh://([^@/]+@)?([^/:]+)(:([0-9]+))?/ ]]; then
  SSH_USERHOST="${BASH_REMATCH[1]:-}${BASH_REMATCH[2]:-}"
  SSH_PORT="${BASH_REMATCH[4]:-22}"
fi

if [ -n "$SSH_USERHOST" ]; then
  if ! with_timeout "$PROBE_SECS" ssh -o BatchMode=yes -o ConnectTimeout="$PROBE_SECS" \
        -o ConnectionAttempts=1 -p "$SSH_PORT" "$SSH_USERHOST" true 2>/dev/null; then
    SEG_MASTER="$(skip_seg "$(local_short master)" unknown)"
    SEG_MAC2MERGE="$(skip_seg "$(local_short mac2-merge)" unknown)"
    finish "SKIP" "offline" 0
  fi
fi

# 2) 合并/变基态
MERGE_STATE="$(merging_reason)"
if [ -n "$MERGE_STATE" ]; then
  remote_snapshot
  SEG_MASTER="$(skip_seg "$(local_short master)" "${R_MASTER:--}")"
  SEG_MAC2MERGE="$(skip_seg "$(local_short mac2-merge)" "${R_MAC2MERGE:--}")"
  printf 'merge/rebase in progress: %s\n' "$MERGE_STATE" >&2
  finish "SKIP" "merging" 0
fi

# 3) 推送
remote_snapshot
M_RB="${R_MASTER:-}"; N_RB="${R_MAC2MERGE:-}"
M_LB="$(local_short master)"; N_LB="$(local_short mac2-merge)"
OVERALL="OK"; REASON=""

push_one() { # branch local_sha
  local b="$1" lb="$2" out rc
  if [ -z "$lb" ]; then
    printf 'branch %s 不存在，跳过\n' "$b" >&2
    OVERALL="FAIL"; REASON="${REASON}branch-missing:${b};"
    return 0
  fi
  printf 'push %s -> %s\n' "$b" "$PUSH_TARGET"
  out="$(git push --porcelain "$PUSH_TARGET" "refs/heads/${b}:refs/heads/${b}" 2>&1)"
  rc=$?
  [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/  /'
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if printf '%s' "$out" | grep -Eiq 'rejected|non-fast-forward|fetch first'; then
    printf 'REJECTED: %s 远端有本地没有的提交；不 force，不 rebase\n' "$b" >&2
    [ "$OVERALL" = "OK" ] && OVERALL="REJECTED"
    REASON="${REASON}non-fast-forward:${b};"
  else
    printf 'FAIL: %s push 失败 rc=%s\n' "$b" "$rc" >&2
    OVERALL="FAIL"
    REASON="${REASON}push-error:${b};"
  fi
  return 0
}

push_one master "$M_LB"
push_one mac2-merge "$N_LB"

M_LA="$(local_short master)"; N_LA="$(local_short mac2-merge)"
remote_snapshot
M_RA="${R_MASTER:-}"; N_RA="${R_MAC2MERGE:-}"

SEG_MASTER="(local:${M_LB:-none}->${M_LA:-none} remote:${M_RB:-none}->${M_RA:-none})"
SEG_MAC2MERGE="(local:${N_LB:-none}->${N_LA:-none} remote:${N_RB:-none}->${N_RA:-none})"

# 配图资源单独同步：LFS 对象不走 SSH（远端无 git-lfs-authenticate），
# 所以 git 里只有指针，真实图片用 rsync 增量复制
ART_TMP="${TMPDIR:-/tmp}/sync-art-$$"; ART_LOG="$HOME/.local/share/pa/logs/sync-art.log"
if [ "${MAC2_SKIP_ART_RSYNC:-0}" != "1" ] && [ -d "$ROOT/games/assets/art" ]; then
  ART_SIG="$(find "$ROOT/games/assets/art" -type f -newer "$HOME/.local/share/pa/run/art-synced.stamp" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${ART_SIG:-0}" = "0" ]; then
    echo "art unchanged, skip rsync"
  elif rsync -a --timeout=300 "$ROOT/games/assets/art/" "fa@192.168.18.127:hhfa008-art/" >>"$ART_LOG" 2>&1; then
    touch "$HOME/.local/share/pa/run/art-synced.stamp"
    echo "art rsync ok ($ART_SIG changed files)"
  else
    echo "art rsync failed (see $ART_LOG)" >&2
    [ "$OVERALL" = "OK" ] && OVERALL="FAIL"
    REASON="${REASON}art-rsync;"
  fi
fi

case "$OVERALL" in
  OK)       finish "OK" "" 0 ;;
  REJECTED) finish "REJECTED" "${REASON%;}" 1 ;;
  *)        finish "FAIL" "${REASON%;}" 1 ;;
esac
