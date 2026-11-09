# AGENTS.md

`hhfa008.github.io` 是一个免登录、无追踪的静态站点：`/games/` 有 24 款单文件桌游，`/tools/` 有 3 个本地工具，另有个人站、iOS 服务、模板商店与 AI 资源目录等静态页面。这个文件是给 **AI agent** 的入口，不是宣传页。

## 3 条命令进入状态

```bash
node --version                    # 需要 Node 22+（CI 用 Node 22，本机 v24 已通过）
node games/tests/run-all.js       # 全量测试；判据是「失败文件 0」，不是某个固定断言数
node scripts/check-tasks.js       # 列出 open 任务；再加 --red 验证看板没有腐烂
```

写入时基线（2026-11-10）：`24 个测试文件 · 覆盖游戏 22/24 · 断言 1508 passed · 失败文件 0`。多个 agent 会持续加测试，数字会变；**判据始终是最后一行「失败文件: 0」**。尚无自动化测试：`tcg-deck`、`voice-room`。

## 任务看板

- 机器可读清单：`games/TASKS.json`（36 个任务，全部来自 `games/RETENTION.md` 与 `games/tests/HEALTH.md` 的真实缺口）。
- 挑任务：`node scripts/check-tasks.js` 打印 open 任务；`node scripts/check-tasks.js --task <id>` 只跑该任务的验收命令。
- 防腐烂：`node scripts/check-tasks.js --red`。每个 open 任务的 `probe` 描述的是**未完成状态**（例如存档标记仍 `absent`）；如果 probe 已不再描述当前仓库，说明任务做完了或描述有误，`--red` 会报错。
- 完成一个任务后把 `TASKS.json` 里的 `status` 改成 `done`（`--red` 只检查 open 任务），并在 commit message 里带任务 id。

## 硬规则（逐条核实过）

1. **部署必须用干净快照**：`scripts/deploy.sh` 用 `git archive HEAD | tar -x` 打快照，并拒绝包含 `.git`、`.env`、`.wrangler`、私钥、`node_modules` 的快照。
2. **禁止 `wrangler pages deploy .`**：会把 `.git`、`.env` 一起上传。
3. **状态码不等于页面存在**：Cloudflare 在缺 404 时会用 200 返回首页；`scripts/deploy.sh` 固定用 `/this-path-should-not-exist-xyz/` 必须 404 作为对照。
4. **两站一致性只认 md5**：GitHub Pages 与 Cloudflare Pages 的同一页面 md5 必须相同，不能以「看起来都能打开」为准。
5. **服务端权威**：语音房的落子判定在 Worker / Durable Object 侧（`games/voice-room/worker/src/`），不能下放客户端。
6. **不引入外部依赖**：不引 CDN、外部字体、图标库、第三方脚本；`scripts/predeploy.sh` 会扫描 `games/`、`tools/` 下 HTML 的站外资源。
7. **不采集用户数据**：不接 analytics / 追踪 / `sendBeacon`；成绩与设置只写本机 `localStorage`。
8. **不做图像识别**：验证走进程、接口、测试输出、控件树/DOM 文本等技术信号，不截屏猜 UI。
9. **`games/registry.json` 是唯一数据源**：不要手改三语大厅卡片；改 registry 后跑 `node scripts/gen-hubs.js --write` 与 `node scripts/check-registry.js`。

## 验收定义（DoD）

一个任务算完成，必须同时满足：

1. `node games/tests/run-all.js` 全绿（0 失败；新增测试要计入断言数）。
2. `node scripts/check-tasks.js --task <id>` 退出码 0（逐条 PASS）。
3. 不引入任何外部请求：新页面不得引用站外脚本/样式/字体/图片；可跑 `bash scripts/predeploy.sh`（只读、不联网，会扫描站外资源）。
4. 390px 视口下无横向溢出（DevTools 设备模式检查；仓库目前没有自动断言）。
5. 每次改动只解决一个任务，commit message 带任务 id，例如：
   `feat(games/gomoku): wire shared/sfx.js (sfx-gomoku)`

## 安全边界

- **不要碰凭证**：不要读取或写入 `.env`、`~/.config/`、Cloudflare token、wrangler OAuth 状态。
- **不要部署**：不运行 `wrangler`、`scripts/deploy.sh`、`git push`；部署由维护者执行。
- **不要删除别人的工作**：不 `git reset --hard`、不 force push、不清理未提交改动；发现异常只报告。
- **不要引入第三方脚本**，包括统计、客服、A/B 测试脚本。
- **不要改 `games/registry.json` 来绕过校验**；新增游戏走 `games/README.md` 的标准流程。

## 不知道做什么时

```bash
node scripts/check-tasks.js
```

按 `effort` 从 S 开始；`dependsOn` 非空的任务先完成依赖。详细的上手示例、确定性与可验证性说明见 `games/AGENT-CONTRIBUTING.md`。
