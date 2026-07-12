var CACHE = 'fresko-payments-v1';
var SHELL = ['./', './index.html', './app.js', './gas-api.js', './manifest.json', './icon-192.png', './icon-512.png'];

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
  // Never cache: the Apps Script API itself, or any cross-origin CDN request
  // (SweetAlert2, Chart.js, XLSX, Google Fonts, Font Awesome) -- those must
  // always hit the network so data stays live and libraries stay current.
  if (url.indexOf(self.location.origin) !== 0) return;

  // Only cache-first this app shell's own files (HTML/JS/manifest/icons).
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).catch(function () { return caches.match('./index.html'); });
    })
  );
});
