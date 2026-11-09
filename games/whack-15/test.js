'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('whack-15');
var kit = require('../shared/arcade/kits/reaction.js');
var run = require('../shared/arcade/tests/reaction.js');
var params = {"time":15};
run(kit.create(params), params, s);
s.done();
