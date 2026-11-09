'use strict';

/*
 * Carcassonne（卡卡颂）引擎与页面契约测试。
 *
 * 页面、测试共用同源 data.js / engine.js；测试直接 require 引擎，不复制规则。
 * 运行：
 *   node games/boardgame/carcassonne/test.js
 *   node games/tests/run-all.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var DATA = require('./data.js');
var E = require('./engine.js');

var s = lib.suite('carcassonne');

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function newGame(deck, seed) {
  return E.createGame({
    seed: seed == null ? 1 : seed,
    deck: deck,
    players: [{ name: '你', isAI: false }, { name: 'AI 对手', isAI: true }]
  });
}

function boardMeeples(state) {
  var counts = [0, 0];
  Object.keys(state.board).forEach(function (key) {
    state.board[key].meeples.forEach(function (m) { counts[m.player] = (counts[m.player] || 0) + 1; });
  });
  return counts;
}

function legalPositionsFor(state, tileId, rot) {
  return E.getLegalPlacements(state, tileId, rot);
}

/* ------------------------------------------------------------------ */
/* 1. 数据完整性                                                       */
/* ------------------------------------------------------------------ */

s.group('瓦片数据完整性', function () {
  s.eq('瓦片条目数 50', DATA.TILES.length, 50);
  s.ok('实体瓦片数在 40–60', DATA.TOTAL_TILES >= 40 && DATA.TOTAL_TILES <= 60, 'got ' + DATA.TOTAL_TILES);
  s.eq('实体瓦片数等于 count 之和', DATA.TOTAL_TILES,
    DATA.TILES.reduce(function (sum, t) { return sum + t.count; }, 0));
  s.eq('瓦片 ID 唯一', new Set(DATA.TILES.map(function (t) { return t.id; })).size, DATA.TILES.length);
  s.ok('起始瓦片存在', DATA.TILES.some(function (t) { return t.id === DATA.START_TILE_ID; }));
  s.eq('每方 7 个米宝', DATA.MEEPLES_PER_PLAYER, 7);
  s.eq('棋盘 25×25', DATA.BOARD_MAX - DATA.BOARD_MIN + 1, 25);
  s.ok('边类型只有 city/road/field', DATA.EDGE_TYPES.join(',') === 'city,road,field');

  var cityEdges = 0, roadEdges = 0, fieldEdges = 0, monasteryTiles = 0;

  DATA.TILES.forEach(function (t) {
    var tag = t.id + ' ' + t.name;
    s.ok(tag + ' 名称非空', typeof t.name === 'string' && t.name.trim().length > 0);
    s.ok(tag + ' 四边', Array.isArray(t.edges) && t.edges.length === 4);
    s.ok(tag + ' 每一组地形合法', t.edges.every(function (edge) {
      return DATA.EDGE_TYPES.indexOf(edge) >= 0;
    }));
    s.ok(tag + ' count 为正整数', Number.isInteger(t.count) && t.count >= 1);
    s.ok(tag + ' monastery 为布尔值', typeof t.monastery === 'boolean');
    if (t.monastery) monasteryTiles++;

    t.edges.forEach(function (edge) {
      if (edge === 'city') cityEdges++;
      if (edge === 'road') roadEdges++;
      if (edge === 'field') fieldEdges++;
    });

    s.ok(tag + ' 至少有一种地物', t.cities.length + t.roads.length + t.fields.length + (t.monastery ? 1 : 0) > 0);
    s.ok(tag + ' fieldAdj 与农田分组等长', t.fieldAdj.length === t.fields.length);

    [['cities', 'city'], ['roads', 'road'], ['fields', 'field']].forEach(function (pair) {
      var groups = t[pair[0]];
      var kind = pair[1];
      var used = Object.create(null);
      s.ok(tag + ' ' + kind + ' 分组是数组', Array.isArray(groups));
      groups.forEach(function (group, gi) {
        s.ok(tag + ' ' + kind + ' 分组 ' + gi + ' 非空', group.length > 0);
        group.forEach(function (dir) {
          s.ok(tag + ' ' + kind + ' 分组 ' + gi + ' 方向合法', dir >= 0 && dir < 4, String(dir));
          s.ok(tag + ' ' + kind + ' 分组 ' + gi + ' 地形对应', t.edges[dir] === kind,
            'dir ' + dir + ' edge ' + t.edges[dir]);
          s.ok(tag + ' ' + kind + ' 方向不重复', !used[dir], 'dir ' + dir);
          used[dir] = true;
        });
      });
      t.edges.forEach(function (edge, dir) {
        if (edge === kind) s.ok(tag + ' ' + kind + ' 边 ' + dir + ' 已被分组覆盖', !!used[dir]);
      });
    });

    t.fieldAdj.forEach(function (list, fi) {
      s.ok(tag + ' fieldAdj[' + fi + '] 是数组', Array.isArray(list));
      list.forEach(function (ci) {
        s.ok(tag + ' fieldAdj[' + fi + '] 城市分组存在', typeof ci === 'number' && !!t.cities[ci]);
      });
    });

    for (var rot = 0; rot < 4; rot++) {
      var inst = E.makeTile(t, rot);
      s.ok(tag + ' 旋转 ' + rot + ' 后四边齐备', inst.edges.length === 4 && inst.edges.every(function (edge) {
        return DATA.EDGE_TYPES.indexOf(edge) >= 0;
      }));
      s.ok(tag + ' 旋转 ' + rot + ' 后米宝列表为空', Array.isArray(inst.meeples) && inst.meeples.length === 0);
      inst.cities.concat(inst.roads, inst.fields).forEach(function (group) {
        s.ok(tag + ' 旋转 ' + rot + ' 分组方向合法', group.every(function (dir) { return dir >= 0 && dir < 4; }));
      });
    }

    var base = E.makeTile(t, 0);
    var four = E.makeTile(t, 4);
    s.eq(tag + ' 旋转四次回到原状', four.edges, base.edges);
    s.eq(tag + ' 负旋转等于三次旋转', E.makeTile(t, -1).edges, E.makeTile(t, 3).edges);
  });

  s.ok('城市边数量充足', cityEdges >= 20, String(cityEdges));
  s.ok('道路边数量充足', roadEdges >= 30, String(roadEdges));
  s.ok('农田边数量充足', fieldEdges >= 50, String(fieldEdges));
  s.ok('修道院瓦片至少 4 张', monasteryTiles >= 4, String(monasteryTiles));

  var t01 = DATA.TILES.filter(function (t) { return t.id === DATA.START_TILE_ID; })[0];
  s.eq('起始瓦片北边是城市', t01.edges[0], 'city');
  s.eq('起始瓦片东西是道路', [t01.edges[1], t01.edges[3]], ['road', 'road']);
  s.ok('T10 南北穿城分组连通', DATA.TILES.filter(function (t) { return t.id === 'T10'; })[0].cities[0].length === 2);
  s.ok('T30 十字路口四路独立',
    DATA.TILES.filter(function (t) { return t.id === 'T30'; })[0].roads.length === 4);
  s.ok('T06 城角分组连通',
    DATA.TILES.filter(function (t) { return t.id === 'T06'; })[0].cities[0].join(',') === '0,1');
});

