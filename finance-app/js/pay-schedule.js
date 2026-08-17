/*
 * pay-schedule.js — what you expect to earn in each future year.
 *
 * A salary is not one number held forever. There are raises most years and a
 * promotion in some. This holds a SPARSE map of year -> figure, with a default
 * raise filling the gaps, so you only type the years you actually have a view
 * on: "I'm on 145 now, I expect ~175 when I make senior in 2028."
 *
 * The carry-forward and re-anchoring rules are exactly the ledger's, and are
 * implemented by delegating to it rather than reimplementing — a year you typed
 * means precisely what it says, and the default raise only fills the gaps
 * between the years you pinned.
 *
 * Salary and bonus are tracked independently, because a promotion often changes
 * the bonus target by a different amount than the base.
 *
 * Pure — no DOM. Loaded as a global in the browser, require()'d by the tests.
 */

(function (root, factory) {
  var mod = factory(
    typeof module === 'object' && module.exports ? require('./cashflow.js') : root.CashFlow
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.PaySchedule = mod;
})(typeof self !== 'undefined' ? self : this, function (CashFlow) {
  'use strict';

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function normalize(schedule) {
    var out = {
      defaultRaise: num((schedule || {}).defaultRaise),
      salaryByYear: {},
      bonusByYear: {}
    };
    ['salaryByYear', 'bonusByYear'].forEach(function (key) {
      var src = (schedule || {})[key] || {};
      Object.keys(src).forEach(function (y) {
        var year = Number(y);
        if (isFinite(year)) out[key][year] = Math.max(0, num(src[y]));
      });
    });
    return out;
  }

  /**
   * Anchor the schedule to the figures on the Salary tab.
   *
   * The base salary and bonus are the year-one truth; the schedule only records
   * DEPARTURES from them. Writing them in here rather than storing them keeps a
   * single source for "what I earn today" — change the Salary tab and every
   * later year moves with it, unless you pinned that year.
   */
  function withBase(schedule, baseYear, baseSalary, baseBonus) {
    var s = normalize(schedule);
    var salary = Object.assign({}, s.salaryByYear);
    var bonus = Object.assign({}, s.bonusByYear);
    salary[baseYear] = num(baseSalary);
    bonus[baseYear] = num(baseBonus);
    return { defaultRaise: s.defaultRaise, salaryByYear: salary, bonusByYear: bonus };
  }

  /**
   * Pay for one year. Delegates to the ledger's carry-forward + growth, so the
   * two behave identically and only one implementation has to be right.
   */
  function payForYear(resolved, year) {
    return {
      salary: CashFlow.amountForYear({ amounts: resolved.salaryByYear, growth: resolved.defaultRaise }, year),
      bonus: CashFlow.amountForYear({ amounts: resolved.bonusByYear, growth: resolved.defaultRaise }, year)
    };
  }

  function isPinned(resolved, field, year) {
    var map = field === 'bonus' ? resolved.bonusByYear : resolved.salaryByYear;
    return Object.prototype.hasOwnProperty.call(map, year)
      || Object.prototype.hasOwnProperty.call(map, String(year));
  }

  /** Pin a year. `null` clears the pin so the year goes back to inheriting. */
  function setPay(schedule, field, year, value) {
    var s = normalize(schedule);
    var key = field === 'bonus' ? 'bonusByYear' : 'salaryByYear';
    var next = Object.assign({}, s);
    next[key] = Object.assign({}, s[key]);
    if (value === null || value === '' || value === undefined) delete next[key][year];
    else next[key][year] = Math.max(0, num(value));
    return next;
  }

  /**
   * The whole schedule across `years`, with each year's tax run through the
   * supplied calculator so take-home tracks the pay.
   *
   * `calculate` is injected rather than imported so this module stays testable
   * without the tax tables, and so the caller decides what else (state, filing
   * status, deductions) is held constant.
   */
  function project(schedule, years, baseSalary, baseBonus, calculate) {
    var resolved = withBase(schedule, years[0], baseSalary, baseBonus);

    var rows = years.map(function (year, i) {
      var pay = payForYear(resolved, year);
      var result = calculate ? calculate(pay.salary, pay.bonus, year) : null;
      // The base year is always in the map because withBase() puts it there, so
      // it is not a hand pin — reporting it as one would tell the user they had
      // pinned a year they never touched.
      var isBaseYear = i === 0;
      return {
        year: year,
        isBaseYear: isBaseYear,
        salary: pay.salary,
        bonus: pay.bonus,
        gross: pay.salary + pay.bonus,
        takeHome: result ? result.takeHome : 0,
        effectiveRate: result ? result.effectiveRate : 0,
        salaryPinned: !isBaseYear && isPinned(resolved, 'salary', year),
        bonusPinned: !isBaseYear && isPinned(resolved, 'bonus', year)
      };
    });

    var first = rows[0];
    var last = rows[rows.length - 1];

    return {
      years: years,
      rows: rows,
      resolved: resolved,
      startGross: first ? first.gross : 0,
      endGross: last ? last.gross : 0,
      grossMultiple: first && first.gross > 0 ? last.gross / first.gross : 1,
      totalTakeHome: rows.reduce(function (a, r) { return a + r.takeHome; }, 0),
      // Years the user pinned by hand, for the "your plan" summary.
      pinnedYears: rows.filter(function (r) { return r.salaryPinned || r.bonusPinned; })
        .map(function (r) { return r.year; })
    };
  }

  return {
    normalize: normalize,
    withBase: withBase,
    payForYear: payForYear,
    isPinned: isPinned,
    setPay: setPay,
    project: project
  };
});
