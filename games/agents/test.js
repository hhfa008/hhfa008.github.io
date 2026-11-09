'use strict';

// Task board tests. The board logic lives in the <script id="board-core">
// block of games/agents/index.html; we extract it so tests run against the
// exact same source the browser runs, with no DOM dependency.

var lib = require('../tests/lib.js');
var s = lib.suite('agents board');

var html = lib.page(__dirname);
var AB = lib.evalScript(html, 'board-core', 'globalThis.AgentBoard');

function task(over) {
  var base = {
    id: 'task',
    title: '任务标题',
    why: '为什么做这个任务。',
    files: ['games/example/index.html'],
    acceptance: [{ cmd: 'node games/tests/run-all.js', expect: 'pass' }],
    effort: 'M',
    dependsOn: [],
    owner: null,
    status: 'open'
  };
  return Object.assign(base, over || {});
}

var RAW = {
  version: 1,
  updated: '2026-11-10',
  stats: { games: 7, assertions: 70 },
  tasks: [
    task({
      id: 'save-state-chess',
      title: '象棋：刷新后恢复对局',
      why: '切后台再回来对局丢了，需要恢复棋盘与轮次。',
      files: ['games/chess/index.html'],
      effort: 'S'
    }),
    task({
      id: 'hall-keyboard',
      title: '大厅：键盘可达',
      why: '只用键盘也应能走完所有游戏卡片。',
      files: ['games/index.html'],
      effort: 'M'
    }),
    task({
      id: 'voice-reconnect',
      title: '语音房：断线重连',
      why: '弱网掉线后没有提示，需要自动重连。',
      files: ['games/voice-room/index.html', 'games/voice-room/worker/index.js'],
      acceptance: [
        { cmd: 'node games/tests/run-all.js', expect: 'pass' },
        { cmd: 'node games/voice-room/test.js', expect: 'pass' }
      ],
      effort: 'L',
      dependsOn: ['docs-en']
    }),
    task({
      id: 'docs-en',
      title: '规则页：英文版',
      why: '英文入口需要对应的 rules-en.html。',
      files: ['games/gomoku/rules-en.html'],
      effort: 'M',
      status: 'doing'
    }),
    task({
      id: 'tap-score',
      title: 'Tap Match：最高分',
      why: '最高分只存在内存里，刷新就丢。',
      files: ['games/tap-match/index.html'],
      effort: 'S',
      status: 'done'
    }),
    task({
      id: 'aaa-open-s',
      title: '24 点：计时',
      why: '加一个 60 秒倒计时，超时判负。',
      files: ['games/24game/index.html'],
      effort: 'S'
    })
  ]
};

var BOARD = AB.normalizeBoard(RAW);

function ids(list) {
  return list.map(function (t) { return t.id; });
}
function idsSorted(list) {
  return ids(list).sort();
}
function linesBetween(text, startMarker, endMarker) {
  var a = text.indexOf(startMarker);
  var b = a < 0 ? -1 : text.indexOf(endMarker, a + startMarker.length);
  if (a < 0 || b < 0) return [];
  return text.slice(a, b).match(/^\d+\.\s/gm) || [];
}

s.group('降级与结构校验', function () {
  var fb = AB.fallbackBoard('HTTP 404');
  s.ok('fetch 失败标记 isSample:true', fb.isSample === true);
  s.eq('降级返回内置示例任务', fb.data.tasks.length, 4);
  s.eq('保留失败原因', fb.error, 'HTTP 404');
  s.eq('示例提示文案固定', AB.SAMPLE_NOTICE, '示例数据，看板未就绪');
  s.ok('示例 id 全部带 sample- 前缀', fb.data.tasks.every(function (t) {
    return t.id.indexOf('sample-') === 0;
  }));
  s.ok('示例任务都有验收命令', fb.data.tasks.every(function (t) {
    return t.acceptance.length > 0;
  }));
  s.ok('示例数据按真实结构归一化', AB.normalizeBoard(AB.sampleBoard()).ok === true);
  s.ok('真实数据不标示例', BOARD.ok === true && BOARD.isSample === false);
  s.ok('null 判为结构不符', AB.normalizeBoard(null).ok === false);
  s.ok('缺 tasks 数组判失败', AB.normalizeBoard({}).ok === false);
  s.ok('tasks 不是数组判失败', AB.normalizeBoard({ tasks: 'x' }).ok === false);
  s.ok('缺 title 的任务判失败', AB.normalizeBoard({ tasks: [{ id: 'x' }] }).ok === false);
  var odd = AB.normalizeBoard({ tasks: [task({ id: 'odd', status: 'blocked', effort: 'XL' })] });
  s.eq('未知状态归入 unknown', odd.data.tasks[0].status, 'unknown');
  s.eq('未知工作量归入 ?', odd.data.tasks[0].effort, '?');
});

s.group('筛选', function () {
  var all = BOARD.data.tasks;
  s.eq('status=open 只返回待开始', idsSorted(AB.filterTasks(all, { status: 'open' })),
    ['aaa-open-s', 'hall-keyboard', 'save-state-chess', 'voice-reconnect']);
  s.eq('status=doing 只返回进行中', ids(AB.filterTasks(all, { status: 'doing' })), ['docs-en']);
  s.eq('status=all 返回全部', AB.filterTasks(all, { status: 'all' }).length, 6);
  s.eq('effort=L 只返回大任务', ids(AB.filterTasks(all, { effort: 'L' })), ['voice-reconnect']);
  s.eq('关键词命中标题', ids(AB.filterTasks(all, { q: '键盘' })), ['hall-keyboard']);
  s.eq('关键词命中文件路径且忽略大小写', ids(AB.filterTasks(all, { q: 'CHESS' })), ['save-state-chess']);
  s.eq('关键词命中 why', ids(AB.filterTasks(all, { q: '掉线' })), ['voice-reconnect']);
  s.eq('关键词首尾空格被裁掉', ids(AB.filterTasks(all, { q: '  chess  ' })), ['save-state-chess']);
  s.eq('状态+工作量组合筛选', ids(AB.filterTasks(all, { status: 'open', effort: 'M' })), ['hall-keyboard']);
  s.eq('无命中返回空数组', AB.filterTasks(all, { q: '不存在的关键词xyz' }).length, 0);
  s.eq('空筛选保持原顺序', ids(AB.filterTasks(all, {})), ids(all));
});

