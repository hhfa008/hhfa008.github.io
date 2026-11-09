#!/usr/bin/env node
'use strict';

/*
 * Task board checker for games/TASKS.json.
 *
 *   node scripts/check-tasks.js                 # schema + referential integrity
 *   node scripts/check-tasks.js --task <id>     # run one task's acceptance commands
 *   node scripts/check-tasks.js --red           # prove every open task is still unfinished
 *   node scripts/check-tasks.js --json          # machine-readable output (combine with above)
 *
 * Exit codes: 0 ok, 1 validation / acceptance / red-check failure, 2 usage error.
 *
 * --red is the anti-rot check. Every open task needs a `probe` that describes
 * the still-UNFINISHED state (for example a save-state marker that is still
 * absent). --red verifies the repository still matches that expectation. If the
 * probe no longer matches, the task is either done or the description is wrong,
 * and this script fails loudly instead of letting the board drift away from
 * reality.
 *
 * Probe types (all read-only):
 *   { "type": "grep", "file": "...", "pattern": "...", "expect": "present|absent" }
 *   { "type": "file-exists", "file": "...", "expect": "present|absent" }
 *   { "type": "cmd", "cmd": "...", "expect": "pass|fail" }
 *
 * `expect` is the UNFINISHED-state expectation, not the done-state one. For a
 * completion marker such as `hhfa-chess-save-v1`, use "absent"; for a stale
 * line that must be removed, use "present". For `cmd`, exit 0 is "pass" and any
 * non-zero exit (or timeout) is "fail".
 */

var fs = require('fs');
var path = require('path');
var child = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var TASKS_PATH = path.join(ROOT, 'games', 'TASKS.json');
var ACCEPT_TIMEOUT_MS = 300000;
var PROBE_TIMEOUT_MS = 60000;
var MAX_BUFFER = 20 * 1024 * 1024;

var STATUSES = { open: 1, doing: 1, done: 1 };
var EFFORTS = { S: 1, M: 1, L: 1 };
var EXPECTS = { pass: 1, fail: 1 };
var PRESENCE = { present: 1, absent: 1 };
var PROBE_TYPES = { grep: 1, 'file-exists': 1, cmd: 1 };

function fail(msg) {
  console.error('check-tasks: ' + msg);
  process.exit(2);
}

function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }

function resolvePath(p) { return path.resolve(ROOT, p); }

function readTasksFile() {
  var raw;
  try {
    raw = fs.readFileSync(TASKS_PATH, 'utf8');
  } catch (e) {
    console.error('check-tasks: cannot read ' + rel(TASKS_PATH) + ': ' + e.message);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('check-tasks: ' + rel(TASKS_PATH) + ' is not valid JSON: ' + e.message);
    process.exit(1);
  }
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(function (x) { return typeof x === 'string' && x.length > 0; });
}

// Extract `node <script>` targets so a typo in an acceptance command is caught
// before anyone runs it. `node -e ...` has no script path and is skipped.
function nodeScriptPaths(cmd) {
  var out = [];
  var re = /(?:^|[;&|]\s*)node\s+([^\s;&|]+)/g;
  var m;
  while ((m = re.exec(cmd))) {
    var token = m[1];
    if (token.charAt(0) !== '-') out.push(token);
  }
  return out;
}

