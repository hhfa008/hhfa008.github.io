'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('pong-5');
var kit = require('../shared/arcade/kits/pong.js');
var run = require('../shared/arcade/tests/pong.js');
var params = {"ai":true,"speed":5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("pong-5", s);
s.done();
