# 香料之路 · Century: Spice Road — E2E 记录

## 1. 单机浏览器冒烟

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games <(printf 'century-spice-road-premium\n') --width 390 --height 844 --json /private/tmp/century-spice-road-premium-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games <(printf 'century-spice-road-premium\n') --width 320 --height 568 --json /private/tmp/century-spice-road-premium-320.json
```

检查：页面加载、标题/描述、viewport、两档无横向滚动、主触控 ≥44px、字号 ≥12px、输入框 ≥16px、零外部请求、无 console error/异常、点击「换一局」不跳转。

## 2. 引擎与 AI

`node games/boardgame/century-spice-road-premium/test.js`：数据守恒、动作合法性、非法动作抛错、计分、终局、30 局 AI 自对弈、页面离线/可访问性/性能契约。

## 3. 联机双客户端

`node games/boardgame/century-spice-road-premium/test-online.js` 启动真实 HTTP 房间服务器（临时端口），两个独立客户端完成：

1. 创建房间 / 邀请加入 / 一次性邀请 / 密码房 / PII 拒绝 / 人数夹紧。
2. 房主开始；空位 AI 补位；越权开始与越权行动被拒。
3. 当前玩家提交合法动作；双方看到同一 `roomId`、同一 seed、同一 current seat。
4. 断线重连成功；坏 token 被拒；超时托管标记与重连清除。
5. 强制 AI 推进至终局；两个客户端的 result/scores 完全一致。
6. 结果榜包含该局；房主重赛；关闭房间后 404。
7. `ONLINE_E2E_JSON` 输出 clients=2 / sameGame / settlementConsistent / reconnect / timeoutTakeover / leaderboard / runAll 全 true。

## 4. 对照

`node games/boardgame/century-spice-road-premium/test-online.js --control` → exit 1，证明测试会失败而不是恒真。

## 5. 联机页面手机冒烟

`online.html` 同样在 390×844 与 320×568 两档真实浏览器加载：无横向滚动、可读字号 ≥12px、触控目标 ≥44px、输入框 ≥16px、零外部请求、无 console error/异常（`.tmp/online-smoke-390.json` / `-320.json`，PASS）。

## 6. 复现

所有随机性来自种子；页面「种子」输入、`createGame(seed)` 与联机服务端的 seed 均可复现同一局。
