'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-10x10');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":10,"cols":10,"mines":18};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-10x10", s);
require('../shared/arcade/tests/art.js').check('mines-10x10', 'mines', s);
s.done();
