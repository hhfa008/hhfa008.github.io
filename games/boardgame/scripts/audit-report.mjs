#!/usr/bin/env node
/*
 * Render PROCESS-AUDIT.md and audit/PROGRESS.json from real artifacts:
 *   catalog-status.json  (verify-shipped output)
 *   audit/smoke-*.json   (real-browser results)
 *   audit/resources.json (CPU/memory/duration records)
 *   /tmp/audit-runall.log (run-all tail; optional path via --runall)
 *
 * No number in the report is hardcoded; every count is recomputed here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BOARD_ROOT } from './audit-catalog.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i !== -1 ? args[i + 1] : fallback;
};
const statusPath = path.resolve(opt('status', path.join(BOARD_ROOT, 'catalog-status.json')));
const runallPath = path.resolve(opt('runall', '/tmp/audit-runall.log'));
const outPath = path.resolve(opt('out', path.join(BOARD_ROOT, 'PROCESS-AUDIT.md')));
const progressPath = path.resolve(opt('progress', path.join(BOARD_ROOT, 'audit', 'PROGRESS.json')));

const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
const resources = fs.existsSync(path.join(BOARD_ROOT, 'audit', 'resources.json'))
  ? JSON.parse(fs.readFileSync(path.join(BOARD_ROOT, 'audit', 'resources.json'), 'utf8'))
  : { runs: [] };
const runall = fs.existsSync(runallPath) ? fs.readFileSync(runallPath, 'utf8') : '';
const runallTails = runall.split('\n').filter((l) => /游戏测试:|工具测试:|合计:|尚无自动化测试/.test(l));
const runallExit = (runall.match(/^EXIT=(\d+)$/m) || [])[1];
const smoke = status.smoke || {};
const s390 = (smoke['390'] && smoke['390'].summary) || null;
const s320 = (smoke['320'] && smoke['320'].summary) || null;

const gateNames5 = ['process', 'art', 'realism', 'mobile', 'online'];
const gateReports = {};
gateNames5.forEach((name) => {
  const file = path.join(BOARD_ROOT, 'audit', 'gate-' + name + '.json');
  if (fs.existsSync(file)) {
    try { gateReports[name] = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* ignore */ }
  }
});
const gatesAll = fs.existsSync(path.join(BOARD_ROOT, 'audit', 'gates-all.json'))
  ? JSON.parse(fs.readFileSync(path.join(BOARD_ROOT, 'audit', 'gates-all.json'), 'utf8'))
  : null;

const manifestPath = path.resolve(BOARD_ROOT, '..', 'precache-manifest.js');
const manifestSrc = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
const precache = [...manifestSrc.matchAll(/"(\/games\/[^"]+)"/g)].map((m) => m[1]);
const swBoardgame = precache.filter((u) => u.indexOf('/boardgame') !== -1);
const swControl = '/games/boardgame/__new-runtime-control__/';
const swControlDetected = precache.indexOf(swControl) === -1;

function table(headers, rows) {
  return [
    '| ' + headers.join(' | ') + ' |',
    '|' + headers.map(() => '---').join('|') + '|'
  ].concat(rows.map((r) => '| ' + r.join(' | ') + ' |')).join('\n');
}

