'use strict';

/*
 * Pure-function tests for games/ai-eval/index.html.
 *
 * Run: node games/ai-eval/page-test.js
 *
 * The page keeps its rendering helpers inline (single-file page). The test
 * extracts the marked core block out of index.html, so the assertions run
 * against exactly the code the browser runs.
 */

var lib = require('../tests/lib.js');

var html = lib.page(__dirname);
var AiEval = lib.evalBetween(html, '// __PAGE_CORE_START__', '// __PAGE_CORE_END__', 'AiEval');
var s = lib.suite('games/ai-eval/page');

function entry(model, a, b, c) {
  return {
    model: model,
    submitter: model + ' 提交者',
    groupA: a,
    groupB: b === null ? null : { winRate: b, games: 60 },
    groupC: c,
    seed: 42,
    date: '2026-11-10',
    resultsFile: 'results/' + model + '-seed42.json'
  };
}

s.group('排序：A 降序，并列看 B 胜率', function () {
  var rows = [
    entry('low', 0.60, 0.90, 0.50),
    entry('high', 0.95, 0.10, 0.50),
    entry('tie-a-strong', 0.92, 0.70, 0.50),
    entry('tie-a-weak', 0.92, 0.30, 0.50)
  ];
  var sorted = AiEval.sortEntries(rows);
  s.eq('A 组最高分排在第一位', sorted[0].model, 'high');
  s.eq('A 组并列时 B 胜率高者优先', [sorted[1].model, sorted[2].model], ['tie-a-strong', 'tie-a-weak']);
  s.eq('A 组分数低的后置', [sorted[0].model, sorted[3].model], ['high', 'low']);
  s.eq('sortEntries 不修改入参顺序', rows.map(function (r) { return r.model; }),
    ['low', 'high', 'tie-a-strong', 'tie-a-weak']);

  var missing = AiEval.sortEntries([
    entry('no-a', null, 0.99, 0.90),
    entry('has-a', 0.10, 0.00, 0.10)
  ]);
  s.eq('A 组缺失的排在有分数者之后', missing[0].model, 'has-a');

  var tieAll = AiEval.sortEntries([
    entry('zeta', 0.5, null, null),
    entry('alpha', 0.5, null, null)
  ]);
  s.eq('全并列时按模型名稳定排序', tieAll.map(function (r) { return r.model; }), ['alpha', 'zeta']);
});

s.group('置信区间格式化', function () {
  s.eq('0.5 / 20 局 → 50% ±20%', AiEval.formatWinRate(0.5, 20), '50% ±20%');
  s.ok('0.5 的输出以「50% ±」开头', AiEval.formatWinRate(0.5, 20).indexOf('50% ±') === 0);
  s.eq('0.7 / 100 局 → 70% ±9%', AiEval.formatWinRate(0.7, 100), '70% ±9%');
  s.eq('缺局数时明确标出，而不是假装有区间', AiEval.formatWinRate(0.5, null), '50%（未报局数）');
  s.eq('胜率非法时降级为破折号', AiEval.formatWinRate('0.5', 20), '—');
  s.eq('局数为 0 视为未报', AiEval.formatWinRate(0.5, 0), '50%（未报局数）');
  s.near('Wilson 半宽约 0.2007', AiEval.winRateHalf(0.5, 20), 0.2007, 0.001);
  s.eq('100% 胜率也有区间，不会收缩成 0', AiEval.formatWinRate(1, 10), '100% ±14%');
  s.eq('0% 胜率给出下界为 0 的区间', AiEval.formatWinRate(0, 10), '0% ±14%');
});

s.group('空榜判定', function () {
  s.eq('null 视为空榜', AiEval.isEmptyBoard(null), true);
  s.eq('undefined 视为空榜', AiEval.isEmptyBoard(undefined), true);
  s.eq('entries 为空数组视为空榜', AiEval.isEmptyBoard({ ok: true, entries: [] }), true);
  s.eq('entries 不是数组视为空榜', AiEval.isEmptyBoard({ ok: true, entries: 'nope' }), true);
  s.eq('normalizeBoard 失败视为空榜', AiEval.isEmptyBoard({ ok: false, entries: [] }), true);
  s.eq('单条成绩不是空榜', AiEval.isEmptyBoard({ ok: true, entries: [{}] }), false);
  s.eq('多条成绩不是空榜', AiEval.isEmptyBoard({ ok: true, entries: [{}, {}] }), false);
  s.eq('直接传数组也支持', AiEval.isEmptyBoard([]), true);
});

s.group('日期格式化', function () {
  s.eq('标准 ISO 日期', AiEval.formatDate('2026-11-10'), '2026.11.10');
  s.eq('带时间的 ISO 日期取日期部分', AiEval.formatDate('2026-11-10T08:30:00Z'), '2026.11.10');
  s.eq('空串降级', AiEval.formatDate(''), '日期未知');
  s.eq('非字符串降级', AiEval.formatDate(20261110), '日期未知');
  s.eq('缺位日期降级', AiEval.formatDate('2026-1-3'), '日期未知');
  s.eq('月份越界降级', AiEval.formatDate('2026-13-10'), '日期未知');
  s.eq('日期越界降级', AiEval.formatDate('2026-11-40'), '日期未知');
});

