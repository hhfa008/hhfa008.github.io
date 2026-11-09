'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('memory-3x4');
var kit = require('../shared/arcade/kits/memory-pairs.js');
var run = require('../shared/arcade/tests/memory-pairs.js');
var params = {"rows":3,"cols":4};
run(kit.create(params), params, s);
s.done();