/* ------------------------------------------------------------------ */
/* 2. 边匹配与放置合法性                                               */
/* ------------------------------------------------------------------ */

s.group('放置与边匹配', function () {
  var g = newGame(['T04', 'T02', 'T03', 'T41'], 10);
  s.eq('开局棋盘只有起始瓦片', Object.keys(g.board).length, 1);
  s.ok('起始瓦片在中心', !!g.board['0,0']);
  s.ok('开局有当前瓦片', !!g.currentTile && g.currentTile.tileId === 'T04');
  s.eq('开局轮到玩家 0', g.currentPlayer, 0);
  s.eq('开局阶段为放置', g.phase, 'placing');

  var placements = legalPositionsFor(g, 'T04', 0);
  s.ok('T04 至少有一个合法位置', placements.length > 0, String(placements.length));
  s.ok('所有合法位置都相邻', placements.every(function (p) {
    return (Math.abs(p.x) + Math.abs(p.y)) === 1;
  }));
  s.ok('所有合法位置边都匹配', placements.every(function (p) {
    return E.canPlaceTile(g, 'T04', p.rot, p.x, p.y).ok;
  }));

  s.ok('不能放在已占格', !E.canPlaceTile(g, 'T04', 0, 0, 0).ok);
  s.ok('不能放在无邻居位置', !E.canPlaceTile(g, 'T04', 0, 5, 5).ok);
  s.ok('边不匹配会被拒绝', !E.canPlaceTile(g, 'T04', 0, 1, 0).ok);
  s.ok('边匹配可以通过', E.canPlaceTile(g, 'T04', 0, 0, -1).ok);
  s.ok('农田接农田合法', E.canPlaceTile(g, 'T04', 0, 0, 1).ok);
  s.ok('越界位置被拒绝', !E.canPlaceTile(g, 'T04', 0, DATA.BOARD_MAX + 1, 0).ok);

  var mismatch = E.canPlaceTile(g, 'T04', 0, 1, 0);
  s.ok('不匹配原因包含“边不匹配”', /边不匹配/.test(mismatch.reason), mismatch.reason);

  var card = E.makeTile(DATA.TILES.filter(function (t) { return t.id === 'T01'; })[0], 1);
  s.eq('T01 顺时针旋转后边序正确', card.edges, ['road', 'city', 'road', 'field']);
  s.eq('T04 旋转 90 度后城市边从南移到西', E.makeTile(DATA.TILES.filter(function (t) { return t.id === 'T04'; })[0], 1).edges[3], 'city');

  var before = g.currentTile.rot;
  E.rotateCurrent(g, 1);
  s.eq('旋转按钮改变朝向', g.currentTile.rot, (before + 1) % 4);
  E.setRotation(g, 0);
  s.eq('setRotation 直接设置朝向', g.currentTile.rot, 0);

  E.placeCurrentTile(g, { x: 0, y: -1, rot: 0 });
  s.ok('合法放置写入棋盘', !!g.board['0,-1']);
  s.eq('放置后进入米宝阶段', g.phase, 'meeple');
  s.eq('放置记录 lastPlaced', g.lastPlaced, '0,-1');
  s.ok('放置后棋盘瓦片数增加', Object.keys(g.board).length === 2);
  s.ok('棋盘上没有边不匹配', E.findEdgeMismatches(g).length === 0);
  expectThrow('非法坐标放置抛错', function () {
    E.placeCurrentTile(g, { x: 5, y: 5, rot: 0 });
  }, /不能放置/);

  var opts = E.getMeepleOptions(g, 0);
  s.ok('城市完成前存在城市米宝选项', opts.some(function (o) { return o.kind === 'city'; }));
  s.ok('选项包含农田', opts.some(function (o) { return o.kind === 'field'; }));
  s.ok('选项包含是否完成字段', opts.every(function (o) { return typeof o.complete === 'boolean'; }));
});

