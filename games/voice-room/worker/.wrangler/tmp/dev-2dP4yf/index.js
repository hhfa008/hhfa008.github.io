var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// wrangler-modules-watch:wrangler:modules-watch
var init_wrangler_modules_watch = __esm({
  "wrangler-modules-watch:wrangler:modules-watch"() {
    init_modules_watch_stub();
  }
});

// ../../../../../../../../.npm-global/lib/node_modules/wrangler/templates/modules-watch-stub.js
var init_modules_watch_stub = __esm({
  "../../../../../../../../.npm-global/lib/node_modules/wrangler/templates/modules-watch-stub.js"() {
    init_wrangler_modules_watch();
  }
});

// ../../shared/rules.js
var require_rules = __commonJS({
  "../../shared/rules.js"(exports, module) {
    init_modules_watch_stub();
    (function(root, factory) {
      var api = factory();
      if (typeof module === "object" && module.exports) module.exports = api;
      if (root) root.GameRules = api;
    })(typeof globalThis !== "undefined" ? globalThis : exports, function() {
      "use strict";
      var gomoku2 = (function() {
        var N = 15, EMPTY = 0, BLACK = 1, WHITE = 2;
        var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
        function inBoard(r, c) {
          return r >= 0 && r < N && c >= 0 && c < N;
        }
        __name(inBoard, "inBoard");
        function checkWinAt(b, r, c, p) {
          for (var d = 0; d < 4; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1], n = 1, k, rr, cc;
            for (k = 1; k < 5; k++) {
              rr = r + dr * k;
              cc = c + dc * k;
              if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
              n++;
            }
            for (k = 1; k < 5; k++) {
              rr = r - dr * k;
              cc = c - dc * k;
              if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
              n++;
            }
            if (n >= 5) return true;
          }
          return false;
        }
        __name(checkWinAt, "checkWinAt");
        function lineAt(b, r, c, p) {
          if (!inBoard(r, c) || b[r * N + c] !== p) return null;
          for (var d = 0; d < 4; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1];
            var cells = [r * N + c], k, rr, cc;
            for (k = 1; k < 5; k++) {
              rr = r + dr * k;
              cc = c + dc * k;
              if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
              cells.push(rr * N + cc);
            }
            for (k = 1; k < 5; k++) {
              rr = r - dr * k;
              cc = c - dc * k;
              if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
              cells.unshift(rr * N + cc);
            }
            if (cells.length >= 5) return cells;
          }
          return null;
        }
        __name(lineAt, "lineAt");
        function index(r, c) {
          return r * N + c;
        }
        __name(index, "index");
        function rowOf(i) {
          return i / N | 0;
        }
        __name(rowOf, "rowOf");
        function colOf(i) {
          return i % N;
        }
        __name(colOf, "colOf");
        return {
          N,
          NN: N * N,
          EMPTY,
          BLACK,
          WHITE,
          DIRS,
          inBoard,
          checkWinAt,
          lineAt,
          index,
          rowOf,
          colOf
        };
      })();
      var connect42 = (function() {
        var ROWS = 6, COLS = 7, P1 = 1, P2 = 2, WIN = 1e6;
        var ORDER = [3, 2, 4, 1, 5, 0, 6];
        var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
        var WINDOWS = (function() {
          var w = [], r, c, i, cells;
          for (r = 0; r < ROWS; r++) for (c = 0; c <= COLS - 4; c++) {
            cells = [];
            for (i = 0; i < 4; i++) cells.push(r * COLS + c + i);
            w.push(cells);
          }
          for (c = 0; c < COLS; c++) for (r = 0; r <= ROWS - 4; r++) {
            cells = [];
            for (i = 0; i < 4; i++) cells.push((r + i) * COLS + c);
            w.push(cells);
          }
          for (r = 0; r <= ROWS - 4; r++) for (c = 0; c <= COLS - 4; c++) {
            cells = [];
            for (i = 0; i < 4; i++) cells.push((r + i) * COLS + c + i);
            w.push(cells);
          }
          for (r = 3; r < ROWS; r++) for (c = 0; c <= COLS - 4; c++) {
            cells = [];
            for (i = 0; i < 4; i++) cells.push((r - i) * COLS + c + i);
            w.push(cells);
          }
          return w;
        })();
        function setup() {
          return { b: new Int8Array(ROWS * COLS), turn: P1, last: -1, plies: 0 };
        }
        __name(setup, "setup");
        function clone(s) {
          return { b: new Int8Array(s.b), turn: s.turn, last: s.last, plies: s.plies };
        }
        __name(clone, "clone");
        function isLegal(s, c) {
          return c >= 0 && c < COLS && s.b[c] === 0;
        }
        __name(isLegal, "isLegal");
        function legalMoves(s) {
          var out = [], c;
          for (c = 0; c < COLS; c++) if (s.b[c] === 0) out.push(c);
          return out;
        }
        __name(legalMoves, "legalMoves");
        function rowFor(b, c) {
          var r;
          for (r = ROWS - 1; r >= 0; r--) if (b[r * COLS + c] === 0) return r;
          return -1;
        }
        __name(rowFor, "rowFor");
        function lineAt(b, r, c, p) {
          var d, cells, rr, cc, k;
          for (d = 0; d < DIRS.length; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1];
            cells = [r * COLS + c];
            rr = r - dr;
            cc = c - dc;
            while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) {
              cells.unshift(rr * COLS + cc);
              rr -= dr;
              cc -= dc;
            }
            rr = r + dr;
            cc = c + dc;
            while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) {
              cells.push(rr * COLS + cc);
              rr += dr;
              cc += dc;
            }
            if (cells.length >= 4) return cells;
          }
          return null;
        }
        __name(lineAt, "lineAt");
        function scanWinner(b) {
          var r, c, p, line;
          for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
            p = b[r * COLS + c];
            if (!p) continue;
            line = lineAt(b, r, c, p);
            if (line) return { winner: p, line };
          }
          return null;
        }
        __name(scanWinner, "scanWinner");
        function applyMove(s, c) {
          if (!isLegal(s, c)) return null;
          var b = new Int8Array(s.b), r = rowFor(b, c);
          b[r * COLS + c] = s.turn;
          return { b, turn: 3 - s.turn, last: r * COLS + c, plies: s.plies + 1 };
        }
        __name(applyMove, "applyMove");
        function status(s) {
          var w = scanWinner(s.b);
          if (w) return { over: true, winner: w.winner, line: w.line, draw: false };
          if (s.plies >= ROWS * COLS || legalMoves(s).length === 0) {
            return { over: true, winner: 0, line: null, draw: true };
          }
          return { over: false, winner: 0, line: null, draw: false };
        }
        __name(status, "status");
        function wouldWin(s, c, p) {
          if (!isLegal(s, c)) return false;
          var b = new Int8Array(s.b), r = rowFor(b, c);
          b[r * COLS + c] = p;
          return !!lineAt(b, r, c, p);
        }
        __name(wouldWin, "wouldWin");
        function evalBoard(b, turn) {
          var score = 0, i, v, w, a1, a2, e;
          for (i = 0; i < WINDOWS.length; i++) {
            w = WINDOWS[i];
            a1 = 0;
            a2 = 0;
            for (v = 0; v < 4; v++) {
              if (b[w[v]] === P1) a1++;
              else if (b[w[v]] === P2) a2++;
            }
            e = 4 - a1 - a2;
            if (a1 && a2) continue;
            if (a1 === 3 && e === 1) score += 90;
            else if (a1 === 2 && e === 2) score += 12;
            else if (a1 === 1 && e === 3) score += 2;
            if (a2 === 3 && e === 1) score -= 110;
            else if (a2 === 2 && e === 2) score -= 14;
            else if (a2 === 1 && e === 3) score -= 2;
          }
          for (v = 0; v < ROWS; v++) {
            var m = b[v * COLS + 3];
            if (m === P1) score += 6;
            else if (m === P2) score -= 6;
            var l = b[v * COLS + 2], rr = b[v * COLS + 4];
            if (l === P1) score += 2;
            else if (l === P2) score -= 2;
            if (rr === P1) score += 2;
            else if (rr === P2) score -= 2;
          }
          return turn === P1 ? score : -score;
        }
        __name(evalBoard, "evalBoard");
        function heightsOf(b) {
          var h = [0, 0, 0, 0, 0, 0, 0], c, r;
          for (c = 0; c < COLS; c++) for (r = 0; r < ROWS; r++) if (b[r * COLS + c]) h[c]++;
          return h;
        }
        __name(heightsOf, "heightsOf");
        function search(b, h, turn, depth, alpha, beta, ply, ctx) {
          ctx.nodes++;
          if ((ctx.nodes & 1023) === 0 && (Date.now() > ctx.deadline || ctx.nodes >= ctx.maxNodes)) {
            ctx.abort = true;
          }
          if (ctx.abort) return 0;
          if (depth <= 0) return evalBoard(b, turn);
          var best = -1e9, moved = false, i, c, r, val;
          for (i = 0; i < COLS; i++) {
            c = ORDER[i];
            if (h[c] >= ROWS) continue;
            r = ROWS - 1 - h[c];
            b[r * COLS + c] = turn;
            h[c]++;
            if (lineAt(b, r, c, turn)) val = WIN - ply;
            else val = -search(b, h, 3 - turn, depth - 1, -beta, -alpha, ply + 1, ctx);
            b[r * COLS + c] = 0;
            h[c]--;
            if (ctx.abort) return 0;
            moved = true;
            if (val > best) best = val;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
          }
          return moved ? best : 0;
        }
        __name(search, "search");
        function easyMove(s) {
          var legal = legalMoves(s), i;
          for (i = 0; i < legal.length; i++) if (wouldWin(s, legal[i], s.turn)) return legal[i];
          for (i = 0; i < legal.length; i++) if (wouldWin(s, legal[i], 3 - s.turn)) return legal[i];
          return legal[Math.floor(Math.random() * legal.length)];
        }
        __name(easyMove, "easyMove");
        function aiMove(s, level, budget) {
          var legal = legalMoves(s), ln = +level || 2;
          if (!legal.length) return null;
          if (ln === 1) return easyMove(s);
          var depthCap = ln >= 3 ? 7 : 4;
          var deadline = Date.now() + (budget || (ln >= 3 ? 480 : 400));
          var ctx = {
            nodes: 0,
            deadline,
            abort: false,
            maxNodes: ln >= 3 ? 42e4 : 26e4
          };
          var b = new Int8Array(s.b), h = heightsOf(b), turn = s.turn;
          var order = [], i;
          for (i = 0; i < COLS; i++) if (h[ORDER[i]] < ROWS) order.push(ORDER[i]);
          var best = order[0], d;
          for (d = 1; d <= depthCap; d++) {
            var alpha = -1e9, localVal = -1e9, localBest = null;
            var list = order.slice(), bi = list.indexOf(best), k, c, r, val;
            if (bi > 0) {
              list.splice(bi, 1);
              list.unshift(best);
            }
            for (k = 0; k < list.length; k++) {
              c = list[k];
              r = ROWS - 1 - h[c];
              b[r * COLS + c] = turn;
              h[c]++;
              if (lineAt(b, r, c, turn)) val = WIN - 1;
              else val = -search(b, h, 3 - turn, d - 1, -1e9, -alpha, 1, ctx);
              b[r * COLS + c] = 0;
              h[c]--;
              if (ctx.abort) break;
              if (val > localVal) {
                localVal = val;
                localBest = c;
              }
              if (val > alpha) alpha = val;
            }
            if (!ctx.abort && localBest !== null) best = localBest;
            if (ctx.abort || localVal >= WIN - 100) break;
          }
          return best;
        }
        __name(aiMove, "aiMove");
        return {
          ROWS,
          COLS,
          P1,
          P2,
          setup,
          clone,
          isLegal,
          legalMoves,
          rowFor,
          lineAt,
          scanWinner,
          applyMove,
          status,
          wouldWin,
          evaluate: evalBoard,
          aiMove
        };
      })();
      return { gomoku: gomoku2, connect4: connect42 };
    });
  }
});

