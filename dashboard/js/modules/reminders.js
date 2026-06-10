import { load, save } from "../store.js";

const KEY = "reminders";

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.round((due - today) / 86400000);
}

function whenLabel(dateStr) {
  const d = daysUntil(dateStr);
  if (d < 0) return { text: `${-d}d overdue`, cls: "overdue" };
  if (d === 0) return { text: "today", cls: "today" };
  if (d === 1) return { text: "tomorrow", cls: "" };
  return { text: `in ${d}d`, cls: "" };
}

function render(body) {
  const items = load(KEY, []).sort((a, b) => a.date.localeCompare(b.date));

  body.innerHTML = "";
  const list = document.createElement("ul");
  list.className = "item-list";

  if (items.length === 0) {
    body.innerHTML = '<p class="empty">No upcoming reminders.</p>';
  } else {
    for (const item of items) {
      const li = document.createElement("li");
      const done = document.createElement("button");
      done.className = "ghost";
      done.textContent = "✓";
      done.title = "Mark done";
      done.onclick = () => {
        save(KEY, load(KEY, []).filter((r) => r.id !== item.id));
        render(body);
      };
      const text = document.createElement("span");
      text.textContent = item.text;
      const when = document.createElement("span");
      const label = whenLabel(item.date);
      when.className = `when ${label.cls}`;
      when.textContent = label.text;
      li.append(done, text, when);
      list.appendChild(li);
    }
    body.appendChild(list);
  }

  const form = document.createElement("div");
  form.className = "add-row";
  form.innerHTML = `
    <input type="text" placeholder="New reminder…" />
    <input type="date" />
    <button>Add</button>
  `;
  const [textInput, dateInput] = form.querySelectorAll("input");
  dateInput.value = new Date().toISOString().slice(0, 10);
  form.querySelector("button").onclick = () => {
    if (!textInput.value.trim() || !dateInput.value) return;
    const items = load(KEY, []);
    items.push({ id: Date.now(), text: textInput.value.trim(), date: dateInput.value });
    save(KEY, items);
    render(body);
  };
  body.appendChild(form);
}

export default { id: "reminders", title: "⏰ Reminders", render };
