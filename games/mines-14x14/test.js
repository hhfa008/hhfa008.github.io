'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-14x14');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":14,"cols":14,"mines":28};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-14x14", s);
s.done();
