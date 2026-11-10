'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-hard');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":16,"cols":16,"mines":40};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-hard", s);
require('../shared/arcade/tests/art.js').check('mines-hard', 'mines', s);
s.done();
