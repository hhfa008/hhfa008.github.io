'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-24x24');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":24,"cols":24,"mines":99};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-24x24", s);
s.done();
