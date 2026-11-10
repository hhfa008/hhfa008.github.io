/* Century: Spice Road premium — offline cache. Same-origin only, no external requests. */
'use strict';
var CACHE = 'century-spice-road-premium-v1';
var ASSETS = [
  "./index.html",
  "./online.html",
  "./engine.js",
  "./data.js",
  "./rules.html",
  "../../shared/shuffle.js",
  "../../shared/sfx.js",
  "../../shared/rewards.js",
  "../../assets/art/premium/century-spice-road/caravan-bowl.webp",
  "../../assets/art/premium/century-spice-road/coin-gold.webp",
  "../../assets/art/premium/century-spice-road/coin-silver.webp",
  "../../assets/art/premium/century-spice-road/parchment.webp",
  "../../assets/art/premium/century-spice-road/spice-cardamom.webp",
  "../../assets/art/premium/century-spice-road/spice-cinnamon.webp",
  "../../assets/art/premium/century-spice-road/spice-saffron.webp",
  "../../assets/art/premium/century-spice-road/spice-turmeric.webp",
  "../../assets/art/premium/century-spice-road/table-walnut.webp",
  "./assets/cover.webp",
  "./assets/og.webp",
  "./assets/detail-1.webp",
  "./assets/detail-2.webp"
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
