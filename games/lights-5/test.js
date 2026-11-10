'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('lights-5');
var kit = require('../shared/arcade/kits/lights-out.js');
var run = require('../shared/arcade/tests/lights-out.js');
var params = {"n":5};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("lights-5", s);
require('../shared/arcade/tests/art.js').check('lights-5', 'lights', s);
s.done();
