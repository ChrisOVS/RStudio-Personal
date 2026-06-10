import { load, save } from "../store.js";

// Minimal starter: track a monthly budget and quick expenses.
// This module is the natural place to grow financial features later
// (accounts, savings goals, imports, charts).

const KEY = "finance"; // { budget: number, expenses: [{ id, month, amount, note }] }

function thisMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function render(body) {
  const data = load(KEY, { budget: 0, expenses: [] });
  const month = thisMonth();
  const monthExpenses = data.expenses.filter((e) => e.month === month);
  const spent = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const left = data.budget - spent;

  body.innerHTML = "";

  const stats = document.createElement("div");
  stats.className = "stat-row";
  stats.innerHTML = `
    <div class="stat"><div class="value">${data.budget || "–"}</div><div class="label">Budget</div></div>
    <div class="stat"><div class="value">${spent.toFixed(0)}</div><div class="label">Spent</div></div>
    <div class="stat"><div class="value" style="color:${left < 0 ? "var(--red)" : "var(--green)"}">${data.budget ? left.toFixed(0) : "–"}</div><div class="label">Left</div></div>
  `;
  body.appendChild(stats);

  if (monthExpenses.length) {
    const list = document.createElement("ul");
    list.className = "item-list";
    for (const e of monthExpenses.slice(-5).reverse()) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${e.note || "Expense"}</span><span class="when">${e.amount.toFixed(2)}</span>`;
      list.appendChild(li);
    }
    body.appendChild(list);
  } else {
    body.insertAdjacentHTML("beforeend", '<p class="empty">No expenses logged this month.</p>');
  }

  const form = document.createElement("div");
  form.className = "add-row";
  form.innerHTML = `
    <input type="number" step="0.01" placeholder="Amount" />
    <input type="text" placeholder="Note (optional)" />
    <button>Add</button>
    <button class="ghost" title="Set monthly budget">Budget</button>
  `;
  const [amount, note] = form.querySelectorAll("input");
  const [addBtn, budgetBtn] = form.querySelectorAll("button");
  addBtn.onclick = () => {
    if (!amount.value) return;
    data.expenses.push({ id: Date.now(), month, amount: Number(amount.value), note: note.value.trim() });
    save(KEY, data);
    render(body);
  };
  budgetBtn.onclick = () => {
    const value = prompt("Monthly budget:", data.budget || "");
    if (value === null) return;
    data.budget = Number(value) || 0;
    save(KEY, data);
    render(body);
  };
  body.appendChild(form);
}

export default { id: "finance", title: "💰 Finance", render };
