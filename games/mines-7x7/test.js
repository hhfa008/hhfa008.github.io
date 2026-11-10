'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-7x7');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":7,"cols":7,"mines":12};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-7x7", s);
require('../shared/arcade/tests/art.js').check('mines-7x7', 'mines', s);
s.done();
