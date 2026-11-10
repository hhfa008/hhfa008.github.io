'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('lights-3');
var kit = require('../shared/arcade/kits/lights-out.js');
var run = require('../shared/arcade/tests/lights-out.js');
var params = {"n":3};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("lights-3", s);
require('../shared/arcade/tests/art.js').check('lights-3', 'lights', s);
s.done();
