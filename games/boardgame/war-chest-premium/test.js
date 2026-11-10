'use strict';

/* War Chest Premium — rules + delivery tests.
 *   node games/boardgame/war-chest-premium/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('war-chest-premium');
var DATA = require('./data.js');
var E = require('./engine.js');

function fresh(seed) { return E.createGame({ seed: seed == null ? 1 : seed, aiPlayer: 1 }); }
function setHand(state, playerIndex, types) {
  var p = state.players[playerIndex];
  while (types.length > p.hand.length) {
    if (p.bag.length) p.bag.pop();
    else if (p.discard.length) p.discard.pop();
    else break;
  }
  while (types.length < p.hand.length) p.hand.pop();
  p.hand = types.slice();
}
function putUnit(state, owner, type, r, c, hp) {
  var unit = { id: state.nextUnitId++, owner: owner, type: type, r: r, c: c,
    hp: hp == null ? (DATA.UNITS[type].defense || 1) : hp, maxHp: DATA.UNITS[type].defense || 1 };
  state.units.push(unit);
  state.players[owner].reserves[type]--;
  return unit;
}
function expectThrow(label, fn, re) {
  var message = '';
  try { fn(); } catch (e) { message = String(e && e.message || e); }
  s.ok(label, !!message && (!re || re.test(message)), message || 'no exception');
}
function coinTotal(p) { return p.bag.length + p.hand.length + p.discard.length; }
function invariants(state) {
  var ok = true;
  state.players.forEach(function (p) {
    if (coinTotal(p) !== 16) ok = false;
    DATA.UNIT_ORDER.forEach(function (type) {
      var onBoard = state.units.filter(function (u) { return u.owner === p.index && u.type === type; }).length;
      if (p.reserves[type] + onBoard !== 4) ok = false;
    });
  });
  var seen = {};
  state.units.forEach(function (u) { var k = u.r + ',' + u.c; if (seen[k] || u.r < 0 || u.c < 0 || u.r >= 7 || u.c >= 7) ok = false; seen[k] = true; });
  return ok;
}

s.group('数据契约', function () {
  s.eq('7×7 棋盘', DATA.BOARD_SIZE, 7);
  s.eq('6 个据点', DATA.STRONGHOLDS.length, 6);
  s.eq('控制 4 个获胜', DATA.WIN_STRONGHOLDS, 4);
  s.eq('每回合抽 3 枚', DATA.HAND_DRAW, 3);
  s.eq('回合上限 120', DATA.MAX_TURNS, 120);
  s.eq('4 种单位', DATA.UNIT_ORDER.length, 4);
  s.eq('每种 4 枚', DATA.UNIT_ORDER.map(function (t) { return DATA.UNITS[t].count; }), [4, 4, 4, 4]);
  s.eq('每方 16 枚', DATA.UNIT_ORDER.reduce(function (n, t) { return n + DATA.UNITS[t].count; }, 0), 16);
  s.eq('单位名字', DATA.UNIT_ORDER.map(function (t) { return DATA.UNITS[t].name; }), ['剑士', '弓箭手', '骑兵', '斥候']);
  s.eq('剑士 2 步 1 射 2 耐久', [DATA.UNITS.swordsman.move, DATA.UNITS.swordsman.range, DATA.UNITS.swordsman.defense], [2, 1, 2]);
  s.eq('弓箭手 1 步 3 射', [DATA.UNITS.archer.move, DATA.UNITS.archer.range], [1, 3]);
  s.eq('骑兵 3 步 1 射', [DATA.UNITS.cavalry.move, DATA.UNITS.cavalry.range], [3, 1]);
  s.eq('斥候 3 步不能攻击', [DATA.UNITS.scout.move, DATA.UNITS.scout.range], [3, 0]);
  s.eq('据点坐标唯一', new Set(DATA.STRONGHOLDS.map(function (h) { return h.r + ',' + h.c; })).size, 6);
  s.ok('据点都在棋盘内', DATA.STRONGHOLDS.every(function (h) { return h.r >= 0 && h.c >= 0 && h.r < 7 && h.c < 7; }));
  s.eq('无大本营', DATA.BASES.length, 0);
});

s.group('开局', function () {
  var st = fresh(3);
  s.eq('双方各 16 枚币', [coinTotal(st.players[0]), coinTotal(st.players[1])], [16, 16]);
  s.eq('双方手牌 3 枚', [st.players[0].hand.length, st.players[1].hand.length], [3, 3]);
  s.eq('双方袋中 13 枚', [st.players[0].bag.length, st.players[1].bag.length], [13, 13]);
  s.eq('双方各控 2 个据点', [E.controlCount(st, 0), E.controlCount(st, 1)], [2, 2]);
  s.eq('中立据点 2 个', st.strongholds.filter(function (h) { return h.owner == null; }).length, 2);
  s.eq('起始回合 1', st.turn, 1);
  s.ok('同 seed 可复现', JSON.stringify(fresh(9)) === JSON.stringify(fresh(9)));
  s.ok('开局不变量', invariants(st));
});

s.group('部署合法性', function () {
  var st = fresh(10);
  var sh = st.strongholds.filter(function (h) { return h.owner === 0; })[0];
  var type = st.players[0].hand[0];
  s.ok('据点相邻空格可部署', E.canDeploy(st, type, sh.r - 1 >= 0 ? sh.r - 1 : sh.r + 1, sh.c, 0).ok);
  s.ok('据点自身不可部署', !E.canDeploy(st, type, sh.r, sh.c, 0).ok);
  var far = { r: sh.r === 0 ? 6 : 0, c: sh.c === 0 ? 6 : 0 };
  s.ok('远处空格拒绝', !E.canDeploy(st, type, far.r, far.c, 0).ok);
  s.ok('非当前玩家拒绝', !E.canDeploy(st, type, sh.r - 1, sh.c, 1).ok);
  var cell = E.legalDeployCells(st, type, 0)[0];
  var before = st.players[0].hand.length;
  var next = E.deploy(st, type, cell.r, cell.c, 0);
  s.eq('手牌 -1', next.players[0].hand.length, before - 1);
  s.eq('单位上场', next.units.length, 1);
  s.eq('单位有耐久', next.units[0].hp, DATA.UNITS[type].defense);
  s.ok('部署后不变量', invariants(next));
  expectThrow('没有对应币拒绝部署', function () { E.deploy(next, type, cell.r, cell.c, 0); }, /手里没有|已有单位/);
});

s.group('移动', function () {
  var st = fresh(20);
  st.units = [];
  var unit = putUnit(st, 0, 'cavalry', 3, 3);
  setHand(st, 0, ['cavalry', 'cavalry', 'cavalry']);
  s.ok('骑兵 3 格可达', E.canMove(st, unit.id, { r: 3, c: 6 }, 0).ok);
  s.ok('越界不可达', !E.canMove(st, unit.id, { r: 3, c: 7 }, 0).ok);
  s.ok('不能原地', !E.canMove(st, unit.id, { r: 3, c: 3 }, 0).ok);
  var blocked = putUnit(st, 1, 'scout', 3, 4);
  s.ok('单位阻挡', !E.canMove(st, unit.id, { r: 3, c: 5 }, 0).ok);
  var next = E.moveUnit(st, unit.id, { r: 3, c: 2 }, 0);
  s.eq('移动后位置', [E.findUnit(next, unit.id).r, E.findUnit(next, unit.id).c], [3, 2]);
  s.eq('弃币 +1', next.players[0].discard.length, 1);
  s.ok('移动后不变量', invariants(next));
  s.ok('阻挡单位仍在', !!E.findUnit(next, blocked.id));
});

s.group('攻击与耐久', function () {
  var st = fresh(30);
  st.units = [];
  setHand(st, 0, ['swordsman', 'swordsman', 'archer']);
  var sword = putUnit(st, 0, 'swordsman', 2, 2);
  var target = putUnit(st, 1, 'swordsman', 2, 3);
  var a1 = E.attackUnit(st, sword.id, target.id, 0);
  s.ok('剑士第一次攻击未击破 2 耐久目标', !!E.findUnit(a1, target.id));
  s.eq('目标剩 1 耐久', E.findUnit(a1, target.id).hp, 1);
  var a2 = E.attackUnit(a1, sword.id, target.id, 0);
  s.ok('第二次攻击击破', !E.findUnit(a2, target.id));
  s.eq('被击破后回到预备队', a2.players[1].reserves.swordsman, 4 - 0);
  var st2 = fresh(31);
  st2.units = [];
  setHand(st2, 0, ['archer', 'archer', 'archer']);
  var archer = putUnit(st2, 0, 'archer', 1, 1);
  var far = putUnit(st2, 1, 'scout', 1, 4);
  s.ok('弓箭手 3 格可攻击', E.canAttack(st2, archer.id, far.id, 0).ok);
  var far2 = putUnit(st2, 1, 'scout', 1, 6);
  s.ok('弓箭手 4 格不可攻击', !E.canAttack(st2, archer.id, far2.id, 0).ok);
  var st3 = fresh(32);
  st3.units = [];
  setHand(st3, 0, ['scout', 'scout', 'scout']);
  var scout = putUnit(st3, 0, 'scout', 2, 2);
  var enemy = putUnit(st3, 1, 'scout', 2, 3);
  s.ok('斥候不能攻击', !E.canAttack(st3, scout.id, enemy.id, 0).ok);
  s.ok('不能攻击己方', !E.canAttack(st2, archer.id, putUnit(st2, 0, 'scout', 2, 3).id, 0).ok);
});

s.group('据点控制与胜利', function () {
  var st = fresh(40);
  st.units = [];
  setHand(st, 0, ['cavalry', 'cavalry', 'cavalry']);
  var neutral = st.strongholds.filter(function (h) { return h.owner == null; })[0];
  var unit = putUnit(st, 0, 'cavalry', neutral.r + 1, neutral.c);
  var next = E.moveUnit(st, unit.id, { r: neutral.r, c: neutral.c }, 0);
  s.eq('踏入中立据点即控制', next.strongholds.filter(function (h) { return h.id === neutral.id; })[0].owner, 0);
  s.eq('控制数 +1', E.controlCount(next, 0), 3);
  var st2 = fresh(41);
  st2.units = [];
  setHand(st2, 0, ['cavalry', 'cavalry', 'cavalry']);
  // Give player 0 three strongholds, then capture a fourth.
  st2.strongholds.forEach(function (h, i) { if (i < 3) h.owner = 0; if (i === 3) h.owner = null; });
  var sh4 = st2.strongholds[3];
  var u2 = putUnit(st2, 0, 'cavalry', sh4.r + 1, sh4.c);
  var won = E.moveUnit(st2, u2.id, { r: sh4.r, c: sh4.c }, 0);
  s.ok('控制 4 个据点立即获胜', won.over === true);
  s.eq('胜者是玩家 0', won.result.winner, 0);
  s.ok('胜利原因写明据点', /4 个据点/.test(won.result.reason), won.result.reason);
});

s.group('结束回合与抽币', function () {
  var st = fresh(50);
  var handBefore = st.players[0].hand.length;
  var next = E.endTurn(st);
  s.eq('当前玩家换手', next.current, 1);
  s.eq('回合数 +1', next.turn, 2);
  s.eq('自己手牌清空', next.players[0].hand.length, 0);
  s.eq('弃币增加', next.players[0].discard.length, handBefore);
  s.eq('对手抽到 3 枚', next.players[1].hand.length, 3);
  s.ok('换手后不变量', invariants(next));
  var st2 = fresh(51);
  st2.players[0].bag = [];
  st2.players[0].hand = [];
  st2.players[0].discard = ['archer', 'archer', 'archer'];
  var drawn = E.drawHand(st2, 0);
  s.eq('袋空时弃币洗回', drawn.players[0].hand.length, 3);
  s.eq('弃币清空', drawn.players[0].discard.length, 0);
});

s.group('AI 与自对弈', function () {
  var st = fresh(60);
  var ok = true;
  for (var i = 0; i < 120 && !st.over; i++) {
    var a = E.chooseAIAction(st, st.current);
    try { st = E.applyAction(st, a); } catch (e) { ok = false; break; }
  }
  s.ok('AI 连续动作合法', ok);
  var errors = 0, incomplete = 0, bad = 0, maxTurns = 0, started = Date.now();
  for (var g = 0; g < 20; g++) {
    var game = fresh(200 + g);
    var guard = 0;
    try {
      while (!game.over && guard < 800) {
        game = E.applyAction(game, E.chooseAIAction(game, game.current));
        guard++;
      }
    } catch (e) { errors++; }
    if (!game.over) incomplete++;
    if (!invariants(game)) bad++;
    maxTurns = Math.max(maxTurns, game.turn);
  }
  s.eq('20 局无异常', errors, 0);
  s.eq('20 局全部结束', incomplete, 0);
  s.eq('20 局不变量成立', bad, 0);
  s.ok('自对弈在动作上限内', maxTurns <= 120, String(maxTurns));
  s.ok('20 局在 20 秒内', Date.now() - started < 20000, (Date.now() - started) + 'ms');
});

s.group('页面与联机交付面', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var online = fs.readFileSync(path.join(__dirname, 'online.html'), 'utf8');
  var server = fs.readFileSync(path.join(__dirname, 'online-server.mjs'), 'utf8');
  var manifest = fs.readFileSync(path.join(__dirname, '..', '..', 'precache-manifest.js'), 'utf8');
  var sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
  var ver = (sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  s.ok('标题含战争宝箱', /<title>[^<]*战争宝箱/.test(html));
  s.ok('描述 meta', /name="description"/.test(html));
  s.ok('引用 data.js', /src="data\.js"/.test(html));
  s.ok('引用 engine.js', /src="engine\.js"/.test(html));
  s.ok('引用 shared/sfx.js', /src="\.\.\/\.\.\/shared\/sfx\.js"/.test(html));
  s.ok('注册全局 v22 SW', /serviceWorker\.register\('\.\.\/\.\.\/sw\.js'/.test(html));
  s.ok('7 列棋盘', /grid-template-columns:\s*repeat\(7/.test(html));
  s.ok('44px 触控下限', /--touch:\s*44px/.test(html) && /min-height:46px/.test(html));
  s.ok('320 档媒体查询', /@media\s*\(max-width:\s*350px\)/.test(html));
  s.ok('无远程字体', !/fonts\.googleapis|fonts\.gstatic|@font-face/i.test(html));
  s.ok('链接规则页', /href="rules\.html"/.test(html));
  s.ok('链接联机页', /href="online\.html"/.test(html));
  s.ok('测试 API', /window\.__war/.test(html) && /autoPlayToEnd/.test(html));
  s.ok('规则页列出 B 站来源', /BV1AK411L7jz/.test(rules) && /BV1aJ411G7eR/.test(rules));
  s.ok('规则页写明 4 据点胜利', /先控制 4 个据点/.test(rules));
  s.ok('规则页写明 16 枚币', /16 枚/.test(rules));
  s.ok('规则页写明 3 个行动', /最多执行 3 个行动/.test(rules));
  s.ok('规则页写明耐久', /2 点耐久/.test(rules));
  s.ok('联机页有房间码入口', /roomCode|邀请码/.test(online));
  s.ok('联机页无外部依赖', !/<script[^>]+src="https?:/i.test(online) && !/fonts\.googleapis/.test(online));
  s.ok('服务端复用 rooms.js', /from '\.\.\/app\/rooms\.js'/.test(server));
  s.ok('服务端权威 applyAction', /E\.applyAction/.test(server));
  s.ok('服务端隐藏对手手牌', /hand: i === viewerIndex/.test(server) && /handCount/.test(server));
  s.ok('precache 版本一致', !!ver && manifest.indexOf('"version": "' + ver + '"') !== -1);
  s.ok('precache 收录本作', manifest.indexOf('/games/boardgame/war-chest-premium/') !== -1);
  s.ok('precache 收录材质', manifest.indexOf('/games/assets/art/premium/war-chest/silver-coin.webp') !== -1);
});

s.done();
