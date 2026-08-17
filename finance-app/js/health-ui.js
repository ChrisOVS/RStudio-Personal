/*
 * health-ui.js — the Health tab, and the "your data" panel that lives on it.
 *
 * Reads what every other tab computed and reports back on it. This tab owns no
 * inputs of its own — if a number here looks wrong, it is wrong upstream.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var money = Charts.money;

  /* ------------------------------------------------------------- gathering -- */

  /** Pull one figure set out of the other tabs, tolerating any of them being empty. */
  function gather() {
    var out = {
      grossIncome: 0, takeHome: 0, annualExpenses: 0, housingAnnual: 0,
      savingsContributions: 0, liquidCash: 0, investedBalance: 0,
      netCashByYear: [], shortfallYear: null, effectiveTaxRate: 0, horizonYears: 20
    };

    try {
      if (window.SalaryTab && window.CashFlowTab) {
        var years = CashFlow.yearRange(window.CashFlowTab.getState());
        var pay = window.SalaryTab.getPayProjection(years);
        if (pay.rows.length) {
          out.grossIncome = pay.rows[0].gross;
          out.takeHome = pay.rows[0].takeHome;
          out.effectiveTaxRate = pay.rows[0].effectiveRate;
        }
        out.horizonYears = years.length;
      }
    } catch (e) { /* salary tab not ready */ }

    try {
      if (window.ExpensesTab) {
        var ex = window.ExpensesTab.getProjection();
        out.annualExpenses = ex.totalAnnual;
        var housing = ex.categories.filter(function (c) { return c.name === 'Housing'; })[0];
        out.housingAnnual = housing ? housing.annual : 0;
      }
    } catch (e) { /* expenses tab not ready */ }

    try {
      if (window.SavingsTab) {
        var sv = window.SavingsTab.getProjection();
        out.savingsContributions = (sv.contributionsByYear && sv.contributionsByYear[0]) || 0;
        out.investedBalance = sv.totalBalance[sv.totalBalance.length - 1] || 0;
      }
    } catch (e) { /* savings tab not ready */ }

    try {
      if (window.CashFlowTab) {
        var cf = window.CashFlowTab.getProjection();
        out.netCashByYear = cf.net;
        out.shortfallYear = cf.shortfallYear;
        // Cash on hand today, not the projected balance — an emergency fund is
        // what you could reach this afternoon.
        out.liquidCash = cf.openingBalance;
      }
    } catch (e) { /* cash flow not ready */ }

    return out;
  }

  /* ---------------------------------------------------------------- render -- */

  function render() {
    var data = gather();
    var a = Health.analyse(data);

    renderScore(a.score);
    renderMetrics(a.ranked);
    renderDataPanel();
  }

  function renderScore(s) {
    var dial = $('hl-score');
    dial.textContent = s.value === null ? '—' : s.value;
    dial.className = 'hl-score-value is-' + s.band;

    $('hl-score-label').textContent = s.label;
    $('hl-score-blurb').textContent = s.blurb;
    $('hl-score-counted').textContent = s.counted
      ? s.counted + ' metric' + (s.counted === 1 ? '' : 's') + ' scored'
      : '';

    // The ring is a second reading of the same number, so it never carries
    // meaning the figure beside it does not already state.
    var ring = $('hl-ring-fill');
    var C = 2 * Math.PI * 52;
    var frac = s.value === null ? 0 : Math.max(0, Math.min(1, s.value / 100));
    ring.setAttribute('stroke-dasharray', C.toFixed(1));
    ring.setAttribute('stroke-dashoffset', (C * (1 - frac)).toFixed(1));
    ring.setAttribute('class', 'hl-ring-fill is-' + s.band);
  }

  var STATUS_TEXT = {
    good: 'On track', ok: 'Fine', warn: 'Worth a look',
    bad: 'Needs attention', info: 'For context', unknown: 'No data yet'
  };

  function renderMetrics(list) {
    var host = $('hl-metrics');
    host.innerHTML = '';

    list.forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'hl-metric is-' + m.status;
      // Status is never colour alone: every card carries the words too.
      card.innerHTML =
        '<div class="hl-metric-top">' +
          '<span class="hl-metric-label">' + esc(m.label) + '</span>' +
          '<span class="hl-chip is-' + m.status + '">' + STATUS_TEXT[m.status] + '</span>' +
        '</div>' +
        '<div class="hl-metric-value">' + esc(m.display) + '</div>' +
        '<p class="hl-metric-headline">' + esc(m.headline) + '</p>' +
        (m.detail ? '<p class="hl-metric-detail">' + esc(m.detail) + '</p>' : '');
      host.appendChild(card);
    });
  }

  /* ------------------------------------------------------------ data panel -- */

  function renderDataPanel() {
    var s = Storage.summary();
    var status = $('hl-save-status');

    if (!s.available) {
      status.className = 'note is-warn';
      status.innerHTML = '<strong>This browser is blocking storage.</strong> Your figures will '
        + 'be lost when you close the tab. Use <em>Download a backup</em> before you go, '
        + 'or allow site data for this page.';
      return;
    }

    status.className = 'note is-good';
    status.innerHTML = s.sections
      ? '<strong>Saved automatically.</strong> ' + s.sections + ' section'
        + (s.sections === 1 ? '' : 's') + ' stored in this browser (' + fmtBytes(s.bytes)
        + '). Come back on this device and it will all still be here — nothing to press.'
      : '<strong>Nothing saved yet.</strong> Fill in any tab and it saves itself as you type.';
  }

  function fmtBytes(n) {
    return n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' bytes';
  }

  function flash(message, isError) {
    var el = $('hl-save-flash');
    el.textContent = message;
    el.className = 'hl-flash is-visible' + (isError ? ' is-error' : '');
    clearTimeout(flash.timer);
    flash.timer = setTimeout(function () { el.className = 'hl-flash'; }, 4000);
  }

  /* ------------------------------------------------------------------ init -- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    // A link carrying data wins over whatever is in this browser, since opening
    // one is an explicit act — but say so rather than silently swapping it.
    var incoming = Storage.fromLocation();
    if (incoming) {
      try {
        var n = Storage.apply(incoming);
        Storage.stripLocation();
        sessionStorage.setItem('finance-app.restored', String(n));
        location.reload();
        return;
      } catch (e) {
        Storage.stripLocation();
      }
    }

    try {
      var restored = sessionStorage.getItem('finance-app.restored');
      if (restored) {
        sessionStorage.removeItem('finance-app.restored');
        setTimeout(function () {
          flash('Restored ' + restored + ' section' + (restored === '1' ? '' : 's') + ' from your link.');
        }, 400);
      }
    } catch (e) { /* ignore */ }

    $('hl-download').addEventListener('click', downloadBackup);
    $('hl-copy-link').addEventListener('click', copyLink);
    $('hl-import').addEventListener('change', importFile);
    $('hl-clear').addEventListener('click', clearAll);

    render();
  }

  async function downloadBackup() {
    var payload = Storage.collect();
    if (!Object.keys(payload.data).length) {
      flash('Nothing to back up yet — fill in a tab first.', true);
      return;
    }
    var json = JSON.stringify(payload, null, 2);

    // The published page can hand the viewer a file only through the host, and
    // only if they accept. Everywhere else, fall back to an ordinary download.
    try {
      var downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (downloads) {
        await downloads.save({ filename: Storage.filename(), data: json });
        flash('Backup saved.');
        return;
      }
    } catch (err) {
      if (err && err.code === 'declined') return;          // they said no; not an error
      if (err && err.code === 'rate_limited') {
        flash('A save prompt is already open.', true);
        return;
      }
      // Anything else: fall through to the plain download below.
    }

    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = Storage.filename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash('Backup downloaded.');
    } catch (e) {
      flash('Could not save the file here. Try the link instead.', true);
    }
  }

  async function copyLink() {
    var payload = Storage.collect();
    if (!Object.keys(payload.data).length) {
      flash('Nothing to save yet — fill in a tab first.', true);
      return;
    }
    var link = Storage.toLink();

    try {
      await navigator.clipboard.writeText(link);
      flash('Link copied. Bookmark it, or mail it to yourself to open elsewhere.');
      return;
    } catch (e) { /* clipboard blocked — show it instead */ }

    var box = $('hl-link-box');
    box.value = link;
    box.hidden = false;
    box.focus();
    box.select();
    flash('Copy this link and keep it somewhere safe.');
  }

  function importFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var n = Storage.apply(JSON.parse(reader.result));
        sessionStorage.setItem('finance-app.restored', String(n));
        location.reload();
      } catch (err) {
        flash(err.message || 'That file could not be read.', true);
      }
    };
    reader.onerror = function () { flash('That file could not be read.', true); };
    reader.readAsText(file);
    e.target.value = '';   // let the same file be picked again
  }

  function clearAll() {
    if (!window.confirm('Erase every figure you have entered, on every tab? '
        + 'Download a backup first if you might want it back.')) return;
    Storage.clear();
    location.reload();
  }

  window.HealthTab = { refresh: render };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
