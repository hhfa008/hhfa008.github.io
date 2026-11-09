'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('memory-8x5');
var kit = require('../shared/arcade/kits/memory-pairs.js');
var run = require('../shared/arcade/tests/memory-pairs.js');
var params = {"rows":8,"cols":5};
run(kit.create(params), params, s);
s.done();