s.group('数值与 seed 格式化', function () {
  s.eq('小数转百分比', AiEval.formatPercent(0.856), '86%');
  s.eq('0 是有效分数', AiEval.formatPercent(0), '0%');
  s.eq('1 是 100%', AiEval.formatPercent(1), '100%');
  s.eq('百分制输入也能识别', AiEval.formatPercent(85), '85%');
  s.eq('null 降级', AiEval.formatPercent(null), '—');
  s.eq('字符串分数降级', AiEval.formatPercent('0.85'), '—');
  s.eq('越界分数降级', AiEval.formatPercent(150), '—');
  s.eq('负分降级', AiEval.formatPercent(-0.2), '—');
  s.eq('数字 seed 原样显示', AiEval.formatSeed(0), '0');
  s.eq('字符串 seed 去空格', AiEval.formatSeed('  42  '), '42');
  s.eq('缺失 seed 显示破折号', AiEval.formatSeed(null), '—');
});

s.group('合法 board.json 归一化', function () {
  var raw = {
    version: 1,
    updated: '2026-11-10',
    note: '成绩由提交者自报，未做第三方复核',
    entries: [
      entry('model-b', 0.80, 0.55, 0.70),
      entry('model-a', 0.90, 0.40, 0.60)
    ]
  };
  var board = AiEval.normalizeBoard(raw);
  s.eq('根对象合法', board.ok, true);
  s.eq('两条记录都保留', board.entries.length, 2);
  s.eq('归一化后已排序', board.entries.map(function (e) { return e.model; }), ['model-a', 'model-b']);
  s.eq('updated 保留', board.updated, '2026-11-10');
  s.eq('note 保留', board.note, '成绩由提交者自报，未做第三方复核');
  s.eq('合法记录不丢弃', board.dropped, 0);
  s.eq('归一化不重排原始数组', raw.entries.map(function (e) { return e.model; }), ['model-b', 'model-a']);
});

s.group('非法 board.json 降级而不崩', function () {
  s.eq('null 根对象', AiEval.normalizeBoard(null).ok, false);
  s.eq('数组根对象', AiEval.normalizeBoard([]).ok, false);
  s.eq('字符串根对象', AiEval.normalizeBoard('nope').ok, false);
  s.eq('缺少 entries 字段', AiEval.normalizeBoard({ updated: '2026-11-10' }).ok, false);
  s.eq('entries 类型错误', AiEval.normalizeBoard({ entries: 'nope' }).ok, false);
  s.eq('entries 类型错误时给空列表', AiEval.normalizeBoard({ entries: {} }).entries.length, 0);

  var partial = AiEval.normalizeBoard({
    entries: [
      { model: 'bad-types', groupA: '0.9', groupB: 'high', groupC: [], seed: {}, date: 42, resultsFile: 7 },
      { submitter: '没有模型名' },
      'not-an-object',
      { model: 'good', groupA: 0.5, groupB: { winRate: '0.5', games: '60' }, groupC: 0.5 }
    ]
  });
  s.eq('部分记录非法时整体仍可用', partial.ok, true);
  s.eq('无模型名的记录被丢弃', partial.entries.length, 2);
  s.eq('记录非法计数正确', partial.dropped, 2);

  var bad = partial.entries.filter(function (e) { return e.model === 'bad-types'; })[0];
  s.eq('字符串分数降级为 null', bad.groupA, null);
  s.eq('字符串胜率降级为 null', bad.groupBWin, null);
  s.eq('非法日期保留原值，格式化时再降级', AiEval.formatDate(bad.date), '日期未知');
  s.eq('非法 resultsFile 视为不可复现', bad.reproducible, false);

  var good = partial.entries.filter(function (e) { return e.model === 'good'; })[0];
  s.eq('组对象里的字符串胜率同样降级', good.groupBWin, null);
  s.eq('组对象里的字符串局数降级', good.groupBGames, null);
  s.eq('合法 A 组分数保留', good.groupA, 0.5);
});

s.group('可复现标记只认结果文件', function () {
  var withFile = AiEval.normalizeEntry({ model: 'm', resultsFile: 'results/m.json' });
  var blankFile = AiEval.normalizeEntry({ model: 'm', resultsFile: '   ' });
  var noFile = AiEval.normalizeEntry({ model: 'm' });
  var claimed = AiEval.normalizeEntry({ model: 'm', reproducible: true });
  s.eq('有结果文件 → 可复现', withFile.reproducible, true);
  s.eq('空白文件路径 → 不可复现', blankFile.reproducible, false);
  s.eq('缺字段 → 不可复现', noFile.reproducible, false);
  s.eq('只写 reproducible:true 不算，必须有文件', claimed.reproducible, false);
});

s.group('输出可渲染性', function () {
  var board = AiEval.normalizeBoard({
    updated: '2026-11-10',
    entries: [entry('render-me', 0.9, 0.65, 0.8)]
  });
  var e = board.entries[0];
  s.eq('A 组渲染文本', AiEval.formatPercent(e.groupA), '90%');
  s.eq('B 组渲染文本含置信区间', AiEval.formatWinRate(e.groupBWin, e.groupBGames), '65% ±12%');
  s.eq('C 组渲染文本', AiEval.formatPercent(e.groupC), '80%');
  s.eq('日期渲染文本', AiEval.formatDate(e.date), '2026.11.10');
  s.eq('seed 渲染文本', AiEval.formatSeed(e.seed), '42');
});

s.done();
