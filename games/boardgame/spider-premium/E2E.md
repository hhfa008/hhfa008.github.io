# E2E 记录 · 蜘蛛纸牌 Premium

## 命令

```
# 单元测试
node games/boardgame/spider-premium/test.js

# 真实浏览器 E2E（常驻 Chrome CDP 9222）
node games/boardgame/spider-premium/e2e.mjs

# 故意失败对照（必须 exit 1）
node games/boardgame/spider-premium/e2e.mjs --control

# 手机两档冒烟
printf 'spider-premium\n' >/tmp/spider-games.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/spider-games.txt --width 390 --height 844 --json /tmp/spider-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/spider-games.txt --width 320 --height 568 --json /tmp/spider-320.json
```

## 实际结果

- 单元测试：`RESULT: 227 passed, 0 failed`。
- 浏览器 E2E：`RESULT: 142 passed, 0 failed`。
- `--control`：`RESULT: 0 passed, 1 failed`，退出码 1。
- 手机冒烟：390×844 与 320×568 均为 `pass: 1 / fail: 0`、19 checks、0 console error、0 exception、0 external request（`/tmp/spider-390.json`、`/tmp/spider-320.json`）。

## 环境

- 浏览器：常驻 audit Chrome，CDP `127.0.0.1:9222`（可用 `AUDIT_CDP_PORT` 覆盖）。
- 脚本先执行 `~/.local/bin/chrome-ensure` 复用现有实例；只 `PUT /json/new` 打开一个标签，结束时 `GET /json/close/<id>` 关闭该标签，不杀 Chrome。
- 页面由本地 Node HTTP 服务器提供，服务根为 `games/`；所有资源同源。
- 每次运行前清空该 origin 的 service worker 与 cache storage，避免旧缓存影响。

## 覆盖的流程

1. 初始发牌与 104 张守恒、6/6/6/6/5/5/5/5/5/5、50 张牌堆、500 分。
2. 真实 UI 点击：选段 → 落列；分数/步数变化与选中高亮。
3. 撤销（按钮 + 键盘 U）恢复完整状态；提示（按钮 + 键盘 H）；键盘 N 新局。
4. 发牌：每列一张、牌堆 −10、次数 +1、计分正确。
5. 空列禁发：无 deal 动作、按钮禁用、调用不改变状态。
6. 构造 7 组完成 + 最后一击：自动收第 8 组、胜利、799 分、结算面板。
7. 再来一局与难度 4 → 2 → 1 切换。
8. 移动端 390×844 与 320×568：无横向滚动、控件 ≥44×44、字号 ≥12px、10 列完整、牌格为 DIV 且无 `role=button`。
9. 规则页 JSON-LD/单人徽章/配图/来源；美术页 104 张牌、材质与点阵牌面。
10. 性能预算、零外部请求、零 console/page error。

## 产物

E2E 结束时写入 `perf.json`，包含预算、实测值（FCP、DCL、loadEventEnd、DOM 节点、FPS、新局渲染、材质字节、外部请求）与两档移动端的滚动宽度、控件数量、最小字号、列宽。
