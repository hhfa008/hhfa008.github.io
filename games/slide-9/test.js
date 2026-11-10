'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('slide-9');
var kit = require('../shared/arcade/kits/slide-puzzle.js');
var run = require('../shared/arcade/tests/slide-puzzle.js');
var params = {"n":9};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("slide-9", s);
s.done();
