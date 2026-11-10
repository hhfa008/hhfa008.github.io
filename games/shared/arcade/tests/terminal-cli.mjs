#!/usr/bin/env node
/* Arcade shared terminal-UI check.
 *
 * Drives one real arcade page in headless Chrome until the settlement panel is
 * reached, then asserts:
 *   (a) no pageerror during the run;
 *   (b) the settlement overlay is visible and its title is non-empty;
 *   (c) the "play again" button hides the overlay and resets the board.
 *
 * Usable as a CLI (called from every games/<slug>/test.js):
 *   node terminal-cli.mjs --slug 2048 [--root /path/to/repo]
 *   exit 0 = pass, 1 = fail, 77 = Chrome unavailable (skip)
 *
 * The page is served over a tiny static HTTP server because every arcade page
 * references /games/shared/... absolutely. No npm dependency: the CDP driver
 * is games/boardgame/tests/lib/browser.mjs (Node >= 22 WebSocket + fetch).
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allGames } from '../../../../tools/arcade/families.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const slug = arg('slug');
const ROOT = path.resolve(arg('root', DEFAULT_ROOT));
if (!slug) { console.error('usage: terminal-cli.mjs --slug <slug> [--root <repo>]'); process.exit(2); }

const game = allGames().find((g) => g.slug === slug);
if (!game) { console.error('unknown arcade slug: ' + slug); process.exit(2); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
      catch (e) { res.writeHead(400); res.end(); return; }
      const full = path.resolve(root, '.' + rel);
      if (!full.startsWith(root + path.sep) && full !== root) { res.writeHead(403); res.end(); return; }
      let file = full;
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      } catch (e) { res.writeHead(404); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function injectionSource(g) {
  let s = "try{localStorage.removeItem('arcade.lang');}catch(e){}";
  const family = g.family;
  if (family === 'slide-puzzle') {
    // deterministic near-solved shuffle is not required: we force the terminal
    // state below. Leave Math.random untouched.
  }
  if (family === 'lights-out') {
    s += "Math.random=function(){return 0;};";
  }
  if (family === 'reaction') {
    // reaction 有两种实现：老的裸 setInterval 和新的固定步长 rAF 累加器。
    // 两套都加速 50x：setInterval 间隔 /50，rAF 时间戳 ×50（真实帧率不变），
    // 这样 60s 一局在 ~1.2s 内跑完，且不会为了测试去改页面语义。
    s += "var __si=window.setInterval;window.setInterval=function(fn,ms){return __si(fn,Math.max(1,Math.floor((ms||16)/50)));};";
    s += "var __raf=window.requestAnimationFrame;window.requestAnimationFrame=function(cb){return __raf.call(window,function(ts){cb(ts*50);});};";
  }
  // Capture the page's live game state by wrapping ArcadeKit.create before the
  // page scripts run. Kitchen-sink approach: we do not change the page code.
  s += `
(function(){
  Object.defineProperty(window,'ArcadeKit',{
    configurable:true,
    get:function(){return this.__arcadeKitValue;},
    set:function(v){
      this.__arcadeKitValue=v;
      if(!v||typeof v.create!=='function'||v.__arcadeTestWrapped)return;
      v.__arcadeTestWrapped=true;
      var create=v.create;
      v.create=function(params){
        var core=create(params);
        window.__arcadeTest={core:core,state:null,ticks:0};
        var ng=core.newGame, act=core.act;
        core.newGame=function(){var st=ng.apply(core,arguments);window.__arcadeTest.state=st;return st;};
        core.act=function(st){var r=act.apply(core,arguments);if(r&&r.state)window.__arcadeTest.state=r.state;if(arguments[1]==='tick')window.__arcadeTest.ticks++;return r;};
        return core;
      };
    }
  });
})();`;
  return s;
}

async function waitReady(page, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 12000);
  while (Date.now() < deadline) {
    try {
      const ok = await page.evaluate('document.readyState==="complete" && !!document.getElementById("board") && !!document.getElementById("overlay")');
      if (ok) return true;
    } catch (e) { /* context swap while navigating */ }
    await sleep(80);
  }
  return false;
}

