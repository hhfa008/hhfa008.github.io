'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('whack');
var kit = require('../shared/arcade/kits/reaction.js');
var run = require('../shared/arcade/tests/reaction.js');
var params = {"time":30,"speed":1};
run(kit.create(params), params, s);
s.done();
