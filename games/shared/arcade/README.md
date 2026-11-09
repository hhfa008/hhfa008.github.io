# Arcade 共享基建

新游戏不再各写一套页面和引擎，而是由共享 kit + 模板 + 本地模型生成的 UI 拼装。

## 目录

```
games/shared/arcade/
  arcade.css          共用外观（站点 chrome、HUD、按钮、深色模式、390px）
  arcade.js           共用运行时（三语、localStorage、键盘/滑动、循环、格式化）
  GAME_CONTRACT.md    生成契约（本地模型只写 UI / CSS / 规则页）
  templates/game.html 游戏页模板
  kits/               10 个玩法家族引擎（UMD，页面与测试共用同一份代码）
  tests/              10 份家族测试套件（参数化，100 个变体共用）
  catalog.json        手工条目（兼容用）
tools/arcade/
  families.mjs        100 款游戏的数据源：家族 + 变体 + 参数 + 状态/动作契约
  build-game.mjs      kit + UI + CSS -> index.html，并生成 test.js
  gen-game.mjs        本地模型生成单款：UI -> CSS -> 构建 -> 跑测试 -> 规则页
  batch.mjs           批量、断点续跑、失败隔离
  sync-lobby.mjs      三语大厅卡片区 + JSON-LD ItemList 同步
  state.json          每款生成状态（done / failed / 尝试次数）
```

## 数据流

```
kits/<family>.js ──┬──► games/<slug>/index.html（模板 + 本地模型 UI）
tests/<family>.js ─┴──► games/<slug>/test.js（同 kit、同参数、同一套断言）

families.mjs ──► gen-game.mjs ──► UI / CSS / rules.html
                       └──► build-game.mjs ──► index.html + test.js
sync-lobby.mjs ──► 三语大厅
```

## 命令

```bash
qwen-serve start 8082                       # 起本地模型
node tools/arcade/gen-game.mjs --slug snake # 生成单款
node tools/arcade/batch.mjs --limit 5       # 小批量
node tools/arcade/batch.mjs                 # 跑完目录里所有未完成项（可中断重跑）
node tools/arcade/sync-lobby.mjs            # 同步三语大厅
node tools/arcade/sync-lobby.mjs --check    # 只校验
node games/tests/run-all.js                  # 全站测试
```

## 契约

- 页面：`var CORE = ArcadeKit.create(params)` 由模板注入；模型只写 `I18N` + 渲染/输入。
- 引擎：`newGame(rng)` / `act(state, action, rng)` / `status(state)`，纯逻辑、无 DOM。
- 状态字段与动作格式由 `families.mjs` 的 `stateKeys` / `actionSpec` 规定，kit 实现。
- 测试：`tests/<family>.js` 参数化断言；100 个变体共用，只换参数。
- 页面零外部请求；390px 不溢出；触控 ≥44×44；三语键由构建校验。

## 生成流程（单款）

1. UI：本地模型按契约写 I18N + 接线（禁止写 CORE）。
2. CSS：只写棋盘内部样式。
3. 构建：注入 kit + 参数，生成页面与 `test.js`，静态校验（体积/外链/三语键/存储 key）。
4. 测试：共享套件直接跑 kit；失败说明 kit 有 bug（修 kit，不改测试）。
5. 规则页：1200–2000 汉字，`Article` + `FAQPage` JSON-LD，校验字数与 FAQ。
6. 大厅：`sync-lobby.mjs` 幂等追加卡片与 ItemList。

## 已知限制

- 规模变体（尺寸/速度梯度）共享同一套玩法与规则页骨架，规则页内容会高度相似。
- 共享 CSS/JS 与站点早期“单文件”约定不同；这是本轮“共享基建”的明确取舍。部署侧 PWA
  缓存需要把 `/games/shared/arcade/` 纳入。
- UI 由本地模型生成，构建能保证三语键与外链合规，但不保证交互完全符合直觉；共享测试只覆盖引擎规则。