/* ------------------------------------------------------------------ */
/* 3. 米宝数量与占用                                                   */
/* ------------------------------------------------------------------ */

s.group('米宝数量与占用', function () {
  var g = newGame(['T04', 'T02', 'T03'], 20);
  s.eq('玩家 0 初始 7 米宝', g.players[0].meeples, 7);
  s.eq('玩家 1 初始 7 米宝', g.players[1].meeples, 7);

  E.placeCurrentTile(g, { x: 0, y: -1, rot: 0 });
  var events = E.placeMeeple(g, 'city', 0, 0);
  s.eq('城市完成得 4 分', g.players[0].score, 4);
  s.eq('城市完成后米宝退回', g.players[0].meeples, 7);
  s.eq('结算事件数量', events.length, 1);
  s.eq('结算事件类型', events[0].kind, 'city');
  s.eq('结算事件分数', events[0].points, 4);
  s.eq('结算事件玩家', events[0].players, [0]);
  s.eq('城市结算后没有残留米宝', boardMeeples(g)[0], 0);

  var h = newGame(['T34', 'T02', 'T03'], 21);
  E.__putTile(h, 'T34', 1, 0, 0);
  E.__putMeeple(h, 0, 0, 0, 'road', 0);
  h.lastPlaced = '1,0';
  h.phase = 'meeple';
  h.currentPlayer = 0;
  s.eq('手动放米宝后玩家剩 6', h.players[0].meeples, 6);
  var hOpts = E.getMeepleOptions(h, 0);
  var roadOpt = hOpts.filter(function (o) { return o.kind === 'road'; })[0];
  s.ok('道路选项存在', !!roadOpt);
  s.ok('同一道路区域被标记为已占用', roadOpt && roadOpt.occupied === true);
  expectThrow('不能在同一区域再放米宝', function () {
    E.placeMeeple(h, 'road', 0, 0);
  }, /已有米宝/);

  var none = newGame(['T04', 'T02'], 22);
  none.players[0].meeples = 0;
  E.placeCurrentTile(none, { x: 0, y: -1, rot: 0 });
  s.eq('米宝用尽时没有选项', E.getMeepleOptions(none, 0).length, 0);
  expectThrow('米宝用尽不能放置', function () {
    E.placeMeeple(none, 'city', 0, 0);
  }, /没有可用米宝/);

  var m = newGame(['T41', 'T02', 'T03'], 23);
  s.ok('修道院瓦片可以放在农田边', E.canPlaceTile(m, 'T41', 0, 0, 1).ok);
  E.placeCurrentTile(m, { x: 0, y: 1, rot: 0 });
  var mOpts = E.getMeepleOptions(m, 0);
  s.ok('修道院瓦片提供修道院选项', mOpts.some(function (o) { return o.kind === 'monastery'; }));
  E.placeMeeple(m, 'monastery', 0, 0);
  s.eq('修道院米宝留在棋盘', boardMeeples(m)[0], 1);
  s.eq('修道院米宝占用后玩家剩 6', m.players[0].meeples, 6);
  s.ok('修道院未完成时仍保留米宝', m.board['0,1'].meeples.length === 1);
  expectThrow('非米宝阶段不能放米宝', function () {
    E.placeMeeple(m, 'monastery', 0, 0);
  }, /不能放置米宝/);
});

