'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('snake-12');
var kit = require('../shared/arcade/kits/snake.js');
var run = require('../shared/arcade/tests/snake.js');
var params = {"size":12,"wrap":false,"speed":5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("snake-12", s);
require('../shared/arcade/tests/art.js').check('snake-12', 'snake', s);
s.done();
