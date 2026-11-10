'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('hanoi-13');
var kit = require('../shared/arcade/kits/hanoi.js');
var run = require('../shared/arcade/tests/hanoi.js');
var params = {"disks":13};
run(kit.create(params), params, s);
require('../shared/arcade/tests/terminal.js').check("hanoi-13", s);
require('../shared/arcade/tests/art.js').check('hanoi-13', 'hanoi', s);
s.done();
