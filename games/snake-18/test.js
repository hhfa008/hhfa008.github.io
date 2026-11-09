'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('snake-18');
var kit = require('../shared/arcade/kits/snake.js');
var run = require('../shared/arcade/tests/snake.js');
var params = {"size":18,"wrap":false,"speed":5};
run(kit.create(params), params, s);
s.done();
