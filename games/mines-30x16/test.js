'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-30x16');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":30,"cols":16,"mines":99};
run(kit.create(params), params, s);
s.done();
