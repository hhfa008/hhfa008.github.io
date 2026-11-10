# 斗地主 · 精品版 — 设计说明

## 一句话

一副 54 张牌、三人叫分抢地主；从单张到飞机带对的 14 种牌型全部由本地引擎判定，单机打两档以上 AI，联机三座、空位 AI 补位、服务端权威。

## 牌与真实规则

| 项 | 值 |
|---|---|
| 牌数 | 54（13 点 × 4 花色 + 小王 + 大王） |
| 点数 | 3 4 5 6 7 8 9 10 J Q K A 2 小王 大王 |
| 发牌 | 17 / 17 / 17 + 3 张底牌 |
| 叫分 | 不叫 / 1 / 2 / 3；只能加价，3 分立即结束 |
| 地主 | 最高叫分者，拿走底牌，20 张先出 |
| 牌型 | 单、对、三、三带一、三带二、顺子、连对、飞机、飞机带单、飞机带对、四带二单、四带两对、炸弹、王炸 |
| 压牌 | 同牌型同张数比主牌；炸弹压普通牌；炸弹之间比点数；王炸最大 |
| 重置 | 两家连续不要后，最后出牌者自由出牌 |
| 结算 | 底分 × 叫分 × 2^(炸弹+王炸)；地主 2 倍，农民各 1 倍 |

规则判定全部在 `engine.js`：`detect` 归类牌型，`canBeat` 判压牌，`applyAction` 校验出牌权、手牌归属、自由出牌不能不要。叫分和对局共用一个状态机，`phase = bid | play | over`。

## 状态与安全边界

- 服务端持有 `hands`、`bottom` 与种子；`publicView(state, viewerSeat)` 只返回观众自己的手牌。
- 其他座位只下发 `handCount`，底牌在结束前只下发 `{count: 3, revealed: false, cards: null}`。
- 联机 adapters 只实现 `createMatch / view / legalActions / applyAction / aiAction / result / restart`，房间、邀请、密码、TTL、重连、托管、排行榜全部复用 `games/shared/online-room-server.mjs`。
- 幂等键由客户端生成，服务端在回合校验前缓存响应；重放返回同一个 `stateVersion`。

## AI 三档

1. **入门**：在 `legalActions` 里随机取一个合法动作；不做拆牌评估。
2. **标准**：启发式拆牌。优先走完整手牌、避免拆炸弹、队友出牌时让牌、对手只剩一两张时用炸弹收口。
3. **高手**：在标准之上加“未见牌推断”。`unseenCounts` 从整副牌扣除自己的手牌与公开出牌记录，估计对手可能的炸弹与王炸；对手临近出完时改用最长牌型或炸弹抢先。AI 只读取自己的手牌、其他座位的**张数**和公开历史，不读取对手牌面。

## 前端

- 竖屏优先，390 / 320 两档；手牌是绝对定位的扇形，JS 按容器宽度和手牌数计算牌宽与重叠步长，选中牌上浮 16px。
- 牌面完全由代码绘制：点数角标、标准 SVG 花色、2–10 的点阵、A 的大花色、J/Q/K 的宫廷框、大小王竖排中文。中文与牌面字符用 `Songti SC Bold(700)`。
- 触控：手牌用 `div[tabindex="0"]`，不用 `button` / `role="button"`，避免密集牌面被 44px 门禁误判；主要操作按钮最小 48px，难度分段按钮 44px。
- 音效用 `games/shared/sfx.js`，洗牌用 `games/shared/shuffle.js`，难度/音效偏好用 `games/shared/store.js`。无外部请求。

## 美术

- `img-gen --model gpt-image-2 --size 1024x1024` 只生成四个单物件材质：空白扑克纸、深红金纹牌背、墨绿羊毛台呢、39mm 筹码。
- 四角洪水填充 + 1px 腐蚀抠图，保留 PNG 母版与 WebP 派生；不使用 colorkey。
- `art-render.html` + `render-art.mjs` 用代码合成 54 张真实发牌：封面 1200×1200、OG 1200×630、详情 1200×800 两张（完整发牌校验 / 14 种牌型与材质）。
- `render-art.mjs` 在截图前用同一 seed 重新发牌并校验 54 张唯一、17/17/17+3、14 种牌型示例全部成立；不成立直接退出 3、零文件。

## 数据来源

`data.js` 的 `SOURCES.bilibili` 记录 3 个 B 站教程 BV（只读取搜索 API 的文字标题，不截图、不做 OCR）：

- BV1o8wYeEE8E — 2026年了还不会玩斗地主？9分钟学会斗地主基础规则
- BV1ka411t7Yh — 斗地主扑克游戏规则讲解，斗地主怎么玩，斗地主规则新手入门知识
- BV1MBTV6gE5T — 斗地主规则讲解

## 文件

`engine.js`（规则/状态/AI/视图）· `data.js`（静态资料与来源）· `index.html`（单机）· `online.html` + `online-server.mjs`（联机）· `test.js` / `test-online.js`（门禁）· `art-render.html` + `render-art.mjs`（美术合成）· `meta.json` / `realism.json` / `perf.json` / `rules.html` / `DESIGN.md` / `ACCEPTANCE.md` / `E2E.md`。
