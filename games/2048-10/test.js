'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('2048-10');
var kit = require('../shared/arcade/kits/slide2048.js');
var run = require('../shared/arcade/tests/slide2048.js');
var params = {"n":10};
run(kit.create(params), params, s);
s.done();
