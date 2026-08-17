/*
 * savings.js — savings and investment accounts, and how they reach the ledger.
 *
 * The distinction this module exists to get right is WHERE a contribution comes
 * from, because it decides whether the money is already spoken for:
 *
 *   fromPayroll  — 401(k), 403(b), payroll HSA. Deducted before you are paid, so
 *                  take-home ALREADY excludes it. It must NOT appear as an
 *                  outflow on the cash flow tab: take-home is the income line
 *                  there, and subtracting the contribution again would count it
 *                  twice. It still builds the balance.
 *
 *   from take-home — IRA, brokerage, cash savings. Paid out of money you have
 *                  already received, so it IS a real outflow on the cash flow
 *                  tab as well as building the balance.
 *
 * Employer match builds the balance and is never a cash outflow — it is not
 * your money leaving, it is money arriving.
 *
 * Pure — no DOM. Loaded as a global in the browser, require()'d by the tests.
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Savings = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ACCOUNT_TYPES = {
    retirement401k: { label: '401(k) / 403(b)', fromPayroll: true, note: 'Pre-tax, straight off your paycheck' },
    hsa: { label: 'HSA (payroll)', fromPayroll: true, note: 'Pre-tax, straight off your paycheck' },
    ira: { label: 'IRA / Roth IRA', fromPayroll: false, note: 'Paid out of your take-home' },
    brokerage: { label: 'Brokerage', fromPayroll: false, note: 'Paid out of your take-home' },
    cash: { label: 'Cash savings', fromPayroll: false, note: 'Paid out of your take-home' }
  };

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /** Fill in defaults and coerce types so the projection can trust an account. */
  function normalize(acc) {
    var out = Object.assign({}, acc);
    var type = ACCOUNT_TYPES[out.type] ? out.type : 'brokerage';
    out.id = out.id || ('acct_' + Math.random().toString(36).slice(2, 9));
    out.type = type;
    out.name = out.name || ACCOUNT_TYPES[type].label;
    out.startingBalance = Math.max(0, num(out.startingBalance));
    out.annualContribution = Math.max(0, num(out.annualContribution));
    out.employerMatch = Math.max(0, num(out.employerMatch));
    out.returnRate = num(out.returnRate);
    out.contributionGrowth = num(out.contributionGrowth);
    // Where the money comes from is a property of the account TYPE, not a free
    // choice — letting it be set independently would make double-counting a
    // one-click mistake.
    out.fromPayroll = ACCOUNT_TYPES[type].fromPayroll;
    // A payroll account's contribution is owned by the Salary tab's pre-tax
    // field; this flag marks the rows the UI should show as read-only.
    out.linkedToSalary = !!out.linkedToSalary;
    return out;
  }

  function contributionForYear(acc, index) {
    var g = acc.contributionGrowth;
    return acc.annualContribution * (g ? Math.pow(1 + g, index) : 1);
  }

  function matchForYear(acc, index) {
    var g = acc.contributionGrowth;
    return acc.employerMatch * (g ? Math.pow(1 + g, index) : 1);
  }

  /**
   * Project every account across `years`.
   *
   * Growth credits the opening balance plus HALF the year's additions, matching
   * the cash flow tab: contributions arrive spread across the year, so crediting
   * a full year of return on them would overstate the balance by roughly half a
   * year's growth, compounding every year.
   */
  function project(accounts, years) {
    var list = (accounts || []).map(normalize);
    var n = years.length;

    var perAccount = list.map(function (acc) {
      var balances = [];
      var contributions = [];
      var running = acc.startingBalance;
      var contributedToDate = acc.startingBalance;

      for (var i = 0; i < n; i++) {
        var put = contributionForYear(acc, i);
        var match = matchForYear(acc, i);
        var added = put + match;
        var earned = acc.returnRate * (running + added / 2);
        running = running + added + earned;
        contributedToDate += added;
        balances.push(running);
        contributions.push(contributedToDate);
      }

      return {
        account: acc,
        balances: balances,
        contributions: contributions,
        endBalance: balances[n - 1] || acc.startingBalance,
        endContributed: contributions[n - 1] || acc.startingBalance
      };
    });

    function sum(pick) {
      return years.map(function (_, i) {
        return perAccount.reduce(function (a, p) { return a + pick(p, i); }, 0);
      });
    }

    var totalBalance = sum(function (p, i) { return p.balances[i]; });
    var totalContributed = sum(function (p, i) { return p.contributions[i]; });

    // Per-year, not cumulative: what the cash flow tab adds back so its bottom
    // line can show money retained rather than only money left liquid. The
    // employer match is tracked separately and deliberately NOT added back —
    // it is not your money passing through your hands.
    var contributionsByYear = years.map(function (_, i) {
      return list.reduce(function (a, acc) { return a + contributionForYear(acc, i); }, 0);
    });
    var matchByYear = years.map(function (_, i) {
      return list.reduce(function (a, acc) { return a + matchForYear(acc, i); }, 0);
    });

    return {
      years: years,
      perAccount: perAccount,
      totalBalance: totalBalance,
      totalContributed: totalContributed,
      contributionsByYear: contributionsByYear,
      matchByYear: matchByYear,
      totalGrowth: years.map(function (_, i) { return totalBalance[i] - totalContributed[i]; }),
      startingBalance: list.reduce(function (a, x) { return a + x.startingBalance; }, 0),
      annualContributions: list.reduce(function (a, x) { return a + x.annualContribution; }, 0),
      annualMatch: list.reduce(function (a, x) { return a + x.employerMatch; }, 0),
      // Only the post-tax share competes with the rest of your spending.
      annualFromTakeHome: list.reduce(function (a, x) {
        return a + (x.fromPayroll ? 0 : x.annualContribution);
      }, 0),
      annualFromPayroll: list.reduce(function (a, x) {
        return a + (x.fromPayroll ? x.annualContribution : 0);
      }, 0)
    };
  }

  /**
   * The rows this tab contributes to the cash flow ledger.
   *
   * ONLY post-tax accounts. Payroll accounts are deliberately absent: take-home
   * is already net of them, so a row here would subtract the same money twice.
   */
  function ledgerRows(accounts, startYear) {
    return (accounts || [])
      .map(normalize)
      .filter(function (acc) { return !acc.fromPayroll && acc.annualContribution > 0; })
      .map(function (acc) {
        var amounts = {};
        amounts[startYear] = acc.annualContribution;
        return {
          id: 'savings_' + acc.id,
          label: acc.name,
          group: 'Savings & investments',
          kind: 'expense',
          cadence: 'annual',
          startYear: startYear,
          growth: acc.contributionGrowth,
          amounts: amounts
        };
      });
  }

  return {
    ACCOUNT_TYPES: ACCOUNT_TYPES,
    normalize: normalize,
    project: project,
    ledgerRows: ledgerRows,
    contributionForYear: contributionForYear
  };
});
