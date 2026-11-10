'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('pong-3');
var kit = require('../shared/arcade/kits/pong.js');
var run = require('../shared/arcade/tests/pong.js');
var params = {"ai":true,"speed":3};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("pong-3", s);
require('../shared/arcade/tests/art.js').check('pong-3', 'pong', s);
s.done();
