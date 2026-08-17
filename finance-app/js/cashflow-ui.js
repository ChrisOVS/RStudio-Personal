/*
 * cashflow-ui.js — the Cash Flow tab: the projection table, its editor and charts.
 *
 * The table is the point of this tab. Rows are transactions grouped by category,
 * columns are years. A cell you typed reads in full-strength ink; a cell that
 * inherited its value from an earlier year is muted — so the carry-forward rule
 * is visible at a glance rather than something you have to remember.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var money = Charts.money;
  var moneyShort = Charts.moneyShort;

  var STORAGE_KEY = 'finance-app.cashflow.v1';
  var registry = CashFlow.createRegistry();

  var state = {
    startYear: new Date().getFullYear(),
    horizonYears: 20,
    openingBalance: 0,
    annualReturn: 0.06,
    transactions: []
  };

  // Enough of a starting ledger that the table is legible on first open.
  function seedTransactions() {
    var y = state.startYear;
    return [
      { label: 'Rent / mortgage', group: 'Housing', kind: 'expense', cadence: 'monthly', startYear: y, amounts: {} },
      { label: 'Utilities', group: 'Housing', kind: 'expense', cadence: 'monthly', startYear: y, amounts: {} },
      { label: 'Groceries', group: 'Living', kind: 'expense', cadence: 'monthly', startYear: y, amounts: {} },
      { label: 'Transport', group: 'Living', kind: 'expense', cadence: 'monthly', startYear: y, amounts: {} }
    ].map(function (t) {
      t.amounts[y] = 0;
      return CashFlow.normalize(t);
    });
  }

  /* ----------------------------------------------------------- persistence -- */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startYear: state.startYear,
        horizonYears: state.horizonYears,
        openingBalance: state.openingBalance,
        annualReturn: state.annualReturn,
        // Only manual rows are stored. Derived rows are rebuilt from their tab,
        // so persisting them would resurrect stale copies.
        transactions: state.transactions.filter(function (t) { return t.source === 'manual'; })
      }));
    } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (saved.startYear) state.startYear = saved.startYear;
      if (saved.horizonYears) state.horizonYears = saved.horizonYears;
      state.openingBalance = saved.openingBalance || 0;
      state.annualReturn = saved.annualReturn == null ? 0.06 : saved.annualReturn;
      state.transactions = (saved.transactions || []).map(CashFlow.normalize);
      return true;
    } catch (e) { return false; }
  }

  /* --------------------------------------------------------------- rebuild -- */

  /** Re-pull every registered source, then redraw. Call after any change. */
  function refresh() {
    state.transactions = registry.rebuild(state.transactions);
    save();
    render();
  }

  /* ---------------------------------------------------------------- render -- */

  function render() {
    var p = CashFlow.project(state);
    renderControls();
    renderStats(p);
    renderTable(p);
    Charts.renderNetFlow($('chart-netflow'), p.years, p.net);
    Charts.renderBalance($('chart-balance'), p.years, p.balance, p.cumulativeNet);
    renderManageList();
    renderSourceNote();
  }

  function renderControls() {
    if ($('cf-start').value !== String(state.startYear)) $('cf-start').value = state.startYear;
    if ($('cf-horizon').value !== String(state.horizonYears)) $('cf-horizon').value = state.horizonYears;
    if (document.activeElement !== $('cf-opening')) {
      $('cf-opening').value = state.openingBalance ? state.openingBalance.toLocaleString('en-US') : '';
    }
    if (document.activeElement !== $('cf-return')) {
      $('cf-return').value = (state.annualReturn * 100).toFixed(1).replace(/\.0$/, '');
    }
  }

  function renderStats(p) {
    var i = 0;
    $('cf-stat-net').textContent = money(p.net[i]);
    $('cf-stat-net-sub').textContent = p.net[i] >= 0
      ? 'left over in ' + p.years[i]
      : 'short in ' + p.years[i];

    $('cf-stat-balance').textContent = money(p.balance[p.balance.length - 1]);
    $('cf-stat-balance-sub').textContent = 'projected by ' + p.years[p.years.length - 1];

    var growth = p.balance[p.balance.length - 1] - p.cumulativeNet[p.cumulativeNet.length - 1];
    $('cf-stat-growth').textContent = money(growth);
    $('cf-stat-growth-sub').textContent = 'investment growth at ' + (state.annualReturn * 100).toFixed(1) + '%';

    var el = $('cf-stat-shortfall');
    if (p.shortfallYear) {
      el.textContent = p.shortfallYear;
      el.classList.add('is-critical');
      $('cf-stat-shortfall-sub').textContent = 'first year the balance runs out';
    } else {
      el.textContent = 'None';
      el.classList.remove('is-critical');
      $('cf-stat-shortfall-sub').textContent = 'balance stays positive throughout';
    }
  }

  /* ----------------------------------------------------------------- table -- */

  function renderTable(p) {
    var thead = $('cf-thead');
    var tbody = $('cf-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    var head = document.createElement('tr');
    head.innerHTML = '<th class="cf-sticky">Transaction</th>'
      + '<th>Cadence</th>'
      + p.years.map(function (y) { return '<th>' + y + '</th>'; }).join('');
    thead.appendChild(head);

    p.groups.forEach(function (group) {
      var gr = document.createElement('tr');
      gr.className = 'cf-group';
      gr.innerHTML = '<td class="cf-sticky">' + escapeHtml(group.name) + '</td>'
        + '<td></td>'
        + group.byYear.map(function (v) {
            return '<td>' + (v === 0 ? '—' : moneyShort(v)) + '</td>';
          }).join('');
      tbody.appendChild(gr);

      group.lines.forEach(function (line) {
        tbody.appendChild(buildLineRow(line, p.years));
      });
    });

    if (!p.groups.length) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td class="cf-sticky" colspan="' + (p.years.length + 2) + '">'
        + 'No transactions yet. Add one below, or fill in the Salary tab to feed income in.</td>';
      tbody.appendChild(empty);
    }

    // Totals.
    var tfoot = $('cf-tfoot');
    tfoot.innerHTML = '';
    tfoot.appendChild(totalRow('Money in', p.years, p.income, '', false));
    tfoot.appendChild(totalRow('Money out', p.years, p.expenses, '', false));
    tfoot.appendChild(totalRow('Net for the year', p.years, p.net, 'is-total', true));
    tfoot.appendChild(totalRow('Balance', p.years, p.balance, 'is-balance', true));
  }

  /**
   * `flagNegative` is only set on the net and balance rows. On those, a negative
   * genuinely means trouble and earns the shortfall colour. "Money out" is
   * negative every single year by definition, so colouring it would spend a
   * status colour on something that is never news.
   */
  function totalRow(label, years, values, cls, flagNegative) {
    var tr = document.createElement('tr');
    tr.className = 'cf-total ' + cls;
    tr.innerHTML = '<td class="cf-sticky">' + label + '</td><td></td>'
      + values.map(function (v) {
          var neg = (flagNegative && v < 0) ? ' class="is-negative"' : '';
          return '<td' + neg + '>' + moneyShort(v) + '</td>';
        }).join('');
    return tr;
  }

  function buildLineRow(line, years) {
    var tx = line.tx;
    var tr = document.createElement('tr');
    tr.className = 'cf-line' + (tx.locked ? ' is-locked' : '');

    var name = document.createElement('td');
    name.className = 'cf-sticky cf-name';
    name.innerHTML = '<span class="cf-label">' + escapeHtml(tx.label) + '</span>'
      + (tx.locked ? '<span class="cf-badge" title="Kept in step with the '
          + escapeHtml(CashFlow.SOURCES[tx.source] || tx.source)
          + '. Edit it there.">' + escapeHtml(sourceShort(tx.source)) + '</span>' : '');
    tr.appendChild(name);

    var cadence = document.createElement('td');
    cadence.className = 'cf-cadence';
    cadence.textContent = (CashFlow.CADENCES[tx.cadence] || {}).label || tx.cadence;
    tr.appendChild(cadence);

    years.forEach(function (year) {
      var td = document.createElement('td');
      var active = CashFlow.isActiveIn(tx, year);
      var explicit = CashFlow.isExplicit(tx, year);

      if (!active) {
        td.className = 'cf-cell is-inactive';
        td.textContent = '—';
      } else if (tx.locked) {
        td.className = 'cf-cell is-locked';
        td.textContent = moneyShort(CashFlow.amountForYear(tx, year));
      } else {
        td.className = 'cf-cell' + (explicit ? ' is-explicit' : ' is-inherited');
        var input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = formatCell(CashFlow.amountForYear(tx, year));
        input.title = explicit
          ? 'Set for ' + year
          : 'Inherited from an earlier year. Type here to change it from ' + year + ' on.';
        input.setAttribute('aria-label', tx.label + ', ' + year);
        input.addEventListener('change', function () {
          applyCellEdit(tx.id, year, input.value);
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') input.blur();
          // Backspace on an empty inherited-value cell clears the override.
          if (e.key === 'Escape') { input.value = formatCell(CashFlow.amountForYear(tx, year)); input.blur(); }
        });
        td.appendChild(input);
      }
      tr.appendChild(td);
    });

    return tr;
  }

  function formatCell(v) {
    if (!v) return '';
    return Math.round(v).toLocaleString('en-US');
  }

  function sourceShort(source) {
    return { salary: 'Salary', expenses: 'Expenses', lifeEvent: 'Life event', savings: 'Savings' }[source] || source;
  }

  function applyCellEdit(txId, year, raw) {
    var idx = state.transactions.findIndex(function (t) { return t.id === txId; });
    if (idx < 0) return;
    var tx = state.transactions[idx];

    var trimmed = String(raw).trim();
    if (trimmed === '' && CashFlow.isExplicit(tx, year)) {
      // Emptying a cell you had set reverts it to inheriting.
      state.transactions[idx] = CashFlow.clearAmount(tx, year);
    } else {
      state.transactions[idx] = CashFlow.setAmount(tx, year, trimmed === '' ? 0 : trimmed);
    }
    save();
    render();
  }

  /* ------------------------------------------------------------ manage list -- */

  function renderManageList() {
    var host = $('cf-manage-list');
    host.innerHTML = '';
    var manual = state.transactions.filter(function (t) { return t.source === 'manual'; });

    if (!manual.length) {
      host.innerHTML = '<p class="cf-empty">No transactions of your own yet.</p>';
      return;
    }

    manual.forEach(function (tx) {
      var row = document.createElement('div');
      row.className = 'cf-manage-row';
      row.innerHTML =
        '<input type="text" value="' + escapeAttr(tx.label) + '" data-f="label" aria-label="Label">' +
        '<input type="text" value="' + escapeAttr(tx.group) + '" data-f="group" aria-label="Group">' +
        '<select data-f="kind" aria-label="Direction">' +
          '<option value="expense"' + (tx.kind === 'expense' ? ' selected' : '') + '>Money out</option>' +
          '<option value="income"' + (tx.kind === 'income' ? ' selected' : '') + '>Money in</option>' +
        '</select>' +
        '<select data-f="cadence" aria-label="Cadence">' +
          Object.keys(CashFlow.CADENCES).map(function (c) {
            return '<option value="' + c + '"' + (tx.cadence === c ? ' selected' : '') + '>'
              + CashFlow.CADENCES[c].label + '</option>';
          }).join('') +
        '</select>' +
        '<input type="number" value="' + (tx.startYear == null ? '' : tx.startYear) + '" data-f="startYear" placeholder="From" aria-label="Start year">' +
        '<input type="number" value="' + (tx.endYear == null ? '' : tx.endYear) + '" data-f="endYear" placeholder="Until" aria-label="End year">' +
        '<input type="number" value="' + (tx.growth * 100).toFixed(1).replace(/\.0$/, '') + '" data-f="growth" step="0.5" aria-label="Yearly growth percent" title="Yearly % increase applied between the years you set">' +
        '<button type="button" class="cf-del" aria-label="Remove ' + escapeAttr(tx.label) + '">Remove</button>';

      row.querySelectorAll('[data-f]').forEach(function (field) {
        field.addEventListener('change', function () {
          updateTransaction(tx.id, field.dataset.f, field.value);
        });
      });
      row.querySelector('.cf-del').addEventListener('click', function () {
        state.transactions = state.transactions.filter(function (t) { return t.id !== tx.id; });
        save();
        render();
      });

      host.appendChild(row);
    });
  }

  function updateTransaction(id, field, value) {
    var idx = state.transactions.findIndex(function (t) { return t.id === id; });
    if (idx < 0) return;
    var next = Object.assign({}, state.transactions[idx]);
    if (field === 'growth') next.growth = (parseFloat(value) || 0) / 100;
    else if (field === 'startYear' || field === 'endYear') next[field] = value === '' ? null : parseInt(value, 10);
    else next[field] = value;
    state.transactions[idx] = CashFlow.normalize(next);
    save();
    render();
  }

  function renderSourceNote() {
    var sources = registry.sources();
    var counts = {};
    state.transactions.forEach(function (t) {
      if (t.source !== 'manual') counts[t.source] = (counts[t.source] || 0) + 1;
    });
    var listed = Object.keys(counts).map(function (s) {
      return counts[s] + ' from the ' + (CashFlow.SOURCES[s] || s);
    });
    $('cf-source-note').innerHTML = listed.length
      ? '<strong>Fed from other tabs.</strong> ' + listed.join(', ')
        + '. Those rows update themselves and cannot be edited here — change them on their own tab.'
      : '<strong>Nothing feeding in yet.</strong> Fill in the Salary tab and your take-home pay will '
        + 'appear here as an income row automatically.';
  }

  /* ------------------------------------------------------------------ utils -- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function numFrom(v) {
    var n = parseFloat(String(v || '').replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /* ------------------------------------------------------------------- init -- */

  function init() {
    if (!load()) state.transactions = seedTransactions();

    $('cf-start').addEventListener('change', function () {
      state.startYear = parseInt(this.value, 10) || new Date().getFullYear();
      refresh();
    });
    $('cf-horizon').addEventListener('change', function () {
      state.horizonYears = parseInt(this.value, 10) || 20;
      refresh();
    });
    $('cf-opening').addEventListener('input', function () {
      state.openingBalance = numFrom(this.value);
      save();
      render();
    });
    $('cf-return').addEventListener('input', function () {
      state.annualReturn = numFrom(this.value) / 100;
      save();
      render();
    });

    $('cf-add').addEventListener('click', function () {
      state.transactions.push(CashFlow.normalize({
        label: 'New transaction',
        group: $('cf-add-group').value.trim() || 'Ungrouped',
        kind: 'expense',
        cadence: 'monthly',
        startYear: state.startYear,
        amounts: (function () { var a = {}; a[state.startYear] = 0; return a; })()
      }));
      save();
      render();
      // Put the cursor in the new row's label so it can be named immediately.
      var rows = $('cf-manage-list').querySelectorAll('.cf-manage-row input[data-f="label"]');
      if (rows.length) { rows[rows.length - 1].focus(); rows[rows.length - 1].select(); }
    });

    refresh();
  }

  // Exposed so other tabs can plug in without reaching into this module.
  window.CashFlowTab = {
    registerSource: function (source, fn) { registry.register(source, fn); },
    refresh: refresh,
    getState: function () { return state; },
    getProjection: function () { return CashFlow.project(state); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
