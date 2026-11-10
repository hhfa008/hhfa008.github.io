# 房地产拍卖 FOR SALE · PREMIUM — 验收

> 生成时间：2026-11-10 · 分支 `boardgame/d686a4ca-b2-g3`

## 0. 结论

| 门禁 | 结果 | 证据 |
|---|---|---|
| process | PASS | DESIGN + 127 单测 + perf.json + E2E + 本文件 |
| art | PASS | cover / og / detail-1 / detail-2 本地 WebP + 5 个单物件材质 |
| realism | PASS | `realism.json` 6 项检查全部 ok，覆盖 count / dimension / proportion / color / material / rule |
| mobile | PASS | 390×844、320×568 真浏览器：无横向滚动、触控 ≥44px、字号 ≥12px |
| mode | PASS | 联机双客户端 E2E：同房同局、结算一致、重连、超时托管、榜单 |

## 1. run-all

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/tests/run-all.js
```

- `for-sale-premium/test.js`：127 passed, 0 failed
- `for-sale-premium/test-online.js`：54 passed, 0 failed
- 全仓结果见 `games/tests/report.json`。

## 2. 单测

覆盖：30 张房产 1–30、30 张支票（0,0,2..15 twice，无 1）、18 金币、3–6 人；开叫必须出价、0 元合法、最低加价、现金上限、放弃、最后一人付款拿牌并成为下一场起拍者；30 场拍卖；出售阶段支票数、按房产价值分配、同价值按座次、支票/房产隐藏、终局现金与并列；AI 3–6 人自对弈；seed 复现；不可变性与性能；静态资产。

## 3. 浏览器 E2E

真实常驻 Chrome CDP 9222：

- 初始 4 人桌、18 金币、拍卖阶段、首张拍品与出价按钮。
- 真实点击出价按钮；AI 自动加价/放弃；进入出售阶段后点选房产并确认；出售结算弹窗「继续」。
- 至少一次出价与一次出售；日志可读；游戏推进。
- 同 seed 复现两副牌；5 人桌 5 个玩家盒；金币公开、其他玩家支票隐藏。
- SW 注册与 `for-sale-premium-v1` 预缓存。
- 规则页 FAQPage JSON-LD、回游戏 CTA、拍卖/支票覆盖。
- 390×844 / 320×568：无横向滚动、主控件 ≥44px、可见文字 ≥12px。
- 零外部请求、零 console error、零未捕获异常。
- 性能：FCP 72ms、DCL 29ms、load 31ms、DOM 184、材质 711KB。
- `--control` → exit 1。

## 4. 联机 E2E

- 密码房：错密码 `E_PASSWORD`、对密码成功。
- 创建 4 人房（2 真人 + 2 AI）、邀请码加入、房主开始。
- 双客户端各自隐藏对手支票；整局跑完拍卖 + 出售。
- 两端 winner / totals 一致；榜单记录一致。
- 重连返回同房；闲置 >400ms 触发托管；重连清除。
- 重赛重置金币 18、阶段回到拍卖；离开座位转 AI；关闭房间后 404。
- `--control` → exit 1。

## 5. 视觉与真实

- 30 张房产、30 张支票、18 金币、两阶段流程，全部按官方结构。
- 房产/支票卡面使用 img-gen 空白卡材质，数值与房屋图形由代码绘制。
- 封面 3 张房产 + 2 张支票 + 金币 + 房屋模型；详情 1 展示 7 张房产与 5 张支票；详情 2 展示两阶段桌面。

## 6. 手机

| 视口 | 横向滚动 | 最小触控 | 最小字号 |
|---|---|---|---|
| 390×844 | 390/390 | 44×44 | 12px |
| 320×568 | 320/320 | 44×44 | 12px |

## 7. 已知边界

- AI 拍卖预算按剩余房产数分摊，仍可能出现房产集中；这是零和拍卖的自然结果。
- 金币公开、支票对他人隐藏；终局公开。
- 出售阶段按座次收集选择，全部选完前不公开。
