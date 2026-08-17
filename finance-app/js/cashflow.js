/*
 * cashflow.js — the shared ledger every tab reads from and writes into.
 *
 * The model is a list of TRANSACTIONS projected forward over a horizon of
 * years. Rows are transactions, columns are years.
 *
 *   Salary tab       -> income lines (take-home, by year)
 *   Expenses tab     -> recurring outflow lines
 *   Life events tab  -> one-off outflow lines in specific years
 *   Savings tab      -> reads the projected net flow and balance
 *
 * Two rules carry most of the weight:
 *
 * 1. CARRY-FORWARD. `amounts` is sparse, keyed by year. A year with no entry
 *    inherits the most recent earlier year that has one. Set rent to $2,400 in
 *    2026 and it stays $2,400 every year after until you set a different value
 *    in, say, 2031. This is what makes the table cheap to maintain: you only
 *    type the years that change.
 *
 * 2. DERIVED vs MANUAL. Lines contributed by another tab carry a `source` and
 *    are regenerated from that tab on every refresh — editing them by hand
 *    would be silently overwritten, so they are locked. Only `source: 'manual'`
 *    lines are hand-editable and persisted.
 *
 * Amounts are entered at the transaction's own cadence: a monthly line holds a
 * PER-MONTH figure and the engine multiplies up. That keeps entry natural
 * ("rent is 2,400 a month") without storing a pre-multiplied number that goes
 * stale if the cadence changes.
 *
 * Pure — no DOM. Loaded as a global in the browser, require()'d by the tests.
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.CashFlow = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** How many times a cadence is paid in a year. */
  var CADENCES = {
    weekly: { label: 'Weekly', periods: 52 },
    biweekly: { label: 'Bi-weekly', periods: 26 },
    semimonthly: { label: 'Semi-monthly', periods: 24 },
    monthly: { label: 'Monthly', periods: 12 },
    quarterly: { label: 'Quarterly', periods: 4 },
    annual: { label: 'Annual', periods: 1 },
    once: { label: 'One-off', periods: 1 }
  };

  var SOURCES = {
    manual: 'Added here',
    salary: 'Salary tab',
    expenses: 'Expenses tab',
    lifeEvent: 'Life events tab',
    savings: 'Savings tab'
  };

  function periodsPerYear(cadence) {
    return (CADENCES[cadence] || CADENCES.monthly).periods;
  }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /** Integer years present in a sparse `amounts` map, ascending. */
  function explicitYears(tx) {
    return Object.keys(tx.amounts || {})
      .map(Number)
      .filter(function (y) { return isFinite(y); })
      .sort(function (a, b) { return a - b; });
  }

  /**
   * The per-period amount for a given year, applying the carry-forward rule.
   *
   * Looks for the most recent explicit year at or before `year`. If there is
   * none (the year sits before the first entry), the earliest explicit entry
   * applies — a transaction is never silently zero inside its own active span.
   *
   * `growth`, if set, compounds from whichever entry was used up to `year`, and
   * re-anchors whenever a later explicit entry takes over. So an explicit value
   * always means exactly what it says, and growth only fills the gaps.
   */
  function amountForYear(tx, year) {
    var years = explicitYears(tx);
    if (!years.length) return 0;

    var anchor = null;
    for (var i = 0; i < years.length; i++) {
      if (years[i] <= year) anchor = years[i];
      else break;
    }
    if (anchor === null) anchor = years[0];

    var base = num(tx.amounts[anchor]);
    var growth = num(tx.growth);
    if (!growth || year <= anchor) return base;
    return base * Math.pow(1 + growth, year - anchor);
  }

  /** Is this transaction live in `year`? */
  function isActiveIn(tx, year) {
    if (tx.cadence === 'once') return year === num(tx.startYear);
    if (tx.startYear != null && year < num(tx.startYear)) return false;
    if (tx.endYear != null && tx.endYear !== '' && year > num(tx.endYear)) return false;
    return true;
  }

  /**
   * Signed annual total for a year. Income is positive, expenses negative, so
   * everything downstream can just add.
   */
  function annualAmountForYear(tx, year) {
    if (!isActiveIn(tx, year)) return 0;
    var amount = amountForYear(tx, year) * periodsPerYear(tx.cadence);
    return tx.kind === 'income' ? amount : -Math.abs(amount);
  }

  /* --------------------------------------------------------------- projection */

  function yearRange(state) {
    var start = num(state.startYear) || new Date().getFullYear();
    // Distinguish "not provided" from an explicit 0: a bare `|| 10` would turn a
    // deliberate 0 into the default horizon instead of clamping it to 1.
    var raw = state.horizonYears;
    var span = (raw == null || raw === '') ? 10 : Math.round(num(raw));
    span = Math.max(1, Math.min(60, span));
    var years = [];
    for (var i = 0; i < span; i++) years.push(start + i);
    return years;
  }

  /**
   * Expand the ledger into the year-by-year table.
   *
   * Returns the per-line rows, the group rollups, income/expense/net totals,
   * and two running balances:
   *
   *   cumulativeNet — net flow added up, no growth. "What did I put aside?"
   *   balance       — the same, compounded at `annualReturn`. This is what the
   *                   savings and investments tab reads.
   *
   * Growth is applied to the OPENING balance for the year and to half of that
   * year's net flow, since contributions arrive spread across the year rather
   * than all on 1 January. Compounding the full year's contribution would
   * overstate returns by roughly half a year every year.
   */
  function project(state) {
    var years = yearRange(state);
    var txs = (state.transactions || []).filter(function (t) { return t && !t.disabled; });
    var rate = num(state.annualReturn);

    var lines = txs.map(function (tx) {
      var byYear = years.map(function (y) { return annualAmountForYear(tx, y); });
      return {
        tx: tx,
        byYear: byYear,
        total: byYear.reduce(function (a, b) { return a + b; }, 0)
      };
    });

    // Group rollup, preserving first-seen order so the table doesn't reshuffle.
    var groupOrder = [];
    var groupMap = {};
    lines.forEach(function (line) {
      var name = line.tx.group || 'Ungrouped';
      if (!groupMap[name]) {
        groupMap[name] = {
          name: name,
          kind: line.tx.kind,
          lines: [],
          byYear: years.map(function () { return 0; })
        };
        groupOrder.push(name);
      }
      var g = groupMap[name];
      // A group holding both income and expense lines is reported as mixed.
      if (g.kind !== line.tx.kind) g.kind = 'mixed';
      g.lines.push(line);
      line.byYear.forEach(function (v, i) { g.byYear[i] += v; });
    });
    var groups = groupOrder.map(function (n) {
      var g = groupMap[n];
      g.total = g.byYear.reduce(function (a, b) { return a + b; }, 0);
      return g;
    });

    var income = years.map(function () { return 0; });
    var expenses = years.map(function () { return 0; });
    lines.forEach(function (line) {
      line.byYear.forEach(function (v, i) {
        if (v >= 0) income[i] += v; else expenses[i] += v;
      });
    });
    var net = years.map(function (_, i) { return income[i] + expenses[i]; });

    // Money moved into savings and investments is NOT spent — it is still yours,
    // just no longer liquid. `net` answers "how much cash is left over"; adding
    // the contributions back answers "how much better off am I this year", which
    // is the number that actually reflects progress. The caller supplies the
    // per-year figures because the Savings tab owns them, and payroll
    // contributions never passed through this table at all.
    var addBack = state.savingsAddBack || [];
    var savingsAddBack = years.map(function (_, i) { return num(addBack[i]); });
    var netWithSavings = net.map(function (v, i) { return v + savingsAddBack[i]; });

    var openingBalance = num(state.openingBalance);
    var cumulativeNet = [];
    var balance = [];
    var growthEarned = [];
    var runningNet = openingBalance;
    var runningBal = openingBalance;

    for (var i = 0; i < years.length; i++) {
      runningNet += net[i];
      cumulativeNet.push(runningNet);

      var earned = rate * (runningBal + net[i] / 2);
      growthEarned.push(earned);
      runningBal = runningBal + net[i] + earned;
      balance.push(runningBal);
    }

    return {
      years: years,
      lines: lines,
      groups: groups,
      income: income,
      expenses: expenses,
      net: net,
      savingsAddBack: savingsAddBack,
      netWithSavings: netWithSavings,
      cumulativeNet: cumulativeNet,
      balance: balance,
      growthEarned: growthEarned,
      openingBalance: openingBalance,
      // Year the balance first goes negative — the thing you actually want to know.
      shortfallYear: (function () {
        for (var j = 0; j < balance.length; j++) if (balance[j] < 0) return years[j];
        return null;
      })()
    };
  }

  /* ------------------------------------------------------------------ sources */

  /**
   * Other tabs register a provider here instead of writing rows directly. On
   * refresh, every provider is re-run and its lines replace the previous batch
   * from that source — so a salary change can never leave a stale row behind.
   */
  function createRegistry() {
    var providers = {};

    return {
      register: function (source, fn) { providers[source] = fn; },
      unregister: function (source) { delete providers[source]; },
      sources: function () { return Object.keys(providers); },

      /**
       * Manual rows are kept as-is; every derived row is rebuilt. Returns a new
       * transaction list, so callers can diff or discard it.
       */
      rebuild: function (transactions) {
        var manual = (transactions || []).filter(function (t) {
          return !t.source || t.source === 'manual';
        });
        var derived = [];
        Object.keys(providers).forEach(function (source) {
          var produced;
          try {
            produced = providers[source]() || [];
          } catch (e) {
            produced = [];
          }
          produced.forEach(function (tx, i) {
            derived.push(normalize(Object.assign({}, tx, {
              source: source,
              locked: true,
              id: tx.id || (source + '_' + i)
            })));
          });
        });
        return manual.concat(derived);
      }
    };
  }

  /**
   * Lay per-year overrides on top of rows that came from another tab.
   *
   * Rows fed in by the Expenses or Salary tab are rebuilt on every refresh, so a
   * plain edit to one would vanish. An override is stored separately, keyed by
   * transaction and year, and re-applied after each rebuild — which is what
   * makes it possible to nudge a single year by hand without unhooking the row
   * from the tab that owns it.
   *
   * `overriddenYears` is set so the table can mark those cells and offer to put
   * them back.
   */
  function applyOverrides(transactions, overrides) {
    if (!overrides) return transactions;
    return transactions.map(function (tx) {
      var forTx = overrides[tx.id];
      if (!forTx) return tx;

      var years = Object.keys(forTx).filter(function (y) { return isFinite(Number(y)); });
      if (!years.length) return tx;

      var next = Object.assign({}, tx, { amounts: Object.assign({}, tx.amounts) });
      next.overriddenYears = {};
      years.forEach(function (y) {
        next.amounts[Number(y)] = num(forTx[y]);
        next.overriddenYears[Number(y)] = true;
      });
      return next;
    });
  }

  function isOverridden(tx, year) {
    return !!(tx.overriddenYears && tx.overriddenYears[Number(year)]);
  }

  /* ------------------------------------------------------------------- helpers */

  var nextId = 1;

  /** Fill in defaults and coerce types, so the rest of the engine can trust a row. */
  function normalize(tx) {
    var out = Object.assign({}, tx);
    out.id = out.id || ('tx_' + (nextId++) + '_' + Math.random().toString(36).slice(2, 7));
    out.label = out.label || 'Untitled';
    out.group = out.group || 'Ungrouped';
    out.kind = out.kind === 'income' ? 'income' : 'expense';
    out.cadence = CADENCES[out.cadence] ? out.cadence : 'monthly';
    out.source = out.source || 'manual';
    out.locked = !!out.locked;
    out.disabled = !!out.disabled;
    out.growth = num(out.growth);
    out.startYear = out.startYear == null ? null : num(out.startYear);
    out.endYear = (out.endYear == null || out.endYear === '') ? null : num(out.endYear);

    var amounts = {};
    Object.keys(out.amounts || {}).forEach(function (y) {
      var year = Number(y);
      if (isFinite(year)) amounts[year] = num(out.amounts[y]);
    });
    out.amounts = amounts;
    return out;
  }

  /**
   * Set the amount for one year. This is the edit the table makes when you type
   * in a cell: it writes an explicit entry for that year only, and every later
   * year carries it forward until the next explicit entry.
   */
  function setAmount(tx, year, value) {
    var out = Object.assign({}, tx, { amounts: Object.assign({}, tx.amounts) });
    out.amounts[Number(year)] = num(value);
    return out;
  }

  /**
   * Drop the explicit entry for a year, so it reverts to inheriting the prior
   * year. Refuses to clear the only remaining entry, which would zero the row.
   */
  function clearAmount(tx, year) {
    var years = explicitYears(tx);
    if (years.length <= 1) return tx;
    var out = Object.assign({}, tx, { amounts: Object.assign({}, tx.amounts) });
    delete out.amounts[Number(year)];
    return out;
  }

  /** Is this year's figure typed in, or inherited from an earlier year? */
  function isExplicit(tx, year) {
    return Object.prototype.hasOwnProperty.call(tx.amounts || {}, String(year))
      || Object.prototype.hasOwnProperty.call(tx.amounts || {}, Number(year));
  }

  return {
    CADENCES: CADENCES,
    SOURCES: SOURCES,
    periodsPerYear: periodsPerYear,
    amountForYear: amountForYear,
    annualAmountForYear: annualAmountForYear,
    isActiveIn: isActiveIn,
    isExplicit: isExplicit,
    explicitYears: explicitYears,
    yearRange: yearRange,
    project: project,
    createRegistry: createRegistry,
    normalize: normalize,
    setAmount: setAmount,
    clearAmount: clearAmount,
    applyOverrides: applyOverrides,
    isOverridden: isOverridden
  };
});
