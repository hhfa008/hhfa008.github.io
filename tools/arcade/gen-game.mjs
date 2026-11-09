#!/usr/bin/env node
/* 本地模型游戏生成器（单款）——共享 kit 版。
 *
 *   node tools/arcade/gen-game.mjs --slug snake [--force] [--port 8082] [--attempts 2]
 *
 * 引擎来自 games/shared/arcade/kits/<family>.js（页面与测试共用，不交给模型）。
 * 本地模型只写：UI 接线（I18N + 渲染/输入）、棋盘 CSS、中文规则页。
 * 测试由 build-game.mjs 根据共享套件生成，必然与页面同源。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allGames } from './families.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARCADE = path.join(ROOT, 'games/shared/arcade');
const CONTRACT = fs.readFileSync(path.join(ARCADE, 'GAME_CONTRACT.md'), 'utf8');
const TEMPLATE = fs.readFileSync(path.join(ARCADE, 'templates/game.html'), 'utf8');
const RULES_REF = fs.readFileSync(path.join(ROOT, 'games/24game/rules.html'), 'utf8');
const STATE_PATH = path.join(ROOT, 'tools/arcade/state.json');
const NODE = process.execPath;

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

const slug = arg('slug');
if (!slug) {
  console.error('usage: gen-game.mjs --slug <slug> [--force] [--port 8082] [--attempts 2]');
  process.exit(2);
}
const entry = allGames().find((g) => g.slug === slug);
if (!entry) { console.error(`unknown slug: ${slug}`); process.exit(2); }

const PORT = Number(arg('port', '8082'));
const ATTEMPTS = Number(arg('attempts', '2'));
const dir = path.join(ROOT, 'games', slug);
const kitPath = path.join(ARCADE, 'kits', `${entry.family}.js`);
if (!fs.existsSync(kitPath)) { console.error(`kit missing: ${entry.family}`); process.exit(2); }
const KIT = fs.readFileSync(kitPath, 'utf8');
fs.mkdirSync(dir, { recursive: true });

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${slug}: ${msg}`); }
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } }
function saveState(patch) {
  const st = loadState();
  st[slug] = Object.assign({ updated: new Date().toISOString() }, st[slug] || {}, patch);
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
}

async function chat(prompt, maxTokens, temperature) {
  const body = {
    messages: [
      { role: 'system', content: 'You are a precise senior frontend engineer. Follow the contract exactly. Output only the requested code.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens || 8192,
    temperature: temperature == null ? 0.15 : temperature,
    chat_template_kwargs: { enable_thinking: false },
  };
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 600000);
      let res;
      try {
        res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
        });
      } finally { clearTimeout(timer); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error('empty completion');
      return stripFences(text);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`local model failed: ${last}`);
}

function stripFences(text) {
  const m = text.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : text;
}

function basePrompt() {
  return [
    '## 共享契约', CONTRACT,
    '## 页面模板（UI 会被插入 {{GAME_UI}}；CORE 已由模板创建）', TEMPLATE,
    '## 本游戏',
    `slug: ${entry.slug}\n名称: zh=${entry.zh} / en=${entry.en} / id=${entry.id}\n分类: ${entry.cat}`,
    `参数: ${JSON.stringify(entry.params)}\n状态契约: ${entry.state || ''}`,
    `state 顶层字段: ${JSON.stringify(entry.stateKeys || [])}\n动作契约: ${entry.actionSpec || ''}`,
    '## 本游戏的共享引擎（已存在，禁止重复输出或修改）', KIT,
  ].join('\n\n');
}

async function genUI(feedback) {
  const prompt = [
    basePrompt(),
    '## 任务',
    '写 I18N（en/zh/id 三语，键齐全）与 UI 接线：从 `var I18N = ...` 开始，到最后的 })(); 结束。',
    '要求：',
    '- 页面里已有 `var CORE = ArcadeKit.create(<参数>);`，直接使用 CORE，不要再输出 CORE 或 kit；',
    '- 用 #board 渲染；按钮/键盘/触控接线齐全；状态字段严格按上方引擎；',
    '- 状态可能是 playing / won / lost / draw：won 显示胜利遮罩，lost 显示失败，draw 显示平局；',
    '- 最高分 key 固定 arcade.' + slug + '.best，用 Arcade.best / Arcade.setBest；',
    '- 只用模板里已有的元素 id（#stat-score #stat-best #stat-extra #overlay #overlay-title #overlay-text #feedback #btn-new #btn-hint #btn-overlay #board）；',
    feedback ? '## 上一版的问题（必须修复）\n' + feedback : '',
    '只输出代码，不要解释、不要围栏。',
  ].filter(Boolean).join('\n\n');
  let ui = await chat(prompt, 12000, feedback ? 0.5 : 0.15);
  if (!ui.includes('var I18N')) {
    log('UI missing I18N, regenerating');
    ui = await chat(prompt + '\n\n## 严重错误\n输出必须以 `var I18N = {` 开头，并包含 en/zh/id 三套文案。', 12000, 0.5);
  }
  fs.writeFileSync(path.join(dir, '.ui.js'), ui + '\n');
  log(`UI ${ui.length} chars`);
  return ui;
}

async function genCSS() {
  const prompt = [
    basePrompt(),
    '## 任务',
    '写 GAME_CSS（只写本游戏棋盘内部样式，不要重复 arcade.css）。',
    '- 棋盘在 #board 内，390px 宽不横向溢出，深色模式可读；可点元素 ≥44×44；无外部资源；',
    '只输出 CSS，不要解释、不要围栏。',
  ].join('\n\n');
  const css = await chat(prompt, 4000);
  fs.writeFileSync(path.join(dir, '.game.css'), css + '\n');
  log(`GAME_CSS ${css.length} chars`);
  return css;
}

function build() {
  execFileSync(NODE, [
    path.join(ROOT, 'tools/arcade/build-game.mjs'),
    '--slug', slug,
    '--css', path.join(dir, '.game.css'),
    '--ui', path.join(dir, '.ui.js'),
  ], { stdio: 'pipe' });
}

function runTest() {
  try {
    const out = execFileSync(NODE, [path.join(dir, 'test.js')], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function cjkCount(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  return (text.match(/[一-鿿]/g) || []).length;
}
function validRules(html) {
  const n = cjkCount(html);
  const faq = (html.match(/"@type":\s*"Question"/g) || []).length;
  return n >= 1200 && n <= 2100 && faq >= 5 && /<\/html>\s*$/.test(html.trim());
}

async function genRules() {
  const prompt = [
    '## 参考页面（只参考 head / JSON-LD / 样式 / footer 结构，不要照抄内容）', RULES_REF,
    `## 任务\n写 games/${slug}/rules.html：中文规则页，**正文 1500–1900 个汉字（宁多勿少）**，<html lang="zh-CN">，` +
      '分 6 个 <h2> 小节（玩法、操作、规则细节、计分/胜负、策略、常见问题），每节至少 200 字；' +
      '含 Article 与 FAQPage JSON-LD（FAQ 页面条目与 JSON-LD 一一对应，≥6 条，每条答案 ≥60 字），单文件、内联样式、无外部请求，页尾有返回游戏与全部游戏链接。',
    `游戏：${entry.zh}。规格：${entry.spec}。参数：${JSON.stringify(entry.params)}。`,
    '不要编造排行榜、云存档、账号等功能；最高分只存本机 localStorage。',
    '只输出完整 HTML，不要解释、不要围栏。',
  ].join('\n\n');
  let html = await chat(prompt, 12000);
  fs.writeFileSync(path.join(dir, 'rules.html'), html + '\n');
  if (!validRules(html)) {
    log(`rules invalid (${cjkCount(html)} CJK), expanding`);
    const prompt2 = [
      '## 现有页面', html,
      `## 任务\n把正文扩写到 1500–1900 个汉字（当前 ${cjkCount(html)}），保留 head/JSON-LD/样式/footer，FAQ 与 JSON-LD 一一对应（≥6 条）。只输出完整 HTML。`,
    ].join('\n\n');
    html = await chat(prompt2, 14000);
    fs.writeFileSync(path.join(dir, 'rules.html'), html + '\n');
  }
  log(`rules.html ${cjkCount(html)} CJK`);
  return html;
}

function icon() {
  const iconPath = path.join(ROOT, 'games/assets/icons', `${slug}.svg`);
  if (fs.existsSync(iconPath)) return;
  const label = (entry.en.match(/[A-Za-z0-9]/g) || ['G']).slice(0, 2).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" role="img" aria-label="${entry.en}">
  <rect width="44" height="44" rx="9" fill="#2b2f36"/>
  <rect x="8" y="8" width="28" height="28" rx="7" fill="#e3b96b"/>
  <text x="22" y="27.5" font-family="Georgia, serif" font-size="13" font-weight="700" fill="#2b2f36" text-anchor="middle">${label}</text>
</svg>
`;
  fs.writeFileSync(iconPath, svg);
}

async function main() {
  const state = loadState();
  if (state[slug]?.status === 'done' && !flag('force')) { log('already done'); return; }
  saveState({ status: 'running', family: entry.family, attempts: 0 });
  icon();

  let ui = (flag('force') || !fs.existsSync(path.join(dir, '.ui.js')))
    ? await genUI(null)
    : fs.readFileSync(path.join(dir, '.ui.js'), 'utf8');

  if (flag('force') || !fs.existsSync(path.join(dir, '.game.css'))) await genCSS();

  let buildError = null;
  try { build(); } catch (e) { buildError = (e.stdout || '') + (e.stderr || '') + String(e.message || ''); }
  let attempt = 0;
  while (buildError && attempt < ATTEMPTS) {
    attempt++;
    log(`build failed, regenerating UI (${attempt}/${ATTEMPTS}): ` + buildError.split('\n').filter(Boolean).slice(-2).join(' | '));
    ui = await genUI(buildError.slice(0, 3000));
    try { build(); buildError = null; } catch (e) { buildError = (e.stdout || '') + (e.stderr || '') + String(e.message || ''); }
    saveState({ attempts: attempt });
  }
  if (buildError) {
    saveState({ status: 'failed', reason: 'build: ' + buildError.slice(0, 300) });
    throw new Error('build failed: ' + buildError.slice(0, 300));
  }

  const result = runTest();
  if (!result.ok) {
    saveState({ status: 'failed', reason: 'kit tests' });
    fs.writeFileSync(path.join(dir, '.test-failure.txt'), result.out);
    throw new Error('shared kit tests failed (kit bug)');
  }
  log(`tests pass: ${(result.out.match(/RESULT:.*/) || [''])[0]}`);

  if (flag('force') || !fs.existsSync(path.join(dir, 'rules.html')) || !validRules(fs.readFileSync(path.join(dir, 'rules.html'), 'utf8'))) {
    await genRules();
  }
  saveState({ status: 'done', reason: null });
  log('done');
}

main().catch((e) => {
  console.error(`[${slug}] FAILED: ${e.message}`);
  saveState({ status: 'failed', reason: e.message });
  process.exit(1);
});
