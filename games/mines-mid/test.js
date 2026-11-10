'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('mines-mid');
var kit = require('../shared/arcade/kits/minesweeper.js');
var run = require('../shared/arcade/tests/minesweeper.js');
var params = {"rows":12,"cols":12,"mines":20};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("mines-mid", s);
require('../shared/arcade/tests/art.js').check('mines-mid', 'mines', s);
s.done();
