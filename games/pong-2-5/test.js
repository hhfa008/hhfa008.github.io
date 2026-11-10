'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('pong-2-5');
var kit = require('../shared/arcade/kits/pong.js');
var run = require('../shared/arcade/tests/pong.js');
var params = {"ai":true,"speed":2.5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("pong-2-5", s);
require('../shared/arcade/tests/art.js').check('pong-2-5', 'pong', s);
s.done();
