# AI Agent 评测引擎（确定性、无 LLM 裁判）

`games/ai-eval/` 是一个可复现的 AI agent 评测引擎：出题、判分、统计全部在本地完成，**不用 LLM 当裁判**。题库的标准答案由仓库现有引擎在出题时计算，不手工录入。

```
node games/ai-eval/runner.js --suite A --seed 42 --adapter builtin
node games/ai-eval/runner.js --suite A --seed 42 --adapter random
node games/ai-eval/runner.js --suite B --seed 42 --adapter http --n 20
node games/ai-eval/runner.js --all --seed 42 --adapter builtin --json > result.json
```

---

## 1. 三类题的意义

### 组 A：规则复现（closed-form，不需要对局）

给一段结构化局面和问题，要求只返回 JSON。题库固定在 360 题：

| 子类 | 题量 | 真值来源 | 说明 |
| --- | ---: | --- | --- |
| 麻将 | 100 | `shared/hand-eval.js` 的 `checkWinningHand` | 基本胡、七对、十三幺、随机未胡、换一张的诈胡负例 |
| 德州扑克牌型 | 60 | `shared/hand-eval.js` 的 `evalPoker` / `best5of7` | 7 选 5，返回牌型键、rank、tiebreak |
| 德州扑克比较 | 40 | `shared/hand-eval.js` 的 `comparePoker` | 两手 7 张比较 -1/0/1，含 10 个平局 |
| 五子棋终局 | 80 | `shared/rules.js` 的 `lineAt` 扫描 | 36 黑胜、36 白胜、8 满盘和棋 |
| TCG 合法动作 | 80 | `shared/tcg.js` 的 `legalActions` | 重放对局到某局面，列出全部合法动作集合 |

判分：JSON 深度相等，**数组按集合比较**（顺序无关、重复元素忽略）。每题 1 分。这与“列出全部合法动作”“取最强 5 张”的语义一致。

题目不是手写的：局面由 seeded PRNG 生成，真值在生成时调用上述引擎算出。组 A 检验的是规则知识、组合枚举和 JSON 纪律，不涉及长程规划。

### 组 B：对局（agent 打内置 AI）

用 seeded 的 `shared/tcg.js`（`createMatch` + `apply`）跑固定 seed 列表。agent 执先手、后手各 `N` 局（默认 `N=20`，共 40 局）。

- 对局引擎与洗牌全部确定性。
- agent 只能看到自己的手牌、双方场面、核心/资源、双方牌库数量，以及 runner 枚举好的 `legalActions`；对手手牌与双方牌库顺序被隐藏（`sanitizeTcgState`）。
- 判分：胜率 + **Wilson 95% 置信区间**（自己实现，无依赖）；同时报告胜/负/和、非法动作次数。
- 非法动作（不在 `legalActions` 中、apply 抛错、超时/格式错误）**直接判负并记录 stable code**。
- 和棋在总分里记 0.5；Wilson 区间只在胜/负的决胜局上计算（二项分布假设）。
- 内置对手是我们自己的确定性启发式（`adapters.chooseTcgAction`）。`builtin` adapter 与它同策略，镜像对局就是“题目有解、双方公平”的对照：seed 42、N=20 时实测胜率 55%，CI [39.8%, 69.3%]。

### 组 C：代码任务（红测试变绿）

从 `games/TASKS.json` 里筛出 `level/severity/priority/effort = S`、带 `probe`、且 `status != done` 的任务；如果该文件或 `scripts/check-tasks.js` 不存在，就使用 3 个内置小任务。

**当前仓库状态**：`games/TASKS.json` 与 `scripts/check-tasks.js` 已经存在，默认组 C 会使用其中 **16 个 S 级、带 probe 的任务**。这些任务目前都是 `open`，所以默认组 C 的得分是 0 —— 这是正确信号：runner 只判分，不会替你改代码。要看判分管线本身是否工作，用 `--builtin-c` 切到下面 3 个内置任务（builtin 3/3、random 0/3）。默认组 C 单次要跑 16 次 `check-tasks --task` 加一次全量 `run-all.js`，约 85 秒。

