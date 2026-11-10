#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency static file server (Node http/fs only).
 *
 *   node tools/serve.mjs --root . --port 8099
 *   node tools/serve.mjs --root games/boardgame --port 8123
 *
 * Binds 127.0.0.1 only. Serves GET/HEAD, maps directories to index.html,
 * answers 404 for missing files, and confines every request to --root.
 *
 * The same server is exported for preview/smoke scripts:
 *   import { createStaticServer, startServer } from '../../tools/serve.mjs';
 */

import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8'
};

function send(response, status, body, headers) {
  response.writeHead(status, Object.assign({
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, headers || {}));
  response.end(body);
}

function resolveRoot(root) {
  if (!root) throw new TypeError('serve: --root <dir> is required');
  return path.resolve(root);
}

/**
 * Build the HTTP server for one document root. The root is captured at
 * construction time, so callers can pass server.root to other helpers.
 */
export function createStaticServer(options) {
  const opts = options || {};
  const root = resolveRoot(opts.root);

  const server = http.createServer(function (request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, '405 Method Not Allowed', { allow: 'GET, HEAD' });
      return;
    }

    let parsed;
    try {
      parsed = new URL(request.url || '/', 'http://127.0.0.1');
    } catch (err) {
      send(response, 400, '400 Bad Request');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(parsed.pathname);
    } catch (err) {
      send(response, 400, '400 Bad Request');
      return;
    }
    if (pathname.includes('\0')) {
      send(response, 400, '400 Bad Request');
      return;
    }
    if (!pathname.startsWith('/')) pathname = '/' + pathname;

    // Online pages query the read-only leaderboard on load. This preview /
    // quality-gate server is static, so answer with an empty list instead of a
    // 404 (the real route lives in games/boardgame/app/server.mjs and
    // games/shared/online-room-server.mjs).
    if (request.method === 'GET' && pathname === '/api/leaderboard') {
      const body = JSON.stringify({ entries: [] });
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      response.end(body);
      return;
    }

    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      send(response, 403, '403 Forbidden');
      return;
    }

    stat(target).then(async function (info) {
      let file = target;
      let fileInfo = info;

      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) {
          response.writeHead(301, {
            location: pathname + '/' + (parsed.search || ''),
            'cache-control': 'no-store'
          });
          response.end();
          return;
        }
        file = path.join(target, 'index.html');
        fileInfo = await stat(file);
      }

      if (!fileInfo.isFile()) {
        send(response, 404, '404 Not Found');
        return;
      }

      response.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': fileInfo.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(file)
        .on('error', function () {
          try { response.destroy(); } catch (err) { /* socket already gone */ }
        })
        .pipe(response);
    }).catch(function () {
      send(response, 404, '404 Not Found');
    });
  });

  server.root = root;
  return server;
}

/**
 * Start a server on 127.0.0.1. Port 0 picks a free port.
 * Resolves to { server, host, port, origin, close() }.
 */