const PANEL_EXPR = `(function(){
  var el=document.getElementById('overlay');
  var t=document.getElementById('overlay-title');
  var b=document.getElementById('board');
  if(!el) return {missing:true,visible:false};
  var cs=getComputedStyle(el), r=el.getBoundingClientRect();
  var visible=!el.hasAttribute('hidden')&&!el.hidden&&cs.display!=='none'&&cs.visibility!=='hidden'&&r.height>0&&r.width>0;
  return {
    missing:false, visible:visible, hiddenAttr:el.hasAttribute('hidden'), hiddenProp:!!el.hidden,
    display:cs.display, height:Math.round(r.height*100)/100, width:Math.round(r.width*100)/100,
    offsetParent:!!el.offsetParent, title:t?t.textContent:null,
    board:b?b.innerHTML:null, score:document.getElementById('stat-score')?document.getElementById('stat-score').textContent:null,
    extra:document.getElementById('stat-extra')?document.getElementById('stat-extra').textContent:null
  };
})()`;

function visible(p) { return p && !p.missing && p.visible && String(p.title || '').trim() !== ''; }

const CLICK_EXPR = (sel) => `(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.click();return true;})()`;

function clickIndexExpr(selector, textFilter) {
  return `(function(){
    var list=document.querySelectorAll(${JSON.stringify(selector)});
    for(var i=0;i<list.length;i++){
      var el=list[i];
      ${textFilter ? `if(String(el.textContent||'').trim()!=='')continue;` : ''}
      el.click();
      return {clicked:i,total:list.length};
    }
    return {clicked:-1,total:list.length};
  })()`;
}

function pressScript(specs) {
  // specs: [[key,keyCode], ...] dispatched synchronously on document
  return `(function(){
    var specs=${JSON.stringify(specs)};
    for(var i=0;i<specs.length;i++){
      var e=new Event('keydown',{bubbles:true,cancelable:true});
      Object.defineProperty(e,'key',{value:specs[i][0]});
      Object.defineProperty(e,'keyCode',{value:specs[i][1]});
      Object.defineProperty(e,'which',{value:specs[i][1]});
      document.dispatchEvent(e);
    }
    return true;
  })()`;
}

/* 后台/前台语义检查：把 document.hidden 置真并派发 visibilitychange，等一段
 * 真实时间再恢复；隐藏期间 onStep 次数必须为 0，恢复后一段窗口的推进量要与
 * 前台同长度窗口相差 ≤1 步（不补帧）。
 * 推进量优先取 ticker 自己的 onStep 计数（游戏结束后仍继续走），没有 ticker
 * 的页面回落到 core.act('tick') 调用次数。 */
async function checkVisibilityOnce(page) {
  const read = () => page.evaluate(`(function(){
    var T=window.__arcadeTest;
    var TK=window.ArcadeTick&&typeof window.ArcadeTick.last==='function'?window.ArcadeTick.last():null;
    var ticks=(TK&&typeof TK.ticks==='function')?TK.ticks():(T&&typeof T.ticks==='number'?T.ticks:null);
    return {ticks:ticks,state:!!(T&&T.state)};
  })()`);
  const fakeHidden = (v) => page.evaluate(`(function(){
    try{
      Object.defineProperty(document,'hidden',{configurable:true,get:function(){return ${v};}});
      Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return '${v ? 'hidden' : 'visible'}';}});
    }catch(e){}
    document.dispatchEvent(new Event('visibilitychange'));
    return document.hidden;
  })()`);

  const t0 = await read();
  if (!t0 || typeof t0.ticks !== 'number') return { ok: false, reason: '没有 tick 计数（页面既没有 ticker 也没有 tick 动作）' };
  await sleep(500);
  const t1 = await read();
  const foreground = t1.ticks - t0.ticks;

  await fakeHidden(true);
  const t2 = await read();
  await sleep(800);
  const t3 = await read();
  const hiddenAdvance = t3.ticks - t2.ticks;

  await fakeHidden(false);
  await sleep(500);
  const t4 = await read();
  const afterResume = t4.ticks - t3.ticks;

  const diff = Math.abs(afterResume - foreground);
  const ok = foreground > 0 && hiddenAdvance === 0 && diff <= 1;
  return { ok, foreground, hiddenAdvance, afterResume, diff };
}

/* 同机常驻 Chrome 可能被其它测试抢占，单个 500ms 窗口偶发系统抖动会让两个
 * 窗口差 2 步。断言不放宽：最多重测一次，两次都不满足才算失败。 */
