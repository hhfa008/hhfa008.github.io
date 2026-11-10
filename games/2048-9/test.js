'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('2048-9');
var kit = require('../shared/arcade/kits/slide2048.js');
var run = require('../shared/arcade/tests/slide2048.js');
var params = {"n":9};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("2048-9", s);
s.done();
