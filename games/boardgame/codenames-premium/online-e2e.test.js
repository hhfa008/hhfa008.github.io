'use strict';

/* Gate-name alias for the two-client online E2E.
 *
 * The real suite is ./test-online.js and is discovered by
 * games/tests/run-all.js (its filename starts with "test"). This alias exists
 * because the acceptance gate asks for online-e2e.test.js; both files run the
 * same assertions and print the same RESULT line.
 */

require('./test-online.js');
