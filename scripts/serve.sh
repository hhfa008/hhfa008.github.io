#!/usr/bin/env bash
# 本地静态预览：用 node 起服务（与 CI 一致），默认端口 8099。
# 本地预览不需要部署，改完刷新即可。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="8099"
HOST="127.0.0.1"

usage() {
  cat <<'EOF'
用法: scripts/serve.sh [选项]

在本地启动静态预览服务（默认 http://127.0.0.1:8099/）。

选项:
  --port N     监听端口，默认 8099；端口被占用时自动顺延到下一个可用端口
  --host H     监听地址，默认 127.0.0.1
  -h, --help   显示本帮助

示例:
  scripts/serve.sh
  scripts/serve.sh --port 9000

提示: 本地预览不需要部署，改完刷新即可。按 Ctrl+C 干净退出。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      [[ $# -ge 2 ]] || { echo "错误: --port 需要一个端口号" >&2; exit 2; }
      PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --host)
      [[ $# -ge 2 ]] || { echo "错误: --host 需要一个地址" >&2; exit 2; }
      HOST="$2"; shift 2 ;;
    --host=*) HOST="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误: 未知参数 $1（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "错误: 端口必须是 1-65535 的数字，收到: $PORT" >&2
  exit 2
fi

if [[ ! -f "$ROOT/index.html" ]]; then
  echo "错误: 仓库根目录缺少 index.html: $ROOT" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误: 找不到 node。本脚本用 node 起服务（与 CI 一致）。" >&2
  exit 1
fi

echo "服务根目录: $ROOT"
ROOT="$ROOT" HOST="$HOST" PORT="$PORT" exec node <<'NODE'
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ROOT;
const HOST = process.env.HOST;
const START_PORT = parseInt(process.env.PORT, 10);
const MAX_TRIES = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
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

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendNotFound(res, req) {
  const custom = path.join(ROOT, '404.html');
  fs.stat(custom, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, '404 Not Found');
    serveFile(res, custom, st, req, 404);
  });
}

function serveFile(res, filePath, st, req, forcedCode) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-store'
  };
  res.writeHead(forcedCode || 200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, '405 Method Not Allowed');
  }

  let parsed;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }

  if (pathname.includes('\0')) return sendText(res, 400, '400 Bad Request');

  let filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendText(res, 403, '403 Forbidden');
  }

  fs.stat(filePath, (err, st) => {
    if (err) return sendNotFound(res, req);

    if (st.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const location = pathname + '/' + (parsed.search || '');
        res.writeHead(301, { Location: location });
        return res.end();
      }
      const indexPath = path.join(filePath, 'index.html');
      return fs.stat(indexPath, (err2, st2) => {
        if (err2 || !st2.isFile()) return sendNotFound(res, req);
        serveFile(res, indexPath, st2, req);
      });
    }

    if (!st.isFile()) return sendNotFound(res, req);
    serveFile(res, filePath, st, req);
  });
}

let currentServer = null;
let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;
  process.stdout.write('\n已停止本地预览。\n');
  const done = () => process.exit(0);
  if (currentServer && currentServer.listening) {
    currentServer.close(done);
    setTimeout(done, 1000).unref();
  } else {
    done();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function listen(port, remaining) {
  const server = http.createServer(handler);
  currentServer = server;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && remaining > 0 && port < 65535) {
      console.log(`端口 ${port} 已被占用，顺延到 ${port + 1}`);
      listen(port + 1, remaining - 1);
      return;
    }
    console.error(`启动失败: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    if (port !== START_PORT) console.log(`实际监听端口: ${port}`);
    const shownHost = (HOST === '0.0.0.0' || HOST === '::') ? '127.0.0.1' : HOST;
    const base = `http://${shownHost}:${port}`;
    console.log(`本地预览已启动: ${base}/`);
    console.log('');
    console.log('可访问入口:');
    console.log(`  ${base}/games/       游戏大厅（中文）`);
    console.log(`  ${base}/games/en/    游戏大厅（英文）`);
    console.log(`  ${base}/games/id/    游戏大厅（印尼语）`);
    console.log(`  ${base}/tools/       工具站（中文）`);
    console.log(`  ${base}/tools/en/    工具站（英文）`);
    console.log(`  ${base}/tools/id/    工具站（印尼语）`);
    console.log(`  ${base}/             站点首页`);
    console.log('');
    console.log('提示：本地预览不需要部署，改完刷新即可。');
    console.log('按 Ctrl+C 退出。');
  });
}

listen(START_PORT, MAX_TRIES);
NODE