/* ------------------------------------------------------------------ */
/* 4. 城市 / 道路 / 修道院计分                                         */
/* ------------------------------------------------------------------ */

s.group('城市、道路与修道院计分', function () {
  var city = newGame(['T04', 'T02', 'T03'], 30);
  E.placeCurrentTile(city, { x: 0, y: -1, rot: 0 });
  var cityEvents = E.placeMeeple(city, 'city', 0, 0);
  var cityEv = cityEvents.filter(function (ev) { return ev.kind === 'city'; })[0];
  s.ok('城市事件存在', !!cityEv);
  s.eq('城市两块瓦片计 4 分', cityEv && cityEv.points, 4);
  s.eq('城市计分瓦片数', cityEv && cityEv.tiles, 2);

  var noMeeple = newGame(['T04', 'T02', 'T03'], 31);
  E.placeCurrentTile(noMeeple, { x: 0, y: -1, rot: 0 });
  E.skipMeeple(noMeeple);
  s.eq('完成城市无人占领得 0 分', noMeeple.players[0].score, 0);
  s.eq('完成城市无人占领玩家 1 也得 0 分', noMeeple.players[1].score, 0);

  var road = newGame(['T02', 'T03', 'T05'], 32);
  E.__putTile(road, 'T34', 1, 0, 0);
  E.__putTile(road, 'T32', -1, 0, 0);
  E.__putMeeple(road, 0, 0, 0, 'road', 0);
  road.lastPlaced = '0,0';
  road.phase = 'meeple';
  road.currentPlayer = 0;
  var roadEvents = E.resolveAfterPlacement(road);
  var roadEv = roadEvents.filter(function (ev) { return ev.kind === 'road'; })[0];
  s.ok('道路完成事件存在', !!roadEv);
  s.eq('道路三块瓦片计 3 分', roadEv && roadEv.points, 3);
  s.eq('道路计分瓦片数', roadEv && roadEv.tiles, 3);
  s.eq('道路完成后退回米宝', road.players[0].meeples, 7);
  s.eq('道路完成后的总分', road.players[0].score, 3);

  var mono = newGame(['T02', 'T03', 'T05'], 33);
  E.__putTile(mono, 'T41', 5, 5, 0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx || dy) E.__putTile(mono, 'T41', 5 + dx, 5 + dy, 0);
    }
  }
  E.__putMeeple(mono, 0, 5, 5, 'monastery', 0);
  mono.lastPlaced = '5,5';
  mono.phase = 'meeple';
  mono.currentPlayer = 0;
  var monoEvents = E.resolveAfterPlacement(mono);
  var monoEv = monoEvents.filter(function (ev) { return ev.kind === 'monastery'; })[0];
  s.ok('修道院完成事件存在', !!monoEv);
  s.eq('修道院九宫格齐得 9 分', monoEv && monoEv.points, 9);
  s.eq('修道院完成后米宝退回', mono.players[0].meeples, 7);
  s.eq('修道院完成后的总分', mono.players[0].score, 9);
  s.ok('修道院九宫格判定完成', E.monasteryComplete(mono, '5,5'));
});

/* ------------------------------------------------------------------ */
/* 5. 终局计分                                                         */
/* ------------------------------------------------------------------ */

