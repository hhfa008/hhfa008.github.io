'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('pong-4');
var kit = require('../shared/arcade/kits/pong.js');
var run = require('../shared/arcade/tests/pong.js');
var params = {"ai":true,"speed":4};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("pong-4", s);
require('../shared/arcade/tests/art.js').check('pong-4', 'pong', s);
s.done();
