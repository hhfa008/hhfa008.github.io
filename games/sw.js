/* Games hall — offline service worker.
   Scope: /games/ only. No analytics, no reporting, no cross-origin fetches.
   Pages: network-first, cache fallback, then /games/offline.html.
   Static assets: cache-first with background refresh (stale-while-revalidate). */
'use strict';

var CACHE_VERSION = 'v8';
var CACHE_PREFIX = 'hhfa-games-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
var OFFLINE_URL = '/games/offline.html';

var PRECACHE_URLS = [
  // Lobby pages (zh / en / id) and the offline fallback.
  '/games/',
  '/games/en/',
  '/games/id/',
  // '/games/offline.html' is precached separately: Cloudflare Pages redirects
  // it, so it needs redirect-following plus normalisation (see below).
  '/games/manifest.webmanifest',

  // Shared code used by the games.
  '/games/shared/rules.js',
  '/games/shared/share.js',
  '/games/shared/shuffle.js',
  '/games/pioneers/engine.js',

  // Every game entry page.
  '/games/24game/',
  '/games/aeroplane/',
  '/games/checkers-jump/',
  '/games/chess/',
  '/games/connect4/',
  '/games/doudizhu/',
  '/games/draughts/',
  '/games/backgammon/',
  '/games/banqi/',
  '/games/freecell/',
  '/games/go9/',
  '/games/gomoku/',
  '/games/pioneers/',
  '/games/reversi/',
  '/games/solitaire/',
  '/games/spider/',
  '/games/tap-match/',
  '/games/texas-holdem/',
  '/games/undercover/',
  '/games/voice-room/',
  '/games/xiangqi/',

  // Rules pages.
  '/games/24game/rules.html',
  '/games/aeroplane/rules.html',
  '/games/checkers-jump/rules.html',
  '/games/chess/rules.html',
  '/games/chess/rules-en.html',
  '/games/connect4/rules.html',
  '/games/doudizhu/rules.html',
  '/games/draughts/rules.html',
  '/games/backgammon/rules.html',
  '/games/banqi/rules.html',
  '/games/freecell/rules.html',
  '/games/go9/rules.html',
  '/games/gomoku/rules.html',
  '/games/gomoku/rules-en.html',
  '/games/pioneers/rules.html',
  '/games/reversi/rules.html',
  '/games/solitaire/rules.html',
  '/games/solitaire/rules-en.html',
  '/games/spider/rules.html',
  '/games/tap-match/rules.html',
  '/games/texas-holdem/rules.html',
  '/games/undercover/rules.html',
  '/games/xiangqi/rules.html',

  // Voice room guide (the room itself still needs a connection).
  '/games/voice-room/guide.html',

  // Game icons used by the hall and the offline page.
  '/games/assets/icons/24game.svg',
  '/games/assets/icons/aeroplane.svg',
  '/games/assets/icons/checkers-jump.svg',
  '/games/assets/icons/backgammon.svg',
  '/games/assets/icons/banqi.svg',
  '/games/assets/icons/chess.svg',
  '/games/assets/icons/connect4.svg',
  '/games/assets/icons/doudizhu.svg',
  '/games/assets/icons/draughts.svg',
  '/games/assets/icons/freecell.svg',
  '/games/assets/icons/go9.svg',
  '/games/assets/icons/gomoku.svg',
  '/games/assets/icons/pioneers.svg',
  '/games/assets/icons/reversi.svg',
  '/games/assets/icons/solitaire.svg',
  '/games/assets/icons/spider.svg',
  '/games/assets/icons/tap-match.svg',
  '/games/assets/icons/texas-holdem.svg',
  '/games/assets/icons/undercover.svg',
  '/games/assets/icons/voice-room.svg',
  '/games/assets/icons/xiangqi.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache entries one by one: a single 404 must not abort the whole install.
      var jobs = PRECACHE_URLS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          return null;
        });
      });
      jobs.push(precacheOfflinePage(cache).catch(function () {
        return null;
      }));
      return Promise.all(jobs);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Cloudflare Pages serves /games/offline.html as a 308 to /games/offline.
// A response fetched through that redirect keeps `redirected = true`, and the
// browser rejects such a response as a navigation reply (ERR_FAILED). Rebuild
// the body as a plain same-origin 200 so it is always safe to hand back.
function asPlain200(response) {
  if (!response) return response;
  return new Response(response.body, {
    status: 200,
    statusText: 'OK',
    headers: response.headers
  });
}

function precacheOfflinePage(cache) {
  var request = new Request(OFFLINE_URL, { redirect: 'follow', cache: 'reload' });
  return fetch(request).then(function (response) {
    if (!response.ok) {
      throw new Error('offline page responded with ' + response.status);
    }
    return cache.put(OFFLINE_URL, asPlain200(response));
  });
}

function pageFallback(request) {
  var url = new URL(request.url);
  var key = url.origin + url.pathname;
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return hit;
      if (url.pathname.slice(-1) === '/') {
        return cache.match(key + 'index.html');
      }
      if (url.pathname.slice(-11) === '/index.html') {
        return cache.match(key.slice(0, -10));
      }
      return null;
    });
  });
}

function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.put(request, copy);
      }).catch(function () {});
    }
    return response;
  }).catch(function () {
    return pageFallback(request).then(function (hit) {
      if (hit) return asPlain200(hit);
      return caches.match(OFFLINE_URL).then(function (offline) {
        if (offline) return asPlain200(offline);
        return new Response('当前离线，且这个页面尚未缓存。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var refresh = fetch(request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          var copy = response.clone();
          cache.put(request, copy).catch(function () {});
        }
        return response;
      }).catch(function () {
        return null;
      });

      if (hit) return hit;

      return refresh.then(function (response) {
        if (response) return response;
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/games/') !== 0) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
