# 桌游板块部署结论（唯一来源）

> 截至 2026-11，按 Cloudflare / GitHub 官方公开免费额度理解；价格与配额会调整，部署前以官方定价页复核，本文不作为合同。

## 结论先行

**静态页继续留在 GitHub Pages（零成本、现状不动）；联机 HTTP API / 房间 / WebSocket 用 Cloudflare Workers + Durable Objects，等真正上线联机再启用。** 统一迁到 Cloudflare Pages 是可选项，不是联机能力的解法。

## GitHub Pages（现状）

- 纯静态托管：1 个列表页 + 43 个详情页，内联 CSS/JS，零外部请求。
- 免费；支持自定义域名 / CNAME 与 HTTPS；可用 GitHub Actions 做 CI。
- **不能**承载 HTTP/JSON API、房间/会话等常驻状态、WebSocket。
- `app/server.mjs` 是 loopback 内存服务，只能本地 / 内网自用，无法直接部署到任何静态托管。

## Cloudflare Pages

- 静态托管：免费额度（静态请求/带宽通常不限，构建次数按月有限）、Git 集成、预览部署、自定义域名 / SSL。
- 本质仍是静态 CDN；要跑 API 必须接 Pages Functions（底层就是 Workers），**本身不能持有常驻房间状态**。
- 适合统一静态托管、预览与响应头；不解决房间/WebSocket。

## Cloudflare Workers（+ Durable Objects）

- HTTP API：Workers 免费额度按请求数 / CPU 时间计（有每日上限），超出转付费；冷启动通常毫秒级，运行时无状态。
- 持久房间：需要 Durable Objects（每房间一个 DO，串行处理动作并持久化）；KV / D1 适合配置、排行榜等。
- WebSocket：客户端连 DO，由 DO 转发房间事件；Hibernation 可降低空闲房间的计费时长。
- 成本：API 在 Workers 免费额度内可先跑；**Durable Objects 需要 Workers Paid（约 $5/月）**，另加超出免费额度的用量。
- 锁定风险：DO 编程模型、迁移与运行时 API 有迁移成本；游戏规则本身是纯函数，可整体迁走。

## 结论表

| 维度 | GitHub Pages（现状） | Cloudflare Pages | Workers + Durable Objects |
|---|---|---|---|
| 部署成本 | 免费 | 静态免费（构建有限额） | API 免费额度可用；DO 需 Paid 约 $5/月 + 用量 |
| 自定义域名 / SSL | 支持（CNAME） | 支持 | 支持 |
| 无服务器 HTTP API | 不可行 | 仅 Pages Functions（= Workers） | 原生可行 |
| 房间状态 / WebSocket | 不可行 | 不可行 | DO 串行状态 + WebSocket |
| 运维复杂度 | 几乎为零 | 低 | 中：路由、密钥、DO 迁移、限流、观测、TURN |
| 锁定风险 | 低 | 低 | 中：DO 编程模型 |

## 明确推荐

1. **保留 GitHub Pages 静态页**：零成本、现状不动、canonical 不改。
2. **API / 房间用 Workers + Durable Objects**，联机功能上线时再启用；AI 评估是普通 HTTP，放 Worker 即可，不需要 DO。
3. 想统一域名 / 预览 / 响应头时再考虑整体迁 Pages，**不是必需**，也不会因此获得联机能力。
4. 只做单机 / 热座玩法时不要上线 Worker，继续把 `app/server.mjs` 当本地 AI / 测试接口。

## 迁移步骤与风险

1. **冻结基线**：`node games/boardgame/tests/run-all.mjs` 0 失败；记录 SKIP 清单。
2. **新建 Worker**：`wrangler.toml` 声明 Worker 与 `ROOM` Durable Object 绑定；路由复用 `app/server.mjs` 的 JSON 契约。
3. **状态迁移**：`app/rooms.js` 的内存 Map → DO storage（房间、密码摘要、session、动作序号），每房间串行处理，天然避免并发抢回合。
4. **密钥**：`wrangler secret put BOARDGAME_API_TOKEN`，不写仓库；同时加 IP / 房间维度限流与 64 KiB 请求体上限。
5. **DNS / CORS**：静态页与 API 分域或用主域 `/api` 反代；只允许站点源，预检与凭据策略先联调，保留 30 天回滚窗口。
6. **数据持久化**：DO SQLite / D1 只做向后兼容字段追加，不做破坏性 migration；排行榜等以服务端判定为权威。
7. **验收**：密码错 403、非成员 403、非法动作 4xx、断线重连 token、语音仅成员、`ai-eval` 正常终局；Worker 侧 `wrangler rollback` 可回退。

## 相关

- 接口与错误码：`server/README.md`
- 测试入口：`node games/boardgame/tests/run-all.mjs`
- `tests/DEPLOYMENT.md` 仅保留指向本文的指针。
