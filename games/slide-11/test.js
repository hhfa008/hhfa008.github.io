'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('slide-11');
var kit = require('../shared/arcade/kits/slide-puzzle.js');
var run = require('../shared/arcade/tests/slide-puzzle.js');
var params = {"n":11};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("slide-11", s);
require('../shared/arcade/tests/art.js').check('slide-11', 'slide', s);
s.done();