async function checkVisibility(page) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await checkVisibilityOnce(page);
    last.attempt = attempt;
    if (last.ok) return last;
  }
  return last;
}

async function forceTerminal(page, g) {
  const n = (g.params && (g.params.n || g.params.disks)) || 0;
  const family = g.family;
  if (family === 'slide2048') {
    return page.evaluate(`(function(){
      var T=window.__arcadeTest; if(!T||!T.state)return {ok:false,reason:'no-state'};
      var s=T.state, n=${n}, N=n*n, b=[];
      for(var i=0;i<N;i++){var r=Math.floor(i/n),c=i%n;b.push((r+c)%2?2:4);}
      s.board=b; s.over=true; s.won=false;
      Arcade.setLang(Arcade.lang());
      return {ok:true};
    })()`);
  }
  if (family === 'slide-puzzle') {
    return page.evaluate(`(function(){
      var T=window.__arcadeTest; if(!T||!T.state)return {ok:false,reason:'no-state'};
      var s=T.state, n=${n}, N=n*n, t=[];
      for(var i=1;i<N;i++)t.push(i); t.push(0);
      s.tiles=t; s.blank=N-1; s.won=true;
      Arcade.setLang(Arcade.lang());
      return {ok:true};
    })()`);
  }
  if (family === 'lights-out') {
    return page.evaluate(`(function(){
      var T=window.__arcadeTest; if(!T||!T.state)return {ok:false,reason:'no-state'};
      var s=T.state, n=${n}, N=n*n;
      s.lights=new Array(N).fill(0); s.won=true;
      Arcade.setLang(Arcade.lang());
      return {ok:true};
    })()`);
  }
  if (family === 'hanoi') {
    return page.evaluate(`(function(){
      var T=window.__arcadeTest; if(!T||!T.state)return {ok:false,reason:'no-state'};
      var s=T.state, d=${n}, peg=[];
      for(var v=d;v>=1;v--)peg.push(v);
      s.pegs=[[],[],peg]; s.won=true;
      Arcade.setLang(Arcade.lang());
      return {ok:true};
    })()`);
  }
  return { ok: false, reason: 'no forced terminal for ' + family };
}

/* memory-pairs 真驱动（上一版只对第一张卡空点，永远到不了结算）：
 *   1) 卡面图案：每张可揭示的卡一个 img.face，图案互不相同、图片已解码、
 *      背面时不可见；10 款都必须有 ≥6 种图案；
 *   2) 不匹配翻回：400ms 时两张仍可见、800ms 时两张已翻回、翻回后再点能翻开；
 *      毫秒数在页面侧用 performance.now() 记，避免 CDP 往返污染；
 *   3) 按引擎状态找对子，走真实 DOM click 打到结算；
 *   4) 结算/重开断言仍由 main() 统一执行。
 */
