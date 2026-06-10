// App entry point.
//
// Each dashboard section is a self-contained module in js/modules/.
// A module exports: { id, title, render(bodyElement) }.
// To add a new section (e.g. finance details, habits, mood tracking):
//   1. create js/modules/yourmodule.js
//   2. import it below and add it to MODULES — that's it.

import reminders from "./modules/reminders.js";
import workouts from "./modules/workouts.js";
import health from "./modules/health.js";
import finance from "./modules/finance.js";

const MODULES = [reminders, workouts, health, finance];

function renderHeader() {
  const el = document.getElementById("today-line");
  el.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

function renderModules() {
  const grid = document.getElementById("dashboard-grid");
  grid.innerHTML = "";
  for (const mod of MODULES) {
    const card = document.createElement("section");
    card.className = "card";
    card.id = `module-${mod.id}`;

    const title = document.createElement("h2");
    title.textContent = mod.title;
    card.appendChild(title);

    const body = document.createElement("div");
    card.appendChild(body);
    grid.appendChild(card);

    try {
      mod.render(body);
    } catch (err) {
      body.innerHTML = `<p class="empty">Failed to load: ${err.message}</p>`;
    }
  }
}

renderHeader();
renderModules();

// Offline support / installability
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