内置任务不是玩具：每个都是真实共享引擎的一份副本，注入一行已知 bug：

1. `hand-eval.js` 的七对判定（`% 2 !== 0` 被改成 `% 2 === 0`）
2. `rules.js` 的五子棋五连判定（`n >= 5` 被改成 `n >= 6`）
3. `hand-eval.js` 的 A2345 轮子顺（`ranksDesc[1] === 5` 被改成 `=== 6`）

判分（内置任务）：

- `node test.js` 退出码 0（唯一正确性闸门）
- 改动行数：正确性优先；通过后最多加 0.25 分简洁度奖励
  `score = 1 + 0.25 * (1 - min(1, changedLines / 40))`
- 只允许改题目给定的文件；改测试文件或加新文件会被判 `invalid_file`

判分（`TASKS.json` 仓库任务）：

- `node scripts/check-tasks.js --task <id>` 退出码 0
- 全量 `node games/tests/run-all.js` 仍全绿（一次运行，作为整组闸门）
- 改动行数用 `git diff --numstat -- <probe 文件>` 统计
- runner **只判分，不修改工作区**；这类 case 不会调用 adapter

> **沙箱由执行者自己负责。** runner 只负责判分，不负责隔离。内置任务在 `os.tmpdir()` 的临时目录里跑 `node test.js`，但那不是操作系统级沙箱；`TASKS.json` 任务更是在当前工作区上判分。需要强隔离时，请把整个仓库/任务放进容器、虚拟机或受限用户后再调用 runner。

---

## 2. 怎么跑

```bash
# 组 A：默认从 360 题库里按 seed 抽 120 题
node games/ai-eval/runner.js --suite A --seed 42 --adapter builtin
node games/ai-eval/runner.js --suite A --seed 42 --adapter random

# 用满 360 题
node games/ai-eval/runner.js --suite A --seed 42 --adapter builtin --n 360 --json

# 组 B：agent 先手/后手各 20 局
node games/ai-eval/runner.js --suite B --seed 42 --adapter http --n 20

# 组 C：默认用 TASKS.json 的 16 个 S 级任务（当前全部 open，分数为 0）
node games/ai-eval/runner.js --suite C --seed 42 --adapter builtin
# 组 C：强制使用 3 个内置代码任务（判分管线对照）
node games/ai-eval/runner.js --suite C --seed 42 --adapter builtin --builtin-c

# 一次跑完 A/B/C
node games/ai-eval/runner.js --all --seed 42 --adapter builtin --json > result.json
```

选项：

| 选项 | 含义 |
| --- | --- |
| `--suite A\|B\|C` | 跑单个题组 |
| `--all` | 跑 A、B、C |
| `--seed N` | 运行 seed，默认 42 |
| `--adapter builtin\|random\|http` | 适配器，默认 builtin |
| `--n N` | A 抽样数（默认 120）；B 每边局数（默认 20）；C 任务上限 |
| `--games LIST` | B 的对局类型，逗号分隔（目前支持 `tcg`） |
| `--json` | stdout 只输出 JSON；日志走 stderr |
| `--out FILE` | 额外把 JSON 写到文件 |
| `--timeout MS` | HTTP 请求超时，默认 60000 |
| `--keep-sandboxes` | 保留组 C 的临时目录 |
| `--builtin-c` | 组 C 强制使用 3 个内置任务（忽略 TASKS.json） |

退出码：正常跑完为 0（分数低不影响退出码）；参数/配置错误为 2；运行异常为 1。

### HTTP 适配器

任意 OpenAI 兼容的 `/chat/completions`。key 只从环境变量读取，**不写进仓库、不打印、不进入结果 JSON**：