// .wrangler/tmp/bundle-8RNpoz/middleware-loader.entry.ts
init_modules_watch_stub();

// .wrangler/tmp/bundle-8RNpoz/middleware-insertion-facade.js
init_modules_watch_stub();

// src/index.js
init_modules_watch_stub();

// src/room.js
init_modules_watch_stub();
var import_rules = __toESM(require_rules());
var RULES = globalThis.GameRules;
var gomoku = RULES.gomoku;
var connect4 = RULES.connect4;
var MAX_MEMBERS = 4;
var RECONNECT_GRACE_MS = 60 * 1e3;
var PASSWORD_MIN = 4;
var PASSWORD_MAX = 32;
var MAX_PASSWORD_FAILS = 5;
var PASSWORD_LOCK_MS = 60 * 1e3;
var JOIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1e3;
function bytesToBase64Url(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function base64UrlToBytes(str) {
  const b64 = String(str == null ? "" : str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - b64.length % 4) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(base64UrlToBytes, "base64UrlToBytes");
async function passwordDigest(saltBytes, password) {
  const pw = new TextEncoder().encode(String(password));
  const buf = new Uint8Array(saltBytes.length + pw.length);
  buf.set(saltBytes, 0);
  buf.set(pw, saltBytes.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}
__name(passwordDigest, "passwordDigest");
function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
__name(jsonResponse, "jsonResponse");
var KINDS = {
  ttt: { label: "\u4E95\u5B57\u68CB", size: 9, cols: 3, rows: 3 },
  gomoku: { label: "\u4E94\u5B50\u68CB", size: 225, cols: 15, rows: 15 },
  connect4: { label: "\u56DB\u5B50\u68CB", size: 42, cols: 7, rows: 6 }
};
var DEFAULT_KIND = "ttt";
var TTT_WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];
function cleanName(raw) {
  const s = String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 12);
  return s || "\u73A9\u5BB6";
}
__name(cleanName, "cleanName");
function cleanPid(raw) {
  return String(raw == null ? "" : raw).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}
__name(cleanPid, "cleanPid");
function isIntIn(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}
__name(isIntIn, "isIntIn");
function sortMembers(members) {
  return [...members].sort(
    (a, b) => a.joinedAt - b.joinedAt || String(a.id).localeCompare(String(b.id))
  );
}
__name(sortMembers, "sortMembers");
function hostIdOf(members) {
  const s = sortMembers(members);
  return s.length ? s[0].id : null;
}
__name(hostIdOf, "hostIdOf");
function seatsOf(members) {
  const s = sortMembers(members);
  return { xId: s[0] ? s[0].id : null, oId: s[1] ? s[1].id : null };
}
__name(seatsOf, "seatsOf");
function publicMembers(members) {
  const hostId = hostIdOf(members);
  return sortMembers(members).map((m) => ({
    id: m.id,
    name: m.name,
    mic: !!m.mic,
    host: m.id === hostId,
    joinedAt: m.joinedAt
  }));
}
__name(publicMembers, "publicMembers");
function kindOf(game) {
  return game && KINDS[game.kind] ? game.kind : DEFAULT_KIND;
}
__name(kindOf, "kindOf");
function emptyGame(kind, seats, round) {
  const spec = KINDS[kind] || KINDS[DEFAULT_KIND];
  return {
    kind: KINDS[kind] ? kind : DEFAULT_KIND,
    board: Array(spec.size).fill(null),
    turn: "X",
    winner: null,
    line: null,
    xId: seats.xId || null,
    oId: seats.oId || null,
    scores: { X: 0, O: 0 },
    round: round || 1,
    updatedAt: Date.now()
  };
}
__name(emptyGame, "emptyGame");
function scoreNum(v) {
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}
__name(scoreNum, "scoreNum");
function normalizeGameShape(game) {
  if (!game || typeof game !== "object" || Array.isArray(game)) return null;
  const kind = KINDS[game.kind] ? game.kind : DEFAULT_KIND;
  const spec = KINDS[kind];
  if (!Array.isArray(game.board) || game.board.length !== spec.size) return null;
  const board = game.board.map((v) => v === "X" || v === "O" ? v : null);
  const winner = game.winner === "X" || game.winner === "O" ? game.winner : game.winner === "draw" ? "draw" : null;
  const line = Array.isArray(game.line) ? game.line.filter((n) => Number.isInteger(n) && n >= 0 && n < spec.size) : null;
  return {
    kind,
    board,
    turn: game.turn === "O" ? "O" : "X",
    winner,
    line: line && line.length ? line : null,
    xId: typeof game.xId === "string" ? game.xId : null,
    oId: typeof game.oId === "string" ? game.oId : null,
    scores: {
      X: scoreNum(game.scores && game.scores.X),
      O: scoreNum(game.scores && game.scores.O)
    },
    round: Number.isInteger(game.round) && game.round > 0 ? game.round : 1,
    updatedAt: typeof game.updatedAt === "number" ? game.updatedAt : Date.now()
  };
}
__name(normalizeGameShape, "normalizeGameShape");
function isEmptyBoard(board) {
  return board.every((v) => v == null);
}
__name(isEmptyBoard, "isEmptyBoard");
function tttWinnerOf(board) {
  for (const line of TTT_WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return { winner: null, line: null };
}
__name(tttWinnerOf, "tttWinnerOf");
function toNumericBoard(board) {
  const out = new Uint8Array(board.length);
  for (let i = 0; i < board.length; i++) {
    out[i] = board[i] === "X" ? 1 : board[i] === "O" ? 2 : 0;
  }
  return out;
}
__name(toNumericBoard, "toNumericBoard");
function fromNumericBoard(nums) {
  return Array.from(nums, (v) => v === 1 ? "X" : v === 2 ? "O" : null);
}
__name(fromNumericBoard, "fromNumericBoard");
function stoneCount(board) {
  let n = 0;
  for (const v of board) if (v) n++;
  return n;
}
__name(stoneCount, "stoneCount");
function alignGame(game, roster, activeRoster) {
  const norm = normalizeGameShape(game);
  if (!norm) return emptyGame(kindOf(game), seatsOf(activeRoster.length ? activeRoster : roster), 1);
  const ids = new Set(roster.map((m) => m.id));
  if (norm.xId && !ids.has(norm.xId) || norm.oId && !ids.has(norm.oId)) {
    return emptyGame(norm.kind, seatsOf(activeRoster.length ? activeRoster : roster), 1);
  }
  const needsSeats = !norm.xId || !norm.oId && roster.length >= 2;
  if (needsSeats && isEmptyBoard(norm.board)) {
    const seats = seatsOf(activeRoster.length ? activeRoster : roster);
    if (seats.xId !== norm.xId || seats.oId !== norm.oId) {
      norm.xId = seats.xId;
      norm.oId = seats.oId;
    }
  }
  return norm;
}
__name(alignGame, "alignGame");
function roomState(room, roster, hostId) {
  return {
    type: "room_state",
    room,
    hostId,
    members: publicMembers(roster)
  };
}
__name(roomState, "roomState");
var RoomDO = class {
  static {
    __name(this, "RoomDO");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomCode = null;
    this.alarmAt = null;
  }
  async init() {
    if (this.roomCode) return;
    const meta = await this.state.storage.get("meta");
    this.roomCode = meta && meta.room ? meta.room : null;
  }
  async loadStoredMembers() {
    const stored = await this.state.storage.get("members");
    return Array.isArray(stored) ? stored : [];
  }
  async saveMembers(members) {
    await this.state.storage.put("members", members);
  }
  async loadGame() {
    return await this.state.storage.get("game") || null;
  }
  async saveGame(game) {
    await this.state.storage.put("game", game);
  }
  // HMAC secret lives in DO storage. Kept in memory per instance so concurrent
  // requests cannot mint two different secrets.
  tokenSecret() {
    if (!this._tokenSecret) {
      this._tokenSecret = (async () => {
        let sec = await this.state.storage.get("tokenSecret");
        if (!sec) {
          sec = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
          await this.state.storage.put("tokenSecret", sec);
        }
        return base64UrlToBytes(sec);
      })();
    }
    return this._tokenSecret;
  }
  async signPayload(payload) {
    const secret = await this.tokenSecret();
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  }
  async makeJoinToken(room, pid) {
    const exp = Date.now() + JOIN_TOKEN_TTL_MS;
    const sig = await this.signPayload(room + "|" + pid + "|" + exp);
    return exp + "." + bytesToBase64Url(sig);
  }
  async verifyJoinToken(room, pid, token) {
    const text = String(token || "");
    const dot = text.indexOf(".");
    if (dot <= 0 || dot === text.length - 1) return false;
    const exp = Number(text.slice(0, dot));
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    let got;
    try {
      got = base64UrlToBytes(text.slice(dot + 1));
    } catch (e) {
      return false;
    }
    const want = await this.signPayload(room + "|" + pid + "|" + exp);
    return constantTimeEqual(got, want);
  }
  async verifyPassword(password, auth) {
    try {
      const salt = base64UrlToBytes(auth.salt);
      const want = base64UrlToBytes(auth.hash);
      const got = await passwordDigest(salt, password);
      return constantTimeEqual(got, want);
    } catch (e) {
      return false;
    }
  }
  // Password check happens over plain HTTP *before* any WebSocket is opened.
  // Never log or echo the password.
  async handleJoin(request, room) {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ ok: false, code: "bad_request" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ ok: false, code: "bad_request" });
    }
    const pid = cleanPid(body.pid);
    const create = body.create === true;
    const password = typeof body.password === "string" ? body.password : "";
    const now = Date.now();
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-client-ip") || "unknown";
    let meta = await this.state.storage.get("meta");
    if (!meta) meta = { room, createdAt: now };
    if (!meta.room) meta.room = room;
    const auth = meta.auth && meta.auth.hash ? meta.auth : null;
    if (create && password && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
      return jsonResponse({ ok: false, code: "bad_password_format" });
    }
    const rateKey = "rate:" + ip;
    const rate = await this.state.storage.get(rateKey);
    if (rate && rate.until && rate.until > now) {
      return jsonResponse({
        ok: false,
        code: "rate_limited",
        retryAfter: Math.ceil((rate.until - now) / 1e3)
      });
    }
    if (create && password && !auth) {
      const roster = await this.normalizeRoster();
      if (roster.length > 0) {
        return jsonResponse({ ok: false, code: "room_exists" });
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await passwordDigest(salt, password);
      meta.auth = {
        algo: "sha256",
        salt: bytesToBase64Url(salt),
        hash: bytesToBase64Url(hash),
        length: password.length
      };
      await this.state.storage.put("meta", meta);
    } else if (auth) {
      if (create) return jsonResponse({ ok: false, code: "room_exists" });
      if (!password) return jsonResponse({ ok: false, code: "need_password" });
      if (!await this.verifyPassword(password, auth)) {
        const fails = (rate && rate.fails || 0) + 1;
        const next = { fails, until: 0 };
        if (fails >= MAX_PASSWORD_FAILS) {
          next.fails = 0;
          next.until = now + PASSWORD_LOCK_MS;
        }
        await this.state.storage.put(rateKey, next);
        return jsonResponse({ ok: false, code: "bad_password" });
      }
      await this.state.storage.delete(rateKey);
    } else {
      if (create) await this.state.storage.put("meta", meta);
    }
    if (!meta.createdAt) {
      meta.createdAt = now;
      await this.state.storage.put("meta", meta);
    }
    const token = await this.makeJoinToken(room, pid);
    return jsonResponse({ ok: true, token, hasPassword: !!meta.auth });
  }
  // Every live socket, skipping sockets that were replaced by a reconnect.
  activeSockets() {
    const out = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id && !a.replaced) out.push({ ws, a });
    }
    return out;
  }
  activeIds() {
    return new Set(this.activeSockets().map(({ a }) => a.id));
  }
  activeMembers(members, exclude) {
    const ids = this.activeIds();
    if (exclude) for (const id of exclude) ids.delete(id);
    return members.filter((m) => ids.has(m.id));
  }
  send(ws, msg) {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
    }
  }
  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const { ws } of this.activeSockets()) {
      try {
        ws.send(payload);
      } catch (e) {
      }
    }
  }
  socketById(id) {
    for (const { ws, a } of this.activeSockets()) {
      if (a.id === id) return ws;
    }
    return null;
  }
  error(ws, code, message) {
    this.send(ws, { type: "error", room: this.roomCode, code, message });
  }
  async ensureAlarm(roster) {
    let next = null;
    for (const m of roster) {
      if (m.leftAt != null) {
        const at = m.leftAt + RECONNECT_GRACE_MS + 50;
        if (next == null || at < next) next = at;
      }
    }
    if (next == null) {
      if (this.alarmAt != null) {
        try {
          await this.state.storage.deleteAlarm();
        } catch (e) {
        }
        this.alarmAt = null;
      }
      return;
    }
    if (this.alarmAt === next) return;
    try {
      await this.state.storage.setAlarm(next);
      this.alarmAt = next;
    } catch (e) {
    }
  }
  // Mark members whose sockets vanished, drop members past the reconnect
  // grace window, and keep an alarm armed so a silent room is cleaned up.
  async normalizeRoster() {
    const stored = await this.loadStoredMembers();
    const active = this.activeIds();
    const now = Date.now();
    let dirty = false;
    const roster = [];
    for (const raw of stored) {
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string") {
        dirty = true;
        continue;
      }
      let m = raw;
      if (active.has(m.id)) {
        if (m.leftAt != null) {
          m = { ...m, leftAt: null };
          dirty = true;
        }
      } else {
        if (m.leftAt == null) {
          m = { ...m, leftAt: now };
          dirty = true;
        }
        if (now - m.leftAt >= RECONNECT_GRACE_MS) {
          dirty = true;
          continue;
        }
      }
      roster.push(m);
    }
    if (dirty) await this.saveMembers(roster);
    await this.ensureAlarm(roster);
    return roster;
  }
  async fetch(request) {
    await this.init();
    const url = new URL(request.url);
    const room = url.searchParams.get("room") || "";
    if (!/^\d{4}$/.test(room)) {
      return new Response("bad room", { status: 400 });
    }
    if (this.roomCode && this.roomCode !== room) {
      return new Response("room mismatch", { status: 403 });
    }
    this.roomCode = room;
    if (url.pathname === "/join") {
      return this.handleJoin(request, room);
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pid = cleanPid(url.searchParams.get("pid"));
    const token = url.searchParams.get("token") || "";
    if (!await this.verifyJoinToken(room, pid, token)) {
      return new Response("password required", { status: 403 });
    }
    const meta = await this.state.storage.get("meta");
    if (!meta) {
      await this.state.storage.put("meta", { room, createdAt: Date.now() });
    }
    const rosterBefore = await this.normalizeRoster();
    const activeBefore = this.activeMembers(rosterBefore);
    const name = cleanName(url.searchParams.get("name"));
    const existing = pid ? rosterBefore.find((m) => m.pid === pid) : null;
    const existingActive = existing ? this.activeIds().has(existing.id) : false;
    if (activeBefore.length >= MAX_MEMBERS && !existingActive) {
      const pair2 = new WebSocketPair();
      const client2 = pair2[0];
      const server2 = pair2[1];
      this.state.acceptWebSocket(server2);
      this.send(server2, {
        type: "error",
        room,
        code: "room_full",
        message: "\u623F\u95F4\u5DF2\u6EE1\uFF08\u6700\u591A 4 \u4EBA\uFF09"
      });
      server2.close(4001, "room_full");
      return new Response(null, { status: 101, webSocket: client2 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (existingActive) {
      const old = this.socketById(existing.id);
      if (old) {
        try {
          old.serializeAttachment({ ...old.deserializeAttachment(), replaced: true });
          old.close(4003, "replaced");
        } catch (e) {
        }
      }
    }
    const id = existing ? existing.id : crypto.randomUUID();
    const member = existing ? { ...existing, pid: pid || existing.pid, name: name || existing.name, leftAt: null } : { id, pid, name, mic: false, joinedAt: Date.now(), leftAt: null };
    const roster = existing ? rosterBefore.map((m) => m.id === id ? member : m) : [...rosterBefore, member];
    server.serializeAttachment({ id, name: member.name, room, pid: member.pid });
    this.state.acceptWebSocket(server);
    await this.saveMembers(roster);
    const active = this.activeMembers(roster);
    const game = alignGame(await this.loadGame(), roster, active);
    await this.saveGame(game);
    this.send(server, {
      type: "welcome",
      room,
      selfId: id,
      hostId: hostIdOf(active),
      members: publicMembers(active),
      game
    });
    this.broadcast(roomState(room, active, hostIdOf(active)));
    this.broadcast({ type: "game_state", room, game });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    await this.init();
    if (typeof raw !== "string") return;
    if (raw.length > 4e4) return;
    const attachment = ws.deserializeAttachment();
    if (!attachment || !attachment.id || attachment.replaced) return;
    const room = this.roomCode;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return this.error(ws, "bad_json", "\u6D88\u606F\u683C\u5F0F\u9519\u8BEF");
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    if (msg.room !== room) {
      return this.error(ws, "room_mismatch", "\u623F\u95F4\u53F7\u4E0D\u5339\u914D\uFF0C\u6D88\u606F\u5DF2\u62D2\u7EDD");
    }
    const roster = await this.normalizeRoster();
    const sender = roster.find((m) => m.id === attachment.id);
    if (!sender) {
      return this.error(ws, "not_member", "\u4F60\u4E0D\u5728\u8BE5\u623F\u95F4");
    }
    switch (msg.type) {
      case "ping":
        return this.send(ws, { type: "pong", room, t: msg.t || Date.now() });
      case "signal":
        return this.handleSignal(roster, sender, msg);
      case "mic":
        return this.handleMic(roster, sender, msg);
      case "game_move":
        return this.handleMove(roster, sender, msg);
      case "game_reset":
        return this.handleReset(roster, sender, msg);
      case "game_select":
        return this.handleSelect(roster, sender, msg);
      default:
        return this.error(ws, "unknown_type", "\u672A\u77E5\u6D88\u606F\u7C7B\u578B");
    }
  }
  async handleSignal(members, sender, msg) {
    const ws = this.socketById(sender.id);
    if (!msg.data || typeof msg.data !== "object" || Array.isArray(msg.data)) {
      return this.error(ws, "bad_signal");
    }
    const keys = Object.keys(msg.data);
    if (keys.some((k) => k !== "description" && k !== "candidate")) {
      return this.error(ws, "bad_signal");
    }
    if (msg.data.description) {
      const d = msg.data.description;
      if (!d || typeof d !== "object" || !["offer", "answer", "rollback"].includes(d.type)) {
        return this.error(ws, "bad_signal");
      }
    }
    if (msg.data.candidate) {
      const c = msg.data.candidate;
      if (typeof c !== "object" || c.candidate && String(c.candidate).length > 2e3) {
        return this.error(ws, "bad_signal");
      }
    }
    if (JSON.stringify(msg.data).length > 32e3) {
      return this.error(ws, "signal_too_large");
    }
    const targetId = msg.to;
    if (typeof targetId !== "string" || targetId === sender.id) return;
    const targetMember = members.find((m) => m.id === targetId);
    if (!targetMember || targetMember.leftAt != null) {
      return this.error(ws, "no_peer", "\u76EE\u6807\u6210\u5458\u4E0D\u5728\u623F\u95F4");
    }
    const target = this.socketById(targetId);
    if (!target) return;
    this.send(target, {
      type: "signal",
      room: this.roomCode,
      from: sender.id,
      data: msg.data
    });
  }
  async handleMic(members, sender, msg) {
    const next = !!msg.on;
    if (sender.mic === next) return;
    sender.mic = next;
    await this.saveMembers(members);
    const active = this.activeMembers(members);
    this.broadcast(roomState(this.roomCode, active, hostIdOf(active)));
  }
  async handleMove(members, sender, msg) {
    const ws = this.socketById(sender.id);
    const active = this.activeMembers(members);
    let game = alignGame(await this.loadGame(), members, active);
    await this.saveGame(game);
    if (!game.oId) {
      return this.error(ws, "waiting_peer", "\u7B49\u7B2C\u4E8C\u4F4D\u73A9\u5BB6\u52A0\u5165\u518D\u5F00\u59CB");
    }
    if (game.winner) {
      return this.error(ws, "game_over", "\u672C\u5C40\u5DF2\u7ED3\u675F\uFF0C\u8BF7\u5F00\u65B0\u5C40");
    }
    const turnId = game.turn === "X" ? game.xId : game.oId;
    if (sender.id !== turnId) {
      return this.error(ws, "not_your_turn", "\u8FD8\u6CA1\u8F6E\u5230\u4F60");
    }
    const player = game.turn === "X" ? 1 : 2;
    if (game.kind === "gomoku") {
      if (!isIntIn(msg.x, 0, 14) || !isIntIn(msg.y, 0, 14)) {
        return this.error(ws, "bad_move", "\u843D\u5B50\u5750\u6807\u4E0D\u5408\u6CD5");
      }
      const index = msg.y * 15 + msg.x;
      if (game.board[index]) {
        return this.error(ws, "cell_taken", "\u8FD9\u4E2A\u70B9\u5DF2\u7ECF\u6709\u68CB\u5B50");
      }
      const nums = toNumericBoard(game.board);
      nums[index] = player;
      const line = gomoku.lineAt(nums, msg.y, msg.x, player);
      game.board = fromNumericBoard(nums);
      if (line) {
        game.winner = game.turn;
        game.line = line;
        game.scores[game.turn] += 1;
      } else if (stoneCount(game.board) === KINDS.gomoku.size) {
        game.winner = "draw";
        game.line = null;
      } else {
        game.turn = game.turn === "X" ? "O" : "X";
      }
    } else if (game.kind === "connect4") {
      if (!isIntIn(msg.x, 0, 6)) {
        return this.error(ws, "bad_move", "\u5217\u53F7\u4E0D\u5408\u6CD5");
      }
      const state = {
        b: new Int8Array(toNumericBoard(game.board)),
        turn: player,
        last: -1,
        plies: stoneCount(game.board)
      };
      const applied = connect4.applyMove(state, msg.x);
      if (!applied) {
        return this.error(ws, "column_full", "\u8FD9\u4E00\u5217\u5DF2\u7ECF\u6EE1\u4E86");
      }
      const result = connect4.status(applied);
      game.board = fromNumericBoard(applied.b);
      game.turn = applied.turn === 1 ? "X" : "O";
      if (result.over) {
        if (result.draw) {
          game.winner = "draw";
          game.line = null;
        } else {
          game.winner = result.winner === 1 ? "X" : "O";
          game.line = result.line;
          game.scores[game.winner] += 1;
        }
      }
    } else {
      let index = -1;
      if (msg.x !== void 0 || msg.y !== void 0) {
        if (!isIntIn(msg.x, 0, 2) || !isIntIn(msg.y, 0, 2)) {
          return this.error(ws, "bad_move", "\u843D\u5B50\u5750\u6807\u4E0D\u5408\u6CD5");
        }
        index = msg.y * 3 + msg.x;
      } else if (isIntIn(msg.index, 0, 8)) {
        index = msg.index;
      } else {
        return this.error(ws, "bad_move", "\u843D\u5B50\u5750\u6807\u4E0D\u5408\u6CD5");
      }
      if (game.board[index]) {
        return this.error(ws, "cell_taken", "\u8FD9\u4E00\u683C\u5DF2\u7ECF\u6709\u68CB\u5B50");
      }
      game.board[index] = game.turn;
      const result = tttWinnerOf(game.board);
      if (result.winner) {
        game.winner = result.winner;
        game.line = result.line;
        game.scores[result.winner] += 1;
      } else if (game.board.every(Boolean)) {
        game.winner = "draw";
        game.line = null;
      } else {
        game.turn = game.turn === "X" ? "O" : "X";
      }
    }
    game.updatedAt = Date.now();
    await this.saveGame(game);
    this.broadcast({ type: "game_state", room: this.roomCode, game });
  }
  async handleReset(members, sender, msg) {
    const ws = this.socketById(sender.id);
    const active = this.activeMembers(members);
    if (sender.id !== hostIdOf(active)) {
      return this.error(ws, "host_only", "\u53EA\u6709\u623F\u4E3B\u53EF\u4EE5\u5F00\u65B0\u5C40");
    }
    const current = alignGame(await this.loadGame(), members, active);
    const next = emptyGame(current.kind, seatsOf(active.length ? active : members), (current.round || 1) + 1);
    next.scores = current.scores;
    await this.saveGame(next);
    this.broadcast({ type: "game_state", room: this.roomCode, game: next });
  }
  async handleSelect(members, sender, msg) {
    const ws = this.socketById(sender.id);
    const active = this.activeMembers(members);
    if (sender.id !== hostIdOf(active)) {
      return this.error(ws, "host_only", "\u53EA\u6709\u623F\u4E3B\u53EF\u4EE5\u6362\u6E38\u620F");
    }
    const kind = String(msg.kind || "");
    if (!KINDS[kind]) {
      return this.error(ws, "bad_game", "\u4E0D\u652F\u6301\u7684\u6E38\u620F");
    }
    const current = alignGame(await this.loadGame(), members, active);
    if (current.kind === kind) {
      return this.send(ws, { type: "game_state", room: this.roomCode, game: current });
    }
    const next = emptyGame(kind, seatsOf(active.length ? active : members), (current.round || 1) + 1);
    await this.saveGame(next);
    this.broadcast({ type: "game_state", room: this.roomCode, game: next });
  }
  // Sockets can disappear without webSocketClose (network loss, hibernation).
  // Keep the member for the reconnect grace window so the board survives.
  async markOffline(ws) {
    await this.init();
    if (!this.roomCode) return;
    const attachment = ws.deserializeAttachment();
    if (!attachment || !attachment.id || attachment.replaced) return;
    const stored = await this.loadStoredMembers();
    const idx = stored.findIndex((m) => m.id === attachment.id);
    if (idx === -1) return;
    stored[idx] = { ...stored[idx], leftAt: Date.now() };
    await this.saveMembers(stored);
    const roster = await this.normalizeRoster();
    if (!roster.length) return;
    const active = this.activeMembers(roster, /* @__PURE__ */ new Set([attachment.id]));
    const game = alignGame(await this.loadGame(), roster, active);
    await this.saveGame(game);
    this.broadcast(roomState(this.roomCode, active, hostIdOf(active)));
    this.broadcast({ type: "game_state", room: this.roomCode, game });
  }
  async webSocketClose(ws, code, reason, wasClean) {
    try {
      ws.close(code || 1e3, typeof reason === "string" ? reason.slice(0, 120) : "");
    } catch (e) {
    }
    await this.markOffline(ws);
  }
  async webSocketError(ws, error) {
    try {
      ws.close(1011, "websocket error");
    } catch (e) {
    }
    await this.markOffline(ws);
  }
  async alarm() {
    await this.init();
    this.alarmAt = null;
    if (!this.roomCode) {
      await this.state.storage.deleteAll();
      return;
    }
    const roster = await this.normalizeRoster();
    if (!roster.length) {
      await this.state.storage.deleteAll();
      this.roomCode = null;
      return;
    }
    const active = this.activeMembers(roster);
    const game = alignGame(await this.loadGame(), roster, active);
    await this.saveGame(game);
    this.broadcast(roomState(this.roomCode, active, hostIdOf(active)));
    this.broadcast({ type: "game_state", room: this.roomCode, game });
  }
};

// src/index.js
var ICE_TTL_SECONDS = 3600;
var ICE_CACHE_MS = 55 * 60 * 1e3;
var iceCache = { at: 0, body: null };
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
function originHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(originHeaders, "originHeaders");
function json(body, status = 200, extra = {}, origin = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...origin ? originHeaders(origin) : CORS_HEADERS,
      ...extra
    }
  });
}
__name(json, "json");
async function getIceServers(env) {
  const now = Date.now();
  if (iceCache.body && now - iceCache.at < ICE_CACHE_MS) {
    return { ...iceCache.body, cached: true };
  }
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    throw new Error("TURN is not configured");
  }
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ ttl: ICE_TTL_SECONDS })
    }
  );
  if (!res.ok) {
    throw new Error(`TURN API ${res.status}`);
  }
  const data = await res.json();
  const body = {
    iceServers: data.iceServers,
    ttl: ICE_TTL_SECONDS,
    expiresAt: now + ICE_TTL_SECONDS * 1e3
  };
  iceCache = { at: now, body };
  return body;
}
__name(getIceServers, "getIceServers");
function allowedOrigin(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === "hhfa008.github.io") return true;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]") {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}
__name(allowedOrigin, "allowedOrigin");
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (!allowedOrigin(origin)) {
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      }
      return new Response(null, {
        status: 204,
        headers: origin ? originHeaders(origin) : CORS_HEADERS
      });
    }
    if (url.pathname === "/health") {
      return json({ ok: true, service: "voice-room", ts: Date.now() });
    }
    if (url.pathname === "/api/ice") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const origin = request.headers.get("Origin");
      if (!allowedOrigin(origin)) {
        return json({ error: "origin_not_allowed" }, 403);
      }
      try {
        const data = await getIceServers(env);
        return json(data, 200, {}, origin || null);
      } catch (err) {
        return json({ error: "turn_unavailable" }, 502, {}, origin || null);
      }
    }
    if (url.pathname === "/api/join") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const origin = request.headers.get("Origin");
      if (!allowedOrigin(origin)) {
        return json({ error: "origin_not_allowed" }, 403, {}, origin || null);
      }
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, code: "bad_request" }, 400, {}, origin || null);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ ok: false, code: "bad_request" }, 400, {}, origin || null);
      }
      const room = String(body.room == null ? "" : body.room);
      if (!/^\d{4}$/.test(room)) {
        return json({ ok: false, code: "bad_room" }, 400, {}, origin || null);
      }
      if (typeof body.password === "string" && body.password.length > 64) {
        return json({ ok: false, code: "bad_password_format" }, 400, {}, origin || null);
      }
      const doUrl = new URL(request.url);
      doUrl.pathname = "/join";
      doUrl.search = "?room=" + encodeURIComponent(room);
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      const doReq = new Request(doUrl.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          pid: body.pid,
          password: body.password,
          create: body.create === true
        })
      });
      const id = env.ROOMS.idFromName(`room:${room}`);
      const res = await env.ROOMS.get(id).fetch(doReq);
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          ...origin ? originHeaders(origin) : CORS_HEADERS
        }
      });
    }
    if (url.pathname === "/ws") {
      if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const origin = request.headers.get("Origin");
      if (!allowedOrigin(origin)) {
        return new Response("origin not allowed", { status: 403 });
      }
      const room = url.searchParams.get("room") || "";
      if (!/^\d{4}$/.test(room)) {
        return new Response("room must be 4 digits", { status: 400 });
      }
      const name = (url.searchParams.get("name") || "").slice(0, 12);
      const doUrl = new URL(request.url);
      doUrl.searchParams.set("room", room);
      doUrl.searchParams.set("name", name);
      const id = env.ROOMS.idFromName(`room:${room}`);
      const stub = env.ROOMS.get(id);
      return stub.fetch(new Request(doUrl.toString(), request));
    }
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "voice-room",
        endpoints: ["/health", "/api/ice", "/ws?room=1234&name=..."]
      });
    }
    return json({ error: "not_found" }, 404);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(getIceServers(env).catch(() => {
    }));
  }
};

// ../../../../../../../../.npm-global/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
init_modules_watch_stub();
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../../../../.npm-global/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
init_modules_watch_stub();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-8RNpoz/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../../../../.npm-global/lib/node_modules/wrangler/templates/middleware/common.ts
init_modules_watch_stub();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-8RNpoz/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