s.group('排序', function () {
  var before = ids(BOARD.data.tasks);
  var sorted = AB.sortTasks(BOARD.data.tasks);
  s.eq('open 在前、done 在后', ids(sorted),
    ['aaa-open-s', 'save-state-chess', 'hall-keyboard', 'voice-reconnect', 'docs-en', 'tap-score']);
  s.eq('sortTasks 不修改入参', ids(BOARD.data.tasks), before);
  var effortSeq = sorted.slice(0, 3).map(function (t) { return t.effort; });
  s.eq('同状态内 effort S→M→L', effortSeq, ['S', 'S', 'M']);
  var ties = AB.sortTasks([
    task({ id: 'b', effort: 'S' }),
    task({ id: 'a', effort: 'S' })
  ]);
  s.eq('同状态同工作量按 id 稳定排列', ids(ties), ['a', 'b']);
});

s.group('给 agent 的指令', function () {
  var target = null;
  BOARD.data.tasks.forEach(function (t) { if (t.id === 'voice-reconnect') target = t; });
  var prompt = AB.buildPrompt(target);
  s.ok('包含任务 id', prompt.indexOf('voice-reconnect') >= 0);
  s.ok('包含每条验收命令（1/2）', prompt.indexOf('node games/tests/run-all.js') >= 0);
  s.ok('包含每条验收命令（2/2）', prompt.indexOf('node games/voice-room/test.js') >= 0);
  s.ok('包含期望值', prompt.indexOf('期望：pass') >= 0);
  s.ok('包含每个目标文件', target.files.every(function (f) { return prompt.indexOf(f) >= 0; }));
  s.eq('DoD 恰好三条', linesBetween(prompt, 'Definition of Done', '禁止事项：').length, 3);
  s.ok('DoD 含全量测试命令', prompt.indexOf(AB.RUN_ALL_CMD) >= 0);
  s.ok('DoD 含 check-tasks --task id', prompt.indexOf('check-tasks.js --task voice-reconnect') >= 0);
  s.eq('禁止事项恰好两条', linesBetween(prompt, '禁止事项：', '完成后请贴出').length, 2);
  s.ok('禁止引入外部依赖', prompt.indexOf('不要引入外部依赖') >= 0);
  s.ok('禁止部署写进 prompt', prompt.indexOf('不要 commit、push 或部署') >= 0);
  s.ok('包含依赖信息', prompt.indexOf('docs-en') >= 0);
  s.ok('不含 macOS 用户目录', prompt.indexOf('/Users/') < 0);
  s.ok('不含 Linux 用户目录', prompt.indexOf('/home/') < 0);
  s.ok('不含 file:// 本地地址', prompt.indexOf('file://') < 0);
  s.ok('不含邮箱', !/[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/.test(prompt));
  s.ok('没有 undefined 漏出', prompt.indexOf('undefined') < 0);

  var dirty = task({
    id: 'dirty',
    title: '看 /Users/fa/secret 与 me@example.com',
    why: '材料在 /home/someone/notes.md。',
    files: ['/Users/fa/secret/file.js'],
    acceptance: [{ cmd: 'node /Users/fa/secret/run.js', expect: 'pass' }]
  });
  var dirtyPrompt = AB.buildPrompt(dirty);
  s.ok('任务文本里的本地路径被移除', dirtyPrompt.indexOf('/Users/') < 0 && dirtyPrompt.indexOf('/home/') < 0);
  s.ok('任务文本里的邮箱被移除', dirtyPrompt.indexOf('me@example.com') < 0);
  s.ok('文件列表里的本地路径被移除', dirtyPrompt.indexOf('/Users/fa/secret/file.js') < 0);
  s.ok('验收命令里的本地路径被移除', dirtyPrompt.indexOf('node /Users/') < 0);
});

s.group('统计', function () {
  var counts = AB.countByStatus(BOARD.data.tasks);
  s.eq('总数', counts.all, 6);
  s.eq('open 计数', counts.open, 4);
  s.eq('doing 计数', counts.doing, 1);
  s.eq('done 计数', counts.done, 1);
  s.eq('unknown 计数', counts.unknown, 0);

  var fromBoard = AB.readStats({ stats: { games: 7, assertions: 70 } }, { games: 24, assertions: 959 });
  s.eq('TASKS.json 自带统计优先', [fromBoard.games, fromBoard.assertions], [7, 70]);
  var fromSite = AB.readStats({}, { games: 24, assertions: 959 });
  s.eq('缺 TASKS 统计时用站点数据', [fromSite.games, fromSite.assertions], [24, 959]);
  var none = AB.readStats({}, {});
  s.eq('都取不到时为 null', [none.games, none.assertions], [null, null]);
  var broken = AB.readStats({ stats: { games: '24' } }, {});
  s.eq('非数字不冒充统计', [broken.games, broken.assertions], [null, null]);
  s.eq('null 统计显示破折号', AB.formatStat(null), '—');
  s.eq('字符串统计显示破折号', AB.formatStat('24'), '—');
  s.eq('真实数字原样显示', AB.formatStat(959), '959');
});

s.done();
