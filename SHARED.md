# SHARED.md — 游戏仓库与站点仓库的权威源契约

本文件是 `~/games`（开发工作区）与 `~/site-repo`（站点仓库，mac2 的
`~/projects/hhfa008.github.io`）之间的共同约定。两个仓库都在根目录保留一份。

## 唯一权威源

- **站点仓库是唯一权威源**。`~/games` 只是开发工作区。
- 合并方向单一：`~/games` → 站点仓库（`scripts/sync-to-site.sh`）；反向只允许
  「共享区以站点仓库为准」拉回（`sync-to-site.sh --pull-shared`）。
- 两边都不许各自演进。发现共享区不一致时，先修共享区，再继续开发。

## 共享区（只允许一份，权威源＝站点仓库）

机器可读清单：`games/shared-zones.txt`（脚本直接读它，不靠人眼看本文）。

| 路径 | 谁在用 |
|---|---|
| `games/assets/` | 三语大厅、全部游戏页、OG 图、图标、字体、音效 |
| `games/shared/` | 多个游戏共用的 JS 引擎（shuffle、hand-eval、sfx、physics、rewards 等） |
| `games/tests/` | 公共测试框架：`run-all.js`、`lib.js`、`browser-check.js`、report |
| `games/boardgame/app/`、`engine/` | 桌游应用壳与规则引擎，被 `play/`、`server/`、各桌游共同引用 |
| `games/boardgame/{play,server,plugin,schema,data,board,fixtures,scripts,tests,assets}/` | 对局页、联机、插件、数据 schema、目录生成输入与测试 |
| `games/boardgame/{lib.mjs,build.mjs,types.ts,index.html,README.md,...}` | 桌游目录的构建脚本、类型、生成页与文档 |
| `games/index.html`、`games/en/`、`games/id/` | 三语大厅入口（由 `registry.json` 生成卡片） |
| `games/registry.json`、`games/registry-unlisted.txt` | 大厅唯一数据源与「不上大厅」显式清单 |
| `games/sw.js`、`games/manifest.webmanifest`、`games/offline.html` | 离线壳，预缓存全部游戏资源 |
| `games/README.md`、`games/HANDOFF.md`、`games/AGENT-CONTRIBUTING.md`、`games/RETENTION.md`、`games/TASKS.json` | 仓库级规范与任务台账 |

## 各自独有（允许不同，Drift 检查只报 info）

- **站点独有**：`games/agentnet/`、`games/agents/`、`games/ai-eval/`、
  `games/ai-play/`、`games/leaderboard/`、`games/profile/`、`games/mahjong/`、
  `games/tcg-deck/`、`games/tcg-sample/`，以及 `games/boardgame/<具体桌游>/`
  里只在站点侧存在的对局实现。
- **游戏侧独有**：`games/<具体游戏>/`（如 `games/tictactoe*/`、`games/snake*/`、
  `games/boardgames/` 资料库）——这些是 `~/games` 开发出来的游戏内容，单向同步到站点。
- 仓库根的其他目录（`tools/`、`scripts/`、`ai/`、`store/` 等）不属于本契约，
  各自维护；同步脚本只处理 `games/`。

## 命令

```bash
# 开发完成后：把 ~/games/games 同步到站点仓库并在 master 上 merge --no-ff
~/games/scripts/sync-to-site.sh

# 只检查漂移（共享区不一致 → exit 1；各自独有只打印 info）
~/games/scripts/check-games-drift.sh

# 共享区被站点更新后拉回工作区
~/games/scripts/sync-to-site.sh --pull-shared
```
