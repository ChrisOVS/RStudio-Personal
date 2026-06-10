# Personal Dashboard

A tiny, dependency-free dashboard you can open on your phone:
**reminders, workout schedule, health stats (with charts), and a finance starter.**

Built with plain HTML/CSS/JavaScript + [Chart.js](https://www.chartjs.org/)
(loaded from a CDN) — no build step, no framework, runs anywhere a browser runs.
All data is stored in the browser's `localStorage`, so it stays private and
on-device (note: data is per device/browser).

## Use it on your phone

The easiest path is **GitHub Pages**:

1. In this repo's settings → *Pages*, enable Pages from the `main` branch.
2. Open `https://<your-username>.github.io/RStudio-Personal/dashboard/` on your phone.
3. In the browser menu choose **"Add to Home Screen"** — it installs like an
   app (icon, full screen, works offline thanks to the service worker).

To try it locally instead, run from this folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000 (or http://<your-computer-ip>:8000 on your phone)
```

(A local server is needed because the app uses ES modules; opening the file
directly won't work.)

## Structure — how to add a new section

```
dashboard/
├── index.html          # app shell
├── manifest.json       # PWA install metadata
├── sw.js               # service worker (offline cache)
├── css/style.css
├── icons/
└── js/
    ├── app.js          # renders all registered modules
    ├── store.js        # localStorage helpers
    └── modules/        # one file per dashboard card
        ├── reminders.js
        ├── workouts.js
        ├── health.js
        └── finance.js
```

Every card on the dashboard is a **module**: a file exporting
`{ id, title, render(bodyElement) }`. To add a new card (habits, mood,
savings goals, …):

1. Copy any file in `js/modules/` as a starting point.
2. Import it in `js/app.js` and add it to the `MODULES` array.
3. Add its path to the `ASSETS` list in `sw.js` (and bump the cache name)
   so it works offline.

That's the whole extension mechanism — no registry, no config files.
