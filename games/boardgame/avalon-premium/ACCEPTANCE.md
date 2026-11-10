# Avalon 阿瓦隆 · 验收记录

## 五项门禁

| # | 项目 | 证据 | 结果 |
|---|---|---|---|
| 1 | 流程测试 | `engine.js` + `test.js`（官方 5 人角色/任务表/投票/任务/暗杀/隐藏信息/AI 自对弈/页面静态检查/交付产物）；`DESIGN.md`；`perf.json`；`e2e.mjs --control` exit 1；本文件 | PASS |
| 2 | 美术 | `assets/cover.webp` 1200×1200、`assets/og.webp` 1200×630、`assets/detail-1/2.webp` 1200×800；6 个本地 img-gen 单物件材质（圆桌毛毡、羊皮纸、任务石板、剑、盾、王冠）+ 代码合成 | PASS |
| 3 | 真实 | `realism.json` 六类检查（count/rule/dimension/proportion/material/color）全部 ok；规则页 Article + FAQPage + 3848 汉字 + 3 条 B 站来源 | PASS |
| 4 | 手机 | 设计并冒烟目标 390×844、320×568、844×390、568×320：无横向滚动、交互目标 ≥44px、可见字号 ≥12px、五个座位与五个任务卡槽可见 | PASS |
| 5 | 多人 | 双客户端同房同局（62/0）；房间/邀请/密码/隐藏身份/状态同步/AI 补齐到 5 人/重连/超时托管/排行榜/重赛/关闭；`test-online.js --control` exit 1；`e2e.mjs` 浏览器联机段 | PASS |

## 关键命令

```bash
export PATH=$HOME/.local/node/bin:$PATH

# 单元测试（含页面静态检查与交付产物）
node games/boardgame/avalon-premium/test.js

# 双客户端联机 E2E（run-all 自动发现）
node games/boardgame/avalon-premium/test-online.js
node games/boardgame/avalon-premium/test-online.js --control   # 期望 exit 1

# 真浏览器 E2E
node games/boardgame/avalon-premium/e2e.mjs
node games/boardgame/avalon-premium/e2e.mjs --control           # 期望 exit 1

# 美术合成
node games/boardgame/avalon-premium/render-art.mjs

# 两档手机冒烟
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /tmp/avalon-slugs.txt --width 390 --height 844 \
  --json games/boardgame/audit/smoke-390.json
```

## 实测数字

- 单测：`RESULT: 232 passed, 0 failed`。
- 联机：`RESULT: 62 passed, 0 failed`；控制组 `RESULT: 0 passed, 1 failed`（exit 1）。
- 浏览器 E2E：`RESULT: 115 passed, 0 failed`；控制组 exit 1。`perf.json` 由 e2e 写回实测 FCP 0ms / loadEventEnd 8ms / DOM 节点 143 / FPS 61 / 新局渲染 0.5ms；零外部请求、零 console error。
- 规则页：3848 个汉字，Article + FAQPage，2 张详情图，3 条 B 站来源。
- 美术：封面 1200×1200、OG 1200×630、详情 1200×800；全部本地素材，无远程请求。
- 素材：6 个 img-gen 单物件（1254²、1536×1024、1983×793 等原始尺寸）转 WebP，合计约 1.5MB。

## 规则校对

- 5 人基础局固定角色：梅林 1、派西维尔 1、忠臣 1、莫甘娜 1、刺客 1；3 好 2 坏。
- 五个任务人数 `[2,3,2,3,3]`；5 人局每个任务只需 **1 张失败卡**。
- 任务 4 需 **两张失败** 的规则只用于 **7 人以上** 游戏，本实现不使用。
- 正义方三胜后进入暗杀；刺客命中梅林则邪恶翻盘，否则正义获胜。
- 连续五次组队被否决邪恶获胜；队伍通过后计数清零。
- 投票严格多数（5 人局 3 票），平票视为否决。

## 已知边界

- 官方基础版固定 5 人；单人模式为 1 名真人 + 4 名 AI；联机为 2 名真人 + 3 名 AI 或 1 名真人 + 4 名 AI。
- 未实现湖中仙女、兰斯洛特、莫德雷德、奥伯伦等扩展角色。
- 联机默认局域网内 HTTP，不包含公网穿透、账号体系或持久化数据库。
- 排行榜为服务端内存榜，进程重启即清空；playerId 只保存 sha256 前缀。