export function startServer(options) {
  const opts = options || {};
  const root = resolveRoot(opts.root);
  const host = opts.host || HOST;
  const port = opts.port === undefined || opts.port === null ? 0 : Number(opts.port);

  if (host !== HOST && host !== 'localhost' && host !== '::1') {
    return Promise.reject(new Error('serve: only 127.0.0.1 is allowed, got ' + host));
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(new Error('serve: invalid port ' + opts.port));
  }

  return new Promise(function (resolve, reject) {
    const server = createStaticServer({ root: root });
    // Track sockets from the moment the server accepts them so close() can
    // force-destroy whatever is still around. server.close() alone waits for
    // keep-alive sockets (Chrome holds them for minutes), which used to make
    // test teardown take 100-260s instead of milliseconds.
    const sockets = new Set();
    server.on('connection', function (socket) {
      sockets.add(socket);
      socket.once('close', function () { sockets.delete(socket); });
    });
    server.once('error', reject);

    let closePromise = null;
    function close() {
      if (closePromise) return closePromise;
      closePromise = new Promise(function (done) {
        let finished = false;
        const timers = [];
        function finish() {
          if (finished) return;
          finished = true;
          for (const timer of timers) clearTimeout(timer);
          done();
        }

        // Stop accepting new connections, then drop every live socket,
        // including idle keep-alive ones. The callback fires when the last
        // connection ends, which is now immediate in practice.
        try {
          server.close(finish);
        } catch (err) {
          finish();
        }
        if (typeof server.closeAllConnections === 'function') {
          try { server.closeAllConnections(); } catch (err) { /* already closed */ }
        }

        // Belt and braces for slower platforms / sockets created between the
        // call above and server.close(): destroy survivors after 2s, and make
        // sure the close promise settles no later than 5s.
        timers.push(setTimeout(function () {
          for (const socket of sockets) {
            try { socket.destroy(); } catch (err) { /* socket already gone */ }
          }
        }, 2000));
        timers.push(setTimeout(finish, 5000));
      });
      return closePromise;
    }

    server.listen(port, HOST, function () {
      const actual = server.address().port;
      resolve({
        server: server,
        root: root,
        host: HOST,
        port: actual,
        origin: 'http://' + HOST + ':' + actual,
        close: close
      });
    });
  });
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), port: 8099 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i] || '';
    else if (arg.startsWith('--root=')) opts.root = arg.slice('--root='.length);
    else if (arg === '--port') opts.port = argv[++i] || '';
    else if (arg.startsWith('--port=')) opts.port = arg.slice('--port='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node tools/serve.mjs --root <dir> --port <n>');
      process.exit(0);
    } else {
      console.error('serve: unknown argument ' + arg);
      process.exit(2);
    }
  }
  if (!opts.root) {
    console.error('serve: --root <dir> is required');
    process.exit(2);
  }
  opts.port = Number(opts.port);
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error('serve: --port must be 0-65535, got ' + opts.port);
    process.exit(2);
  }
  return opts;
}

function printEntries(root, origin) {
  const entries = [
    ['games/index.html', '游戏大厅（中文）'],
    ['games/en/index.html', '游戏大厅（英文）'],
    ['games/id/index.html', '游戏大厅（印尼语）'],
    ['tools/index.html', '工具站（中文）'],
    ['tools/en/index.html', '工具站（英文）'],
    ['tools/id/index.html', '工具站（印尼语）'],
    ['index.html', '站点首页']
  ].filter(function (entry) { return existsSync(path.join(root, entry[0])); });

  if (entries.length === 0) return;
  console.log('可访问入口:');
  for (const [relative, label] of entries) {
    const dir = path.dirname(relative);
    const url = origin + '/' + (dir === '.' ? '' : dir + '/');
    console.log('  ' + url + '  ' + label);
  }
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  let port = opts.port;
  let tries = 0;

  function listen(actualPort) {
    startServer({ root: opts.root, port: actualPort }).then(function (handle) {
      const origin = handle.origin;
      if (opts.port !== 0 && handle.port !== opts.port) console.log('端口 ' + opts.port + ' 已被占用，顺延到 ' + handle.port);
      console.log('服务根目录: ' + handle.root);
      console.log('本地预览已启动: ' + origin + '/');
      printEntries(handle.root, origin);
      console.log('按 Ctrl+C 退出。');

      let stopping = false;
      const shutdown = function () {
        if (stopping) return;
        stopping = true;
        handle.close().then(function () { process.exit(0); });
        setTimeout(function () { process.exit(0); }, 1000).unref();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    }).catch(function (err) {
      if (err && err.code === 'EADDRINUSE' && tries < 100 && port < 65535) {
        tries += 1;
        port += 1;
        listen(port);
        return;
      }
      console.error('serve: ' + (err && err.message ? err.message : String(err)));
      process.exit(1);
    });
  }

  listen(port);
}
