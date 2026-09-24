var CACHE = 'fresko-payments-v5';   // ← v4 se v5 bump kiya
var SHELL = ['./', './index.html', './app.js', './gas-api.js', './manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  // Never cache: Apps Script API + external CDNs
  if (url.indexOf('script.google.com') !== -1) return;
  if (url.indexOf(self.location.origin) !== 0) return;

  // App shell: stale-while-revalidate (instant load + fresh in background)
  e.respondWith(
    caches.open(CACHE).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var networkFetch = fetch(e.request).then(function(res) {
          if (res && res.status === 200) cache.put(e.request, res.clone());
          return res;
        }).catch(function() {
          return cached || caches.match('./index.html');
        });
        return cached || networkFetch;
      });
    })
  );
});
