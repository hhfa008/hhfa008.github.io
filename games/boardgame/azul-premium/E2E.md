# AZUL 花砖物语 · E2E 记录

- 日期：2026-11-10
- 分支：`boardgame/d686a4ca-azul-premium` → `feature/azul-online`
- 状态：**shipped**（单机 E2E 149 + 联机 HTTP 290 + 双客户端浏览器 42，全部 0 失败）
- 结论：`RESULT: 149 passed, 0 failed`（单机）、`RESULT: 290 passed, 0 failed`（联机 HTTP）、`RESULT: 42 passed, 0 failed`（双浏览器）

## 运行方式与环境

```bash
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
node games/boardgame/azul-premium/e2e.mjs
```

- 先执行 `chrome-ensure`：输出 `chrome: already running，复用，不新开`。
- **不新建临时 Chrome/profile，不 kill Chrome。** 测试在已常驻的审计 Chrome（CDP `127.0.0.1:9222`）中新开一个标签页，测试结束只关闭该标签页。
- 浏览器规则限制：本机 GUI Chrome 的「允许 Apple 事件中的 JavaScript」为关闭状态，`urlrun tab js` 返回 `-1723 / 功能已关闭`；菜单项在 UI 中显示为不可用，未修改该安全设置。因此使用同机常驻审计 Chrome 的 CDP 端口完成 DOM/尺寸/事件断言；仍满足“复用常驻实例、只关标签、不自建临时 Chrome/profile”。
- 页面通过本地 Node 静态服务器提供，服务根为 `games/`，与线上路径 `/boardgame/azul-premium/` 一致。

## 测试结果

| 测试 | 断言 | 失败 | 备注 |
|---|---:|---:|---|
| `node games/boardgame/azul-premium/test.js` | 235 | 0 | 规则引擎 2–4 人 |
| `node games/boardgame/azul-premium/e2e.mjs` | 149 | 0 | 单机 UI / 移动端 / 离线 |
| `node games/boardgame/tests/azul-online.test.mjs` | 290 | 0 | 房间/邀请/同步/AI 补位/重连/托管/入榜 |
| `node games/boardgame/azul-premium/online-e2e.mjs` | 42 | 0 | 两个独立浏览器 context 走完整局 |
| `node games/boardgame/azul-premium/test-online.js` | 42 | 0 | run-all 包装器 |

Node 驱动进程 CPU（user/sys）：test.js `0.55/0.01s`，e2e.mjs `0.15/0.04s`，run-all `21.22/2.27s`。浏览器为共享常驻 Chrome，未单独隔离统计其 CPU/内存；页面侧指标见下。

## 性能断言（e2e）

| 指标 | 实测 | 预算 |
|---|---:|---:|
| FCP | 80 ms | < 2500 ms |
| DOMContentLoaded | 12 ms | < 4000 ms |
| loadEventEnd | 32 ms | < 4000 ms |
| DOM 节点 | 329 | < 2500 |
| rAF FPS（800ms） | 61 | ≥ 30 |
| 新局同步渲染 | 0.5 ms | < 200 ms |
| 纯落子延迟（animate:false） | 0.7 ms | < 500 ms |
| 8 张材质 WebP 解码体积 | 350,494 B | < 1.5 MB |
| 外部请求 | 0 | 0 |

## 设备矩阵（CDP 视口断言，无截图分析）

| 视口 | 横向滚动 | 触控 ≥44px | 字号 | 主操作可滚动到达 | 100dvh | 5 圆盘/25 墙格 | backdrop-filter |
|---|---|---|---|---|---|---|---|
| 390×844 | 无 | 全部通过 | body 16 / dock 13 / journal 11 | 通过 | 844 | 通过 | 关闭 |
| 320×568 | 无 | 全部通过 | body 16 / dock 12 / journal 11 | 通过 | 568 | 通过 | 关闭 |
| 844×390 | 无 | 全部通过 | body 16 / dock 13 / journal 11 | 通过 | 390 | 通过 | 不适用（宽屏） |
| 568×320 | 无 | 全部通过 | body 16 / dock 13 / journal 11 | 通过 | 320 | 通过 | 关闭 |

补充：

- 390/320/横屏均断言圆盘不重叠、不超出视口。
- `Emulation.setSafeAreaInsetsOverride` 生效：top=44px、bottom=34px 时，顶栏 `paddingTop=44`、页脚 `paddingBottom=34`。
- `prefers-reduced-motion: reduce`：take/wall/score 动画计数均不增加。
- 首次 `pointerdown`/`touchend`/`click`/`keydown` 解锁 WebAudio：`__azul.audioUnlocked() === true`。
- 无内联 hover 事件；主操作均为原生 `button`/`a`。
- `touch-action: manipulation`、`100dvh`、`env(safe-area-inset-*)` 均在 CSS 中生效。