```bash
export AI_EVAL_BASE_URL="https://api.example.com/v1"
export AI_EVAL_MODEL="some-model"
export AI_EVAL_API_KEY="…"     # 不要写进任何文件
node games/ai-eval/runner.js --suite A --seed 42 --adapter http
```

行为：超时 60s（`--timeout` 可调）；网络错误/5xx/429 重试 1 次；返回内容解析失败记为 `invalid_format`，不会让 runner 崩溃。组 C 会把失败测试与 buggy 文件全文发出去，请自行评估外部数据合规性。

---

## 3. 适配器接口

`adapters.js` 暴露 `builtin()`、`random(seed)`、`http({baseUrl, model, apiKey})`：

```js
// 组 A
answer(publicTask) -> JSON 值
// 组 B
move(view) -> view.legalActions 中的某一项（必须完全相等，键顺序无关）
// 组 C
solve(publicTask, ctx) -> { files: { "lib.js": "完整文件内容" } }
```

- `builtin`：用仓库引擎重算答案，是**对照基线**，用来证明题目有解；组 C 返回注入 bug 前的原始引擎文件。
- `random(seed)`：seeded 随机作答，是**下限基线**；组 A 的二元题约为 1/选项数，集合题接近 0。
- `http`：OpenAI 兼容接口。`ctx.reference` 只传给 builtin，HTTP/random 永远看不到原始正确文件。

---

## 4. 可复现性

- **题库固定**：360 道题由固定内部 seed（`BANK_SEED = 'ai-eval-bank-v1'`）生成；同一台/任何机器上题目、顺序、真值一致。
- **运行 seed 决定抽样**：默认 `n=120` 时不同 seed 得到不同子集（seed 42 与 43 实测交集 45/120）；`n >= 360` 时包含全部题目，只改变顺序。
- **组 B 的 seed**：`"<seed>:B:<game>:s<seat>:<i>"`，同一 seed 同一局。
- **engineVersion**：`shared/{hand-eval,shuffle,tcg,rules}.js`、存在时的 `shared/agent-api.js`，以及 `ai-eval/{runner,tasks,score,adapters}.js` 的 SHA-256 摘要，格式 `ai-eval/1.0.0+sha256:<16 hex>`。共享引擎或评测代码一变，版本就变。
- **digest**：结果里包含 `digest`，是对 `{suite, seed, engineVersion, adapter, cases, summary}` 的稳定哈希；**忽略** `startedAt` / `finishedAt` / 临时目录 / 计时字段。同一 seed + 同一 adapter 两次运行 digest 相同。
- 使用 HTTP 时，模型输出本身不确定，digest 不保证跨次一致；确定性保证只覆盖“给定 adapter 输出”的判分与统计。

---

## 5. 怎么加新题

### 加组 A

在 `tasks.js` 对应的 `make*Tasks()` 里加生成逻辑：

1. 用 `Shuffle.createRng(fixedSeed)` 或 `shuffle(array, {seed})` 生成局面，不要用 `Math.random`。
2. **真值必须在生成时用共享引擎计算**（`H.checkWinningHand` / `H.evalPoker` / `GameRules` / `TCG.legalActions`），不要手写答案。
3. 分配稳定 id（如 `A-mj-101`），并在 `bankSizes()` 里加计数。
4. 跑 `node games/ai-eval/test.js`，它会交叉核对每种题的真值与引擎输出。

### 加组 B

- 目前只支持 `tcg`。新增游戏需要：一个 seeded、可重放的会话（`state()/legalActions()/apply()/status()`），并在 `runner.createBSession()` 注册。
- 对手策略应确定性（不要用 `Math.random` 或墙钟时间做决策），否则跨机器不可复现。`shared/rules.js` 的五子棋没有内置 AI；五子棋 AI 在 `games/gomoku/index.html` 里且 level 1 用 `Math.random`、搜索用墙钟 deadline，因此没有接入组 B。

### 加组 C

