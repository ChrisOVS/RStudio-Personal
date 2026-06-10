import { load, save } from "../store.js";

const PLAN_KEY = "workouts.plan";
const LOG_KEY = "workouts.log"; // dates ("YYYY-MM-DD") of completed workouts

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_PLAN = ["Push", "Pull", "Rest", "Legs", "Cardio", "Rest", "Rest"];

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Monday-based index of a date's weekday
function dayIndex(d) {
  return (d.getDay() + 6) % 7;
}

function dateOfThisWeek(idx) {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - dayIndex(now) + idx);
  return isoDate(d);
}

function render(body) {
  const plan = load(PLAN_KEY, DEFAULT_PLAN);
  const log = new Set(load(LOG_KEY, []));
  const todayIdx = dayIndex(new Date());

  body.innerHTML = "";

  // This week's schedule; tap a day to toggle "done"
  const week = document.createElement("div");
  week.className = "week-row";
  plan.forEach((label, i) => {
    const date = dateOfThisWeek(i);
    const done = log.has(date);
    const cell = document.createElement("div");
    cell.className = "day" + (i === todayIdx ? " today" : "") + (done ? " done" : "");
    cell.innerHTML = `${DAY_NAMES[i]}<br>${label}<span class="dot">${done ? "✅" : label === "Rest" ? "·" : "○"}</span>`;
    cell.onclick = () => {
      const entries = new Set(load(LOG_KEY, []));
      entries.has(date) ? entries.delete(date) : entries.add(date);
      save(LOG_KEY, [...entries]);
      render(body);
    };
    week.appendChild(cell);
  });
  body.appendChild(week);

  // Today's focus + weekly count
  const planned = plan.filter((p) => p !== "Rest").length;
  const doneThisWeek = plan.filter((_, i) => log.has(dateOfThisWeek(i))).length;
  const stats = document.createElement("div");
  stats.className = "stat-row";
  stats.style.marginTop = "12px";
  stats.innerHTML = `
    <div class="stat"><div class="value">${plan[todayIdx]}</div><div class="label">Today</div></div>
    <div class="stat"><div class="value">${doneThisWeek}/${planned}</div><div class="label">This week</div></div>
    <div class="stat"><div class="value">${log.size}</div><div class="label">All time</div></div>
  `;
  body.appendChild(stats);

  // Edit the plan for one weekday
  const form = document.createElement("div");
  form.className = "add-row";
  const options = DAY_NAMES.map((d, i) => `<option value="${i}">${d}</option>`).join("");
  form.innerHTML = `
    <select>${options}</select>
    <input type="text" placeholder="Workout name (e.g. Legs)" />
    <button>Set</button>
  `;
  form.querySelector("select").value = String(todayIdx);
  form.querySelector("button").onclick = () => {
    const idx = Number(form.querySelector("select").value);
    const name = form.querySelector("input").value.trim();
    if (!name) return;
    const updated = load(PLAN_KEY, DEFAULT_PLAN);
    updated[idx] = name;
    save(PLAN_KEY, updated);
    render(body);
  };
  body.appendChild(form);
}

export default { id: "workouts", title: "🏋️ Workouts", render };
