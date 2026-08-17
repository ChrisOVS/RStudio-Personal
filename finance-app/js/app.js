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
    var next = n > 0 ? n.toLocaleString('en-US') : '';
    // Writing an identical value still marks the field dirty and fires `change`
    // on blur, which would re-render for no reason. Only touch it if it differs.
    if ($(id).value !== next) $(id).value = next;
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
    renderPaySchedule();

    // Keep the last result where the cash flow source provider can read it, then
    // ask the ledger to rebuild so the income row tracks this salary.
    latestResult = r;
    // The Savings tab mirrors the 401(k) figure, so let it redraw before the
    // ledger rebuilds and picks up both tabs' rows in one pass.
    if (window.SavingsTab) window.SavingsTab.onSalaryChange();
    if (window.CashFlowTab) window.CashFlowTab.refresh();
  }

  var latestResult = null;

  /* ------------------------------------------------------------ pay schedule -- */

  var SCHEDULE_KEY = 'finance-app.payschedule.v1';

  var paySchedule = (function () {
    var schedule = { defaultRaise: 0.03, salaryByYear: {}, bonusByYear: {} };

    try {
      var raw = localStorage.getItem(SCHEDULE_KEY);
      if (raw) schedule = PaySchedule.normalize(JSON.parse(raw));
    } catch (e) { /* private mode or bad data — keep the default */ }

    function persist() {
      try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule)); } catch (e) { /* ignore */ }
    }

    /**
     * Run the schedule over `years`, taxing each year's pay properly. Every
     * other input (state, filing status, deductions) is held at its current
     * value — this models a pay path, not a life change.
     */
    function projectFor(years) {
      var input = readInputs();
      return PaySchedule.project(
        schedule, years, input.salary, input.bonus,
        function (salary, bonus) {
          return Calc.calculate({
            salary: salary,
            bonus: bonus,
            retirement: input.retirement,
            section125: input.section125,
            state: input.state,
            status: input.status
          });
        }
      );
    }

    return {
      get: function () { return schedule; },
      projectFor: projectFor,
      setRaise: function (rate) { schedule.defaultRaise = rate; persist(); },
      setPay: function (field, year, value) {
        schedule = PaySchedule.setPay(schedule, field, year, value);
        persist();
      },
      reset: function () {
        schedule = { defaultRaise: schedule.defaultRaise, salaryByYear: {}, bonusByYear: {} };
        persist();
      }
    };
  })();

  /**
   * The pay-path table: one row per year, salary and bonus editable.
   *
   * The first row is the Salary tab's own figures and is read-only here — there
   * is one place to say what you earn today. Later years show the projected
   * figure in muted ink until you type one, which pins it.
   */
  function renderPaySchedule() {
    var years = window.CashFlowTab
      ? CashFlow.yearRange(window.CashFlowTab.getState())
      : [new Date().getFullYear()];
    // The near term is what anyone can actually forecast; the rest is the raise.
    var shown = years.slice(0, Math.min(years.length, 10));
    var proj = paySchedule.projectFor(shown);

    if (document.activeElement !== $('pay-raise')) {
      $('pay-raise').value = (paySchedule.get().defaultRaise * 100).toFixed(1).replace(/\.0$/, '');
    }

    var body = $('pay-schedule-body');

    // Only rebuild the DOM when the SET OF YEARS changes. Re-creating the rows
    // on every render tore out whatever cell was focused — and because a blur
    // reformat fires a change event, that could happen in the middle of the
    // click that was trying to focus a cell, sending your keystrokes to the
    // field you just left. Structure is cached; values are written in place.
    var signature = shown.join(',');
    if (body.dataset.sig !== signature) {
      buildPayRows(body, proj);
      body.dataset.sig = signature;
    }
    updatePayRows(body, proj);

    var pinned = proj.pinnedYears.length;
    $('pay-summary').innerHTML = '<strong>'
      + money(proj.startGross) + ' → ' + money(proj.endGross)
      + '</strong> gross by ' + shown[shown.length - 1]
      + ' (' + proj.grossMultiple.toFixed(2) + '× today). '
      + (pinned
          ? pinned + ' year' + (pinned === 1 ? '' : 's') + ' pinned by hand; the rest grow at the default raise.'
          : 'Every year grows at the default raise. Type into any cell to pin a promotion.');
  }

  function buildPayRows(body, proj) {
    body.innerHTML = '';
    proj.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.dataset.year = row.year;
      if (row.isBaseYear) tr.className = 'is-base';

      tr.innerHTML = '<td class="pay-year"></td>'
        + payCell('salary', row)
        + payCell('bonus', row)
        + '<td class="pay-derived" data-out="gross"></td>'
        + '<td class="pay-derived" data-out="takeHome"></td>'
        + '<td class="pay-derived" data-out="rate"></td>';

      tr.querySelectorAll('input[data-field]').forEach(function (input) {
        input.addEventListener('change', function () {
          var raw = String(input.value).trim();
          paySchedule.setPay(input.dataset.field, Number(input.dataset.year),
            raw === '' ? null : raw.replace(/[$,\s]/g, ''));
          render();
        });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
      });

      body.appendChild(tr);
    });
  }

  function payCell(field, row) {
    if (row.isBaseYear) return '<td class="pay-derived" data-out="' + field + '"></td>';
    return '<td class="pay-cell" data-cell="' + field + '">'
      + '<input type="text" inputmode="decimal" data-field="' + field + '" data-year="' + row.year + '"'
      + ' aria-label="' + field + ' in ' + row.year + '">'
      + '</td>';
  }

  function updatePayRows(body, proj) {
    proj.rows.forEach(function (row, i) {
      var tr = body.children[i];
      if (!tr) return;

      tr.querySelector('.pay-year').innerHTML = row.year
        + (row.isBaseYear ? ' <span class="cf-badge">today</span>' : '');

      ['salary', 'bonus'].forEach(function (field) {
        var value = field === 'salary' ? row.salary : row.bonus;
        var pinned = field === 'salary' ? row.salaryPinned : row.bonusPinned;
        var cell = tr.querySelector('[data-cell="' + field + '"]');

        if (!cell) {
          // Base-year figures are read-only here: one place says what you earn today.
          tr.querySelector('[data-out="' + field + '"]').textContent = money(value);
          return;
        }
        cell.classList.toggle('is-pinned', !!pinned);
        var input = cell.querySelector('input');
        // Never overwrite the box someone is typing into.
        if (document.activeElement !== input) {
          input.value = Math.round(value).toLocaleString('en-US');
        }
        input.title = pinned
          ? 'Pinned. Clear the cell to go back to the default raise.'
          : 'Projected at the default raise. Type a figure to pin this year.';
      });

      tr.querySelector('[data-out="gross"]').textContent = money(row.gross);
      tr.querySelector('[data-out="takeHome"]').textContent = money(row.takeHome);
      tr.querySelector('[data-out="rate"]').textContent = pct(row.effectiveRate);
    });
  }



  /**
   * What this tab contributes to the cash flow ledger: net take-home pay, one
   * explicit figure per year, and nothing else.
   *
   * Take-home is ALREADY net of tax, the 401(k) deferral and health premiums.
   * An earlier version also pushed those deductions through as outflow rows,
   * which subtracted the same money twice and understated every year's net.
   *
   * Each year's take-home is computed by running the full tax model on that
   * year's pay, not by escalating year one's take-home. Tax is progressive, so a
   * raise does not lift take-home proportionally — a flat growth rate on the
   * net figure would quietly overstate every year after a promotion.
   */
  function cashFlowRows() {
    if (!latestResult || latestResult.gross <= 0) return [];
    var years = window.CashFlowTab
      ? CashFlow.yearRange(window.CashFlowTab.getState())
      : [new Date().getFullYear()];

    var proj = paySchedule.projectFor(years);
    var amounts = {};
    proj.rows.forEach(function (row) { amounts[row.year] = row.takeHome; });

    return [{
      id: 'salary_takehome',
      label: 'Net salary (take-home)',
      group: 'Income',
      kind: 'income',
      cadence: 'annual',
      startYear: years[0],
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
      paySchedule.reset();
      render();
    });

    $('pay-raise').addEventListener('input', function () {
      paySchedule.setRaise((parseFloat(this.value) || 0) / 100);
      render();
    });

    $('pay-clear').addEventListener('click', function () {
      paySchedule.reset();
      render();
    });

    $('tax-year').textContent = TaxData.TAX_YEAR;

    // Register before the first render, so the ledger picks up salary immediately.
    if (window.CashFlowTab) window.CashFlowTab.registerSource('salary', cashFlowRows);
    // Expose the payroll 401(k) so the Savings tab can mirror it rather than
    // asking for the same number twice.
    window.SalaryTab = {
      getPayrollRetirement: getPayrollRetirement,
      getPayProjection: function (years) { return paySchedule.projectFor(years); }
    };

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
