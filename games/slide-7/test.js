'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('slide-7');
var kit = require('../shared/arcade/kits/slide-puzzle.js');
var run = require('../shared/arcade/tests/slide-puzzle.js');
var params = {"n":7};
run(kit.create(params), params, s);
s.done();
