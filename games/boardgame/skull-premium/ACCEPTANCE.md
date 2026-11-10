# 骷髅牌 SKULL · PREMIUM — 验收

> 生成时间：2026-11-10 · 分支 `boardgame/d686a4ca-b2-g3`

## 0. 结论

| 门禁 | 结果 | 证据 |
|---|---|---|
| process | PASS | DESIGN + 209 单测 + perf.json + E2E + 本文件 |
| art | PASS | cover / og / detail-1 / detail-2 本地 WebP + 3 个单物件材质 |
| realism | PASS | `realism.json` 6 项检查全部 ok，覆盖 count / dimension / proportion / color / material / rule |
| mobile | PASS | 390×844、320×568 真浏览器：无横向滚动、触控 ≥44px、字号 ≥12px |
| mode | PASS | 联机双客户端 E2E：同房同局、结算一致、重连、超时托管、榜单 |

## 1. run-all

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/tests/run-all.js
```

- `skull-premium/test.js`：209 passed, 0 failed
- `skull-premium/test-online.js`：52 passed, 0 failed
- 全仓结果见 `games/tests/report.json`。

## 2. 单测

覆盖：组件与人数（3–6，7 拒绝）、每人 3 玫瑰 + 1 骷髅、起始玩家空桌不可停手、每次一枚、全员停手进入叫价、叫价递增与上限、停叫、最高叫价者翻牌、只能翻别人最上面一张、自己的牌堆可向下翻、骷髅失败、成功得 1 分、失去随机牌、0 牌出局、2 分结束、隐藏手牌/牌堆、同 seed 同失去牌、不可变性、200+ 步 AI 模拟 <500ms、3–6 人各 14 局 AI 自对弈。

## 3. 浏览器 E2E

真实常驻 Chrome CDP 9222：

- 初始 4 人桌、每人手牌 3 玫瑰 + 1 骷髅、放置阶段。
- 真实点击杯垫两次完成放置；叫价阶段点数字 + 确认；翻牌阶段点高亮牌堆。
- AI 自动行动；轮次推进；日志可读。
- 同 seed 复现初始手牌；5 人桌 5 个玩家盒；对手手牌在视图中为 null。
- SW 注册与 `skull-premium-v1` 预缓存。
- 规则页 FAQPage JSON-LD、回游戏 CTA、玫瑰/骷髅覆盖。
- 390×844 / 320×568：无横向滚动、主控件 ≥44px、可见文字 ≥12px。
- 零外部请求、零 console error、零未捕获异常。
- 性能：FCP 88ms、DCL 30ms、load 33ms、DOM 194、材质 397KB。
- `--control` → exit 1。

## 4. 联机 E2E

- 密码房：错密码 `E_PASSWORD`、对密码成功。
- 创建 4 人房（2 真人 + 2 AI）、邀请码加入、房主开始。
- 双客户端各自隐藏对手手牌与牌堆；整局到 2 分结算。
- 两端 winner / scores 一致；榜单记录一致。
- 重连返回同房；闲置 >400ms 触发托管；重连清除。
- 重赛清零分数与牌堆；离开座位转 AI；关闭房间后 404。
- `--control` → exit 1。

## 5. 视觉与真实

- 一套 4 枚（3 玫瑰 + 1 骷髅）、3–6 人、先到 2 分，全部按官方。
- 杯垫 Ø95mm、木桌、橡胶吧台垫来自 img-gen；玫瑰/骷髅与牌堆由代码 SVG/CSS 合成。
- 封面 4 枚一套；详情 1 展示每人 4 枚构成；详情 2 展示 6 个真实牌堆（各 ≤4 枚）。

## 6. 手机

| 视口 | 横向滚动 | 最小触控 | 最小字号 |
|---|---|---|---|
| 390×844 | 390/390 | 44×44 | 12px |
| 320×568 | 320/320 | 44×44 | 12px |

## 7. 已知边界

- 叫价高于可达牌数时，翻开所有可达牌后判失败，避免无合法动作的死局。
- AI 只用公开信息估算，不读取对手暗牌。
- 回合自动进入下一轮，UI 用结算弹窗展示上一轮。
