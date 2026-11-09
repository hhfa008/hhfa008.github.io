# Fixtures

这个目录是**离线可重放**的数据来源。构建、测试与默认导入都只读这里，不访问网络。

## 文件

| 文件 | 说明 |
|---|---|
| `games-snapshot.json` | 40 条桌游记录，`fetch-games.js` 的默认离线输入，也是 `data/games.json` 的唯一来源 |
| `gstone-attempt.json` | 2026-11-10 对 GStone 集石的公开访问记录与停止抓取的原因 |

## 来源与日期

- 快照日期：**2026-11-10**
- 内容：公开桌游常识（名称、原名、人数、时长、年份、设计师、出版社）与约值评分/重度。
- 评分与重度不是实时数据，会随 BGG 等公开评价样本变化；README 中已标注为约值。
- 狼人杀、骨牌属于传统/公有领域游戏，设计师与出版社不确定，按约定留空数组，年份留 `null`，不猜测。

## GStone 采集尝试（真实结果）

见 `gstone-attempt.json`。摘要：

1. `https://gstonegames.com/`：TLS 握手失败（curl 35，HTTP 000）。
2. `https://www.gstonegames.com/`：HTTP 200，`text/html`，114694 字节。
3. `https://www.gstonegames.com/robots.txt`：`User-agent:*` / `Disallow:/`。

robots.txt 禁止所有爬取，因此没有请求列表页或详情页，也没有尝试登录、验证码或反爬绕过。在线模式（`--online`）会在读取 robots.txt 后直接拒绝继续，并保持 `data/games.json` 不变。

## 重放

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/fa/games
node games/boardgames/scripts/fetch-games.js          # 离线，从本目录导入
node games/boardgames/scripts/fetch-games.js --online # 检查 robots 后停止（当前预期行为）
```
