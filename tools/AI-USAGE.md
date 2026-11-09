# AI 调用指南（tools）

`tools/` 已从「只能人点网页」改成「AI 可以直接调」的三层结构：

| 层 | 文件 | 作用 |
| --- | --- | --- |
| 清单 | `tools/manifest.json` | 100 个工具的机器可读 schema（标题三语、输入、输出、示例、是否实现） |
| 计算 | `tools/shared/compute.js` | UMD、零依赖；Node 与浏览器都能跑；只接收/返回普通对象 |
| 入口 | `tools/cli.js` | 命令行，stdout 永远是 JSON |
| 接入 | `tools/mcp-server.js` | 零依赖 MCP server（stdio JSON-RPC 2.0） |

当前：**100 个条目，35 个 `implemented: true`**。其余 65 个在 `blockedBy` 里写明原因（DOM/canvas、浏览器文件 API、计时、随机交互，或本轮未覆盖的纯计算）。

## 1. 在 Claude Code 里接入 MCP

在项目根目录的 `.mcp.json`（或用户级 MCP 配置）里加：

```json
{
  "mcpServers": {
    "hhfa-tools": {
      "command": "node",
      "args": ["/Users/fa/.local/share/pa/workspace/hhfa008-mac2-merge/tools/mcp-server.js"]
    }
  }
}
```

重启 Claude Code 后，`tools/list` 会列出 manifest 的全部 100 个条目：35 个可直接调用，其余 65 个描述以 `[not implemented]` 开头并带 `blockedBy`。每个工具的 `inputSchema` 由 `manifest.json` 直接转成 JSON Schema。`tools/call` 返回：

```json
{
  "content": [{ "type": "text", "text": "{\"ok\":true,\"tool\":\"bmi-calculator\",\"result\":{...}}" }],
  "isError": false
}
```

协议版本：`2024-11-05`。stdout 只有 JSON-RPC 帧，日志全部走 stderr。

手工验证 MCP（不需要客户端）：

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"bmi-calculator","arguments":{"heightCm":175,"weightKg":70}}}' \
| node tools/mcp-server.js
```

## 2. CLI

```bash
node tools/cli.js list                 # 只列 implemented:true
node tools/cli.js list --all           # 100 个条目
node tools/cli.js schema <id>          # 完整 manifest 条目
node tools/cli.js run <id> --json '{...}'
node tools/cli.js run <id> --stdin
node tools/cli.js search <关键词>
```

退出码：

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 入参不合法（JSON 解析失败、缺字段、引擎校验失败） |
| `3` | 工具未实现（看 `blockedBy`） |
| `4` | 未知工具 id |

所有输出都是单个 JSON 文档；失败也是 `{"ok":false,"error":"..."}`。

### 真实例子（均为本机实际运行输出）

**例 1：BMI**

```bash
node tools/cli.js run bmi-calculator --json '{"heightCm":175,"weightKg":70}'
```

```json
{
  "ok": true,
  "tool": "bmi-calculator",
  "result": {
    "bmi": 22.8571,
    "category": "normal",
    "healthyMinKg": 56.6563,
    "healthyMaxKg": 76.2563
  }
}
```

**例 2：CSV → JSON（含类型推断）**

```bash
node tools/cli.js run csv-to-json --json '{"csv":"name,age\nAlice,30\nBob,25","inferTypes":true}'
```

```json
{
  "ok": true,
  "tool": "csv-to-json",
  "result": {
    "data": [
      { "name": "Alice", "age": 30 },
      { "name": "Bob", "age": 25 }
    ],
    "columns": ["name", "age"],
    "warnings": [],
    "rowCount": 2
  }
}
```

**例 3：时区换算（含跨日）**

```bash
node tools/cli.js run timezone-converter --json '{"local":"2024-01-01T09:00","from":"Asia/Shanghai","to":"America/New_York"}'
```

```json
{
  "ok": true,
  "tool": "timezone-converter",
  "result": {
    "epoch": 1704070800000,
    "from": "2024-01-01T09:00:00",
    "to": "2023-12-31T20:00:00",
    "offsetFrom": "+08:00",
    "offsetTo": "-05:00",
    "dayDelta": -1
  }
}
```

### stdin 写法

```bash
echo '{"category":"length","value":1,"from":"km","to":"m"}' \
  | node tools/cli.js run unit-converter --stdin
