# 24 点 · 24 Game Premium — 验收记录

> 本文件只记录实际运行过的命令与输出；e2e 断言数在 `e2e.mjs` 实际跑完后回填。

## 1. 单元测试

```
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/24game-premium/test.js
```

实际输出：`RESULT: 375 passed, 0 failed`，退出码 0。

覆盖：40 张牌守恒、精确有理数、安全递归下降解析器（无 eval）、四张牌各一次、除数非零、求解器已知有解/无解集合、三档难度生成、每日种子、状态机动作、不可变、序列化、48 步长序列守恒、标准 63:88 比例与 1–10 点阵数量。

## 2. 浏览器 E2E

```
node games/boardgame/24game-premium/e2e.mjs
node games/boardgame/24game-premium/e2e.mjs --control
```

实际输出：正常运行 `RESULT: 149 passed, 0 failed`，退出码 0；`--control` 输出 `RESULT: 0 passed, 1 failed`，退出码 1。

E2E 覆盖：真实页面初始渲染、40 张守恒、共享 Shuffle/Sfx/Store、三种材质、数字键盘/撤销/清空、提示、错误答案、键盘 Enter 获胜、Store 最佳成绩、下一题、看答案、N/U/H 快捷键、确定性引擎 API、非法动作、不可变、移动端 390×844 与 320×568（无横向滚动、按钮 ≥44×44、字号 ≥12px、输入框 ≥16px）、规则页 Article+FAQPage、≥1200 汉字、B 站来源、单人标注、美术页真实题面 `5,5,5,1` 与 `5×(5−1÷5)=24`、三种材质、四档 shot、四张 WebP 尺寸、性能预算、零外部请求、零 console error/异常/4xx。

## 3. 手机冒烟（只跑本游戏）

```
printf '24game-premium\n' >/tmp/24game-games.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/24game-games.txt --width 390 --height 844 --json /tmp/24game-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/24game-games.txt --width 320 --height 568 --json /tmp/24game-320.json
```

实际输出：390×844 `summary.pass=1, fail=0, checks=19, externalRequests=0, consoleErrors=0, exceptions=0`；320×568 同样 `pass=1, fail=0, checks=19, ... 0/0/0`。

## 4. 四张 WebP

```
file games/boardgame/24game-premium/assets/{cover,og,detail-1,card}.webp
```

实际尺寸：cover 1200×1200（58,486 B）、og 1200×630（47,464 B）、detail-1 1536×1024（76,650 B）、card 480×320（13,496 B）。四张均非空。

## 5. 美术合成

```
node games/boardgame/scripts/render-premium-art.mjs \
  --slug 24game-premium --out games/boardgame/24game-premium/assets \
  --shots cover:1200x1200,og:1200x630,detail:1536x1024,card:480x320
```

合成题面 5♠ 5♥ 5♦ A♣，参考解 `5 × (5 − 1 ÷ 5) = 24`；该题在求解器中恰好 1 种规范解（困难档）。
