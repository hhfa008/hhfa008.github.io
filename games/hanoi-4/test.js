'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('hanoi-4');
var kit = require('../shared/arcade/kits/hanoi.js');
var run = require('../shared/arcade/tests/hanoi.js');
var params = {"disks":4};
run(kit.create(params), params, s);
s.done();
