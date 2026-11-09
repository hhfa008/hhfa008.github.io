#!/usr/bin/env node
'use strict';

/*
 * Zero-dependency static server for local play verification.
 *
 *   node play/serve.mjs                 # 127.0.0.1, random free port
 *   node play/serve.mjs --port 8765     # fixed port
 *   node play/serve.mjs --host 0.0.0.0  # opt-in LAN exposure
 *
 * The document root is games/boardgame, so /play/*.html can import ../app/*.js.
 * Only GET/HEAD are served; paths are confined to the root.
 * This file is for local verification only and writes no pid or log files.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function send(response, status, body, headers) {
  response.writeHead(status, Object.assign({
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, headers || {}));
  response.end(body);
}

export function createStaticServer(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || DEFAULT_ROOT);

  return http.createServer(function (request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'method not allowed', { allow: 'GET, HEAD' });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    } catch (err) {
      send(response, 400, 'bad request');
      return;
    }

    let target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      send(response, 403, 'forbidden');
      return;
    }

    try {
      let stat = fs.statSync(target);
      if (stat.isDirectory()) {
        target = path.join(target, 'index.html');
        stat = fs.statSync(target);
      }
      if (!stat.isFile()) {
        send(response, 404, 'not found');
        return;
      }
      const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      response.writeHead(200, {
        'content-type': type,
        'content-length': stat.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      fs.createReadStream(target).on('error', function () {
        try { response.destroy(); } catch (err) { /* ignore */ }
      }).pipe(response);
    } catch (err) {
      send(response, 404, 'not found');
    }
  });
}

export function startServer(options) {
  const opts = options || {};
  const host = opts.host || '127.0.0.1';
  const port = Number.isInteger(opts.port) ? opts.port : 0;
  return new Promise(function (resolve, reject) {
    const server = createStaticServer(opts);
    server.once('error', reject);
    server.listen(port, host, function () {
      const address = server.address();
      const origin = 'http://' + host + ':' + address.port;
      resolve({
        server: server,
        host: host,
        port: address.port,
        origin: origin,
        url: origin + '/play/card-battle.html',
        close: function () {
          return new Promise(function (done) { server.close(function () { done(); }); });
        }
      });
    });
  });
}

function parseArgs(argv) {
  const opts = { port: 0, host: '127.0.0.1', root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') opts.port = Number(argv[++i]) || 0;
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice(7)) || 0;
    else if (arg === '--host') opts.host = argv[++i] || '127.0.0.1';
    else if (arg.startsWith('--host=')) opts.host = arg.slice(7) || '127.0.0.1';
    else if (arg === '--root') opts.root = path.resolve(argv[++i] || DEFAULT_ROOT);
    else if (arg.startsWith('--root=')) opts.root = path.resolve(arg.slice(7));
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node play/serve.mjs [--port N] [--host 127.0.0.1] [--root games/boardgame]');
      process.exit(0);
    }
  }
  return opts;
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  startServer(opts).then(function (handle) {
    console.log('boardgame play server: ' + handle.url);
    console.log('serving root: ' + path.resolve(opts.root || DEFAULT_ROOT));
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