- **内置任务**：在 `generateBuiltinCTasks()` 里用 `inject()` 对真实共享文件做唯一、单点的注入，并提供 `reference`（注入前全文）和能区分红绿的 `test.js`。
- **仓库任务**：在 `games/TASKS.json` 里给出 S 级、带 `probe` 的任务，并提供 `scripts/check-tasks.js`。runner 会：
  - 筛出 `level/severity/priority = "S"` 且有 `probe` 的条目；
  - 用 `child_process` 调 `check-tasks.js --task <id>`；
  - 跑一次 `node games/tests/run-all.js` 作为全量闸门；
  - 用 `git diff --numstat` 统计 probe 文件改动行数。
  解析不到兼容任务时自动回退到 3 个内置任务；结果的 `summary.source` 会写明 `builtin` 或 `repo`。

---

## 6. 结果字段

```jsonc
{
  "suite": "A",
  "seed": 42,
  "engineVersion": "ai-eval/1.0.0+sha256:…",
  "adapter": "builtin",
  "startedAt": "…",
  "finishedAt": "…",
  "cases": [{ "id": "A-mj-001", "pass": true, "detail": { "family": "mahjong" } }],
  "summary": { "score": 120, "total": 120, "passRate": 1, "bankSize": 360, "sampled": 120 },
  "digest": "…"
}
```

组 B 的 `summary` 额外包含 `wins/losses/draws/illegal/winRate/scoreRate/ci`；`ci` 为 `{p, n, z, low, high}`，无决胜局时为 `null`。组 C 的 `cases[i]` 额外有 `score`，`summary` 有 `changedLines/source/repoSuite`。

`--all` 返回 `{mode:"all", seed, engineVersion, adapter, suites:{A,B,C}, digest}`。

---

## 7. 组 B 的接口现状与 agent-api

- **当前实现**：直接驱动 `games/shared/tcg.js`（`createMatch` + `legalActions` + `apply`）。
- **自动切换**：`runner.loadAgentApi()` 会尝试加载 `games/shared/agent-api.js`；如果它暴露 `GameAgent.create(slug,{seed})`，且返回对象带 `state()/legalActions()/apply(id)/status()`，组 B 会优先走这套统一协议。加载失败、协议不完整或 `create('tcg',…)` 抛错时，静默回退到直接引擎。
- **当前实测状态**：`games/shared/agent-api.js` 已存在，但还没有注册任何游戏（`GameAgent.list()` 返回空），所以 `create('tcg')` 抛 `unknown_game`，组 B 走直接 `shared/tcg.js`。等 TCG 注册进来后会自动切换。已用模拟 session 验证过：`p1/p2` 座位映射、`apply(id)` 返回值 `{ok:false}` 视为非法、`status().winner` 的 `p1/p2`/`'draw'` 都能正确判胜负；每局 case 的 `detail.session` 会写明用了哪条路径（`tcg-direct` / `agent-api`）。
- **本文件不创建/修改 `games/shared/agent-api.js`**，只消费。
- **接口变化不改变棋力上限**：组 B 的对手始终是 `adapters.chooseTcgAction` 这个内置启发式。换成 `agent-api` 只是换了驱动层，不会让对手变强；所以“胜率的上限受内置 AI 限制”这一结论与接口无关。

---

## 8. 已知局限（诚实版）