s.group('终局计分', function () {
  var city = newGame(['T02', 'T03'], 40);
  E.__putMeeple(city, 0, 0, 0, 'city', 0);
  var cityResult = E.finishGame(city);
  s.eq('未完成城市每瓦片 1 分', city.players[0].score, 1);
  s.eq('终局城市明细类型', cityResult.breakdown[0] && cityResult.breakdown[0].label, '未完成城市');
  s.eq('终局阶段为 over', city.phase, 'over');

  var road = newGame(['T02', 'T03'], 41);
  E.__putMeeple(road, 0, 0, 0, 'road', 0);
  E.finishGame(road);
  s.eq('未完成道路每瓦片 1 分', road.players[0].score, 1);

  var mono = newGame(['T02', 'T03'], 42);
  E.__putTile(mono, 'T41', 5, 5, 0);
  E.__putMeeple(mono, 0, 5, 5, 'monastery', 0);
  E.finishGame(mono);
  s.eq('未完成修道院 1 + 邻格数', mono.players[0].score, 1);

  var farm = newGame(['T02', 'T03'], 43);
  E.__putTile(farm, 'T04', 0, -1, 0);
  E.__putMeeple(farm, 0, 0, 0, 'field', 0);
  E.finishGame(farm);
  var farmEv = farm.finalBreakdown.filter(function (ev) { return ev.kind === 'field'; })[0];
  s.ok('农田终局事件存在', !!farmEv);
  s.eq('农田相邻一座完成城市得 3 分', farmEv && farmEv.points, 3);
  s.eq('农田终局总分', farm.players[0].score, 3);

  var tie = newGame(['T02', 'T03'], 44);
  E.__putMeeple(tie, 0, 0, 0, 'city', 0);
  E.__putMeeple(tie, 1, 0, 0, 'city', 0);
  E.finishGame(tie);
  s.eq('米宝并列时双方都得未完成城市分', [tie.players[0].score, tie.players[1].score], [1, 1]);

  var winner = newGame(['T02', 'T03'], 45);
  E.__putMeeple(winner, 0, 0, 0, 'city', 0);
  var result = E.finishGame(winner);
  s.eq('终局比分数组', result.scores, [1, 0]);
  s.eq('终局胜者', result.winners, [0]);
  s.ok('终局结果平局标记为 false', result.tie === false);

  var none = newGame(['T02', 'T03'], 46);
  E.finishGame(none);
  s.eq('没有米宝时终局 0 分', none.players[0].score, 0);
  s.eq('没有米宝时终局明细为空', none.finalBreakdown.length, 0);
});

/* ------------------------------------------------------------------ */
/* 6. AI 与自对弈                                                      */
/* ------------------------------------------------------------------ */

s.group('AI 合法动作', function () {
  var g = E.createGame({ seed: 777, players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] });
  var move = E.chooseAIMove(g, 0);
  s.ok('AI 返回放置动作', !!move && move.type === 'place');
  s.ok('AI 动作坐标合法', !!move && E.canPlaceTile(g, g.currentTile.tileId, move.rot, move.x, move.y).ok);
  E.placeCurrentTile(g, move);
  s.eq('AI 放置后进入米宝阶段', g.phase, 'meeple');
  if (move.meeple) {
    var opts = E.getMeepleOptions(g, 0);
    s.ok('AI 米宝选项存在', opts.some(function (o) {
      return o.kind === move.meeple.kind && o.group === move.meeple.group && !o.occupied;
    }));
  } else {
    s.ok('AI 可以不放米宝', true);
  }
  E.skipMeeple(g);
  s.ok('AI 回合结束后阶段推进', g.phase === 'placing' || g.phase === 'over');
});

