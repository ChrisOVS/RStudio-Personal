/*
 * expenses-ui.js — the Expenses tab.
 *
 * Owns every recurring outgoing and feeds them into the cash flow ledger. This
 * is where the transaction editor lives now; the Cash flow tab reads the result
 * rather than being the place you type things in.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var money = Charts.money;

  var STORAGE_KEY = 'finance-app.expenses.v1';

  var state = {
    expenses: [],
    defaultInflation: 0.03,
    bufferPct: 0
  };

  /** A starting set, so the tab is legible before anything is typed. */
  function defaults() {
    return [
      { label: 'Rent / mortgage', category: 'Housing', cadence: 'monthly', amount: 0 },
      { label: 'Utilities', category: 'Housing', cadence: 'monthly', amount: 0 },
      { label: 'Groceries', category: 'Food', cadence: 'monthly', amount: 0 },
      { label: 'Eating out', category: 'Food', cadence: 'monthly', amount: 0 },
      { label: 'Transport', category: 'Transport', cadence: 'monthly', amount: 0 },
      { label: 'Insurance', category: 'Insurance', cadence: 'monthly', amount: 0 }
    ].map(Expenses.normalize);
  }

  /* ------------------------------------------------------------ persistence -- */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      state.expenses = (saved.expenses || []).map(Expenses.normalize);
      state.defaultInflation = saved.defaultInflation == null ? 0.03 : saved.defaultInflation;
      state.bufferPct = saved.bufferPct || 0;
      return true;
    } catch (e) { return false; }
  }

  function horizonYears() {
    if (window.CashFlowTab) return CashFlow.yearRange(window.CashFlowTab.getState());
    var y = new Date().getFullYear();
    return Array.from({ length: 20 }, function (_, i) { return y + i; });
  }

  /* ----------------------------------------------------------------- render -- */

  function render() {
    var years = horizonYears();
    var p = Expenses.project(state, years);

    renderControls();
    renderStats(p, years);
    renderList(p);
    renderCategoryChart(p);
    Charts.renderExpenseGrowth($('chart-expense-growth'), years, p.base, p.buffer);
    renderBufferNote(p);
  }

  function renderControls() {
    if (document.activeElement !== $('ex-inflation')) {
      $('ex-inflation').value = pctVal(state.defaultInflation);
    }
    if (document.activeElement !== $('ex-buffer')) {
      $('ex-buffer').value = pctVal(state.bufferPct);
    }
    $('ex-buffer-out').textContent = Math.round(state.bufferPct * 100) + '%';
  }

  function renderStats(p, years) {
    $('ex-stat-monthly').textContent = money(p.totalMonthly);
    $('ex-stat-monthly-sub').textContent = p.bufferPct > 0
      ? money(p.baseMonthly) + ' + ' + Math.round(p.bufferPct * 100) + '% buffer'
      : 'a month, everything counted';

    $('ex-stat-annual').textContent = money(p.totalAnnual);
    $('ex-stat-annual-sub').textContent = 'a year in ' + years[0];

    $('ex-stat-buffer').textContent = money(p.bufferAnnual);
    $('ex-stat-buffer-sub').textContent = p.bufferPct > 0
      ? 'headroom against underestimating'
      : 'no buffer set';

    $('ex-stat-future').textContent = money(p.base[p.base.length - 1] * (1 + p.bufferPct));
    $('ex-stat-future-sub').textContent = 'the same basket in ' + years[years.length - 1]
      + ' (' + p.inflationMultiple.toFixed(2) + '× today)';
  }

  /* ------------------------------------------------------------------- list -- */

  function renderList(p) {
    var host = $('ex-list');
    host.innerHTML = '';

    if (!p.perExpense.length) {
      host.innerHTML = '<p class="cf-empty">No expenses yet. Add one below.</p>';
      return;
    }

    p.perExpense.forEach(function (row) {
      var e = row.expense;
      var el = document.createElement('div');
      el.className = 'ex-row' + (e.disabled ? ' is-off' : '');

      el.innerHTML =
        '<input type="text" value="' + attr(e.label) + '" data-f="label" aria-label="Expense name">' +
        '<select data-f="category" aria-label="Category">' +
          Expenses.CATEGORIES.map(function (c) {
            return '<option value="' + c + '"' + (e.category === c ? ' selected' : '') + '>' + c + '</option>';
          }).join('') +
        '</select>' +
        '<select data-f="cadence" aria-label="How often">' +
          Object.keys(CashFlow.CADENCES).filter(function (c) { return c !== 'once'; }).map(function (c) {
            return '<option value="' + c + '"' + (e.cadence === c ? ' selected' : '') + '>'
              + CashFlow.CADENCES[c].label + '</option>';
          }).join('') +
        '</select>' +
        '<div class="input-money ex-amount">' +
          '<input type="text" value="' + fmt(e.amount) + '" data-f="amount" inputmode="decimal" placeholder="0" aria-label="Amount">' +
        '</div>' +
        // An empty inflation box means "follow the default" — the placeholder
        // shows what that currently is, so the blank is never a mystery.
        '<div class="ex-infl">' +
          '<input type="number" step="0.5" value="' + (row.usesDefault ? '' : pctVal(e.inflation)) +
            '" data-f="inflation" placeholder="' + pctVal(state.defaultInflation) +
            '" aria-label="Inflation percent for ' + attr(e.label) + '"' +
            ' title="Blank follows the default of ' + pctVal(state.defaultInflation) + '%. Type a number to pin this one.">' +
          '<span class="ex-infl-tag">' + (row.usesDefault ? 'default' : 'pinned') + '</span>' +
        '</div>' +
        '<span class="ex-annual">' + money(row.annual) + '<small>/yr</small></span>' +
        '<button type="button" class="cf-del ex-del" aria-label="Remove ' + attr(e.label) + '">Remove</button>';

      el.querySelectorAll('[data-f]').forEach(function (field) {
        field.addEventListener('change', function () {
          update(e.id, field.dataset.f, field.value);
        });
      });
      el.querySelector('.ex-del').addEventListener('click', function () {
        state.expenses = state.expenses.filter(function (x) { return x.id !== e.id; });
        commit();
      });

      host.appendChild(el);
    });
  }

  function update(id, field, value) {
    var idx = state.expenses.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var next = Object.assign({}, state.expenses[idx]);

    if (field === 'inflation') {
      // Empty means "follow the default"; a number pins this expense.
      next.inflation = String(value).trim() === '' ? null : (parseFloat(value) || 0) / 100;
    } else {
      next[field] = value;
    }

    state.expenses[idx] = Expenses.normalize(next);
    commit();
  }

  /* ----------------------------------------------------------------- charts -- */

  function renderCategoryChart(p) {
    var rows = p.categories.map(function (c) {
      return {
        label: c.name,
        value: c.annual,
        share: p.baseAnnual > 0 ? c.annual / p.baseAnnual : 0,
        emphasis: true,
        hint: money(c.annual / 12) + ' a month'
      };
    });
    if (p.bufferAnnual > 0) {
      rows.push({
        label: 'Safety buffer',
        value: p.bufferAnnual,
        share: p.baseAnnual > 0 ? p.bufferAnnual / p.baseAnnual : 0,
        // Deliberately NOT emphasised: the buffer is padding, not spending, and
        // the lighter step says so — the same language the growth chart uses.
        hint: 'Padding on top, not real spending yet.'
      });
    }
    Charts.renderBreakdown($('chart-expense-categories'), rows,
      'Add an amount to an expense and its category will show here.');
    $('chart-expense-categories').setAttribute('aria-label',
      'Annual spending by category: ' + rows.map(function (r) {
        return r.label + ' ' + money(r.value);
      }).join(', ') + '.');
  }

  function renderBufferNote(p) {
    var note = $('ex-buffer-note');
    if (p.bufferPct > 0) {
      note.innerHTML = '<strong>Buffer on.</strong> Every expense total is padded by '
        + Math.round(p.bufferPct * 100) + '%, adding ' + money(p.bufferAnnual) + ' a year ('
        + money(p.bufferAnnual / 12) + ' a month). It reaches the Cash flow tab as its own '
        + '“Safety buffer” row, so you can always see what the padding costs and take it back off.';
    } else {
      note.innerHTML = '<strong>No buffer set.</strong> Budgets tend to be optimistic — '
        + 'a buffer pads every expense so a bad month does not break the plan. '
        + 'It shows as its own row on the Cash flow tab rather than being hidden inside each line.';
    }
  }

  /* ------------------------------------------------------------------ utils -- */

  function fmt(v) { return v ? Math.round(v).toLocaleString('en-US') : ''; }
  function pctVal(v) { return (v * 100).toFixed(1).replace(/\.0$/, ''); }
  function attr(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function numFrom(v) {
    var n = parseFloat(String(v || '').replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function commit() {
    save();
    render();
    if (window.CashFlowTab) window.CashFlowTab.refresh();
  }

  /* ------------------------------------------------------------------- init -- */

  function init() {
    if (!load()) state.expenses = defaults();

    $('ex-inflation').addEventListener('input', function () {
      state.defaultInflation = numFrom(this.value) / 100;
      commit();
    });
    $('ex-buffer').addEventListener('input', function () {
      state.bufferPct = numFrom(this.value) / 100;
      commit();
    });

    document.querySelectorAll('.ex-buffer-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.bufferPct = parseFloat(btn.dataset.pct) / 100;
        commit();
      });
    });

    $('ex-add').addEventListener('click', function () {
      state.expenses.push(Expenses.normalize({
        label: 'New expense',
        category: $('ex-add-category').value,
        cadence: 'monthly',
        amount: 0
      }));
      commit();
      var inputs = $('ex-list').querySelectorAll('.ex-row input[data-f="label"]');
      if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    });

    Expenses.CATEGORIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      $('ex-add-category').appendChild(o);
    });

    if (window.CashFlowTab) {
      window.CashFlowTab.registerSource('expenses', function () {
        return Expenses.ledgerRows(state, horizonYears());
      });
    }

    render();
  }

  window.ExpensesTab = {
    // The horizon lives on the Cash flow tab, so a change there reshapes these.
    onHorizonChange: function () { render(); },
    getProjection: function () { return Expenses.project(state, horizonYears()); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
