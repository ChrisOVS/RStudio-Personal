/*
 * savings-ui.js — the Savings & investments tab.
 *
 * Owns your accounts and feeds the cash flow ledger with the contributions that
 * actually come out of take-home. The 401(k) row mirrors the Salary tab's
 * pre-tax field rather than asking for the figure again, so there is one place
 * to change it and no way for the two to disagree.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var money = Charts.money;

  var STORAGE_KEY = 'finance-app.savings.v1';
  var LINKED_401K_ID = 'linked_401k';

  var state = {
    accounts: [],
    employerMatch: 0
  };

  function defaults() {
    return [
      Savings.normalize({ id: 'acct_ira', type: 'ira', name: 'Roth IRA', annualContribution: 0, returnRate: 0.07 }),
      Savings.normalize({ id: 'acct_brokerage', type: 'brokerage', name: 'Brokerage', annualContribution: 0, returnRate: 0.07 })
    ];
  }

  /* ------------------------------------------------------------ persistence -- */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        // The linked 401(k) is derived from the Salary tab, so it is never stored.
        accounts: state.accounts.filter(function (a) { return a.id !== LINKED_401K_ID; }),
        employerMatch: state.employerMatch
      }));
    } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      state.accounts = (saved.accounts || []).map(Savings.normalize);
      state.employerMatch = saved.employerMatch || 0;
      return true;
    } catch (e) { return false; }
  }

  /* --------------------------------------------------------- linked account -- */

  /**
   * Rebuild the mirrored 401(k) row from the Salary tab. It always sits first
   * and is never editable here — its contribution is the Salary tab's pre-tax
   * field, and the employer match is the one thing this tab adds to it.
   */
  function syncLinked401k() {
    var amount = window.SalaryTab ? window.SalaryTab.getPayrollRetirement() : 0;
    state.accounts = state.accounts.filter(function (a) { return a.id !== LINKED_401K_ID; });

    if (amount > 0) {
      state.accounts.unshift(Savings.normalize({
        id: LINKED_401K_ID,
        type: 'retirement401k',
        name: '401(k) / 403(b)',
        annualContribution: amount,
        employerMatch: state.employerMatch,
        startingBalance: linkedStartingBalance,
        returnRate: linkedReturnRate,
        linkedToSalary: true
      }));
    }
  }

  // Held separately, since the linked account object is rebuilt each time.
  var linkedStartingBalance = 0;
  var linkedReturnRate = 0.07;

  /* ---------------------------------------------------------------- horizon -- */

  function horizonYears() {
    if (window.CashFlowTab) {
      var cf = window.CashFlowTab.getState();
      return CashFlow.yearRange(cf);
    }
    var y = new Date().getFullYear();
    return Array.from({ length: 20 }, function (_, i) { return y + i; });
  }

  /* ----------------------------------------------------------------- render -- */

  function render() {
    syncLinked401k();
    var years = horizonYears();
    var p = Savings.project(state.accounts, years);

    renderStats(p, years);
    renderAccounts(p);
    Charts.renderBalance($('chart-savings'), years, p.totalBalance, p.totalContributed);
    renderNote(p);
  }

  function renderStats(p, years) {
    $('sv-stat-total').textContent = money(p.totalBalance[p.totalBalance.length - 1] || 0);
    $('sv-stat-total-sub').textContent = 'projected by ' + years[years.length - 1];

    $('sv-stat-contrib').textContent = money(p.annualContributions + p.annualMatch);
    $('sv-stat-contrib-sub').textContent = p.annualMatch > 0
      ? money(p.annualContributions) + ' yours + ' + money(p.annualMatch) + ' employer match'
      : 'going in each year';

    $('sv-stat-growth').textContent = money(p.totalGrowth[p.totalGrowth.length - 1] || 0);
    $('sv-stat-growth-sub').textContent = 'growth on top of what you put in';

    $('sv-stat-takehome').textContent = money(p.annualFromTakeHome);
    $('sv-stat-takehome-sub').textContent = p.annualFromTakeHome > 0
      ? 'out of take-home — this shows on cash flow'
      : 'nothing coming out of take-home yet';
  }

  /* --------------------------------------------------------------- accounts -- */

  function renderAccounts(p) {
    var host = $('sv-accounts');
    host.innerHTML = '';

    p.perAccount.forEach(function (row) {
      var acc = row.account;
      var linked = acc.id === LINKED_401K_ID;
      var meta = Savings.ACCOUNT_TYPES[acc.type];

      var card = document.createElement('div');
      card.className = 'sv-account' + (linked ? ' is-linked' : '');

      card.innerHTML =
        '<div class="sv-account-head">' +
          (linked
            ? '<span class="sv-name">' + escapeHtml(acc.name) + '</span>'
              + '<span class="cf-badge">From the Salary tab</span>'
            : '<input type="text" class="sv-name-input" value="' + escapeAttr(acc.name) + '" data-f="name" aria-label="Account name">') +
          '<span class="sv-flag ' + (acc.fromPayroll ? 'is-payroll' : 'is-posttax') + '">' +
            (acc.fromPayroll ? 'Pre-tax payroll' : 'From take-home') +
          '</span>' +
          (linked ? '' : '<button type="button" class="cf-del sv-remove">Remove</button>') +
        '</div>' +
        '<div class="sv-account-grid">' +
          (linked
            ? '<label>Contribution <span class="hint">a year</span>' +
                '<input type="text" value="' + fmt(acc.annualContribution) + '" disabled title="Set on the Salary tab">' +
              '</label>'
            : '<label>Contribution <span class="hint">a year</span>' +
                '<input type="text" value="' + fmt(acc.annualContribution) + '" data-f="annualContribution" inputmode="decimal" placeholder="0">' +
              '</label>') +
          (acc.type === 'retirement401k'
            ? '<label>Employer match <span class="hint">a year</span>' +
                '<input type="text" value="' + fmt(acc.employerMatch) + '" data-f="employerMatch" inputmode="decimal" placeholder="0">' +
              '</label>'
            : '<label>Contribution growth <span class="hint">% a year</span>' +
                '<input type="number" step="0.5" value="' + pctVal(acc.contributionGrowth) + '" data-f="contributionGrowth">' +
              '</label>') +
          '<label>Balance today' +
            '<input type="text" value="' + fmt(acc.startingBalance) + '" data-f="startingBalance" inputmode="decimal" placeholder="0">' +
          '</label>' +
          '<label>Return <span class="hint">% a year</span>' +
            '<input type="number" step="0.5" value="' + pctVal(acc.returnRate) + '" data-f="returnRate">' +
          '</label>' +
        '</div>' +
        '<div class="sv-account-foot">' +
          '<span>' + escapeHtml(meta.note) + '</span>' +
          '<span class="sv-projected">' + money(row.endBalance) + ' projected</span>' +
        '</div>';

      card.querySelectorAll('[data-f]').forEach(function (field) {
        if (field.disabled) return;
        field.addEventListener('change', function () {
          updateAccount(acc.id, field.dataset.f, field.value);
        });
      });
      var del = card.querySelector('.sv-remove');
      if (del) {
        del.addEventListener('click', function () {
          state.accounts = state.accounts.filter(function (a) { return a.id !== acc.id; });
          commit();
        });
      }

      host.appendChild(card);
    });

    if (!p.perAccount.length) {
      host.innerHTML = '<p class="cf-empty">No accounts yet. Add one below, or set a 401(k) '
        + 'contribution on the Salary tab and it will appear here.</p>';
    }
  }

  function updateAccount(id, field, value) {
    var pct = (field === 'returnRate' || field === 'contributionGrowth');
    var parsed = pct ? (parseFloat(value) || 0) / 100 : value;

    if (id === LINKED_401K_ID) {
      // The linked row is rebuilt every render, so its edits are held outside it.
      if (field === 'employerMatch') state.employerMatch = parseFloat(String(value).replace(/[$,\s]/g, '')) || 0;
      if (field === 'startingBalance') linkedStartingBalance = parseFloat(String(value).replace(/[$,\s]/g, '')) || 0;
      if (field === 'returnRate') linkedReturnRate = parsed;
      commit();
      return;
    }

    var idx = state.accounts.findIndex(function (a) { return a.id === id; });
    if (idx < 0) return;
    var next = Object.assign({}, state.accounts[idx]);
    next[field] = parsed;
    state.accounts[idx] = Savings.normalize(next);
    commit();
  }

  function renderNote(p) {
    var note = $('sv-note');
    if (p.annualFromPayroll > 0) {
      note.innerHTML = '<strong>Payroll contributions stay off the cash flow table.</strong> '
        + money(p.annualFromPayroll) + ' a year comes out before you are paid, so your take-home '
        + 'already excludes it — showing it as an expense too would subtract the same money twice. '
        + 'It still builds the balance here.';
    } else {
      note.innerHTML = '<strong>How these reach cash flow.</strong> Money you invest out of '
        + 'take-home shows as an outflow on the Cash flow tab. Pre-tax payroll contributions do not, '
        + 'because take-home already excludes them.';
    }
  }

  /* ------------------------------------------------------------------ utils -- */

  function fmt(v) { return v ? Math.round(v).toLocaleString('en-US') : ''; }
  function pctVal(v) { return (v * 100).toFixed(1).replace(/\.0$/, ''); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /** Save, redraw, and push the new rows into the ledger. */
  function commit() {
    save();
    render();
    if (window.CashFlowTab) window.CashFlowTab.refresh();
  }

  /* ------------------------------------------------------------------- init -- */

  function init() {
    if (!load()) state.accounts = defaults();

    $('sv-add').addEventListener('click', function () {
      var type = $('sv-add-type').value;
      state.accounts.push(Savings.normalize({
        type: type,
        name: Savings.ACCOUNT_TYPES[type].label,
        annualContribution: 0,
        returnRate: type === 'cash' ? 0.02 : 0.07
      }));
      commit();
      var names = $('sv-accounts').querySelectorAll('.sv-name-input');
      if (names.length) { names[names.length - 1].focus(); names[names.length - 1].select(); }
    });

    var typeSel = $('sv-add-type');
    Object.keys(Savings.ACCOUNT_TYPES).forEach(function (t) {
      // The 401(k) is mirrored from the Salary tab, so it is not addable here.
      if (t === 'retirement401k') return;
      var o = document.createElement('option');
      o.value = t;
      o.textContent = Savings.ACCOUNT_TYPES[t].label;
      typeSel.appendChild(o);
    });

    if (window.CashFlowTab) {
      window.CashFlowTab.registerSource('savings', function () {
        var years = horizonYears();
        return Savings.ledgerRows(state.accounts, years[0]);
      });
    }

    render();
  }

  window.SavingsTab = {
    // Called when the Salary tab recomputes, so the mirrored 401(k) keeps up.
    onSalaryChange: function () { render(); },
    getProjection: function () { return Savings.project(state.accounts, horizonYears()); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
