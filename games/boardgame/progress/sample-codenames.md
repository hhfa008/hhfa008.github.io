# sample-codenames — 唯一样本进度

> 状态：**shipped（五项全过，双浏览器 context E2E + FLUX realism 阻断已重验）**
> 分支：`feature/codenames-ship`（基于 `boardgame/d686a4ca-codenames-premium`，已合并 origin/main）
> 更新时间：2026-11-10

## 当前步骤

1. B 站教程检索与规则摘要：完成。
2. 引擎 / 275 词库 / 单人豪华 UI：完成。
3. ART-GUIDE 视觉复核 + 本地 FLUX 材质（卡纸/卡背/绒布）+ 1200×630 封面/OG + 1200×800 详情 + realism 阻断：完成。
4. 手机适配（390×844、320×568、横屏、平板；44px、safe-area、100dvh、iOS 音频解锁）：完成。
5. 联机（房间/邀请/密码/AI 补位/重连/超时托管/结果榜/双浏览器 context E2E）：完成。
6. 最终验证（test.js 356/0 + test-online.js 89/0 + e2e.mjs 87/0 + online-e2e.mjs 45/0 + 两套 run-all）：完成。

## 阻塞 / 限制

- **Chrome Apple Events JavaScript 关闭**：`urlrun tab js` 不可用。`e2e.mjs` 先 `chrome-ensure`，默认复用常驻 Chrome 的 CDP 实例（默认 9222），只创建/关闭自己的 target；没有新开 Chrome/profile，也没有 kill Chrome。主链路是 Node/shell；设置 `USE_URLRUN=1` 才可选探测 `urlrun tab`。
- 联机服务器为本地内存实现；重启会清空房间与结果榜。
- 固定 4 座位；2–8 人自由分队/多队员尚未实现。
- AI 线索偏主题化、强度中等。
- `games/shared/rules.js` 只含 gomoku/connect4；Codenames 规则唯一实现在 `engine.js`，没有复制。`physics` 不适用；`rewards/leaderboard` 在 shared 中不存在。

## 可续跑命令

```
cd ~/games-worktrees/codenames
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/codenames-premium/test.js
node games/boardgame/codenames-premium/test.js --control
node games/boardgame/codenames-premium/test-online.js
node games/boardgame/codenames-premium/e2e.mjs
node games/boardgame/codenames-premium/online-e2e.mjs
node games/boardgame/codenames-premium/render-art.mjs
node games/boardgame/codenames-premium/render-art.mjs --control
node games/boardgame/tests/run-all.mjs
node games/tests/run-all.js
node games/boardgame/codenames-premium/online-server.mjs --port 8787
# 打开 http://127.0.0.1:8787/online.html
```

## 验收清单（五项硬性要求 + 新增验收）

- [x] 流程：设计 → 实现 → 单测 → 性能断言 → 美术 → E2E → 验收材料
- [x] 精美：按 ART-GUIDE；封面/OG/详情配图；本地材质；无占位/emoji
- [x] 真实：25/9/8/7/1、线索 N+1、刺客、字体、材质、光照
- [x] 手机：390×844 + 320×568 冒烟；横屏/平板不崩；44px；safe-area；100dvh；iOS 音频
- [x] 联机：房间/邀请/状态同步/AI 补位/重连/托管/入榜/双客户端 E2E 入 run-all
- [x] 单人/多人标注：index/detail/online/rules 明确「单人」与「联机」
- [x] 共享模块：shuffle/sfx 复用；rules/physics/rewards/leaderboard 已说明 N/A 或唯一实现
- [x] SW 预缓存：v10 已含 codenames 入口、engine/words/meta、7 个 WebP
- [x] 对照：`test.js --control` → RESULT 350 passed, 1 failed，退出码 1
- [x] 最终 `run-all`：517 files / 87249 passed / 0 failed，退出码 0
- [x] `meta.json` status = shipped（候选）

## main c5c583b 合并后复跑

- merge `origin/main`（c5c583b1）clean。
- art / realism / mobile / online：codenames-premium.ok=true；art/online control ok。
- mobile：390/320 官方 smoke 各 PASS 19 checks / 0 failures。
- process：test.js 350/0；--control 350/1（exit 1）；run-all 517 files / 87249 passed / 0 failed。
- catalog-status：codenames-premium.status=shipped，五 gates 全 true。
- build 44 pages / 43 games；check-registry --boardgame-only exit 0。
- main push：等待用户逐次明确授权（全局禁止自动合入）。

## 验证结果

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `test.js` | 350 passed, 0 failed | 0 |
| `test.js --control` | 350 passed, 1 failed | 1 |
| `test-online.js` | 89 passed, 0 failed | 0 |
| `e2e.mjs` | 80 passed, 0 failed（persistent-cdp-node，7.94s） | 0 |
| `run-all.js` | 517 files, 87249 passed, 0 failed（37.41s） | 0 |

## 资源观测

验证批次：`test.js` → `test-online.js` → `e2e.mjs`。

| 时点 | Chrome 进程数 | Chrome RSS | Chrome CPU% | Node 进程数 | Node RSS |
|---|---:|---:|---:|---:|---:|
| 批量前 | 42 | 5739.8 MB | 116.7% | 10 | 870.0 MB |
| 批量后 | 49 | 5626.4 MB | 121.5% | 8 | 561.7 MB |

单次耗时：`test.js` 0.06s；`test-online.js` 0.87s；`e2e.mjs` 脚本内 7.94s / 进程 wall 7.96s；`run-all.js` 37.41s。

## 下一步

1. 等待批量放量决定；不要并行铺其他游戏。
2. 如需走 `urlrun tab`，先开启 Chrome Apple Events JavaScript，再 `USE_URLRUN=1 node e2e.mjs`。
3. 若要求 2–8 人自由分队，需扩展联机座位模型（当前固定 4 座位 + AI 补位）。
