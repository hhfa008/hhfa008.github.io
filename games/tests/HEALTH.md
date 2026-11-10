# 游戏自动化测试健康报告

- 最后运行：2026-11-10 10:10:52（CST）
- 运行命令：`node games/tests/run-all.js`
- 结果：**605 个测试文件 / 127,864 条断言；127,762 通过 / 102 失败**。失败全部在 `site-quality`，且全部落在 `*-premium` 页面既有债（canonical/description/touch-target/console 等），非 premium 页面 0 失败
- 覆盖：**124 / 124 款游戏**有可运行的自动化测试（含 100 个 arcade 变体与 voice-room）

## 逐游戏结果

| 游戏 | 测试文件 | 断言数 | 最后运行时间 | 状态 |
| --- | --- | ---: | --- | --- |
| 24game | `games/24game/test.js` | 34 | 2026-11-10 03:44:26 | PASS |
| aeroplane | `games/aeroplane/test.js` | 39 | 2026-11-10 03:44:26 | PASS |
| checkers-jump | `games/checkers-jump/test.js` | 30 | 2026-11-10 03:44:26 | PASS |
| chess | `games/chess/test.js` | 25 | 2026-11-10 03:44:26 | PASS |
| connect4 | `games/connect4/test.js` | 28 | 2026-11-10 03:44:26 | PASS |
| doudizhu | `games/doudizhu/test.js` | 110 | 2026-11-10 03:44:26 | PASS |
| draughts | `games/draughts/test.js` | 35 | 2026-11-10 03:44:26 | PASS |
| freecell | `games/freecell/test.js` | 38 | 2026-11-10 03:44:26 | PASS |
| go9 | `games/go9/test.js` | 31 | 2026-11-10 03:44:26 | PASS |
| gomoku | `games/gomoku/test.js` | 22 | 2026-11-10 03:44:26 | PASS |
| pioneers | `games/pioneers/test.js` | 45 | 2026-11-10 03:44:26 | PASS |
| reversi | `games/reversi/test.js` | 23 | 2026-11-10 03:44:26 | PASS |
| solitaire | `games/solitaire/test.js` | 37 | 2026-11-10 03:44:26 | PASS |
| spider | `games/spider/test.js` | 34 | 2026-11-10 03:44:26 | PASS |
| tap-match | `games/tap-match/test.js` | 23 | 2026-11-10 03:44:26 | PASS |
| undercover | `games/undercover/test.js` | 29 | 2026-11-10 03:44:26 | PASS |
| voice-room | `games/voice-room/test.js` | 96 | 2026-11-10 03:44:26 | PASS |
| xiangqi | `games/xiangqi/test.js` | 34 | 2026-11-10 03:44:26 | PASS |

## 覆盖补充说明（2026-11-10）

- voice-room 已有自动化测试：`games/voice-room/test.js`（96 条断言，PASS）。此前「voice-room 无自动化」的结论已过期。
- 100 个 arcade 变体各有 `games/<slug>/test.js`，共享模块测试由 `run-all.js` 的 `EXTRA_TESTS` 显式运行；完整清单以最近一次运行输出为准。
- 上表 17 款经典游戏的断言数经 2026-11-10 复跑核对未变，并补入 voice-room。

`games/en/`、`games/id/` 是语言首页，`games/assets/`、`games/shared/` 是资源与共享引擎，均不是游戏，不计入覆盖率。

## 测试怎么保证测的是页面本身

- 页面内含引擎的，测试直接读 `index.html` 并抽取引擎段运行，不复制业务逻辑：
  - `doudizhu`、`24game`：`__CORE_START__` / `__CORE_END__`
  - `undercover`：`UC-LOGIC-START` / `UC-LOGIC-END`
  - `aeroplane`、`checkers-jump`、`draughts`：`ENGINE START` / `ENGINE END`
  - `reversi`、`go9`：本轮新增的 `__TEST_CORE_START__` / `__TEST_CORE_END__`（仅注释，不改行为）
  - `chess`、`xiangqi`、`solitaire`、`freecell`、`spider`：按 `<script id="...">` 抽取
- `gomoku`、`connect4`：直接 `require('../shared/rules.js')`，与页面和语音房服务端共用同一份规则。
- `pioneers`：`require('./engine.js')`，页面加载的就是该文件。
- `tap-match`：页面计分逻辑与 DOM 强耦合，测试复制了 `newBoard` / `tapTile` 的纯规则，并用静态断言把关键源码片段钉住（命中 +1、误点 -1 且不低于 0、目标点掉后补位），防止两边漂移。

## 运行方式

```bash
# 全部测试（人读表格；失败时退出码 1）
node games/tests/run-all.js

# 同时写入 games/tests/report.json
node games/tests/run-all.js --json

# 单个游戏
node games/xiangqi/test.js
```

每个测试文件都由 `run-all.js` 以独立子进程运行（超时 120 秒），单个文件崩溃或超时不会影响其他游戏。测试文件统一输出 `RESULT: N passed, M failed`，runner 据此统计断言数。
