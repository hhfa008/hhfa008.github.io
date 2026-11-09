'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-18x18');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":18,"cols":18,"mines":50};
run(kit.create(params), params, s);
s.done();
