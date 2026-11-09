'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('2048');
var kit = require('../shared/arcade/kits/slide2048.js');
var run = require('../shared/arcade/tests/slide2048.js');
var params = {"n":4};
run(kit.create(params), params, s);
s.done();
