# AZUL 花砖物语 · 验收材料

- 状态：**shipped 候选**（五项硬性要求 + 联机双客户端 E2E 全过；等待批量放量决定）
- 分支：`boardgame/d686a4ca-azul-premium`
- 入口：`index.html`（单人）· `online.html`（联机大厅）· `online-server.mjs`（Node HTTP 房间服务）
- 规则：`rules.html` · 设计：`DESIGN.md` · 进度：`PROGRESS.md` · E2E：`E2E.md`

## 五项门禁

| 门禁 | 结果 | 证据 |
|---|---|---|
| process：设计→实现→单测→性能→E2E→验收 | ✅ | `DESIGN.md`、`test.js`、`perf.json`、`e2e.mjs`、本文件 |
| art：封面 + OG + 详情配图（本地栅格） | ✅ | `assets/cover.png/webp`、`assets/og.png/webp`、`assets/detail-1*`、`assets/detail-2*` |
| realism：≥3 项真实规则/尺寸/比例/颜色/材质校验 | ✅ | `realism.json`：6 项，全部 `ok:true` |
| mobile：390×844 + 320×568 真机视口 | ✅ | `E2E.md` 设备矩阵；所有可见文字 ≥12px；触控 ≥44px；无横向滚动 |
| mode：多人游戏联机 + 双客户端同局 E2E | ✅ | `online-server.mjs`、`online.html`、`test-online.js`、`online-e2e.json` |

## 命令与结果

```text
$ node games/boardgame/azul-premium/test.js ; echo $?
RESULT: 262 passed, 0 failed
0

$ node games/boardgame/azul-premium/test-online.js ; echo $?
ONLINE_E2E_JSON: {"game":"azul","clients":2,"sameGame":true,"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"runAll":true,"result":"73 passed, 0 failed","exitCode":0}
RESULT: 73 passed, 0 failed
0

$ node games/boardgame/azul-premium/e2e.mjs ; echo $?
RESULT: 166 passed, 0 failed
0

$ node games/tests/run-all.js ; echo $?
游戏测试: 415 个 · 断言: 26272 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 516 个测试文件 · 断言: 87014 passed · 失败文件: 0
0
```

故意失败对照：

```text
$ node games/boardgame/azul-premium/e2e.mjs --control ; echo $?
FAIL intentional failure control (expected)
RESULT: 0 passed, 1 failed
1

$ node games/boardgame/azul-premium/test-online.js --control ; echo $?
FAIL intentional online failure control (expected)
RESULT: 0 passed, 1 failed
1
```

## 美术与本地资源

- 单物件 img-gen 素材：5 色釉面砖、木质圆盘、绒布、木纹；纯白底、左上主光、无文字。
- 完整局面由 `art-render.html` 代码合成，`render-art.mjs` 无头渲染；只校验尺寸/大小，不做截图内容识别。
- 页面引用本地 WebP：`../../assets/art/premium/azul/*.webp`；封面/OG/详情在 `assets/`。
- 零外链、零 CDN、零外链字体、零追踪；`sw.js` v3 预缓存页面 shell、8 张材质、`shared/shuffle.js`、`shared/sfx.js`、`online.html`、封面/OG/详情。
- 中文衬线标题 `Songti SC Bold(700)`；无 900 字重。

## 真实性（realism.json）

1. count：100 枚 / 5 色 / 每色 20 / 每盘 4。
2. dimension：砖约 22×22×6 mm；玩家板约 241×241 mm；盒 260×260×70 mm。
3. proportion：2/3/4 人 5/7/9 圆盘；模式线 1–5；墙 5×5；地板 7 格。
4. color：5 色 hex 与引擎一致。
5. material：官方树脂砖/纸板圆盘/木计分标记；premium 视觉为釉面砖、木盘、绒布，规则不变。
6. rule：行 +2 / 列 +7 / 色 +10；地板最低 0；平局比完整横排后共享；未完成模式线保留。

## 手机

- 390×844、320×568、844×390、568×320 四档 CDP 视口实测。
- 所有可见文字 ≥12px（E2E 扫描 TextNode）；触控 ≥44×44；无横向滚动。
- `100dvh`；safe-area top 44/bottom 34 实测；触控设备关闭 `backdrop-filter`。
- 首次 pointerdown/touchend/click/keydown 解锁 WebAudio（shared `Sfx`）。
- 断网：SW v3 缓存 8 材质 + shared + shell；离线重载 5 圆盘/20 砖通过。

## 联机

- 复用 `../app/rooms.js`：创建、邀请 token、密码、TTL、加入/离开/开始/关闭。
- 客户端 `online.html`：创建/加入/重连/邀请刷新/座位/开始/结果榜；开始后跳转 `index.html?online=...&session=...&player=...`。
- `index.html` 联机模式：轮询房间、复用同一块玩家板/圆盘/墙面 UI；`canMove` 由服务器给出；动作走 `POST /api/rooms/:id/actions`。
- 空位 AI 补足；超时未操作由 AI 托管，GET/动作/reconnect 清除托管。
- 结果入内存榜单 `GET /api/leaderboard`；房主可 `restart` 重赛。
- 双客户端证据：`test-online.js`（两个独立 HTTP 客户端同房对局）+ `e2e.mjs` online section（浏览器客户端 + 两个 HTTP 客户端同房同步）。
- 固定 2–4 座位；服务器为本地内存实现，重启清空房间与榜单。

## 共享模块

- `games/shared/shuffle.js`：引擎 Node require + 页面 script；删除自写 mulberry32。
- `games/shared/sfx.js`：页面 script；删除自建 AudioContext，映射 click/move/notify/deal/error/win/lose。
- `games/shared/rules.js`：N/A（只含五子棋/四子棋）。
- `games/shared/physics.js`：N/A（Azul 无物理）。
- rewards/leaderboard：`games/shared` 下不存在；未复制 `app/rewards.js` / `app/leaderboard.js`。联机结果榜在 `online-server.mjs` 内实现。

## 官方门禁

```text
game-smoke 390×844: PASS · 19 checks · external 0 · console 0 · exceptions 0
game-smoke 320×568: PASS · 19 checks · external 0 · console 0 · exceptions 0
verify-shipped: azul-premium status=shipped; process=true art=true realism=true mobile=true mode=true; reasons=[]
```

## 浏览器规则

GUI Chrome 的「允许 Apple 事件中的 JavaScript」关闭，`urlrun tab js` 返回功能已关闭；本分支验证复用常驻审计 Chrome 的 CDP 9222，只创建/关闭自己的标签页，不新建临时 Chrome/profile、不 kill Chrome。`e2e.mjs` 先执行 `chrome-ensure`。

## 已知限制

- 联机服务器为单进程内存实现；重启清空房间、会话和榜单。
- 未做真实 iOS Safari 设备测试；仅断言 `100dvh`、safe-area、WebKit AudioContext 手势解锁、触控下关闭 backdrop-filter。
- 联机固定 2–4 座位，未做 5+ 人自由分队。
- 视觉未做截图/OCR 内容识别；只验证 DOM、尺寸、件数、资源加载与断言。

## HANDOFF 三行

1. 现状：Azul 五项门禁 + 联机双客户端 E2E 已绿，`meta.json` 标 shipped 候选。
2. 入口：`node games/boardgame/azul-premium/online-server.mjs --port 8787`，打开 `/online.html`；单机直接开 `index.html`。
3. 下一步：等待批量放量决定；如需持久化房间/榜单，再接入真实后端，不改当前规则引擎。
