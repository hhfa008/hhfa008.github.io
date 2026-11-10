'use strict';

/*
 * Runs every committed arcade-family art state through its realism gate inside
 * the normal test suite. A future edit to a state file cannot silently leave
 * the rendered images showing an impossible position.
 *
 * States are added one family at a time, so this test validates the families
 * that exist and grows automatically as the batch proceeds.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');
var lib = require('./lib.js');
var pathToFileURL = require('url').pathToFileURL;

var s = lib.suite('arcade-art-realism');
var statesDir = path.join(__dirname, '..', 'assets', 'art', 'arcade', 'state');
var engineDir = path.join(__dirname, '..', 'assets', 'art', 'arcade', 'engine');

import(pathToFileURL(path.join(engineDir, 'realism.mjs')).href).then(function (mod) {
  var files = fs.readdirSync(statesDir).filter(function (name) { return /\.json$/.test(name); }).sort();
  s.ok('at least one family state is committed', files.length > 0, 'found ' + files.length);

  files.forEach(function (name) {
    var file = path.join(statesDir, name);
    var state = JSON.parse(fs.readFileSync(file, 'utf8'));
    var result = mod.validateState(state);
    s.ok(name + ' passes realism validation', result.ok, (result.errors || []).join('; '));
  });

  // Each family's validator must reject bad data, not just accept the happy
  // path. Mutate one field per committed family and expect a failure.
  files.forEach(function (name) {
    var file = path.join(statesDir, name);
    var state = JSON.parse(fs.readFileSync(file, 'utf8'));
    var bad = JSON.parse(JSON.stringify(state));
    var family = bad.family;
    if (family === 'slide-puzzle') bad.position.tiles[0] = 99;
    else if (family === 'lights-out') bad.position.lights[0] = 7;
    else if (family === 'minesweeper') bad.position.flags.push(bad.position.revealed[0]);
    else if (family === 'memory-pairs') bad.position.cards[0].pair = 99;
    else if (family === 'snake') bad.position.body[1] = [0, 0];
    else if (family === 'pong') bad.position.score = [7, 0];
    else if (family === 'tictactoe') bad.position.board = [1, 1, 1, 0, 0, 0, 0, 0, 0];
    else if (family === 'hanoi') bad.position.pegs[0] = [1, 2, 3, 4, 5, 6, 7, 8];
    else if (family === 'reaction') bad.position.targets[0].r = 9;
    else bad.position.broken = true;
    s.ok(name + ' rejects mutated bad data', mod.validateState(bad).ok === false);
  });

  // The CLI contract is what the renderer depends on: exit 3 and no image.
  var slideFile = path.join(statesDir, 'slide-puzzle.json');
  if (fs.existsSync(slideFile)) {
    var badState = JSON.parse(fs.readFileSync(slideFile, 'utf8'));
    badState.position.tiles[0] = 3;
    var tmp = path.join(os.tmpdir(), 'arcade-art-bad-' + process.pid + '.json');
    fs.writeFileSync(tmp, JSON.stringify(badState));
    var res = child.spawnSync(process.execPath, [path.join(engineDir, 'realism.mjs'), tmp], { encoding: 'utf8' });
    try { fs.rmSync(tmp, { force: true }); } catch (err) { /* best effort */ }
    s.eq('CLI exits 3 on a rejected state', res.status, 3);
    s.ok('CLI says it refuses to render', /refusing to render/i.test(res.stderr || ''));
  }

  s.done();
}).catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
