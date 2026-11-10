'use strict';

/*
 * Runs the art package's realism gate inside the normal game test suite, so a
 * future edit to state.json cannot silently leave the rendered images showing
 * an impossible position.
 */

var fs = require('fs');
var path = require('path');
var lib = require('../tests/lib.js');
var pathToFileURL = require('url').pathToFileURL;

var s = lib.suite('2048-realism');
var dir = path.join(__dirname, 'assets');

import(pathToFileURL(path.join(dir, 'realism.mjs')).href).then(function (mod) {
  var state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  var result = mod.validateState(state);

  s.ok('committed position passes replay validation', result.ok, (result.errors || []).join('; '));
  s.eq('board is 4x4', state.board.length, 16);
  s.ok('every tile is 0 or a power of two', state.board.every(function (v) {
    return v === 0 || (v >= 2 && (v & (v - 1)) === 0);
  }));
  s.eq('score matches replayed merges', result.score, state.score);
  s.eq('moves matches replayed move count', result.moves, state.moves);
  s.ok('at least one legal merge is available', mod.validateState(state).ok &&
    state.board.some(function (v, i) {
      if (!v) return false;
      var c = i % 4;
      return (c + 1 < 4 && state.board[i + 1] === v) ||
        (i + 4 < 16 && state.board[i + 4] === v);
    }));

  var badTile = JSON.parse(JSON.stringify(state));
  badTile.board[0] = 3;
  s.ok('invalid tile value is rejected', mod.validateState(badTile).ok === false);

  var badScore = JSON.parse(JSON.stringify(state));
  badScore.score += 1;
  s.ok('inflated score is rejected', mod.validateState(badScore).ok === false);

  var badMove = JSON.parse(JSON.stringify(state));
  badMove.history.moves[0].dir = 'diagonal';
  s.ok('invalid move direction is rejected', mod.validateState(badMove).ok === false);

  s.done();
}).catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
