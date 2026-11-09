#!/usr/bin/env node
'use strict';

/*
 * CDP smoke/acceptance test for the playable pages.
 *
 * Starts the local static server and drives every page at 390x844 and
 * 320x720 to check:
 *   - no console errors / uncaught exceptions / external requests
 *   - no horizontal overflow, touch targets >= 44px, dark background
 *   - card battle: draw / play / attach energy / attack / reset
 *   - mahjong: draw+discard, self-draw settlement
 *   - rooms: create, wrong password, correct password join
 *   - rewards: claim daily reward, reload persistence
 *
 * Uses the shared zero-dependency CDP helper in tests/lib/browser.mjs.
 * Run with: node games/boardgame/play/smoke.mjs
 */

import { startServer } from './serve.mjs';
import { findChrome, withChrome } from '../tests/lib/browser.mjs';

let passed = 0;
let failed = 0;
const failures = [];
let origin = '';

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS ' + label);
  } else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, 'got ' + a + ', want ' + e);
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function goto(page, path) {
  await page.cdp.send('Page.navigate', { url: origin + path });
  await sleep(700);
}

async function clickSelector(page, selector) {
  const clicked = await page.evaluate(
    '(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');' +
    'if(!el)return false;el.click();return true;})()'
  );
  await sleep(100);
  return clicked;
}

async function waitFor(page, expression, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 4000);
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return true;
    await sleep(60);
  }
  return false;
}

async function metricsAudit(page, label) {
  for (const width of [390, 320]) {
    const metrics = await page.metrics({ width: width, height: width === 390 ? 844 : 720 });
    ok(label + ' ' + width + 'px 无横向滚动',
      metrics.scrollWidth <= metrics.clientWidth + 1,
      'scrollWidth=' + metrics.scrollWidth + ', clientWidth=' + metrics.clientWidth);
    ok(label + ' ' + width + 'px 无越界元素',
      Array.isArray(metrics.overflow) && metrics.overflow.length === 0,
      JSON.stringify(metrics.overflow));
  }
  await page.metrics({ width: 390, height: 844 });
}

async function controlsAudit(page, label) {
  for (const width of [390, 320]) {
    await page.metrics({ width: width, height: width === 390 ? 844 : 720 });
    const small = await page.evaluate(
      '(function(){var out=[];' +
      'document.querySelectorAll("button,input,select,a").forEach(function(el){' +
      '  var r=el.getBoundingClientRect();' +
      '  if(r.width<1||r.height<1)return;' +
      '  var s=getComputedStyle(el);' +
      '  if(s.visibility==="hidden"||s.display==="none")return;' +
      '  if(r.width<44||r.height<44){' +
      '    out.push({tag:el.tagName,id:el.id||"",w:Math.round(r.width),h:Math.round(r.height)});' +
      '  }' +
      '});return out.slice(0,10);})()'
    );
    ok(label + ' ' + width + 'px 触控 ≥44', Array.isArray(small) && small.length === 0,
      JSON.stringify(small));
  }
  await page.metrics({ width: 390, height: 844 });
}

async function darkAudit(page, label) {
  await page.cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }]
  });
  await sleep(140);
  const bg = await page.evaluate('getComputedStyle(document.body).backgroundColor');
  await page.cdp.send('Emulation.setEmulatedMedia', { features: [] });
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg || '');
  const dark = match
    ? (Number(match[1]) + Number(match[2]) + Number(match[3])) / 3 < 90
    : false;
  ok(label + ' 深色背景生效', dark, bg);
}

function checkClean(page, label, consoleFrom, pageFrom) {
  const consoleErrors = page.consoleErrors.slice(consoleFrom);
  const pageErrors = page.pageErrors.slice(pageFrom);
  eq(label + ' 零 console error', consoleErrors, []);
  eq(label + ' 零未捕获异常', pageErrors, []);
}

async function readBattleState(page) {
  return page.evaluate('window.__battle && window.__battle.getState ? window.__battle.getState() : null');
}

async function waitForIdle(page) {
  return page.evaluate(
    '(async function(){var t=Date.now();' +
    'while(window.__battle&&window.__battle.isBusy()&&Date.now()-t<5000){' +
    'await new Promise(function(r){setTimeout(r,50);});}return true;})()'
  );
}

