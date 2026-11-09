# 批量生产工具的统一 brief

你是一个批量生产 agent。先读这四份材料，再动手：
1. `/Users/fa/games/tools/tests/CONTRACT.md` — 硬性契约
2. `/Users/fa/games/tools/tests/CATALOG.md` — 100 工具总目录（找到你负责的 slug 的详细规格）
3. `/Users/fa/games/tools/tests/scaffold/README.md` + `scaffold.html` — 统一脚手架与生成器
4. `/Users/fa/games/AGENTS.md` — 仓库协作与验收规则

## 交付物

对你负责的每个 slug：
- `/Users/fa/games/tools/<slug>/index.html`（单文件，默认 ≤ 90KB；QR / 条码 / 图片类可到 120KB，需在交付说明中列明并用 `--max-bytes 120` 校验）
- `/Users/fa/games/tools/tests/<slug>.test.js`

不得修改 `tools/tests/lib.js`、`games/tests/*`、大厅三个页面、其他人的工具、根目录文件；不得 git commit。

## 生产流程（每个工具）

1. 用脚手架生成器起稿（config 也放仓库可见目录 `/Users/fa/games/tools/tests/configs/<slug>.json`，禁止放 /tmp）：
   `node /Users/fa/games/tools/tests/scaffold/make-tool.js --config /Users/fa/games/tools/tests/configs/<slug>.json --out /Users/fa/games/tools/<slug>/index.html`
   生成后跑 `--check`。
2. 按目录规格填四个区：
   - `<!--TOOL_BODY-->`：表单/结果/表格/复制按钮；所有控件有 label、触控 ≥44×44px、错误就地显示、结果 aria-live。
   - `<script id="engine">`：纯函数，Node 可求值；导出目录里要求的函数；非法输入返回 `{ok:false,error:'code'}` 或明确抛错；金额用最小单位整数；日期用本地 {y,m,d}/UTC 序数；随机用注入 rng（生产用 crypto）。
   - `TOOL_DICT_ZH/EN/ID`：键完全一致；所有可见文案、placeholder、aria-label、动态文案走字典；三语自然，不机翻腔。
   - explain + FAQ：公式、假设、取整规则、限制；健康/金融写“仅供参考，不构成建议”；FAQ 与 JSON-LD 一致。
3. 写测试：复制 `TEST_TEMPLATE.js`；引擎断言 ≥ 10 条（覆盖正常/0/负数/非法/边界/取整/守恒；复杂工具建议更多），三语键一致、data-i 键存在、externalRefs 为空、JSON-LD 三条、体积。
4. 跑单测直到 0 失败：
   `export PATH=$HOME/.local/node/bin:$PATH; cd /Users/fa/games; node tools/tests/<slug>.test.js`
5. 跑真实浏览器：
   `node games/tests/browser-check.js <slug> --langs zh,en,id`
   必须全 PASS；不通过就改页面，不许改校验器。
6. 该批全部完成后，跑该批的 `node games/tests/browser-check.js <slug1> <slug2> ... --langs zh,en,id`，确认无回归。

## 质量底线

- 单文件、内联 CSS/JS、零外部请求（无 CDN/字体/图片/接口）、无追踪、无 localStorage 敏感数据。
- 390 与 320 无横向滚动；触控 ≥44×44；深色模式；reduced-motion；keyboard 可达；focus-visible。
- 所有用户输入渲染用 textContent，禁止 innerHTML 注入。
- 计算器必须可复算：页面写明公式与假设；金额/比例结果给出取整规则。
- 不复制粘贴同一套假数据；每个工具的引擎和测试要真实覆盖其业务规则。
- 复杂算法（QR、Code128、diff、cron、markdown）必须自包含实现；可移植公有领域算法，但要在注释注明来源与许可，不得引入运行时依赖。
- 图片类只用 canvas/FileReader/Blob，全部本地处理，明确不上传。

## 回报格式（≤400 字 + 命令清单）

- 完成 slug 列表与每个文件字节数
- 每个 slug 的 `RESULT: N passed, M failed` 实测摘要
- browser-check 该批汇总（PASS 数 / FAIL 数）
- 引擎导出函数
- 已知限制 / 未完成项
- 不要写未实际运行的验证结论
