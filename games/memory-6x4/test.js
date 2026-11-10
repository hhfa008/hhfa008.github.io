'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('memory-6x4');
var kit = require('../shared/arcade/kits/memory-pairs.js');
var run = require('../shared/arcade/tests/memory-pairs.js');
var params = {"rows":6,"cols":4};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("memory-6x4", s);
s.done();
