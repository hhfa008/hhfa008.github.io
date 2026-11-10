斗地主 premium：shipped — 单测 418/0，双客户端联机 E2E 57/0（2 人类 + 1 AI 补位），`--control` exit 1，390×844 与 320×568 smoke 各 19/19 PASS，五项门禁全过。
Evidence: meta.json、ACCEPTANCE.md、E2E.md、online-e2e.json、perf.json（500 次建局 5ms、300 次合法动作 16ms、单次 AI 0.07ms）、realism.json 6/6、cover/og/detail WebP + PNG 母版；14 种牌型与 54 张牌面由 engine/代码校验。
Next: 待统一运行 scripts/gen-precache.js 将本目录写入 v22 清单；J/Q/K 仍为字母牌面（ART-GUIDE 已登记的存量债务），其余无已知阻塞。
