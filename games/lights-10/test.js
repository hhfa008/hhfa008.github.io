'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('lights-10');
var kit = require('../shared/arcade/kits/lights-out.js');
var run = require('../shared/arcade/tests/lights-out.js');
var params = {"n":10};
run(kit.create(params), params, s);
s.done();
