'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('pong-fast');
var kit = require('../shared/arcade/kits/pong.js');
var run = require('../shared/arcade/tests/pong.js');
var params = {"ai":true,"speed":2};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("pong-fast", s);
require('../shared/arcade/tests/art.js').check('pong-fast', 'pong', s);
s.done();
