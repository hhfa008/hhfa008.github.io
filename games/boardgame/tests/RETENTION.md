# 留存机制清单（可验收）

本文只列**可实现、可观测、可测试**的留存机制，不写游戏业务实现，也不做暗黑模式。
每条机制都给出：验收信号 → 对应测试文件/分组/断言名。测试名以实际 `node --test` 风格输出为准；
当前 `retention-rewards.test.mjs` 在 `app/retention.mjs` 落地前整体 SKIP，落地后按这里的名字逐条变绿。

## 1. 机制与验收

| # | 机制 | 玩家可感知的信号 | 验收信号（工程侧） | 对应测试 |
|---|---|---|---|---|
| 1 | 每日登录 | 每天首次进入领积分，卡片提示“今日已领取” | 同一 UTC 日只发一次；跨日再发；冷却 24h | `retention-rewards.test.mjs` · `config · 日常奖励冷却 24h`、`daily login and streak · 同一天重复登录不重复发分` |
| 2 | 连胜 | 连续登录/连续对局显示天数与加成 | 连续第二天 +1；断签重置为 1；加成有上限 | `daily login and streak · 连续第二天登录连胜 +1`、`断签后连胜重置为 1` |
| 3 | 损失厌恶 | 差一点获胜/连胜将断时给一次“再来一局”补偿 | 配置存在 `lossAversion.enabled` 与 comeback/near-miss 奖励；奖励只发一次 | `config · 配置含损失厌恶钩子`、`配置含 comeback 补偿` |
| 4 | 结果页分享 | 对局结束生成可分享成绩卡 | 分享数据含对局 id、标题/文案、链接；不含邮箱/电话/姓名/IP；长度 <2000 | `share payload · 分享数据包含对局 id`、`分享数据不含个人信息` |
| 5 | 排行榜 | 分数进榜、显示名次 | 服务端权威；超上限拒绝；同玩家极短间隔拒绝；降序 | `leaderboard and anti-cheat · 正常分数可提交`、`超过分数上限被拒绝`、`同一玩家极短间隔重复提交被拒绝` |
| 6 | 积分 / 等级 | 积分累积、等级/段位提升 | 加分单调；负分不产生负分；等级随分数不下降 | `points, level, trophies · 加 40 分`、`负分不会把总分降成负数`、`高分等级不降低` |
| 7 | 奖杯 / 成就 | 首次胜利、连胜等徽章 | 同一奖杯幂等，不重复发放 | `points, level, trophies · 奖杯不重复发放` |
| 8 | 匿名设备 id | 换设备/清缓存前无需登录也能保留进度 | 稳定、匿名、无个人信息；同一 storage 返回同一 id | `anonymous device id · 同一 storage 返回稳定 id`、`设备 id 不包含 @/电话/姓名等个人信息` |
| 9 | 基础防作弊 | 异常高分不生效，正常玩家不受影响 | 客户端分数不权威；上限、频率、服务端判定 | `config · 反作弊服务端权威`、`leaderboard and anti-cheat · 校验接口拒绝超上限/客户端权威分数` |
| 10 | 每日任务（可选） | 3 个小任务（完成一局、打出 X 张牌、分享一次） | 任务进度按日重置；完成才发奖；重复领取拒绝 | 待实现后新增分组 `daily missions`（当前未实现，不虚构） |
| 11 | 回流召回（可选） | 3 天未登录收到一次提醒/回归奖励 | 只发一次；可关闭；不包含个人信息 | 待实现后新增分组 `comeback`（当前未实现，不虚构） |

## 2. 数据与隐私边界

- 设备 id 只用于本地进度与服务端去重；由 `crypto.randomUUID()` 或等价随机源生成，**不拼设备指纹、不读 IMEI/MAC/广告 id**。
- 分享载荷只包含对局公开信息（对局 id、结果、分数、名次、站点链接），不包含昵称/头像 URL/地理位置。
- 排行榜展示名默认“匿名玩家”；改名是可选功能，不强制收集个人信息。
- 留存埋点必须 opt-in 或至少可关闭；事件只记聚合计数（DAU、D1/D7、分享率），不落原始个人信息。
- 所有本地持久化读写必须 `try/catch`，隐私模式/清缓存后要能重新生成 id 而不是崩溃。

## 3. 配置契约（实现时照此落地）

```js
retentionConfig = {
  daily:   { enabled: true, points: 20, cooldownHours: 24 },
  streak:  { enabled: true, bonusPerDay: 5, maxDays: 7 },
  lossAversion: { enabled: true, nearMissBonus: 10, comebackBonus: 20, maxPerDay: 1 },
  antiCheat: { maxScore: 100000, minIntervalMs: 1000, serverAuthoritative: true },
  share:   { urlTemplate: 'https://hhfa008.github.io/games/boardgame/?match={matchId}' }
}
```

## 4. 评测口径

- **北极星**：完成至少一局且次日回访的匿名设备数（D1 留存）。
- **过程指标**：开局率、完局率、结果页分享率、排行榜参与率、连胜 ≥3 天占比。
- **护栏**：退款/卸载率不升、异常分数拒绝率可解释、无个人信息落盘。
- **验收节奏**：每个机制上线前，对应测试必须从 SKIP 变为 PASS；`run-all.mjs --strict` 作为合并门禁。
