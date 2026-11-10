'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('snake-20');
var kit = require('../shared/arcade/kits/snake.js');
var run = require('../shared/arcade/tests/snake.js');
var params = {"size":20,"wrap":false,"speed":5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("snake-20", s);
s.done();
