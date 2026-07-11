// ============================================================
// Fresko Payment Follow-up — PWA Shell app.js
// This wraps the existing Google Apps Script web app (which already runs
// google.script.run internally and is served with X-Frame-Options: ALLOWALL)
// inside a fullscreen <iframe> so it installs as a proper standalone PWA.
//
// NOTE: The GAS backend (Code.gs) uses HtmlService + google.script.run, not
// a doGet-JSONP API — so this shell does NOT make direct JSONP calls the way
// a from-scratch GAS-PWA-ERP app.js normally would. All API calls happen
// inside the iframe, against the real app itself. This file only owns the
// PWA shell's own concerns: loading state, retry/offline handling, and
// service-worker registration.
// ============================================================

var APP_URL = 'https://script.google.com/macros/s/AKfycbwMRT3frAafqZrH1Myas1Bom7DHchzypzTk6y4G3nZrKUdj3k9_-dYVCSIr2lCiuuos/exec';

var frame   = document.getElementById('frame');
var splash  = document.getElementById('splash');
var spinner = document.getElementById('spinner');
var splashSub = document.getElementById('splashSub');
var retryBox  = document.getElementById('retryBox');
var retryBtn  = document.getElementById('retryBtn');
var openInBrowserLink = document.getElementById('openInBrowserLink');
var banner  = document.getElementById('offlineBanner');

var slowTimer, loaded = false;

openInBrowserLink.href = APP_URL;

function hideSplash() {
  loaded = true;
  clearTimeout(slowTimer);
  splash.style.opacity = '0';
  setTimeout(function () { splash.style.display = 'none'; }, 350);
}

function retryLoad() {
  loaded = false;
  spinner.style.display = 'block';
  splashSub.style.display = 'block';
  retryBox.style.display = 'none';
  splash.style.opacity = '1';
  splash.style.display = 'flex';
  frame.src = APP_URL + (APP_URL.indexOf('?') > -1 ? '&' : '?') + '_r=' + Date.now();
  startSlowTimer();
}

function startSlowTimer() {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(function () {
    if (!loaded) {
      spinner.style.display = 'none';
      splashSub.style.display = 'none';
      retryBox.style.display = 'flex';
    }
  }, 15000);
}

frame.addEventListener('load', hideSplash);
retryBtn.addEventListener('click', retryLoad);

frame.src = APP_URL;
startSlowTimer();

// Offline / online banner
function updateOnlineState() { banner.style.display = navigator.onLine ? 'none' : 'block'; }
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);
updateOnlineState();

// Register service worker (caches this shell only, never the app itself)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
  });
}
