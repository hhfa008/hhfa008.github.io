'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('hanoi-11');
var kit = require('../shared/arcade/kits/hanoi.js');
var run = require('../shared/arcade/tests/hanoi.js');
var params = {"disks":11};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("hanoi-11", s);
s.done();