async function driveMemory(page, out) {
  let pre = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    pre = await page.evaluate(`(function(){
      var cards=[].slice.call(document.querySelectorAll('#board .card'));
      var faces=[], missing=[], distinct={}, downVisible=[];
      for(var i=0;i<cards.length;i++){
        var c=cards[i], img=c.querySelector('img.face');
        if(!img){missing.push(c.getAttribute('data-index'));continue;}
        var key=img.getAttribute('data-symbol')||'';
        faces.push({index:c.getAttribute('data-index'),key:key,src:img.getAttribute('src')||'',
                    nw:img.naturalWidth,nh:img.naturalHeight});
        distinct[key]=1;
        var cs=getComputedStyle(img);
        if(cs.visibility!=='hidden'&&parseFloat(cs.opacity)>0)downVisible.push(c.getAttribute('data-index'));
      }
      var T=window.__arcadeTest, s=T&&T.state;
      var N=s?s.cards.length:cards.length;
      var expected=(N%2===0)?N:N-1;
      var zero=faces.filter(function(f){return !(f.nw>0&&f.nh>0);});
      // 奇数盘面有一张配不上的填充牌（pair=-1，已 matched），它本来就没有图案；
      // 除它以外每张卡都必须有图案。
      var missingOk = missing.length === cards.length - expected;
      var fillerOk = missing.every(function(idx){
        var c=s&&s.cards[Number(idx)];
        return !!(c&&c.pair===-1&&c.matched);
      });
      return {cards:cards.length,expected:expected,faces:faces.length,
              distinct:Object.keys(distinct).length,missing:missing,
              zeroSize:zero.length,downVisible:downVisible,
              missingOk:missingOk,fillerOk:fillerOk,
              sample:faces.slice(0,4)};
    })()`);
    if (pre && pre.faces > 0 && pre.zeroSize === 0) break;
    await sleep(50);
  }
  const pairCount = Math.floor(((pre && pre.expected) || 0) / 2);
  const preOk = !!pre && pre.missingOk === true && pre.fillerOk === true &&
    pre.faces === pre.expected &&
    pre.distinct === pairCount && pre.distinct >= 6 && pre.zeroSize === 0 &&
    pre.downVisible.length === 0;
  out.action = { cardFaces: pre, precondition: preOk ? 'ok' : 'failed' };
  if (!preOk) {
    out.phase = 'precondition';
    out.panel = await page.evaluate(PANEL_EXPR);
    out.reason = '卡面图案不成立：' + JSON.stringify({
      cards: pre && pre.cards, expected: pre && pre.expected, faces: pre && pre.faces,
      distinct: pre && pre.distinct, missing: pre && pre.missing,
      zeroSize: pre && pre.zeroSize, downVisible: pre && pre.downVisible,
    });
    return out;
  }

  const timing = await page.evaluate(`(function(){
    return new Promise(function(resolve){
      var T=window.__arcadeTest, s=T&&T.state;
      if(!s)return resolve({ok:false,reason:'no-state'});
      var n=s.cards.length, pair=null;
      for(var i=0;i<n&&!pair;i++){
        for(var j=i+1;j<n;j++){
          if(!s.cards[i].matched&&!s.cards[j].matched&&!s.cards[i].up&&!s.cards[j].up&&s.cards[i].pair!==s.cards[j].pair){pair=[i,j];break;}
        }
      }
      if(!pair)return resolve({ok:false,reason:'no mismatched pair'});
      function el(k){return document.querySelector('#board .card[data-index="'+k+'"]');}
      function now(){return (window.performance&&performance.now)?performance.now():Date.now();}
      function snap(k){
        var c=el(k); if(!c)return {up:false,faceVisible:false,symbol:null};
        var img=c.querySelector('img.face');
        var cs=img?getComputedStyle(img):null;
        var visible=!!(img&&cs&&cs.visibility!=='hidden'&&parseFloat(cs.opacity)>0);
        return {up:c.classList.contains('up'),faceVisible:visible,symbol:img?img.getAttribute('data-symbol'):null};
      }
      function bothUp(){var a=snap(pair[0]),b=snap(pair[1]);return a.up&&b.up&&a.faceVisible&&b.faceVisible;}
      var first=el(pair[0]); if(!first)return resolve({ok:false,reason:'first card missing'});
      first.click();
      setTimeout(function(){
        var second=el(pair[1]); if(!second)return resolve({ok:false,reason:'second card missing'});
        var t0=now();
        second.click();
        var backAt=null, at200=null, at400=null, at800=null;
        var iv=setInterval(function(){
          // 只查 class，不在 8–16ms 轮询里做 getComputedStyle：那会拖慢页面计时器。
          var c0=el(pair[0]), c1=el(pair[1]);
          var up0=!!(c0&&c0.classList.contains('up')), up1=!!(c1&&c1.classList.contains('up'));
          if(backAt===null && !(up0&&up1)) backAt=now()-t0;
        },16);
        // 翻回动画期间连点同一张：必须被忽略，不能在翻回后又把它翻开。
        setTimeout(function(){
          var c0=el(pair[0]);
          if(c0){ c0.click(); c0.click(); }
          at200={t:Math.round(now()-t0),up0:snap(pair[0]).up,up1:snap(pair[1]).up};
        },200);
        setTimeout(function(){ var a=snap(pair[0]),b=snap(pair[1]); at400={t:Math.round(now()-t0),bothUp:bothUp(),bothDown:!a.up&&!b.up,snap0:a,snap1:b}; },400);
        setTimeout(function(){ var a=snap(pair[0]),b=snap(pair[1]); at800={t:Math.round(now()-t0),bothUp:bothUp(),bothDown:!a.up&&!b.up,snap0:a,snap1:b}; },800);
        setTimeout(function(){
          clearInterval(iv);
          var again=el(pair[0]); if(!again)return resolve({ok:false,reason:'reopen card missing'});
          again.click();
          setTimeout(function(){
            resolve({ok:true,pair:pair,flipBackMs:backAt===null?null:Math.round(backAt),at200:at200,at400:at400,at800:at800,reopen:snap(pair[0])});
          },80);
        },900);
      },30);
    });
  })()`);
  out.action.matchDelay = timing;

  const timingOk = !!timing && timing.ok === true &&
    timing.flipBackMs !== null && timing.flipBackMs >= 400 && timing.flipBackMs <= 800 &&
    timing.at200 && timing.at200.up0 === true && timing.at200.up1 === true &&
    timing.at400 && timing.at400.bothUp === true && timing.at400.t <= 550 &&
    timing.at800 && timing.at800.bothDown === true && timing.at800.t >= 750 &&
    timing.reopen && timing.reopen.up === true && timing.reopen.faceVisible === true;
  if (!timingOk) {
    out.phase = 'flip-back-timing';
    out.panel = await page.evaluate(PANEL_EXPR);
    out.reason = '不匹配翻回时间不符（要求 400–800ms，400ms 仍可见、800ms 已翻回、翻回后可再翻开）：' + JSON.stringify(timing);
    return out;
  }

  // 重开一局，用真实 DOM click 逐对消掉（匹配成功不触发翻回延迟）。
  await page.evaluate(CLICK_EXPR('#btn-new'));
  await sleep(120);
  for (let i = 0; i < 600; i++) {
    const p = await page.evaluate(PANEL_EXPR);
    if (visible(p)) return Object.assign(out, { phase: 'settlement', panel: p });
    const step = await page.evaluate(`(function(){
      var T=window.__arcadeTest, s=T&&T.state;
      if(!s)return {ok:false,reason:'no-state'};
      var n=s.cards.length, a=-1, b=-1;
      for(var i=0;i<n&&a<0;i++){
        if(s.cards[i].matched)continue;
        for(var j=i+1;j<n;j++){
          if(!s.cards[j].matched && s.cards[j].pair===s.cards[i].pair){a=i;b=j;break;}
        }
      }
      if(a<0)return {ok:false,reason:'no pair left'};
      var el=document.querySelector('#board .card[data-index="'+a+'"]');
      if(!el)return {ok:false,reason:'no card '+a};
      el.click();
      return {ok:true,a:a,b:b};
    })()`);
    if (!step || !step.ok) { out.reason = (step && step.reason) || '配对点击驱动失败'; break; }
    await sleep(12);
    const second = await page.evaluate(`(function(){
      var el=document.querySelector('#board .card[data-index="${step.b}"]');
      if(!el)return false;
      el.click(); return true;
    })()`);
    if (!second) { out.reason = '第二张卡 ' + step.b + ' 不存在'; break; }
    await sleep(12);
  }
  out.panel = await page.evaluate(PANEL_EXPR);
  out.phase = 'init';
  return out;
}

