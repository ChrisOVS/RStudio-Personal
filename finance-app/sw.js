/*
 * sw.js — offline support for the hosted copy.
 *
 * The strategy is deliberately conservative, because the classic service-worker
 * failure is a page that caches itself and then never updates again:
 *
 *   NAVIGATIONS  -> network first, cache as fallback. Online, you always get the
 *                   current version. Offline, you get the last one that worked.
 *   ASSETS       -> stale-while-revalidate. Instant load from cache, with a
 *                   fresh copy fetched in the background for next time.
 *
 * VERSION is stamped by the deploy workflow, so every deploy gets its own cache
 * and the old one is deleted on activate. A constant here would mean shipping a
 * fix that nobody ever receives.
 */

var VERSION = '__BUILD__';
var CACHE = 'paycheck-finance-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/tax-data.js',
  './js/calc.js',
  './js/cashflow.js',
  './js/savings.js',
  './js/expenses.js',
  './js/life-events.js',
  './js/pay-schedule.js',
  './js/health.js',
  './js/storage.js',
  './js/charts.js',
  './js/cashflow-ui.js',
  './js/savings-ui.js',
  './js/expenses-ui.js',
  './js/life-events-ui.js',
  './js/health-ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one 404 cannot fail the whole install and leave the
      // app with no offline copy at all.
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          return cache.add(url).catch(function () { /* skip this one */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (name !== CACHE && name.indexOf('paycheck-finance-') === 0) {
            return caches.delete(name);
          }
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch third parties

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
