/*
 * health.js — financial health metrics.
 *
 * Reads what the other tabs already computed and turns it into a handful of
 * ratios with a verdict attached. Every threshold here is a widely used rule of
 * thumb, not a law, and each metric carries the reasoning so the number is never
 * just a colour.
 *
 * Each metric returns:
 *   value      the raw number
 *   display    how to show it
 *   status     'good' | 'ok' | 'warn' | 'bad' | 'unknown'
 *   headline   one line saying what it means for you
 *   detail     the rule of thumb being applied
 *
 * `unknown` is a first-class outcome. A metric with no data must say so rather
 * than score zero — a blank app should not report that your finances are broken.
 *
 * Pure — no DOM. Loaded as a global in the browser, require()'d by the tests.
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Health = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS_ORDER = { bad: 0, warn: 1, ok: 2, good: 3, unknown: 4 };

  function pct(n, d) { return (n * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function money(n) {
    var v = Math.round(n);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
  }

  /**
   * Grade a value against ascending or descending thresholds.
   * `higherIsBetter` flips the comparison so both directions share one path.
   */
  function grade(value, thresholds, higherIsBetter) {
    var t = thresholds;
    if (higherIsBetter) {
      if (value >= t.good) return 'good';
      if (value >= t.ok) return 'ok';
      if (value >= t.warn) return 'warn';
      return 'bad';
    }
    if (value <= t.good) return 'good';
    if (value <= t.ok) return 'ok';
    if (value <= t.warn) return 'warn';
    return 'bad';
  }

  /* ---------------------------------------------------------------- metrics */

  /**
   * @param {object} d
   *   grossIncome        annual gross pay
   *   takeHome           annual take-home
   *   annualExpenses     annual spending including any buffer
   *   housingAnnual      annual housing cost
   *   savingsContributions annual money into savings and investments
   *   liquidCash         cash on hand today
   *   investedBalance    projected investments at the horizon
   *   netCashByYear      net cash flow per year
   *   shortfallYear      first year cash runs out, or null
   *   effectiveTaxRate   share of gross going to tax
   *   horizonYears       how many years the projection covers
   */
  function metrics(d) {
    var out = [];
    var hasIncome = d.grossIncome > 0;
    var hasExpenses = d.annualExpenses > 0;

    /* Savings rate — the single most predictive number in personal finance. */
    out.push((function () {
      if (!hasIncome) return unknown('savings-rate', 'Savings rate',
        'Add your salary to see what share of it you keep.');
      var rate = d.savingsContributions / d.grossIncome;
      return {
        id: 'savings-rate',
        label: 'Savings rate',
        value: rate,
        display: pct(rate, 1),
        status: grade(rate, { good: 0.20, ok: 0.15, warn: 0.10 }, true),
        headline: money(d.savingsContributions) + ' of ' + money(d.grossIncome) + ' gross going into savings.',
        detail: 'The common target is 15–20% of gross. Below 10% leaves little room '
              + 'for a bad year; above 20% buys real optionality.',
        weight: 3
      };
    })());

    /* Emergency fund — how long you last with no income. */
    out.push((function () {
      if (!hasExpenses) return unknown('emergency-fund', 'Emergency fund',
        'Add your expenses to see how many months your cash covers.');
      var months = d.liquidCash / (d.annualExpenses / 12);
      return {
        id: 'emergency-fund',
        label: 'Emergency fund',
        value: months,
        display: months >= 100 ? '99+ mo' : months.toFixed(1) + ' mo',
        status: grade(months, { good: 6, ok: 3, warn: 1 }, true),
        headline: money(d.liquidCash) + ' of cash covers '
                + (months >= 100 ? 'over 99' : months.toFixed(1)) + ' months of spending.',
        detail: 'Three months is the usual floor and six is the usual target. '
              + 'This counts cash only — investments are not an emergency fund.',
        weight: 3
      };
    })());

    /* Expense ratio — how much of your take-home is already committed. */
    out.push((function () {
      if (!hasExpenses || !(d.takeHome > 0)) return unknown('expense-ratio', 'Spending vs take-home',
        'Add your salary and expenses to see how much of your pay is committed.');
      var ratio = d.annualExpenses / d.takeHome;
      return {
        id: 'expense-ratio',
        label: 'Spending vs take-home',
        value: ratio,
        display: pct(ratio, 0),
        status: grade(ratio, { good: 0.70, ok: 0.85, warn: 1.00 }, false),
        headline: pct(ratio, 0) + ' of your take-home is spoken for by regular spending.',
        detail: 'Under 70% leaves a real margin. Over 100% means you are spending '
              + 'more than you take home, and the gap has to come from somewhere.',
        weight: 3
      };
    })());

    /* Housing — the biggest line for most people, and the hardest to change. */
    out.push((function () {
      if (!hasIncome || !(d.housingAnnual > 0)) return unknown('housing', 'Housing cost',
        'Add a housing expense to see it as a share of your pay.');
      var ratio = d.housingAnnual / d.grossIncome;
      return {
        id: 'housing',
        label: 'Housing cost',
        value: ratio,
        display: pct(ratio, 0),
        status: grade(ratio, { good: 0.25, ok: 0.30, warn: 0.40 }, false),
        headline: money(d.housingAnnual / 12) + ' a month, ' + pct(ratio, 0) + ' of gross pay.',
        detail: 'The 30% rule is the usual ceiling. It is a guideline, not a rule — '
              + 'a high-cost city can justify more if the rest of your budget absorbs it.',
        weight: 2
      };
    })());

    /* Runway — does the plan actually survive the horizon? */
    out.push((function () {
      if (!d.netCashByYear || !d.netCashByYear.length) {
        return unknown('runway', 'Plan holds up', 'Fill in the other tabs to test the plan.');
      }
      var negativeYears = d.netCashByYear.filter(function (v) { return v < 0; }).length;
      var status = d.shortfallYear ? 'bad' : negativeYears > 0 ? 'warn' : 'good';
      return {
        id: 'runway',
        label: 'Plan holds up',
        value: d.shortfallYear ? 0 : 1,
        display: d.shortfallYear ? 'Runs out ' + d.shortfallYear
               : negativeYears > 0 ? negativeYears + ' tight year' + (negativeYears === 1 ? '' : 's')
               : 'Yes',
        status: status,
        headline: d.shortfallYear
          ? 'Your cash balance goes negative in ' + d.shortfallYear + '.'
          : negativeYears > 0
            ? negativeYears + ' year' + (negativeYears === 1 ? '' : 's') + ' spend more than they bring in, but the balance holds.'
            : 'Every year in the projection brings in more than it spends.',
        detail: 'A single negative year is survivable if you have the balance for it. '
              + 'A balance that hits zero is the one to fix.',
        weight: 3
      };
    })());

    /* Retirement — the 4% rule, stated as a rule of thumb rather than a promise. */
    out.push((function () {
      if (!hasExpenses || !(d.investedBalance > 0)) {
        return unknown('retirement', 'Retirement progress',
          'Add expenses and a savings balance to see how far along you are.');
      }
      var target = d.annualExpenses * 25;
      var progress = d.investedBalance / target;
      return {
        id: 'retirement',
        label: 'Retirement progress',
        value: progress,
        display: pct(Math.min(progress, 9.99), 0),
        status: grade(progress, { good: 1, ok: 0.5, warn: 0.2 }, true),
        headline: money(d.investedBalance) + ' projected against a ' + money(target) + ' target.',
        detail: 'The 4% rule puts a self-sustaining portfolio at roughly 25× your annual '
              + 'spending. This compares your projected balance to that, in today\'s spending terms.',
        weight: 2
      };
    })());

    /* Tax — informational, because it is mostly not a choice. */
    out.push((function () {
      if (!hasIncome) return unknown('tax', 'Effective tax rate',
        'Add your salary to see your overall tax rate.');
      return {
        id: 'tax',
        label: 'Effective tax rate',
        value: d.effectiveTaxRate,
        display: pct(d.effectiveTaxRate, 1),
        status: 'info',
        headline: pct(d.effectiveTaxRate, 1) + ' of gross pay goes to federal, state and FICA.',
        detail: 'Shown for context, not scored — most of this is not a choice. '
              + 'Pre-tax contributions are the main lever you control.',
        weight: 0
      };
    })());

    return out;
  }

  function unknown(id, label, headline) {
    return {
      id: id, label: label, value: null, display: '—', status: 'unknown',
      headline: headline, detail: '', weight: 0
    };
  }

  /**
   * A single 0–100 score.
   *
   * Only scored metrics count, and only those with data. A metric that cannot be
   * computed is left out of both the numerator and denominator rather than
   * scoring zero, so an empty app reports "not enough to say" instead of a
   * failing grade.
   */
  function score(list) {
    var points = { good: 100, ok: 72, warn: 45, bad: 15 };
    var total = 0, weight = 0;

    list.forEach(function (m) {
      if (!m.weight || points[m.status] === undefined) return;
      total += points[m.status] * m.weight;
      weight += m.weight;
    });

    if (!weight) {
      return { value: null, band: 'unknown', label: 'Not enough to say yet',
        counted: 0, blurb: 'Fill in the Salary and Expenses tabs and this fills in.' };
    }

    var value = Math.round(total / weight);
    var band = value >= 85 ? 'good' : value >= 65 ? 'ok' : value >= 45 ? 'warn' : 'bad';
    return {
      value: value,
      band: band,
      counted: list.filter(function (m) { return m.weight && m.status !== 'unknown'; }).length,
      label: { good: 'Strong', ok: 'Solid', warn: 'Some work to do', bad: 'Needs attention' }[band],
      blurb: {
        good: 'The fundamentals are in good shape. Keep the savings rate where it is.',
        ok: 'Broadly healthy, with one or two things worth tightening.',
        warn: 'The plan works but has little margin. Look at the amber items first.',
        bad: 'Several fundamentals need attention. Start with the red items.'
      }[band]
    };
  }

  /** Worst-first, so the thing to fix is at the top. Unknowns sink to the bottom. */
  function ranked(list) {
    return list.slice().sort(function (a, b) {
      var sa = STATUS_ORDER[a.status] === undefined ? 3.5 : STATUS_ORDER[a.status];
      var sb = STATUS_ORDER[b.status] === undefined ? 3.5 : STATUS_ORDER[b.status];
      if (sa !== sb) return sa - sb;
      return (b.weight || 0) - (a.weight || 0);
    });
  }

  function analyse(d) {
    var list = metrics(d);
    return { metrics: list, ranked: ranked(list), score: score(list) };
  }

  return {
    metrics: metrics,
    score: score,
    ranked: ranked,
    analyse: analyse,
    grade: grade
  };
});
