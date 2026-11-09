'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('tictactoe-6');
var kit = require('../shared/arcade/kits/tictactoe.js');
var run = require('../shared/arcade/tests/tictactoe.js');
var params = {"n":6,"ai":true};
run(kit.create(params), params, s);
s.done();
