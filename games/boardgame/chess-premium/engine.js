/*!
 * Chess premium — pure FIDE rules engine, evaluation and alpha-beta AI.
 *
 * Works in Node (`require`) and the browser (`window.ChessPremiumEngine`).
 * No DOM, no network, no storage. Board index 0 = a8, 63 = h1.
 *
 * Mutation contract:
 *   - makeMove(pos, move) mutates `pos` in place and returns an undo token.
 *     It is deliberately the fast in-place API used by perft and the search.
 *   - unmakeMove(pos, move, undo) restores the position exactly.
 *   - aiMove()/perft()/publicView() never leave the caller's position changed.
 *   - newGame()/applyMove()/undoMove() form a small game wrapper that keeps
 *     repetition keys, capture trays and a SAN move list.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessPremiumEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';
  var MATE = 100000;
  var INF = 1000000;
  var KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function isWhite(p) { return p === p.toUpperCase(); }
  function colorOf(p) { return isWhite(p) ? 'w' : 'b'; }
  function other(side) { return side === 'w' ? 'b' : 'w'; }
  function inBoard(r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8; }
  function squareName(sq) { return FILES.charAt(sq & 7) + String(8 - ((sq / 8) | 0)); }
  function squareIndex(name) {
    if (!/^[a-h][1-8]$/.test(name || '')) return -1;
    return (8 - parseInt(name.charAt(1), 10)) * 8 + (name.charCodeAt(0) - 97);
  }

  function emptyBoard() { return new Array(64).fill(null); }

  function fromFEN(fen) {
    if (typeof fen !== 'string' || !fen.trim()) throw new Error('FEN must be a non-empty string');
    var parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error('FEN needs at least 4 fields');
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN board must have 8 ranks');
    var board = emptyBoard();
    for (var r = 0; r < 8; r++) {
      var f = 0;
      for (var i = 0; i < rows[r].length; i++) {
        var c = rows[r].charAt(i);
        if (c >= '1' && c <= '8') {
          f += c.charCodeAt(0) - 48;
        } else if ('pnbrqkPNBRQK'.indexOf(c) >= 0) {
          if (f > 7) throw new Error('FEN rank ' + (r + 1) + ' overflows');
          board[r * 8 + f++] = c;
        } else {
          throw new Error('FEN has an invalid piece: ' + c);
        }
      }
      if (f !== 8) throw new Error('FEN rank ' + (r + 1) + ' does not fill 8 squares');
    }
    var turn = parts[1];
    if (turn !== 'w' && turn !== 'b') throw new Error('FEN side to move must be w or b');
    var castling = parts[2] === '-' ? '' : parts[2];
    if (!/^(?:-|[KQkq]{1,4})$/.test(parts[2])) throw new Error('FEN castling field is invalid');
    var unique = '';
    for (var k = 0; k < castling.length; k++) if (unique.indexOf(castling.charAt(k)) < 0) unique += castling.charAt(k);
    castling = unique;
    var ep = -1;
    if (parts[3] && parts[3] !== '-') {
      ep = squareIndex(parts[3]);
      if (ep < 0) throw new Error('FEN en-passant square is invalid');
    }
    var half = parts[4] == null ? 0 : parseInt(parts[4], 10);
    var full = parts[5] == null ? 1 : parseInt(parts[5], 10);
    if (!Number.isFinite(half) || half < 0) half = 0;
    if (!Number.isFinite(full) || full < 1) full = 1;
    var whites = 0, blacks = 0;
    for (var s = 0; s < 64; s++) {
      if (board[s] === 'K') whites++;
      else if (board[s] === 'k') blacks++;
    }
    if (whites !== 1 || blacks !== 1) throw new Error('FEN must contain exactly one king per side');
    return { board: board, turn: turn, castling: castling, ep: ep, half: half, full: full, lastMove: null };
  }

  function initialPosition() { return fromFEN(START_FEN); }

  function toFEN(pos) {
    var out = '';
    for (var r = 0; r < 8; r++) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = pos.board[r * 8 + f];
        if (p) {
          if (empty) { out += empty; empty = 0; }
          out += p;
        } else {
          empty++;
        }
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    return out + ' ' + pos.turn + ' ' + (pos.castling || '-') + ' ' +
      (pos.ep >= 0 ? squareName(pos.ep) : '-') + ' ' + pos.half + ' ' + pos.full;
  }

  function clonePosition(p) {
    return {
      board: p.board.slice(), turn: p.turn, castling: p.castling,
      ep: p.ep, half: p.half, full: p.full,
      lastMove: p.lastMove ? { from: p.lastMove.from, to: p.lastMove.to, promo: p.lastMove.promo || '', castle: p.lastMove.castle || '' } : null
    };
  }

  function kingSquare(pos, side) {
    var king = side === 'w' ? 'K' : 'k';
    for (var i = 0; i < 64; i++) if (pos.board[i] === king) return i;
    return -1;
  }

  function isAttacked(pos, sq, by) {
    var b = pos.board, r = (sq / 8) | 0, f = sq & 7, i, dr, df, rr, ff, q;
    var pawn = by === 'w' ? 'P' : 'p';
    var pr = by === 'w' ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      if (f > 0 && b[pr * 8 + f - 1] === pawn) return true;
      if (f < 7 && b[pr * 8 + f + 1] === pawn) return true;
    }
    var knight = by === 'w' ? 'N' : 'n';
    for (i = 0; i < 8; i++) {
      rr = r + KNIGHT[i][0]; ff = f + KNIGHT[i][1];
      if (inBoard(rr, ff) && b[rr * 8 + ff] === knight) return true;
    }
    var king = by === 'w' ? 'K' : 'k';
    for (i = 0; i < 8; i++) {
      rr = r + KING8[i][0]; ff = f + KING8[i][1];
      if (inBoard(rr, ff) && b[rr * 8 + ff] === king) return true;
    }
    var rook = by === 'w' ? 'R' : 'r', bishop = by === 'w' ? 'B' : 'b', queen = by === 'w' ? 'Q' : 'q';
    for (i = 0; i < 4; i++) {
      dr = ORTH[i][0]; df = ORTH[i][1];
      rr = r + dr; ff = f + df;
      while (inBoard(rr, ff)) {
        q = b[rr * 8 + ff];
        if (q) {
          if (colorOf(q) === by && (q === rook || q === queen)) return true;
          break;
        }
        rr += dr; ff += df;
      }
    }
    for (i = 0; i < 4; i++) {
      dr = DIAG[i][0]; df = DIAG[i][1];
      rr = r + dr; ff = f + df;
      while (inBoard(rr, ff)) {
        q = b[rr * 8 + ff];
        if (q) {
          if (colorOf(q) === by && (q === bishop || q === queen)) return true;
          break;
        }
        rr += dr; ff += df;
      }
    }
    return false;
  }

  function inCheck(pos, side) {
    var ks = kingSquare(pos, side);
    return ks >= 0 && isAttacked(pos, ks, other(side));
  }

  function removeRights(pos, sq) {
    var c = pos.castling;
    if (sq === 63) c = c.replace('K', '');
    else if (sq === 56) c = c.replace('Q', '');
    else if (sq === 7) c = c.replace('k', '');
    else if (sq === 0) c = c.replace('q', '');
    pos.castling = c;
  }

  function makeMove(pos, m) {
    var b = pos.board, p = b[m.from];
    if (!p) throw new Error('makeMove: no piece on ' + squareName(m.from));
    var undo = {
      piece: p, captured: null, capSq: -1,
      castling: pos.castling, ep: pos.ep, half: pos.half, full: pos.full,
      lastMove: pos.lastMove, rookFrom: -1, rookTo: -1
    };
    if (m.ep) {
      undo.capSq = m.to + (p === 'P' ? 8 : -8);
      undo.captured = b[undo.capSq];
      b[undo.capSq] = null;
    } else if (b[m.to]) {
      undo.capSq = m.to;
      undo.captured = b[m.to];
    }
    b[m.to] = m.promo ? (p === 'P' ? m.promo.toUpperCase() : m.promo.toLowerCase()) : p;
    b[m.from] = null;
    if (m.castle) {
      if (m.castle === 'K') { undo.rookFrom = m.to + 1; undo.rookTo = m.to - 1; }
      else { undo.rookFrom = m.to - 2; undo.rookTo = m.to + 1; }
      b[undo.rookTo] = b[undo.rookFrom];
      b[undo.rookFrom] = null;
    }
    pos.ep = m.double ? (m.from + m.to) / 2 : -1;
    pos.half = (p === 'P' || p === 'p' || undo.captured) ? 0 : pos.half + 1;
    pos.full = undo.full + (pos.turn === 'b' ? 1 : 0);
    if (p === 'K') pos.castling = pos.castling.replace(/[KQ]/g, '');
    else if (p === 'k') pos.castling = pos.castling.replace(/[kq]/g, '');
    if (p === 'R' || p === 'r') removeRights(pos, m.from);
    if (undo.capSq >= 0) removeRights(pos, undo.capSq);
    pos.turn = other(pos.turn);
    pos.lastMove = { from: m.from, to: m.to, promo: m.promo || '', castle: m.castle || '' };
    return undo;
  }

  function unmakeMove(pos, m, undo) {
    var b = pos.board;
    b[m.from] = undo.piece;
    b[m.to] = null;
    if (m.castle) {
      b[undo.rookFrom] = b[undo.rookTo];
      b[undo.rookTo] = null;
    }
    if (undo.capSq >= 0) b[undo.capSq] = undo.captured;
    pos.castling = undo.castling;
    pos.ep = undo.ep;
    pos.half = undo.half;
    pos.full = undo.full;
    pos.turn = other(pos.turn);
    pos.lastMove = undo.lastMove;
  }

  function move(from, to, piece, captured, promo, castle, ep, double) {
    return {
      from: from, to: to, piece: piece, captured: captured || null,
      promo: promo || '', castle: castle || '', ep: !!ep, double: !!double
    };
  }

  function addPromotions(out, from, to, piece, captured) {
    var kinds = ['Q', 'R', 'B', 'N'];
    for (var i = 0; i < 4; i++) out.push(move(from, to, piece, captured, kinds[i], '', false, false));
  }

  function pseudoMoves(pos) {
    var b = pos.board, side = pos.turn, out = [], i, r, f, p, q, rr, ff, dr, df, d, one, two;
    for (i = 0; i < 64; i++) {
      p = b[i];
      if (!p || colorOf(p) !== side) continue;
      r = (i / 8) | 0; f = i & 7;
      var t = p.toUpperCase();

      if (t === 'P') {
        dr = side === 'w' ? -1 : 1;
        var start = side === 'w' ? 6 : 1;
        var last = side === 'w' ? 0 : 7;
        rr = r + dr;
        if (rr >= 0 && rr < 8) {
          one = rr * 8 + f;
          if (!b[one]) {
            if (rr === last) addPromotions(out, i, one, p, null);
            else {
              out.push(move(i, one, p, null, '', '', false, false));
              two = (rr + dr) * 8 + f;
              if (r === start && !b[two]) out.push(move(i, two, p, null, '', '', false, true));
            }
          }
          for (var sideFile = -1; sideFile <= 1; sideFile += 2) {
            ff = f + sideFile;
            if (ff < 0 || ff > 7) continue;
            var target = rr * 8 + ff;
            q = b[target];
            if (q && colorOf(q) !== side) {
              if (rr === last) addPromotions(out, i, target, p, q);
              else out.push(move(i, target, p, q, '', '', false, false));
            } else if (!q && target === pos.ep) {
              var victimSq = target + (side === 'w' ? 8 : -8);
              var victim = b[victimSq];
              if (victim === (side === 'w' ? 'p' : 'P')) {
                out.push(move(i, target, p, victim, '', '', true, false));
              }
            }
          }
        }
        continue;
      }

      if (t === 'N') {
        for (d = 0; d < 8; d++) {
          rr = r + KNIGHT[d][0]; ff = f + KNIGHT[d][1];
          if (!inBoard(rr, ff)) continue;
          q = b[rr * 8 + ff];
          if (!q || colorOf(q) !== side) out.push(move(i, rr * 8 + ff, p, q, '', '', false, false));
        }
        continue;
      }

      if (t === 'K') {
        for (d = 0; d < 8; d++) {
          rr = r + KING8[d][0]; ff = f + KING8[d][1];
          if (!inBoard(rr, ff)) continue;
          q = b[rr * 8 + ff];
          if (!q || colorOf(q) !== side) out.push(move(i, rr * 8 + ff, p, q, '', '', false, false));
        }
        var home = side === 'w' ? 60 : 4;
        var enemy = other(side);
        if (i === home && !isAttacked(pos, home, enemy)) {
          var rook = side === 'w' ? 'R' : 'r';
          if (pos.castling.indexOf(side === 'w' ? 'K' : 'k') >= 0 &&
              b[home + 3] === rook && !b[home + 1] && !b[home + 2] &&
              !isAttacked(pos, home + 1, enemy) && !isAttacked(pos, home + 2, enemy)) {
            out.push(move(home, home + 2, p, null, '', 'K', false, false));
          }
          if (pos.castling.indexOf(side === 'w' ? 'Q' : 'q') >= 0 &&
              b[home - 4] === rook && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
              !isAttacked(pos, home - 1, enemy) && !isAttacked(pos, home - 2, enemy)) {
            out.push(move(home, home - 2, p, null, '', 'Q', false, false));
          }
        }
        continue;
      }

      var dirs = t === 'B' ? DIAG : t === 'R' ? ORTH : DIAG.concat(ORTH);
      for (d = 0; d < dirs.length; d++) {
        dr = dirs[d][0]; df = dirs[d][1];
        rr = r + dr; ff = f + df;
        while (inBoard(rr, ff)) {
          var to = rr * 8 + ff;
          q = b[to];
          if (!q) out.push(move(i, to, p, null, '', '', false, false));
          else {
            if (colorOf(q) !== side) out.push(move(i, to, p, q, '', '', false, false));
            break;
          }
          rr += dr; ff += df;
        }
      }
    }
    return out;
  }

  function legalMoves(pos) {
    var pseudo = pseudoMoves(pos), out = [], side = pos.turn;
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i], u = makeMove(pos, m);
      if (!inCheck(pos, side)) out.push(m);
      unmakeMove(pos, m, u);
    }
    return out;
  }

  function legalMovesFrom(pos, sq) {
    return legalMoves(pos).filter(function (m) { return m.from === sq; });
  }

  function findMove(pos, from, to, promo) {
    var list = legalMoves(pos);
    var want = promo ? String(promo).toUpperCase() : '';
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.from === from && m.to === to && m.promo === want) return m;
    }
    return null;
  }

  function perft(pos, depth) {
    if (depth <= 0) return 1;
    var moves = legalMoves(pos), total = 0, i, u;
    if (depth === 1) return moves.length;
    for (i = 0; i < moves.length; i++) {
      u = makeMove(pos, moves[i]);
      total += perft(pos, depth - 1);
      unmakeMove(pos, moves[i], u);
    }
    return total;
  }

  function perftDivide(pos, depth) {
    var out = {}, moves = legalMoves(pos);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], u = makeMove(pos, m);
      out[squareName(m.from) + squareName(m.to) + (m.promo || '')] = depth <= 1 ? 1 : perft(pos, depth - 1);
      unmakeMove(pos, m, u);
    }
    return out;
  }

  function epIsLegal(pos) {
    if (!pos || pos.ep < 0) return false;
    var probe = clonePosition(pos), side = pos.turn;
    var candidates = side === 'w' ? [pos.ep + 7, pos.ep + 9] : [pos.ep - 9, pos.ep - 7];
    var pawn = side === 'w' ? 'P' : 'p';
    for (var i = 0; i < candidates.length; i++) {
      var from = candidates[i];
      if (from < 0 || from > 63) continue;
      if (probe.board[from] !== pawn) continue;
      var m = move(from, pos.ep, pawn, side === 'w' ? 'p' : 'P', '', '', true, false);
      var u = makeMove(probe, m);
      var safe = !inCheck(probe, side);
      unmakeMove(probe, m, u);
      if (safe) return true;
    }
    return false;
  }

  function positionKey(pos) {
    return pos.board.join('') + '|' + pos.turn + '|' + (pos.castling || '-') + '|' +
      (epIsLegal(pos) ? squareName(pos.ep) : '-');
  }

  function insufficientMaterial(pos) {
    var b = pos.board, minors = [], i, p;
    for (i = 0; i < 64; i++) {
      p = b[i];
      if (!p) continue;
      var t = p.toUpperCase();
      if (t === 'K') continue;
      if (t === 'P' || t === 'R' || t === 'Q') return false;
      minors.push({ t: t, light: (((i / 8) | 0) + (i & 7)) % 2 === 0, side: colorOf(p) });
    }
    if (minors.length === 0) return true;
    if (minors.length === 1) return true;
    if (minors.length === 2 && minors[0].t === 'B' && minors[1].t === 'B' &&
        minors[0].light === minors[1].light && minors[0].side !== minors[1].side) return true;
    return false;
  }

  // keys: array of positionKey() values covering the game including the current
  // position. When omitted, repetition is not reported.
  function gameStatus(pos, keys) {
    var moves = legalMoves(pos), side = pos.turn, check = inCheck(pos, side);
    if (moves.length === 0) {
      if (check) return { over: true, result: 'checkmate', winner: other(side), check: true, moves: 0 };
      return { over: true, result: 'stalemate', winner: null, check: false, moves: 0 };
    }
    if (pos.half >= 100) return { over: true, result: 'fifty', winner: null, check: check, moves: moves.length };
    if (insufficientMaterial(pos)) return { over: true, result: 'insufficient', winner: null, check: check, moves: moves.length };
    if (keys && keys.length) {
      var key = positionKey(pos), n = 0;
      for (var i = 0; i < keys.length; i++) if (keys[i] === key) n++;
      if (n >= 3) return { over: true, result: 'repetition', winner: null, check: check, moves: moves.length };
    }
    return { over: false, result: null, winner: null, check: check, moves: moves.length };
  }

  /* ------------------------------------------------------------------ */
  /* Game wrapper: repetition keys, captured trays, SAN history          */
  /* ------------------------------------------------------------------ */

  function newGame(fen) {
    var pos = fen ? fromFEN(fen) : initialPosition();
    return {
      pos: pos,
      keys: [positionKey(pos)],
      history: [],
      captured: { w: [], b: [] },
      lastMove: null,
      sanList: [],
      status: gameStatus(pos, [positionKey(pos)])
    };
  }

  function refreshStatus(game) {
    game.status = gameStatus(game.pos, game.keys);
    return game.status;
  }

  function applyMove(game, m) {
    var legal = legalMoves(game.pos), chosen = null;
    for (var i = 0; i < legal.length; i++) {
      var x = legal[i];
      if (x.from === m.from && x.to === m.to && (m.promo ? x.promo === String(m.promo).toUpperCase() : x.promo === (m.promo || ''))) {
        chosen = x; break;
      }
    }
    if (!chosen) return { ok: false, error: 'illegal move' };
    var san = moveToSAN(game.pos, chosen);
    var undo = makeMove(game.pos, chosen);
    game.history.push({
      pos: game.pos, move: chosen, undo: undo, san: san, keys: game.keys.slice()
    });
    game.sanList.push(san);
    if (chosen.captured) {
      var captor = chosen.piece === chosen.piece.toUpperCase() ? 'w' : 'b';
      game.captured[captor].push(chosen.captured);
    }
    game.keys.push(positionKey(game.pos));
    game.lastMove = { from: chosen.from, to: chosen.to, promo: chosen.promo || '', castle: chosen.castle || '' };
    refreshStatus(game);
    return { ok: true, move: chosen, san: san, status: game.status };
  }

  function undoMove(game) {
    if (!game.history.length) return null;
    var rec = game.history.pop();
    unmakeMove(game.pos, rec.move, rec.undo);
    game.sanList.pop();
    if (rec.move.captured) {
      var captor = rec.move.piece === rec.move.piece.toUpperCase() ? 'w' : 'b';
      game.captured[captor].pop();
    }
    game.keys.pop();
    game.lastMove = game.history.length ? game.history[game.history.length - 1].move : null;
    if (game.lastMove) {
      game.lastMove = { from: game.lastMove.from, to: game.lastMove.to, promo: game.lastMove.promo || '', castle: game.lastMove.castle || '' };
    }
    refreshStatus(game);
    return rec;
  }

  function moveToSAN(pos, m) {
    if (!pos || !m) return '';
    var san;
    if (m.castle === 'K' || m.castle === 'Q') {
      san = m.castle === 'K' ? 'O-O' : 'O-O-O';
    } else if (m.piece.toUpperCase() === 'P') {
      san = '';
      if (m.captured || m.ep) san += FILES.charAt(m.from & 7) + 'x';
      san += squareName(m.to);
      if (m.promo) san += '=' + m.promo.toUpperCase();
    } else {
      san = m.piece.toUpperCase();
      var legal = legalMoves(pos), sameTarget = [];
      for (var i = 0; i < legal.length; i++) {
        var o = legal[i];
        if (o.to === m.to && o.from !== m.from && o.piece === m.piece) sameTarget.push(o);
      }
      if (sameTarget.length) {
        var sameFile = sameTarget.some(function (o) { return (o.from & 7) === (m.from & 7); });
        var sameRank = sameTarget.some(function (o) { return (o.from >> 3) === (m.from >> 3); });
        if (!sameFile) san += FILES.charAt(m.from & 7);
        else if (!sameRank) san += String(8 - (m.from >> 3));
        else san += squareName(m.from);
      }
      if (m.captured || m.ep) san += 'x';
      san += squareName(m.to);
    }
    var probe = clonePosition(pos), u = makeMove(probe, m);
    var opp = probe.turn;
    var reply = legalMoves(probe);
    if (inCheck(probe, opp)) san += reply.length ? '+' : '#';
    unmakeMove(probe, m, u);
    return san;
  }

  function uciOf(m) {
    return squareName(m.from) + squareName(m.to) + (m.promo ? m.promo.toLowerCase() : '');
  }

  function moveFromUCI(pos, text) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(text || '')) return null;
    var from = squareIndex(text.slice(0, 2)), to = squareIndex(text.slice(2, 4));
    var promo = text.length > 4 ? text.charAt(4).toUpperCase() : '';
    return findMove(pos, from, to, promo);
  }

  function capturedPieces(game) {
    return { w: game.captured.w.slice(), b: game.captured.b.slice() };
  }

  function publicView(state, seat, opts) {
    var pos = state && state.pos ? state.pos : state;
    var keys = opts && opts.keys ? opts.keys : (state && state.keys ? state.keys : null);
    var view = {
      fen: toFEN(pos),
      board: pos.board.slice(),
      turn: pos.turn,
      castling: pos.castling,
      ep: pos.ep,
      epSquare: pos.ep >= 0 ? squareName(pos.ep) : null,
      half: pos.half,
      full: pos.full,
      lastMove: pos.lastMove ? { from: pos.lastMove.from, to: pos.lastMove.to, promo: pos.lastMove.promo || '', castle: pos.lastMove.castle || '' } : null,
      seat: seat == null ? null : Number(seat),
      check: inCheck(pos, pos.turn),
      status: gameStatus(pos, keys),
      kings: { w: kingSquare(pos, 'w'), b: kingSquare(pos, 'b') }
    };
    view.legalMoves = view.status.over ? [] : legalMoves(pos);
    if (state && state.sanList) view.sanList = state.sanList.slice();
    if (state && state.captured) view.captured = capturedPieces(state);
    if (state && state.history) {
      view.history = state.history.map(function (h) { return h.san; });
    }
    return view;
  }

  /* ------------------------------------------------------------------ */
  /* Evaluation                                                          */
  /* ------------------------------------------------------------------ */

  var VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  var PST = {
    P: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    N: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    B: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    R: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    Q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    K: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ]
  };
  var KING_SAFETY = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
      0, -10, -10, -10, -10, -10, -10, 0,
     20,  20,   0,   0,   0,   0,  20, 20,
     30,  40,  10,   0,   0,  10,  40, 30
  ];

  function pieceScore(p, sq) {
    var t = p.toUpperCase(), w = isWhite(p);
    var idx = w ? sq : (sq ^ 56);
    return VAL[t] + PST[t][idx];
  }

  function mobilityScore(pos, side) {
    var count = 0, b = pos.board;
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (!p || colorOf(p) !== side) continue;
      var t = p.toUpperCase();
      if (t === 'N') {
        for (var d = 0; d < 8; d++) {
          var rr = ((i / 8) | 0) + KNIGHT[d][0], ff = (i & 7) + KNIGHT[d][1];
          if (inBoard(rr, ff) && (!b[rr * 8 + ff] || colorOf(b[rr * 8 + ff]) !== side)) count++;
        }
      } else if (t === 'B' || t === 'R' || t === 'Q') {
        var dirs = t === 'B' ? DIAG : t === 'R' ? ORTH : DIAG.concat(ORTH);
        for (var k = 0; k < dirs.length; k++) {
          var r2 = (i / 8) | 0, f2 = i & 7;
          r2 += dirs[k][0]; f2 += dirs[k][1];
          while (inBoard(r2, f2)) {
            var q = b[r2 * 8 + f2];
            if (!q) count++;
            else { if (colorOf(q) !== side) count++; break; }
            r2 += dirs[k][0]; f2 += dirs[k][1];
          }
        }
      }
    }
    return count;
  }

  function kingSafety(pos, side) {
    var ks = kingSquare(pos, side);
    if (ks < 0) return 0;
    var r = (ks / 8) | 0, f = ks & 7, b = pos.board, score = KING_SAFETY[side === 'w' ? ks : (ks ^ 56)];
    var dir = side === 'w' ? -1 : 1;
    var pawn = side === 'w' ? 'P' : 'p';
    for (var df = -1; df <= 1; df++) {
      var rr = r + dir, ff = f + df;
      if (inBoard(rr, ff) && b[rr * 8 + ff] === pawn) score += 14;
    }
    // open file next to the king
    for (var df2 = -1; df2 <= 1; df2++) {
      var file = f + df2, open = true;
      if (file < 0 || file > 7) continue;
      for (var rr2 = 0; rr2 < 8; rr2++) {
        var p = b[rr2 * 8 + file];
        if (p && p.toUpperCase() === 'P') { open = false; break; }
      }
      if (open) score -= 10;
    }
    // pressure on the 8 squares around the king
    var enemy = other(side), pressure = 0;
    for (var i = 0; i < 8; i++) {
      var ar = r + KING8[i][0], af = f + KING8[i][1];
      if (inBoard(ar, af) && isAttacked(pos, ar * 8 + af, enemy)) pressure++;
    }
    return score - pressure * 7;
  }

  function evaluateWhite(pos) {
    var b = pos.board, score = 0, i, p;
    for (i = 0; i < 64; i++) {
      p = b[i];
      if (p) score += isWhite(p) ? pieceScore(p, i) : -pieceScore(p, i);
    }
    score += (mobilityScore(pos, 'w') - mobilityScore(pos, 'b')) * 2;
    score += kingSafety(pos, 'w') - kingSafety(pos, 'b');
    return score;
  }

  function evaluate(pos) {
    var white = evaluateWhite(pos);
    return pos.turn === 'w' ? white : -white;
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                             */
  /* ------------------------------------------------------------------ */

  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function orderMoves(moves) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], s = 0;
      if (m.captured) s += 10000 + VAL[m.captured.toUpperCase()] * 10 - VAL[m.piece.toUpperCase()];
      if (m.promo) s += 8000 + VAL[m.promo.toUpperCase()] * 4;
      if (m.castle) s += 300;
      if (m.ep) s += 200;
      m._order = s;
    }
    moves.sort(function (a, b) { return b._order - a._order; });
    return moves;
  }

  function createSearch(deadline, nodeBudget) {
    var ctx = { nodes: 0, deadline: deadline, aborted: false, budget: nodeBudget || 600000 };
    ctx.timeUp = function () {
      ctx.nodes++;
      if ((ctx.nodes & 255) === 0) {
        if (Date.now() > ctx.deadline || ctx.nodes > ctx.budget) ctx.aborted = true;
      }
      return ctx.aborted;
    };
    return ctx;
  }

  function quiesce(pos, alpha, beta, ply, qd, ctx) {
    if (ctx.timeUp()) return 0;
    var stand = evaluate(pos);
    if (qd >= 3) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    var moves = legalMoves(pos), tactical = [];
    for (var i = 0; i < moves.length; i++) if (moves[i].captured || moves[i].promo) tactical.push(moves[i]);
    orderMoves(tactical);
    for (var j = 0; j < tactical.length; j++) {
      var m = tactical[j], u = makeMove(pos, m);
      var s = -quiesce(pos, -beta, -alpha, ply + 1, qd + 1, ctx);
      unmakeMove(pos, m, u);
      if (ctx.aborted) return alpha;
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function negamax(pos, depth, alpha, beta, ply, ctx) {
    if (ctx.timeUp()) return 0;
    var moves = legalMoves(pos);
    if (moves.length === 0) return inCheck(pos, pos.turn) ? -MATE + ply : 0;
    if (depth <= 0) return quiesce(pos, alpha, beta, ply, 0, ctx);
    orderMoves(moves);
    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], u = makeMove(pos, m);
      var s = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx);
      unmakeMove(pos, m, u);
      if (ctx.aborted) return best;
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  var LEVELS = {
    easy: { level: 1, depth: 2, timeMs: 120 },
    normal: { level: 2, depth: 3, timeMs: 260 },
    hard: { level: 3, depth: 5, timeMs: 380 }
  };

  function levelConfig(level) {
    if (typeof level === 'string') return LEVELS[level.toLowerCase()] || LEVELS.normal;
    if (level === 1) return LEVELS.easy;
    if (level === 2) return LEVELS.normal;
    if (level >= 3) return LEVELS.hard;
    return LEVELS.normal;
  }

  function aiMove(pos, opts) {
    opts = opts || {};
    var cfg = levelConfig(opts.level);
    var maxDepth = Math.max(1, Math.min(6, Number(opts.depth) || cfg.depth));
    var timeMs = Math.max(20, Math.min(400, Number(opts.timeMs) || cfg.timeMs));
    var work = clonePosition(pos);
    var rootMoves = legalMoves(work);
    if (!rootMoves.length) return null;
    orderMoves(rootMoves);
    var ctx = createSearch(Date.now() + timeMs, opts.nodes || 300000);
    var rng = mulberry32(opts.seed == null ? 1 : opts.seed);
    var best = rootMoves[0], bestScore = -INF, completedDepth = 0;
    for (var d = 1; d <= maxDepth; d++) {
      var iteration = [], alpha = -INF, iterBest = null, iterScore = -INF;
      for (var i = 0; i < rootMoves.length; i++) {
        var m = rootMoves[i], u = makeMove(work, m);
        var score = -negamax(work, d - 1, -INF, -alpha, 1, ctx);
        unmakeMove(work, m, u);
        if (ctx.aborted) break;
        iteration.push({ move: m, score: score });
        if (score > iterScore) { iterScore = score; iterBest = m; }
        if (score > alpha) alpha = score;
        if (score > MATE - 1000) break;
      }
      if (iterBest && (!ctx.aborted || d === 1)) {
        var ties = iteration.filter(function (x) { return x.score === iterScore; });
        if (ties.length > 1) iterBest = ties[Math.floor(rng() * ties.length)].move;
        best = iterBest;
        bestScore = iterScore;
        completedDepth = d;
      }
      if (ctx.aborted) break;
      if (bestScore > MATE - 1000) break;
      if (Date.now() > ctx.deadline) break;
    }
    if (opts.withStats) {
      return { move: best, score: bestScore, depth: completedDepth, nodes: ctx.nodes, aborted: ctx.aborted };
    }
    return best;
  }

  return {
    MATE: MATE,
    START_FEN: START_FEN,
    LEVELS: LEVELS,
    FILES: FILES,
    initialPosition: initialPosition,
    fromFEN: fromFEN,
    toFEN: toFEN,
    clonePosition: clonePosition,
    squareName: squareName,
    squareIndex: squareIndex,
    pieceColor: colorOf,
    isWhitePiece: isWhite,
    kingSquare: kingSquare,
    isAttacked: isAttacked,
    inCheck: inCheck,
    pseudoMoves: pseudoMoves,
    legalMoves: legalMoves,
    legalMovesFrom: legalMovesFrom,
    findMove: findMove,
    makeMove: makeMove,
    unmakeMove: unmakeMove,
    perft: perft,
    perftDivide: perftDivide,
    positionKey: positionKey,
    epIsLegal: epIsLegal,
    insufficientMaterial: insufficientMaterial,
    gameStatus: gameStatus,
    evaluate: evaluate,
    evaluateWhite: evaluateWhite,
    aiMove: aiMove,
    moveToSAN: moveToSAN,
    uciOf: uciOf,
    moveFromUCI: moveFromUCI,
    newGame: newGame,
    applyMove: applyMove,
    undoMove: undoMove,
    publicView: publicView
  };
});