async function runDrive(page, g) {
  const family = g.family;
  const out = { slug: g.slug, family, phase: 'init', action: null, panel: null, replay: null };

  if (family === 'minesweeper') {
    for (let i = 0; i < 500; i++) {
      const p = await page.evaluate(PANEL_EXPR);
      if (visible(p)) return Object.assign(out, { phase: 'settlement', panel: p, action: { clicks: i } });
      // 用引擎状态找未翻开的格子，兼容不写 .revealed class 的页面（mines-7x7）。
      const r = await page.evaluate(`(function(){
        var T=window.__arcadeTest,s=T&&T.state;
        if(!s||!s.revealed)return {clicked:-1,reason:'no-state'};
        var i=s.revealed.indexOf(false);
        if(i<0)return {clicked:-1,reason:'all-revealed'};
        var el=document.querySelector('.cell[data-index="'+i+'"]');
        if(!el)return {clicked:-1,reason:'no-cell'};
        el.click(); return {clicked:i};
      })()`);
      if (r.clicked < 0) break;
      await sleep(8);
    }
    out.panel = await page.evaluate(PANEL_EXPR);
    return out;
  }

  if (family === 'tictactoe') {
    for (let i = 0; i < 400; i++) {
      const p = await page.evaluate(PANEL_EXPR);
      if (visible(p)) return Object.assign(out, { phase: 'settlement', panel: p, action: { clicks: i } });
      const r = await page.evaluate(clickIndexExpr('.cell', true));
      if (r.clicked < 0) break;
      await sleep(8);
    }
    out.panel = await page.evaluate(PANEL_EXPR);
    return out;
  }

  if (family === 'snake') {
    const keys = Array.from({ length: 60 }, () => ['ArrowDown', 40]);
    await page.evaluate(pressScript(keys));
    out.action = { keys: keys.length };
    // 每按一次方向键走一步；连续向下会撞底墙。轮询结算，不再固定 sleep(120)。
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      out.panel = await page.evaluate(PANEL_EXPR);
      if (visible(out.panel)) { out.phase = 'settlement'; return out; }
      await sleep(50);
    }
    if (game.params && game.params.wrap) {
      // wrap 模式不会撞墙；用引擎状态直接走结算路径（wrap 的缺陷不在移动）
      const f = await page.evaluate(`(function(){
        var T=window.__arcadeTest,s=T&&T.state;
        if(!s)return {ok:false,reason:'no-state'};
        s.alive=false; Arcade.setLang(Arcade.lang()); return {ok:true};
      })()`);
      out.action.wrapForced = f;
      await sleep(80);
      out.panel = await page.evaluate(PANEL_EXPR);
      if (visible(out.panel)) out.phase = 'settlement';
    }
    return out;
  }

  if (family === 'reaction') {
    // accelerated timer; poll up to ~8s real (>= 400s game time)
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const p = await page.evaluate(PANEL_EXPR);
      if (visible(p)) return Object.assign(out, { phase: 'settlement', panel: p, action: { waitedMs: 8000 - (deadline - Date.now()) } });
      await sleep(100);
    }
    out.panel = await page.evaluate(PANEL_EXPR);
    return out;
  }

  if (family === 'memory-pairs') {
    return driveMemory(page, out);
  }

  if (family === 'pong') {
    // 页面靠 rAF 固定步长推进到 7 分结算；这里轮询到结算面板可见为止。
    // （旧分支只 sleep 1.2s 且从不把 phase 置成 settlement，导致无论页面是否
    //  正确推进都必然判红——属于驱动缺失，见 reports/arcade-tick-2026-11-10.md）
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const p = await page.evaluate(PANEL_EXPR);
      if (visible(p)) return Object.assign(out, { phase: 'settlement', panel: p, action: { waitedMs: 30000 - (deadline - Date.now()) } });
      await sleep(100);
    }
    out.panel = await page.evaluate(PANEL_EXPR);
    out.reason = '30s 内未到结算（tick 未推进或推进过慢）';
    return out;
  }

  if (family === 'hanoi') {
    // normalized string contract must move a disk before we fast-forward.
    const before = await page.evaluate(`(function(){var T=window.__arcadeTest;return T&&T.state?{moves:T.state.moves}:null;})()`);
    await page.evaluate(pressScript([[' ', 32]]));
    await sleep(80);
    const after = await page.evaluate(`(function(){var T=window.__arcadeTest;return T&&T.state?{moves:T.state.moves}:null;})()`);
    out.action = { before, after };
    if (!before || !after || after.moves !== before.moves + 1) {
      out.phase = 'input-contract';
      out.panel = await page.evaluate(PANEL_EXPR);
      out.reason = '方向字符串没有移动盘片（[from,to] 契约未规范化）';
      return out;
    }
    const f = await forceTerminal(page, g);
    if (!f.ok) { out.phase = 'force'; out.reason = f.reason; out.panel = await page.evaluate(PANEL_EXPR); return out; }
    await sleep(80);
    out.phase = 'settlement';
    out.panel = await page.evaluate(PANEL_EXPR);
    return out;
  }

  if (family === 'slide2048' || family === 'slide-puzzle' || family === 'lights-out') {
    if (family === 'lights-out') {
      // 各变体 DOM 不同（.cell / .tile / .board-row + .tile），统一按 data-index 找灯格。
      const n = (g.params && g.params.n) || 3;
      const vis = await page.evaluate(`(function(){
        var cells=[].slice.call(document.querySelectorAll('#board [data-index]'));
        if(!cells.length)return {ok:false,reason:'no cells'};
        var visibleCells=cells.filter(function(c){var r=c.getBoundingClientRect();return r.width>0&&r.height>0;}).length;
        return {ok:visibleCells===cells.length&&cells.length===${n * n},cells:cells.length,visibleCells:visibleCells,expected:${n * n}};
      })()`);
      out.action = { boardCells: vis };
      if (!vis.ok) { out.phase = 'precondition'; out.panel = await page.evaluate(PANEL_EXPR); out.reason = '棋盘格子不可见或数量不对：' + vis.visibleCells + '/' + vis.cells + '（期望 ' + vis.expected + '）'; return out; }

      // 真输入：点中心格必须翻转它 + 四邻（不再只靠改状态强推结算）。
      const k = Math.floor((n * n) / 2);
      const readLights = () => page.evaluate(`(function(){var T=window.__arcadeTest;return T&&T.state?{lights:T.state.lights.slice(),moves:T.state.moves}:null;})()`);
      const beforeLights = await readLights();
      const clicked = await page.evaluate(`(function(){var el=document.querySelector('#board [data-index="${k}"]');if(!el)return false;el.click();return true;})()`);
      await sleep(60);
      const afterLights = await readLights();
      const expect = [k];
      if (k % n > 0) expect.push(k - 1);
      if (k % n < n - 1) expect.push(k + 1);
      if (k - n >= 0) expect.push(k - n);
      if (k + n < n * n) expect.push(k + n);
      const lightOk = clicked && beforeLights && afterLights &&
        expect.every(function (i) { return beforeLights.lights[i] !== afterLights.lights[i]; }) &&
        beforeLights.lights.every(function (v, i) { return expect.indexOf(i) >= 0 || v === afterLights.lights[i]; }) &&
        afterLights.moves === beforeLights.moves + 1;
      const toggled = beforeLights && afterLights ? beforeLights.lights.map(function (v, i) { return v !== afterLights.lights[i] ? i : -1; }).filter(function (i) { return i >= 0; }) : [];
      out.action.lightClick = { index: k, clicked: clicked, expectedToggled: expect, toggled: toggled, ok: lightOk };
      if (!lightOk) { out.phase = 'input-contract'; out.panel = await page.evaluate(PANEL_EXPR); out.reason = '点击灯格没有按十字翻转：' + JSON.stringify(out.action.lightClick); return out; }
    } else {
      // 真输入：方向键必须真的推进局面，然后才允许强推到结算看结算 UI。
      const readState = () => page.evaluate(`(function(){
        var T=window.__arcadeTest; if(!T||!T.state)return null;
        var s=T.state;
        return {moves:s.moves,blank:s.blank,board:s.board?s.board.join(','):null};
      })()`);
      const dirs = [['ArrowLeft', 37], ['ArrowRight', 39], ['ArrowUp', 38], ['ArrowDown', 40]];
      let keyMove = null;
      for (const [key, code] of dirs) {
        const before = await readState();
        await page.evaluate(pressScript([[key, code]]));
        await sleep(50);
        const after = await readState();
        if (before && after && (after.moves !== before.moves || after.blank !== before.blank || after.board !== before.board)) {
          keyMove = { key: key, before: before, after: after };
          break;
        }
      }
      out.action = out.action || {};
      out.action.keyMove = keyMove;
      if (!keyMove) { out.phase = 'input-contract'; out.panel = await page.evaluate(PANEL_EXPR); out.reason = '四个方向键都没有推进局面'; return out; }
    }
    const f = await forceTerminal(page, g);
    if (!f.ok) { out.phase = 'force'; out.reason = f.reason; out.panel = await page.evaluate(PANEL_EXPR); return out; }
    await sleep(80);
    out.phase = 'settlement';
    out.panel = await page.evaluate(PANEL_EXPR);
    return out;
  }

  out.reason = 'no driver for family ' + family;
  out.panel = await page.evaluate(PANEL_EXPR);
  return out;
}

