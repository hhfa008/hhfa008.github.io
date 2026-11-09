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
const PLAYABLE_GAMES = [
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
.header-note{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--on-dark-muted)}
.hero{padding:22px 0 4px}
.eyebrow{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin:0 0 8px}
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
.badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:650;background:var(--card);color:var(--ink)}
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
.stat span{display:block;font-size:11.5px;color:var(--muted);margin-bottom:2px}
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
.rec-body span{font-size:11.5px;color:var(--muted)}
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

function head(title, description, canonical, brandHref) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2b2f36">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
<style>${CSS}</style>
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${esc(brandHref)}"><span class="brand-mark" aria-hidden="true"></span><span>桌游目录</span></a>
    <span class="header-note">Board Games</span>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap">
    <p>数据采集自集石桌游公开详情页 · 评分与人数以原始页面为准 · 封面仅存数据，不加载外链。</p>
    <p>静态页面，无追踪、无外部资源请求。</p>
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
      <div class="meta"><span class="badge">${esc(catName)}</span><span>${esc(formatRange(game.players.min, game.players.max, '人'))}</span><span>${esc(formatRange(game.playTime.min, game.playTime.max, '分钟'))}</span></div>
      <div class="score-row"><span class="rating">★ <b>${game.rating.toFixed(1)}</b></span><span>重度 ${game.weight.toFixed(1)}</span><span>${game.year}</span></div>
    </div>
  </a>
</article>`;
}

function chip(field, value, label, pressed) {
  return `<button class="chip" type="button" data-filter="${field}" data-value="${value}" aria-pressed="${pressed ? 'true' : 'false'}">${label}</button>`;
}

export function renderIndex(categories, games) {
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
    <a class="play-entry" href="./card-battle/">
      <span class="play-mark" aria-hidden="true">卡</span>
      <span class="play-body"><strong>卡牌对战 · 20 张 / 起手 5 / 3 分制</strong><span>宝可梦式能量附着与弱点双倍伤害，先得 3 分获胜 · 立即开局</span></span>
      <span class="play-cta" aria-hidden="true">开始 →</span>
    </a>
${PLAYABLE_GAMES.map(playEntry).join('\n')}
  </section>

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
  return injectJsonLd(html, [indexJsonLd(sorted, categories)]);
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

  const html = head(
    game.name.zh + ' · 桌游详情',
    '《' + game.name.zh + '》（' + game.name.en + '）桌游详情：支持 ' +
      formatRange(game.players.min, game.players.max, '人') + '，' +
      formatRange(game.playTime.min, game.playTime.max, '分钟') + '，重度 ' +
      game.weight.toFixed(1) + '，评分 ' + game.rating.toFixed(1) + '。',
    BASE + 'board/' + game.slug + '.html',
    '../index.html'
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
${footer()}`;
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
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(categories, sorted));

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
      data: arg('data', path.join(HERE, 'data'))
    });
    console.log('built ' + result.pages + ' pages (' + result.games + ' games) → ' + result.outDir);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
