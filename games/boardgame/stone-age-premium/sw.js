/* Stone Age premium — offline cache. Same-origin only, no external requests. */
'use strict';
var CACHE = 'stone-age-premium-v1';
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
  "../../assets/art/premium/stoneage/cover.webp",
  "../../assets/art/premium/stoneage/og.webp",
  "../../assets/art/premium/stoneage/detail.webp",
  "../../assets/art/premium/stoneage/table-leather.webp",
  "../../assets/art/premium/stoneage/worker.webp",
  "../../assets/art/premium/stoneage/resource-wood.webp",
  "../../assets/art/premium/stoneage/resource-brick.webp",
  "../../assets/art/premium/stoneage/resource-stone.webp",
  "../../assets/art/premium/stoneage/resource-gold.webp",
  "../../assets/art/premium/stoneage/food-bowl.webp",
  "../../assets/art/premium/stoneage/die-blank.webp",
  "../../assets/art/premium/stoneage/hut.webp"
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
