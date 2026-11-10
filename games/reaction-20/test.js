'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('reaction-20');
var kit = require('../shared/arcade/kits/reaction.js');
var run = require('../shared/arcade/tests/reaction.js');
var params = {"time":20};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("reaction-20", s);
s.done();
