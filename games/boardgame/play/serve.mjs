#!/usr/bin/env node
'use strict';

/*
 * Boardgame play preview server — thin wrapper over tools/serve.mjs.
 *
 *   node play/serve.mjs                 # 127.0.0.1, random free port
 *   node play/serve.mjs --port 8765     # fixed port
 *   node play/serve.mjs --root games/boardgame
 *
 * The document root defaults to games/boardgame, so /play/*.html can import
 * ../app/*.js. Only GET/HEAD are served and the listener is always loopback.
 * The shared implementation (MIME, index.html, 404, traversal guard) lives in
 * tools/serve.mjs; smoke.mjs and e2e.mjs import startServer from here.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStaticServer as createBaseServer, startServer as startBaseServer } from '../../../tools/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

export function createStaticServer(options) {
  const opts = options || {};
  return createBaseServer({ root: opts.root || DEFAULT_ROOT });
}

export function startServer(options) {
  const opts = options || {};
  return startBaseServer({
    root: opts.root || DEFAULT_ROOT,
    port: opts.port,
    host: opts.host
  }).then(function (handle) {
    handle.url = handle.origin + '/play/card-battle.html';
    return handle;
  });
}

function parseArgs(argv) {
  const opts = { port: 0, root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') opts.port = Number(argv[++i]) || 0;
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice(7)) || 0;
    else if (arg === '--root') opts.root = path.resolve(argv[++i] || DEFAULT_ROOT);
    else if (arg.startsWith('--root=')) opts.root = path.resolve(arg.slice(7));
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node play/serve.mjs [--port N] [--root games/boardgame]');
      process.exit(0);
    } else {
      console.error('unknown argument: ' + arg);
      process.exit(2);
    }
  }
  return opts;
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  startServer(opts).then(function (handle) {
    console.log('boardgame play server: ' + handle.origin + '/');
    console.log('serving root: ' + handle.root);
    const shutdown = function () {
      handle.close().then(function () { process.exit(0); });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch(function (err) {
    console.error('failed to start play server: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
}
