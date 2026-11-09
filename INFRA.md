# 基建说明（Infra）

这份文档说明这台机器（mac2）与主力机之间**共享的基建**：代码、测试、部署、以及哪些东西**不能共享**。

## 代码仓库

| 位置 | 作用 | 说明 |
|---|---|---|
| 主力机 `~/.local/share/pa/workspace/hhfa008.github.io` | **权威源**（含站点全部内容） | 分支 `master`，推 GitHub |
| mac2 `~/games` | 工作副本（只含 `games/` 与 `tools/`） | 从 `~/games.git` 克隆 |
| mac2 `~/games.git` | 裸库，mac2 的提交落点 | 主力机 `git push mac2 main` 推入 |

**同步方向**
- 主力机 → mac2：`git push mac2 main`（主力机已配好 `mac2` 远端）
- mac2 → 主力机：mac2 在 `~/games` 提交后 `git push origin main`，主力机执行
  `git pull ssh://fa@192.168.18.127/Users/fa/games.git main --allow-unrelated-histories`

**为什么不能反向直连**：主力机未开启「远程登录」（无 sshd），mac2 无法推回。这是刻意的最小权限。

## 运行环境

- mac2 的 node 在 `~/.local/node/bin`（**不在默认 PATH**），每次先 `export PATH=$HOME/.local/node/bin:$PATH`
- 版本 v24.12.0（universal 二进制，从主力机 scp 过去）
- 无 brew、无 npm 全局包；需要新工具时优先用单文件二进制

## 测试

```bash
cd ~/games
export PATH=$HOME/.local/node/bin:$PATH
node games/tests/run-all.js
```

基线：**19 个测试文件 / 803 条断言 / 0 失败**（voice-room 无自动化，见 HEALTH.md）。
**任何改动后必须复跑，失败不得交付。**

## 部署（只在主力机执行）

mac2 **不持有** Cloudflare 凭证，也不做部署。原因：部署会写生产环境，凭证只应存在于一台机器上。

主力机的部署流程（供理解，不要在 mac2 上执行）：

```bash
cd ~/.local/share/pa/workspace/hhfa008.github.io
git archive HEAD | tar -x -C /tmp/cf-deploy     # 只用干净快照
wrangler pages deploy /tmp/cf-deploy --project-name hhfa008-pages --branch main
```

- Cloudflare 项目 `hhfa008-pages`，生产分支 `main`
- 访问 pages.dev 必须走代理 `7899`（`7897` 不通）
- **禁止 `wrangler pages deploy .`**：会把 `.git`、`.env` 一起上传
- pages.dev 会 308 去掉 `.html`，GitHub Pages 不会——跨站比对时注意

## 不共享的东西（硬边界）

- Cloudflare API Token / wrangler OAuth 登录态
- 飞书、邮箱、GitHub 的凭据
- `~/.config/pa/` 下的任何内容
- 个人站的其他目录（`personal/`、`ios/`、`writing/`、`store/`）

mac2 只拥有：`games/` 与 `tools/` 的源码与测试能力。

## 验证约定（比工具更重要）

1. **不许编造验证结果**：跑不了就说跑不了
2. **状态码不等于页面存在**：Cloudflare 上不存在的路径可能返回 200 首页，必须看内容特征串
3. **两站一致性用 md5**，不用「看起来一样」
4. **对照项必须有**：每次验证都要带一个「必然失败」的对照（如不存在的路径必须 404），否则检查本身不可信
