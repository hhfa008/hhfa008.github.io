'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('2048-3');
var kit = require('../shared/arcade/kits/slide2048.js');
var run = require('../shared/arcade/tests/slide2048.js');
var params = {"n":3};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("2048-3", s);
s.done();
