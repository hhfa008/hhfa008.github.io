/*
 * Dixit premium — original abstract card renderer (UMD).
 *
 *   const svg = DixitCards.render(cardId, { uid: 'hand-2' })
 *
 * Returns an inline SVG string (viewBox 0 0 200 300) composed entirely from
 * original shapes, gradients and a deterministic pseudo-random generator.
 * No external image, no font, no text drawn on the face. This is what makes
 * the deck usable without reproducing any Dixit artwork.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DixitCards = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var Data = null;
  if (typeof require === 'function') {
    try { Data = require('./data.js'); } catch (err) { Data = null; }
  }
  if (!Data && root && root.DixitData) Data = root.DixitData;
  if (!Data) throw new Error('DixitCards requires data.js');

  var PALETTES = {};
  Data.PALETTES.forEach(function (p) { PALETTES[p.key] = p; });

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r2(n) { return Math.round(n * 100) / 100; }

  function scatter(rng, count, fn) {
    var out = '';
    for (var i = 0; i < count; i++) out += fn(rng(), i);
    return out;
  }

  function motif(kind, p, rng) {
    var ink = p.ink;
    var accent = p.accent;
    var mid = p.mid;
    if (kind === 'moon') {
      return '<circle cx="' + r2(128 + rng() * 8) + '" cy="' + r2(92 + rng() * 6) + '" r="52" fill="' + accent + '" opacity=".9"/>' +
        '<circle cx="' + r2(144 + rng() * 6) + '" cy="' + r2(78 + rng() * 6) + '" r="44" fill="' + p.bg + '"/>' +
        '<path d="M0 218 Q52 196 104 214 T200 206 V300 H0Z" fill="' + mid + '" opacity=".8"/>' +
        '<path d="M0 238 Q60 214 118 234 T200 228" fill="none" stroke="' + ink + '" stroke-width="2" opacity=".55"/>' +
        scatter(rng, 12, function (r, i) { return '<circle cx="' + r2(18 + r * 164) + '" cy="' + r2(30 + ((i * 37) % 110)) + '" r="' + r2(1 + r * 1.6) + '" fill="' + ink + '" opacity=".55"/>'; });
    }
    if (kind === 'tide') {
      var waves = '';
      for (var w = 0; w < 5; w++) {
        var y = 150 + w * 26;
        waves += '<path d="M-20 ' + y + ' C 28 ' + (y - 20 - rng() * 10) + ', 66 ' + (y + 18) + ', 104 ' + y + ' S 172 ' + (y - 18) + ', 220 ' + (y + 6) + '" fill="none" stroke="' + (w % 2 ? ink : accent) + '" stroke-width="' + (3 - w * 0.35) + '" opacity="' + (0.85 - w * 0.12) + '"/>';
      }
      return '<circle cx="100" cy="98" r="36" fill="' + accent + '" opacity=".8"/>' + waves +
        '<circle cx="100" cy="98" r="52" fill="none" stroke="' + ink + '" stroke-width="1.4" opacity=".4"/>';
    }
    if (kind === 'stairs') {
      var steps = '';
      for (var s = 0; s < 8; s++) {
        steps += '<rect x="' + (24 + s * 18) + '" y="' + (236 - s * 22) + '" width="24" height="' + (24 + s * 22) + '" fill="' + (s % 2 ? mid : accent) + '" opacity="' + (0.28 + s * 0.075) + '"/>';
      }
      return steps + '<path d="M24 240 L160 72" stroke="' + ink + '" stroke-width="1.6" opacity=".55"/>' +
        '<circle cx="160" cy="72" r="10" fill="' + ink + '" opacity=".8"/>' +
        '<path d="M0 276 H200" stroke="' + ink + '" stroke-width="1.4" opacity=".4"/>';
    }
    if (kind === 'bird') {
      return '<path d="M28 138 C 58 96, 92 78, 116 92 C 104 112, 82 126, 58 132 Z" fill="' + accent + '" opacity=".9"/>' +
        '<path d="M172 118 C 146 82, 112 70, 88 86 C 104 104, 128 114, 150 116 Z" fill="' + ink + '" opacity=".55"/>' +
        '<path d="M58 132 C 76 150, 106 156, 132 142 C 118 170, 84 176, 60 158 Z" fill="' + mid + '" opacity=".9"/>' +
        '<path d="M0 210 Q 60 186 120 206 T200 198 V300 H0Z" fill="' + mid + '" opacity=".4"/>' +
        scatter(rng, 8, function (r, i) { return '<circle cx="' + r2(20 + r * 160) + '" cy="' + r2(30 + i * 9) + '" r="1.6" fill="' + ink + '" opacity=".5"/>'; });
    }
    if (kind === 'key') {
      return '<circle cx="100" cy="104" r="36" fill="none" stroke="' + accent + '" stroke-width="11"/>' +
        '<circle cx="100" cy="104" r="18" fill="' + mid + '"/>' +
        '<path d="M100 140 V236" stroke="' + accent + '" stroke-width="11" stroke-linecap="round"/>' +
        '<path d="M100 206 H136 M100 224 H128 M100 188 H124" stroke="' + accent + '" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M64 104 L38 78 M136 104 L162 78" stroke="' + ink + '" stroke-width="2" opacity=".5"/>' +
        scatter(rng, 10, function (r, i) { return '<circle cx="' + r2(20 + r * 160) + '" cy="' + r2(250 + (i % 4) * 8) + '" r="1.4" fill="' + ink + '" opacity=".45"/>'; });
    }
    if (kind === 'door') {
      return '<path d="M58 250 V128 Q58 62 100 54 Q142 62 142 128 V250 Z" fill="' + mid + '" opacity=".85"/>' +
        '<path d="M76 250 V136 Q76 86 100 80 Q124 86 124 136 V250 Z" fill="' + p.bg + '" opacity=".9"/>' +
        '<path d="M100 80 L100 250" stroke="' + accent + '" stroke-width="2" opacity=".5"/>' +
        '<path d="M0 250 H200" stroke="' + ink + '" stroke-width="2" opacity=".5"/>' +
        '<circle cx="100" cy="168" r="4" fill="' + accent + '"/>' +
        scatter(rng, 9, function (r, i) { return '<circle cx="' + r2(16 + r * 168) + '" cy="' + r2(28 + ((i * 53) % 200)) + '" r="1.5" fill="' + ink + '" opacity=".5"/>'; });
    }
    if (kind === 'thread') {
      var path = 'M12 260 C 58 210, 24 176, 70 148 S 150 120, 132 84 S 76 40, 116 22';
      return '<path d="' + path + '" fill="none" stroke="' + accent + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M20 276 C 72 236, 40 196, 88 170 S 168 138, 150 104" fill="none" stroke="' + ink + '" stroke-width="1.6" opacity=".5"/>' +
        scatter(rng, 6, function (r, i) { return '<circle cx="' + r2(30 + ((i * 31 + r * 20) % 140)) + '" cy="' + r2(60 + ((i * 41) % 160)) + '" r="' + r2(5 + r * 4) + '" fill="none" stroke="' + accent + '" stroke-width="2" opacity=".7"/>'; }) +
        '<circle cx="116" cy="22" r="6" fill="' + ink + '"/>';
    }
    if (kind === 'mask') {
      return '<path d="M100 42 C 58 42, 44 92, 52 154 C 58 208, 86 238, 100 244 C 114 238, 142 208, 148 154 C 156 92, 142 42, 100 42 Z" fill="' + accent + '" opacity=".82"/>' +
        '<ellipse cx="76" cy="124" rx="16" ry="10" fill="' + p.bg + '"/>' +
        '<ellipse cx="124" cy="124" rx="16" ry="10" fill="' + p.bg + '"/>' +
        '<path d="M86 182 Q100 194 114 182" fill="none" stroke="' + p.bg + '" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M60 74 L44 34 M140 74 L156 34" stroke="' + ink + '" stroke-width="2" opacity=".55"/>' +
        scatter(rng, 7, function (r, i) { return '<circle cx="' + r2(80 + r * 40) + '" cy="' + r2(150 + i * 16) + '" r="1.5" fill="' + p.bg + '" opacity=".5"/>'; });
    }
    if (kind === 'constellation') {
      var dots = [[38, 220], [66, 150], [104, 176], [138, 96], [168, 140], [118, 58], [82, 96], [152, 216]];
      var lines = '';
      for (var i = 1; i < dots.length; i++) lines += '<line x1="' + dots[i - 1][0] + '" y1="' + dots[i - 1][1] + '" x2="' + dots[i][0] + '" y2="' + dots[i][1] + '" stroke="' + ink + '" stroke-width="1.2" opacity=".45"/>';
      return lines + dots.map(function (d, i) {
        return '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="' + (i === 3 ? 7 : 4) + '" fill="' + (i === 3 ? accent : ink) + '"/>';
      }).join('') +
        '<circle cx="104" cy="150" r="92" fill="none" stroke="' + accent + '" stroke-width="1" opacity=".3"/>' +
        '<circle cx="104" cy="150" r="74" fill="none" stroke="' + ink + '" stroke-width="1" opacity=".2" stroke-dasharray="3 7"/>';
    }
    if (kind === 'fish') {
      return '<path d="M48 168 C 48 126, 86 104, 124 112 C 154 118, 168 142, 168 168 C 168 196, 148 214, 120 218 C 84 224, 48 204, 48 168 Z" fill="' + accent + '" opacity=".85"/>' +
        '<path d="M48 168 L18 142 L26 170 L16 198 Z" fill="' + ink + '" opacity=".7"/>' +
        '<circle cx="140" cy="150" r="6" fill="' + p.bg + '"/>' +
        '<path d="M92 118 C 100 100, 116 98, 124 112" fill="none" stroke="' + ink + '" stroke-width="2" opacity=".55"/>' +
        scatter(rng, 7, function (r, i) { return '<circle cx="' + r2(52 + r * 120) + '" cy="' + r2(40 + ((i * 23) % 56)) + '" r="' + r2(2 + r * 3) + '" fill="none" stroke="' + ink + '" stroke-width="1.4" opacity=".55"/>'; }) +
        '<path d="M0 246 Q 50 228 100 242 T200 236" fill="none" stroke="' + ink + '" stroke-width="1.4" opacity=".35"/>';
    }
    if (kind === 'tree') {
      var branches = '';
      for (var b = 0; b < 9; b++) {
        var ang = -1.2 + b * 0.3;
        var len = 52 + (b % 3) * 18;
        branches += '<path d="M100 216 L' + r2(100 + Math.cos(ang) * len) + ' ' + r2(150 - Math.sin(ang) * len) + '" stroke="' + accent + '" stroke-width="2" opacity=".75"/>';
      }
      return '<path d="M94 250 L96 150 L104 150 L106 250 Z" fill="' + ink + '" opacity=".75"/>' + branches +
        scatter(rng, 16, function (r, i) {
          var cx = 46 + ((i * 29 + r * 18) % 108);
          var cy = 62 + ((i * 37 + r * 14) % 92);
          return '<circle cx="' + r2(cx) + '" cy="' + r2(cy) + '" r="' + r2(7 + (i % 3) * 4) + '" fill="' + (i % 4 ? mid : accent) + '" opacity=".55"/>';
        }) +
        '<path d="M0 250 H200" stroke="' + ink + '" stroke-width="1.6" opacity=".4"/>';
    }
    // lantern
    return '<path d="M100 16 V48" stroke="' + ink + '" stroke-width="2" opacity=".6"/>' +
      '<path d="M64 68 H136 L148 152 H52 Z" fill="' + accent + '" opacity=".85"/>' +
      '<path d="M64 68 L100 44 L136 68" fill="none" stroke="' + ink + '" stroke-width="2" opacity=".6"/>' +
      '<path d="M52 152 H148 L136 196 H64 Z" fill="' + mid + '" opacity=".9"/>' +
      '<path d="M100 196 V244" stroke="' + accent + '" stroke-width="2"/>' +
      '<circle cx="100" cy="252" r="6" fill="' + accent + '"/>' +
      '<circle cx="100" cy="126" r="62" fill="' + accent + '" opacity=".12"/>' +
      scatter(rng, 12, function (r, i) { return '<circle cx="' + r2(30 + r * 140) + '" cy="' + r2(24 + ((i * 31) % 250)) + '" r="1.5" fill="' + ink + '" opacity=".45"/>'; });
  }

  function render(cardId, opts) {
    opts = opts || {};
    var card = Data.BY_ID[cardId];
    if (!card) throw new Error('unknown card ' + cardId);
    var p = PALETTES[card.palette];
    var rng = mulberry32(card.seed ^ 0x9e3779b9);
    var uid = String(opts.uid || ('c' + card.id)).replace(/[^a-zA-Z0-9_-]/g, '');
    var gid = 'grad-' + uid;
    var fid = 'frame-' + uid;
    var grain = '';
    for (var i = 0; i < 54; i++) {
      var x = r2(rng() * 200), y = r2(rng() * 300), r = r2(0.4 + rng() * 1.1);
      grain += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + p.ink + '" opacity="' + r2(0.04 + rng() * 0.08) + '"/>';
    }
    var rot = r2(-4 + rng() * 8);
    return '<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" class="dixit-card-svg">' +
      '<defs>' +
      '<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + p.bg + '"/><stop offset=".58" stop-color="' + p.mid + '"/><stop offset="1" stop-color="' + p.bg + '"/>' +
      '</linearGradient>' +
      '<radialGradient id="' + fid + '" cx=".32" cy=".22" r=".9">' +
      '<stop offset="0" stop-color="' + p.accent + '" stop-opacity=".22"/><stop offset="1" stop-color="' + p.bg + '" stop-opacity="0"/>' +
      '</radialGradient>' +
      '</defs>' +
      '<rect width="200" height="300" fill="url(#' + gid + ')"/>' +
      '<rect width="200" height="300" fill="url(#' + fid + ')"/>' +
      '<g transform="rotate(' + rot + ' 100 150)">' + motif(card.motif, p, rng) + '</g>' +
      grain +
      '<rect x="7" y="7" width="186" height="286" rx="6" fill="none" stroke="' + p.ink + '" stroke-opacity=".2" stroke-width="1"/>' +
      '</svg>';
  }

  return Object.freeze({
    render: render,
    card: function (id) { return Data.BY_ID[id] || null; },
    deck: Data.CARDS
  });
}));