s.group('50 局 AI 自对弈', function () {
  for (var gameIndex = 0; gameIndex < 50; gameIndex++) {
    var seed = 2000 + gameIndex;
    var g = E.createGame({
      seed: seed,
      players: [{ name: 'AI-1', isAI: true }, { name: 'AI-2', isAI: true }]
    });
    var initialPhysical = 1 + g.deck.length + (g.currentTile ? 1 : 0) + g.discard.length;
    var steps = 0;
    while (g.phase !== 'over' && steps < 500) {
      E.runAITurn(g);
      steps++;
    }
    var tag = '自对弈 #' + gameIndex + '（seed ' + seed + '）';
    s.ok(tag + ' 正常结束', g.phase === 'over', 'phase=' + g.phase + ', steps=' + steps);
    s.ok(tag + ' 没有死循环', steps < 500, 'steps=' + steps);
    s.ok(tag + ' 棋盘无非法接边', E.findEdgeMismatches(g).length === 0,
      JSON.stringify(E.findEdgeMismatches(g).slice(0, 3)));
    s.ok(tag + ' 瓦片数量守恒',
      Object.keys(g.board).length + g.discard.length + g.deck.length + (g.currentTile ? 1 : 0) === initialPhysical);
    var mine = boardMeeples(g);
    s.ok(tag + ' 米宝数量守恒',
      mine[0] + g.players[0].meeples === 7 && mine[1] + g.players[1].meeples === 7,
      JSON.stringify([mine, g.players[0].meeples, g.players[1].meeples]));
    s.ok(tag + ' 分数为非负整数',
      g.players.every(function (p) { return Number.isInteger(p.score) && p.score >= 0; }));
    s.ok(tag + ' 终局比分存在', Array.isArray(g.finalScores) && g.finalScores.length === 2);
    s.ok(tag + ' 胜者合法',
      g.result && g.result.winners.every(function (pi) { return pi === 0 || pi === 1; }));
  }
});

/* ------------------------------------------------------------------ */
/* 7. 页面静态契约                                                     */
/* ------------------------------------------------------------------ */

s.group('页面与规则页静态契约', function () {
  var pageHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rulesHtml = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

  var scriptSrcs = (pageHtml.match(/<script[^>]*\bsrc="([^"]+)"/g) || []).map(function (tag) {
    var m = tag.match(/src="([^"]+)"/);
    return m ? m[1] : '';
  });
  s.eq('页面只引用同源 data.js / engine.js', scriptSrcs, ['data.js', 'engine.js']);
  s.ok('页面有 viewport', /name="viewport"/.test(pageHtml));
  s.ok('页面有 aria-live 状态区', /aria-live=/.test(pageHtml));
  s.ok('页面无外链样式表', !/<link[^>]+rel="stylesheet"/i.test(pageHtml));
  s.ok('页面无 fetch/XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(pageHtml));
  s.ok('页面支持 reduced-motion', /prefers-reduced-motion/.test(pageHtml));
  s.ok('页面无 https 资源引用', !/(?:src|href)="https?:\/\//.test(pageHtml));
  s.ok('页面有 390px 媒体查询', /max-width:430px/.test(pageHtml));
  s.ok('页面有棋盘缩放', /15×15/.test(pageHtml) && /zoomIn/.test(pageHtml));
  s.ok('页面引用规则页', /href="rules.html"/.test(pageHtml));

  var lds = lib.jsonLd(rulesHtml);
  var types = lds.map(function (item) { return item['@type']; });
  s.ok('规则页有 Article JSON-LD', types.indexOf('Article') >= 0, types.join(','));
  s.ok('规则页有 FAQPage JSON-LD', types.indexOf('FAQPage') >= 0, types.join(','));
  var article = lds.filter(function (item) { return item['@type'] === 'Article'; })[0];
  s.ok('Article headline 非空', article && typeof article.headline === 'string' && article.headline.length > 0);
  var faq = lds.filter(function (item) { return item['@type'] === 'FAQPage'; })[0];
  s.ok('FAQ 至少有 5 个问题', faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 5,
    faq ? String(faq.mainEntity.length) : 'missing');
  s.ok('FAQ 答案非空', faq && faq.mainEntity.every(function (q) {
    return q.acceptedAnswer && typeof q.acceptedAnswer.text === 'string' && q.acceptedAnswer.text.length > 10;
  }));

  var bodyText = rulesHtml.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  var chineseCount = (bodyText.match(/[一-鿿]/g) || []).length;
  s.ok('规则页正文至少 1200 个中文字符', chineseCount >= 1200, String(chineseCount));
  s.ok('规则页 CTA 返回游戏', /href="index.html"/.test(rulesHtml));
  s.ok('规则页无外链脚本', !/<script[^>]*\bsrc=/.test(rulesHtml));
  s.ok('规则页无 https 资源引用', !/(?:src|href)="https?:\/\//.test(rulesHtml));
  s.ok('规则页说明简化点', /简化/.test(rulesHtml));
  s.ok('规则页说明农田计分', /农田/.test(rulesHtml) && /3 分/.test(rulesHtml));
});

s.done();
