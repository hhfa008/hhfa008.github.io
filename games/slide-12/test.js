'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('slide-12');
var kit = require('../shared/arcade/kits/slide-puzzle.js');
var run = require('../shared/arcade/tests/slide-puzzle.js');
var params = {"n":12};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("slide-12", s);
s.done();
