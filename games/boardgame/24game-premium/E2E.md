# 24 点 · 24 Game Premium — E2E 记录

## 运行命令

```bash
export PATH=$HOME/.local/node/bin:$PATH

# 单元测试
node games/boardgame/24game-premium/test.js

# 真实浏览器 E2E（常驻 Chrome / CDP 9222）
node games/boardgame/24game-premium/e2e.mjs

# 必然失败的对照
node games/boardgame/24game-premium/e2e.mjs --control

# 手机两档冒烟
printf '24game-premium\n' >/tmp/24game-games.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/24game-games.txt --width 390 --height 844 --json /tmp/24game-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/24game-games.txt --width 320 --height 568 --json /tmp/24game-320.json
```

## 实际结果

| 检查 | 实际输出 |
| --- | --- |
| 单元测试 | 375 passed, 0 failed |
| E2E | 149 passed, 0 failed（退出码 0） |
| E2E --control | 0 passed, 1 failed（退出码 1，故意失败对照） |
| game-smoke 390×844 | pass 1 / fail 0，19 checks，0 external / 0 console / 0 exception |
| game-smoke 320×568 | pass 1 / fail 0，19 checks，0 external / 0 console / 0 exception |
| cover.webp | 1200×1200，58,486 B |
| og.webp | 1200×630，47,464 B |
| detail-1.webp | 1536×1024，76,650 B |
| card.webp | 480×320，13,496 B |

## E2E 设计

- 常驻 Chrome 通过 `~/.local/bin/chrome-ensure` 复用；默认 CDP 端口 `process.env.AUDIT_CDP_PORT || 9222`。
- 本地 Node HTTP 服务托管仓库；恰好打开一个标签页，结束时只关闭该标签，不 kill Chrome。
- 采集 Runtime.consoleAPICalled / exceptionThrown / Log.entryAdded / Network.requestWillBeSent / responseReceived。
- 覆盖：初始 4 张题面与 40 张守恒、共享模块、材质、键盘/撤销/清空、提示、错误答案、Enter 获胜、Store 持久化、下一题、看答案、N/U/H、确定性 API、非法动作、不可变、移动两档、规则页 JSON-LD 与 B 站来源、美术页真实题面与四档 shot、WebP 尺寸、性能预算、零外部请求、零 console error。
- `perf.json` 由 E2E 按本次实测数据覆盖写入，不手填。