```

## 3. 已实现工具（35）

文本/开发：`base64-encoder`、`case-converter`、`slug-generator`、`url-encoder`、`html-entity-encoder`、`csv-to-json`、`json-to-csv`、`json-formatter`、`json-to-typescript`、`jwt-decoder`、`text-diff`

颜色/数字/数学：`color-converter`、`number-base-converter`、`roman-numeral-converter`、`fraction-calculator`、`percentage-calculator`、`statistics-calculator`、`quadratic-solver`、`gcd-lcm-calculator`

换算：`unit-converter`、`cooking-converter`、`paper-size-converter`、`aspect-ratio-calculator`

财务：`loan-calculator`、`compound-interest-calculator`、`savings-goal-calculator`、`roi-calculator`、`vat-calculator`、`profit-margin-calculator`

健康/时间/安全：`bmi-calculator`、`date-calculator`、`unix-timestamp-converter`、`timezone-converter`、`hash-generator`、`uuid-generator`

## 4. 一致性怎么保证

`tools/shared/compute.js` 中每个引擎块都来自对应页面 `tools/<id>/index.html` 的 `<script id="engine">`（页面契约要求它必须是纯函数），adapter 只负责校验和字段映射。测试不是「看着差不多」：

```bash
node tools/tests/run.js
```

- 每个已实现工具至少 3 组有效输入（清单示例 + 边界值）和至少 1 组非法输入；
- 每组有效输入不仅断言期望字段，还会调用 `tools/tests/parity.js`：用 Node `vm` 重新抽取页面引擎，与 `compute.js` 逐字段比对（数值容差 `5e-4`，用于吸收展示舍入）；
- 5 个工具做 CLI 输出 == compute 输出的端到端比对；
- 另测 MCP 的 `initialize` / `tools/list` / `tools/call`。

当前结果：**733 项断言，0 失败**；35 个工具全部 `parity: "extracted"`。

如果页面计算逻辑改了、`compute.js` 没同步，parity 测试会直接报出字段差异。

## 5. 增加一个工具

1. 在页面里按契约写好 `<script id="engine">`（纯函数，导出 `ToolEngine`）。
2. 把该引擎块复制进 `compute.js` 的 `engines` 区，外层仍用 IIFE 返回 `ToolEngine`。
3. 写一个 adapter（输入普通对象 → 校验 → 调引擎 → 返回普通对象），注意 BigInt 要转字符串，异步引擎（如 `hash-generator`）可返回 Promise。
4. 在 `compute.js` 末尾加 `def("<id>", __run_<id>, "<id>");`。
5. 在 `manifest.json` 添加条目：`inputs` / `outputs` / `examples` / `implemented: true` / `parity`。
6. 在 `tools/tests/run.js` 加 2 组有效输入（含边界）和 1 组非法输入，在 `tools/tests/parity.js` 加对应 reference。
7. 跑 `node tools/tests/run.js`，0 失败后再交给 AI 调用。

## 6. 边界说明

- `hash-generator` 依赖宿主的 Web Crypto（Node 18+ 自带 `globalThis.crypto`），因此是异步工具；CLI/MCP 都会 await。
- `uuid-generator` 传 `seed` 时用 mulberry32 复现；不传则用 `Math.random`。
- `timezone-converter` 依赖 IANA 时区数据库（`Intl`），离线可用，但结果随宿主 tzdata 版本变化。
- 所有工具都不读写 localStorage、不发网络请求、不打印环境变量。
