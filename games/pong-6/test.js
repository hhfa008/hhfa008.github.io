'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('pong-6');
var kit = require('../shared/arcade/kits/pong.js');
var run = require('../shared/arcade/tests/pong.js');
var params = {"ai":true,"speed":6};
run(kit.create(params), params, s);
s.done();
