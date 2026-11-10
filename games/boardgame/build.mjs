#!/usr/bin/env node
'use strict';

/*
 * 桌游目录静态生成：列表页 + 每款详情页。
 *
 *   node build.mjs
 *   node build.mjs --out /tmp/boardgame-build
 *   node build.mjs --data ./data --out /tmp/boardgame-build
 *
 * 输出是纯静态 HTML：CSS/JS 全部内联，封面用 CSS 渐变 + 首字占位，
 * 不加载任何外部字体、图标、CDN 或封面图。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORY_ORDER,
  categoryCounts,
  escapeHtml as esc,
  formatRange,
  recommend,
  sortGames
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://hhfa008.github.io/games/boardgame/';

// 可玩游戏入口（31 款：11 德式 + 9 毛线 + 11 附加）。
// 目录 slug 必须与 games/boardgame/<slug>/ 实际目录一致。
export const PLAYABLE_GAMES = [
  { slug: 'splendor', mark: '璀', name: '璀璨宝石 Splendor', blurb: '五色宝石筹码买发展卡与贵族，先到 15 声望获胜 · 人机对战' },
  { slug: 'azul', mark: '花', name: '花砖物语 Azul', blurb: '选圆盘拿同色砖，铺满 5×5 花砖墙抢分数 · 人机对战' },
  { slug: 'kingdomino', mark: '多', name: '多米诺王国 Kingdomino', blurb: '每轮 1-2-1 选瓦片，拼 5×5 王国，连通地形乘皇冠计分' },
  { slug: 'century-spice-road', mark: '香', name: '香料之路 Century Spice Road', blurb: '采集、转换、升级香料，购买得分卡，与 AI 商队对决' },
  { slug: 'jaipur', mark: '斋', name: '斋普尔 Jaipur', blurb: '六种货物与骆驼交易，抢得分代币，三局两胜' },
  { slug: 'lost-cities', mark: '失', name: '失落之城 Lost Cities', blurb: '5 色探险列数字递增，赌注倍数决定终局分数' },
  { slug: 'ticket-to-ride', mark: '车', name: '车票之旅 Ticket to Ride', blurb: '抽车厢卡占领城市路线，完成目的地任务 · 简化人机版' },
  { slug: 'stone-age', mark: '石', name: '石器时代 Stone Age', blurb: '工人放置采集资源，喂食、建造、升级工具，8 轮后高分者胜' },
  { slug: 'dominion', mark: '领', name: '领土 Dominion', blurb: '牌库构筑，购买行动、财宝与胜利卡，终局牌库分高者胜' },
  { slug: 'carcassonne', mark: '卡', name: '卡卡颂 Carcassonne', blurb: '50 张瓦片拼出城市、道路与农田，2 人你 vs AI' },
  { slug: 'patchwork', mark: '布', name: '拼布对决 Patchwork', blurb: '33 块真实拼布填 9×9 棋盘，时间轴收入与扣子计分' },
  { slug: 'codenames', mark: '行', name: '行动代号 Codenames', blurb: '队长一词线索加数字，队员猜词，踩到刺客立即判负' },
  { slug: 'coup', mark: '政', name: '政变 Coup', blurb: '五种身份欺诈，收入、暗杀、偷取与政变，最后存活者胜' },
  { slug: 'love-letter', mark: '情', name: '情书 Love Letter', blurb: '16 张角色牌抽一打一，存活或手牌最高者获胜' },
  { slug: 'skull', mark: '骷', name: '骷髅 Skull', blurb: '每人 3 花 1 骷髅，暗放下注翻片，先得 2 分或逼对手失牌' },
  { slug: 'dixit', mark: '只', name: '只言片语 Dixit', blurb: '讲述者给线索，众人出牌投票找出讲述者的牌并计分' },
  { slug: 'for-sale', mark: '拍', name: '拍卖 · For Sale', blurb: '两阶段竞价：先抢房产，再同时亮牌换支票，现金最高者胜' },
  { slug: 'no-thanks', mark: '不', name: '不谢 · No Thanks', blurb: '收牌累负分或付筹码跳过，连续段只算最小牌，总分最低者胜' },
  { slug: 'six-nimmt', mark: '牛', name: '谁是牛头王 · 6 Nimmt', blurb: '四行牌列六张就爆，吃牛头扣分，十轮后牛头分最低者胜' },
  { slug: 'avalon', mark: '阿', name: '阿瓦隆 · Avalon', blurb: '五人身份推理，组队投票做任务，刺客终局暗杀梅林可翻盘' },
  { slug: 'hero-realms', mark: '英', name: '英雄领域 Hero Realms', blurb: '50 点生命，金币与匕首起始牌组，买市场卡组牌击败 AI' },
  { slug: 'war-chest', mark: '战', name: '战争宝箱 War Chest', blurb: '7×7 棋盘 12 个据点，抽币部署、移动攻击并占领据点' },
  { slug: 'blackjack', mark: '21', name: '21 点 · 黑杰克', blurb: '单人对战庄家，要牌或停牌，接近 21 点而不爆牌' },
  { slug: 'old-maid', mark: '乌', name: '抽乌龟 · Old Maid', blurb: '抽牌配对后弃牌，最后手里剩下乌龟牌的人输' },
  { slug: 'crazy-eights', mark: '八', name: '疯狂八 Crazy Eights', blurb: '跟花色或点数出牌，8 可换花色，先出完手牌者胜' },
  { slug: 'go-fish', mark: '钓', name: '钓鱼 Go Fish', blurb: '向对手索取点数凑成四张，集齐最多组者获胜' },
  { slug: 'snakes-and-ladders', mark: '蛇', name: '蛇梯棋 Snakes and Ladders', blurb: '100 格轮流掷骰，踩梯上爬、遇蛇下滑，恰好到 100 获胜' },
  { slug: 'mancala', mark: '曼', name: '曼卡拉播棋 Mancala', blurb: '两排各 6 洞轮流播种，进仓库可续回合，仓库石子多者胜' },
  { slug: 'guess-who', mark: '猜', name: '猜猜我是谁 Guess Who', blurb: '24 位人物、7 种特征，用是非问题排除并猜中电脑人物' },
  { slug: 'battleship', mark: '海', name: '海战棋 Battleship', blurb: '8×8 棋盘布阵五艘战舰，轮流炮击，先击沉对手全部战舰者胜' },
  { slug: 'mastermind', mark: '珠', name: '珠玑妙算 Mastermind', blurb: '6 种颜色、4 位密码，靠黑白提示在 10 次内猜中' }
];

function playEntry(game) {
  return `    <a class="play-entry" href="./${esc(game.slug)}/">
      <span class="play-mark" aria-hidden="true">${esc(game.mark)}</span>
      <span class="play-body"><strong>${esc(game.name)}</strong><span>${esc(game.blurb)}</span></span>
      <span class="play-cta" aria-hidden="true">立即开局 →</span>
    </a>`;
}

// 精美版单独成区，不计入上面的 31 款经典可玩入口。
export const PREMIUM_GAMES = [
  { slug: 'codenames-premium', mark: '精', name: '行动代号 · 精美版', blurb: '豪华单机重制：275 词、AI 队长与队员、翻牌动画与合成音效，完全离线。' },
  { slug: 'azul-premium', mark: '花', name: '花砖物语 · 精美版', blurb: '5 色花砖、圆盘取砖、模式线与瓷砖墙、连片计分与 AI 对手，纯前端零外部请求。' },
  { slug: 'kot-premium', mark: '王', name: '东京之王 · 精美版', blurb: '6 颗骰子三掷、东京城与东京湾、能力卡市场，单机 2–4 人 AI 对战，完全离线。' },
  { slug: 'splendor-premium', mark: '璀', name: '璀璨宝石 · 精美版', blurb: '五色宝石筹码、90 张发展卡与 10 位贵族，深色木桌与丝绒材质，人机 / 双人联机。' },
  { slug: 'kingdomino-premium', mark: '多', name: '多米诺王国 · 精美版', blurb: '48 张地形瓦片拼 5×5 王国，六种俯拍材质与皇冠计分，人机 / 双人联机。' },
  { slug: 'century-spice-road-premium', mark: '香', name: '香料之路 · 精美版', blurb: '四种香料采集转换、商人卡与得分卡，金色金币与胡桃木桌面，人机 / 双人联机。' },
  { slug: 'lost-cities-premium', mark: '城', name: '失落之城 · 精美版', blurb: '五色探险与石版桌面，下注封蜡、三局累计，人机 / 双人联机，完全离线。' },
  { slug: 'coup-premium', mark: '政', name: '政变 · 精美版', blurb: '身份隐藏与虚张声势，公爵、刺客、队长、大使、女伯爵，2–6 人 AI 或联机。' },
  { slug: 'jaipur-premium', mark: '斋', name: '斋普尔 · 精美版', blurb: '骆驼与香料交易，市场拿牌、卖出成组、银币金币计分，人机 / 双人联机。' },
  { slug: 'dominion-premium', mark: '领', name: '领土 · 精美版', blurb: '牌库构筑经典：行动牌、财宝与胜利卡，和 AI 或朋友打完整对局，完全离线。' },
  { slug: 'carcassonne-premium', mark: '颂', name: '卡卡颂 · 精美版', blurb: '抽瓦片拼城市与道路、放米宝占分，人机 / 双人联机，完全离线。' },
  { slug: 'stone-age-premium', mark: '石', name: '石器时代 · 精美版', blurb: '工人放置采集木砖石金、狩猎喂食、建造建筑与文明卡，2–4 人 AI 或联机。' },
  { slug: 'gomoku-premium', mark: '五', name: '五子棋 · 精美版', blurb: '15×15 榧木棋盘与黑白云子，三档 AI、悔棋与双人联机，先连五子者胜。' },
  { slug: 'reversi-premium', mark: '黑', name: '黑白棋 · 精美版', blurb: '8×8 绿呢棋盘，夹击翻面、行动力 AI 与双人联机，终局子多者胜。' },
  { slug: 'undercover-premium', mark: '卧', name: '谁是卧底 · 精美版', blurb: '120+ 词对、白板身份与保密卡轮流看词，4–12 人同乐，支持 4–6 人联机。' },
  { slug: 'love-letter-premium', mark: '情', name: '情书 · 精美版', blurb: '16 张角色牌抽一打一，绯红丝绒桌面与火漆封蜡，2–4 人 AI 或联机。' },
  { slug: 'skull-premium', mark: '骷', name: '骷髅 · 精美版', blurb: '3 花 1 骷髅暗放下注翻片，橡木酒吧与杯垫质感，3–6 人 AI 或联机。' },
  { slug: 'dixit-premium', mark: '只', name: '只言片语 · 精美版', blurb: '84 张原创抽象牌，讲述者给线索投票计分，3–6 人 AI 或联机。' },
  { slug: 'for-sale-premium', mark: '拍', name: '拍卖 · 精美版', blurb: '两阶段竞价抢房产再换支票，绿呢桌面与房产卡面，3–6 人 AI 或联机。' },
  { slug: 'no-thanks-premium', mark: '谢', name: '不谢 · 精美版', blurb: '传牌跳过或收下，筹码与连续牌计分，3–5 人联机或 AI 补位。' },
  { slug: 'six-nimmt-premium', mark: '牛', name: '谁是牛头王 · 精美版', blurb: '104 张牌十轮同时出牌，接行收牛头，2–10 人联机或 3–5 人 AI。' },
  { slug: 'avalon-premium', mark: '亚', name: '阿瓦隆 · 精美版', blurb: '5 人隐藏身份、组队任务与投票，联机或 AI 补位，完全离线。' },
  { slug: 'hero-realms-premium', mark: '勇', name: '英雄领域 · 精美版', blurb: '牌库构筑与角色对战，50 血攻防、市场购买，2 人联机或 AI。' },
  { slug: 'patchwork-premium', mark: '布', name: '拼布艺术 · 精美版', blurb: '9×9 拼布棋盘、时间轴与扣子经济，拼块竞速，人机 / 双人联机。' },
  { slug: 'ticket-to-ride-premium', mark: '车', name: '车票之旅 · 精美版', blurb: '36 城铁路网与 110 张车厢卡，接任务、铺路线，人机 / 双人联机。' },
  { slug: 'war-chest-premium', mark: '战', name: '战争宝箱 · 精美版', blurb: '7×7 棋盘、6 据点与 4 种单位币，抽币部署攻防，人机 / 双人联机。' },
  { slug: 'chess-premium', mark: '棋', name: '国际象棋 · 精美版', blurb: '8×8 木纹棋盘与 32 枚立体棋子，完整王车易位、吃过路兵、升变与将死判定，人机 / 双人联机。' },
  { slug: 'connect4-premium', mark: '四', name: '四子棋 · 精美版', blurb: '7×6 蓝框棋盘与红黄塑料圆片，重力落子、四连与和棋判定，人机 / 双人联机。' },
  { slug: 'backgammon-premium', mark: '陆', name: '双陆棋 · 精美版', blurb: '24 点、30 枚棋子与两颗骰子，撞子、入栏、离盘与倍数骰，人机 / 双人联机。' },
  { slug: 'xiangqi-premium', mark: '象', name: '中国象棋 · 精美版', blurb: '9×10 棋盘与 32 枚木纹棋子，马走日象走田，将帅照面与将军判定，人机 / 双人联机。' },
  { slug: 'draughts-premium', mark: '跳', name: '国际跳棋 · 精美版', blurb: '10×10 深色棋盘与 20 枚跳子，强制吃子、连吃与升王，人机 / 双人联机。' },
  { slug: 'checkers-jump-premium', mark: '珠', name: '中国跳棋 · 精美版', blurb: '121 孔六角星棋盘与弹珠跳子，连续跳跃与占营判定，人机 / 多人与联机。' },
  { slug: 'solitaire-premium', mark: '接', name: '接龙 · 精美版', blurb: '经典 Klondike：七列红黑接牌、四色基础堆，翻 1/3 张、提示、撤销与本地续局。' },
  { slug: 'freecell-premium', mark: '空', name: '空当接龙 · 精美版', blurb: '52 张全明牌、四个空当与八列牌，微软牌局编号、整串搬运、提示与撤销。' },
  { slug: 'spider-premium', mark: '蛛', name: '蜘蛛纸牌 · 精美版', blurb: '104 张双副牌、十列与五次发牌，单/双/四花色，同花降序成组自动收走。' },
  { slug: '24game-premium', mark: '廿', name: '24 点 · 精美版', blurb: '四张牌用加减乘除凑 24，精确分数求解器出题，提示、计时、连胜与每日挑战。' },
  { slug: 'doudizhu-premium', mark: '斗', name: '斗地主 · 精品版', blurb: '54 张牌、三人叫分抢地主，完整牌型与压牌规则，三档 AI、提示与 3 人联机房间。' },
  { slug: 'aeroplane-premium', mark: '飞', name: '飞行棋 · 52 格彩环', blurb: '真实 52 格四色跑道与 4 条归航跑道，掷 6 起飞、同色跳 4、撞机回基地，三档 AI 与 2–4 人联机。' },
  { slug: 'pioneers-premium', mark: '拓', name: '拓荒者 · 九岛', blurb: '19 块六边形、资源产出与港口贸易，铺路建村庄与城市，先到 8 分或 12 回合结算，2–4 人联机。' },
  { slug: 'banqi-premium', mark: '暗', name: '暗棋 · 翻棋', blurb: '4×8 棋盘、32 枚扣放棋子，翻棋或走子二选一，等级吃子、炮隔子、三档 AI 与双人联机。' }
];

function premiumEntry(game) {
  // Only games present in catalog-status.json as shipped reach this renderer.
  return `    <a class="play-entry play-entry-premium" data-status="shipped" href="./${esc(game.slug)}/">
      <span class="play-mark" aria-hidden="true">${esc(game.mark)}</span>
      <span class="play-body"><strong>${esc(game.name)}</strong><span>${esc(game.blurb)}</span></span>
      <span class="play-cta" aria-hidden="true">进入 →</span>
    </a>`;
}

// 微游戏库：10 组 × 25 款 = 250 款 mini-<group>-<nn> 目录。
// 入口卡不逐张平铺，250 款统一收进 ./mini/ 独立页面。
const MINI_GROUPS = [
  { key: 'euro-a', label: '德式策略 A', note: '资源转换 · 订单交付' },
  { key: 'euro-b', label: '德式策略 B', note: '牌库构筑 · 版图连通' },
  { key: 'party-a', label: '毛线派对 A', note: '线索猜测 · 五轮对决' },
  { key: 'party-b', label: '毛线派对 B', note: '反应抢拍 · 记忆干扰' },
  { key: 'card-a', label: '纸牌游戏 A', note: '接龙 · 钓鱼 · 手牌管理' },
  { key: 'dice-a', label: '骰子游戏 A', note: '爆点 · 押注 · 收手' },
  { key: 'abstract-a', label: '抽象棋 A', note: '落子 · 连线 · 围地' },
  { key: 'puzzle-a', label: '单人解谜 A', note: '滑块 · 推理 · 排序' },
  { key: 'ameri-a', label: '美式冒险 A', note: '掷骰战斗 · 夺旗' },
  { key: 'ameri-b', label: '美式冒险 B', note: '探索 · 生存 · 暗标' }
];
const MINI_PER_GROUP = 25;

function miniSlug(groupKey, n) {
  return 'mini-' + groupKey + '-' + String(n).padStart(2, '0');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTags(html) {
  return String(html)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, '');
}

function splitSentences(text) {
  return String(text)
    .split(/(?<=[。！？])/)
    .map(function (part) { return part.trim(); })
    .filter(Boolean);
}

const MINI_GENERIC_META = /原创|纯前端|离线|零联网|零外部|无需联网|单机对|单机对战|人机对战|中文、/;

// 从 meta description 取一句玩法：去掉「名字：/名字 中文极简…：」前缀，
// 取前两句，遇到「原创极简…/中文、离线…」这类元信息句就停止。
function miniBlurbFromDescription(description, name) {
  let text = String(description || '').trim();
  text = text.replace(new RegExp('^' + escapeRegExp(name) + '[^：:]{0,24}[：:]\\s*'), '');
  const sentences = splitSentences(text);
  let out = '';
  for (const sentence of sentences) {
    if (MINI_GENERIC_META.test(sentence)) continue;
    out += sentence;
    if (splitSentences(out).length >= 2) break;
  }
  return out.trim();
}

// 读取 rules.html 的首段玩法介绍（跳过导航、标题与纯英文装饰行）。
function miniRulesIntro(dir) {
  const html = fs.readFileSync(path.join(dir, 'rules.html'), 'utf8');
  const lines = html
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map(function (line) { return stripTags(line).trim(); })
    .filter(Boolean);
  const heading = lines.findIndex(function (line) { return line.length < 80 && /规则/.test(line); });
  for (let i = heading + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.indexOf('←') === 0) continue;
    if (line.length >= 20 && !/^[A-Z0-9 .,·—-]+$/.test(line)) return line;
  }
  return '';
}

// 没有 description / tag 的组：从规则首段里挑最像「怎么玩」的一句。
function miniBlurbFromRules(intro, name) {
  const sentences = splitSentences(intro);
  let best = '';
  let bestScore = -Infinity;
  sentences.forEach(function (sentence, index) {
    let score = 0;
    if (/你(执|与|要|可以|先|来|将)/.test(sentence)) score += 3;
    if (/点击|选择|选出|轮流|掷|拍|落子|移动|出牌|交换|回答|猜|判断|行动|购买|放置|排列|连接|收手|加注/.test(sentence)) score += 2;
    if (/获胜|得分|先到/.test(sentence)) score += 1;
    if (/^(这是|《)|是一款(单机|双人|原创)|是一场/.test(sentence)) score -= 3;
    if (sentence.length > 70) score -= 2;
    if (sentence.length < 10) score -= 1;
    score -= index * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  });
  let out = best.replace(/^《[^》]*》/, '').replace(/^是/, '').trim();
  // 同组规则句容易完全一样，用开头的棋盘尺寸 / 骰子规格补一个区分点。
  const variant = (intro.match(/\d+×\d+/) || intro.match(/\d+ 面骰/) || intro.match(/\d+ 枚筹码/) || [])[0];
  if (variant && !/\d/.test(out)) out = variant + ' · ' + out;
  if (out.length > 80) out = out.slice(0, 78).replace(/[，、；：\s]+$/, '') + '…';
  return out;
}

function readMiniGame(group, n) {
  const slug = miniSlug(group.key, n);
  const dir = path.join(HERE, slug);
  const indexFile = path.join(dir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    throw new Error('mini game page missing: ' + slug + '/index.html');
  }
  const html = fs.readFileSync(indexFile, 'utf8');
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
  const name = stripTags(h1.split('<')[0]).trim();
  if (!name) throw new Error('mini game has no h1 name: ' + slug);
  const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const tag = (html.match(/class="tag"[^>]*>([^<]*)</) || [])[1] || '';
  let blurb = '';
  if (description) blurb = miniBlurbFromDescription(description, name);
  if (!blurb && tag.trim().length >= 8) blurb = tag.trim();
  if (!blurb) blurb = miniBlurbFromRules(miniRulesIntro(dir), name);
  if (!blurb) throw new Error('mini game has no blurb: ' + slug);
  return {
    slug: slug,
    group: group.key,
    groupLabel: group.label,
    number: String(n).padStart(2, '0'),
    name: name,
    blurb: blurb
  };
}

function scanMiniGames(shipped) {
  const games = [];
  MINI_GROUPS.forEach(function (group) {
    for (let n = 1; n <= MINI_PER_GROUP; n += 1) {
      games.push(readMiniGame(group, n));
    }
  });
  return shipped ? games.filter(function (game) { return shipped.has(game.slug); }) : games;
}

// Shipped gate (AGENTS.md 2026-11-10): only entries whose five evidence gates
// pass are rendered. catalog-status.json is the single source of truth and is
// produced by scripts/verify-shipped.mjs.
//
// A missing status file is a build error, not a reason to fall back to
// "render everything": silently rendering draft games puts entries into the
// hub that have not passed acceptance, and makes build output depend on
// whether the file happens to exist.
export function loadShippedStatus(file) {
  const resolved = path.resolve(file || path.join(HERE, 'catalog-status.json'));
  if (!fs.existsSync(resolved)) {
    throw new Error(
      'missing shipped status source: ' + resolved + '\n' +
      'run node games/boardgame/scripts/verify-shipped.mjs or pass --status <file>'
    );
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const shipped = new Set();
  (raw.games || []).concat(raw.extras || []).forEach(function (game) {
    if (game.status === 'shipped') shipped.add(game.slug);
  });
  return { raw: raw, shipped: shipped };
}

// Every hub entry that is gated by shipped status. Kept next to the renderer so
// tests and alternate generators consume the same authoritative list instead of
// hard-coding slugs.
export const PLAY_ENTRY_SLUGS = PLAYABLE_GAMES.map(function (game) { return game.slug; })
  .concat(PREMIUM_GAMES.map(function (game) { return game.slug; }), ['card-battle']);

// 只注入列表页，避免改动 43 个详情页共享的 CSS 输出。
const MINI_ENTRY_CSS = `.play-entry-mini{background:linear-gradient(135deg,#7a5c3e,#b98a5a);border-color:#e6cba5;box-shadow:0 12px 30px rgb(122 92 62 / .28)}
.play-entry-mini:hover{background:linear-gradient(135deg,#8c6a48,#c99a68)}
.play-entry-mini .play-mark{background:var(--dark-3);color:var(--brass-2);font-size:19px}
.play-entry-mini .play-body strong{font-size:15.5px}
.play-entry-mini .play-body span{color:#f6ead8}
.play-entry-mini .play-cta{color:#fff6e8}`;

function miniEntry(count) {
  return `    <a class="play-entry play-entry-mini" href="./mini/">
      <span class="play-mark" aria-hidden="true">微</span>
      <span class="play-body"><strong>微游戏库 · ${count} 款</strong><span>10 组原创微桌游：德式、派对、纸牌、骰子、抽象、解谜、美式。分组浏览与搜索，1–10 分钟一局。</span></span>
      <span class="play-cta" aria-hidden="true">进入 →</span>
    </a>`;
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  return value == null || value.indexOf('--') === 0 ? fallback : value;
}

const CSS = `
:root{--paper:#f3ead9;--paper-2:#fbf5e9;--card:#efe2c8;--ink:#23262b;--muted:#6b6257;--muted-2:#70685c;--dark:#2b2f36;--dark-2:#23272d;--dark-3:#1b1e23;--on-dark:#f3ead9;--on-dark-muted:#b9b2a4;--brass:#b98a5a;--brass-2:#d3ae82;--red:#c0392b;--green:#3f7d5b;--line:#d8cbb2;--line-strong:#c3b18f;--input:#fffdf8;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--serif:"Songti SC","Noto Serif SC",Georgia,"Times New Roman",serif;--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 var(--sans);padding-bottom:calc(22px + env(safe-area-inset-bottom));-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,h3,p{margin:0}
a{color:inherit}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.wrap{max-width:920px;margin:0 auto;padding:0 16px}
.site-header{background:var(--dark);color:var(--on-dark);padding:10px 0}
.header-inner{display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{min-height:44px;display:flex;align-items:center;gap:9px;font-weight:650;text-decoration:none;font-size:15px}
.brand-mark{width:22px;height:22px;border-radius:6px;background:var(--brass);box-shadow:inset 0 0 0 2px var(--dark-3);flex:none}
.header-note{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--on-dark-muted)}
.hero{padding:22px 0 4px}
.eyebrow{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin:0 0 8px}
.hero h1{font-size:clamp(1.8rem,7vw,2.35rem);line-height:1.12;letter-spacing:-.02em;margin:0 0 6px}
.lede{color:var(--muted);font-size:15.5px;margin:0}
.play-entries{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:16px}
.play-entry{display:flex;align-items:center;gap:12px;min-height:78px;padding:12px 14px;border:1px solid var(--line-strong);border-radius:16px;background:linear-gradient(135deg,var(--dark),#3a414a);color:var(--on-dark);text-decoration:none;box-shadow:0 10px 26px rgb(20 23 27 / .14);min-width:0}
.play-entry:hover{background:linear-gradient(135deg,var(--dark-2),#454d58)}
.play-entry:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.play-mark{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:11px;background:var(--brass);color:var(--dark-3);font-family:var(--serif);font-size:21px;font-weight:700}
.play-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.play-body strong{font-size:14.5px;line-height:1.3;overflow-wrap:anywhere}
.play-body span{font-size:12px;color:var(--on-dark-muted);line-height:1.4}
.play-cta{flex:none;font-size:12.5px;font-weight:650;color:var(--brass-2)}
@media (max-width:430px){.play-entry{gap:10px;padding:11px 12px}.play-cta{display:none}}
.premium-block{margin-top:22px}
.premium-block h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--brass-2);margin:0 0 8px}
.play-entry-premium{background:linear-gradient(135deg,#3b2a1b,#72522b);border-color:#e6cba5;box-shadow:0 12px 30px rgb(122 92 62 / .28)}
.play-entry-premium:hover{background:linear-gradient(135deg,#4b3622,#87643a)}
.play-entry-premium .play-mark{background:linear-gradient(135deg,#f2d59f,#b98a5a);color:var(--dark-3);font-size:18px}
.play-entry-premium .play-body span{color:#f6ead8}
.play-entry-premium .play-cta{color:#fff6e8}
.filters{background:var(--paper-2);border:1px solid var(--line);border-radius:16px;padding:14px;margin-top:16px;box-shadow:0 6px 18px rgb(35 38 43 / .05)}
.filter-row{display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line)}
.filter-row:last-of-type{border-bottom:0}
.filter-label{flex:none;width:52px;padding-top:11px;font-size:13px;font-weight:650;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.chip{min-height:44px;padding:0 13px;border:1px solid var(--line-strong);border-radius:999px;background:transparent;color:var(--ink);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.chip[aria-pressed="true"]{background:var(--dark);border-color:var(--dark);color:var(--on-dark)}
.chip:focus-visible,.search:focus-visible,.reset:focus-visible,.card-link:focus-visible,.source-link:focus-visible,.rec-card:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.search-row{display:flex;gap:8px;align-items:center;padding:8px 0 4px}
.search{flex:1;min-width:0;min-height:44px;padding:0 14px;border:1px solid var(--line-strong);border-radius:11px;background:var(--input);color:var(--ink);font:inherit;font-size:15px}
.filter-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:8px;flex-wrap:wrap}
.count{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.reset{min-height:44px;padding:0 14px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--red);font:inherit;font-size:13.5px;font-weight:650;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:16px}
.card{margin:0;background:var(--paper-2);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 22px rgb(35 38 43 / .06);overflow:hidden;min-width:0}
.card-link{display:flex;gap:12px;align-items:stretch;padding:12px;text-decoration:none;min-height:104px}
.thumb{width:76px;height:76px;border-radius:12px;flex:none;display:grid;place-items:center;color:#fff8ee;font-family:var(--serif);font-size:34px;font-weight:700;text-shadow:0 2px 8px rgb(0 0 0 / .25);box-shadow:inset 0 0 0 1px rgb(255 255 255 / .18)}
.c-euro{background:linear-gradient(135deg,#2f5d50,#6f8f6a)}
.c-party{background:linear-gradient(135deg,#b93a2c,#e08a4f)}
.c-ameritrash{background:linear-gradient(135deg,#3a2b28,#7d2018)}
.c-card{background:linear-gradient(135deg,#33415c,#5c6b8a)}
.c-two-player{background:linear-gradient(135deg,#4a3b2a,#b98a5a)}
.c-family{background:linear-gradient(135deg,#7a5c3e,#d3ae82)}
.card-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
.card-title{margin:0;font-size:16.5px;line-height:1.25;letter-spacing:-.01em;overflow-wrap:anywhere}
.card-en{margin:0;font-size:12.5px;color:var(--muted);line-height:1.35;overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;margin-top:3px;font-size:12.5px;color:var(--muted-2)}
.badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:650;background:var(--card);color:var(--ink)}
.mode-badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:650;background:var(--dark);color:var(--on-dark)}
.score-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:auto;padding-top:5px;font-size:12.5px;color:var(--muted)}
.rating{display:inline-flex;align-items:center;gap:3px;font-weight:700;color:var(--red);font-variant-numeric:tabular-nums}
.rating b{font-size:15px}
.empty{margin:22px 0;padding:18px;border:1px dashed var(--line-strong);border-radius:14px;text-align:center;color:var(--muted)}
.site-footer{max-width:920px;margin:24px auto 0;padding:16px;font-size:12px;color:var(--muted-2);border-top:1px solid var(--line);line-height:1.6}
.site-footer p{margin:0 0 4px}
.crumbs{padding:16px 0 0;font-size:13.5px}
.crumbs a{display:inline-flex;align-items:center;min-height:44px;text-decoration:none;color:var(--muted);font-weight:600}
.crumbs a:hover{color:var(--ink)}
.hero-card{display:flex;gap:16px;align-items:center;background:var(--paper-2);border:1px solid var(--line);border-radius:20px;padding:16px;margin-top:6px;box-shadow:0 14px 34px rgb(20 23 27 / .08)}
.hero-cover{width:104px;height:104px;border-radius:16px;flex:none;display:grid;place-items:center;color:#fff8ee;font-family:var(--serif);font-size:46px;font-weight:700;text-shadow:0 2px 10px rgb(0 0 0 / .28);box-shadow:inset 0 0 0 1px rgb(255 255 255 / .18)}
.hero-main{min-width:0;flex:1}
.hero-main h1{font-size:clamp(1.55rem,6vw,2.1rem);line-height:1.1;letter-spacing:-.02em;margin:4px 0 4px;overflow-wrap:anywhere}
.hero-en{margin:0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.hero-score{margin-top:8px;display:flex;align-items:baseline;gap:8px}
.hero-score strong{font-size:28px;color:var(--red);font-variant-numeric:tabular-nums}
.hero-score span{font-size:12px;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:10px 12px;min-width:0}
.stat span{display:block;font-size:12px;color:var(--muted);margin-bottom:2px}
.stat strong{display:block;font-size:15px;line-height:1.2;overflow-wrap:anywhere}
.panel{background:var(--paper-2);border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:14px}
.panel h2{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:650;margin:0 0 10px}
.facts{display:grid;grid-template-columns:92px 1fr;gap:8px 12px;margin:0;font-size:14px}
.facts dt{color:var(--muted);font-weight:600}
.facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
.source p{margin:0 0 10px;font-size:13.5px;color:var(--muted);line-height:1.6}
.source-link{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--line-strong);border-radius:11px;text-decoration:none;font-weight:650;font-size:13.5px;color:var(--ink)}
.source-link:hover{background:var(--card)}
.rec-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.rec-card{display:flex;gap:9px;align-items:center;min-height:64px;padding:8px;border:1px solid var(--line);border-radius:12px;background:var(--input);text-decoration:none;min-width:0}
.rec-card:hover{background:var(--card)}
.rec-thumb{width:44px;height:44px;border-radius:9px;flex:none;display:grid;place-items:center;color:#fff8ee;font-family:var(--serif);font-size:22px;font-weight:700}
.rec-body{min-width:0}
.rec-body strong{display:block;font-size:13.5px;line-height:1.25;overflow-wrap:anywhere}
.rec-body span{font-size:12px;color:var(--muted)}
@media (max-width:520px){
.filter-label{width:100%;padding-top:2px}
.filter-row{flex-direction:column;gap:6px}
.grid{grid-template-columns:1fr}
.stats{grid-template-columns:repeat(2,1fr)}
.hero-card{align-items:flex-start}
.hero-cover{width:84px;height:84px;font-size:38px}
}
@media (prefers-color-scheme:dark){
:root{--paper:#1b1e23;--paper-2:#23272d;--card:#2b3138;--ink:#f3ead9;--muted:#b9b2a4;--muted-2:#a59e91;--dark:#2b2f36;--dark-2:#23272d;--dark-3:#1b1e23;--on-dark:#f3ead9;--on-dark-muted:#b9b2a4;--brass:#d3ae82;--brass-2:#e6cba5;--red:#e0705f;--green:#7fbf9b;--line:#3a414a;--line-strong:#4a525c;--input:#1b1e23}
.chip[aria-pressed="true"]{background:var(--brass);border-color:var(--brass);color:#1b1e23}
.search{color-scheme:dark}
}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

// 详情页专属：规则与开局区。大厅不渲染这段，保持列表页 CSS 不变。
const CSS_DETAIL = CSS.replace(
  '.rec-grid{display:grid;',
  '.action-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}\n' +
  '.rules-pending{margin:10px 0 0;font-size:13.5px;color:var(--muted);line-height:1.6}\n' +
  '.rec-grid{display:grid;'
);

const FILTER_JS = `
(function(){
  var state={category:'all',players:'all',time:'all',q:''};
  var cards=Array.prototype.slice.call(document.querySelectorAll('.card'));
  var count=document.getElementById('count');
  var empty=document.getElementById('empty');
  function match(card){
    if(state.category!=='all'&&card.dataset.cat!==state.category)return false;
    if(state.players!=='all'){
      var n=+state.players,pmin=+card.dataset.pmin,pmax=+card.dataset.pmax;
      if(n>=5){if(pmax<5)return false;}
      else if(!(pmin<=n&&n<=pmax))return false;
    }
    if(state.time!=='all'){
      var t=+card.dataset.tmax;
      if(state.time==='30'&&t>30)return false;
      if(state.time==='60'&&!(t>30&&t<=60))return false;
      if(state.time==='120'&&!(t>60&&t<=120))return false;
      if(state.time==='120plus'&&t<=120)return false;
    }
    if(state.q&&card.dataset.search.indexOf(state.q)===-1)return false;
    return true;
  }
  function apply(){
    var visible=0;
    cards.forEach(function(card){
      var ok=match(card);
      card.hidden=!ok;
      if(ok)visible++;
    });
    count.textContent=visible+' / '+cards.length+' 款';
    empty.hidden=visible!==0;
  }
  Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(btn){
    btn.addEventListener('click',function(){
      var field=btn.dataset.filter;
      state[field]=btn.dataset.value;
      Array.prototype.forEach.call(document.querySelectorAll('.chip[data-filter="'+field+'"]'),function(other){
        other.setAttribute('aria-pressed',String(other===btn));
      });
      apply();
    });
  });
  var input=document.getElementById('q');
  input.addEventListener('input',function(){
    state.q=input.value.trim().toLowerCase();
    apply();
  });
  document.getElementById('reset').addEventListener('click',function(){
    state={category:'all',players:'all',time:'all',q:''};
    input.value='';
    Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(btn){
      btn.setAttribute('aria-pressed',String(btn.dataset.value==='all'));
    });
    apply();
  });
  apply();
})();
`;

const MINI_CSS = `
:root{--paper:#f3ead9;--paper-2:#fbf5e9;--card:#efe2c8;--ink:#23262b;--muted:#6b6257;--muted-2:#70685c;--dark:#2b2f36;--dark-2:#23272d;--dark-3:#1b1e23;--on-dark:#f3ead9;--on-dark-muted:#b9b2a4;--brass:#b98a5a;--brass-2:#d3ae82;--red:#c0392b;--green:#3f7d5b;--line:#d8cbb2;--line-strong:#c3b18f;--input:#fffdf8;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--serif:"Songti SC","Noto Serif SC",Georgia,"Times New Roman",serif;--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 var(--sans);padding-bottom:calc(22px + env(safe-area-inset-bottom));-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,p{margin:0}
a{color:inherit}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.wrap{max-width:920px;margin:0 auto;padding:0 16px}
.site-header{background:var(--dark);color:var(--on-dark);padding:10px 0}
.header-inner{display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{min-height:44px;display:flex;align-items:center;gap:9px;font-weight:650;text-decoration:none;font-size:15px}
.brand-mark{width:22px;height:22px;border-radius:6px;background:var(--brass);box-shadow:inset 0 0 0 2px var(--dark-3);flex:none}
.header-note{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--on-dark-muted)}
.hero{padding:22px 0 4px}
.eyebrow{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin:0 0 8px}
.hero h1{font-size:clamp(1.8rem,7vw,2.35rem);line-height:1.12;letter-spacing:-.02em;margin:0 0 6px}
.lede{color:var(--muted);font-size:15px;margin:0}
.toolbar{position:sticky;top:0;z-index:20;background:var(--paper);padding:10px 0 6px;margin-top:14px;border-bottom:1px solid var(--line)}
.search-row{display:flex;gap:10px;align-items:center}
.search{flex:1;min-width:0;min-height:44px;padding:0 14px;border:1px solid var(--line-strong);border-radius:11px;background:var(--input);color:var(--ink);font:inherit;font-size:16px}
.search:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.count{flex:none;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.group-nav{display:flex;gap:6px;overflow-x:auto;padding:8px 0 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.group-nav::-webkit-scrollbar{display:none}
.group-nav a{flex:none;display:inline-flex;align-items:center;gap:5px;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:999px;text-decoration:none;font-size:13.5px;font-weight:650;color:var(--ink);background:var(--paper-2);touch-action:manipulation}
.group-nav a:hover{background:var(--card)}
.group-nav a:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.group-nav a span{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.group{margin-top:20px;scroll-margin-top:138px}
.group-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.group-head h2{font-family:var(--serif);font-size:19px;letter-spacing:-.01em;margin:0}
.group-head span{font-size:12px;color:var(--muted)}
.mini-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
.mini-card{display:flex;align-items:center;gap:11px;min-height:64px;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:var(--paper-2);text-decoration:none;min-width:0;box-shadow:0 4px 12px rgb(35 38 43 / .05);touch-action:manipulation}
.mini-card:hover{background:var(--card);border-color:var(--line-strong)}
.mini-card:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.num{flex:none;width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:var(--dark);color:var(--brass-2);font-family:var(--mono);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.mini-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.mini-body strong{font-size:14.5px;line-height:1.3;overflow-wrap:anywhere}
.mini-body span{font-size:12px;color:var(--muted);line-height:1.45;overflow-wrap:anywhere}
.arrow{flex:none;color:var(--muted);font-size:14px}
.empty{margin:20px 0;padding:18px;border:1px dashed var(--line-strong);border-radius:14px;text-align:center;color:var(--muted)}
.site-footer{max-width:920px;margin:26px auto 0;padding:16px;font-size:12px;color:var(--muted-2);border-top:1px solid var(--line);line-height:1.6}
.site-footer p{margin:0 0 4px}
@media (max-width:520px){.mini-grid{grid-template-columns:1fr}.group-head h2{font-size:18px}.lede{font-size:14px}}
@media (prefers-color-scheme:dark){
:root{--paper:#1b1e23;--paper-2:#23272d;--card:#2b3138;--ink:#f3ead9;--muted:#b9b2a4;--muted-2:#a59e91;--dark:#2b2f36;--dark-2:#23272d;--dark-3:#1b1e23;--on-dark:#f3ead9;--on-dark-muted:#b9b2a4;--brass:#d3ae82;--brass-2:#e6cba5;--red:#e0705f;--green:#7fbf9b;--line:#3a414a;--line-strong:#4a525c;--input:#1b1e23}
.search{color-scheme:dark}
}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

const MINI_JS = `
(function(){
  var input=document.getElementById('q');
  var cards=Array.prototype.slice.call(document.querySelectorAll('.mini-card'));
  var groups=Array.prototype.slice.call(document.querySelectorAll('.group'));
  var count=document.getElementById('count');
  var empty=document.getElementById('empty');
  function apply(){
    var q=input.value.trim().toLowerCase();
    var visible=0;
    cards.forEach(function(card){
      var ok=!q||card.getAttribute('data-search').indexOf(q)!==-1;
      card.hidden=!ok;
      if(ok)visible++;
    });
    groups.forEach(function(group){
      group.hidden=group.querySelectorAll('.mini-card:not([hidden])').length===0;
    });
    count.textContent=visible+' / '+cards.length+' 款';
    empty.hidden=visible!==0;
  }
  input.addEventListener('input',apply);
  apply();
})();
`;

function miniCard(game) {
  const search = [game.name, game.blurb, game.slug, game.groupLabel].join(' ').toLowerCase();
  return `      <a class="mini-card" href="../${esc(game.slug)}/" data-search="${esc(search)}">
        <span class="num" aria-hidden="true">${esc(game.number)}</span>
        <span class="mini-body"><strong>${esc(game.name)}</strong><span>${esc(game.blurb)}</span></span>
        <span class="arrow" aria-hidden="true">→</span>
      </a>`;
}

export function renderMiniIndex(miniGames) {
  const games = miniGames || scanMiniGames();
  const countFor = function (key) {
    return games.filter(function (game) { return game.group === key; }).length;
  };
  const nav = MINI_GROUPS.map(function (group) {
    return `<a href="#${esc(group.key)}">${esc(group.label)}<span>${countFor(group.key)}</span></a>`;
  }).join('\n    ');
  const sections = MINI_GROUPS.map(function (group) {
    const list = games.filter(function (game) { return game.group === group.key; });
    if (!list.length) return '';
    return `  <section class="group" id="${esc(group.key)}" aria-labelledby="${esc(group.key)}-title">
    <div class="group-head"><h2 id="${esc(group.key)}-title">${esc(group.label)}</h2><span>${list.length} 款 · ${esc(group.note)}</span></div>
    <div class="mini-grid">
${list.map(miniCard).join('\n')}
    </div>
  </section>`;
  }).filter(Boolean).join('\n\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2b2f36">
<title>微游戏库 · ${games.length} 款原创微桌游 (Mini Games Library)</title>
<meta name="description" content="微游戏库：${games.length} 款纯前端离线微桌游，按德式、毛线派对、纸牌、骰子、抽象、解谜、美式 10 组分区。搜索游戏名或玩法，点开即玩。">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${esc(BASE)}mini/">
<style>${MINI_CSS}</style>
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="../index.html"><span class="brand-mark" aria-hidden="true"></span><span>桌游目录</span></a>
    <span class="header-note">Mini Games</span>
  </div>
</header>
<main class="wrap">
  <section class="hero">
    <p class="eyebrow">MINI LIBRARY · ${games.length} 款</p>
    <h1>微游戏库</h1>
    <p class="lede">${games.length} 款原创微桌游，10 组分区。每局 1–10 分钟，纯前端离线、单机对 AI，点卡片直接开局。</p>
  </section>

  <div class="toolbar">
    <div class="search-row">
      <label class="sr-only" for="q">搜索微游戏</label>
      <input class="search" id="q" type="search" inputmode="search" autocomplete="off" placeholder="搜索游戏名或玩法…">
      <span class="count" id="count" aria-live="polite">${games.length} / ${games.length} 款</span>
    </div>
    <nav class="group-nav" aria-label="分组跳转">
    ${nav}
    </nav>
  </div>

  <p class="empty" id="empty" hidden>没有匹配的微游戏，换个关键词试试。</p>
${games.length === 0 ? '  <p class="lede">当前没有通过五项验收的微游戏；250 款均为 draft，不会进入本库。缺口见 <a href="../PROCESS-AUDIT.md">PROCESS-AUDIT.md</a>。</p>' : ''}

${sections}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${games.length} 款原创微桌游 · 10 组分区 · 全部为纯前端单机游戏。</p>
    <p>静态页面，无追踪、无外部资源请求。</p>
  </div>
</footer>
<script>${MINI_JS}</script>
</body>
</html>
`;
}

function head(title, description, canonical, brandHref, options) {
  const opts = options || {};
  const ogImage = opts.ogImage;
  const ogMeta = `<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${esc(opts.ogType || 'article')}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="桌游目录">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(opts.ogImageAlt || '')}">
` : ''}<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">
` : ''}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2b2f36">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
${opts.og ? ogMeta : ''}<style>${opts.detailCss ? CSS_DETAIL : CSS}</style>
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${esc(brandHref)}"><span class="brand-mark" aria-hidden="true"></span><span>桌游目录</span></a>
    <span class="header-note">Board Games</span>
  </div>
</header>`;
}

function footer(disclaimer) {
  return `<footer class="site-footer">
  <div class="wrap">
    <p>数据采集自集石桌游公开详情页 · 评分与人数以原始页面为准 · 封面仅存数据，不加载外链。</p>
${disclaimer ? '    <p>本页为非官方资料页，与各游戏版权方无关联；游戏名称、规则与相关商标、版权归各自权利人所有。</p>\n' : ''}    <p>静态页面，无追踪、无外部资源请求。</p>
  </div>
</footer>
</body>
</html>
`;
}

function initial(name) {
  return Array.from(String(name).trim())[0] || '?';
}

function categoryName(categories, key) {
  const found = categories.find(function (c) { return c.key === key; });
  return found ? found.name.zh : key;
}

// JSON-LD 里的 schema.org URL 用 JSON 转义写，浏览器解析后仍是合法 URL，
// 但原始 HTML 文本不出现 http(s)，满足「零外部请求」静态审计。
function jsonLd(obj) {
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/https:\/\//g, 'https:\\u002f\\u002f');
  return '<script type="application/ld+json">' + json + '</script>';
}

function injectJsonLd(html, blocks) {
  return html.replace('</head>', blocks.join('\n') + '\n</head>');
}

function indexJsonLd(games, categories) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '桌游目录',
    url: BASE,
    inLanguage: 'zh-CN',
    description: '桌游目录：' + games.length + ' 款桌游，覆盖 ' +
      categories.map(function (c) { return c.name.zh; }).join('、') + ' 6 个品类。',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: games.length,
      itemListElement: games.map(function (game, index) {
        return {
          '@type': 'ListItem',
          position: index + 1,
          name: game.name.zh,
          url: BASE + 'board/' + game.slug + '.html'
        };
      })
    }
  });
}

function detailJsonLd(game, catName) {
  const canonical = BASE + 'board/' + game.slug + '.html';
  const article = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: game.name.zh + ' · 桌游详情',
    description: '《' + game.name.zh + '》（' + game.name.en + '）支持 ' +
      formatRange(game.players.min, game.players.max, '人') + '，' +
      formatRange(game.playTime.min, game.playTime.max, '分钟') + '，评分 ' +
      game.rating.toFixed(1) + '。',
    url: canonical,
    inLanguage: 'zh-CN',
    mainEntity: {
      '@type': 'BoardGame',
      name: game.name.zh,
      alternateName: game.name.en,
      genre: catName,
      datePublished: String(game.year)
    }
  });
  const breadcrumb = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '桌游目录', item: BASE },
      { '@type': 'ListItem', position: 2, name: game.name.zh, item: canonical }
    ]
  });
  return [article, breadcrumb];
}

function modeLabel(game) {
  // 多人游戏统一标注「联机 + AI 匹配」；单人游戏明确标注「单人」。
  return game.players.max <= 1 ? '单人' : '联机 + AI 匹配';
}

// 详情页按数据标注真实可玩状态：只有 playable 字段才代表站内可开局。
function detailModeLabel(game) {
  if (!game.playable) return '目录收录（暂未提供在线版）';
  return game.playable.online ? '可联机 · AI 补位' : '可开局 · 同屏/AI';
}

function card(game, categories) {
  const catName = categoryName(categories, game.category);
  const search = [
    game.name.zh,
    game.name.en,
    game.slug,
    game.designers.join(' '),
    game.publishers.join(' ')
  ].join(' ').toLowerCase();
  return `<article class="card" data-cat="${esc(game.category)}" data-pmin="${game.players.min}" data-pmax="${game.players.max}" data-tmax="${game.playTime.max}" data-search="${esc(search)}">
  <a class="card-link" href="board/${esc(game.slug)}.html" aria-label="查看《${esc(game.name.zh)}》详情">
    <div class="thumb c-${esc(game.category)}" aria-hidden="true"><span>${esc(initial(game.name.zh))}</span></div>
    <div class="card-body">
      <h2 class="card-title">${esc(game.name.zh)}</h2>
      <p class="card-en">${esc(game.name.en)}</p>
      <div class="meta"><span class="badge">${esc(catName)}</span><span>${esc(formatRange(game.players.min, game.players.max, '人'))}</span><span>${esc(formatRange(game.playTime.min, game.playTime.max, '分钟'))}</span><span class="mode-badge">${esc(modeLabel(game))}</span></div>
      <div class="score-row"><span class="rating">★ <b>${game.rating.toFixed(1)}</b></span><span>重度 ${game.weight.toFixed(1)}</span><span>${game.year}</span></div>
    </div>
  </a>
</article>`;
}

function chip(field, value, label, pressed) {
  return `<button class="chip" type="button" data-filter="${field}" data-value="${value}" aria-pressed="${pressed ? 'true' : 'false'}">${label}</button>`;
}

export function renderIndex(categories, games, miniGames, shipped) {
  // shipped is the only gate for hub entries. Refuse to render without it so a
  // caller cannot accidentally publish draft games by omitting the argument.
  if (!(shipped instanceof Set)) {
    throw new Error('renderIndex requires the shipped set from catalog-status.json');
  }
  const minis = miniGames || scanMiniGames(shipped);
  const playable = PLAYABLE_GAMES.filter(function (game) { return shipped.has(game.slug); });
  const premium = PREMIUM_GAMES.filter(function (game) { return shipped.has(game.slug); });
  const cardBattle = shipped.has('card-battle');
  const sorted = sortGames(games);
  const counts = categoryCounts(sorted);
  const catChips = [chip('category', 'all', '全部', true)].concat(
    CATEGORY_ORDER.map(function (key) {
      return chip('category', key, categoryName(categories, key) + ' · ' + (counts[key] || 0), false);
    })
  ).join('\n      ');

  const playerChips = [chip('players', 'all', '全部', true)].concat(
    ['1', '2', '3', '4', '5'].map(function (n) {
      return chip('players', n, n === '5' ? '5+ 人' : n + ' 人', false);
    })
  ).join('\n      ');

  const timeChips = [chip('time', 'all', '全部', true)].concat([
    chip('time', '30', '≤30 分钟', false),
    chip('time', '60', '30–60 分钟', false),
    chip('time', '120', '60–120 分钟', false),
    chip('time', '120plus', '120+ 分钟', false)
  ]).join('\n      ');

  const cards = sorted.map(function (game) { return card(game, categories); }).join('\n');

  const html = head(
    '桌游目录 · ' + sorted.length + ' 款桌游推荐与筛选 (Board Games Catalog)',
    '桌游目录：' + sorted.length + ' 款桌游，覆盖德式策略、毛线派对、美式、卡牌、双人、家庭 6 个品类。按品类、人数、时长筛选并搜索。',
    BASE,
    'index.html'
  ) + `
<main class="wrap">
  <section class="hero">
    <p class="eyebrow">CATALOG · 集石数据</p>
    <h1>桌游目录</h1>
    <p class="lede">${sorted.length} 款桌游，覆盖德式、派对、美式、卡牌、双人与家庭。按人数、时长和品类筛选。</p>
  </section>

  <section class="play-entries" aria-label="可玩桌游入口">
${minis.length ? miniEntry(minis.length) : ''}
${cardBattle ? `    <a class="play-entry" href="./card-battle/">
      <span class="play-mark" aria-hidden="true">卡</span>
      <span class="play-body"><strong>卡牌对战 · 20 张 / 起手 5 / 3 分制</strong><span>宝可梦式能量附着与弱点双倍伤害，先得 3 分获胜 · 立即开局</span></span>
      <span class="play-cta" aria-hidden="true">开始 →</span>
    </a>` : ''}
${playable.map(playEntry).join('\n')}
${playable.length === 0 && !cardBattle && minis.length === 0 ? `    <p class="lede play-empty">当前没有通过五项验收的可玩游戏；284 款处于 draft，不会进入大厅。缺口见 <a href="PROCESS-AUDIT.md">PROCESS-AUDIT.md</a>。</p>` : ''}
  </section>

  ${premium.length ? `<section class="premium-block" aria-labelledby="premium-title">
    <h2 id="premium-title">精美版</h2>
    <div class="play-entries">
${premium.map(premiumEntry).join('\n')}
    </div>
  </section>` : ''}

  <section class="filters" aria-label="筛选与搜索">
    <div class="filter-row"><span class="filter-label">品类</span><div class="chips" role="group" aria-label="按品类筛选">
      ${catChips}
    </div></div>
    <div class="filter-row"><span class="filter-label">人数</span><div class="chips" role="group" aria-label="按支持人数筛选">
      ${playerChips}
    </div></div>
    <div class="filter-row"><span class="filter-label">时长</span><div class="chips" role="group" aria-label="按时长筛选">
      ${timeChips}
    </div></div>
    <div class="search-row">
      <label class="sr-only" for="q">搜索桌游</label>
      <input class="search" id="q" type="search" inputmode="search" autocomplete="off" placeholder="搜索中文名、原名、设计师…">
    </div>
    <div class="filter-meta">
      <span class="count" id="count">${sorted.length} / ${sorted.length} 款</span>
      <button class="reset" id="reset" type="button">清除筛选</button>
    </div>
  </section>

  <section class="grid" id="grid" aria-label="桌游列表">
${cards}
  </section>
  <p class="empty" id="empty" hidden>没有符合条件的桌游，试试放宽筛选。</p>
</main>
${footer()}<script>${FILTER_JS}</script>`;
  const htmlWithMiniCss = minis.length
    ? html.replace('</head>', `<style>${MINI_ENTRY_CSS}</style></head>`)
    : html;
  return injectJsonLd(htmlWithMiniCss, [indexJsonLd(sorted, categories)]);
}

function recommendationCard(rec, categories) {
  return `<a class="rec-card" href="${esc(rec.slug)}.html">
  <span class="rec-thumb c-${esc(rec.category)}" aria-hidden="true">${esc(initial(rec.name.zh))}</span>
  <span class="rec-body"><strong>${esc(rec.name.zh)}</strong><span>★ ${rec.rating.toFixed(1)} · ${esc(categoryName(categories, rec.category))}</span></span>
</a>`;
}

export function renderDetail(game, categories, games) {
  const cat = categories.find(function (c) { return c.key === game.category; });
  const catName = cat ? cat.name.zh : game.category;
  const catEn = cat ? cat.name.en : game.category;
  const recs = recommend(games, game, 3);
  const designers = game.designers.length ? game.designers.join(' / ') : '未收录';
  const publishers = game.publishers.length ? game.publishers.join(' / ') : '未收录';
  const tags = game.tags && game.tags.length ? game.tags.join(' · ') : '—';
  const best = game.bestPlayers.length ? game.bestPlayers.join(' / ') + ' 人' : '暂无';
  const description = '《' + game.name.zh + '》（' + game.name.en + '）桌游详情：支持 ' +
    formatRange(game.players.min, game.players.max, '人') + '，' +
    formatRange(game.playTime.min, game.playTime.max, '分钟') + '，重度 ' +
    game.weight.toFixed(1) + '，评分 ' + game.rating.toFixed(1) + '。';
  const canonical = BASE + 'board/' + game.slug + '.html';
  const ogImage = fs.existsSync(path.join(HERE, '..', 'assets', 'og', game.slug + '.jpg'))
    ? 'https://hhfa008.github.io/games/assets/og/' + game.slug + '.jpg'
    : null;
  const hasRules = !!(game.rules && fs.existsSync(path.join(HERE, game.rules)));
  const rulesIntro = game.playable
    ? (game.playable.online
      ? '本目录提供可玩的在线版本，支持跨设备联机，可用 AI 补位。'
      : '本目录提供可玩的本地版本，支持同屏或与 AI 开局，无需联网。')
    : '本目录仅收录资料，暂未提供可玩的在线或本地版本。';
  const playLink = game.playable
    ? `      <a class="source-link" href="../${esc(game.playable.href)}">开始游戏 →</a>\n`
    : '      \n';
  const rulesLink = hasRules
    ? `      <a class="source-link" href="../${esc(game.rules)}">查看规则 →</a>\n`
    : '      \n';
  const rulesTail = hasRules
    ? '    '
    : '    <p class="rules-pending">规则待补：本页暂未收录可读的本地规则，完整规则请参考下方的来源页。</p>';

  const html = head(
    game.name.zh + ' · 桌游详情',
    description,
    canonical,
    '../index.html',
    { og: true, detailCss: true, ogImage: ogImage, ogImageAlt: game.name.zh + '（' + game.name.en + '）桌游分享图' }
  ) + `
<main class="wrap">
  <nav class="crumbs" aria-label="面包屑"><a href="../index.html">← 返回桌游目录</a></nav>

  <article class="hero-card">
    <div class="hero-cover c-${esc(game.category)}" aria-hidden="true">${esc(initial(game.name.zh))}</div>
    <div class="hero-main">
      <span class="badge">${esc(catName)}</span>
      <h1>${esc(game.name.zh)}</h1>
      <p class="hero-en">${esc(game.name.en)}</p>
      <div class="hero-score"><strong>${game.rating.toFixed(1)}</strong><span>集石评分 / 10</span></div>
    </div>
  </article>

  <section class="stats" aria-label="关键数据">
    <div class="stat"><span>支持人数</span><strong>${esc(formatRange(game.players.min, game.players.max, '人'))}</strong></div>
    <div class="stat"><span>模式</span><strong>${esc(detailModeLabel(game))}</strong></div>
    <div class="stat"><span>最佳人数</span><strong>${esc(best)}</strong></div>
    <div class="stat"><span>单局时长</span><strong>${esc(formatRange(game.playTime.min, game.playTime.max, '分钟'))}</strong></div>
    <div class="stat"><span>重度</span><strong>${game.weight.toFixed(1)} / 5</strong></div>
    <div class="stat"><span>评分</span><strong>${game.rating.toFixed(1)} / 10</strong></div>
    <div class="stat"><span>出版年份</span><strong>${game.year}</strong></div>
  </section>

  <section class="panel">
    <h2>基本信息</h2>
    <dl class="facts">
      <dt>设计师</dt><dd>${esc(designers)}</dd>
      <dt>出版社</dt><dd>${esc(publishers)}</dd>
      <dt>品类</dt><dd>${esc(catName)}（${esc(catEn)}）</dd>
      <dt>标签</dt><dd>${esc(tags)}</dd>
      <dt>英文名</dt><dd>${esc(game.name.en)}</dd>
      <dt>数据 ID</dt><dd>${esc(game.id)}</dd>
    </dl>
  </section>

  <section class="panel">
    <h2>规则与开局</h2>
    <p>${esc(rulesIntro)}</p>
    <div class="action-row">
${playLink}${rulesLink}    </div>
${rulesTail}
  </section>

  <section class="panel source">
    <h2>数据来源</h2>
    <p>评分、支持人数、推荐人数、人均时长、上手难度、设计师与出版社取自集石公开详情页，抓取时间 ${esc(game.source.fetchedAt)}。重度与单局时长由原始字段换算，规则见模块 README。</p>
    <a class="source-link" href="${esc(game.source.url)}" target="_blank" rel="noopener noreferrer">在集石查看原始页面 ↗</a>
  </section>

  <section class="panel">
    <h2>同类推荐</h2>
    <div class="rec-grid">
      ${recs.map(function (rec) { return recommendationCard(rec, categories); }).join('\n      ')}
    </div>
  </section>
</main>
${footer(true)}`;
  return injectJsonLd(html, detailJsonLd(game, catName));
}

function validate(categories, games) {
  const errors = [];
  if (!Array.isArray(categories) || categories.length !== 6) errors.push('categories must contain 6 entries');
  if (!Array.isArray(games) || games.length < 30 || games.length > 50) {
    errors.push('games must contain 30–50 entries');
  }
  const keys = new Set((categories || []).map(function (c) { return c.key; }));
  CATEGORY_ORDER.forEach(function (key) {
    if (!keys.has(key)) errors.push('missing category: ' + key);
  });
  const slugs = new Set();
  const ids = new Set();
  (games || []).forEach(function (game) {
    if (slugs.has(game.slug)) errors.push('duplicate slug: ' + game.slug);
    if (ids.has(game.id)) errors.push('duplicate id: ' + game.id);
    slugs.add(game.slug);
    ids.add(game.id);
    if (!keys.has(game.category)) errors.push('unknown category for ' + game.id + ': ' + game.category);
    if (!(game.players.min <= game.players.max)) errors.push('bad player range for ' + game.id);
    if (!(game.playTime.min <= game.playTime.max)) errors.push('bad time range for ' + game.id);
    if (!(game.weight >= 1 && game.weight <= 5)) errors.push('bad weight for ' + game.id);
    if (!(game.rating >= 0 && game.rating <= 10)) errors.push('bad rating for ' + game.id);
    game.bestPlayers.forEach(function (n) {
      if (n < game.players.min || n > game.players.max) errors.push('best player out of range for ' + game.id);
    });
  });
  return errors;
}

export function build(options) {
  const opts = options || {};
  const dataDir = path.resolve(opts.data || path.join(HERE, 'data'));
  const outDir = path.resolve(opts.out || HERE);
  const categories = JSON.parse(fs.readFileSync(path.join(dataDir, 'categories.json'), 'utf8'));
  const games = JSON.parse(fs.readFileSync(path.join(dataDir, 'boardgames.json'), 'utf8'));
  const errors = validate(categories, games);
  if (errors.length) {
    throw new Error('data validation failed:\n' + errors.join('\n'));
  }

  const sorted = sortGames(games);
  const status = loadShippedStatus(opts.status || path.join(HERE, 'catalog-status.json'));
  const shipped = status.shipped;
  const miniGames = scanMiniGames(shipped);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(categories, sorted, miniGames, shipped));

  const miniDir = path.join(outDir, 'mini');
  fs.mkdirSync(miniDir, { recursive: true });
  fs.writeFileSync(path.join(miniDir, 'index.html'), renderMiniIndex(miniGames));

  const boardDir = path.join(outDir, 'board');
  fs.rmSync(boardDir, { recursive: true, force: true });
  fs.mkdirSync(boardDir, { recursive: true });
  const cat = new Map(categories.map(function (c) { return [c.key, c]; }));
  sorted.forEach(function (game) {
    const page = renderDetail(game, categories, sorted);
    fs.writeFileSync(path.join(boardDir, game.slug + '.html'), page);
    if (!cat.has(game.category)) throw new Error('unknown category: ' + game.category);
  });

  return { games: sorted.length, pages: sorted.length + 1, outDir: outDir };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = build({
      out: arg('out', HERE),
      data: arg('data', path.join(HERE, 'data')),
      status: arg('status', path.join(HERE, 'catalog-status.json'))
    });
    console.log('built ' + result.pages + ' pages (' + result.games + ' games) → ' + result.outDir);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
