'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('hanoi-12');
var kit = require('../shared/arcade/kits/hanoi.js');
var run = require('../shared/arcade/tests/hanoi.js');
var params = {"disks":12};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("hanoi-12", s);
s.done();
