# 给 agent 的贡献说明

你是刚被派到这个仓库的 agent。这份文档只回答四件事：**这里能不能验证、结果确定不确定、需不需要凭据、哪些线不能踩**。最后给一个 10 分钟走完的完整示例。

任务清单在 `games/TASKS.json`，入口命令是 `node scripts/check-tasks.js`。

## 1. 可验证性：一条命令，1508 条断言

2026-11-10 写入本文件时，在本仓库实跑 `node games/tests/run-all.js` 的输出：

```
测试文件: 24 个 · 覆盖游戏: 22/24 · 断言: 1508 passed, 0 failed · 失败文件: 0
尚无自动化测试: tcg-deck, voice-room
```

这是**写入时基线**。仓库有多个 agent 并发改 `rewards.js`、`profile/`、`leaderboard/`、`voice-room/`，测试文件与断言数会继续增加（同一天稍后复跑已是 28 个文件 / 1876 条）。**不要拿固定数字当判据，判据是最后一行「失败文件: 0」**；如果失败来自别的 agent 正在改的测试（例如 `leaderboard/test.js`），记录后继续自己的任务，不要替它修。

逐文件断言数（写入时同一次运行；并发 agent 后来新增的 `leaderboard`、`profile` 等测试未列入下表）：

| 测试 | 断言 | 测试 | 断言 |
| --- | ---: | --- | ---: |
| 24game | 34 | mahjong | 77 |
| aeroplane | 39 | pioneers | 45 |
| backgammon | 75 | reversi | 23 |
| banqi | 111 | shared/hand-eval | 376 |
| checkers-jump | 30 | shared/physics | 50 |
| chess | 25 | solitaire | 37 |
| connect4 | 28 | spider | 34 |
| doudizhu | 110 | tap-match | 23 |
| draughts | 35 | tcg-sample | 46 |
| freecell | 38 | texas-holdem | 156 |
| go9 | 31 | undercover | 29 |
| gomoku | 22 | xiangqi | 34 |

注意两点：

- `run-all.js` 会跑每个游戏目录下的 `test*.js`，外加显式列出的 `shared/hand-eval.test.js` 与 `shared/physics.test.js`。
- `shared/shuffle.test.js` **不在** `run-all.js` 的清单里（`shared/` 被遍历跳过），需要单独跑：`node games/shared/shuffle.test.js`（47 项断言，含 52×52 卡方与 100,000 次洗牌）。

除了单元测试，还有任务级验收：

```bash
node scripts/check-tasks.js --task <id>   # 逐条 PASS/FAIL + 退出码
node scripts/check-tasks.js --red         # 每个 open 任务的 probe 是否仍描述「未完成」
```

`--red` 的 probe 写的是**未完成状态**。例如存档任务要求 `hhfa-chess-save-v1` 这个标记，probe 就是「标记仍不存在」（`expect: "absent"`）。你完成实现后 probe 会失配，`--red` 报 `ROT`——这是提醒你把 `TASKS.json` 里的 `status` 改成 `done`，不是让你删 probe。

## 2. 确定性：同一个种子，逐位一致

这个仓库刻意让「可复现」成为可测试的性质，不是口头承诺。

### `games/shared/shuffle.js` 的 seeded 路径

- 种子用 FNV-1a 哈希，`splitmix32` 展开，`sfc32` 生成；同 seed 在任何平台得到同一序列。
- 生产默认路径用 `crypto.getRandomValues`（浏览器）/ `node:crypto.randomBytes`（Node），不静默降级到 `Math.random`。
- 洗牌是 Fisher-Yates；整数取样带拒绝采样，避免取模偏差。
- 固定这些性质的测试名（`node games/shared/shuffle.test.js`）：
  - `同 seed 两次结果完全一致`
  - `不同 seed 结果不同`
  - `createRng 同 seed 序列一致`
  - `shuffleDeck 同 seed 可复现`
- 每日同题任务就是复用这条路径：本地日期 `YYYY-MM-DD` 做 seed，喂给 `Shuffle.shuffle` / `createRng`。

### `games/shared/tcg.js` 的确定性重放

`games/tcg-sample/test.js`（在 `run-all.js` 里，46 条断言）固定了两组性质：

- `1. 确定性：100 个种子，每个跑两遍，动作序列与终局状态逐位一致`
  - `100/100 两遍动作序列完全一致`
  - `100/100 两遍终局快照逐位一致`
  - `100 局全部在步数上限内结束`
- `2. 重放：100 份动作日志用 replay 重跑，终局快照一致`
  - `100/100 replay 未抛错`
  - `100/100 重放终局快照与原局一致`

引擎已经提供 `match.replay(log)`（`games/shared/tcg.js:1048`），但页面还没暴露回放入口——这就是任务 `tcg-replay-ui`。

