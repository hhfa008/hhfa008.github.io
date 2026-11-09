#!/usr/bin/env bash
# 站点备份：git bundle 全量 + games/assets + tools/*/ + 最近 7 天变更清单。
# 备份到 ~/.local/share/pa/backups/games-YYYYMMDD-HHMMSS/，保留最近 5 份。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_ROOT="${BACKUP_ROOT:-$HOME/.local/share/pa/backups}"
KEEP="${BACKUP_KEEP:-5}"
SINCE="${BACKUP_SINCE:-7 days ago}"
DRY_RUN=0

usage() {
  cat <<'EOF'
用法: scripts/backup.sh [--dry-run]

备份内容:
  repo.bundle                  仓库全量 git bundle（--all）
  games/assets/                游戏静态资源
  tools/*/                     工具站各子目录的静态资源
  changed-files-7d.txt         最近 7 天 games/ 与 tools/ 的变更清单（git log --name-only）
  META.txt                     备份时间、分支、HEAD、未提交改动

目标: ~/.local/share/pa/backups/games-YYYYMMDD-HHMMSS/
保留: 最近 5 份，更早的在打印删除清单后清理。

选项:
  --dry-run    只打印将要做的事，不写任何文件、不删除
  -h, --help   显示本帮助

环境变量:
  BACKUP_ROOT   备份根目录（默认 ~/.local/share/pa/backups）
  BACKUP_KEEP   保留份数（默认 5）
  BACKUP_SINCE  变更清单的时间范围（默认 "7 days ago"）

校验: 备份完成后执行 git bundle verify，并打印文件数、总大小与清单。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误: 未知参数 $1（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || (( KEEP < 1 )); then
  echo "错误: 保留份数必须是正整数，收到: $KEEP" >&2
  exit 2
fi

if ! git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误: 不是 git 仓库: $REPO" >&2
  exit 1
fi

BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
HEAD_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo none)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$DEST_ROOT/games-$STAMP"

fail() {
  echo "备份失败: $*" >&2
  exit 1
}

echo "仓库: $REPO"
echo "分支: $BRANCH   HEAD: ${HEAD_SHA:0:12}"
echo "目标: $DEST"
echo ""

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] 将执行以下操作（不写文件、不删除）:"
  echo "  1. 创建目录 $DEST"
  echo "  2. git bundle create \"$DEST/repo.bundle\" --all   # 全量仓库"
  echo "  3. 复制 games/assets/ -> $DEST/games/assets/"
  echo "  4. 复制 tools/*/ -> $DEST/tools/"
  echo "  5. git log --name-only --since=\"$SINCE\" -- games tools > $DEST/changed-files-7d.txt"
  echo "  6. 写入 META.txt"
  echo "  7. git bundle verify 校验 + 打印文件数/总大小/清单"
  echo ""
  echo "[dry-run] 源体积参考:"
  [[ -d "$REPO/games/assets" ]] && echo "  games/assets: $(du -sh "$REPO/games/assets" | awk '{print $1}')"
  if [[ -d "$REPO/tools" ]]; then
    tool_total="$(du -sh "$REPO/tools" | awk '{print $1}')"
    echo "  tools/:       $tool_total"
  fi
  echo ""
else
  mkdir -p "$DEST" || fail "无法创建备份目录 $DEST"

  # 1) git bundle 全量
  if ! bundle_out="$(git -C "$REPO" bundle create "$DEST/repo.bundle" --all 2>&1)"; then
    echo "$bundle_out" >&2
    fail "git bundle create 失败"
  fi
  echo "1/5 git bundle 已生成: repo.bundle"

  # 2) games/assets
  if [[ ! -d "$REPO/games/assets" ]]; then
    fail "缺少目录 $REPO/games/assets"
  fi
  mkdir -p "$DEST/games"
  cp -R "$REPO/games/assets" "$DEST/games/assets" || fail "复制 games/assets 失败"
  echo "2/5 games/assets 已复制"

  # 3) tools/*/
  mkdir -p "$DEST/tools"
  tool_dirs=()
  if [[ -d "$REPO/tools" ]]; then
    while IFS= read -r d; do
      [[ -n "$d" ]] && tool_dirs+=("$d")
    done < <(find "$REPO/tools" -mindepth 1 -maxdepth 1 -type d | sort)
  fi
  if [[ ${#tool_dirs[@]} -eq 0 ]]; then
    echo "    警告: tools/ 下没有子目录，跳过 tools 资源" >&2
  else
    for d in "${tool_dirs[@]}"; do
      cp -R "$d" "$DEST/tools/" || fail "复制 tools/$(basename "$d") 失败"
    done
  fi
  echo "3/5 tools/*/ 已复制（${#tool_dirs[@]} 个目录）"

  # 4) 最近 7 天变更清单
  git -C "$REPO" log --name-only --since="$SINCE" --date=short \
    --pretty=format:'commit %h %ad %s' -- games tools \
    > "$DEST/changed-files-7d.txt" || fail "生成最近 7 天变更清单失败"
  echo "4/5 changed-files-7d.txt 已生成"

  # 5) META
  dirty_count="$(git -C "$REPO" status --porcelain -- games tools | wc -l | tr -d ' ')"
  {
    echo "backup_time=$(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "repo=$REPO"
    echo "branch=$BRANCH"
    echo "head=$HEAD_SHA"
    echo "dirty_files_games_tools=$dirty_count"
    echo ""
    echo "# 未提交改动（games/ 与 tools/，不在 git bundle 内）"
    git -C "$REPO" status --porcelain -- games tools || true
  } > "$DEST/META.txt"
  echo "5/5 META.txt 已写入"
  echo ""
fi

# 校验与清单（dry-run 只展示计划，不校验）
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] 备份完成后的校验: git bundle verify repo.bundle；打印文件数与总大小"
else
  if verify_out="$(git -C "$REPO" bundle verify "$DEST/repo.bundle" 2>&1)"; then
    ref_count="$(git -C "$REPO" bundle list-heads "$DEST/repo.bundle" | wc -l | tr -d ' ')"
    echo "校验: git bundle verify 通过（$ref_count 个 ref）"
  else
    echo "$verify_out" >&2
    fail "git bundle verify 未通过: $DEST/repo.bundle"
  fi
fi

# 清理旧备份：先打印，再删除
shopt -s nullglob
old_dirs=()
for d in "$DEST_ROOT"/games-*; do
  [[ -d "$d" ]] || continue
  base="$(basename "$d")"
  if [[ "$base" =~ ^games-[0-9]{8}-[0-9]{6}$ ]]; then
    old_dirs+=("$d")
  fi
done
shopt -u nullglob
if [[ "$DRY_RUN" == "1" && ! -d "$DEST" ]]; then
  old_dirs+=("$DEST")
fi
sorted_dirs=()
while IFS= read -r d; do
  [[ -n "$d" ]] && sorted_dirs+=("$d")
done < <(printf '%s\n' "${old_dirs[@]}" | sort)
old_dirs=("${sorted_dirs[@]}")

total=${#old_dirs[@]}
if (( total > KEEP )); then
  delete_count=$((total - KEEP))
  to_delete=("${old_dirs[@]:0:delete_count}")
  echo ""
  echo "将删除以下 $delete_count 份旧备份（保留最近 $KEEP 份）:"
  printf '  %s\n' "${to_delete[@]}"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] 未删除任何目录"
  else
    rm -rf -- "${to_delete[@]}" || fail "清理旧备份失败"
    echo "已删除 $delete_count 份旧备份"
  fi
else
  echo ""
  echo "备份保留: 当前 $total 份（上限 ${KEEP}），无需清理"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo ""
  echo "[dry-run] 完成：以上为计划，未写入任何文件。"
  exit 0
fi

# 文件数、总大小、清单
file_count="$(find "$DEST" -type f | wc -l | tr -d ' ')"
total_size="$(du -sh "$DEST" | awk '{print $1}')"
total_bytes="$(du -sk "$DEST" | awk '{print $1 * 1024}')"

echo ""
echo "备份完成: $DEST"
echo "总大小: ${total_size}（$total_bytes 字节）  文件数: $file_count"
echo ""
echo "清单:"
printf '  %-28s %s\n' "repo.bundle" "$(du -sh "$DEST/repo.bundle" | awk '{print $1}')"
if [[ -d "$DEST/games/assets" ]]; then
  printf '  %-28s %s（%s 个文件）\n' "games/assets" \
    "$(du -sh "$DEST/games/assets" | awk '{print $1}')" \
    "$(find "$DEST/games/assets" -type f | wc -l | tr -d ' ')"
fi
if [[ -d "$DEST/tools" ]]; then
  for td in "$DEST"/tools/*/; do
    [[ -d "$td" ]] || continue
    printf '  %-28s %s（%s 个文件）\n' "tools/$(basename "$td")" \
      "$(du -sh "$td" | awk '{print $1}')" \
      "$(find "$td" -type f | wc -l | tr -d ' ')"
  done
fi
if [[ -f "$DEST/changed-files-7d.txt" ]]; then
  changed_files="$(grep -vE '^(commit |$)' "$DEST/changed-files-7d.txt" | sort -u | wc -l | tr -d ' ')"
  printf '  %-28s %s 个文件（时间范围: %s）\n' "changed-files-7d.txt" "$changed_files" "$SINCE"
fi
