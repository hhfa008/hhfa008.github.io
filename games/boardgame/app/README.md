# app/ · 留存与奖励

`retention.mjs` 是桌游板块的留存/奖励最小实现，被 `play/rewards.html` 直接以
ES module 引入。零依赖、零外网、无第三方 SDK；所有状态都是可 JSON 序列化的
普通对象，可在浏览器、Node 测试和未来 Worker 中复用。

## 文件

| 文件 | 作用 |
|---|---|
| `retention.mjs` | 配置、每日登录/连胜、积分/等级/奖杯、每日任务、损失厌恶提示、分享载荷、排行榜、防作弊、匿名设备 id、本地持久化 |
| `rewards.mjs` | 独立的积分/等级/奖杯状态机 `createRewards`；单次加分上限、拒绝非正分、奖杯幂等（字符串 id） |
| `leaderboard.mjs` | 独立的权威榜单 `createLeaderboard`；设备 hash、nonce 防重放、分数/时长标记、频率限制、只持久化 hash |
| `README.md` | 本文：数据模型与扩展点 |

页面在 `../play/`：`rewards.html` + `rewards.js`。三个模块可以单独使用，也可以像
页面这样用 `retention.mjs` 的聚合接口一次取全量快照。

## 数据模型（state）

```js
{
  version: 1,
  points: 0,                 // 只增不减；负分会被夹到 0
  level: 1,                  // 由 points 派生，可重新计算
  streak: 0,                 // 连续登录天数，断签回到 1，上限 streak.maxDays
  trophies: [{ id, title, awardedAt }],   // 幂等，重复 award 不重复入列
  lastLoginAt: null,         // 毫秒时间戳
  lastLoginDay: null,        // UTC 日序号（floor(ms / 86400000)）
  lastPlayedAt: null,
  dailyLog: [{ day, at, points, streak }],
  missions: { day, progress: { [id]: n }, claimed: [id] },  // 按 UTC 日重置
  lossAversion: { day, count },          // near-miss 补偿每日上限
  comeback: { lastPromptDay, lastClaimDay },
  games, wins, losses,
  scores: [{ playerId, score, at }],     // 本地提交记录
  entries: [{ playerId, label, score, at, rank }], // 本地榜单镜像
  submissions: [{ playerId, score, at }],// 频率限制依据
  createdAt, updatedAt,
  lastMatch: { matchId, result, score, rank, at } // 页面用于分享
}
```

隐私边界：唯一的标识是 `boardgame.deviceId` 中的随机 UUID（`crypto.randomUUID()`
或等价随机源），不拼设备指纹、不读 IMEI/MAC/广告 id、不采集邮箱/电话/姓名/IP。
分享载荷只含对局 id、结果、分数、名次、标题/文案、站点链接。

## 配置

```js
createRetentionConfig({
  daily:   { enabled: true, points: 20, cooldownHours: 24 },
  streak:  { enabled: true, bonusPerDay: 5, maxDays: 7 },
  lossAversion: { enabled: true, nearMissBonus: 10, comebackBonus: 20,
                  maxPerDay: 1, inactiveDays: 3 },
  play:    { enabled: true, winPoints: 20, drawPoints: 10, lossPoints: 5,
             nearMissPoints: 5, rewardCapPerDay: 120 },
  antiCheat: { maxScore: 100000, minIntervalMs: 1000, serverAuthoritative: true },
  share:   { urlTemplate: 'https://hhfa008.github.io/games/boardgame/?match={matchId}' }
})
```

顶层字段与 `hooks.*` 互为别名；`antiCheat.serverAuthoritative` 始终强制为 `true`。
默认配置是 `DEFAULT_RETENTION`，`getRetentionConfig()` 返回新副本。

## 主要导出

- 每日/连胜：`recordDailyLogin(state, now?)`、`updateStreak(target, now?)`、
  `getStreak(state)`。同一 UTC 日只发一次；连续第二天 +1；断签重置为 1。
- 任务：`getDailyMissions(state, now?)`、`recordMissionProgress(state, id, n, now?)`、
  `claimDailyMission(state, id, now?)`（完成才可领，重复领取被拒）。
- 积分/等级/奖杯：`addPoints(state, n, meta?)`、`levelForPoints(points)`、
  `levelDetails(points)`、`awardTrophy(state, id, meta?)`。
- 损失厌恶：`getReturnPrompt(state, now?)`（只提示，不扣分）、
  `recordGameResult(state, { result, score, cardsPlayed, nearMiss }, now?)`、
  `claimComebackBonus(state, now?)`。失败不扣分，补偿每日一次。
- 分享：`buildSharePayload({ matchId, result, score, rank, title })`、
  `shareTextFor(payload)`。
- 排行榜/防作弊：`getLeaderboard(state, submission?, { limit, config })`（无
  submission 时返回降序数组，有则提交）、`validateScore(claim, config?)`、
  `checkRateLimit(state, playerId, at, config?)`、`sanitizeScore`。
- 设备/持久化：`getDeviceId(storage?)`、`loadProgress`、`saveProgress`、
  `serializeProgress`、`deserializeProgress`、`createProgressStore`。
- 独立状态机：`rewards.mjs` 的 `createRewards({ storage, now })`
  （`award/getState/grantTrophy/reset`）、`leaderboard.mjs` 的
  `createLeaderboard({ storage, now, maxScore, maxPerMinute })`
  （`submit/top/reset`）与 `getOrCreateDeviceId(storage)`。

所有 storage 读写都在 `try/catch` 内；隐私模式/清缓存后返回新 id 而不是崩溃。

## 排行榜扩展点

`getLeaderboard` 默认只操作本地 state。需要远端权威服务时：

1. 在宿主侧实现 `{ submitScore(entry), getLeaderboard({ playerId }) }`；
2. 用 `createLeaderboardClient({ remote })` 或直接 `syncLeaderboard(state, remote)`；
3. 远端返回的条目会经 `mergeRemoteLeaderboard` 再过一遍 `maxScore` 校验，
   客户端分数永远不作为权威来源；
4. 页面本身保持离线：`play/rewards.js` 故意注入 `remote: null`，不发起请求。

需要“服务端判定”语义时用 `createLeaderboard({ now, storage, maxScore, maxPerMinute })`：
`submit({deviceId, gameId, nonce, score, durationMs})` 返回
`ok/flagged/code`；只有未标记的条目进榜，榜单条目只含 `deviceHash`，原始
deviceId 既不落盘也不返回。`nonce` 重复返回 `E_REPLAY`，超频返回 `E_RATE`，
超上限/异常时长/客户端权威标记为 `flagged: true` 且不入榜。

## 扩展建议

- 新增奖杯：在业务动作后调用 `awardTrophy(state, 'badge-id', { title })`。
- 新增任务：覆盖 `missions.items`（`{ id, title, target, points }`），进度用
  `recordMissionProgress` 上报，领取复用 `claimDailyMission`。
- 新增等级：只改 `LEVELS` 表；`levelForPoints` 保证单调不降。
- 远端对局校验：服务端在接收分数前调用同样的 `validateScore` 语义（上限、
  非负、非客户端权威），并保留 `minIntervalMs` 频率窗口。
- 埋点：只记聚合计数（DAU/D1/分享率），不要写入个人信息；默认不开启任何
  外部上报。
