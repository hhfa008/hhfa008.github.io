'use strict';

/* Two-client online E2E for Codenames Premium.
 *
 *   node games/boardgame/codenames-premium/test-online.js
 *
 * Starts the real HTTP room server on an ephemeral port and drives two
 * independent clients over fetch: create/join/invite, password rejection,
 * hidden-information views, captain clue -> operative guess -> pass, AI seats,
 * reconnect, idle takeover, restart, and result leaderboard. No browser and no
 * tmp Chrome profile are required; run-all.js discovers this file because it
 * starts with "test".
 */

var path = require('path');
var { pathToFileURL } = require('url');

var passed = 0;
var failed = 0;
var failures = [];
var groups = [];
function check(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
  return !!cond;
}
async function group(name, fn) {
  var p0 = passed, f0 = failed;
  try { await fn(); }
  catch (err) { failed += 1; failures.push(name + ' threw: ' + (err && err.stack || err)); }
  groups.push({ name: name, pass: passed - p0, fail: failed - f0 });
}
function eq(label, actual, expected) {
  return check(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 250, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + handle.address.port;
  var requests = 0;
  async function api(method, route, body) {
    requests += 1;
    var res = await fetch(base + route, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await res.text();
    var data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    return { status: res.status, body: data, text: text };
  }
  function errCode(r) { return r.body && r.body.error && r.body.error.code; }

  try {
    var room1, p1, p2, t1, t2, invite1;

    await group('health + create/join/invite', async function () {
      var health = await api('GET', '/health');
      eq('health 200', health.status, 200);
      eq('health game=codenames', health.body.game, 'codenames');
      check('health 报告房间数', typeof health.body.rooms === 'number');

      var created = await api('POST', '/api/rooms', { playerId: 'p1' });
      room1 = created.body.roomId;
      t1 = created.body.playerSession;
      invite1 = created.body.inviteToken;
      eq('创建房间 201', created.status, 201);
      check('创建返回 roomId', typeof room1 === 'string' && room1.length > 0);
      check('创建返回 host session', typeof t1 === 'string' && t1.length > 0);
      check('创建返回邀请 token', typeof invite1 === 'string' && invite1.length > 0);
      eq('创建后 4 个座位', created.body.seats.length, 4);
      eq('房主是红队队长', created.body.seats[0].id + ':' + created.body.seats[0].playerId, 'red-captain:p1');

      var joined = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/join', {
        playerId: 'p2', inviteCode: invite1
      });
      p2 = joined.body;
      t2 = joined.body.playerSession;
      eq('邀请加入 200', joined.status, 200);
      eq('第二名玩家是红队队员', joined.body.seats[1].id + ':' + joined.body.seats[1].playerId, 'red-operative:p2');
      eq('空位 AI 补足（蓝队队长）', joined.body.seats[2].ai, true);
      eq('空位 AI 补足（蓝队队员）', joined.body.seats[3].ai, true);

      var reuse = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/join', {
        playerId: 'p3', inviteCode: invite1
      });
      check('邀请 token 单次使用', reuse.status === 403, 'status=' + reuse.status);
      eq('重复邀请返回 E_INVITE', errCode(reuse), 'E_INVITE');
    });

    await group('password + private room', async function () {
      var created = await api('POST', '/api/rooms', {
        playerId: 'host', password: 'secret-1', visibility: 'private'
      });
      var room = created.body.roomId;
      var hostToken = created.body.playerSession;
      var invite = created.body.inviteToken;
      eq('私有房创建 201', created.status, 201);

      var noAuth = await api('GET', '/api/rooms/' + encodeURIComponent(room));
      check('私有房无会话不可读', noAuth.status === 403, 'status=' + noAuth.status);
      eq('私有房错误码 E_PRIVATE', errCode(noAuth), 'E_PRIVATE');

      var wrong = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest', password: 'wrong-pass'
      });
      check('错误密码被拒绝', wrong.status === 403, 'status=' + wrong.status);
      eq('错误密码错误码', errCode(wrong), 'E_PASSWORD');

      var right = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest', password: 'secret-1'
      });
      eq('正确密码加入 200', right.status, 200);
      check('成员可读私有房', (await api('GET', '/api/rooms/' + encodeURIComponent(room) +
        '?session=' + encodeURIComponent(right.body.playerSession))).status === 200);

      var inviteJoin = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest2', inviteCode: invite
      });
      eq('邀请 token 绕过密码', inviteJoin.status, 200);
      var used = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest3', inviteCode: invite
      });
      check('已用邀请再次加入失败', used.status === 403, 'status=' + used.status);

      var one = await api('POST', '/api/rooms', { playerId: 'solo' });
      var startSolo = await api('POST', '/api/rooms/' + encodeURIComponent(one.body.roomId) + '/start', {
        session: one.body.playerSession
      });
      eq('单人开局 200', startSolo.status, 200);
      eq('单人开局 started', startSolo.body.started, true);
      eq('单人开局 AI 座位数', startSolo.body.seats.filter(function (s) { return s.ai; }).length, 3);
      eq('单人房主可给线索', startSolo.body.canClue, true);
    });

    await group('start + hidden info + clue/guess', async function () {
      var started = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/start', { session: t1 });
      eq('房主开始对局 200', started.status, 200);
      eq('对局状态 playing', started.body.status, 'playing');
      eq('开局红队先手', started.body.turn, 'red');
      eq('开局线索阶段', started.body.phase, 'clue');
      eq('真实现场 25 张', started.body.words.length, 25);
      var counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
      started.body.words.forEach(function (w) { counts[w.color] += 1; });
      eq('真实件数 9/8/7/1', [counts.red, counts.blue, counts.neutral, counts.assassin], [9, 8, 7, 1]);
      eq('蓝队两个 AI 座位', started.body.aiSeats.sort(), ['blue-captain', 'blue-operative']);

      var capView = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      var opView = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      eq('队长可见颜色', capView.body.keyVisible, true);
      check('队长视图含未翻开颜色', capView.body.words.some(function (w) { return !w.revealed && w.color !== 'hidden'; }));
      eq('队员隐藏颜色', opView.body.keyVisible, false);
      check('队员视图全部未翻开为 hidden', opView.body.words.every(function (w) { return w.revealed || w.color === 'hidden'; }));
      eq('队员视图不泄露主题标签', opView.body.words.every(function (w) { return !w.tags || w.tags.length === 0; }), true);
      check('队长获得建议线索', !!capView.body.suggestedClue && typeof capView.body.suggestedClue.text === 'string');

      var suggestion = capView.body.suggestedClue || { text: '测试', count: 1 };
      var wrongRole = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t1, type: 'guess', index: 0
      });
      check('队长不能代替队员猜词', wrongRole.status === 409, 'status=' + wrongRole.status);
      eq('错误角色码 E_ROLE', errCode(wrongRole), 'E_ROLE');

      var clue = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t1, type: 'clue', text: suggestion.text, count: suggestion.count
      });
      eq('队长给线索 200', clue.status, 200);
      eq('进入猜词阶段', clue.body.phase, 'guess');
      check('线索公开给双方', !!clue.body.clue && clue.body.clue.text === suggestion.text);
      var opAfterClue = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      eq('队员现在可以猜词', opAfterClue.body.canGuess, true);
      eq('队员视图仍隐藏颜色', opAfterClue.body.keyVisible, false);

      var redIndex = capView.body.words.findIndex(function (w) { return !w.revealed && w.color === 'red'; });
      check('存在未翻开红队词', redIndex >= 0);
      var guess = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t2, type: 'guess', index: redIndex
      });
      eq('队员猜词 200', guess.status, 200);
      eq('红队得分 +1', guess.body.scores.red, 1);
      eq('猜中的词已翻开', guess.body.words[redIndex].revealed, true);
      check('猜后仍可继续或停止', guess.body.canGuess === true && guess.body.canPass === true);

      var passedTurn = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t2, type: 'pass'
      });
      eq('主动停止 200', passedTurn.status, 200);
      eq('换到蓝队', passedTurn.body.turn, 'blue');
      eq('蓝队线索阶段', passedTurn.body.phase, 'clue');
      eq('AI 蓝队队长当前行动', passedTurn.body.currentSeat, 'blue-captain');

      var offTurn = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t2, type: 'guess', index: 0
      });
      check('非当前回合被拒绝', offTurn.status === 409, 'status=' + offTurn.status);
    });

    await group('AI fill + state sync', async function () {
      var ticked = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/tick', {
        session: t2, force: true
      });
      eq('强制 AI tick 200', ticked.status, 200);
      check('AI 已完成蓝队回合并回到红队或结束',
        ticked.body.phase === 'over' ? true : ticked.body.turn === 'red',
        JSON.stringify({ turn: ticked.body.turn, phase: ticked.body.phase, turnNo: ticked.body.turnNo }));
      check('回合数推进', ticked.body.turnNo >= 3 || ticked.body.phase === 'over',
        String(ticked.body.turnNo) + '/' + ticked.body.phase);
      check('AI 行动后仍有 25 张词', ticked.body.words.length, String(ticked.body.words.length));
      var stateA = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      var stateB = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      eq('双客户端看到同一回合', stateA.body.turnNo, stateB.body.turnNo);
      eq('双客户端看到同一比分', stateA.body.scores, stateB.body.scores);
    });

    await group('reconnect + invalid token', async function () {
      var re = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/reconnect', {
        token: t2, playerId: 'p2'
      });
      eq('断线重连 200', re.status, 200);
      eq('重连保持红队队员座位', re.body.you.seat, 'red-operative');
      eq('重连返回同一 session', re.body.playerSession, t2);
      var bad = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/reconnect', {
        token: 'not-a-real-token', playerId: 'p2'
      });
      check('无效 token 被拒绝', bad.status === 403, 'status=' + bad.status);
      eq('无效 token 错误码', errCode(bad), 'E_TOKEN');
    });

    await group('idle takeover + recovery', async function () {
      // p1 stops polling; p2's GET triggers the server tick. The red captain
      // seat is stale, so AI must give the clue and the takeover badge appears.
      await sleep(400);
      var seen = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      check('超时座位进入托管', seen.body.takeoverSeats.indexOf('red-captain') >= 0,
        JSON.stringify(seen.body.takeoverSeats));
      var capSeat = seen.body.seats.filter(function (s) { return s.id === 'red-captain'; })[0];
      eq('红队队长座位 takeover=true', capSeat.takeover, true);
      check('托管后 AI 已推进局面', seen.body.phase !== 'over' ? seen.body.turn !== 'blue' || seen.body.clue : true,
        JSON.stringify({ turn: seen.body.turn, phase: seen.body.phase, clue: seen.body.clue }));

      var recovered = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      eq('玩家轮询后托管解除', recovered.body.takeoverSeats.indexOf('red-captain'), -1);
      eq('玩家恢复后仍是队长座位', recovered.body.you.seat, 'red-captain');
    });

    await group('finish + leaderboard + restart', async function () {
      // Let both human seats go stale, then force the AI to finish the match.
      await sleep(400);
      var view = null;
      for (var i = 0; i < 80; i += 1) {
        var ticked = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/tick', {
          session: t2, force: true
        });
        view = ticked.body;
        if (view.phase === 'over') break;
        await sleep(20);
      }
      eq('对局最终结束', view && view.phase, 'over');
      check('对局有胜者', view && (view.winner === 'red' || view.winner === 'blue'), view && view.winner);
      check('结束时 25 张词仍完整', view && view.words.length === 25);

      var lb = await api('GET', '/api/leaderboard?limit=10');
      eq('结果榜 200', lb.status, 200);
      check('结果榜有记录', lb.body.entries.length >= 1, String(lb.body.entries.length));
      var entry = lb.body.entries.filter(function (e) { return e.roomId === room1; })[0];
      check('本房间入榜', !!entry, JSON.stringify(lb.body.entries.map(function (e) { return e.roomId; })));
      if (entry) {
        eq('入榜胜者与房间一致', entry.winner, view.winner);
        eq('入榜比分与房间一致', entry.scores, view.scores);
        check('入榜含 4 个座位', entry.seats.length === 4, String(entry.seats.length));
      }
      var sameRoom = lb.body.entries.filter(function (e) { return e.roomId === room1; });
      eq('同一局只入榜一次', sameRoom.length, 1);

      // p1 is host; recover the session then start a rematch.
      await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      var restart = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/restart', { session: t1 });
      eq('房主重开 200', restart.status, 200);
      eq('重开回到线索阶段', restart.body.phase, 'clue');
      eq('重开比分清零', restart.body.scores, { red: 0, blue: 0 });
      eq('重开仍是 25 张', restart.body.words.length, 25);
    });

    await group('leave -> AI fill', async function () {
      var one = await api('POST', '/api/rooms', { playerId: 'host2' });
      var joined = await api('POST', '/api/rooms/' + encodeURIComponent(one.body.roomId) + '/join', { playerId: 'guest2' });
      var started = await api('POST', '/api/rooms/' + encodeURIComponent(one.body.roomId) + '/start', {
        session: one.body.playerSession
      });
      eq('第二房间可开始', started.status, 200);
      var left = await api('POST', '/api/rooms/' + encodeURIComponent(one.body.roomId) + '/leave', {
        session: joined.body.playerSession
      });
      eq('离开房间 200', left.status, 200);
      var view = await api('GET', '/api/rooms/' + encodeURIComponent(one.body.roomId) + '?session=' +
        encodeURIComponent(one.body.playerSession));
      var seat = view.body.seats.filter(function (s) { return s.id === 'red-operative'; })[0];
      eq('离开的座位转为 AI', seat.ai, true);
      check('离开的座位标记托管', seat.takeover === true, JSON.stringify(seat));
    });
  } finally {
    await handle.close();
  }

  console.log('');
  groups.forEach(function (g) {
    console.log((g.fail === 0 ? '[PASS] ' : '[FAIL] ') + g.name + ': ' + g.pass + ' 项, ' + g.fail + ' 失败');
  });
  if (failures.length) failures.slice(0, 30).forEach(function (f) { console.log('  FAIL: ' + f); });
  console.log('');
  console.log('HTTP 请求数: ' + requests);
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch(function (err) {
  console.error('ONLINE E2E ERROR:', err && err.stack || err);
  console.log('RESULT: 0 passed, 1 failed');
  process.exitCode = 1;
});
