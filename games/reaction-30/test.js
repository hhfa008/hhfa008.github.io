'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('reaction-30');
var kit = require('../shared/arcade/kits/reaction.js');
var run = require('../shared/arcade/tests/reaction.js');
var params = {"time":30};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("reaction-30", s);
s.done();
