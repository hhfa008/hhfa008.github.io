'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('memory-8x6');
var kit = require('../shared/arcade/kits/memory-pairs.js');
var run = require('../shared/arcade/tests/memory-pairs.js');
var params = {"rows":8,"cols":6};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("memory-8x6", s);
s.done();
