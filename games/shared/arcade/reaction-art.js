/* Arcade shared: reaction-family in-game sprite art.
 *
 * 3 张单物件透明底素材（1024²，四角 alpha=0、中心 alpha=255）：
 *   mole         -> whack / whack-15 / whack-60
 *   target       -> aim-trainer / aim-15 / aim-60
 *   signal-lamp  -> reaction-time / reaction-10 / reaction-20 / reaction-30
 *
 * 只负责插 <img>，不碰点击、计时、计分逻辑。素材来源与构建见
 * games/assets/art/arcade/reaction-objects/{sprites.json,build-sprites.py}。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeReactionArt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var BASE = '/games/assets/art/arcade/reaction-objects/';
  var KINDS = {
    mole: 'mole.png',
    target: 'target.png',
    lamp: 'signal-lamp.png'
  };

  function url(kind) { return BASE + (KINDS[kind] || KINDS.target); }

  function sprite(kind) {
    var img = document.createElement('img');
    img.className = 'reaction-sprite reaction-sprite-' + kind;
    img.src = url(kind);
    img.alt = '';
    img.draggable = false;
    img.setAttribute('aria-hidden', 'true');
    img.dataset.art = kind;
    return img;
  }

  /* Append once to host; later render passes reuse the same node. */
  function ensure(host, kind) {
    if (!host) return null;
    var existing = host.querySelector('img.reaction-sprite');
    if (existing) return existing;
    var img = sprite(kind);
    host.appendChild(img);
    return img;
  }

  return { base: BASE, kinds: KINDS, url: url, sprite: sprite, ensure: ensure };
});
