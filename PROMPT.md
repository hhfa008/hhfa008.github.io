# 给 mac2 的工作提示词（PROMPT）

你在这台机器上负责**网页游戏的生产与维护**。仓库只包含 `games/` 目录，站点其他部分在另一台机器上维护。

## 每次开工前

```bash
cd ~/games            # 克隆位置
git pull              # 先拉最新
export PATH=~/.local/node/bin:$PATH   # node 不在 PATH，必须显式加
node --version        # 应为 v24.x
```

## 你的职责边界

**你负责**：`games/` 下的游戏实现、规则页、测试、素材、离线 PWA、语音房 Worker 的前端部分。

**你不负责**（不要改）：站点首页、`tools/`、`personal/`、`ios/`、`writing/`、任何根目录 HTML。

## 硬规则（都是踩过的坑）

1. **每个改动必须过测试**：`node games/tests/run-all.js`，必须 0 失败。当前基线：19 个文件、803 条断言。
2. **不许编造验证结果**。跑不了就如实说「跑不了，原因是 X」。
3. **页面「在线」不能只看状态码**：Cloudflare 上不存在的路径可能返回 200 首页。验证必须看内容特征串。
4. **两站一致性用 md5 判断**，不是「都能打开」。
5. **Cloudflare 会去掉 `.html`** 并 308 跳转，GitHub Pages 不会。
6. **部署只能用干净快照**，禁止 `wrangler pages deploy .`。
7. **服务端权威**：语音房的对局判定在 Worker/Durable Object 侧，不许放客户端。
8. **不引入外部依赖**：单文件、内联 CSS/JS、无 CDN、无追踪脚本、无第三方 SDK。
9. **不碰隐私**：不做图像识别，不采集用户数据。

## 加一个新游戏的标准流程

1. 建 `games/<slug>/index.html`（单文件，≤70KB）
2. 建 `games/<slug>/rules.html`（中文规则，1200–2000 字，含 `Article` + `FAQPage` JSON-LD）
3. 建 `games/<slug>/test.js`（≥10 条断言，覆盖核心规则；测试要从页面里抽取引擎，不要复制一份规则）
4. `node games/tests/run-all.js` 全绿
5. 三语大厅同步卡片：`games/index.html`、`games/en/index.html`、`games/id/index.html`，并把各自的 `ItemList` 计数 +1
6. `sitemap-pages.xml` 追加新 URL
7. 提交推送；由主力机负责部署到 Cloudflare

## 质量标准（自检清单）

- [ ] 规则实现与规则页描述一致
- [ ] AI 三档难度**真的有差别**（用对局胜率证，不是只看参数）
- [ ] 触控目标 ≥44×44，390px 无横向溢出
- [ ] 三语切换后文案与 `lang` 属性都正确
- [ ] 键盘可达、`aria-label` 齐全
- [ ] 无外部请求（页面加载时 `performance.getEntriesByType('resource')` 只应有本域资源）

## 交付与汇报

每次交付必须写清四件事：
1. **做了什么**（改了哪些文件）
2. **怎么验的**（命令 + 输出摘要，不许只说「已验证」）
3. **基线有没有退化**（803 断言、三语卡片数、404 对照）
4. **还剩什么问题**（没做的、做不了的、需要人决定的）

## 当前待办

1. 补英文规则页：现覆盖 8/20，剩余 12 款
2. voice-room 的 E2E 测试（实时 Durable Object，目前无自动化）
3. 4 处可访问性未达标（chess 41px、reversi 37.8px、freecell 36.3px、doudizhu 38px）
4. 新增品类：麻将、德州扑克（**注意合规，不做真钱**）
5. 20 款游戏的移动端真机抽测（iOS Safari / Android Chrome）
