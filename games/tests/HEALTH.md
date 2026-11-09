# 游戏自动化测试健康报告

- 最后运行：2026-11-09 03:34:56（CST）
- 运行命令：`node games/tests/run-all.js --json`
- 结果：**17 个测试文件全部通过，617 条断言通过，0 失败**，退出码 0
- 覆盖：**17 / 18 款游戏**有可运行的自动化测试；`voice-room` 尚无

## 逐游戏结果

| 游戏 | 测试文件 | 断言数 | 最后运行时间 | 状态 |
| --- | --- | ---: | --- | --- |
| 24game | `games/24game/test.js` | 34 | 2026-11-09 03:34:56 | PASS |
| aeroplane | `games/aeroplane/test.js` | 39 | 2026-11-09 03:34:56 | PASS |
| checkers-jump | `games/checkers-jump/test.js` | 30 | 2026-11-09 03:34:56 | PASS |
| chess | `games/chess/test.js` | 25 | 2026-11-09 03:34:56 | PASS |
| connect4 | `games/connect4/test.js` | 28 | 2026-11-09 03:34:56 | PASS |
| doudizhu | `games/doudizhu/test.js` | 110 | 2026-11-09 03:34:56 | PASS |
| draughts | `games/draughts/test.js` | 35 | 2026-11-09 03:34:56 | PASS |
| freecell | `games/freecell/test.js` | 38 | 2026-11-09 03:34:56 | PASS |
| go9 | `games/go9/test.js` | 31 | 2026-11-09 03:34:56 | PASS |
| gomoku | `games/gomoku/test.js` | 22 | 2026-11-09 03:34:56 | PASS |
| pioneers | `games/pioneers/test.js` | 45 | 2026-11-09 03:34:56 | PASS |
| reversi | `games/reversi/test.js` | 23 | 2026-11-09 03:34:56 | PASS |
| solitaire | `games/solitaire/test.js` | 37 | 2026-11-09 03:34:56 | PASS |
| spider | `games/spider/test.js` | 34 | 2026-11-09 03:34:56 | PASS |
| tap-match | `games/tap-match/test.js` | 23 | 2026-11-09 03:34:56 | PASS |
| undercover | `games/undercover/test.js` | 29 | 2026-11-09 03:34:56 | PASS |
| xiangqi | `games/xiangqi/test.js` | 34 | 2026-11-09 03:34:56 | PASS |

## 还没有自动化测试的游戏

| 游戏 | 原因 | 现有兜底 |
| --- | --- | --- |
| voice-room（语音房） | 实时联机房间，核心是 Cloudflare Worker / Durable Object 的信令与房间状态机，依赖运行时网络与存储，页面逻辑也以 DOM 为主；本轮未建立可脱离运行时的测试入口。 | 仅人工浏览器联调 / E2E；`games/shared/rules.js` 的棋类规则已被 connect4、gomoku 测试覆盖。 |

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
