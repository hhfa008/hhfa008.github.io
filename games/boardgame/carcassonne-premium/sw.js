/* Carcassonne premium — offline cache. Same-origin only, no external requests. */
'use strict';
var CACHE = 'carcassonne-premium-v1';
var ASSETS = [
  "./index.html",
  "./online.html",
  "./rules.html",
  "./engine.js",
  "./data.js",
  "./meta.json",
  "../../shared/shuffle.js",
  "../../shared/sfx.js",
  "../app/online-bridge.js",
  "../app/online-lobby.css",
  "../app/online-lobby.js",
  "../../assets/art/premium/carcassonne/cover.webp",
  "../../assets/art/premium/carcassonne/og.webp",
  "../../assets/art/premium/carcassonne/detail.webp",
  "../../assets/art/premium/carcassonne/table-linen.webp",
  "../../assets/art/premium/carcassonne/blank-tile.webp",
  "../../assets/art/premium/carcassonne/meeple-red.webp",
  "../../assets/art/premium/carcassonne/meeple-blue.webp"
];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(function (hit) {
    return hit || fetch(event.request).then(function (response) {
      if (!response || response.status !== 200) return response;
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      return response;
    }).catch(function () { return caches.match('./index.html'); });
  }));
});
