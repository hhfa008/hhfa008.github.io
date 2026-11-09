'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('slide-6');
var kit = require('../shared/arcade/kits/slide-puzzle.js');
var run = require('../shared/arcade/tests/slide-puzzle.js');
var params = {"n":6};
run(kit.create(params), params, s);
s.done();
