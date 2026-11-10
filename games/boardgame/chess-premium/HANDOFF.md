# HANDOFF — 国际象棋 CHESS PREMIUM
- 范围/验证：FIDE 全规则引擎（perft 20/400/8902/197281）+ Alpha-Beta AI + 木纹 8×8 UI + 双人联机；`test.js` 281/0、`test-online.js` 80/0、`e2e.mjs` 152/0，两个 `--control` exit 1，390×844 与 320×568 冒烟各 19/19 PASS。
- 分支/缺口：`boardgame/d686a4ca-b7-g8` 已提交并 push origin；缺口：无（8×8 棋盘为单一复合网格，按钮/下拉 ≥44px）。
