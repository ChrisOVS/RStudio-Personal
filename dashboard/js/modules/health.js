import { load, save } from "../store.js";

const KEY = "health"; // [{ date, weight, steps, sleep }]

let chart; // Chart.js instance, recreated on each render

function render(body) {
  const entries = load(KEY, []).sort((a, b) => a.date.localeCompare(b.date));
  const latest = entries[entries.length - 1];

  body.innerHTML = "";

  const stats = document.createElement("div");
  stats.className = "stat-row";
  stats.innerHTML = `
    <div class="stat"><div class="value">${latest?.weight ?? "–"}</div><div class="label">Weight (kg)</div></div>
    <div class="stat"><div class="value">${latest?.steps?.toLocaleString() ?? "–"}</div><div class="label">Steps</div></div>
    <div class="stat"><div class="value">${latest?.sleep ?? "–"}</div><div class="label">Sleep (h)</div></div>
  `;
  body.appendChild(stats);

  if (entries.length >= 2) {
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    body.appendChild(wrap);

    const recent = entries.slice(-14);
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: recent.map((e) => e.date.slice(5)), // MM-DD
        datasets: [
          {
            label: "Weight (kg)",
            data: recent.map((e) => e.weight),
            borderColor: "#5b8cff",
            backgroundColor: "rgba(91,140,255,0.15)",
            tension: 0.3,
            fill: true,
            yAxisID: "y",
          },
          {
            label: "Sleep (h)",
            data: recent.map((e) => e.sleep),
            borderColor: "#3ecf8e",
            tension: 0.3,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b96ad", boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: "#8b96ad" }, grid: { color: "#28324a" } },
          y: { ticks: { color: "#8b96ad" }, grid: { color: "#28324a" } },
          y1: { position: "right", ticks: { color: "#8b96ad" }, grid: { drawOnChartArea: false } },
        },
      },
    });
  } else {
    body.insertAdjacentHTML(
      "beforeend",
      '<p class="empty">Log at least two days to see your trend chart.</p>'
    );
  }

  const form = document.createElement("div");
  form.className = "add-row";
  form.innerHTML = `
    <input type="number" step="0.1" placeholder="Weight" />
    <input type="number" placeholder="Steps" />
    <input type="number" step="0.5" placeholder="Sleep h" />
    <button>Log today</button>
  `;
  const [w, s, sl] = form.querySelectorAll("input");
  form.querySelector("button").onclick = () => {
    const today = new Date().toISOString().slice(0, 10);
    const all = load(KEY, []).filter((e) => e.date !== today); // one entry per day
    all.push({
      date: today,
      weight: w.value ? Number(w.value) : null,
      steps: s.value ? Number(s.value) : null,
      sleep: sl.value ? Number(sl.value) : null,
    });
    save(KEY, all);
    render(body);
  };
  body.appendChild(form);
}

export default { id: "health", title: "❤️ Health", render };
