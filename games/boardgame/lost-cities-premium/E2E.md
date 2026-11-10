# Lost Cities Premium — 浏览器 E2E 记录

## 运行

```
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
node games/boardgame/lost-cities-premium/e2e.mjs
node games/boardgame/lost-cities-premium/e2e.mjs --control
```

环境：常驻审计 Chrome CDP `127.0.0.1:9222`（`chrome-ensure` 复用；不新开 profile、不 kill Chrome）。E2E 自己启动一个仅本机使用的静态服务器，打开一个 tab，结束时只关闭该 tab。

真实结果：

```
RESULT: 200 passed, 0 failed
```

对照：`--control` 输出 `RESULT: 0 passed, 1 failed`，exit 1。

## 覆盖范围

### 初始渲染与性能

- 标题、meta description、viewport；
- 10 条探险列（双方各 5）、5 个共享弃牌堆、8 张手牌、44 张牌堆；
- 桌面无横向滚动；FCP/DCL/load 预算；DOM 节点 253；
- 7 个材质 WebP 全部加载，材质字节 1,059,838；
- FPS 62；新局渲染 0.5ms；纯引擎单步 5.6ms；
- reduced-motion CSS、100dvh、safe-area 声明。

### 真实点击

- 选中合法手牌，dock 文案与高亮列更新；
- 点击同色探险列完成出牌，进入抽牌阶段；
- 点击牌堆完成抽牌；
- 等待 AI 完成一整个回合（打出 + 抽牌），手牌回到 8；
- 牌张守恒 60；
- 点击合成“最后一张牌”局面，真实点击抽牌，进入第 2 局，出现第 1 局结算 toast 与上局比分；
- `autoPlayToEnd` 走完三局，结果弹窗、2 行比分、点击“再来一局”重置 round/累计分/手牌；
- WebAudio 通过点击解锁；Escape 清空选择；主控件均为原生 button/a，无 hover 依赖。

### 移动端矩阵

| 视口 | 横向滚动 | 触控 | 字号 | 列/手牌 | 100dvh | backdrop-filter |
|---|---|---|---|---|---|---|
| 390×844 | 无 | ≥44 | ≥12 | 10 / 8 | 生效 | none |
| 320×568 | 无 | ≥44 | ≥12 | 10 / 8 | 生效 | none |
| 844×390 | 无 | ≥44 | ≥12 | 10 / 8 | 生效 | none |
| 568×320 | 无 | ≥44 | ≥12 | 10 / 8 | 生效 | none |

额外检查 card / expedition / discard / deck / hand 可滚动到达。

### Reduced motion

`prefers-reduced-motion: reduce` 下 `__lostcities.reducedMotion()` 为 true；新局与出牌成功，但 `animationCounts` 不变（不播放 take/draw/score 动画）。

### Service Worker / 离线

- 注册 ready，cache `lost-cities-premium-v1`；
- 7 个材质、cover/OG/detail 四张、shared shuffle/sfx、index shell 全部 cached；
- CDP 切 offline 后重新导航，游戏仍渲染 8 张手牌与 10 条探险列；
- 恢复在线，重新加载正常。

### 联机浏览器客户端

- 启动真实 `online-server.mjs` 临时端口；
- 1 名玩家开局，服务端 AI 补位；
- `online.html?room=&session=&player=` 恢复房间；
- 渲染 2 人、双方 5 条列、8 张手牌；
- 真实点击手牌 → 探险列 → 抽牌 → AI 回合；
- HTTP 另一视角读取 turn/phase，与浏览器状态一致；
- reconnect API 成功，页面重连按钮无 console error。

### 规则页

- 标题、2097 个中文字符；
- Article + FAQPage JSON-LD 可解析；FAQ ≥8；
- 文本包含 `BV1bt411K79U`、`BV197411N7nn`、UltraBoardGames；
- 60 张、8 张 +20、赌注 -20、三局、最后一张结束、不能抽刚弃的牌、单人 / 联机；
- OG `assets/og.webp`；3 张真实图 naturalWidth/Height >0；
- 320px 无横向溢出；导航链接高度 ≥44。

### Art composition

四个 shot 逐一验证：stage 尺寸、10 条探险列、5 个共享弃牌堆、8 张手牌、1 个牌堆、罗盘、赌注封蜡、7 材质加载、标题文本。另从 Node 校验 PNG 尺寸与字节下限。

### 零外链 / 控制台

- 外部资源条目 0；
- 外部网络请求 0；
- console error 0；
- page exception 0。

## 缺口

- headless Chrome 偶发不上报 FCP/loadEventEnd 为 0；脚本已用 DCL 作为预算回退，性能文件记录一次有效 FCP 44ms。
- 没有真实手机浏览器或 Safari 结果；移动端结论来自 Chrome 设备模拟 + DOM 尺寸/触控/滚动断言。
- 未做截屏视觉回归或 OCR；真实件数通过 DOM 计数与真实点击验证。
