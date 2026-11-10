飞行棋 premium：shipped — 单测 492/0，双客户端联机 E2E 78/0（2–4 座、AI 补位、服务端骰子），`--control` exit 1，390×844 与 320×568 smoke 各 19/19 PASS，五项门禁全过。
Evidence: meta.json、ACCEPTANCE.md、E2E.md、online-e2e.json、perf.json、realism.json 6/6（52 格彩环、4×13、4 基地、6 格归航道、24mm 飞机、16mm 骰子、330mm 棋盘）、cover/og/detail WebP + PNG 母版；完整飞机与骰子由代码 SVG/点阵绘制，四色 plane-token 为 1024 RGBA 材质。
Next: 待统一运行 scripts/gen-precache.js 写入 v22 清单；无已知阻塞。
