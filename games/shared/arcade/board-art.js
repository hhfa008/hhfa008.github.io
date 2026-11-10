/* Arcade shared: in-game board art for the 8 non-pilot families.
 *
 * Batch 2 (2026-11-10) covers 80 games:
 *   2048 ×10, slide ×10, lights ×10, mines ×10, tictactoe ×10,
 *   hanoi ×10, snake ×10, pong ×10
 *
 * The module is a pure visual layer:
 *   - appends <img> nodes only, never touches clicks, timers or scoring;
 *   - is idempotent (a decorated element is marked .has-art);
 *   - every page keeps a single call at the end of its render():
 *       ArcadeBoardArt.decorate(E.board, '<family>');
 *
 * Assets: existing material PNGs + 12 programmatic SVG sprites
 * (games/assets/art/arcade/engine/build-inline-sprites.mjs) + 1 img-gen disk
 * (games/assets/art/arcade/hanoi/build-disk.py). See art-manifest.json.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeBoardArt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ARCADE = '/games/assets/art/arcade/';
  var MAT = ARCADE + 'materials/';
  var MAPS = {
    '2048': {
      board: '/games/assets/art/2048/materials/table-walnut.png',
      boardOpacity: 0.9,
      tiles: {
        ivory: '/games/assets/art/2048/materials/tile-ivory-cut.png',
        clay: '/games/assets/art/2048/materials/tile-clay-cut.png',
        gold: '/games/assets/art/2048/materials/tile-gold-cut.png'
      }
    },
    slide: {
      board: '/games/assets/art/2048/materials/table-walnut.png',
      boardOpacity: 0.9,
      tiles: {
        ivory: '/games/assets/art/2048/materials/tile-ivory-cut.png',
        clay: '/games/assets/art/2048/materials/tile-clay-cut.png',
        gold: '/games/assets/art/2048/materials/tile-gold-cut.png'
      }
    },
    lights: {
      board: MAT + 'lights-out/surface.png',
      boardOpacity: 0.85,
      on: ARCADE + 'lights-out/light-on.png',
      off: ARCADE + 'lights-out/light-off.png'
    },
    mines: {
      board: MAT + 'minesweeper/surface.png',
      boardOpacity: 0.9,
      cover: ARCADE + 'minesweeper/cover-tile.png',
      mine: ARCADE + 'minesweeper/mine.png',
      flag: ARCADE + 'minesweeper/flag.png'
    },
    tictactoe: {
      board: MAT + 'tictactoe/surface.png',
      boardOpacity: 0.92,
      x: ARCADE + 'tictactoe/mark-x.png',
      o: ARCADE + 'tictactoe/mark-o.png'
    },
    hanoi: {
      board: MAT + 'hanoi/surface.png',
      boardOpacity: 0.85,
      disk: ARCADE + 'hanoi/disk.png'
    },
    snake: {
      board: MAT + 'snake/surface.png',
      boardOpacity: 0.7,
      head: ARCADE + 'snake/head.png',
      body: ARCADE + 'snake/body.png',
      food: ARCADE + 'snake/food.png'
    },
    pong: {
      board: MAT + 'pong/surface.png',
      boardOpacity: 0.35,
      paddle: ARCADE + 'pong/paddle.png',
      ball: ARCADE + 'pong/ball.png'
    }
  };

  function sprite(src, kind) {
    var img = document.createElement('img');
    img.className = 'arcade-sprite arcade-sprite-' + kind;
    img.src = src;
    img.alt = '';
    img.draggable = false;
    img.setAttribute('aria-hidden', 'true');
    img.dataset.art = kind;
    return img;
  }

  function paint(el, src, kind, extraClass) {
    if (!el || el.querySelector('img.arcade-sprite')) return;
    var img = sprite(src, kind);
    if (extraClass) img.className += ' ' + extraClass;
    el.appendChild(img);
    el.classList.add('has-art');
  }

  /* Board-ground layer. Absolutely positioned so grid/flex layout ignores it. */
  function surface(board, cfg) {
    if (!cfg || !cfg.board || board.querySelector('img.arcade-board-art')) return;
    var img = document.createElement('img');
    img.className = 'arcade-board-art';
    img.src = cfg.board;
    img.alt = '';
    img.draggable = false;
    img.setAttribute('aria-hidden', 'true');
    img.dataset.art = 'board';
    img.style.opacity = String(cfg.boardOpacity == null ? 0.85 : cfg.boardOpacity);
    board.insertBefore(img, board.firstChild);
  }

  function level(value) {
    if (value <= 4) return 'ivory';
    if (value <= 64) return 'clay';
    return 'gold';
  }

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }

  function decorate(board, family) {
    board = board || (typeof document !== 'undefined' && document.getElementById('board'));
    var cfg = MAPS[family];
    if (!board || !cfg) return 0;
    surface(board, cfg);
    var painted = 0;
    var before = board.querySelectorAll('img.arcade-sprite').length;

    if (family === '2048' || family === 'slide') {
      each(board.querySelectorAll('.tile'), function (tile) {
        var value = parseInt(tile.textContent, 10);
        if (!value) return;
        paint(tile, cfg.tiles[level(value)], level(value), 'arcade-tile-face');
      });
    } else if (family === 'lights') {
      // lights-3 uses .board-cell; lights-4..12 render .cell;
      // lights-8 renders .board-row > button.tile(.lit).
      each(board.querySelectorAll('.board-cell, .cell, .board-row .tile'), function (cell) {
        var on = cell.classList.contains('on') || cell.classList.contains('lit');
        if (!on) {
          var bg = cell.style.backgroundColor || '';
          var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          on = m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 128 : false;
        }
        paint(cell, on ? cfg.on : cfg.off, on ? 'light-on' : 'light-off');
      });
    } else if (family === 'mines') {
      each(board.querySelectorAll('.cell'), function (cell) {
        if (cell.classList.contains('mine')) paint(cell, cfg.mine, 'mine');
        else if (cell.classList.contains('flag')) paint(cell, cfg.flag, 'flag');
        else if (!cell.classList.contains('revealed')) paint(cell, cfg.cover, 'cover');
      });
    } else if (family === 'tictactoe') {
      each(board.querySelectorAll('.cell'), function (cell) {
        var mark = (cell.textContent || '').trim();
        if (mark === 'X' || mark === 'x') paint(cell, cfg.x, 'mark-x');
        else if (mark === 'O' || mark === 'o') paint(cell, cfg.o, 'mark-o');
      });
    } else if (family === 'hanoi') {
      each(board.querySelectorAll('.disk'), function (disk) {
        paint(disk, cfg.disk, 'disk');
      });
    } else if (family === 'snake') {
      each(board.querySelectorAll('.cell'), function (cell) {
        if (cell.classList.contains('head')) paint(cell, cfg.head, 'head');
        else if (cell.classList.contains('snake')) paint(cell, cfg.body, 'body');
        if (cell.classList.contains('food')) paint(cell, cfg.food, 'food');
      });
    } else if (family === 'pong') {
      each(board.querySelectorAll('.ball'), function (ball) { paint(ball, cfg.ball, 'ball'); });
      each(board.querySelectorAll('.paddle'), function (paddle) { paint(paddle, cfg.paddle, 'paddle'); });
    }

    painted = board.querySelectorAll('img.arcade-sprite').length - before;
    return painted;
  }

  function url(family, kind) {
    var cfg = MAPS[family];
    return cfg ? cfg[kind] : null;
  }

  return { maps: MAPS, sprite: sprite, decorate: decorate, url: url };
});
