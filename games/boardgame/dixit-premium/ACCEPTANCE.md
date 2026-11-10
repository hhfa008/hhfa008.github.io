# 妙语说书人 DIXIT · PREMIUM — 验收

> 生成时间：2026-11-10 · 分支 `boardgame/d686a4ca-b2-g3`

## 0. 结论

| 门禁 | 结果 | 证据 |
|---|---|---|
| process | PASS | DESIGN + 129 单测 + perf.json + E2E + 本文件 |
| art | PASS | cover / og / detail-1 / detail-2 本地 WebP + 4 个单物件材质 |
| realism | PASS | `realism.json` 6 项检查全部 ok，覆盖 count / dimension / proportion / color / material / rule |
| mobile | PASS | 390×844、320×568 真浏览器：无横向滚动、触控 ≥44px、字号 ≥12px |
| mode | PASS | 联机双客户端 E2E：同房同局、结算一致、重连、超时托管、榜单 |

## 1. run-all

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/tests/run-all.js
```

- `dixit-premium/test.js`：129 passed, 0 failed
- `dixit-premium/test-online.js`：53 passed, 0 failed
- 全仓结果见 `games/tests/report.json`。

## 2. 单测

覆盖：84 张原创卡唯一 ID、6 张手牌、3–6 人发牌与守恒、线索空/超长/换行拒绝、说书人出牌、其他玩家提交、投票顺序与「不能投自己」、三种计分（全中/全不中/部分）、票分归属、隐藏手牌/说书人牌/投票明细、30 分结束、牌堆耗尽结束、seed 复现、不可变性、AI 3–6 人自对弈、84 张 SVG 均无文字、静态资产。

## 3. 浏览器 E2E

真实常驻 Chrome CDP 9222：

- 初始 4 人桌、6 张手牌、说书人阶段、线索表单可见。
- 真实交互：说书人选牌 + 输入线索 → 提交；非说书人出牌；投票；结算弹窗「继续」；至少 3 个 UI 行动。
- AI 自动提交与投票；回合推进；分数变化。
- 同 seed 复现发牌；5 人桌 6 张手牌；对手手牌在视图中隐藏；说书人的牌在出线索前为 null。
- SW 注册与 `dixit-premium-v1` 预缓存。
- 规则页 FAQPage JSON-LD、回游戏 CTA、线索/投票覆盖。
- 390×844 / 320×568：无横向滚动、主控件 ≥44px、可见文字 ≥12px。
- 零外部请求、零 console error、零未捕获异常。
- 性能：FCP 68ms、DCL 12ms、load 32ms、DOM 692、材质 439KB。
- `--control` → exit 1。

## 4. 联机 E2E

- 密码房：错密码 `E_PASSWORD`、对密码成功。
- 创建 4 人房（2 真人 + 2 AI）、邀请码加入、房主开始。
- 双客户端各自隐藏对手手牌；整局到 30 分/牌堆结束。
- 两端 winner / scores 一致；榜单记录一致。
- 重连返回同房；闲置 >400ms 触发托管；重连清除。
- 重赛清零分数；离开座位转 AI；关闭房间后 404。
- `--control` → exit 1。

## 5. 视觉与真实

- 84 张 = 12 配色 × 7 变体 × 12 母题，全部代码生成；卡面无文字。
- 封面 5 张真实卡 + 6 枚黄铜标记；详情 1 展示 12 张真实卡；详情 2 展示一轮的手牌与线索。
- 不使用、不复制任何 Dixit 官方插画。

## 6. 手机

| 视口 | 横向滚动 | 最小触控 | 最小字号 |
|---|---|---|---|
| 390×844 | 390/390 | 44×44 | 12px |
| 320×568 | 320/320 | 44×44 | 12px |

## 7. 已知边界

- 原创抽象卡与官方卡组的视觉语义不同，但回合结构、计分与结束条件按官方。
- 线索只做长度/换行校验，不做语义审查。
- 回合自动进入下一轮，UI 用结算弹窗展示上一轮。
