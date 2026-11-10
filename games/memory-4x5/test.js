'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('memory-4x5');
var kit = require('../shared/arcade/kits/memory-pairs.js');
var run = require('../shared/arcade/tests/memory-pairs.js');
var params = {"rows":4,"cols":5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("memory-4x5", s);
s.done();
