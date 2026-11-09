'use strict';

// AI eval engine tests.
//
// Run directly:  node games/ai-eval/test.js
//
// Covers:
//   - JSON deep equality with arrays-as-sets
//   - Wilson 95% interval against hand-calculated / published values
//   - tolerant JSON extraction (fenced blocks, prose, trailing commas)
//   - line diff counting
//   - task-bank truth cross-checks against the shared engines
//   - seeded sampling determinism and digest stability
//   - suite A builtin (>=95%) vs random control
//   - suite B mirror play + illegal-action accounting
//   - suite C builtin fixes vs random (sandboxed temp dirs)
//   - HTTP adapter timeout retry, 5xx retry, invalid JSON, key non-leakage

var http = require('node:http');
var fs = require('fs');
var path = require('path');

var lib = require('../tests/lib.js');
var s = lib.suite('ai-eval');

var score = require('./score.js');
var tasks = require('./tasks.js');
var adapters = require('./adapters.js');
var runner = require('./runner.js');
var H = require('../shared/hand-eval.js');
var TCG = require('../shared/tcg.js');

function startHttpServer() {
  return new Promise(function (resolve) {
    var counts = {};
    var server = http.createServer(function (req, res) {
      var body = '';
      req.on('data', function (d) { body += d; });
      req.on('end', function () {
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        var model = parsed && parsed.model;
        counts[model] = (counts[model] || 0) + 1;
        function reply(content, status) {
          var payload = JSON.stringify({ choices: [{ message: { content: content } }] });
          res.writeHead(status || 200, { 'content-type': 'application/json' });
          res.end(payload);
        }
        if (model === 'delay') {
          var timer = setTimeout(function () { reply('{"winning":true}'); }, 300);
          if (timer.unref) timer.unref();
          return;
        }
        if (model === 'badjson') { reply('not json at all'); return; }
        if (model === 'retry500') {
          if (counts[model] === 1) {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end('boom');
          } else {
            reply('{"winning":true}');
          }
          return;
        }
        reply('{"winning":true}');
      });
    });
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port, counts: counts });
    });
  });
}

