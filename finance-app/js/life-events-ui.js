/*
 * life-events-ui.js — the Life events tab.
 *
 * The lumpy stuff: a wedding, a car, a house deposit, an inheritance. Feeds the
 * cash flow ledger the same way the Expenses tab does, but each row lands in a
 * particular year rather than recurring forever.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var money = Charts.money;

  var STORAGE_KEY = 'finance-app.lifeevents.v1';

  var state = {
    events: [],
    defaultInflation: 0.03
  };

  function baseYear() {
    return horizonYears()[0];
  }

  function horizonYears() {
    if (window.CashFlowTab) return CashFlow.yearRange(window.CashFlowTab.getState());
    var y = new Date().getFullYear();
    return Array.from({ length: 20 }, function (_, i) { return y + i; });
  }

  function defaults() {
    var y = new Date().getFullYear();
    return [
      LifeEvents.normalize({ label: 'New car', category: 'Vehicle', amount: 0, year: y + 3,
        inflate: true, inflationRate: 0.03 }),
      LifeEvents.normalize({ label: 'House deposit', category: 'Home', amount: 0, year: y + 5,
        inflate: true, inflationRate: 0.03 })
    ];
  }

  /* ------------------------------------------------------------ persistence -- */

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      state.events = (saved.events || []).map(LifeEvents.normalize);
      state.defaultInflation = saved.defaultInflation == null ? 0.03 : saved.defaultInflation;
      return true;
    } catch (e) { return false; }
  }

  /* ----------------------------------------------------------------- render -- */

  function render() {
    var years = horizonYears();
    var p = LifeEvents.project(state, years);

    renderStats(p, years);
    renderList(p, years);
    Charts.renderNetFlow($('chart-events'), years, p.byYear);
  }

  function renderStats(p, years) {
    $('le-stat-total').textContent = money(p.totalOut);
    $('le-stat-total-sub').textContent = 'across ' + years[0] + '–' + years[years.length - 1];

    $('le-stat-biggest').textContent = p.biggestYear ? money(p.biggestYear.amount) : '—';
    $('le-stat-biggest-sub').textContent = p.biggestYear
      ? 'all landing in ' + p.biggestYear.year
      : 'no events planned yet';

    $('le-stat-in').textContent = money(p.totalIn);
    $('le-stat-in-sub').textContent = p.totalIn > 0 ? 'money coming in' : 'nothing coming in';

    var uplift = p.perEvent.reduce(function (a, r) { return a + r.inflationUplift * r.event.spreadYears; }, 0);
    $('le-stat-inflation').textContent = money(uplift);
    $('le-stat-inflation-sub').textContent = uplift > 0
      ? 'added by inflating to the event year'
      : 'no events set to inflate';
  }

  /* ------------------------------------------------------------------- list -- */

  function renderList(p, years) {
    var host = $('le-list');
    host.innerHTML = '';

    if (!p.perEvent.length) {
      host.innerHTML = '<p class="cf-empty">No life events yet. Add one below.</p>';
      return;
    }

    var lastYear = years[years.length - 1];

    p.perEvent.forEach(function (row) {
      var e = row.event;
      var el = document.createElement('div');
      el.className = 'le-row' + (row.inHorizon ? '' : ' is-outside');

      el.innerHTML =
        '<input type="text" value="' + attr(e.label) + '" data-f="label" aria-label="Event name">' +
        '<select data-f="category" aria-label="Category">' +
          LifeEvents.CATEGORIES.map(function (c) {
            return '<option value="' + c + '"' + (e.category === c ? ' selected' : '') + '>' + c + '</option>';
          }).join('') +
        '</select>' +
        '<select data-f="kind" aria-label="Direction">' +
          '<option value="expense"' + (e.kind === 'expense' ? ' selected' : '') + '>Money out</option>' +
          '<option value="income"' + (e.kind === 'income' ? ' selected' : '') + '>Money in</option>' +
        '</select>' +
        '<input type="number" value="' + (e.year || '') + '" data-f="year" min="1900" max="2200" aria-label="Year">' +
        '<div class="input-money le-amount">' +
          '<input type="text" value="' + fmt(e.amount) + '" data-f="amount" inputmode="decimal" placeholder="0" aria-label="Amount">' +
        '</div>' +
        '<input type="number" value="' + e.spreadYears + '" data-f="spreadYears" min="1" max="40" aria-label="Spread over how many years" title="How many years running it repeats for. 1 is a single year.">' +
        '<label class="le-infl-toggle" title="Treat the amount as today\'s money and inflate it to the event year.">' +
          '<input type="checkbox"' + (e.inflate ? ' checked' : '') + ' data-f="inflate">' +
          '<span>Inflate</span>' +
        '</label>' +
        '<span class="le-cost">' + money(row.amountInYear) +
          (row.inflationUplift > 0
            ? '<small>+' + money(row.inflationUplift) + ' infl.</small>'
            : (e.spreadYears > 1 ? '<small>×' + e.spreadYears + ' yrs</small>' : '')) +
        '</span>' +
        '<button type="button" class="cf-del le-del" aria-label="Remove ' + attr(e.label) + '">Remove</button>' +
        (row.inHorizon ? '' :
          '<span class="le-warn">Falls after ' + lastYear + ', so it is outside the cash flow horizon.</span>');

      el.querySelectorAll('[data-f]').forEach(function (field) {
        field.addEventListener('change', function () {
          update(e.id, field.dataset.f, field.type === 'checkbox' ? field.checked : field.value);
        });
      });
      el.querySelector('.le-del').addEventListener('click', function () {
        state.events = state.events.filter(function (x) { return x.id !== e.id; });
        commit();
      });

      host.appendChild(el);
    });
  }

  function update(id, field, value) {
    var idx = state.events.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var next = Object.assign({}, state.events[idx]);
    next[field] = value;
    // Turning inflation on adopts the tab default rather than silently using 0%.
    if (field === 'inflate' && value && !next.inflationRate) {
      next.inflationRate = state.defaultInflation;
    }
    state.events[idx] = LifeEvents.normalize(next);
    commit();
  }

  /* ------------------------------------------------------------------ utils -- */

  function fmt(v) { return v ? Math.round(v).toLocaleString('en-US') : ''; }
  function attr(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function commit() {
    save();
    render();
    if (window.CashFlowTab) window.CashFlowTab.refresh();
  }

  /* ------------------------------------------------------------------- init -- */

  function init() {
    if (!load()) state.events = defaults();

    $('le-inflation').value = (state.defaultInflation * 100).toFixed(1).replace(/\.0$/, '');
    $('le-inflation').addEventListener('input', function () {
      state.defaultInflation = (parseFloat(this.value) || 0) / 100;
      // Events already set to inflate follow the tab default, so moving it
      // moves them — otherwise the control would only affect future rows.
      state.events = state.events.map(function (e) {
        return e.inflate ? LifeEvents.normalize(Object.assign({}, e, { inflationRate: state.defaultInflation })) : e;
      });
      commit();
    });

    $('le-add').addEventListener('click', function () {
      state.events.push(LifeEvents.normalize({
        label: 'New event',
        category: $('le-add-category').value,
        kind: 'expense',
        amount: 0,
        year: baseYear() + 2,
        inflate: true,
        inflationRate: state.defaultInflation
      }));
      commit();
      var inputs = $('le-list').querySelectorAll('.le-row input[data-f="label"]');
      if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    });

    LifeEvents.CATEGORIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      $('le-add-category').appendChild(o);
    });

    if (window.CashFlowTab) {
      window.CashFlowTab.registerSource('lifeEvent', function () {
        return LifeEvents.ledgerRows(state, horizonYears());
      });
    }

    render();
  }

  window.LifeEventsTab = {
    onHorizonChange: function () { render(); },
    getProjection: function () { return LifeEvents.project(state, horizonYears()); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