function validateTask(task, index, ids) {
  var errors = [];
  var prefix = 'task[' + index + ']';
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return [prefix + ': must be an object'];
  }
  if (typeof task.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(task.id)) {
    errors.push(prefix + ': id must match /^[a-z0-9][a-z0-9-]*$/');
  } else {
    prefix = 'task "' + task.id + '"';
  }
  if (typeof task.title !== 'string' || !task.title.trim()) errors.push(prefix + ': title must be a non-empty string');
  if (typeof task.why !== 'string' || !task.why.trim()) errors.push(prefix + ': why must be a non-empty string');
  if (!isStringArray(task.files) || task.files.length === 0) {
    errors.push(prefix + ': files must be a non-empty string array');
  } else {
    task.files.forEach(function (f) {
      if (!fs.existsSync(resolvePath(f))) errors.push(prefix + ': files entry does not exist: ' + f);
    });
  }
  if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) {
    errors.push(prefix + ': acceptance must be a non-empty array');
  } else {
    task.acceptance.forEach(function (a, i) {
      var ap = prefix + ' acceptance[' + i + ']';
      if (!a || typeof a !== 'object') { errors.push(ap + ': must be an object'); return; }
      if (typeof a.cmd !== 'string' || !a.cmd.trim()) { errors.push(ap + ': cmd must be a non-empty string'); return; }
      var expect = a.expect == null ? 'pass' : a.expect;
      if (!EXPECTS[expect]) errors.push(ap + ': expect must be "pass" or "fail"');
      nodeScriptPaths(a.cmd).forEach(function (p) {
        if (!fs.existsSync(resolvePath(p))) errors.push(ap + ': script path does not exist: ' + p);
      });
    });
  }
  if (!EFFORTS[task.effort]) errors.push(prefix + ': effort must be S, M or L');
  if (!Array.isArray(task.dependsOn)) {
    errors.push(prefix + ': dependsOn must be an array');
  } else {
    task.dependsOn.forEach(function (d) {
      if (typeof d !== 'string') errors.push(prefix + ': dependsOn entries must be strings');
      else if (!ids[d]) errors.push(prefix + ': dependsOn points at unknown id: ' + d);
      else if (d === task.id) errors.push(prefix + ': dependsOn cannot point at itself');
    });
  }
  if (!('owner' in task) || (task.owner !== null && typeof task.owner !== 'string')) {
    errors.push(prefix + ': owner must be null or a string');
  }
  if (!STATUSES[task.status]) errors.push(prefix + ': status must be open, doing or done');
  if (task.probe != null) {
    var pr = task.probe;
    var pp = prefix + ' probe';
    if (typeof pr !== 'object' || Array.isArray(pr)) {
      errors.push(pp + ': must be an object');
    } else if (!PROBE_TYPES[pr.type]) {
      errors.push(pp + ': type must be grep, file-exists or cmd');
    } else if (pr.type === 'grep') {
      if (typeof pr.file !== 'string' || !pr.file) errors.push(pp + ': file must be a non-empty string');
      else if (!fs.existsSync(resolvePath(pr.file))) errors.push(pp + ': file does not exist: ' + pr.file);
      if (typeof pr.pattern !== 'string' || !pr.pattern) errors.push(pp + ': pattern must be a non-empty string');
      else { try { new RegExp(pr.pattern); } catch (e) { errors.push(pp + ': invalid pattern: ' + e.message); } }
      if (!PRESENCE[pr.expect]) errors.push(pp + ': expect must be "present" or "absent"');
    } else if (pr.type === 'file-exists') {
      if (typeof pr.file !== 'string' || !pr.file) errors.push(pp + ': file must be a non-empty string');
      if (!PRESENCE[pr.expect]) errors.push(pp + ': expect must be "present" or "absent"');
    } else if (pr.type === 'cmd') {
      if (typeof pr.cmd !== 'string' || !pr.cmd.trim()) errors.push(pp + ': cmd must be a non-empty string');
      var pexpect = pr.expect == null ? 'pass' : pr.expect;
      if (!EXPECTS[pexpect]) errors.push(pp + ': expect must be "pass" or "fail"');
    }
  }
  return errors;
}

