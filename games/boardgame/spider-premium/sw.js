/*
 * Spider Solitaire premium — local-only offline cache.
 * All URLs are same-origin; missing optional art never blocks install.
 */
'use strict';

var CACHE = 'spider-premium-v1';
var CORE = [
  './index.html',
  './rules.html',
  './engine.js',
  '../../shared/shuffle.js',
  '../../shared/sfx.js',
  '../../shared/store.js',
  './assets/cover.webp',
  './assets/og.webp',
  './assets/detail-1.webp',
  './assets/card.webp',
  '../../assets/art/premium/spider/felt.webp',
  '../../assets/art/premium/spider/card-back.webp'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(CORE.map(function (url) {
        return cache.add(url).catch(function () { /* optional asset */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try { url = new URL(request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); }).catch(function () {});
        }
        return response;
      }).catch(function () {
        if (request.mode === 'navigate') {
          return caches.match('./index.html').then(function (fallback) {
            return fallback || caches.match('./');
          });
        }
        return Response.error();
      });
    })
  );
});
