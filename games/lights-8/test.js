'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('lights-8');
var kit = require('../shared/arcade/kits/lights-out.js');
var run = require('../shared/arcade/tests/lights-out.js');
var params = {"n":8};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("lights-8", s);
require('../shared/arcade/tests/art.js').check('lights-8', 'lights', s);
s.done();
