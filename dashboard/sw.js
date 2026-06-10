// Service worker: caches the app shell so the dashboard opens
// instantly and works offline once it has been visited.
const CACHE = "dashboard-v1";
const ASSETS = [
  ".",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/app.js",
  "js/store.js",
  "js/modules/reminders.js",
  "js/modules/workouts.js",
  "js/modules/health.js",
  "js/modules/finance.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

// Network-first so updates land quickly, cache as offline fallback.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
