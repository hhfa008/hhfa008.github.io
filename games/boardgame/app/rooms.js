'use strict';

/* Compatibility shim: the room state machine now lives in
 * games/shared/rooms.js. Kept so older imports (app/server.mjs, play/,
 * network-rooms tests) keep resolving while the boardgame app retires.
 */
module.exports = require('../../shared/rooms.js');
