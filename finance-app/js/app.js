/*
 * app.js — UI wiring for the salary tab: read inputs, run the engine, draw.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var money = Charts.money;
  var pct = Charts.pct;

  var STORAGE_KEY = 'finance-app.salary.v1';
  var THEME_KEY = 'finance-app.theme';

  var DEFAULTS = {
    salary: 95000,
    bonus: 0,
    retirement: 0,
    section125: 0,
    state: 'CT',
    status: 'single',
    frequency: 'biweekly'
  };

  /* ------------------------------------------------------------ populate -- */

  function populateSelects() {
    var stateSel = $('state');
    var codes = Object.keys(TaxData.STATES).sort(function (a, b) {
      return TaxData.STATES[a].name.localeCompare(TaxData.STATES[b].name);
    });
    codes.forEach(function (code) {
      var o = document.createElement('option');
      o.value = code;
      o.textContent = TaxData.STATES[code].name + ' (' + code + ')';
      stateSel.appendChild(o);
    });

    TaxData.FILING_STATUSES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.label;
      $('status').appendChild(o);
    });

    TaxData.PAY_FREQUENCIES.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.label;
      $('frequency').appendChild(o);
    });
  }

  /* --------------------------------------------------------------- state -- */

  function readInputs() {
    return {
      salary: numFromField('salary'),
      bonus: numFromField('bonus'),
      retirement: numFromField('retirement'),
      section125: numFromField('section125'),
      state: $('state').value,
      status: $('status').value,
      frequency: $('frequency').value
    };
  }

  function numFromField(id) {
    var raw = String($(id).value || '').replace(/[$,\s]/g, '');
    var n = parseFloat(raw);
    return isFinite(n) && n > 0 ? n : 0;
  }

  var MONEY_FIELDS = ['salary', 'bonus', 'retirement', 'section125'];

  /** Add thousands separators. Done on blur, not while typing, so the caret
   *  never jumps around mid-entry. */
  function formatMoneyField(id) {
    var n = numFromField(id);
    $(id).value = n > 0 ? n.toLocaleString('en-US') : '';
  }

  function writeInputs(v) {
    $('salary').value = v.salary ? Number(v.salary).toLocaleString('en-US') : '';
    $('bonus').value = v.bonus ? Number(v.bonus).toLocaleString('en-US') : '';
    $('retirement').value = v.retirement ? Number(v.retirement).toLocaleString('en-US') : '';
    $('section125').value = v.section125 ? Number(v.section125).toLocaleString('en-US') : '';
    $('state').value = TaxData.STATES[v.state] ? v.state : 'CT';
    $('status').value = v.status || 'single';
    $('frequency').value = v.frequency || 'biweekly';
  }

  function save(v) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* fall through */ }
    return Object.assign({}, DEFAULTS);
  }

  /* -------------------------------------------------------------- render -- */

  function render() {
    var input = readInputs();
    save(input);

    var r = Calc.calculate(input);
    var freq = TaxData.PAY_FREQUENCIES.filter(function (f) { return f.id === input.frequency; })[0]
      || TaxData.PAY_FREQUENCIES[1];
    var per = Calc.perPeriod(r, freq.periods);

    renderStats(r, per, freq);
    renderBreakdownChart(r);
    renderBracketChart(r);
    renderRateChart(input, r);
    renderTables(r, per, freq);
    renderStateNote(r);

    // Keep the last result where the cash flow source provider can read it, then
    // ask the ledger to rebuild so the income row tracks this salary.
    latestResult = r;
    // The Savings tab mirrors the 401(k) figure, so let it redraw before the
    // ledger rebuilds and picks up both tabs' rows in one pass.
    if (window.SavingsTab) window.SavingsTab.onSalaryChange();
    if (window.CashFlowTab) window.CashFlowTab.refresh();
  }

  var latestResult = null;

  /**
   * What this tab contributes to the cash flow ledger: net take-home pay, and
   * nothing else.
   *
   * Take-home is ALREADY net of tax, the 401(k) deferral and health premiums.
   * An earlier version also pushed those deductions through as outflow rows,
   * which subtracted the same money twice and understated every year's net.
   * Payroll deductions belong to the tabs that own them — the Savings tab shows
   * the 401(k) building a balance without ever touching cash flow.
   */
  function cashFlowRows() {
    if (!latestResult || latestResult.gross <= 0) return [];
    var year = window.CashFlowTab
      ? window.CashFlowTab.getState().startYear
      : new Date().getFullYear();

    var amounts = {};
    amounts[year] = latestResult.takeHome;

    return [{
      id: 'salary_takehome',
      label: 'Net salary (take-home)',
      group: 'Income',
      kind: 'income',
      cadence: 'annual',
      startYear: year,
      amounts: amounts
    }];
  }

  /** The Savings tab reads the 401(k) figure from here rather than duplicating it. */
  function getPayrollRetirement() {
    return latestResult ? latestResult.retirement : 0;
  }

  function renderStats(r, per, freq) {
    $('stat-takehome').textContent = money(per.takeHome);
    $('stat-takehome-sub').textContent = freq.label.toLowerCase() + ' · ' + freq.note;

    $('stat-gross-period').textContent = money(per.gross);
    $('stat-gross-period-sub').textContent = 'gross ' + freq.label.toLowerCase() + ', before anything comes out';

    $('stat-annual').textContent = money(r.takeHome);
    $('stat-annual-sub').textContent = 'from ' + money(r.gross) + ' gross';

    $('stat-effective').textContent = pct(r.effectiveRate);
    $('stat-effective-sub').textContent = money(r.totalTax) + ' total tax';

    $('stat-marginal').textContent = pct(r.combinedMarginalRate);
    $('stat-marginal-sub').textContent = 'kept from the next $1,000: '
      + money(1000 * (1 - r.combinedMarginalRate));
  }

  function renderBreakdownChart(r) {
    var rows = [
      { label: 'Take-home pay', value: r.takeHome, emphasis: true,
        hint: 'What actually lands in your account.' },
      { label: 'Federal income tax', value: r.federalTax,
        hint: 'Top bracket ' + pct(r.federalMarginalRate, 0) + '.' },
      { label: 'FICA', value: r.fica.total,
        hint: 'Social Security ' + money(r.fica.socialSecurity) + ' + Medicare ' + money(r.fica.medicare + r.fica.additionalMedicare) + '.' }
    ];

    var stateTotal = r.stateTax + r.statePayrollTotal;
    rows.push({
      label: r.stateCode ? r.stateCode + ' state tax' : 'State tax',
      value: stateTotal,
      hint: stateTotal === 0 ? r.stateName + ' has no income tax on wages.' : r.stateName
    });

    rows.push({
      label: 'Pre-tax deductions', value: r.preTaxTotal,
      hint: 'Still your money — it goes to retirement and benefits, not the government.'
    });

    rows.forEach(function (row) { row.share = r.gross > 0 ? row.value / r.gross : 0; });
    Charts.renderBreakdown($('chart-breakdown'), rows);
    $('chart-breakdown').setAttribute('aria-label',
      'Where your ' + money(r.gross) + ' of gross pay goes: take-home ' + money(r.takeHome)
      + ', federal tax ' + money(r.federalTax) + ', FICA ' + money(r.fica.total)
      + ', state tax ' + money(stateTotal) + ', pre-tax deductions ' + money(r.preTaxTotal) + '.');
  }

  function renderBracketChart(r) {
    Charts.renderBrackets($('chart-brackets'), r.federalBrackets, r.federalMarginalRate);
    $('bracket-caption').textContent = r.federalTaxableIncome > 0
      ? 'Federal taxable income ' + money(r.federalTaxableIncome)
        + ' (gross minus pre-tax deductions minus the ' + money(r.federalStandardDeduction) + ' standard deduction).'
      : 'Your income after deductions falls below the standard deduction, so no federal income tax is due.';
  }

  function renderRateChart(input, r) {
    var maxSalary = Math.max(250000, Math.ceil((r.gross * 1.8) / 50000) * 50000);
    var curve = Calc.rateCurve(input, maxSalary, 44);
    Charts.renderRateCurve($('chart-rates'), curve, input.salary, r.effectiveRate);
    $('chart-rates').setAttribute('aria-label',
      'Effective and marginal tax rate as salary rises to ' + money(maxSalary)
      + '. At your salary the effective rate is ' + pct(r.effectiveRate)
      + ' and the marginal rate is ' + pct(r.combinedMarginalRate) + '.');
  }

  function renderTables(r, per, freq) {
    // Full annual/per-period breakdown.
    var rows = [
      ['Gross pay', r.gross, per.gross, ''],
      ['Pre-tax deductions', -r.preTaxTotal, -per.preTax, 'retirement + benefits'],
      ['Federal income tax', -r.federalTax, -per.federalTax, 'top bracket ' + pct(r.federalMarginalRate, 0)],
      ['Social Security', -r.fica.socialSecurity, -r.fica.socialSecurity / freq.periods,
        '6.2% up to ' + money(TaxData.FICA.socialSecurityWageBase)],
      ['Medicare', -(r.fica.medicare + r.fica.additionalMedicare),
        -(r.fica.medicare + r.fica.additionalMedicare) / freq.periods,
        r.fica.additionalMedicare > 0 ? '1.45% + 0.9% surtax' : '1.45%']
    ];

    if (r.stateCode && r.stateTax > 0) {
      rows.push([r.stateName + ' income tax', -r.stateTax, -r.stateTax / freq.periods, '']);
    } else if (r.stateCode) {
      rows.push([r.stateName + ' income tax', 0, 0, 'no income tax on wages']);
    }

    r.statePayroll.forEach(function (p) {
      rows.push([p.label, -p.amount, -p.amount / freq.periods, 'state payroll withholding']);
    });

    var tbody = $('tbl-breakdown');
    tbody.innerHTML = '';
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + row[0] + '</td>'
        + '<td>' + signed(row[1]) + '</td>'
        + '<td>' + signed(row[2]) + '</td>'
        + '<td class="dim">' + (row[3] || '') + '</td>';
      tbody.appendChild(tr);
    });
    var total = document.createElement('tr');
    total.className = 'is-total';
    total.innerHTML = '<td>Take-home pay</td>'
      + '<td>' + money(r.takeHome) + '</td>'
      + '<td>' + money(per.takeHome) + '</td>'
      + '<td class="dim">' + pct(r.takeHomeRate) + ' of gross</td>';
    tbody.appendChild(total);

    $('tbl-breakdown-head').textContent = 'Per ' + freq.label.toLowerCase() + ' period';

    // Take-home at every cadence.
    var freqBody = $('tbl-frequency');
    freqBody.innerHTML = '';
    Calc.allFrequencies(r).forEach(function (f) {
      var tr = document.createElement('tr');
      if (f.id === freq.id) tr.className = 'is-highlight';
      tr.innerHTML = '<td>' + f.label + '</td>'
        + '<td>' + money(f.gross) + '</td>'
        + '<td>' + money(f.takeHome) + '</td>'
        + '<td class="dim">' + f.note + '</td>';
      freqBody.appendChild(tr);
    });

    // Table view twin for the bracket chart.
    var brBody = $('tbl-brackets');
    brBody.innerHTML = '';
    var filled = r.federalBrackets.filter(function (b) { return b.incomeInBracket > 0; });
    if (!filled.length) {
      brBody.innerHTML = '<tr><td colspan="4" class="dim">No federal income tax at this income.</td></tr>';
    } else {
      filled.forEach(function (b) {
        var tr = document.createElement('tr');
        if (Math.abs(b.rate - r.federalMarginalRate) < 1e-9) tr.className = 'is-highlight';
        tr.innerHTML = '<td>' + pct(b.rate, 0) + '</td>'
          + '<td>' + money(b.from) + ' – ' + (b.to === Infinity ? 'up' : money(b.to)) + '</td>'
          + '<td>' + money(b.incomeInBracket) + '</td>'
          + '<td>' + money(b.tax) + '</td>';
        brBody.appendChild(tr);
      });
    }
  }

  function signed(n) {
    if (Math.abs(n) < 0.5) return money(0);
    return n < 0 ? '−' + money(-n) : money(n);
  }

  function renderStateNote(r) {
    var cap = $('deferral-note');
    if (r.deferralCapped) {
      cap.innerHTML = '<strong>Retirement contribution capped.</strong> You cannot defer more than '
        + money(r.gross - r.section125 - r.fica.total)
        + ' — Social Security and Medicare come out of your pay first and cannot be deferred. '
        + 'The figures below use the capped amount.';
      cap.hidden = false;
    } else {
      cap.hidden = true;
    }

    var box = $('state-note');
    if (!r.stateCode) { box.hidden = true; return; }
    var parts = [];
    parts.push('<strong>' + r.stateName + '</strong> ');
    parts.push(r.stateNotes || 'Standard bracket calculation.');
    if (r.stateConfidence === 'indexed') {
      parts.push(' <em>Bracket thresholds for this state are inflation-projected for 2026 rather than taken from a published table — the rates are right, the cut-offs may be off by a little.</em>');
    }
    box.innerHTML = parts.join('');
    box.hidden = false;
  }

  /* ---------------------------------------------------------------- tabs -- */

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
      tab.addEventListener('keydown', function (e) {
        var i = tabs.indexOf(tab);
        var next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
        if (next >= 0 && next < tabs.length) {
          e.preventDefault();
          tabs[next].focus();
          selectTab(tabs[next].dataset.tab);
        }
      });
    });
  }

  function selectTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.tab === name));
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.hidden = p.dataset.panel !== name;
    });
    Charts.hideTip();
  }

  /* --------------------------------------------------------------- theme -- */

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
    updateThemeLabel();

    $('theme-toggle').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      if (!current) {
        current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      updateThemeLabel();
    });
  }

  function updateThemeLabel() {
    var t = document.documentElement.getAttribute('data-theme');
    var isDark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    $('theme-toggle').textContent = isDark ? 'Light mode' : 'Dark mode';
  }

  /* ----------------------------------------------------------------- init -- */

  function init() {
    populateSelects();
    writeInputs(load());
    initTabs();
    initTheme();

    ['salary', 'bonus', 'retirement', 'section125', 'state', 'status', 'frequency']
      .forEach(function (id) {
        $(id).addEventListener('input', render);
        $(id).addEventListener('change', render);
      });

    MONEY_FIELDS.forEach(function (id) {
      $(id).addEventListener('blur', function () { formatMoneyField(id); });
    });

    $('reset').addEventListener('click', function () {
      writeInputs(DEFAULTS);
      render();
    });

    $('tax-year').textContent = TaxData.TAX_YEAR;

    // Register before the first render, so the ledger picks up salary immediately.
    if (window.CashFlowTab) window.CashFlowTab.registerSource('salary', cashFlowRows);
    // Expose the payroll 401(k) so the Savings tab can mirror it rather than
    // asking for the same number twice.
    window.SalaryTab = { getPayrollRetirement: getPayrollRetirement };

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