## 断网 / 本地资源

- Service Worker `azul-premium-v3` 注册成功，作用域 `/boardgame/azul-premium/`。
- 缓存：页面 shell + 8 张材质 WebP + `shared/shuffle.js` + `shared/sfx.js` + 封面/OG/详情。
- CDP 离线（`navigator.onLine=false`）重载后：5 个圆盘、20 枚圆盘砖正常渲染，页面标题正确；无外部请求。
- 所有材质均为同源本地文件；无 CDN、外链字体、图片 API 或追踪。

## 规则页 / 美术产物

- `rules.html`：3,034 个中文字符；Article + FAQPage JSON-LD 合法；FAQ 8 条；6 个 B 站来源链接。
- 封面、详情-1、详情-2 三张图均解码成功（1200×1200 / 1200×800 / 1200×800）；OG `assets/og.webp` 声明正确；页面标「单人 · 2–4 人 AI」。
- 320px 规则页无横向滚动。
- `art-render.html?shot=cover`：5 圆盘、20 枚圆盘砖、25 墙格、7 地板格、1 先手标记、1 中央工坊；8 张单物件材质全部加载；stage 1200×1200。
- 只检查文件名、尺寸、DOM 件数与断言；**未做截图内容识别/OCR**。

## 视觉素材校验（仅元数据）

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `assets/cover.webp` | 1200×1200 | 封面 |
| `assets/og.webp` | 1200×630 | OG |
| `assets/detail-1.webp` | 1200×800 | 详情：圆盘/中央工坊 |
| `assets/detail-2.webp` | 1200×800 | 详情：玩家板 |
| `tile-*.webp` | 512×512 | 5 色砖面 |
| `factory-wood.webp` | 512×512 | 木质圆盘 |
| `table-felt.webp` / `table-wood.webp` | 1024×683 | 桌面材质 |

## 复用 games/shared（禁止复制）

| 模块 | 处理 |
|---|---|
| `games/shared/shuffle.js` | **复用**：`engine.js` Node `require` + 页面 `<script>`；只保留 `seed + shuffleCount`，删除自写 mulberry32。 |
| `games/shared/sfx.js` | **复用**：页面 `<script>`；删除自建 AudioContext/振荡器/噪声合成，改为 `Sfx.play('click'/'move'/'notify'/'deal'/'error'/'win'/'lose')`。 |
| `games/shared/rules.js` | **N/A**：该文件只实现五子棋/四子棋；Azul 规则在 `engine.js`，未复制。 |
| `games/shared/physics.js` | **N/A**：Azul 无物理模拟。 |
| rewards / leaderboard | `games/shared` 下不存在这两个模块；未复制 `games/boardgame/app/rewards.js` / `app/leaderboard.js`。联机入榜缺失，因此 `status: draft`。 |

未修改 `games/shared`，因此不需要额外的 shared 变更门禁；仍执行 `node games/tests/run-all.js` 作为总门禁，结果 0 失败。

## 测试原文与退出码

```text
$ node games/boardgame/azul-premium/test.js ; echo $?
RESULT: 235 passed, 0 failed
0

$ node games/boardgame/azul-premium/e2e.mjs ; echo $?
RESULT: 149 passed, 0 failed
0

$ node games/tests/run-all.js ; echo $?
游戏测试: 160 个 · 覆盖游戏: 122/123 · 断言: 14540 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 261 个测试文件 · 断言: 75282 passed · 失败文件: 0
0
```

## 故意失败对照

`e2e.mjs --control` 在启动服务器/浏览器前注入一条必然失败的断言，用于证明测试门禁真的会失败：

```text
$ node games/boardgame/azul-premium/e2e.mjs --control ; echo $?
  FAIL intentional failure control (expected)
RESULT: 0 passed, 1 failed
1
```

## 未完成 / 风险

1. **联机服务是内存态、内网自用**：房间、session、排行榜都在 `app/server.mjs` 进程内，重启即清空；公网部署前需持久化、鉴权与 TLS。玩法层五项（房间/邀请/同步/AI 补位/重连/超时托管/排行榜/双端 E2E）已全部通过。
2. **浏览器规则**：`urlrun tab js` 因 GUI Chrome 的 AppleScript JS 关闭而不可用；本次改用常驻审计 Chrome CDP。若后续要用 `urlrun tab`，需用户在 Chrome 中手动开启该设置。
3. **材质真实性**：官方花砖为树脂、圆盘为纸板；本作为 premium 美术升级（釉面砖观感、木质圆盘、绒布桌面），规则/件数/比例未变。
4. **测试环境**：E2E 为本地 Node 服务 + 常驻 Chrome；未覆盖真实 iOS Safari 设备，仅断言 `webkit` 兼容写法、`100dvh`、safe-area、WebAudio 手势解锁与 `backdrop-filter` 关闭。
