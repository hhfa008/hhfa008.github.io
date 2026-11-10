'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('lights-4');
var kit = require('../shared/arcade/kits/lights-out.js');
var run = require('../shared/arcade/tests/lights-out.js');
var params = {"n":4};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("lights-4", s);
s.done();
