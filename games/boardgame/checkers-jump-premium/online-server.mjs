#!/usr/bin/env node
/*
 * Chinese Checkers Premium online server (2-player across opposite zones).
 *   node games/boardgame/checkers-jump-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGameServer } from '../../shared/boardgame-room-server.mjs';
import { checkersAdapter } from './online-adapter.mjs';

export function startOnlineServer(options) {
  return startGameServer(Object.assign({}, options || {}, { adapter: checkersAdapter }));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port }).then((handle) => {
    const a = handle.address;
    console.log('[checkers-jump-online] http://' + a.address + ':' + a.port + '/boardgame/checkers-jump-premium/online.html');
    console.log('[checkers-jump-online] http://' + a.address + ':' + a.port + '/boardgame/checkers-jump-premium/index.html');
  }).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}
