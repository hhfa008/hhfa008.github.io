#!/usr/bin/env node
/*
 * Xiangqi Premium online server.
 *   node games/boardgame/xiangqi-premium/online-server.mjs --port 8787
 *
 * Room / invite / password / reconnect / takeover / leaderboard mechanics are
 * shared in games/shared/boardgame-room-server.mjs; this file only binds the
 * xiangqi engine adapter.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGameServer } from '../../shared/boardgame-room-server.mjs';
import { xiangqiAdapter } from './online-adapter.mjs';

export function startOnlineServer(options) {
  return startGameServer(Object.assign({}, options || {}, { adapter: xiangqiAdapter }));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port }).then((handle) => {
    const a = handle.address;
    console.log('[xiangqi-online] http://' + a.address + ':' + a.port + '/boardgame/xiangqi-premium/online.html');
    console.log('[xiangqi-online] http://' + a.address + ':' + a.port + '/boardgame/xiangqi-premium/index.html');
  }).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}
