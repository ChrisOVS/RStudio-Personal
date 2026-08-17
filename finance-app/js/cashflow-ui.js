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
    transactions: [],
    // Hand edits to rows owned by another tab, keyed by transaction then year.
    // Kept apart from the rows themselves so they survive every rebuild.
    overrides: {}
  };

  /* ----------------------------------------------------------- persistence -- */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startYear: state.startYear,
        horizonYears: state.horizonYears,
        openingBalance: state.openingBalance,
        annualReturn: state.annualReturn,
        // Only manual rows are stored. Derived rows are rebuilt from their tab,
        // so persisting them would resurrect stale copies. Overrides are stored
        // because they are edits the user made here and nowhere else.
        transactions: state.transactions.filter(function (t) { return t.source === 'manual'; }),
        overrides: state.overrides
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
      state.overrides = saved.overrides || {};
      return true;
    } catch (e) { return false; }
  }

  /* --------------------------------------------------------------- rebuild -- */

  /**
   * Re-pull every registered source, then lay any hand edits back on top and
   * redraw. Overrides are re-applied AFTER the rebuild, which is what lets a
   * typed-in year survive the owning tab regenerating its rows.
   */
  function refresh() {
    state.transactions = CashFlow.applyOverrides(
      registry.rebuild(state.transactions),
      state.overrides
    );
    save();
    render();
  }

  /* ---------------------------------------------------------------- render -- */

  function render() {
    // Savings contributions are money retained, not spent, so the table can show
    // a bottom line that counts them. Pulled fresh each render because the
    // Savings tab owns the figures.
    state.savingsAddBack = savingsAddBack();
    var p = CashFlow.project(state);
    renderControls();
    renderStats(p);
    renderTable(p);
    Charts.renderNetFlow($('chart-netflow'), p.years, p.net);
    Charts.renderBalance($('chart-balance'), p.years, p.balance, p.cumulativeNet);
    renderSourceNote();
  }

  /** Your own contributions per year, from the Savings tab. Excludes employer match. */
  function savingsAddBack() {
    if (!window.SavingsTab) return [];
    try {
      return window.SavingsTab.getProjection().contributionsByYear || [];
    } catch (e) { return []; }
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

    $('cf-stat-withsavings').textContent = money(p.netWithSavings[i]);
    $('cf-stat-withsavings-sub').textContent = p.savingsAddBack[i] > 0
      ? 'cash plus ' + money(p.savingsAddBack[i]) + ' into savings'
      : 'nothing going into savings yet';

    $('cf-stat-balance').textContent = money(p.balance[p.balance.length - 1]);
    $('cf-stat-balance-sub').textContent = 'cash by ' + p.years[p.years.length - 1];

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
    // Same reason as the pay table: rebuilding drops the caret out of the cell
    // being edited, and the next keystrokes land on whatever had focus before.
    var focused = activeCellId(tbody);
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
    tfoot.appendChild(totalRow('Net cash for the year', p.years, p.net, 'is-total', true));

    // The point of these two: `net` is cash left liquid, which counts money moved
    // into savings as though it were gone. It is not — adding it back gives the
    // "how much better off am I" figure.
    var hasSavings = p.savingsAddBack.some(function (v) { return v > 0; });
    if (hasSavings) {
      tfoot.appendChild(totalRow('Plus savings & investments', p.years, p.savingsAddBack, 'is-addback', false));
      tfoot.appendChild(totalRow('Net including savings', p.years, p.netWithSavings, 'is-total is-networth', true));
    }

    tfoot.appendChild(totalRow('Cash balance', p.years, p.balance, 'is-balance', true));

    restoreCellFocus(tbody, focused);
  }

  function activeCellId(container) {
    var el = document.activeElement;
    if (!el || !container.contains(el) || !el.dataset || !el.dataset.tx) return null;
    return { tx: el.dataset.tx, year: el.dataset.year, start: el.selectionStart };
  }

  function restoreCellFocus(container, ref) {
    if (!ref) return;
    var next = container.querySelector(
      'input[data-tx="' + (window.CSS && CSS.escape ? CSS.escape(ref.tx) : ref.tx) + '"][data-year="' + ref.year + '"]');
    if (!next) return;
    next.focus();
    try { next.setSelectionRange(ref.start, ref.start); } catch (e) { /* not selectable */ }
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
      var overridden = CashFlow.isOverridden(tx, year);

      if (!active) {
        td.className = 'cf-cell is-inactive';
        td.textContent = '—';
        tr.appendChild(td);
        return;
      }

      // Every cell is editable, including rows owned by another tab. Editing one
      // of those writes an override rather than changing the row, so the row
      // keeps tracking its tab everywhere else.
      td.className = 'cf-cell'
        + (overridden ? ' is-overridden' : explicit ? ' is-explicit' : ' is-inherited');

      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = formatCell(CashFlow.amountForYear(tx, year));
      input.setAttribute('aria-label', tx.label + ', ' + year);
      input.dataset.tx = tx.id;
      input.dataset.year = year;
      input.title = overridden
        ? 'Overridden by hand. Clear the cell to hand it back to the '
          + (CashFlow.SOURCES[tx.source] || 'source tab') + '.'
        : tx.locked
          ? 'From the ' + (CashFlow.SOURCES[tx.source] || 'source tab')
            + '. Type here to override just this year onward.'
          : explicit
            ? 'Set for ' + year
            : 'Inherited from an earlier year. Type here to change it from ' + year + ' on.';

      input.addEventListener('change', function () {
        applyCellEdit(tx, year, input.value);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = formatCell(CashFlow.amountForYear(tx, year));
          input.blur();
        }
      });
      td.appendChild(input);
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

  /**
   * A cell edit takes one of two paths.
   *
   * On a row this tab owns, it writes the amount directly. On a row fed in by
   * another tab, it writes an OVERRIDE — stored separately and re-applied after
   * every rebuild — so the edit sticks without detaching the row from its tab.
   * Clearing the cell hands that year back.
   */
  function applyCellEdit(tx, year, raw) {
    var trimmed = String(raw).trim();

    if (tx.locked) {
      if (!state.overrides[tx.id]) state.overrides[tx.id] = {};
      if (trimmed === '') delete state.overrides[tx.id][year];
      else state.overrides[tx.id][year] = parseFloat(trimmed.replace(/[$,\s]/g, '')) || 0;
      if (!Object.keys(state.overrides[tx.id]).length) delete state.overrides[tx.id];
      refresh();
      return;
    }

    var idx = state.transactions.findIndex(function (t) { return t.id === tx.id; });
    if (idx < 0) return;
    if (trimmed === '' && CashFlow.isExplicit(tx, year)) {
      state.transactions[idx] = CashFlow.clearAmount(tx, year);
    } else {
      state.transactions[idx] = CashFlow.setAmount(tx, year, trimmed === '' ? 0 : trimmed);
    }
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
    var overrideCount = Object.keys(state.overrides).reduce(function (a, id) {
      return a + Object.keys(state.overrides[id] || {}).length;
    }, 0);

    $('cf-source-note').innerHTML = listed.length
      ? '<strong>Fed from your other tabs.</strong> ' + listed.join(', ')
        + '. They keep themselves in step, so change the underlying figures there. '
        + 'You can still type over any single year here — that becomes an override and sticks. '
        + (overrideCount
            ? '<strong>' + overrideCount + ' cell' + (overrideCount === 1 ? '' : 's')
              + ' overridden</strong> — clear a cell to hand the year back.'
            : '')
      : '<strong>Nothing feeding in yet.</strong> Fill in the Salary and Expenses tabs and '
        + 'their rows will appear here automatically.';
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
    load();

    $('cf-start').addEventListener('change', function () {
      state.startYear = parseInt(this.value, 10) || new Date().getFullYear();
      notifyHorizon();
      refresh();
    });
    $('cf-horizon').addEventListener('change', function () {
      state.horizonYears = parseInt(this.value, 10) || 20;
      notifyHorizon();
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

    refresh();
  }

  /** The horizon is set here but shapes the other tabs' projections too. */
  function notifyHorizon() {
    if (window.ExpensesTab) window.ExpensesTab.onHorizonChange();
    if (window.LifeEventsTab) window.LifeEventsTab.onHorizonChange();
    if (window.SavingsTab) window.SavingsTab.onSalaryChange();
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
