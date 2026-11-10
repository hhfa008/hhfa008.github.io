'use strict';

/* 终局 UI 断言：同步跑共享的 terminal-cli.mjs，把结果记成一条 test.js 断言。
 *
 * 为什么是子进程：页面要用真实 headless Chrome + DOM 事件跑，Node 单线程同步
 * 测试无法直接 await；子进程隔离也能避免一个页面的异常影响其他游戏。
 *
 * 退出码：0 通过，1 失败，77 无 Chrome（记 SKIP，不伪装成通过）。
 */

var child = require('child_process');
var path = require('path');

module.exports.check = function (slug, s) {
  var cli = path.join(__dirname, 'terminal-cli.mjs');
  var root = path.resolve(__dirname, '../../../..');
  var res = child.spawnSync(process.execPath, [cli, '--slug', slug, '--root', root], {
    encoding: 'utf8',
    timeout: 180000,
  });
  var out = String(res.stdout || '') + String(res.stderr || '');
  if (out.trim()) console.log(out.trim());

  if (res.status === 77) {
    s.ok('终局 UI（' + slug + '）：SKIP（headless Chrome 不可用）', true, 'skipped');
    return;
  }
  if (res.error) {
    s.ok('终局 UI：一局到结算、标题非空、可重开（' + slug + '）', false, '子进程错误：' + (res.error.code || res.error.message));
    return;
  }
  if (res.status === 0) {
    s.ok('终局 UI：一局到结算、标题非空、可重开（' + slug + '）', true);
    return;
  }
  var line = (out.match(/\{"slug".*?\}/g) || []).pop() || ('rc=' + res.status);
  s.ok('终局 UI：一局到结算、标题非空、可重开（' + slug + '）', false, line.slice(0, 700));
};