async function main() {
  let chrome;
  try {
    chrome = await import(pathToFileURL(path.join(ROOT, 'games/boardgame/tests/lib/browser.mjs')).href);
    if (!chrome.findChrome()) { console.log('SKIP: Chrome not installed'); process.exit(77); }
  } catch (e) {
    console.log('SKIP: browser driver unavailable — ' + e.message);
    process.exit(77);
  }

  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;
  let result;
  try {
    result = await chrome.withChrome('about:blank', async (page) => {
      await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injectionSource(game) });
      await page.cdp.send('Page.navigate', { url: `${base}/games/${slug}/` });
      // 常驻 Chrome 复用标签页时，新标签可能处于后台：后台标签的 rAF 会被
      // 节流且 document.hidden=true，按真实语义 ticker 不推进。测试要驱动
      // 前台页面，先显式激活本标签；focus emulation 再把页面钉成 visible，
      // 避免同机其它浏览器测试抢占同一个常驻 Chrome 导致标签被置后。
      try { await page.cdp.send('Page.bringToFront'); } catch (e) { /* older Chrome */ }
      try { await page.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) { /* older Chrome */ }
      if (!await waitReady(page, 12000)) {
        return { slug, pass: false, phase: 'load', reason: 'page did not become ready', pageErrors: page.pageErrors.slice(), consoleErrors: page.consoleErrors.slice() };
      }
      const drive = await runDrive(page, game);
      const panel = drive.panel || await page.evaluate(PANEL_EXPR);
      const pageErrors = page.pageErrors.slice();
      const consoleErrors = page.consoleErrors.slice();
      const rec = {
        slug, family: game.family, phase: drive.phase, action: drive.action || null,
        pass: false, reason: drive.reason || '',
        panel: panel ? { visible: panel.visible, title: panel.title, hiddenAttr: panel.hiddenAttr, hiddenProp: panel.hiddenProp, height: panel.height, width: panel.width, offsetParent: panel.offsetParent } : null,
        pageErrors, consoleErrors,
      };

      if (drive.phase !== 'settlement') {
        rec.reason = rec.reason || ('未到结算：' + drive.phase);
        return rec;
      }
      if (pageErrors.length) { rec.reason = 'pageerror: ' + pageErrors[0]; return rec; }
      if (!visible(panel)) { rec.reason = '结算面板不可见或标题为空'; return rec; }

      // (c) replay: overlay must hide and the game state/board must reset
      const before = panel;
      const stateBefore = await page.evaluate('(function(){var T=window.__arcadeTest;return T&&T.state?JSON.stringify(T.state):null;})()');
      const clicked = await page.evaluate(CLICK_EXPR('#btn-overlay'));
      await sleep(150);
      const after = await page.evaluate(PANEL_EXPR);
      const stateAfter = await page.evaluate('(function(){var T=window.__arcadeTest;return T&&T.state?JSON.stringify(T.state):null;})()');
      const boardReset = !!(before.board != null && after.board != null && before.board !== after.board);
      const stateReset = !!(stateBefore && stateAfter && stateBefore !== stateAfter);
      rec.replay = {
        clicked, visibleAfter: after.visible, hiddenAfter: !after.visible,
        boardReset, stateReset, titleAfter: after.title,
      };
      if (!clicked) { rec.reason = '重开按钮不存在'; return rec; }
      if (after.visible) { rec.reason = '重开后遮罩仍然可见'; return rec; }
      if (!boardReset && !stateReset) { rec.reason = '重开后局面未重置（棋盘与状态都没变化）'; return rec; }

      // (d) 隐藏/恢复语义：隐藏期间不推进；恢复后推进量与前台的差 ≤1 步。
      // 只对 tick 驱动的 family 有意义（pong/反应类）；棋类/解谜类不是按 tick
      // 推进，没有可比较的「步」。
      if (game.family === 'pong' || game.family === 'reaction') {
        const vis = await checkVisibility(page);
        rec.visibility = vis;
        if (!vis.ok) { rec.reason = '隐藏/恢复语义不满足：' + JSON.stringify(vis); return rec; }
      }

      rec.pass = true;
      rec.title = panel.title;
      return rec;
    }, { width: 390, height: 844 });
  } finally {
    try { server.close(); } catch (e) { /* ignore */ }
  }

  console.log(JSON.stringify(result));
  const failures = result && result.pass ? 0 : 1;
  console.log(`RESULT: ${result && result.pass ? 1 : 0} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.log(JSON.stringify({ slug, pass: false, phase: 'exception', reason: e && e.message }));
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
});
