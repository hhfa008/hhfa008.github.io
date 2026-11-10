'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('tictactoe');
var kit = require('../shared/arcade/kits/tictactoe.js');
var run = require('../shared/arcade/tests/tictactoe.js');
var params = {"n":3,"ai":true};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("tictactoe", s);
require('../shared/arcade/tests/art.js').check('tictactoe', 'tictactoe', s);
s.done();
