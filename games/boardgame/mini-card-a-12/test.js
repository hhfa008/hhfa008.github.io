'use strict';
var E = require('./engine.js');
var passed = 0, failed = 0;
function assert(cond, msg){ if(cond){ passed++; } else { failed++; console.error('FAIL: ' + msg); } }

assert(typeof E.title === 'string' && E.title.length > 0, 'engine exposes a title');
assert(E.slug === "mini-card-a-12", 'engine exposes the expected slug');
assert(typeof E.createGame === 'function', 'createGame is callable');
assert(typeof E.moves === 'function' && typeof E.play === 'function', 'moves and play are callable');
assert(typeof E.aiMove === 'function' && typeof E.view === 'function', 'aiMove and view are callable');
assert(E.cardStr({ r: 1, s: 0 }) === '\u2660A', 'cardStr renders cards');
var detA = E.createGame({ seed: 7 }), detB = E.createGame({ seed: 7 });
assert(JSON.stringify(detA) === JSON.stringify(detB), 'same seed gives the same deal');
var v0 = E.view(detA);
assert(Array.isArray(v0.hand) && Array.isArray(v0.piles) && Array.isArray(v0.actions), 'view returns hand, piles and actions');
assert(typeof v0.status === 'string' && v0.status.length > 0, 'view returns a status line');
var bad = E.play(E.createGame({ seed: 3 }), { type: 'not-a-real-move' });
assert(bad.ok === false && typeof bad.error === 'string', 'invalid moves are rejected');

for (var n = 1; n <= 20; n += 1) {
  var game = E.createGame({ seed: 4000 + n });
  var steps = 0, ok = true, err = null;
  while (game.phase === 'playing' && steps < 1500) {
    var mv = E.aiMove(game);
    if (!mv) { ok = false; err = 'no move at step ' + steps; break; }
    var res = E.play(game, mv);
    if (!res.ok) { ok = false; err = 'rejected move at step ' + steps + ': ' + res.error; break; }
    steps += 1;
  }
  assert(ok, 'self-play game ' + n + ' has no illegal action (' + err + ')');
  assert(game.phase === 'over', 'self-play game ' + n + ' reaches a final state');
  assert(steps < 1500, 'self-play game ' + n + ' finishes under the step cap');
  assert(game.winner === 0 || game.winner === 1 || game.winner === 'tie', 'self-play game ' + n + ' has a valid winner');
  var vf = E.view(game);
  assert(typeof vf.status === 'string' && vf.over === true, 'self-play game ' + n + ' reports a finished view');
}

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
