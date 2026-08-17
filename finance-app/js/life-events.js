/*
 * life-events.js — one-off, lumpy money that lands in a particular year.
 *
 * A wedding, a car, a house deposit, a sabbatical, an inheritance. Unlike the
 * Expenses tab, these do not recur: each one belongs to a year (or a short run
 * of years) and then it is gone.
 *
 * Two things it does that a plain amount-in-a-year would not:
 *
 * 1. TODAY'S MONEY vs THEN'S MONEY. A $100k house deposit eight years out does
 *    not cost $100k when you get there. An event may be entered in today's money
 *    and inflated to its year, so you are budgeting the number you will actually
 *    have to find.
 *
 * 2. SPREADING. Some events are lumpy but not instantaneous — three years of
 *    tuition, two years of a lower salary. `spreadYears` repeats the amount for
 *    that many years from the event year.
 *
 * Pure — no DOM. Loaded as a global in the browser, require()'d by the tests.
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.LifeEvents = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CATEGORIES = [
    'Home', 'Family', 'Vehicle', 'Education', 'Travel',
    'Career', 'Windfall', 'Medical', 'Other'
  ];

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function normalize(ev) {
    var out = Object.assign({}, ev);
    out.id = out.id || ('evt_' + Math.random().toString(36).slice(2, 9));
    out.label = out.label || 'Untitled';
    out.category = CATEGORIES.indexOf(out.category) === -1 ? 'Other' : out.category;
    out.kind = out.kind === 'income' ? 'income' : 'expense';
    out.amount = Math.max(0, num(out.amount));
    out.year = out.year == null || out.year === '' ? null : Math.round(num(out.year));
    // At least one year, and capped so a typo cannot generate a thousand rows.
    out.spreadYears = Math.max(1, Math.min(40, Math.round(num(out.spreadYears) || 1)));
    out.inflate = !!out.inflate;
    out.inflationRate = num(out.inflationRate);
    out.disabled = !!out.disabled;
    return out;
  }

  /**
   * What the event actually costs in its own year.
   *
   * With `inflate` off, the amount is taken as already being in the money of the
   * year it lands in. With it on, the amount is today's money and is compounded
   * forward — which is the honest way to budget something years out.
   */
  function amountInEventYear(ev, baseYear) {
    if (ev.disabled || !ev.year) return 0;
    if (!ev.inflate) return ev.amount;
    var span = Math.max(0, ev.year - baseYear);
    return ev.amount * Math.pow(1 + ev.inflationRate, span);
  }

  /** The years this event touches. */
  function yearsTouched(ev) {
    if (!ev.year) return [];
    var out = [];
    for (var i = 0; i < ev.spreadYears; i++) out.push(ev.year + i);
    return out;
  }

  function isActiveIn(ev, year) {
    if (ev.disabled || !ev.year) return false;
    return year >= ev.year && year < ev.year + ev.spreadYears;
  }

  /** Signed amount in a given year — income positive, expenses negative. */
  function signedAmountInYear(ev, year, baseYear) {
    if (!isActiveIn(ev, year)) return 0;
    var v = amountInEventYear(ev, baseYear);
    return ev.kind === 'income' ? v : -v;
  }

  function project(state, years) {
    var list = (state.events || []).map(normalize);
    var baseYear = years[0];

    var byYear = years.map(function (year) {
      return list.reduce(function (a, ev) {
        return a + signedAmountInYear(ev, year, baseYear);
      }, 0);
    });

    var outflow = years.map(function (year) {
      return list.reduce(function (a, ev) {
        var v = signedAmountInYear(ev, year, baseYear);
        return a + (v < 0 ? -v : 0);
      }, 0);
    });
    var inflow = years.map(function (year) {
      return list.reduce(function (a, ev) {
        var v = signedAmountInYear(ev, year, baseYear);
        return a + (v > 0 ? v : 0);
      }, 0);
    });

    var perEvent = list.map(function (ev) {
      var each = amountInEventYear(ev, baseYear);
      return {
        event: ev,
        amountInYear: each,
        // What it costs across every year it touches.
        total: each * ev.spreadYears,
        // How much inflation added, so the assumption is visible.
        inflationUplift: ev.inflate ? each - ev.amount : 0,
        years: yearsTouched(ev),
        inHorizon: ev.year != null && ev.year <= years[years.length - 1]
      };
    }).sort(function (a, b) {
      return (a.event.year || 9999) - (b.event.year || 9999);
    });

    var totalOut = outflow.reduce(function (a, b) { return a + b; }, 0);
    var totalIn = inflow.reduce(function (a, b) { return a + b; }, 0);

    return {
      years: years,
      perEvent: perEvent,
      byYear: byYear,
      outflow: outflow,
      inflow: inflow,
      totalOut: totalOut,
      totalIn: totalIn,
      net: totalIn - totalOut,
      // The single worst year, which is the one that breaks a plan.
      biggestYear: (function () {
        var worst = null;
        years.forEach(function (y, i) {
          if (outflow[i] > 0 && (worst === null || outflow[i] > outflow[worst.i])) {
            worst = { i: i, year: y };
          }
        });
        return worst ? { year: worst.year, amount: outflow[worst.i] } : null;
      })()
    };
  }

  /**
   * Ledger rows. One transaction per event.
   *
   * Cadence is 'once' for a single year; a spread event becomes an annual row
   * bounded by startYear/endYear, which the ledger already knows how to run.
   */
  function ledgerRows(state, years) {
    var baseYear = years[0];
    return (state.events || [])
      .map(normalize)
      .filter(function (ev) { return !ev.disabled && ev.amount > 0 && ev.year; })
      .map(function (ev) {
        var amounts = {};
        amounts[ev.year] = amountInEventYear(ev, baseYear);
        return {
          id: 'event_' + ev.id,
          label: ev.label,
          group: 'Life events',
          kind: ev.kind,
          cadence: ev.spreadYears > 1 ? 'annual' : 'once',
          startYear: ev.year,
          endYear: ev.spreadYears > 1 ? ev.year + ev.spreadYears - 1 : null,
          amounts: amounts
        };
      });
  }

  return {
    CATEGORIES: CATEGORIES,
    normalize: normalize,
    amountInEventYear: amountInEventYear,
    signedAmountInYear: signedAmountInYear,
    isActiveIn: isActiveIn,
    yearsTouched: yearsTouched,
    project: project,
    ledgerRows: ledgerRows
  };
});
