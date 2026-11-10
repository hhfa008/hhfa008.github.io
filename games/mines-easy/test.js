'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-easy');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":9,"cols":9,"mines":10};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-easy", s);
s.done();
