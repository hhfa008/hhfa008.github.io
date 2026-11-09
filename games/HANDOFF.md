# 游戏项目交接（给 mac2）

生成时间：2026-11-09
仓库：`git@github.com:hhfa008/hhfa008.github.io.git`（分支 `master`）
线上：
- GitHub Pages：https://hhfa008.github.io/games/
- Cloudflare Pages：https://hhfa008-pages.pages.dev/games/

## 现状

- **20 款纯静态游戏**，全部免费、免登录、单文件、无外部依赖、无追踪
- 分类：棋类 10（象棋、国际象棋、五子棋、黑白棋、国际跳棋、中国跳棋、围棋 9 路、四子棋、西洋双陆棋、暗棋）、卡牌 4（接龙、空当接龙、蜘蛛纸牌、斗地主）、聚会 2（谁是卧底、飞行棋）、经营 1（拓荒者九岛）、数字 1（24 点）、小游戏 1（Tap Match）、在线联机 1（语音房，可选密码，支持井字棋/五子棋/四子棋）
- 三语入口：`/games/`（中）、`/games/en/`、`/games/id/`
- 每个游戏都有 `rules.html`（中文）与部分 `rules-en.html`（英文）
- **803 条断言**，一条命令跑全部

## 目录约定

```
games/
  <game>/index.html        单文件游戏（内联 CSS/JS）
  <game>/rules.html        中文规则页
  <game>/rules-en.html     英文规则页（部分有）
  shared/share.js          分享按钮（全站共用）
  shared/rules.js          五子棋/四子棋规则（单机与 Worker 共用，改动需同步）
  tests/run-all.js         测试总入口
  tests/HEALTH.md          覆盖率与缺失项
  sw.js / manifest.webmanifest / offline.html   离线 PWA
  voice-room/worker/       Cloudflare Worker + Durable Object（信令 + 服务端判定 + 密码房）
```

## 本地校验（**需要 node**）

```bash
git clone git@github.com:hhfa008/hhfa008.github.io.git
cd hhfa008.github.io
node games/tests/run-all.js      # 期望：19 文件 / 803 断言 / 0 失败
```

目前这台机器 **没有 node、没有 brew**，跑不了测试。二选一：
1. 装 node（pkg 安装包或官方二进制）
2. 在主力机（192.168.103.55）上跑测试，mac2 只做编辑

## 改一个游戏的标准流程

1. 改 `<game>/index.html`
2. 若动了规则逻辑，同步改 `<game>/test.js`（或 `games/shared/rules.js`）
3. `node games/tests/run-all.js` 必须全绿
4. 三语大厅（`games/index.html`、`en/`、`id/`）的卡片与 `ItemList` 计数同步
5. `sitemap-pages.xml` 若新增页面则追加
6. 提交推送 master
7. Cloudflare 部署（**干净快照，禁止 `deploy .`**）：

```bash
git archive HEAD | tar -x -C /tmp/cf-deploy
wrangler pages deploy /tmp/cf-deploy --project-name hhfa008-pages --branch main
```

## 硬规则（踩过坑）

- **不要用 `wrangler pages deploy .`**：会把 `.git`、`.env` 一起传上去
- **验证页面是否真的在线，不能只看状态码**：Cloudflare 无 404.html 时会把不存在路径返回 200 首页（已修，但对照项必须保留：`/this-path-should-not-exist-xyz/` 必须 404）
- **两站一致性判据是 md5**，不是「看起来都能打开」
- **Cloudflare 会去掉 `.html`**（308 跳转），GitHub Pages 不会——跨站比对 URL 时注意
- 服务端权威：语音房的落子判定必须在 Worker/DO 侧，不能放客户端

## 待办（按优先级）

1. 给还没有英文规则页的游戏补 `rules-en.html`（当前覆盖 8/20）
2. voice-room 没有自动化测试（实时 DO），需要一套 E2E 脚本
3. 剩余 4 处可访问性未达标（chess 41px、reversi 37.8px、freecell 36.3px、doudizhu 38px），都是 390px 下棋盘几何约束
4. 更多游戏：麻将、德州扑克（注意合规，不做真钱）
5. 搜索收录：站点尚未被 Google/Bing 收录（IndexNow 已提交），需要在 Search Console / Bing Webmaster 里验证站点

## 凭证与部署权限

- Cloudflare：项目 `hhfa008-pages`，Account ID `7f60cd77c5d0383f937b2053a1b0bca1`
- Pages 部署用本机 wrangler OAuth（`~/.config/pa/env` 里的 `CLOUDFLARE_API_TOKEN` 对 Pages 不可用）
- Worker（语音房）同样用 wrangler OAuth 部署
