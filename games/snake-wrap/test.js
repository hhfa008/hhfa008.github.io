'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('snake-wrap');
var kit = require('../shared/arcade/kits/snake.js');
var run = require('../shared/arcade/tests/snake.js');
var params = {"size":16,"wrap":true,"speed":5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("snake-wrap", s);
require('../shared/arcade/tests/art.js').check('snake-wrap', 'snake', s);
s.done();