function validate(tasksDoc) {
  var errors = [];
  var warnings = [];
  if (!tasksDoc || typeof tasksDoc !== 'object' || Array.isArray(tasksDoc)) {
    return { errors: ['top level must be an object'], warnings: [] };
  }
  if (!Number.isInteger(tasksDoc.version) || tasksDoc.version < 1) errors.push('version must be a positive integer');
  if (typeof tasksDoc.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tasksDoc.updated)) {
    errors.push('updated must be a YYYY-MM-DD string');
  }
  if (!Array.isArray(tasksDoc.tasks) || tasksDoc.tasks.length === 0) {
    errors.push('tasks must be a non-empty array');
    return { errors: errors, warnings: warnings };
  }
  var ids = {};
  tasksDoc.tasks.forEach(function (t, i) {
    if (t && typeof t.id === 'string') {
      if (ids[t.id]) errors.push('duplicate id: ' + t.id);
      ids[t.id] = true;
    }
    // First pass records ids so dependsOn can point forward; duplicates above
    // are still reported, so a second pass is not needed.
    void i;
  });
  tasksDoc.tasks.forEach(function (t, i) {
    errors = errors.concat(validateTask(t, i, ids));
  });
  tasksDoc.tasks.forEach(function (t) {
    if (!t || typeof t.id !== 'string') return;
    if (t.status === 'open' && !t.probe) {
      warnings.push('task "' + t.id + '" is open but has no probe; --red cannot guard it');
    }
  });
  return { errors: errors, warnings: warnings };
}

function summarize(tasksDoc) {
  var status = { open: 0, doing: 0, done: 0 };
  var effort = { S: 0, M: 0, L: 0 };
  tasksDoc.tasks.forEach(function (t) {
    if (t && STATUSES[t.status]) status[t.status]++;
    if (t && EFFORTS[t.effort]) effort[t.effort]++;
  });
  return { total: tasksDoc.tasks.length, status: status, effort: effort };
}

function runProbe(probe) {
  if (!probe) return { matches: false, stillRed: false, kind: 'missing', detail: 'no probe' };
  if (probe.type === 'grep') {
    var file = resolvePath(probe.file);
    if (!fs.existsSync(file)) return { matches: false, stillRed: false, kind: 'grep', detail: 'file missing: ' + probe.file };
    var text = fs.readFileSync(file, 'utf8');
    var found = new RegExp(probe.pattern).test(text);
    var want = probe.expect === 'present';
    var matchesGrep = found === want;
    return {
      matches: matchesGrep,
      stillRed: matchesGrep,
      kind: 'grep',
      observed: found ? 'present' : 'absent',
      detail: 'pattern ' + probe.pattern + ' is ' + (found ? 'present' : 'absent') + ' (unfinished state expects ' + probe.expect + ')'
    };
  }
  if (probe.type === 'file-exists') {
    var exists = fs.existsSync(resolvePath(probe.file));
    var wantFile = probe.expect === 'present';
    var matchesFile = exists === wantFile;
    return {
      matches: matchesFile,
      stillRed: matchesFile,
      kind: 'file-exists',
      observed: exists ? 'present' : 'absent',
      detail: probe.file + ' is ' + (exists ? 'present' : 'absent') + ' (unfinished state expects ' + probe.expect + ')'
    };
  }
  if (probe.type === 'cmd') {
    var expectPass = (probe.expect == null ? 'pass' : probe.expect) === 'pass';
    var r = child.spawnSync(probe.cmd, {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER
    });
    var timedOut = r.error && r.error.code === 'ETIMEDOUT';
    var code = timedOut ? null : r.status;
    var passed = !timedOut && code === 0;
    var matchesCmd = passed === expectPass;
    return {
      matches: matchesCmd,
      stillRed: matchesCmd,
      kind: 'cmd',
      exitCode: code,
      timedOut: !!timedOut,
      detail: 'exit ' + (code == null ? 'timeout' : code) + ' (unfinished state expects ' + (expectPass ? 'pass' : 'fail') + ')'
    };
  }
  return { matches: false, stillRed: false, kind: 'unknown', detail: 'unknown probe type: ' + probe.type };
}

function tail(s, n) {
  var lines = String(s || '').trim().split('\n');
  return lines.slice(-n).join('\n');
}

