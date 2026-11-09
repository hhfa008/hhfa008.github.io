'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('slide-5');
var kit = require('../shared/arcade/kits/slide-puzzle.js');
var run = require('../shared/arcade/tests/slide-puzzle.js');
var params = {"n":5};
run(kit.create(params), params, s);
s.done();
