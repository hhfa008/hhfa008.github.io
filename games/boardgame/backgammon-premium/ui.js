/* Backgammon premium — code-composed board renderer shared by index.html,
 * online.html and art-render.html. No network, no canvas: pure SVG + DOM.
 *
 *   BGPremiumUI.boardMarkup(view, opts)   -> SVG markup string
 *   BGPremiumUI.renderBoard(el, view, opts) -> draw + click handling
 *   BGPremiumUI.dieMarkup(value)         -> one die with real pips
 *
 * Geometry: 640x440 viewBox. Two rows of twelve points, the bar at x=294..310,
 * and two off trays at x=590..630. White home is points 1-6 (bottom right);
 * Black home is 19-24 (top right), exactly as the engine numbers them.
 */
(function (root) {
  'use strict';

  var ART = '../../assets/art/premium/backgammon/';
  var W = 640, H = 440;
  var BOARD = { x: 20, y: 20, w: 564, h: 400 };
  var BAR = { x: 294, w: 16 };
  var TRAYS = { x: 590, w: 40, top: 40, bottom: 240, h: 160 };
  var ROW = { top: 40, bottom: 400, tipTop: 208, tipBottom: 232 };
  var HALF = { left: 20, right: 584, barLeft: 294, barRight: 310 };
  var PW = (HALF.barLeft - HALF.left) / 6; // 45.67

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function pointCenterX(point) {
    if (point >= 1 && point <= 6) return HALF.right - (point - 0.5) * PW;
    if (point >= 7 && point <= 12) return HALF.barLeft - (point - 7 + 0.5) * PW;
    if (point >= 13 && point <= 18) return HALF.left + (point - 13 + 0.5) * PW;
    return HALF.barRight + (point - 19 + 0.5) * PW;
  }
  function isTop(point) { return point >= 13; }
  function ownAt(view, point, side) {
    var v = view.points[point] || 0;
    return side === 0 ? Math.max(0, v) : Math.max(0, -v);
  }
  function pointOwner(view, point) {
    var v = view.points[point] || 0;
    if (v > 0) return 0;
    if (v < 0) return 1;
    return null;
  }
  function checkerStack(view, point) {
    var owner = pointOwner(view, point);
    if (owner == null) return 0;
    return Math.abs(view.points[point] || 0);
  }
  function legalMovesOf(view) { return Array.isArray(view.legalMoves) ? view.legalMoves : []; }
  function setOf(values) {
    var s = Object.create(null);
    values.forEach(function (v) { s[String(v)] = true; });
    return s;
  }

  function checkerSVG(cx, cy, owner, opts) {
    var prefix = opts.prefix || 'bg';
    var r = opts.r || 18.5;
    var tex = owner === 0 ? 'url(#' + prefix + '-ivory)' : 'url(#' + prefix + '-walnut)';
    var shade = owner === 0 ? '#f4ead2' : '#231611';
    var rim = owner === 0 ? '#cdbb95' : '#0d0907';
    var ring = owner === 0 ? 'rgba(255,255,255,.72)' : 'rgba(214,180,128,.35)';
    var out = '';
    out += '<circle class="checker-shadow" cx="' + (cx + 1.6) + '" cy="' + (cy + 2.4) + '" r="' + (r + 0.6) + '" fill="rgba(0,0,0,.34)"/>';
    out += '<circle class="checker checker-side-' + owner + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + tex + '" stroke="' + rim + '" stroke-width="1.6"/>';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 3.2) + '" fill="' + shade + '" opacity="' + (owner === 0 ? '.10' : '.34') + '"/>';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 6.5) + '" fill="none" stroke="' + ring + '" stroke-width="1.1" opacity=".7"/>';
    out += '<path d="M ' + (cx - r * 0.55) + ' ' + (cy - r * 0.45) + ' A ' + (r * 0.72) + ' ' + (r * 0.72) + ' 0 0 1 ' + (cx + r * 0.28) + ' ' + (cy - r * 0.68) + '" fill="none" stroke="rgba(255,255,255,' + (owner === 0 ? '.55' : '.18') + ')" stroke-width="1.6" stroke-linecap="round"/>';
    return out;
  }

  function stackSVG(view, point, opts) {
    var n = checkerStack(view, point);
    if (!n) return '';
    var owner = pointOwner(view, point);
    var cx = pointCenterX(point);
    var top = isTop(point);
    // Stack from the outer edge toward the centre, exactly like real checkers.
    var first = top ? ROW.top + 22 : ROW.bottom - 22;
    var step = 5.4;
    var out = '';
    for (var i = 0; i < n; i++) {
      var cy = top ? first + i * step : first - i * step;
      out += checkerSVG(cx, cy, owner, opts);
    }
    if (n > 5) {
      var badgeY = top ? first + (n - 1) * step : first - (n - 1) * step;
      out += '<g class="stack-badge" aria-hidden="true"><circle cx="' + (cx + 14) + '" cy="' + badgeY + '" r="8.5" fill="rgba(12,8,5,.86)" stroke="' + (owner === 0 ? '#e9dcbc' : '#c79f62') + '" stroke-width="1"/><text x="' + (cx + 14) + '" y="' + (badgeY + 3.6) + '" text-anchor="middle" font-size="10" font-weight="800" fill="#f7edd6">' + n + '</text></g>';
    }
    return out;
  }

  function pointSVG(view, point, opts) {
    var x = pointCenterX(point);
    var top = isTop(point);
    var baseY = top ? ROW.top : ROW.bottom;
    var tipY = top ? ROW.tipTop : ROW.tipBottom;
    var cls = 'point point-' + point + (point % 2 ? ' point-dark' : ' point-light');
    var interactive = opts.interactive !== false;
    var moves = legalMovesOf(view);
    var selected = opts.selected;
    var sources = opts.sources || {};
    var targets = opts.targets || {};
    if (sources[String(point)]) cls += ' can-move';
    if (targets[String(point)]) cls += ' is-target';
    if (selected != null && String(selected) === String(point)) cls += ' is-selected';
    if (view.lastMove && String(view.lastMove.from) === String(point)) cls += ' last-from';
    if (view.lastMove && String(view.lastMove.to) === String(point)) cls += ' last-to';
    var poly = x - PW / 2 + 1.2 + ',' + baseY + ' ' + (x + PW / 2 - 1.2) + ',' + baseY + ' ' + x + ',' + tipY;
    var out = '<g class="' + cls + '" data-point="' + point + '">';
    out += '<polygon class="point-fill" points="' + poly + '" fill="url(#' + (opts.prefix || 'bg') + (point % 2 ? '-walnut' : '-maple') + ')"/>';
    out += '<polygon class="point-tone" points="' + poly + '" fill="' + (point % 2 ? '#170c06' : '#f7e4bd') + '" opacity="' + (point % 2 ? '.48' : '.12') + '"/>';
    out += '<polygon class="point-inlay" points="' + poly + '" fill="none"/>';
    out += '<text class="point-label" x="' + x + '" y="' + (top ? 33 : 414) + '" text-anchor="middle">' + point + '</text>';
    out += stackSVG(view, point, opts);
    if (interactive) {
      var hitY = top ? ROW.top : ROW.tipBottom;
      out += '<rect class="point-hit" data-point="' + point + '" x="' + (x - PW / 2) + '" y="' + hitY + '" width="' + PW + '" height="' + (ROW.bottom - ROW.tipBottom) + '" rx="4" role="gridcell" tabindex="0" aria-label="第 ' + point + ' 点，' + checkerStack(view, point) + ' 枚' + (pointOwner(view, point) === 0 ? '白棋' : pointOwner(view, point) === 1 ? '黑棋' : '空') + '"/>';
    }
    out += '</g>';
    return out;
  }

  function barSVG(view, opts) {
    var out = '';
    out += '<rect class="bar" x="' + BAR.x + '" y="' + BOARD.y + '" width="' + BAR.w + '" height="' + BOARD.h + '" rx="3"/>';
    out += '<text class="bar-label" x="' + (BAR.x + BAR.w / 2) + '" y="' + (H / 2 + 4) + '" text-anchor="middle">BAR</text>';
    var interactive = opts.interactive !== false;
    ['0', '1'].forEach(function (key) {
      var side = Number(key);
      var n = view.bar[side] || 0;
      if (n) {
        for (var i = 0; i < n; i++) {
          var cx = BAR.x + BAR.w / 2;
          var cy = side === 0 ? 386 - i * 5.4 : 54 + i * 5.4;
          out += checkerSVG(cx, cy, side, opts);
        }
      }
      if (interactive) {
        var cls = 'bar-hit';
        if (opts.sources && opts.sources.bar && view.you === side) cls += ' can-move';
        out += '<rect class="' + cls + '" data-bar="' + side + '" x="' + (BAR.x - 2) + '" y="' + (side === 0 ? 216 : 36) + '" width="' + (BAR.w + 4) + '" height="168" rx="4" role="gridcell" tabindex="0" aria-label="' + (side === 0 ? '白方' : '黑方') + ' bar，' + n + ' 枚"/>';
      }
    });
    if (opts.showCube !== false) {
      var v = view.cube ? view.cube.value : 1;
      out += '<g class="cube-badge" aria-label="倍数方块 ' + v + '"><rect x="' + (W / 2 - 15) + '" y="' + (H / 2 - 15) + '" width="30" height="30" rx="5" fill="url(#' + (opts.prefix || 'bg') + '-brass)" stroke="#f2dbab" stroke-width="1.4"/><rect x="' + (W / 2 - 11) + '" y="' + (H / 2 - 11) + '" width="22" height="22" rx="3" fill="none" stroke="rgba(59,37,10,.5)" stroke-width="1"/><text x="' + (W / 2) + '" y="' + (H / 2 + 5) + '" text-anchor="middle" font-size="16" font-weight="900" fill="#2a1a0c">' + v + '</text></g>';
    }
    return out;
  }

  function traySVG(view, opts) {
    var out = '';
    [[0, TRAYS.bottom], [1, TRAYS.top]].forEach(function (pair) {
      var side = pair[0], y = pair[1];
      var n = view.off[side] || 0;
      var canHit = opts.interactive !== false && opts.offTargets && opts.offTargets[String(side)];
      out += '<g class="tray tray-' + side + (canHit ? ' is-target' : '') + '">';
      out += '<rect x="' + TRAYS.x + '" y="' + y + '" width="' + TRAYS.w + '" height="' + TRAYS.h + '" rx="10" class="tray-well"/>';
      out += '<text x="' + (TRAYS.x + TRAYS.w / 2) + '" y="' + (y + 18) + '" text-anchor="middle" class="tray-label">' + (side === 0 ? '白 OFF' : '黑 OFF') + '</text>';
      out += '<text x="' + (TRAYS.x + TRAYS.w / 2) + '" y="' + (y + TRAYS.h - 10) + '" text-anchor="middle" class="tray-count">' + n + ' / 15</text>';
      var cols = 2;
      for (var i = 0; i < Math.min(n, 15); i++) {
        var cx = TRAYS.x + 11 + (i % cols) * 18;
        var cy = y + 34 + Math.floor(i / cols) * 17;
        out += checkerSVG(cx, cy, side, { prefix: opts.prefix, r: 7.2 });
      }
      if (opts.interactive !== false) {
        out += '<rect class="tray-hit" data-off="' + side + '" x="' + TRAYS.x + '" y="' + y + '" width="' + TRAYS.w + '" height="' + TRAYS.h + '" rx="10" role="gridcell" tabindex="0" aria-label="' + (side === 0 ? '白方' : '黑方') + ' off 区，' + n + ' 枚"/>';
      }
      out += '</g>';
    });
    return out;
  }

  function boardMarkup(view, opts) {
    opts = opts || {};
    var prefix = opts.prefix || 'bg';
    var sources = Object.create(null);
    var targetsBySource = Object.create(null);
    var offBySource = Object.create(null);
    legalMovesOf(view).forEach(function (m) {
      sources[String(m.from)] = true;
      var key = String(m.from);
      if (!targetsBySource[key]) targetsBySource[key] = Object.create(null);
      if (m.to === 'off') {
        offBySource[key] = true;
      } else {
        targetsBySource[key][String(m.to)] = true;
      }
    });
    var selected = opts.selected == null ? null : String(opts.selected);
    var targets = selected != null && targetsBySource[selected] ? targetsBySource[selected] : Object.create(null);
    var offTargets = selected != null && offBySource[selected] ? (function () {
      var o = Object.create(null); o[String(view.you)] = true; return o;
    })() : null;
    var out = '';
    out += '<svg class="bg-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="双陆棋盘，24 个棋位，15 对 15 枚棋子">';
    out += '<defs>';
    out += '<pattern id="' + prefix + '-ivory" patternUnits="userSpaceOnUse" width="64" height="64"><image href="' + ART + 'ivory-checker.webp" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid slice"/></pattern>';
    out += '<pattern id="' + prefix + '-walnut" patternUnits="userSpaceOnUse" width="64" height="64"><image href="' + ART + 'walnut.webp" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid slice"/></pattern>';
    out += '<pattern id="' + prefix + '-maple" patternUnits="userSpaceOnUse" width="120" height="120"><image href="' + ART + 'maple.webp" x="0" y="0" width="120" height="120" preserveAspectRatio="xMidYMid slice"/></pattern>';
    out += '<pattern id="' + prefix + '-leather" patternUnits="userSpaceOnUse" width="120" height="120"><image href="' + ART + 'leather.webp" x="0" y="0" width="120" height="120" preserveAspectRatio="xMidYMid slice"/></pattern>';
    out += '<linearGradient id="' + prefix + '-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4dfae"/><stop offset=".45" stop-color="#c99a4e"/><stop offset="1" stop-color="#8a5c22"/></linearGradient>';
    out += '<linearGradient id="' + prefix + '-darkwood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a3520"/><stop offset=".55" stop-color="#3a2013"/><stop offset="1" stop-color="#1e110a"/></linearGradient>';
    out += '<linearGradient id="' + prefix + '-lightwood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8c995"/><stop offset=".55" stop-color="#cfaa72"/><stop offset="1" stop-color="#a97f49"/></linearGradient>';
    out += '<clipPath id="' + prefix + '-boardclip"><rect x="' + BOARD.x + '" y="' + BOARD.y + '" width="' + BOARD.w + '" height="' + BOARD.h + '" rx="10"/></clipPath>';
    out += '</defs>';
    out += '<rect class="board-frame" x="7" y="7" width="' + (W - 14) + '" height="' + (H - 14) + '" rx="20"/>';
    out += '<rect class="board-frame-inner" x="14" y="14" width="' + (W - 28) + '" height="' + (H - 28) + '" rx="15"/>';
    out += '<g clip-path="url(#' + prefix + '-boardclip)">';
    out += '<rect class="playfield" x="' + BOARD.x + '" y="' + BOARD.y + '" width="' + BOARD.w + '" height="' + BOARD.h + '"/>';
    out += '<rect class="playfield-leather" x="' + BOARD.x + '" y="' + BOARD.y + '" width="' + BOARD.w + '" height="' + BOARD.h + '" fill="url(#' + prefix + '-leather)" opacity=".34"/>';
    out += '<rect class="center-line" x="' + BOARD.x + '" y="' + (H / 2 - 1) + '" width="' + BOARD.w + '" height="2"/>';
    for (var p = 1; p <= 24; p++) out += pointSVG(view, p, { prefix: prefix, interactive: opts.interactive, selected: selected, sources: sources, targets: targets });
    out += barSVG(view, { prefix: prefix, interactive: opts.interactive, sources: sources, showCube: opts.showCube });
    out += '</g>';
    out += traySVG(view, { prefix: prefix, interactive: opts.interactive, offTargets: offTargets });
    out += '</svg>';
    return out;
  }

  function renderBoard(container, view, opts) {
    opts = opts || {};
    container.innerHTML = boardMarkup(view, opts);
    if (opts.onTap) {
      container.querySelectorAll('.point-hit,.bar-hit,.tray-hit').forEach(function (el) {
        el.addEventListener('click', function (event) {
          event.preventDefault();
          if (el.hasAttribute('data-point')) opts.onTap({ type: 'point', point: Number(el.getAttribute('data-point')) });
          else if (el.hasAttribute('data-bar')) opts.onTap({ type: 'bar', side: Number(el.getAttribute('data-bar')) });
          else opts.onTap({ type: 'off', side: Number(el.getAttribute('data-off')) });
        });
        el.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          el.click();
        });
      });
    }
  }

  var PIPS = {
    1: [[50, 50]],
    2: [[30, 30], [70, 70]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[30, 30], [70, 30], [30, 70], [70, 70]],
    5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
    6: [[30, 28], [70, 28], [30, 50], [70, 50], [30, 72], [70, 72]]
  };
  function dieMarkup(value, cls) {
    var v = Number(value) || 1;
    var pips = '';
    (PIPS[v] || PIPS[1]).forEach(function (pos, i) {
      pips += '<i class="pip p' + (i + 1) + '" style="left:' + pos[0] + '%;top:' + pos[1] + '%"></i>';
    });
    return '<span class="die' + (cls ? ' ' + cls : '') + '" role="img" aria-label="骰子 ' + v + '"><span class="die-face">' + pips + '</span></span>';
  }

  root.BGPremiumUI = {
    boardMarkup: boardMarkup,
    renderBoard: renderBoard,
    dieMarkup: dieMarkup,
    pointCenterX: pointCenterX,
    W: W,
    H: H
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