function runAcceptance(task) {
  var results = [];
  task.acceptance.forEach(function (a, i) {
    var expect = a.expect == null ? 'pass' : a.expect;
    // A task may legitimately reference the checker as a meta step. Running it
    // here would recurse forever, so it is reported as SKIP, not PASS.
    if (/check-tasks\.js/.test(a.cmd)) {
      results.push({
        index: i, cmd: a.cmd, expect: expect, skipped: true,
        ok: true, exitCode: null, reason: 'meta self-check skipped to avoid recursion'
      });
      return;
    }
    var r = child.spawnSync(a.cmd, {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      timeout: ACCEPT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER
    });
    var timedOut = r.error && r.error.code === 'ETIMEDOUT';
    var code = timedOut ? null : r.status;
    var ok = timedOut ? false : (expect === 'pass' ? code === 0 : code !== 0);
    results.push({
      index: i,
      cmd: a.cmd,
      expect: expect,
      skipped: false,
      ok: ok,
      exitCode: code,
      timedOut: !!timedOut,
      stdoutTail: tail(r.stdout, 15),
      stderrTail: tail(r.stderr, 15)
    });
  });
  return results;
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function printSchemaHuman(doc, report) {
  if (report.errors.length) {
    console.log('SCHEMA ERRORS (' + report.errors.length + '):');
    report.errors.forEach(function (e) { console.log('  - ' + e); });
  } else {
    console.log('SCHEMA OK');
  }
  if (report.warnings.length) {
    console.log('WARNINGS (' + report.warnings.length + '):');
    report.warnings.forEach(function (w) { console.log('  - ' + w); });
  }
  if (!report.errors.length) {
    var s = summarize(doc);
    console.log('tasks: ' + s.total + ' (open ' + s.status.open + ', doing ' + s.status.doing + ', done ' + s.status.done + ')');
    console.log('effort: S ' + s.effort.S + ' / M ' + s.effort.M + ' / L ' + s.effort.L);
    console.log('');
    console.log('OPEN TASKS (pick one, then `--task <id>`):');
    doc.tasks.forEach(function (t) {
      if (t.status !== 'open') return;
      var deps = t.dependsOn && t.dependsOn.length ? ' deps: ' + t.dependsOn.join(',') : '';
      console.log('  ' + t.id + ' [' + t.effort + '] ' + t.title + deps);
    });
    console.log('');
    console.log('next: node scripts/check-tasks.js --red');
  }
}

function cmdSchema(wantJson) {
  var doc = readTasksFile();
  var report = validate(doc);
  if (wantJson) {
    printJson({
      mode: 'schema',
      ok: report.errors.length === 0,
      tasks: Array.isArray(doc && doc.tasks) ? doc.tasks.length : 0,
      summary: Array.isArray(doc && doc.tasks) ? summarize(doc) : null,
      errors: report.errors,
      warnings: report.warnings
    });
  } else {
    printSchemaHuman(doc, report);
  }
  process.exitCode = report.errors.length ? 1 : 0;
}

function cmdTask(id, wantJson) {
  var doc = readTasksFile();
  var report = validate(doc);
  if (report.errors.length) {
    if (wantJson) printJson({ mode: 'task', ok: false, id: id, errors: report.errors });
    else {
      console.log('SCHEMA ERRORS (' + report.errors.length + '):');
      report.errors.forEach(function (e) { console.log('  - ' + e); });
    }
    process.exitCode = 1;
    return;
  }
  var task = doc.tasks.filter(function (t) { return t.id === id; })[0];
  if (!task) {
    if (wantJson) printJson({ mode: 'task', ok: false, id: id, errors: ['unknown task id: ' + id] });
    else console.log('unknown task id: ' + id);
    process.exitCode = 1;
    return;
  }
  var results = runAcceptance(task);
  var probe = runProbe(task.probe);
  var ok = results.every(function (r) { return r.ok; });
  if (wantJson) {
    printJson({ mode: 'task', ok: ok, id: task.id, status: task.status, results: results, probe: probe });
  } else {
    console.log('TASK ' + task.id + ' (' + task.status + ', effort ' + task.effort + ')');
    results.forEach(function (r) {
      var label = r.skipped ? 'SKIP' : (r.ok ? 'PASS' : 'FAIL');
      console.log('  ' + label + '  exit=' + (r.exitCode == null ? '-' : r.exitCode) + '  ' + r.cmd);
      if (r.skipped) console.log('        ' + r.reason);
      if (!r.ok && !r.skipped) {
        var out = (r.stdoutTail || '') + (r.stderrTail ? '\n' + r.stderrTail : '');
        if (out.trim()) console.log('        ' + out.replace(/\n/g, '\n        '));
      }
    });
    console.log('  probe: ' + (probe.stillRed ? 'still unfinished' : 'no longer matches (task may be done)') + ' — ' + probe.detail);
    console.log(ok ? 'TASK ACCEPTED' : 'TASK FAILED');
  }
  process.exitCode = ok ? 0 : 1;
}

function cmdRed(wantJson) {
  var doc = readTasksFile();
  var report = validate(doc);
  if (report.errors.length) {
    if (wantJson) printJson({ mode: 'red', ok: false, errors: report.errors });
    else {
      console.log('SCHEMA ERRORS (' + report.errors.length + '):');
      report.errors.forEach(function (e) { console.log('  - ' + e); });
    }
    process.exitCode = 1;
    return;
  }
  var rows = [];
  var rotten = [];
  var missing = [];
  var skipped = [];
  doc.tasks.forEach(function (t) {
    if (t.status !== 'open') {
      skipped.push(t.id);
      return;
    }
    if (!t.probe) {
      missing.push(t.id);
      rows.push({ id: t.id, stillRed: false, detail: 'missing probe' });
      return;
    }
    var probe = runProbe(t.probe);
    var isRed = probe.matches;
    rows.push({ id: t.id, stillRed: isRed, detail: probe.detail, probe: probe });
    if (!isRed) rotten.push(t.id);
  });
  var ok = rotten.length === 0 && missing.length === 0;
  if (wantJson) {
    printJson({
      mode: 'red',
      ok: ok,
      checked: rows.length,
      stillRed: rows.filter(function (r) { return r.stillRed; }).length,
      rotten: rotten,
      missingProbe: missing,
      skipped: skipped,
      rows: rows
    });
  } else {
    console.log('RED CHECK — ' + rows.length + ' open tasks');
    rows.forEach(function (r) {
      console.log('  ' + (r.stillRed ? 'RED ' : 'ROT ') + r.id + ' — ' + r.detail);
    });
    if (missing.length) {
      console.log('');
      console.log('MISSING PROBE (' + missing.length + '): ' + missing.join(', '));
      console.log('  Every open task needs a probe so --red can prove it is still unfinished.');
    }
    if (rotten.length) {
      console.log('');
      console.log('ROTTEN (' + rotten.length + '): ' + rotten.join(', '));
      console.log('  Probe no longer matches the unfinished state: the task is probably done, or its probe is misdescribed.');
      console.log('  Fix the task (status/probe) instead of marking it done silently.');
    }
    console.log('');
    console.log(ok ? 'RED OK — every open task is still unfinished' : 'RED FAILED');
  }
  process.exitCode = ok ? 0 : 1;
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/check-tasks.js                 schema + referential integrity',
    '  node scripts/check-tasks.js --task <id>     run one task acceptance',
    '  node scripts/check-tasks.js --red           every open task must still be red',
    '  node scripts/check-tasks.js --json          machine-readable output',
    '',
    'Combine --json with --task or --red. Exit 0 only when the check passes.'
  ].join('\n'));
}

function main() {
  var args = process.argv.slice(2);
  var wantJson = false;
  var mode = 'schema';
  var taskId = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--json') wantJson = true;
    else if (a === '--red') {
      if (mode !== 'schema') fail('use either --task or --red, not both');
      mode = 'red';
    } else if (a === '--task') {
      if (mode !== 'schema') fail('use either --task or --red, not both');
      taskId = args[++i];
      if (!taskId) fail('--task needs an id');
      mode = 'task';
    } else if (a === '--help' || a === '-h') {
      usage();
      return;
    } else {
      fail('unknown argument: ' + a);
    }
  }
  if (mode === 'schema') cmdSchema(wantJson);
  else if (mode === 'task') cmdTask(taskId, wantJson);
  else cmdRed(wantJson);
}

if (require.main === module) main();

module.exports = { validate: validate, runProbe: runProbe, nodeScriptPaths: nodeScriptPaths };
