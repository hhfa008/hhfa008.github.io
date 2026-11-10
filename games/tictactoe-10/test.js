'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('tictactoe-10');
var kit = require('../shared/arcade/kits/tictactoe.js');
var run = require('../shared/arcade/tests/tictactoe.js');
var params = {"n":10,"ai":true};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("tictactoe-10", s);
require('../shared/arcade/tests/art.js').check('tictactoe-10', 'tictactoe', s);
s.done();