function hasBasic(hand) {
  return Array.isArray(hand) && hand.some(function (card) {
    return card.category === 'pokemon' && card.stage === 'basic';
  });
}

function findBasic(hand) {
  return (hand || []).find(function (card) {
    return card.category === 'pokemon' && card.stage === 'basic';
  }) || null;
}

function findEnergy(hand) {
  return (hand || []).find(function (card) { return card.category === 'energy'; }) || null;
}

function parsePoints(text) {
  const digits = String(text == null ? '' : text).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

async function installShareStub(page) {
  return page.evaluate(
    '(function(){window.__shareCalls=[];' +
    'var impl=function(data){window.__shareCalls.push(data);return Promise.resolve();};' +
    'try{Object.defineProperty(navigator,"share",{configurable:true,value:impl});}' +
    'catch(e){navigator.share=impl;}' +
    'return typeof navigator.share==="function";})()'
  );
}

async function retentionReadout(page, panelSelector) {
  const selector = JSON.stringify(panelSelector || '#result-panel');
  return page.evaluate(
    '(function(){var panel=document.querySelector(' + selector + ');' +
    'var p=document.getElementById("rr-points");' +
    'var l=document.getElementById("rr-level");' +
    'var s=document.getElementById("rr-streak");' +
    'var b=document.getElementById("rr-board");' +
    'var d=document.getElementById("rr-device");' +
    'var share=document.getElementById("rr-share");' +
    'var anti=document.getElementById("rr-anti");' +
    'return {visible:Boolean(panel&&!panel.hidden),' +
    'points:p?p.textContent:"",level:l?l.textContent:"",streak:s?s.textContent:"",' +
    'board:b?b.querySelectorAll("li").length:0,device:d?d.textContent:"",' +
    'share:Boolean(share),antiHidden:anti?anti.hidden:null};})()'
  );
}

async function retentionAudit(page, label, panelSelector) {
  const data = await retentionReadout(page, panelSelector);
  ok(label + ' 结果页出现', data.visible === true, JSON.stringify(data));
  ok(label + ' 显示本局积分', /^\+\d+$/.test(data.points), data.points);
  ok(label + ' 显示等级', /^\d+$/.test(data.level), data.level);
  ok(label + ' 显示连胜天数', /^\d+$/.test(data.streak), data.streak);
  ok(label + ' 显示本机排行榜记录', data.board >= 1, String(data.board));
  ok(label + ' 有分享战绩按钮', data.share === true);
  ok(label + ' 标注仅本机匿名记录', String(data.device).indexOf('仅本机匿名记录') !== -1, data.device);
  ok(label + ' 正常对局未被防作弊拦截', data.antiHidden === true, JSON.stringify(data));
}

/* ------------------------------------------------------------------ */
/* Page suites                                                        */
/* ------------------------------------------------------------------ */

async function indexSuite(page) {
  console.log('\n[index]');
  const consoleFrom = page.consoleErrors.length;
  const pageFrom = page.pageErrors.length;
  await goto(page, '/play/index.html');
  ok('入口页有四个可玩链接', await page.evaluate(
    'document.querySelectorAll("a.card").length === 4'
  ));
  eq('入口页零外部请求之外的资源', page.externalRequests.filter(function (url) {
    return !url.startsWith(origin) && !/^(data|blob|about|file):/.test(url);
  }), []);
  await metricsAudit(page, '入口');
  await controlsAudit(page, '入口');
  await darkAudit(page, '入口');
  checkClean(page, '入口', consoleFrom, pageFrom);
}

async function cardSuite(page) {
  console.log('\n[card-battle]');
  const consoleFrom = page.consoleErrors.length;
  const pageFrom = page.pageErrors.length;
  await goto(page, '/play/card-battle.html');

  ok('页面加载并暴露 __battle', await page.evaluate('Boolean(window.__battle)'));
  const initial = await readBattleState(page);
  ok('初始状态可读', Boolean(initial && initial.players && initial.players.length === 2));
  if (!initial) return;
  eq('初始手牌 7', initial.players[0].hand.length, 7);
  eq('初始奖赏 6', initial.players[0].prizes.length, 6);
  eq('初始牌库 47', initial.players[0].deck.length, 47);
  await metricsAudit(page, '卡牌');
  await page.metrics({ width: 390, height: 844 });

  const beforeDraw = await readBattleState(page);
  const clickedDraw = await clickSelector(page, '#btn-draw');
  const afterDraw = await readBattleState(page);
  ok('点击「抽牌」生效', clickedDraw && afterDraw.players[0].hand.length === beforeDraw.players[0].hand.length + 1,
    'hand ' + beforeDraw.players[0].hand.length + ' -> ' + (afterDraw && afterDraw.players[0].hand.length));
  ok('抽牌后牌库 -1', afterDraw.players[0].deck.length === beforeDraw.players[0].deck.length - 1,
    'deck ' + beforeDraw.players[0].deck.length + ' -> ' + afterDraw.players[0].deck.length);

  let state = await readBattleState(page);
  for (let i = 0; i < 12 && !hasBasic(state.players[0].hand); i += 1) {
    await clickSelector(page, '#btn-draw');
    state = await readBattleState(page);
  }
  const basic = findBasic(state.players[0].hand);
  ok('手牌中找到基础宝可梦', Boolean(basic));
  if (basic) {
    const cardSelector = '#my-hand .card[data-card-id="' + basic.id + '"][data-stage="basic"]';
    const selected = await clickSelector(page, cardSelector);
    ok('点击手牌可选中', selected);
    const played = await clickSelector(page, '#btn-active');
    state = await readBattleState(page);
    ok('点击「出战」后出战区出现该卡',
      played && state.players[0].active && state.players[0].active.id === basic.id,
      state.players[0].active ? state.players[0].active.id : 'null');
  }

  state = await readBattleState(page);
  for (let i = 0; i < 12 && !findEnergy(state.players[0].hand); i += 1) {
    await clickSelector(page, '#btn-draw');
    state = await readBattleState(page);
  }
  const energy = findEnergy(state.players[0].hand);
  const energyBefore = state.players[0].active ? state.players[0].active.energies.length : -1;
  ok('手牌中找到能量卡', Boolean(energy));
  if (energy && state.players[0].active) {
    await clickSelector(page, '#my-hand .card[data-card-id="' + energy.id + '"]');
    const attached = await clickSelector(page, '#btn-energy');
    state = await readBattleState(page);
    ok('点击「附着能量」后能量 +1',
      attached && state.players[0].active.energies.length === energyBefore + 1,
      'energies ' + energyBefore + ' -> ' + (state.players[0].active ? state.players[0].active.energies.length : 'n/a'));
  }

  state = await readBattleState(page);
  let attacked = false;
  let attackLog = [];
  for (let turn = 0; turn < 10 && !attacked; turn += 1) {
    state = await readBattleState(page);
    if (!state || state.status !== 'active') break;
    if (state.currentPlayer !== 0) {
      await waitForIdle(page);
      state = await readBattleState(page);
    }
    if (!state.players[0].active) {
      const replacement = findBasic(state.players[0].hand);
      if (replacement) {
        await clickSelector(page, '#my-hand .card[data-card-id="' + replacement.id + '"]');
        await clickSelector(page, '#btn-active');
        state = await readBattleState(page);
      }
    }
    if (state.players[0].active && state.players[0].active.energies.length === 0) {
      const fuel = findEnergy(state.players[0].hand);
      if (fuel) {
        await clickSelector(page, '#my-hand .card[data-card-id="' + fuel.id + '"]');
        await clickSelector(page, '#btn-energy');
      }
    }
    const beforeLog = state.log.length;
    const hasAttackButton = await page.evaluate(
      'Boolean(document.querySelector("#attacks button[data-index]:not([disabled])"))'
    );
    if (hasAttackButton) {
      await clickSelector(page, '#attacks button[data-index]:not([disabled])');
      const after = await readBattleState(page);
      attackLog = after.log.slice(beforeLog);
      attacked = attackLog.some(function (entry) {
        return entry.type === 'attack' && entry.damage > 0;
      });
      ok('点击招式后产生攻击/伤害日志', attacked, JSON.stringify(attackLog).slice(0, 200));
    } else {
      await clickSelector(page, '#btn-end');
      await waitForIdle(page);
    }
  }
  if (!attacked) ok('点击招式后产生攻击/伤害日志', false, '10 回合内没有可用招式');

  const pressedBefore = await page.evaluate('document.querySelector("#btn-sound").getAttribute("aria-pressed")');
  await clickSelector(page, '#btn-sound');
  const pressedAfter = await page.evaluate('document.querySelector("#btn-sound").getAttribute("aria-pressed")');
  ok('音效开关可切换', pressedBefore !== pressedAfter, pressedBefore + ' -> ' + pressedAfter);
  await clickSelector(page, '#btn-sound');

  await clickSelector(page, '#btn-reset');
  await sleep(250);
  const resetState = await readBattleState(page);
  ok('重置后手牌回到 7', resetState && resetState.players[0].hand.length === 7,
    resetState ? String(resetState.players[0].hand.length) : 'null');
  ok('重置后出战区为空', resetState && !resetState.players[0].active);

  ok('navigator.share 可用（stub）', await installShareStub(page));
  const finished = await page.evaluate(
    'window.__battle.finishForTest("win", ' +
    '{durationMs: 60000, turns: 12, actions: 40, remainingPrizes: 2})'
  );
  await sleep(250);
  ok('卡牌结束记录成功', finished && finished.ok === true && finished.duplicate === false,
    JSON.stringify(finished && { duplicate: finished.duplicate, flagged: finished.flagged }));
  await retentionAudit(page, '卡牌', '#result-panel');
  await clickSelector(page, '#rr-share');
  await sleep(200);
  const shareCalls = await page.evaluate('window.__shareCalls.length');
  ok('卡牌分享按钮调用 navigator.share', shareCalls >= 1, String(shareCalls));

  await metricsAudit(page, '卡牌交互后');
  await controlsAudit(page, '卡牌');
  await darkAudit(page, '卡牌');
  checkClean(page, '卡牌', consoleFrom, pageFrom);
}

async function mahjongSuite(page) {
  console.log('\n[mahjong]');
  let consoleFrom = page.consoleErrors.length;
  let pageFrom = page.pageErrors.length;
  await goto(page, '/play/mahjong.html?seed=5&delay=40');
  ok('麻将页加载并暴露 __mahjong', await page.evaluate('Boolean(window.__mahjong)'));
  const initial = await page.evaluate('window.__mahjong.state');
  ok('初始庄家 14 张', Boolean(initial && initial.hands && initial.hands[0].length === 14),
    initial ? String(initial.hands[0].length) : 'null');

  const tile = await page.evaluate(
    '(function(){var b=document.querySelector("#hand button");if(!b)return null;var t=b.dataset.tile;b.click();return t;})()'
  );
  ok('点击手牌可打出', Boolean(tile), String(tile));
  await sleep(200);
  const afterDiscard = await page.evaluate('window.__mahjong.state');
  ok('打出后牌河 +1', Boolean(afterDiscard && afterDiscard.discards[0].length >= 1),
    JSON.stringify(afterDiscard && afterDiscard.discards[0]));
  await metricsAudit(page, '麻将');
  await controlsAudit(page, '麻将');
  await darkAudit(page, '麻将');
  checkClean(page, '麻将对局', consoleFrom, pageFrom);

  consoleFrom = page.consoleErrors.length;
  pageFrom = page.pageErrors.length;
  await goto(page, '/play/mahjong.html?test=win&delay=0&seed=1');
  const tsumoVisible = await waitFor(page, '(function(){var b=document.getElementById("tsumo");return Boolean(b&&!b.hidden);})()');
  ok('听牌后出现「自摸胡牌」', tsumoVisible);
  if (tsumoVisible) {
    // Keep the match above validateScore's 1s duration floor.
    await sleep(600);
    ok('navigator.share 可用（stub）', await installShareStub(page));
    await clickSelector(page, '#tsumo');
    const overlay = await waitFor(page, '(function(){var o=document.getElementById("overlay");return Boolean(o&&!o.hidden);})()');
    ok('自摸后结果面板出现', overlay);
    const result = await page.evaluate(
      '(function(){return {kind:document.getElementById("resultKind").textContent,' +
      'points:document.getElementById("resultPoints").textContent,' +
      'phase:window.__mahjong.state.phase,winner:window.__mahjong.state.winner};})()'
    );
    ok('自摸结算为自摸', result && result.kind === '自摸', JSON.stringify(result));
    ok('自摸结算有番数/点数', result && Number(result.points) > 0, JSON.stringify(result));
    ok('自摸后本局结束', result && result.phase === 'ended' && result.winner === 0, JSON.stringify(result));
    await retentionAudit(page, '麻将', '#overlay');
    await clickSelector(page, '#rr-share');
    await sleep(200);
    const shareCalls = await page.evaluate('window.__shareCalls.length');
    ok('麻将分享按钮调用 navigator.share', shareCalls >= 1, String(shareCalls));
    await metricsAudit(page, '麻将结果');
    await controlsAudit(page, '麻将结果');
  }
  checkClean(page, '麻将自摸', consoleFrom, pageFrom);
}

async function roomsSuite(page) {
  console.log('\n[rooms]');
  const consoleFrom = page.consoleErrors.length;
  const pageFrom = page.pageErrors.length;
  await goto(page, '/play/rooms.html');

  await page.evaluate(
    '(function(){document.getElementById("createNick").value="房主";' +
    'document.getElementById("createName").value="验收房间";' +
    'document.getElementById("createPassword").value="abcd";' +
    'document.getElementById("createForm").dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}));return true;})()'
  );
  await sleep(300);
  const roomId = await page.evaluate('document.getElementById("roomIdText").textContent');
  ok('创建房间后显示房间 ID', /^room_/.test(roomId || ''), roomId);
  eq('创建后成员 1 人', await page.evaluate('document.getElementById("memberCount").textContent'), '1');
  eq('创建后标记有密码', await page.evaluate('document.getElementById("roomPasswordFlag").textContent'), '有');

  const submitJoin = async function (password) {
    const payload = JSON.stringify({ roomId: roomId, password: password });
    await page.evaluate(
      '(function(){var p=' + payload + ';' +
      'document.getElementById("joinRoomId").value=p.roomId;' +
      'document.getElementById("joinNick").value="bob";' +
      'document.getElementById("joinPassword").value=p.password;' +
      'document.getElementById("joinForm").dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}));return true;})()'
    );
    await sleep(300);
    return page.evaluate('document.getElementById("joinMsg").textContent');
  };

  const wrong = await submitJoin('nope');
  ok('密码错误被拒绝', String(wrong).indexOf('密码错误') !== -1, wrong);
  eq('密码错误后成员仍为 1', await page.evaluate('document.getElementById("memberCount").textContent'), '1');

  const right = await submitJoin('abcd');
  ok('正确密码可加入', String(right).indexOf('已加入') !== -1, right);
  eq('正确加入后成员 2 人', await page.evaluate('document.getElementById("memberCount").textContent'), '2');
  const members = await page.evaluate('document.getElementById("memberList").textContent');
  ok('成员列表包含新玩家', String(members).indexOf('bob') !== -1, members);

  await metricsAudit(page, '房间');
  await controlsAudit(page, '房间');
  await darkAudit(page, '房间');
  checkClean(page, '房间', consoleFrom, pageFrom);
}

async function shareSuite(page) {
  console.log('\n[share]');
  const consoleFrom = page.consoleErrors.length;
  const pageFrom = page.pageErrors.length;
  await goto(page, '/play/share.html?match=m_test-123');
  const text = await page.evaluate('document.getElementById("match-id").textContent');
  ok('分享页显示对局编号', text === 'm_test-123', text);
  const href = await page.evaluate(
    '(function(){var a=document.querySelector("a.cta");return a?a.getAttribute("href"):"";})()'
  );
  ok('分享页有回到入口的链接', href === './index.html', href);
  await goto(page, '/play/share.html?match=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  const sanitized = await page.evaluate('document.getElementById("match-id").textContent');
  ok('分享页只保留安全字符', !/[<>/]/.test(sanitized || ''), sanitized);
  await metricsAudit(page, '分享');
  await controlsAudit(page, '分享');
  await darkAudit(page, '分享');
  checkClean(page, '分享', consoleFrom, pageFrom);
}

async function rewardsSuite(page) {  console.log('\n[rewards]');
  let consoleFrom = page.consoleErrors.length;
  let pageFrom = page.pageErrors.length;
  await goto(page, '/play/rewards.html');
  // The card/mahjong suites above already recorded matches (and therefore the
  // daily login). Reset local progress so this suite keeps testing first-visit
  // behaviour deterministically.
  await page.evaluate('(function(){try{localStorage.clear();}catch(e){}return true;})()');
  await page.cdp.send('Page.reload', {});
  await sleep(800);
  const before = parsePoints(await page.evaluate('document.getElementById("points").textContent'));
  const disabledBefore = await page.evaluate('document.getElementById("daily-btn").disabled');
  ok('首次进入可领登录奖励', disabledBefore === false);
  await clickSelector(page, '#daily-btn');
  await sleep(250);
  const after = parsePoints(await page.evaluate('document.getElementById("points").textContent'));
  const disabledAfter = await page.evaluate('document.getElementById("daily-btn").disabled');
  ok('领取后积分增加', after > before, before + ' -> ' + after);
  ok('领取后按钮禁用', disabledAfter === true);
  const dailyText = await page.evaluate('document.getElementById("daily-text").textContent');
  ok('领取文案显示今日已领取', String(dailyText).indexOf('今日已领取') !== -1, dailyText);

  await page.cdp.send('Page.reload', {});
  await sleep(800);
  const reloaded = parsePoints(await page.evaluate('document.getElementById("points").textContent'));
  const disabledReloaded = await page.evaluate('document.getElementById("daily-btn").disabled');
  eq('刷新后积分持久化', reloaded, after);
  ok('刷新后当日奖励仍为已领取', disabledReloaded === true);

  await clickSelector(page, '#play-btn');
  await sleep(250);
  const afterPlay = parsePoints(await page.evaluate('document.getElementById("points").textContent'));
  ok('模拟对局发放积分', afterPlay > reloaded, reloaded + ' -> ' + afterPlay);
  const status = await page.evaluate('document.getElementById("status").textContent');
  ok('模拟对局有状态反馈', String(status).length > 0, status);

  await metricsAudit(page, '奖励');
  await controlsAudit(page, '奖励');
  await darkAudit(page, '奖励');
  checkClean(page, '奖励', consoleFrom, pageFrom);
}

async function main() {
  if (!findChrome()) {
    console.log('SKIP: Chrome not found, cannot run the browser smoke test');
    console.log('');
    console.log('RESULT: 0 passed, 0 failed, 1 skipped');
    return 0;
  }

  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  origin = handle.origin;

  try {
    console.log('smoke origin: ' + origin);
    await withChrome(origin + '/play/index.html', async function (page) {
      await page.evaluate('(function(){try{localStorage.clear();}catch(e){}return true;})()');
      await indexSuite(page);
      await cardSuite(page);
      await mahjongSuite(page);
      await roomsSuite(page);
      await rewardsSuite(page);
      await shareSuite(page);

      const external = page.externalRequests.filter(function (url) {
        return !url.startsWith(origin) && !/^(data|blob|about|file):/.test(url);
      });
      eq('全部页面零外部请求', external, []);
      eq('全部页面零 console error', page.consoleErrors, []);
      eq('全部页面零未捕获异常', page.pageErrors, []);
    }, { timeoutMs: 20000 });
  } finally {
    await handle.close();
  }

  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed, 0 skipped');
  if (failures.length > 0) {
    console.log('');
    for (const line of failures) console.log('FAIL: ' + line);
  }
  return failed === 0 ? 0 : 1;
}

main().then(function (code) {
  process.exitCode = code;
}).catch(function (err) {
  console.error('smoke crashed: ' + (err && err.stack ? err.stack : String(err)));
  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed, 0 skipped');
  process.exitCode = 1;
});
