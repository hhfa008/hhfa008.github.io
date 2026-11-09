/* Mahjong adapter — a minimal draw/discard/claim state machine.
 *
 * Reuses:
 *   games/shared/hand-eval.js  (HandEval.checkWinningHand / tileName)
 *   games/shared/shuffle.js    (Shuffle.shuffle with a seed)
 *
 * The full 4-player state machine lives inline in games/mahjong/index.html
 * (script id="engine"). This adapter does NOT read or modify that page. It
 * implements only the layer the protocol needs:
 *
 *   - N seats (register `mahjong` = 2 seats, `mahjong4` = 4 seats)
 *   - 34 tile kinds x 4 copies = 136-tile wall
 *   - deal 13 each, dealer draws the 14th
 *   - discard, draw, self-draw win
 *   - claims on a discard: hu / pong / kong / pass, ordered by priority
 *     (hu first) and then seat distance
 *   - kong draws a replacement tile
 *
 * Deliberately absent (see EXTRACT.md): dealer rotation, rounds, scoring,
 * concealed kong (ankong) and added kong (addkong). The page's win test
 * (basic hand + 七对/十三幺, melded hands restricted to 基本胡) is kept.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../../shared/agent-api.js'),
      require('../../shared/hand-eval.js'),
      require('../../shared/shuffle.js')
    );
  } else {
    factory(root.GameAgent, root.HandEval, root.Shuffle);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GA, HandEval, Shuffle) {
  'use strict';

  var N = 34;
  var TILE_COPIES = 4;

  function emptyCounts() {
    var c = [];
    for (var i = 0; i < N; i++) c.push(0);
    return c;
  }

  function countsFrom(list) {
    var c = emptyCounts();
    for (var i = 0; i < list.length; i++) c[list[i]]++;
    return c;
  }

  function countsTotal(c) {
    var n = 0;
    for (var i = 0; i < N; i++) n += c[i];
    return n;
  }

  function makeWall() {
    var w = [];
    for (var t = 0; t < N; t++) for (var i = 0; i < TILE_COPIES; i++) w.push(t);
    return w;
  }

  function seatId(index) { return 'p' + (index + 1); }

  function checkWinFor(st, player, extra) {
    var pl = st.players[player];
    var c = countsFrom(pl.hand);
    if (extra !== undefined && extra !== null) c[extra] += 1;
    var need = 14 - 3 * pl.melds.length;
    if (countsTotal(c) !== need) {
      return { winning: false, reason: 'need ' + need + ' tiles, have ' + countsTotal(c), patterns: [] };
    }
    for (var m = 0; m < pl.melds.length; m++) c[pl.melds[m].tile] += 3;
    var r = HandEval.checkWinningHand(c);
    if (r.winning && pl.melds.length && r.patterns.indexOf('基本胡') < 0) {
      return { winning: false, reason: 'melded hands must be a basic win', patterns: [] };
    }
    return r;
  }

  function claimOptions(st, player, tile) {
    var c = countsFrom(st.players[player].hand);
    return {
      hu: checkWinFor(st, player, tile).winning,
      pong: c[tile] >= 2,
      kong: c[tile] >= 3
    };
  }

  function tileName(t) {
    return HandEval && typeof HandEval.tileName === 'function' ? HandEval.tileName(t) : ('#' + t);
  }

  function removeTiles(list, tile, n) {
    for (var i = 0; i < n; i++) {
      var at = list.indexOf(tile);
      if (at < 0) return false;
      list.splice(at, 1);
    }
    return true;
  }

  function makeSession(slug, seed, seatCount) {
    var count = seatCount === 4 ? 4 : 2;
    var seats = [];
    for (var s = 0; s < count; s++) seats.push(seatId(s));

    var wall = Shuffle.shuffle(makeWall(), { seed: seed === undefined ? 1 : seed });
    var st = {
      slug: slug,
      seatCount: count,
      seed: String(seed === undefined ? 1 : seed),
      wall: wall,
      players: [],
      dealer: 0,
      turn: 0,
      phase: 'turn',
      claim: null,
      lastDiscard: null,
      drawn: null,
      afterDraw: false,
      result: null
    };
    for (var p = 0; p < count; p++) {
      st.players.push({ hand: [], melds: [], discards: [] });
    }

    for (var r = 0; r < 13; r++) {
      for (var q = 0; q < count; q++) st.players[q].hand.push(st.wall.pop());
    }
    // Dealer takes the 14th tile and must discard.
    st.drawn = st.wall.pop();
    st.players[0].hand.push(st.drawn);
    st.afterDraw = true;

    function drawTile(player) {
      if (!st.wall.length) {
        st.phase = 'over';
        st.claim = null;
        st.result = { type: 'draw' };
        return;
      }
      var tile = st.wall.pop();
      st.players[player].hand.push(tile);
      st.turn = player;
      st.phase = 'turn';
      st.afterDraw = true;
      st.drawn = tile;
      st.claim = null;
      st.lastDiscard = null;
    }

    function takeDiscard(from, tile) {
      var d = st.players[from].discards;
      if (d.length && d[d.length - 1].tile === tile) d.pop();
    }

    function claimCandidates(from, tile) {
      var out = [];
      for (var d = 1; d < count; d++) {
        var player = (from + d) % count;
        var opts = claimOptions(st, player, tile);
        if (!opts.hu && !opts.pong && !opts.kong) continue;
        out.push({
          player: player,
          dist: d,
          priority: opts.hu ? 0 : 1,
          options: opts
        });
      }
      out.sort(function (a, b) {
        return (a.priority - b.priority) || (a.dist - b.dist);
      });
      return out;
    }

    function afterDiscard(from, tile) {
      var candidates = claimCandidates(from, tile);
      if (!candidates.length) {
        drawTile((from + 1) % count);
        return;
      }
      st.phase = 'claim';
      st.claim = { tile: tile, from: from, candidates: candidates, index: 0 };
    }

    function win(player, tile, selfDraw, from, patterns) {
      st.phase = 'over';
      st.claim = null;
      st.result = {
        type: 'win',
        winner: player,
        selfDraw: !!selfDraw,
        from: selfDraw ? player : from,
        tile: tile,
        patterns: patterns || []
      };
    }

    function currentClaim() {
      if (!st.claim) return null;
      return st.claim.candidates[st.claim.index] || null;
    }

    function subjectPlayer() {
      if (st.phase === 'claim' && st.claim) {
        var cand = currentClaim();
        if (cand) return cand.player;
      }
      return st.turn;
    }

    var session = {
      slug: slug,
      version: '1.0.0',
      seats: seats.slice(),

      state: function () { return GA.cloneJSON(st); },

      legalActions: function () {
        if (st.phase === 'over') return [];
        var out = [];

        if (st.phase === 'claim' && st.claim) {
          var cand = currentClaim();
          if (!cand) return [];
          var o = cand.options;
          if (o.hu) out.push({ id: 'hu', type: 'hu', payload: { tile: st.claim.tile }, desc: 'declare a win on ' + tileName(st.claim.tile) });
          if (o.pong) out.push({ id: 'pong', type: 'pong', payload: { tile: st.claim.tile }, desc: 'pong ' + tileName(st.claim.tile) });
          if (o.kong) out.push({ id: 'kong', type: 'kong', payload: { tile: st.claim.tile }, desc: 'kong ' + tileName(st.claim.tile) });
          out.push({ id: 'pass', type: 'pass', payload: { tile: st.claim.tile }, desc: 'pass on ' + tileName(st.claim.tile) });
          return out;
        }

        var me = st.turn;
        var pl = st.players[me];
        if (st.afterDraw && checkWinFor(st, me, null).winning) {
          out.push({ id: 'hu', type: 'hu', payload: { tile: st.drawn }, desc: 'declare a self-draw win' });
        }
        var seen = {};
        var kinds = [];
        for (var i = 0; i < pl.hand.length; i++) {
          var t = pl.hand[i];
          if (!seen[t]) { seen[t] = 1; kinds.push(t); }
        }
        kinds.sort(function (a, b) { return a - b; });
        for (var k = 0; k < kinds.length; k++) {
          out.push({
            id: 'discard:' + kinds[k],
            type: 'discard',
            payload: { tile: kinds[k] },
            desc: 'discard ' + tileName(kinds[k])
          });
        }
        return out;
      },

      apply: function (id) {
        if (st.phase === 'over') return { ok: false, error: 'game_over' };
        if (typeof id !== 'string') return { ok: false, error: 'illegal_action' };

        if (st.phase === 'claim' && st.claim) {
          var claim = st.claim;
          var cand = currentClaim();
          if (!cand) return { ok: false, error: 'illegal_action' };
          var claimant = cand.player;

          if (id === 'hu') {
            if (!cand.options.hu) return { ok: false, error: 'illegal_action' };
            var r = checkWinFor(st, claimant, claim.tile);
            win(claimant, claim.tile, false, claim.from, r.patterns);
            return { ok: true, state: GA.cloneJSON(st) };
          }
          if (id === 'pong') {
            if (!cand.options.pong) return { ok: false, error: 'illegal_action' };
            removeTiles(st.players[claimant].hand, claim.tile, 2);
            st.players[claimant].melds.push({ type: 'pong', tile: claim.tile, from: claim.from });
            takeDiscard(claim.from, claim.tile);
            st.lastDiscard = { tile: claim.tile, player: claim.from, claimedBy: claimant };
            st.claim = null;
            st.turn = claimant;
            st.phase = 'turn';
            st.afterDraw = false;
            st.drawn = null;
            return { ok: true, state: GA.cloneJSON(st) };
          }
          if (id === 'kong') {
            if (!cand.options.kong) return { ok: false, error: 'illegal_action' };
            removeTiles(st.players[claimant].hand, claim.tile, 3);
            st.players[claimant].melds.push({ type: 'kong', tile: claim.tile, from: claim.from });
            takeDiscard(claim.from, claim.tile);
            st.lastDiscard = { tile: claim.tile, player: claim.from, claimedBy: claimant };
            st.claim = null;
            st.turn = claimant;
            st.afterDraw = false;
            st.drawn = null;
            drawTile(claimant);
            return { ok: true, state: GA.cloneJSON(st) };
          }
          if (id === 'pass') {
            claim.index += 1;
            if (claim.index >= claim.candidates.length) {
              var from = claim.from;
              st.claim = null;
              drawTile((from + 1) % count);
            }
            return { ok: true, state: GA.cloneJSON(st) };
          }
          return { ok: false, error: 'illegal_action' };
        }

        if (st.phase === 'turn') {
          var me = st.turn;
          var pl = st.players[me];
          if (id === 'hu') {
            if (!st.afterDraw || !checkWinFor(st, me, null).winning) {
              return { ok: false, error: 'illegal_action' };
            }
            var wr = checkWinFor(st, me, null);
            win(me, st.drawn, true, me, wr.patterns);
            return { ok: true, state: GA.cloneJSON(st) };
          }
          if (id.indexOf('discard:') === 0) {
            var raw = id.slice(8);
            if (!/^\d+$/.test(raw)) return { ok: false, error: 'illegal_action' };
            var tile = Number(raw);
            if (tile < 0 || tile >= N || pl.hand.indexOf(tile) < 0) {
              return { ok: false, error: 'illegal_action' };
            }
            pl.hand.splice(pl.hand.indexOf(tile), 1);
            pl.discards.push({ tile: tile });
            st.lastDiscard = { tile: tile, player: me };
            st.drawn = null;
            st.afterDraw = false;
            afterDiscard(me, tile);
            return { ok: true, state: GA.cloneJSON(st) };
          }
          return { ok: false, error: 'illegal_action' };
        }

        return { ok: false, error: 'illegal_action' };
      },

      status: function () {
        if (st.phase !== 'over') return { phase: 'playing', winner: null };
        if (!st.result || st.result.type !== 'win') return { phase: 'over', winner: 'draw' };
        return { phase: 'over', winner: seatId(st.result.winner) };
      },

      player: function () {
        return seatId(subjectPlayer());
      },

      hash: function () { return GA.hashState(st); }
    };

    return session;
  }

  function createTwo(opts) {
    opts = opts || {};
    return makeSession('mahjong', opts.seed, 2);
  }

  function createFour(opts) {
    opts = opts || {};
    return makeSession('mahjong4', opts.seed, 4);
  }

  createTwo.players = 2;
  createTwo.seats = ['p1', 'p2'];
  createTwo.moves = 'draw/discard/claim';
  createTwo.source = 'games/shared/hand-eval.js + shuffle.js (2-player minimal layer)';
  if (GA) GA.register('mahjong', createTwo);

  createFour.players = 4;
  createFour.seats = ['p1', 'p2', 'p3', 'p4'];
  createFour.moves = 'draw/discard/claim';
  createFour.source = 'games/shared/hand-eval.js + shuffle.js (4-player minimal layer)';
  if (GA) GA.register('mahjong4', createFour);

  return { create: createTwo, create4: createFour };
});
