'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('reaction-time');
var kit = require('../shared/arcade/kits/reaction.js');
var run = require('../shared/arcade/tests/reaction.js');
var params = {"rounds":5};
run(kit.create(params), params, s);
s.done();
