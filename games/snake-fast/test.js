'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('snake-fast');
var kit = require('../shared/arcade/kits/snake.js');
var run = require('../shared/arcade/tests/snake.js');
var params = {"size":16,"wrap":false,"speed":9};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("snake-fast", s);
s.done();
