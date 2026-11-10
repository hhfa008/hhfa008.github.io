'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-20x20');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":20,"cols":20,"mines":70};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-20x20", s);
require('../shared/arcade/tests/art.js').check('mines-20x20', 'mines', s);
s.done();
