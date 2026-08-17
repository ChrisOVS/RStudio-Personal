/*
 * expenses.js — recurring expenses, inflation, and the safety buffer.
 *
 * This is where regular outgoings live: rent, food, transport, insurance. Each
 * one carries an amount at its own cadence and an inflation rate, and the whole
 * set is projected forward and handed to the cash flow ledger.
 *
 * Two ideas beyond a plain list:
 *
 * 1. INFLATION, per expense with a shared default. Rent and groceries rarely
 *    climb at the same rate, so each expense may override the default. An
 *    expense with `inflation: null` follows the default, which means changing
 *    the default moves everything that has not been pinned — the common case.
 *
 * 2. SAFETY BUFFER, a single percentage applied across the total. Budgets are
 *    optimistic; the buffer is the honest correction for that. It is emitted as
 *    its OWN ledger row rather than folded into each expense, so you can always
 *    see what the padding costs and take it back off. Silently inflating every
 *    line would make the numbers untraceable.
 *
 * Pure — no DOM. Loaded as a global in the browser, require()'d by the tests.
 */

(function (root, factory) {
  var mod = factory(
    typeof module === 'object' && module.exports ? require('./cashflow.js') : root.CashFlow
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Expenses = mod;
})(typeof self !== 'undefined' ? self : this, function (CashFlow) {
  'use strict';

  var BUFFER_ROW_ID = 'expenses_buffer';

  var CATEGORIES = [
    'Housing', 'Food', 'Transport', 'Insurance', 'Health',
    'Family', 'Lifestyle', 'Debt', 'Other'
  ];

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /** Fill in defaults and coerce types so the projection can trust an expense. */
  function normalize(exp) {
    var out = Object.assign({}, exp);
    out.id = out.id || ('exp_' + Math.random().toString(36).slice(2, 9));
    out.label = out.label || 'Untitled';
    out.category = out.category || 'Other';
    out.cadence = CashFlow.CADENCES[out.cadence] ? out.cadence : 'monthly';
    out.amount = Math.max(0, num(out.amount));
    out.startYear = out.startYear == null || out.startYear === '' ? null : num(out.startYear);
    out.endYear = out.endYear == null || out.endYear === '' ? null : num(out.endYear);
    // null is meaningful: it means "follow the default", which is not the same
    // as a pinned 0%. Only an explicit number counts as an override.
    out.inflation = (out.inflation === null || out.inflation === undefined || out.inflation === '')
      ? null
      : num(out.inflation);
    out.disabled = !!out.disabled;
    return out;
  }

  /** The rate this expense actually grows at. */
  function effectiveInflation(exp, defaultInflation) {
    return exp.inflation === null ? num(defaultInflation) : exp.inflation;
  }

  function usesDefault(exp) {
    return exp.inflation === null;
  }

  /** Annual cost in the first year, before inflation and before the buffer. */
  function annualAmount(exp) {
    return exp.amount * CashFlow.periodsPerYear(exp.cadence);
  }

  /** Annual cost in a given year, with this expense's own inflation applied. */
  function annualAmountInYear(exp, year, startYear, defaultInflation) {
    if (exp.disabled) return 0;
    var from = exp.startYear == null ? startYear : exp.startYear;
    if (year < from) return 0;
    if (exp.endYear != null && year > exp.endYear) return 0;
    var rate = effectiveInflation(exp, defaultInflation);
    return annualAmount(exp) * Math.pow(1 + rate, year - from);
  }

  /**
   * Project the whole expense set across `years`.
   *
   * `base` is what the expenses actually come to; `buffer` is the padding on
   * top; `total` is what the cash flow tab will subtract. Keeping the three
   * separate is the point — a single padded number would hide the assumption.
   */
  function project(state, years) {
    var list = (state.expenses || []).map(normalize);
    var defaultInflation = num(state.defaultInflation);
    var bufferPct = num(state.bufferPct);
    var startYear = years[0];

    var base = years.map(function (year) {
      return list.reduce(function (a, exp) {
        return a + annualAmountInYear(exp, year, startYear, defaultInflation);
      }, 0);
    });

    var buffer = base.map(function (v) { return v * bufferPct; });
    var total = base.map(function (v, i) { return v + buffer[i]; });

    // Per-category rollup for the first year, for the breakdown chart.
    var byCategory = {};
    list.forEach(function (exp) {
      if (exp.disabled) return;
      var v = annualAmountInYear(exp, startYear, startYear, defaultInflation);
      if (!v) return;
      byCategory[exp.category] = (byCategory[exp.category] || 0) + v;
    });
    var categories = Object.keys(byCategory)
      .map(function (name) { return { name: name, annual: byCategory[name] }; })
      .sort(function (a, b) { return b.annual - a.annual; });

    var perExpense = list.map(function (exp) {
      return {
        expense: exp,
        annual: annualAmountInYear(exp, startYear, startYear, defaultInflation),
        monthly: annualAmountInYear(exp, startYear, startYear, defaultInflation) / 12,
        inflation: effectiveInflation(exp, defaultInflation),
        usesDefault: usesDefault(exp),
        byYear: years.map(function (y) {
          return annualAmountInYear(exp, y, startYear, defaultInflation);
        })
      };
    });

    return {
      years: years,
      perExpense: perExpense,
      categories: categories,
      base: base,
      buffer: buffer,
      total: total,
      baseAnnual: base[0] || 0,
      bufferAnnual: buffer[0] || 0,
      totalAnnual: total[0] || 0,
      baseMonthly: (base[0] || 0) / 12,
      totalMonthly: (total[0] || 0) / 12,
      bufferPct: bufferPct,
      defaultInflation: defaultInflation,
      // How much the same basket costs by the end of the horizon.
      inflationMultiple: base[0] > 0 ? base[base.length - 1] / base[0] : 1
    };
  }

  /**
   * The rows this tab contributes to the cash flow ledger.
   *
   * Each expense becomes a transaction carrying its own inflation as `growth`,
   * so the ledger's carry-forward and escalation do the year-by-year work.
   *
   * The buffer is one extra row with an EXPLICIT amount per year. It cannot use
   * a single growth rate, because the expenses underneath it grow at different
   * rates and start and stop in different years — the buffer has to be
   * recomputed against the real total each year to stay a true percentage.
   */
  function ledgerRows(state, years) {
    var startYear = years[0];
    var defaultInflation = num(state.defaultInflation);
    var bufferPct = num(state.bufferPct);

    var rows = (state.expenses || [])
      .map(normalize)
      .filter(function (exp) { return !exp.disabled && exp.amount > 0; })
      .map(function (exp) {
        var from = exp.startYear == null ? startYear : exp.startYear;
        var amounts = {};
        amounts[from] = exp.amount;
        return {
          id: 'expense_' + exp.id,
          label: exp.label,
          group: exp.category,
          kind: 'expense',
          cadence: exp.cadence,
          startYear: from,
          endYear: exp.endYear,
          growth: effectiveInflation(exp, defaultInflation),
          amounts: amounts
        };
      });

    if (bufferPct > 0) {
      var p = project(state, years);
      var hasSpend = p.base.some(function (v) { return v > 0; });
      if (hasSpend) {
        var amounts = {};
        years.forEach(function (year, i) { amounts[year] = p.buffer[i]; });
        rows.push({
          id: BUFFER_ROW_ID,
          label: 'Safety buffer (' + Math.round(bufferPct * 100) + '%)',
          group: 'Buffer',
          kind: 'expense',
          cadence: 'annual',
          startYear: startYear,
          amounts: amounts
        });
      }
    }

    return rows;
  }

  return {
    CATEGORIES: CATEGORIES,
    BUFFER_ROW_ID: BUFFER_ROW_ID,
    normalize: normalize,
    effectiveInflation: effectiveInflation,
    usesDefault: usesDefault,
    annualAmount: annualAmount,
    annualAmountInYear: annualAmountInYear,
    project: project,
    ledgerRows: ledgerRows
  };
});