1. **公开仓库藏不住题**：题库生成器、共享引擎、甚至标准答案的计算过程都在仓库里。360 题只防“随手作弊/猜题”，防不住有仓库读权限的 agent 直接抄生成逻辑。没有反作弊机制。
2. **组 A 不等于通用智能**：closed-form 题考规则记忆、组合枚举与 JSON 输出纪律，不考规划、工具使用或长上下文。麻将二元题随机也有约 50%，所以要看分题型分数，不能只看总分。
3. **TCG 合法动作题很难**：要求完整枚举动作集合，模型必须理解 `legalActions` 的全部细节（费用、目标、每回合一次、刚上场不能攻击等）。这可能是 LLM 的强失败点；它反映的是“精确规则复现”，不是“下棋水平”。
4. **组 B 的对手不强**：内置启发式只按“斩杀 > 换牌 > 出牌 > 用技能 > 打脸”打分，不是搜索型或学习型 AI。胜率只相对于这个对手有意义，不能外推到人类或强 AI。
5. **组 B 只接入 TCG**：五子棋/四子棋的共享引擎没有 seeded、可复现的 AI（五子棋 AI 在页面内且用 `Math.random`/墙钟 deadline），因此没有作为 B 组对局。`--games` 目前只接受 `tcg`。
6. **组 B 的动作必须精确匹配**：agent 返回的动作必须与 `legalActions` 中某一项深度相等（键顺序无关）。多写字段、改写措辞、把 `attack` 写成 `play` 都会判非法并直接判负。这是有意的严格性，但会惩罚“语义正确、格式不对”的模型。
7. **和棋与置信区间**：总分里和棋记 0.5；Wilson 区间只用胜任/负的决胜局，和棋被排除在分母外。若和棋很多，区间会波动且样本量变小。Wilson 假定二项分布，镜像策略下的对局并非独立同分布（同一 seed 的牌序固定），区间应视为近似。
8. **组 C 的隔离不归 runner 管**：内置任务在临时目录跑，但没有容器/用户隔离；`TASKS.json` 任务直接在当前工作区判分。runner 从不修改工作区，也不阻止执行者用任意手段让测试变绿（包括在 sandbox 内读取测试、猴补模块）。需要真实隔离请自己上容器。
9. **组 C 的仓库闸门会被并发开发影响**：全量 `run-all.js` 是整组闸门；如果别的 agent 正在改文件导致测试红，组 C 的仓库任务会一起失败。这是有意的“不能弄坏别的测试”信号，但会受工作区状态影响。
10. **组 C 的简洁度奖励很小且有上限**：最多 +0.25 分，且必须测试通过；不存在“少改行就能绕过正确性”的路径。但 diff 统计只修剪公共前后缀，不区分移动代码与重写代码。
11. **random 不是零知识基线**：它知道答案 schema（该返回哪些字段、动作长什么样），只是不知道内容；所以它是“格式正确但内容随机”的下限，不是完全无知的基线。
12. **扑克 tiebreak 按集合比**：数组按集合比较的规则意味着 kicker 的返回顺序不重要；如果模型返回同一组点数但顺序不同，仍算对。这符合“数组按集合比”的约定，但比严格序列比较宽松。
13. **五子棋题是满盘终局**：全部 225 格都有子，考的是“任意方向连续五子”的终局判定，不是走子生成或禁手规则；和棋题是构造出来的满盘无五连图案。
14. **engineVersion/digest 对代码变化敏感**：共享引擎或 `ai-eval/` 里任何一行改动都会改变版本与 digest，即使语义没变。跨版本比较分数前先对齐 `engineVersion`。
15. **HTTP 模型不确定**：同一 seed 下 HTTP 适配器的输出可能不同，digest 不可复现；只有 `builtin`/`random` 的整条链路是确定性的。

---

## 9. 测试

```bash
node games/ai-eval/test.js
```

当前 105 条断言，覆盖：

- JSON 深度相等与数组集合比较
- Wilson 95% 区间的**手算对照值**（0/10、10/10、50/100、58/100、10/20、1/1）
- JSON 容错（围栏、前后文字、尾随逗号、字符串内花括号）
- 改动行数统计
- 360 题库的每一种真值都与共享引擎交叉核对
- seed 抽样、digest 稳定性、engineVersion 格式
- builtin 全题库 100%、random 下限、次/负/和守恒、非法动作判负
- 组 C builtin 3/3、random 0/3、简洁度加分
- 本地 HTTP 服务器的超时重试、5xx 重试、坏 JSON 降级、API key 不泄露
- `agent-api` 统一协议：测试内 mock 注册，验证 `p1/p2` 座位映射、`apply(id)` 与胜负判定