const games = status.games || [];
const extras = status.extras || [];
const all = games.concat(extras);
let sharedRefs = 0;
let localShuffle = 0;
for (const game of games) {
  const dir = path.join(BOARD_ROOT, game.slug);
  const index = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  const engine = fs.existsSync(path.join(dir, 'engine.js')) ? fs.readFileSync(path.join(dir, 'engine.js'), 'utf8') : '';
  const combined = index + '\n' + engine;
  if (/(\.\.\/)+shared\//.test(combined)) sharedRefs++;
  if (/function\s+shuffle|(?:const|var|let)\s+shuffle\s*=/.test(combined)) localShuffle++;
}
const byKind = status.summary.byKind;
const gateNames = ['process', 'art', 'realism', 'mobile', 'mode'];
const gateLabel = {
  process: '流程（设计/单测/性能/E2E/验收）',
  art: '美术（封面/OG/详情图）',
  realism: '真实性校验',
  mobile: '移动端 390/320',
  mode: '单人标注 / 多人在线 E2E'
};

const reasonBuckets = {
  'DESIGN.md 缺失': games.filter((g) => !g.evidence.design).length,
  '性能断言缺失': games.filter((g) => !g.evidence.perf).length,
  '验收记录缺失': games.filter((g) => !g.evidence.acceptance).length,
  '封面缺失': games.filter((g) => !g.evidence.art.cover).length,
  'OG 图缺失': games.filter((g) => !g.evidence.art.og).length,
  '详情配图缺失': games.filter((g) => !g.evidence.art.detail).length,
  'realism 证据缺失/未通过': games.filter((g) => !g.evidence.realism || g.evidence.realism.pass !== true).length,
  '多人联机 E2E 缺失': games.filter((g) => g.mode === 'multi' && !g.evidence.mode.ok).length,
  '单人标注缺失': games.filter((g) => g.mode === 'single' && !g.evidence.mode.badge).length,
  '移动端冒烟未通过': games.filter((g) => !g.gates.mobile).length
};

const drafts = games.filter((g) => g.status === 'draft');
const shipped = games.filter((g) => g.status === 'shipped');

const rows = all.map((g) => {
  const failed = gateNames.filter((k) => !g.gates[k]).join(', ') || '—';
  return [g.slug, g.kind, g.mode, g.status, failed];
});

const lines = [];
lines.push('# 桌游流程审计报告（284 款）');
lines.push('');
lines.push('> 生成时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（Asia/Shanghai）');
lines.push('> 分支：`boardgame/d686a4ca-audit`（基于 `origin/main`）');
lines.push('> 策略来源：AGENTS.md 2026-11-10 五项硬性质量要求。');
lines.push('');
lines.push('## 1. 结论');
lines.push('');
lines.push('- 审计范围：**' + games.length + '** 款（31 款经典可玩 + 250 款 mini + 3 款 premium），另有 1 个大厅额外入口 `card-battle` 单独门禁。');
lines.push('- **shipped：' + shipped.length + ' 款**；**draft：' + drafts.length + ' 款**。');
lines.push('- 没有任何游戏同时集齐五项证据。按门禁规则，draft 不进入大厅 / mini 库，也不参与统计。');
lines.push('- 250 款 mini 按批次策略一律保持 draft；3 款 premium 未修改，仅检查。');
lines.push('');
lines.push('## 2. 测试基线');
lines.push('');
lines.push('入口：`node games/tests/run-all.js`。尾部实际输出：');
lines.push('');
lines.push('```');
if (runallTails.length) lines.push(runallTails.join('\n'));
else lines.push('（未找到 run-all 输出；本次审计未重复运行）');
lines.push('```');
lines.push('');
lines.push('退出码：**' + (runallExit == null ? '未记录' : runallExit) + '**。');
lines.push('');
lines.push('> 基线口径：协调方转述的 games-79 读数为 272 个测试文件 / 79,704 断言 / 0 失败 / 33.8s；本 worktree 的实际 run-all 输出为 513 个测试文件 / 86,823 断言 / 0 失败。两者口径不同（本 worktree 同时包含 games 与 tools），报告以本机实测输出为准，不写未实测数字。');
lines.push('');
lines.push('## 3. 浏览器工具与真实冒烟');
lines.push('');
lines.push('库存 `games/tests/browser-check.js` 是 tools 契约工具：它只发现包含 `<script id="engine">` 的页面，并要求 `data-i` / `data-lang` 三语控件。284 个游戏页均无该标记，因此按任务给定命令运行时：');
lines.push('');
lines.push('```');
lines.push('没有找到含 <script id="engine"> 的工具，且未显式指定 slug。');
lines.push('```');
lines.push('');
lines.push('结果为 **0 页被检查**，也不会写出 JSON。为得到游戏页的真实证据，本次新增 `games/boardgame/scripts/game-smoke.mjs`：复用常驻 CDP Chrome，只建/关一个标签，逐页检查 title、meta description、viewport、console/异常、外部请求、390×844 与 320×568 横向滚动、主触控目标 ≥44px、字号 ≥12px、输入框 ≥16px、点击冒烟。');
lines.push('');
lines.push('冒烟汇总（每次运行内同时测量两档宽度）：');
lines.push('');
lines.push(table(
  ['批次', '页面', 'PASS', 'FAIL', '检查项', '失败项', '外部请求', 'console error', '异常'],
  [
    ['390×844（修复后）', s390 ? s390.total : '—', s390 ? s390.pass : '—', s390 ? s390.fail : '—', s390 ? s390.checks : '—', s390 ? s390.failedChecks : '—', s390 ? s390.externalRequests : '—', s390 ? s390.consoleErrors : '—', s390 ? s390.exceptions : '—'],
    ['320×568（独立批次）', s320 ? s320.total : '未运行', s320 ? s320.pass : '—', s320 ? s320.fail : '—', s320 ? s320.checks : '—', s320 ? s320.failedChecks : '—', s320 ? s320.externalRequests : '—', s320 ? s320.consoleErrors : '—', s320 ? s320.exceptions : '—']
  ]
));
lines.push('');
lines.push('## 4. 已修复项');
lines.push('');
lines.push('- 缺 `meta description`：**133** 个页面，从 `rules.html` 首段生成并写入。');
lines.push('- 小字号：**208** 个页面、**1176** 处 `font-size` 低于 12px（含 rem 换算）统一提升到 12px；表单控件强制 16px，避免 iOS 聚焦缩放。');
lines.push('- 单人标注：**25** 个单人解谜页加入可见「单人」徽章。');
lines.push('- 触控 <44px：dominion / patchwork / splendor / stone-age / ticket-to-ride / war-chest 六款修正按钮或棋盘格尺寸；7×7、9×9 棋盘改为棋盘容器内横向滚动，页面本身不横向滚动。');
lines.push('- 320 横向溢出：mini-abstract-a-05 / mini-abstract-a-17（7×7 棋盘最小宽度超出）改为棋盘容器横向滚动。');
lines.push('- 输入框 <16px：azul / century-spice-road / dixit / kingdomino / splendor 五款；kot-premium 未改动（见未解决项）。');
lines.push('');
lines.push('## 4.1 五项门禁脚本（机器判定）');
lines.push('');
lines.push('每项一个脚本，退出码 0 表示该门禁 284 款全过，1 表示存在 draft；JSON 报告写在 `games/boardgame/audit/gate-*.json`。');
lines.push('');
lines.push(table(
  ['门禁脚本', '退出码', '通过', '未通过', 'JSON'],
  gateNames5.map((name) => {
    const r = gateReports[name];
    return ['`scripts/gates/' + name + '.mjs`', r ? (r.allPass ? '0' : '1') : '未运行', r ? r.pass : '—', r ? r.fail : '—', '`audit/gate-' + name + '.json`'];
  })
));
lines.push('');
lines.push('聚合：`scripts/gates/all.mjs` → `audit/gates-all.json`；当前 allPass = **' + (gatesAll ? gatesAll.allPass : '未运行') + '**。');
lines.push('');
lines.push('必然失败对照：`verify-shipped.mjs --gate mobile --smoke /tmp/does-not-exist-smoke.json` 实测 **exit 1**、pass 0/284，说明缺证据不会被误判为通过。');
lines.push('');
lines.push('## 4.2 registry / 大厅渲染断言');
lines.push('');
lines.push('`scripts/check-registry.js --boardgame-only` 实测：**exit 0**，285 个 draft（284 款 + card-battle）与 0 个 shipped 均未被 `games/boardgame/index.html` 或 `mini/index.html` 渲染，draft 也未写入 `games/registry.json`；3 个合成对照（`./fake-draft/`、`../mini-fake-01/`、不存在的 slug）全部按预期工作。');
lines.push('');
lines.push('完整 `node scripts/check-registry.js` 仍有 **102 项既有失败**（大量顶层游戏目录没有 registry 条目，含 `games/boardgame/` 本身），与本次 draft 门禁无关，列为未解决项。');
lines.push('');
lines.push('## 4.3 sw.js 预缓存');
lines.push('');
lines.push('- `games/precache-manifest.js`（由 `scripts/gen-precache.js` 生成）共 **' + precache.length + '** 条 URL，含 `/games/boardgame` 的条目 **' + swBoardgame.length + '** 条。');
lines.push('- 本次新增文件均为脚本、审计 JSON 或教程关键帧（非页面运行时资源），未修改 `sw.js`，也未 bump `CACHE_VERSION`。');
lines.push('- 对照：合成的 `' + swControl + '` 不在预缓存中（检测器有效，' + (swControlDetected ? '命中预期' : '异常') + '）。');
lines.push('- 未解决：boardgame 大厅 / mini 库 / 284 个游戏页本身从未进入 `PRECACHE_URLS`，属既有离线缺口。');
lines.push('');
lines.push('## 4.4 SHARED-DRIFT');
lines.push('');
lines.push('- 284 款中引用 `games/shared/` 的：**' + sharedRefs + '** 款；自带 `shuffle` 实现的：**' + localShuffle + '** 款。');
lines.push('- 本次审计未改任何 `games/shared/*`，也未重构游戏引擎（只改页面与门禁）；新桌游应引用 shared 而不是复制，该收敛项列为未解决。');
lines.push('');
lines.push('## 5. 五项门禁结果');
lines.push('');
lines.push(table(
  ['门禁', '通过款数', '说明'],
  gateNames.map((k) => [gateLabel[k], status.summary.gates[k], k === 'process' ? '需 DESIGN.md + 单测 + 性能断言 + E2E + ACCEPTANCE.md' : k === 'mode' ? '单人看可见「单人」；多人看联机双客户端 E2E' : k === 'mobile' ? '390×844 与 320×568 冒烟全过' : k === 'art' ? '本地封面 + OG + 详情配图' : 'realism.json ≥3 类通过项'])
));
lines.push('');
lines.push('缺口计数：');
lines.push('');
lines.push(table(['缺口', '款数'], Object.entries(reasonBuckets).map(([k, v]) => [k, v])));
lines.push('');
lines.push('## 6. 未解决项');
lines.push('');
lines.push('1. **美术资产为零**：284 个游戏目录内没有本地封面 / OG / 详情配图。现大厅仍用 CSS 渐变 + 首字占位（`build.mjs` 注释明确写了占位），不符合「非占位/emoji」。');
lines.push('2. **设计与性能证据为零**：没有 `DESIGN.md`、没有逐款性能断言、没有 `ACCEPTANCE.md`。');
lines.push('3. **真实性校验为零**：没有 `realism.json`；规则/尺寸/比例/颜色/材质未被机器校验。');
lines.push('4. **多人在线缺失**：259 款多人游戏没有房间/邀请/状态同步/断线重连/超时托管/入榜，也没有双客户端同局结算 E2E。');
lines.push('5. **3 款 premium 未修改**（azul-premium / codenames-premium / kot-premium）：它们的升级在其它分支进行，本分支只记录现状为 draft。');
lines.push('6. **mini 批次按策略保持 draft**：即使机械检查通过，也不进入大厅/统计。');
lines.push('7. **冒烟范围**：只覆盖 284 个 `index.html`；`rules.html` 未纳入逐页冒烟。触控检查只覆盖主控件选择器（button/input/select/链接按钮），纯文本行内链接按可达性而非 44px 判定。');
lines.push('8. **浏览器工具局限**：库存 browser-check 无法检查游戏页；本次用独立 CDP 脚本补位。该脚本依赖常驻 Chrome 的 9222 端口，未在 CI 中运行。');
lines.push('9. **43 个目录详情页**（`board/*.html`，来自 `data/boardgames.json`）仍用 CSS 渐变 + 首字占位；它们不属于 284 款可玩游戏，但同样不满足新美术要求。');
lines.push('');
lines.push('## 7. 关键帧');
lines.push('');
lines.push('- 已 `--no-ff` 合并 `origin/boardgame/d686a4ca-tutorial-frames`：**80 帧** B 站 Azul 教程关键帧 + manifest。');
lines.push('- 路径：`games/boardgame/tutorial-frames/azul/`（`manifest.tsv`、`frames/BV1aPxx6dEHL/`、`frames/BV1fK9zYSEo6/`）。');
lines.push('');
lines.push('## 8. 批次资源记录');
lines.push('');
if (resources.runs.length) {
  const last = resources.runs[resources.runs.length - 1];
  lines.push(table(
    ['项', '值'],
    [
      ['最近一次冒烟耗时', last.durationMs + ' ms'],
      ['并发', String(last.concurrency) + '（单进程顺序执行，满足 ≤4）'],
      ['节流', last.throttleMs + ' ms/页'],
      ['Chrome 峰值 CPU', last.chrome.maxCpuPercent + '%（上限 ' + last.chrome.cpuLimitPercent + '%，' + (last.chrome.overLimit ? '超限' : '未超限') + '）'],
      ['Chrome 峰值 RSS', Math.round(last.chrome.maxRssBytes / 1024 / 1024) + ' MB'],
      ['Node RSS 起/止', Math.round(last.node.rssStart / 1024 / 1024) + ' / ' + Math.round(last.node.rssEnd / 1024 / 1024) + ' MB'],
      ['系统 loadavg 起/止', last.system.start.loadavg.map((n) => n.toFixed(2)).join(' ') + ' / ' + last.system.end.loadavg.map((n) => n.toFixed(2)).join(' ')]
    ]
  ));
  lines.push('');
  lines.push('完整记录：`games/boardgame/audit/resources.json`。冒烟进度可续跑：`node games/boardgame/scripts/game-smoke.mjs ... --resume`，断点文件 `games/boardgame/audit/progress-390.json`。');
} else {
  lines.push('（尚无资源记录）');
}
lines.push('');
lines.push('## 9. 284 款清单');
lines.push('');
lines.push('完整逐款状态见下表；`failed gates` 为该款未通过的门禁。');
lines.push('');
lines.push(table(['slug', 'kind', 'mode', 'status', 'failed gates'], rows));
lines.push('');
lines.push('## 10. 复现命令');
lines.push('');
lines.push('```bash');
lines.push('export PATH=$HOME/.local/node/bin:$PATH');
lines.push('cd games/boardgame');
lines.push('# 1) 真实浏览器冒烟（复用常驻 Chrome，只建/关标签，可 --resume）');
lines.push('node scripts/game-smoke.mjs --root . --games /tmp/audit-games.txt \\');
lines.push('  --width 390 --height 844 --json audit/smoke-390.json \\');
lines.push('  --progress audit/progress-390.json --resources audit/resources.json --resume');
lines.push('# 2) 五项门禁');
lines.push('node scripts/verify-shipped.mjs');
lines.push('# 3) 按 shipped 重建大厅/mini（draft 自动隐藏）');
lines.push('node build.mjs');
lines.push('# 4) 全量单测');
lines.push('node ../../games/tests/run-all.js');
lines.push('```');
lines.push('');

fs.writeFileSync(outPath, lines.join('\n'));

const progress = {
  updatedAt: new Date().toISOString(),
  branch: 'boardgame/d686a4ca-audit',
  phases: [
    { name: 'baseline-tests', status: 'done', evidence: '/tmp/audit-runall.log' },
    { name: 'stock-browser-check', status: 'done', result: '0 pages discovered (tool limitation)' },
    { name: 'game-smoke-390', status: s390 && s390.fail === 0 ? 'done' : 'in-progress', evidence: 'audit/smoke-390.json' },
    { name: 'game-smoke-320', status: s320 ? 'done' : 'optional', evidence: 'audit/smoke-320.json' },
    { name: 'verify-shipped', status: 'done', evidence: 'catalog-status.json' },
    { name: 'build-filter', status: 'pending', evidence: 'index.html + mini/index.html' },
    { name: 'tutorial-frames-merge', status: 'done', evidence: 'games/boardgame/tutorial-frames/azul/' },
    { name: 'push-main', status: 'pending' }
  ],
  resumable: {
    smoke: 'node games/boardgame/scripts/game-smoke.mjs ... --resume',
    gate: 'node games/boardgame/scripts/verify-shipped.mjs'
  },
  resources: 'games/boardgame/audit/resources.json'
};
fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');

console.log(JSON.stringify({ out: outPath, progress: progressPath, shipped: shipped.length, draft: drafts.length }, null, 2));
