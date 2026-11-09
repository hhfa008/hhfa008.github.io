# 站点基础设施与运维

本文记录 `hhfa008.github.io`（游戏 / 工具站）的本地预览、可用性巡检与备份。
所有脚本都在 `scripts/` 下，均可 `--help` 查看参数。

## 日常运维

### 1. 本地预览

```bash
scripts/serve.sh                 # 默认 http://127.0.0.1:8099/
scripts/serve.sh --port 9000     # 指定端口；被占用会自动顺延
```

启动后会打印可访问入口：`/games/`（中）、`/games/en/`、`/games/id/`、`/tools/`（含 en/id）、站点首页。

- 本地预览不需要部署，改完刷新即可。
- 按 `Ctrl+C` 干净退出，不会残留进程。
- 与 CI 一致使用 node 起静态服务，改的是磁盘上的文件，不经过构建。

### 2. 可用性巡检

```bash
scripts/healthcheck.sh           # 一行结论：HEALTHY 或 UNHEALTHY: <原因>
scripts/healthcheck.sh --json    # 机读 JSON（适合日志/告警）
```

检查项：

1. 两个域名 `/games/` 可访问：GitHub Pages、Cloudflare Pages（后者默认走 `127.0.0.1:7899` 代理）。
2. 三语大厅（中 / 英 / 印尼）各自包含对应语言特征串，卡片数一致。
3. `/this-path-should-not-exist-xyz/` 在两站都必须返回 404。
4. 两站 `/games/` 响应内容 md5 相同。
5. `games/sw.js`、`games/manifest.webmanifest`、`games/offline.html` 可访问。

退出码：`0` 健康，`1` 不健康（任何取页失败都算不健康，不会被当成健康）。
可用环境变量覆盖：`PAGES_PROXY`（设为 `none` 直连）、`CURL_TIMEOUT`、`EXPECTED_CARDS`。

建议频率：**每 30 分钟**。cron 示例：

```cron
*/30 * * * * cd /Users/fa/projects/hhfa008.github.io && ./scripts/healthcheck.sh >> "$HOME/.local/share/pa/logs/healthcheck.log" 2>&1
```

launchd / cron 调用时注意保留网络代理（Cloudflare 站点依赖 `7899`）。

### 3. 备份

```bash
scripts/backup.sh --dry-run      # 只打印计划，不写文件
scripts/backup.sh                # 真跑：备份 + 校验 + 清理
```

- 目标目录：`~/.local/share/pa/backups/games-YYYYMMDD-HHMMSS/`
- 内容：`repo.bundle`（`git bundle --all` 全量）、`games/assets/`、`tools/*/`、最近 7 天 `games/` 与 `tools/` 的变更清单、`META.txt`（HEAD / 分支 / 未提交改动）。
- 完成后执行 `git bundle verify`，并打印文件数、总大小与清单。
- 保留最近 5 份；清理旧备份前会先打印将删除的目录，再执行删除。

建议频率：**每天一次**（例如凌晨 3:30）。cron 示例：

```cron
30 3 * * * cd /Users/fa/projects/hhfa008.github.io && ./scripts/backup.sh >> "$HOME/.local/share/pa/logs/backup.log" 2>&1
```

### 频率建议汇总

| 项目 | 命令 | 建议频率 |
| --- | --- | --- |
| 本地预览 | `scripts/serve.sh` | 开发时按需 |
| 可用性巡检 | `scripts/healthcheck.sh` | 每 30 分钟 |
| 备份 | `scripts/backup.sh` | 每天一次；重大改动后可手动加跑一次 |
