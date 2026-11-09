'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('aim-trainer');
var kit = require('../shared/arcade/kits/reaction.js');
var run = require('../shared/arcade/tests/reaction.js');
var params = {"time":30};
run(kit.create(params), params, s);
s.done();