## 3. 零门槛：不需要凭据，不需要网络

- 只需要 **Node 22+**；不要 `npm install`，仓库没有 npm 依赖。
- `node games/tests/run-all.js` 完全离线，约 17 秒（`hand-eval` 的 10 万手穷举占大头）。
- 不需要任何账号、token、API key、`.env`、wrangler 登录。
- 唯一例外是语音房 E2E 任务：它要在本机跑 `wrangler dev`（本地 Durable Object，不需要云凭证）；**部署 Worker 仍然不属于 agent 的职责**。
- 不要做图像识别 / 截屏判断；验证用测试输出、DOM 文本、进程与接口信号。

## 4. 安全边界：这些不要碰

**不要碰的东西**

- 部署：`wrangler`、`scripts/deploy.sh`、`git push`、Cloudflare 项目 `hhfa008-pages`。
- 凭证：`.env`、`~/.config/`、Cloudflare token、wrangler OAuth 状态、任何私钥。
- 他人的未提交改动：不要 `git reset --hard`、不要 force push、不要清理别人的工作区。
- `games/registry.json` 的校验后门：不要手改三语大厅卡片来绕过 `gen-hubs.js` / `check-registry.js`。

**不要做的事**

- 引入第三方脚本、CDN、外部字体、统计/追踪/客服 SDK。
- 采集或上报用户数据；成绩与设置只能写本机 `localStorage`。
- 在 `games/`、`tools/` 页面里发站外请求。
- 用「人工确认 / 看起来正常」当验收；任务的 acceptance 必须是可执行命令。

**并发工作区提醒（2026-11-10）**

`games/shared/rewards.js`、`games/profile/`、`games/leaderboard/`、`games/voice-room/`、`games/registry.json` 可能正被其他 agent 修改。优先挑 `files` 不与这些路径重叠的任务；如果任务确实要改共享文件，先读最新内容，别覆盖别人的改动。

## 5. 任务契约：标记名是验收的一部分

`TASKS.json` 的 acceptance 会用固定标记检查实现是否到位。实现任务时按任务标题/命令里的标记落地：

| 任务族 | 契约 |
| --- | --- |
| 对局存档 | `localStorage` 键 `hhfa-<slug>-save-v1`，页面内出现该字符串 |
| 每日同题 | 页面内出现 `hhfa-<slug>-daily`，seed 来自 `YYYY-MM-DD` |
| 连续天数 | 键 `hhfa-streak-v1`、`hhfa-streak-makeup`、`hhfa-streak-guard-v1` |
| 可访问性 | CSS 声明 `--tap-min:44px`，目标控件使用 `var(--tap-min)` |
| 结果分享 | 页面出现函数/标记 `shareScore` |
| 设备 ID | 页面出现 `hhfa-device-id`，并同时使用 `indexedDB` 与 `document.cookie` |
| 今日 3 款路线 | 页面出现 `hhfa-daily-route` |
| 回放 UI | 页面出现 `hhfa-replay-ui` |

这些标记是「做完了」的可机器检测证据；不要只加字符串而不实现行为——单元测试和 `--task` 会一起跑。

## 6. 10 分钟上手：从选任务到提交

示例任务：`sfx-reversi`（S，黑白棋接入音效）。

```bash
# 1. 看当前状态：acceptance 会在这里失败（页面还没加载 sfx.js）
node scripts/check-tasks.js --task sfx-reversi

# 2. 读任务与目标文件
node -e 'const d=require("./games/TASKS.json");console.log(JSON.stringify(d.tasks.find(t=>t.id==="sfx-reversi"),null,2))'
```

然后改 `games/reversi/index.html`：

1. 在页面内联脚本之前加 `<script src="/games/shared/sfx.js"></script>`；
2. 在合法落子后调用 `Sfx.play('move')`，终局按胜负调用 `Sfx.play('win')` / `Sfx.play('lose')`；
3. 工具栏加静音按钮：`<button type="button" class="sfx-toggle" aria-label="静音"></button>`（`sfx.js` 会自动注入样式与图标）；
4. 不需要任何音频文件，音效在浏览器里实时合成。

```bash
# 3. 只跑该游戏的测试
node games/reversi/test.js

# 4. 跑任务验收：现在应逐条 PASS
node scripts/check-tasks.js --task sfx-reversi

# 5. 跑全量，确认没有影响别的游戏
node games/tests/run-all.js

# 6. 改 TASKS.json：status -> done，owner 填你的名字
#    提交，message 带任务 id；不要 push / 不要部署
git add games/reversi/index.html games/TASKS.json
git commit -m "feat(games/reversi): wire shared/sfx.js (sfx-reversi)"
```

DoD 四项一起满足才算完成：`run-all.js` 全绿、`--task` 退出码 0、不引入站外请求、390px 无横向溢出。
