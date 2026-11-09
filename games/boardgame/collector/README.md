# 桌游采集器（C · 采集与测试）

本目录归 C（采集与测试）所有。只放采集脚本、离线快照和采集侧文档；
页面、数据契约、schema 分别在 B / A 的目录里，不要从这里改。

## 目录

```
collector/
├── fetch-gstone.mjs                集石详情页采集 / fixture 离线重放（目录数据来源）
├── fixtures/
│   ├── gstone-2026-11-10.json      43 条集石详情页原始字段快照（含每页 HTML SHA-256）
│   └── bgg-sample.xml              BGG XML API2 结构样例（5 条，SAMPLE DATA）
├── fetch.mjs                       BGG 串行抓取 / --offline 回放（补充管线）
├── import.mjs                      BGG XML 解析与归一化（补充管线）
├── out/
│   └── games.imported.json         BGG 样例归一化结果（5 条，不作为目录真源）
└── README.md

tests/
├── run.js                          基线门禁：test-data.js + test-build.js + 构建冒烟
├── test-data.js                    数据契约、fixture 重放、筛选纯函数
├── test-build.js                   构建冒烟（列表页 / 详情页 / 字节稳定性）
├── run-all.mjs                     新契约测试 runner（递归 *.test.mjs + 基线门禁）
└── lib/、fixtures/                 新契约测试的断言/探测工具与输入数据
```

## 用法

```bash
# 统一门禁（推荐）：数据 + 构建 + 临时目录构建冒烟
node games/boardgame/tests/run.js

# 单独运行
node games/boardgame/tests/test-data.js
node games/boardgame/tests/test-build.js

# 离线重放（幂等，同一 fixture 永远产出同一份 JSON）
node games/boardgame/collector/fetch-gstone.mjs \
  --fixture games/boardgame/collector/fixtures/gstone-2026-11-10.json \
  --out games/boardgame/data/boardgames.json
```

### `--live` 实时采集

```bash
node games/boardgame/collector/fetch-gstone.mjs \
  --live --limit 10 --delay 1000 --retry 3 --out /tmp/boardgames.json
```

- 串行抓取，默认间隔 `--delay 1000`（1s），不并发。
- 每个请求最多重试 `--retry 3` 次，单次 `--timeout 15000`（15s）。
- 固定 User-Agent：`hhfa008.github.io boardgames importer (+https://hhfa008.github.io)`，
  便于上游识别来源。
- 抓取结果先写成 fixture（默认
  `collector/fixtures/gstone-YYYY-MM-DD.json`，可用 `--fixture-out` 改），
  再归一化到 `--out`（默认 `games/boardgame/data/boardgames.json`）。
- 其他参数：`--ids 550,4320` 只抓指定 id，`--proxy <url>` 走代理。

### `--fixture` 离线重放

读取快照里的原始字段重新归一化，不访问网络。测试用它校验：

1. 两次重放字节完全一致；
2. 重放结果与已提交的 `data/boardgames.json` md5 一致（数据改动必须同步更新 fixture 或说明原因）；
3. 每条记录都带 `htmlSha256`、公开详情页 URL 和抓取时间。

## fixture 来源与限制

- 来源站点：集石 <https://www.gstonegames.com>。
- 集石的 `/game/` 列表接口要求登录，公开可抓的只有首页和
  `/game/info-<id>.html` 详情页；因此 id 由公开首页发现后人工精选（当前 43 条），
  详情页逐条抓取。评分、人数、时长、设计师、出版社、年份均来自详情页，不手填。
- BGG XML API 在本机未认证时返回 401，所以没有采用 BGG 作为数据源。
- 快照只保存解析所需的原始字段和 HTML SHA-256，不保存整页 HTML；上游改版时
  `parsePage` 会因缺字段直接报错，而不是产出半空记录。

## BGG 补充管线（fetch.mjs / import.mjs）

BGG 不是目录真源，保留这条管线是为了验证第二数据源的结构、做离线回归，
以及在将来拿到 Registered Application Token 后能直接接入。

```bash
# 离线回放：解析 5 条样例，写 out/games.imported.json（不联网）
node games/boardgame/collector/import.mjs

# 用 fixture 走一遍 fetch 流程（不联网，仍会写 raw/）
node games/boardgame/collector/fetch.mjs --offline

# 在线抓取：串行、默认 1s 间隔、失败最多 3 次；
# 无 Bearer token 时 BGG 返回 401/403，脚本以退出码 3 失败，不伪造数据
node games/boardgame/collector/fetch.mjs --ids 13,822,30549,36218,266192
```

- 样例字段：`fixtures/bgg-sample.xml` 顶部注释已标注 **SAMPLE DATA**，不是真实响应。
- 归一化输出字段见 `out/games.imported.json`：`id` / `slug` / `name` / `category` /
  `players` / `bestPlayers` / `playTime` / `weight` / `rating` / `designers` /
  `publishers` / `year` / `cover` / `bgg` / `source`。
- `cover.url` 为 `null`，只保留占位文本，避免页面加载外链。
- `raw/` 是抓取原始 XML 的落盘目录，已在 `.gitignore` 中忽略；`out/` 的样例结果
  是可见、可提交的回归输入。
- 当前 `data/boardgames.json` 仍全部来自集石；BGG 5 条样例没有混入目录。

## 测试门禁约定

- `tests/run.js` 依次用子进程运行 `test-data.js`、`test-build.js`，再调用
  `node ../build.mjs --out <临时目录>` 做构建冒烟；任一套件失败即退出码 1，
  并打印失败文件与输出尾部。
- `tests/run-all.mjs` 是 C 的新契约 runner：递归执行 `tests/**/*.test.mjs`，
  并把 `tests/run.js` 基线门禁作为额外一套件运行；汇总输出
  `RESULT: N passed, M failed, K skipped`。缺失的未来模块默认 SKIP，
  `--strict` 时视为失败。详见 `tests/README.md`。
- `games/tests/run-all.js` 会递归发现 `tests/test*.js`，因此两个测试文件
  迁入本目录后仍会被主测试矩阵覆盖；`run.js` / `run-all.mjs` 不匹配
  `test*.js`，不会被重复发现。
- 仓库根 `games/tests/lib.js` 是共享测试库，从本目录以 `../../tests/lib.js` 引用。
