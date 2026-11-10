'use strict';

module.exports = function run(CORE, params, s) {
  var rows = params.rows, cols = params.cols, N = rows * cols;
  var P = Math.floor(N / 2);

  function findPair(state, skip) {
    for (var i = 0; i < N; i++) {
      for (var j = i + 1; j < N; j++) {
        if (state.cards[i].pair === state.cards[j].pair && state.cards[i].pair >= 0 &&
            i !== skip && j !== skip) return [i, j];
      }
    }
    return null;
  }
  function findDiff(state, a, b) {
    for (var i = 0; i < N; i++) {
      for (var j = i + 1; j < N; j++) {
        if (state.cards[i].pair !== state.cards[j].pair) return [i, j];
      }
    }
    return null;
  }

  s.group('初始状态', function () {
    var g = CORE.newGame(function () { return 0.5; });
    s.eq('牌数', g.cards.length, N);
    s.eq('成对数', g.cards.filter(function (c) { return c.pair >= 0; }).length / 2, P);
    var counts = {};
    g.cards.forEach(function (c) { if (c.pair >= 0) counts[c.pair] = (counts[c.pair] || 0) + 1; });
    var ok = Object.keys(counts).every(function (k) { return counts[k] === 2; });
    s.ok('每对恰好两张', ok);
    s.eq('初始 flips', g.flips, 0);
    s.eq('初始 moves', g.moves, 0);
    s.eq('初始 status', CORE.status(g), 'playing');
    var a = CORE.newGame(function () { return 0.7; });
    var b = CORE.newGame(function () { return 0.7; });
    s.eq('固定 rng 初始牌序一致', a.cards.map(function (c) { return c.pair; }).join(','), b.cards.map(function (c) { return c.pair; }).join(','));
  });

  s.group('翻牌与配对', function () {
    var g = CORE.newGame(function () { return 0.3; });
    var pair = findPair(g);
    var r1 = CORE.act(g, pair[0]);
    s.ok('第一张翻开', r1.state.cards[pair[0]].up === true);
    s.eq('flips +1', r1.state.flips, 1);
    var r2 = CORE.act(r1.state, pair[1]);
    s.eq('配对成功 gained=1', r2.gained, 1);
    s.eq('两张都 matched', [r2.state.cards[pair[0]].matched, r2.state.cards[pair[1]].matched].join(','), 'true,true');
    s.eq('moves +1', r2.state.moves, 1);

    var diff = findDiff(g, pair[0], pair[1]);
    var d1 = CORE.act(g, diff[0]);
    var d2 = CORE.act(d1.state, diff[1]);
    s.eq('不配对 gained=0', d2.gained, 0);
    s.eq('不配对翻回', [d2.state.cards[diff[0]].up, d2.state.cards[diff[1]].up].join(','), 'false,false');

    var same = CORE.act(r2.state, pair[0]);
    s.ok('已配对牌不可再翻', same.changed === false);
  });

  s.group('卡面图案', function () {
    var symbols = require('../memory-symbols.js');
    var fs = require('fs');
    var path = require('path');
    var dir = path.join(__dirname, '../../../assets/art/arcade/memory-pairs/symbols');

    var seen = {};
    for (var i = 0; i < P; i++) seen[symbols.faceFor(i)] = (seen[symbols.faceFor(i)] || 0) + 1;
    var distinct = Object.keys(seen).length;
    s.eq('本款每个对子都有不同图案', distinct, P);
    s.ok('同一款内至少 6 种图案', distinct >= 6);
    s.ok('图案总数覆盖最大盘面', symbols.count >= P);
    s.ok('图案键名非空', symbols.keys.every(function (k) { return /^[a-z]+-[a-z]+$/.test(k); }));
    s.ok('图案不是纯色块占位（形状 ≥ 6 种）', symbols.shapes.length >= 6);

    var manifest = JSON.parse(fs.readFileSync(path.join(dir, 'symbols.json'), 'utf8'));
    var expected = [];
    manifest.palettes.forEach(function (pal) {
      Object.keys(manifest.shapes).forEach(function (shape) { expected.push(shape + '-' + pal.key); });
    });
    s.eq('共享目录顺序与 manifest 一致', symbols.keys.join(','), expected.join(','));
    var missing = symbols.keys.filter(function (k) { return !fs.existsSync(path.join(dir, k + '.png')); });
    s.eq('24 个透明底 PNG 均存在', missing.join(',') || 'ok', 'ok');
    s.eq('图案按卡面绝对路径引用', symbols.url('star-amber'), '/games/assets/art/arcade/memory-pairs/symbols/star-amber.png');
  });

  s.group('胜负与纯函数', function () {
    var g = CORE.newGame(function () { return 0.4; });
    var before = JSON.stringify(g);
    CORE.act(g, 0);
    s.eq('act 不修改入参', JSON.stringify(g), before);

    var won = { cards: g.cards.map(function (c) { return { pair: c.pair, up: false, matched: true }; }), flips: 0, moves: 0, won: true };
    s.eq('全配对 status=won', CORE.status(won), 'won');
  });
};