function stopHttpServer(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

function modelAdapter(port, model) {
  return adapters.http({
    baseUrl: 'http://127.0.0.1:' + port + '/v1',
    model: model,
    apiKey: 'test-key-not-real',
    timeoutMs: 80,
    retry: 1
  });
}

function mahjongProbeTask() {
  return {
    id: 'probe-mj',
    suite: 'A',
    family: 'mahjong',
    prompt: '是否胡牌？',
    data: { tiles34: new Array(34).fill(0) }
  };
}

async function main() {
  /* ============================== deepEqual ============================== */

  s.group('JSON 深度相等与集合比较', function () {
    s.ok('原始值相等', score.deepEqual(1, 1));
    s.ok('数字与字符串不相等', !score.deepEqual(1, '1'));
    s.ok('对象键顺序无关', score.deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
    s.ok('数组按集合比较（顺序无关）', score.deepEqual([1, 2, 3], [3, 1, 2]));
    s.ok('数组按集合比较（重复忽略）', score.deepEqual([1, 1, 2], [2, 1]));
    s.ok('嵌套对象中的数组仍是集合',
      score.deepEqual({ x: [{ a: 1 }, { b: 2 }] }, { x: [{ b: 2 }, { a: 1 }] }));
    s.ok('ordered 选项要求顺序', !score.deepEqual([1, 2], [2, 1], { arraysAsSets: false }));
    s.ok('null 与 undefined 不同', !score.deepEqual(null, undefined));
    s.ok('动作对象按集合相等',
      score.deepEqual([{ type: 'endTurn' }, { type: 'attack', attacker: 'u1', target: 'core' }],
        [{ type: 'attack', target: 'core', attacker: 'u1' }, { type: 'endTurn' }]));
    s.eq('canonicalKey 键顺序稳定',
      score.canonicalKey({ a: 1, b: [2, 3] }), score.canonicalKey({ b: [3, 2], a: 1 }));
  });

  /* ============================ JSON tolerance =========================== */

  s.group('JSON 容错', function () {
    s.eq('直接 JSON', score.parseJsonLoose('{"a":1}').value, { a: 1 });
    s.eq('```json 围栏', score.parseJsonLoose('```json\n{"a":1}\n```').value, { a: 1 });
    s.eq('围栏无语言标记', score.parseJsonLoose('```\n[1,2]\n```').value, [1, 2]);
    s.eq('前后有解释文字', score.parseJsonLoose('答案是 {"a":1} 就这样').value, { a: 1 });
    s.eq('尾随逗号', score.parseJsonLoose('{"a":1,}').value, { a: 1 });
    s.eq('字符串内的花括号', score.parseJsonLoose('{"a":"}","b":2}').value, { a: '}', b: 2 });
    s.ok('空输出失败', !score.parseJsonLoose('   ').ok);
    s.ok('非 JSON 失败', !score.parseJsonLoose('no json here').ok);
  });

  /* ============================== Wilson CI ==============================
   * Hand-calculated with z=1.959963984540054:
   *   0/10   -> [0, 0.2775327999]
   *   10/10  -> [0.7224672001, 1]
   *   50/100 -> [0.4038315304, 0.5961684696]
   *   58/100 -> [0.4820648670, 0.6720161733]
   *   10/20  -> [0.2992980082, 0.7007019918]
   *   1/1    -> [0.2065493144, 1]
   * ===================================================================== */

  s.group('Wilson 95% 置信区间（手算对照）', function () {
    var a = score.wilsonInterval(0, 10);
    s.near('0/10 下界', a.low, 0, 1e-12);
    s.near('0/10 上界', a.high, 0.2775327999, 1e-9);
    var b = score.wilsonInterval(10, 10);
    s.near('10/10 下界', b.low, 0.7224672001, 1e-9);
    s.near('10/10 上界', b.high, 1, 1e-12);
    var c = score.wilsonInterval(50, 100);
    s.near('50/100 下界', c.low, 0.4038315304, 1e-9);
    s.near('50/100 上界', c.high, 0.5961684696, 1e-9);
    var d = score.wilsonInterval(58, 100);
    s.near('58/100 下界', d.low, 0.4820648670, 1e-9);
    s.near('58/100 上界', d.high, 0.6720161733, 1e-9);
    var e = score.wilsonInterval(10, 20);
    s.near('10/20 下界', e.low, 0.2992980082, 1e-9);
    s.near('10/20 上界', e.high, 0.7007019918, 1e-9);
    var f = score.wilsonInterval(1, 1);
    s.near('1/1 下界', f.low, 0.2065493144, 1e-9);
    s.ok('n=0 返回 null', score.wilsonInterval(0, 0) === null);
    var wide = score.wilsonInterval(5, 10);
    var narrow = score.wilsonInterval(100, 200);
    s.ok('样本越大区间越窄',
      (wide.high - wide.low) > (narrow.high - narrow.low));
    s.near('p 字段', c.p, 0.5, 1e-12);
    s.eq('n 字段', c.n, 100);
  });

  /* ============================== line diff ============================== */

  s.group('改动行数统计', function () {
    s.eq('相同文件', score.diffLineCount('a\nb\nc', 'a\nb\nc').total, 0);
    var one = score.diffLineCount('a\nb\nc', 'a\nB\nc');
    s.eq('一行替换算 2', one.total, 2);
    s.eq('替换的删除行', one.removed, 1);
    s.eq('替换的新增行', one.added, 1);
    s.eq('插入一行', score.diffLineCount('a\nb', 'a\nx\nb').total, 1);
    s.eq('CRLF 归一化', score.diffLineCount('a\r\nb', 'a\nb').total, 0);
  });

  /* ================================ bank ================================= */

  var bank = tasks.generateABank();
  s.group('题库与真值由引擎计算', function () {
    s.eq('题量 360', bank.length, 360);
    var sizes = tasks.bankSizes();
    s.eq('麻将 100', sizes.mahjong, 100);
    s.eq('扑克牌型 60', sizes['poker-category'], 60);
    s.eq('扑克比较 40', sizes['poker-compare'], 40);
    s.eq('五子棋 80', sizes.gomoku, 80);
    s.eq('TCG 合法动作 80', sizes['tcg-legal'], 80);

    var mjOk = bank.filter(function (t) { return t.family === 'mahjong'; })
      .every(function (t) {
        return t.expected.winning === H.checkWinningHand(t.data.tiles34).winning;
      });
    s.ok('全部麻将真值 = HandEval.checkWinningHand', mjOk);

    var pkOk = bank.filter(function (t) { return t.family === 'poker-category'; })
      .every(function (t) {
        var ev = H.evalPoker(t.data.cards);
        return t.expected.category === ev.key && t.expected.rank === ev.rank &&
          t.expected.tiebreak.join(',') === ev.tiebreak.join(',');
      });
    s.ok('全部扑克牌型真值 = HandEval.evalPoker', pkOk);

    var cmpOk = bank.filter(function (t) { return t.family === 'poker-compare'; })
      .every(function (t) {
        return t.expected.compare ===
          H.comparePoker(H.evalPoker(t.data.a), H.evalPoker(t.data.b));
      });
    s.ok('全部扑克比较真值 = HandEval.comparePoker', cmpOk);

    var gmkOk = bank.filter(function (t) { return t.family === 'gomoku'; })
      .every(function (t) { return t.expected.winner === adapters.gomokuResult(t.data.board); });
    s.ok('全部五子棋真值 = rules.js 胜线扫描', gmkOk);

    var tcgOk = bank.filter(function (t) { return t.family === 'tcg-legal'; })
      .slice(0, 10).every(function (t) {
        var match = TCG.createMatch(t.data.setup);
        t.data.history.forEach(function (a) { match.apply(a); });
        return score.deepEqual(match.legalActions(t.data.viewedPlayer), t.expected);
      });
    s.ok('前 10 个 TCG 真值 = tcg.js legalActions', tcgOk);

    var pairs = 0, orphans = 0, falseHands = 0, draws = 0, ties = 0, wheels = 0, royals = 0;
    bank.forEach(function (t) {
      if (t.family === 'mahjong') {
        var r = H.checkWinningHand(t.data.tiles34);
        if (!r.winning) falseHands++;
        else {
          if (r.patterns.indexOf('七对') >= 0) pairs++;
          if (r.patterns.indexOf('十三幺') >= 0) orphans++;
        }
      }
      if (t.family === 'poker-compare' && t.expected.compare === 0) ties++;
      if (t.family === 'gomoku' && t.expected.winner === 'draw') draws++;
      if (t.family === 'poker-category') {
        var ev = H.evalPoker(t.data.cards);
        if (ev.rank === 4 && ev.tiebreak[0] === 5) wheels++;
        if (ev.rank === 9) royals++;
      }
    });
    s.ok('含七对正例', pairs >= 15);
    s.ok('含十三幺正例', orphans >= 10);
    s.ok('含诈胡/未胡负例', falseHands >= 40);
    s.ok('含五子棋满盘和棋', draws === 8);
    s.ok('含扑克平局比较', ties === 10);
    s.ok('含 A2345 轮子顺子', wheels >= 1);
    s.ok('含皇家同花顺', royals >= 2);
  });

  /* ============================== sampling =============================== */

  s.group('seed 抽样与可复现性', function () {
    var a1 = tasks.sampleTasks(bank, 40, 42, 'A').map(function (t) { return t.id; });
    var a2 = tasks.sampleTasks(bank, 40, 42, 'A').map(function (t) { return t.id; });
    var b1 = tasks.sampleTasks(bank, 40, 43, 'A').map(function (t) { return t.id; });
    s.eq('同 seed 同抽样', a1.join(','), a2.join(','));
    s.ok('换 seed 抽样不同', a1.join(',') !== b1.join(','));
    s.eq('n 大于题量时返回全部', tasks.sampleTasks(bank, 999, 42, 'A').length, bank.length);
    s.ok('engineVersion 格式', /^ai-eval\/1\.0\.0\+sha256:[0-9a-f]{16}$/.test(tasks.engineVersion()));
    s.eq('engineVersion 进程内稳定', tasks.engineVersion(), tasks.engineVersion());
  });

  /* =============================== suite A =============================== */

  var suiteA = await (async function () {
    var builtinAdapter = adapters.builtin();
    var randomAdapter = adapters.random(42);
    var full = await runner.runSuite({ suite: 'A', seed: 42, adapter: builtinAdapter, n: 360 });
    var randomRun = await runner.runSuite({ suite: 'A', seed: 42, adapter: randomAdapter, n: 360 });
    var d1 = await runner.runSuite({ suite: 'A', seed: 42, adapter: adapters.builtin(), n: 30 });
    var d2 = await runner.runSuite({ suite: 'A', seed: 42, adapter: adapters.builtin(), n: 30 });
    var d3 = await runner.runSuite({ suite: 'A', seed: 43, adapter: adapters.builtin(), n: 30 });
    return { full: full, randomRun: randomRun, d1: d1, d2: d2, d3: d3 };
  })();

  s.group('组 A：builtin 满分 / random 下限', function () {
    var full = suiteA.full;
    var randomRun = suiteA.randomRun;
    s.near('builtin 全题库 100%', full.summary.passRate, 1, 1e-12);
    s.eq('builtin 360 分', full.summary.score, 360);
    s.ok('builtin 无 invalid_format',
      full.cases.every(function (c) { return c.detail.reason !== 'invalid_format'; }));

    s.ok('random 显著低于 builtin', randomRun.summary.passRate < 0.35);
    s.ok('random 低于 builtin 至少 60 个百分点',
      full.summary.passRate - randomRun.summary.passRate > 0.6);
    s.ok('random 在麻将上接近 1/2 选项',
      Math.abs(randomRun.cases.filter(function (c) {
        return c.detail.family === 'mahjong';
      }).filter(function (c) { return c.pass; }).length / 100 - 0.5) < 0.15);
    s.ok('random 在 TCG 集合题上接近 0',
      randomRun.cases.filter(function (c) {
        return c.detail.family === 'tcg-legal' && c.pass;
      }).length === 0);

    s.eq('同 seed 两次 digest 相同', suiteA.d1.digest, suiteA.d2.digest);
    s.eq('同 seed 两次 cases 相同',
      JSON.stringify(suiteA.d1.cases), JSON.stringify(suiteA.d2.cases));
    s.ok('换 seed digest 不同', suiteA.d1.digest !== suiteA.d3.digest);
  });

  /* =============================== suite B =============================== */

  var suiteB = await (async function () {
    var mirror = await runner.runSuite({ suite: 'B', seed: 42, adapter: adapters.builtin(), n: 2 });
    var bad = {
      name: 'bad-mover',
      move: function () { return { type: 'attack', attacker: 'does-not-exist', target: 'core' }; },
      answer: function () { return null; },
      solve: function () { return null; }
    };
    var illegalRun = await runner.runSuite({ suite: 'B', seed: 7, adapter: bad, n: 1 });
    var randomRun = await runner.runSuite({ suite: 'B', seed: 42, adapter: adapters.random(42), n: 2 });
    return { mirror: mirror, illegalRun: illegalRun, randomRun: randomRun };
  })();

  s.group('组 B：对局与非法动作', function () {
    var mirror = suiteB.mirror;
    s.eq('镜像对局 4 局', mirror.summary.total, 4);
    s.eq('镜像对局无非法动作', mirror.summary.illegal, 0);
    s.eq('胜/负/和平局计数守恒',
      mirror.summary.wins + mirror.summary.losses + mirror.summary.draws, mirror.summary.total);
    s.ok('每局结果合法', mirror.cases.every(function (c) {
      return ['win', 'loss', 'draw', 'error'].indexOf(c.detail.result) >= 0;
    }));
    if (mirror.summary.ci) {
      s.ok('CI 覆盖点估计',
        mirror.summary.ci.low <= mirror.summary.ci.p &&
        mirror.summary.ci.p <= mirror.summary.ci.high);
    } else {
      s.ok('无决胜局时 CI 为 null', mirror.summary.ci === null);
    }

    var illegalRun = suiteB.illegalRun;
    s.ok('非法动作被记录', illegalRun.summary.illegal >= 1);
    s.ok('非法动作判负', illegalRun.summary.losses >= 1);
    s.ok('非法动作带 stable code', illegalRun.cases.some(function (c) {
      return c.detail.illegal && c.detail.illegal.code === 'illegal_action';
    }));

    s.eq('random 对局完成 4 局', suiteB.randomRun.summary.total, 4);
    s.eq('random 不产生非法动作', suiteB.randomRun.summary.illegal, 0);
  });

  /* =============================== suite C =============================== */

  var suiteC = await (async function () {
    var builtinRun = await runner.runSuite({
      suite: 'C', seed: 42, adapter: adapters.builtin(), forceBuiltinC: true
    });
    var randomRun = await runner.runSuite({
      suite: 'C', seed: 42, adapter: adapters.random(42), forceBuiltinC: true
    });
    return { builtinRun: builtinRun, randomRun: randomRun };
  })();

  s.group('组 C：红测试变绿', function () {
    var builtinRun = suiteC.builtinRun;
    s.eq('内置任务数 3', builtinRun.summary.total, 3);
    s.eq('builtin 3/3 通过', builtinRun.summary.passRate, 1);
    s.ok('builtin 有简洁度加分', builtinRun.summary.score > 3);
    s.ok('builtin 每个任务只改少量行', builtinRun.cases.every(function (c) {
      return c.detail.changedLines > 0 && c.detail.changedLines <= 4;
    }));

    var randomRun = suiteC.randomRun;
    s.eq('random 0/3 通过', randomRun.summary.passRate, 0);
    s.ok('random 失败原因均为测试未通过', randomRun.cases.every(function (c) {
      return c.detail.reason === 'test_failed';
    }));
    s.eq('random 未改动文件', randomRun.summary.changedLines, 0);
  });

  /* ================================ HTTP ================================= */

  var serverInfo = await startHttpServer();
  var httpResults;
  try {
    httpResults = await (async function () {
      var out = {};
      out.slow = modelAdapter(serverInfo.port, 'delay');
      out.slowResult = await out.slow.answer(mahjongProbeTask());
      out.bad = modelAdapter(serverInfo.port, 'badjson');
      out.badResult = await out.bad.answer(mahjongProbeTask());
      out.retry = modelAdapter(serverInfo.port, 'retry500');
      out.retryResult = await out.retry.answer(mahjongProbeTask());
      out.ok = modelAdapter(serverInfo.port, 'ok');
      out.okResult = await out.ok.answer(mahjongProbeTask());
      return out;
    })();
  } finally {
    await stopHttpServer(serverInfo.server);
  }

  s.group('HTTP 适配器：超时/重试/容错/不泄露 key', function () {
    s.ok('超时降级为 invalid_format', adapters.isInvalid(httpResults.slowResult));
    s.eq('超时原因', httpResults.slowResult.reason, 'timeout');
    s.eq('超时只重试 1 次（共 2 请求）', serverInfo.counts.delay, 2);

    s.ok('解析失败记为 invalid_format', adapters.isInvalid(httpResults.badResult));
    s.eq('解析失败原因', httpResults.badResult.reason, 'invalid_format');
    s.eq('解析失败不重试（1 请求）', serverInfo.counts.badjson, 1);

    s.eq('5xx 后重试成功', httpResults.retryResult, { winning: true });
    s.eq('5xx 共 2 请求', serverInfo.counts.retry500, 2);

    s.eq('正常 JSON 被解析', httpResults.okResult, { winning: true });

    var serialized = JSON.stringify([
      httpResults.slowResult, httpResults.badResult,
      httpResults.retryResult, httpResults.okResult
    ]);
    s.ok('结果中不含 API key', serialized.indexOf('test-key-not-real') < 0);
  });

  /* ------------------- agent-api protocol integration ------------------- */

  // Register a mock 'tcg' only inside this test process. It exercises the
  // unified protocol (p1/p2 seats, apply(id), status().winner) without
  // touching games/shared/agent-api.js on disk.
  var agentApiResult = null;
  var agentApiPath = path.join(__dirname, '..', 'shared', 'agent-api.js');
  if (fs.existsSync(agentApiPath)) {
    var GameAgent = require(agentApiPath);
    GameAgent.register('tcg', function () {
      var turn = 0, moves = 0;
      return {
        seats: ['p1', 'p2'],
        state: function () { return { activePlayer: turn, players: [], moves: moves }; },
        player: function () { return turn === 0 ? 'p1' : 'p2'; },
        legalActions: function () {
          return [{ id: 'end-' + moves, type: 'endTurn', payload: {}, desc: 'end turn' }];
        },
        apply: function (id) {
          if (String(id) !== 'end-' + moves) return { ok: false, error: 'bad id ' + id };
          turn = 1 - turn; moves++;
          return { ok: true };
        },
        status: function () {
          return { phase: moves >= 4 ? 'over' : 'playing', winner: moves >= 4 ? 'p1' : null };
        },
        hash: function () { return 'h' + moves; }
      };
    });
    agentApiResult = await runner.runSuite({
      suite: 'B', seed: 1, adapter: adapters.builtin(), n: 1
    });
  }

  s.group('agent-api 统一协议（测试内 mock 注册）', function () {
    s.ok('检测到 games/shared/agent-api.js', fs.existsSync(agentApiPath));
    if (!agentApiResult) return;
    s.ok('组 B 走 agent-api 会话',
      agentApiResult.cases.every(function (c) { return c.detail.session === 'agent-api'; }));
    s.eq('两局都完成', agentApiResult.summary.total, 2);
    s.eq('座位映射后 p1 胜、p2 负', agentApiResult.summary.wins + '/' +
      agentApiResult.summary.losses, '1/1');
    s.eq('先手座位判胜',
      agentApiResult.cases.filter(function (c) { return c.detail.agentSeat === 'p1'; })[0].detail.result,
      'win');
    s.eq('后手座位判负',
      agentApiResult.cases.filter(function (c) { return c.detail.agentSeat === 'p2'; })[0].detail.result,
      'loss');
  });

  s.done();
}

main().catch(function (e) {
  console.error('test crashed: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
