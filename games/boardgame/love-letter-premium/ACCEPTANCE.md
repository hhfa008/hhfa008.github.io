# 情书 LOVE LETTER · PREMIUM — 验收

> 生成时间：2026-11-10 · 分支 `boardgame/d686a4ca-b2-g3`
> 五项硬性要求逐条留证；命令均可复跑。

## 0. 结论

| 门禁 | 结果 | 证据 |
|---|---|---|
| process | PASS | DESIGN + 143 单测 + perf.json + E2E + 本文件 |
| art | PASS | cover / og / detail-1 / detail-2 本地 WebP + 5 个单物件材质 |
| realism | PASS | `realism.json` 6 项检查全部 ok，覆盖 count / dimension / proportion / color / material / rule |
| mobile | PASS | 390×844、320×568 真浏览器：无横向滚动、触控 ≥44px、字号 ≥12px |
| mode | PASS | 联机双客户端 E2E：同房同局、结算一致、重连、超时托管、榜单 |

## 1. run-all

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/tests/run-all.js
```

- `love-letter-premium/test.js`：143 passed, 0 failed
- `love-letter-premium/test-online.js`：51 passed, 0 failed
- 全仓结果见 `games/tests/report.json`；本次执行失败文件 0。

## 2. 单测（`node games/boardgame/love-letter-premium/test.js`）

覆盖：

- 16 张牌构成、8 位角色、2/3/4 人目标标记与暗置张数。
- 隐藏信息：对手手牌隐藏、神父知识只在获得者视角可见、结束后公开。
- 女伯爵强制规则；卫兵 2–8 猜测与保护取消；神父信息；男爵高/低/平；侍女保护到时；王子对敌/对己/公主；国王交换；公主自爆。
- 牌堆耗尽比手牌、平手比弃牌和、并列双标记；比赛达标结束。
- 2/3/4 人各 18 局 AI 自对弈：动作全合法、全部结束、步数有界、标记有界。
- 同 seed 同发牌；`applyMove` 不修改入参；200 步 AI 模拟 <500ms。
- 页面静态约束与 5 个材质、4 张本地图存在。

## 3. 浏览器 E2E（`node games/boardgame/love-letter-premium/e2e.mjs`）

真实常驻 Chrome CDP 9222，新开一个标签并在结束时关闭：

- 真实点击手牌 → 选目标/猜点数 → 按「打出」；断言回合推进、AI 随后行动、日志可读。
- 同 seed 复现发牌；3 人桌两张对手座位。
- SW 注册、`love-letter-premium-v1` 缓存存在且包含 index。
- 规则页 FAQPage JSON-LD、回游戏 CTA、角色覆盖。
- 390×844 / 320×568：无横向滚动、主控件 ≥44px、可见文字 ≥12px。
- 零外部请求、零 console error、零未捕获异常。
- 性能：FCP 76ms、DCL 10ms、load 32ms、DOM 204、材质 623KB。
- 故意失败对照：`node e2e.mjs --control` → exit 1。

## 4. 联机 E2E（`node games/boardgame/love-letter-premium/test-online.js`）

真实 HTTP 房间服务器 + 两个独立 fetch 客户端：

- 创建房间、一次性邀请码、密码房（错密码 `E_PASSWORD`，对密码成功）。
- 房主开始，空位转 AI，3 人桌目标 5 枚。
- 双客户端各自只看到自己的手牌；整局打到结算。
- 两端 winner 与标记总数一致；榜单记录一致。
- `reconnect` 返回同房；闲置 >400ms 触发托管，重连清除托管。
- 房主重赛：tokens 清零、3 座保留。
- 离开座位转 AI；关闭房间后 GET 404。
- 输出 `ONLINE_E2E_JSON` 与 `ONLINE_E2E_OK`；`--control` → exit 1。

## 5. 视觉与真实

- 牌库张数与角色点数严格按官方；2/3/4 人暗置张数与目标标记按官方。
- 单物件材质来自 img-gen（牌背、火漆、玻璃标记、丝绒、信封），字符与完整局面由 HTML/CSS/SVG 代码合成。
- 封面/OG/详情由 `art-render.html` 代码合成；详情 1 展示 8 位角色与真实张数合计 16。
- 标题字体 Songti SC 700，不用 900。

## 6. 手机

| 视口 | 横向滚动 | 最小触控 | 最小字号 |
|---|---|---|---|
| 390×844 | 390/390 | 44×44 | 12px |
| 320×568 | 320/320 | 44×44 | 12px |

## 7. 已知边界

- 回合结束自动发下一轮，UI 用结算弹窗展示上一轮；这是为联机轮询做的节奏近似。
- 神父信息在目标抽牌后保留「其中一张已知」，打出后失效。
- 单人默认 2 人桌；新对局弹窗可选 3/4 人。
