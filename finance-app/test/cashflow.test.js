/*
 * Tests for the cash flow ledger. Run with: node test/cashflow.test.js
 *
 * The carry-forward rule gets the most coverage — it is the rule the whole
 * table leans on, and the one most likely to be got subtly wrong.
 */

var CF = require('../js/cashflow.js');

var passed = 0, failed = 0;

function suite(name) { console.log('\n' + name); }

function near(actual, expected, tol, label) {
  report(Math.abs(actual - expected) <= (tol === undefined ? 0.01 : tol), label, expected, actual);
}
function eq(actual, expected, label) { report(actual === expected, label, expected, actual); }
function deep(actual, expected, label) {
  report(JSON.stringify(actual) === JSON.stringify(expected), label,
    JSON.stringify(expected), JSON.stringify(actual));
}
function ok(cond, label) { report(!!cond, label, true, !!cond); }

function report(pass, label, expected, actual) {
  if (pass) { passed++; console.log('  ✓ ' + label); }
  else {
    failed++;
    console.log('  ✗ ' + label);
    console.log('      expected: ' + expected);
    console.log('      actual:   ' + actual);
  }
}

function tx(over) {
  return CF.normalize(Object.assign({
    label: 'Test', group: 'G', kind: 'expense', cadence: 'monthly',
    startYear: 2026, amounts: { 2026: 100 }
  }, over));
}

/* ------------------------------------------------------- carry-forward rule -- */

suite('Carry-forward — a year with no entry inherits the prior one');

var rent = tx({ amounts: { 2026: 2400, 2031: 2900 } });

near(CF.amountForYear(rent, 2026), 2400, 0.01, '2026 uses its own explicit value');
near(CF.amountForYear(rent, 2027), 2400, 0.01, '2027 inherits 2026');
near(CF.amountForYear(rent, 2030), 2400, 0.01, '2030 still inherits 2026');
near(CF.amountForYear(rent, 2031), 2900, 0.01, '2031 takes its own explicit value');
near(CF.amountForYear(rent, 2045), 2900, 0.01, 'later years inherit the newest entry, not the oldest');

// A year before the first entry falls back to the earliest, rather than zero —
// otherwise a row would read as free inside its own active span.
near(CF.amountForYear(tx({ amounts: { 2030: 500 } }), 2026), 500, 0.01,
  'a year before the first entry uses the earliest entry');

near(CF.amountForYear(tx({ amounts: {} }), 2026), 0, 0.01, 'a row with no entries is zero');

eq(CF.isExplicit(rent, 2031), true, '2031 is flagged as typed in');
eq(CF.isExplicit(rent, 2032), false, '2032 is flagged as inherited');

suite('Editing a cell writes one explicit year and leaves the rest inheriting');

var edited = CF.setAmount(rent, 2028, 2600);
near(CF.amountForYear(edited, 2027), 2400, 0.01, 'the year before the edit is untouched');
near(CF.amountForYear(edited, 2028), 2600, 0.01, 'the edited year takes the new value');
near(CF.amountForYear(edited, 2029), 2600, 0.01, 'the following year inherits the edit');
near(CF.amountForYear(edited, 2031), 2900, 0.01, 'a later explicit entry still wins');
near(CF.amountForYear(rent, 2028), 2400, 0.01, 'the original row is not mutated');

var cleared = CF.clearAmount(edited, 2028);
near(CF.amountForYear(cleared, 2028), 2400, 0.01, 'clearing a year reverts it to inheriting');
deep(CF.explicitYears(CF.clearAmount(tx({ amounts: { 2026: 100 } }), 2026)), [2026],
  'clearing the only entry is refused, so a row cannot be zeroed by accident');

suite('Growth fills the gaps between explicit years and re-anchors on each');

var grow = tx({ amounts: { 2026: 1000, 2029: 1500 }, growth: 0.10 });
near(CF.amountForYear(grow, 2026), 1000, 0.01, 'an explicit year means exactly what it says');
near(CF.amountForYear(grow, 2027), 1100, 0.01, 'the next year compounds once');
near(CF.amountForYear(grow, 2028), 1210, 0.01, 'and twice the year after');
near(CF.amountForYear(grow, 2029), 1500, 0.01, 'an explicit entry overrides the compounded value');
near(CF.amountForYear(grow, 2030), 1650, 0.01, 'growth re-anchors on the new explicit entry');

/* --------------------------------------------------------------- cadence ---- */

suite('Cadence scales the per-period figure up to a year');

near(CF.annualAmountForYear(tx({ cadence: 'monthly', amounts: { 2026: 100 } }), 2026), -1200, 0.01,
  'monthly x 12');
near(CF.annualAmountForYear(tx({ cadence: 'weekly', amounts: { 2026: 100 } }), 2026), -5200, 0.01,
  'weekly x 52');
near(CF.annualAmountForYear(tx({ cadence: 'biweekly', amounts: { 2026: 100 } }), 2026), -2600, 0.01,
  'bi-weekly x 26');
near(CF.annualAmountForYear(tx({ cadence: 'quarterly', amounts: { 2026: 100 } }), 2026), -400, 0.01,
  'quarterly x 4');
near(CF.annualAmountForYear(tx({ cadence: 'annual', amounts: { 2026: 100 } }), 2026), -100, 0.01,
  'annual x 1');

near(CF.annualAmountForYear(tx({ kind: 'income', amounts: { 2026: 100 } }), 2026), 1200, 0.01,
  'income is positive');
near(CF.annualAmountForYear(tx({ kind: 'expense', amounts: { 2026: -100 } }), 2026), -1200, 0.01,
  'an expense entered as a negative is still an outflow, not a double negative');

/* ----------------------------------------------------------------- span ----- */

suite('Start year, end year and one-offs');

var span = tx({ startYear: 2028, endYear: 2030, amounts: { 2028: 100 } });
eq(CF.isActiveIn(span, 2027), false, 'not active before the start year');
eq(CF.isActiveIn(span, 2028), true, 'active in the start year');
eq(CF.isActiveIn(span, 2030), true, 'active in the end year');
eq(CF.isActiveIn(span, 2031), false, 'not active after the end year');
near(CF.annualAmountForYear(span, 2031), 0, 0.01, 'an inactive year contributes nothing');

var wedding = tx({ cadence: 'once', startYear: 2029, amounts: { 2029: 30000 } });
near(CF.annualAmountForYear(wedding, 2029), -30000, 0.01, 'a one-off lands in its year');
near(CF.annualAmountForYear(wedding, 2030), 0, 0.01, 'and does not repeat');
near(CF.annualAmountForYear(wedding, 2028), 0, 0.01, 'nor arrive early');

var openEnded = tx({ startYear: 2026, endYear: null, amounts: { 2026: 100 } });
eq(CF.isActiveIn(openEnded, 2099), true, 'no end year means it runs to the horizon');

/* ------------------------------------------------------------ projection ---- */

suite('Projection — the year-by-year table');

var state = {
  startYear: 2026,
  horizonYears: 5,
  openingBalance: 10000,
  annualReturn: 0,
  transactions: [
    CF.normalize({ label: 'Take-home', group: 'Income', kind: 'income', cadence: 'monthly',
      startYear: 2026, amounts: { 2026: 6000 }, source: 'salary' }),
    CF.normalize({ label: 'Rent', group: 'Housing', kind: 'expense', cadence: 'monthly',
      startYear: 2026, amounts: { 2026: 2400 } }),
    CF.normalize({ label: 'Groceries', group: 'Living', kind: 'expense', cadence: 'monthly',
      startYear: 2026, amounts: { 2026: 600 } })
  ]
};

var p = CF.project(state);

deep(p.years, [2026, 2027, 2028, 2029, 2030], 'five year columns from the start year');
near(p.income[0], 72000, 0.01, 'income 6,000 x 12 = 72,000');
near(p.expenses[0], -36000, 0.01, 'expenses (2,400 + 600) x 12 = -36,000');
near(p.net[0], 36000, 0.01, 'net 36,000');
near(p.net[4], 36000, 0.01, 'carry-forward keeps every later year identical');

eq(p.groups.length, 3, 'three groups');
eq(p.groups[0].name, 'Income', 'group order follows first appearance');
near(p.groups[1].byYear[0], -28800, 0.01, 'the Housing group rolls up its lines');
near(p.groups[1].total, -144000, 0.01, 'and totals across all five years');

// Every line's yearly figures must add up to the reported totals.
var lineSum = p.lines.reduce(function (a, l) { return a + l.byYear[0]; }, 0);
near(lineSum, p.net[0], 0.01, 'the lines reconcile to the net for the year');
var groupSum = p.groups.reduce(function (a, g) { return a + g.byYear[2]; }, 0);
near(groupSum, p.net[2], 0.01, 'the groups reconcile to the net too');

near(p.cumulativeNet[0], 46000, 0.01, 'cumulative starts from the opening balance');
near(p.cumulativeNet[4], 10000 + 36000 * 5, 0.01, 'and adds each year');
near(p.balance[4], p.cumulativeNet[4], 0.01, 'with a 0% return, balance equals cumulative net');

suite('Investment growth — what the savings tab reads');

var invested = CF.project(Object.assign({}, state, { annualReturn: 0.06 }));
// Year 1: 6% on the opening 10,000 plus half the 36,000 contributed = 600 + 1,080 = 1,680
near(invested.growthEarned[0], 1680, 0.01, 'growth credits the opening balance plus half the year flow');
near(invested.balance[0], 10000 + 36000 + 1680, 0.01, 'balance = opening + net + growth');
ok(invested.balance[4] > invested.cumulativeNet[4], 'compounding pulls ahead of plain saving');

// Half-year convention: crediting the full contribution would overstate year one.
ok(invested.growthEarned[0] < 0.06 * (10000 + 36000),
  'contributions are not credited a full year of return');

suite('Shortfall detection');

var broke = CF.project({
  startYear: 2026, horizonYears: 4, openingBalance: 5000, annualReturn: 0,
  transactions: [
    CF.normalize({ label: 'Spend', kind: 'expense', cadence: 'annual', startYear: 2026, amounts: { 2026: 4000 } })
  ]
});
// 2026: 5,000 - 4,000 = 1,000. 2027: 1,000 - 4,000 = -3,000, the first negative.
eq(broke.shortfallYear, 2027, 'reports the first year the balance goes negative');
eq(CF.project(state).shortfallYear, null, 'and null when it never does');

suite('Disabled rows');

var withOff = CF.project(Object.assign({}, state, {
  transactions: state.transactions.concat([
    CF.normalize({ label: 'Off', kind: 'expense', cadence: 'monthly', startYear: 2026,
      amounts: { 2026: 9999 }, disabled: true })
  ])
}));
near(withOff.net[0], p.net[0], 0.01, 'a disabled row is excluded from the projection');

/* -------------------------------------------------------------- registry ---- */

suite('Source registry — derived rows rebuild, manual rows survive');

var reg = CF.createRegistry();
var takeHome = 90000;

reg.register('salary', function () {
  return [{ label: 'Take-home', group: 'Income', kind: 'income', cadence: 'annual',
    startYear: 2026, amounts: { 2026: takeHome } }];
});
reg.register('lifeEvent', function () {
  return [{ label: 'Wedding', group: 'Life events', kind: 'expense', cadence: 'once',
    startYear: 2029, amounts: { 2029: 30000 } }];
});

var manualRow = CF.normalize({ label: 'Rent', kind: 'expense', cadence: 'monthly',
  startYear: 2026, amounts: { 2026: 2400 } });

var built = reg.rebuild([manualRow]);
eq(built.length, 3, 'one manual row plus two derived rows');
eq(built[0].label, 'Rent', 'manual rows come first and are preserved');
ok(built.slice(1).every(function (t) { return t.locked; }), 'derived rows are locked');
eq(built.filter(function (t) { return t.source === 'salary'; }).length, 1, 'one salary row');

// A salary change must replace the old row, not add a second one.
takeHome = 120000;
var rebuilt = reg.rebuild(built);
eq(rebuilt.length, 3, 'rebuilding does not duplicate derived rows');
near(rebuilt.filter(function (t) { return t.source === 'salary'; })[0].amounts[2026], 120000, 0.01,
  'the salary row picks up the new figure');
eq(rebuilt.filter(function (t) { return t.source === 'manual' || !t.source; }).length, 1,
  'the manual row is still there and untouched');

reg.unregister('lifeEvent');
eq(reg.rebuild(built).length, 2, 'unregistering a source removes its rows');

var noisy = CF.createRegistry();
noisy.register('broken', function () { throw new Error('tab not ready'); });
deep(noisy.rebuild([]), [], 'a provider that throws is skipped rather than breaking the table');

suite('Overrides — hand edits that survive a rebuild');

var derived = CF.normalize({ id: 'expense_rent', label: 'Rent', kind: 'expense',
  cadence: 'monthly', startYear: 2026, amounts: { 2026: 2000 }, source: 'expenses', locked: true });

var overridden = CF.applyOverrides([derived], { expense_rent: { 2028: 3500 } })[0];
near(CF.amountForYear(overridden, 2026), 2000, 0.01, 'un-overridden years keep the tab value');
near(CF.amountForYear(overridden, 2028), 3500, 0.01, 'the overridden year takes the hand-typed value');
near(CF.amountForYear(overridden, 2029), 3500, 0.01, 'and later years carry it forward');
eq(CF.isOverridden(overridden, 2028), true, 'the overridden year is flagged');
eq(CF.isOverridden(overridden, 2026), false, 'others are not');
near(CF.amountForYear(derived, 2028), 2000, 0.01, 'the original row is not mutated');

// The whole point: the source tab rebuilds its rows, and the edit still holds.
var rebuiltRow = CF.normalize({ id: 'expense_rent', label: 'Rent', kind: 'expense',
  cadence: 'monthly', startYear: 2026, amounts: { 2026: 2200 }, source: 'expenses', locked: true });
var reapplied = CF.applyOverrides([rebuiltRow], { expense_rent: { 2028: 3500 } })[0];
near(CF.amountForYear(reapplied, 2026), 2200, 0.01, 'the rebuilt row brings the new tab value through');
near(CF.amountForYear(reapplied, 2028), 3500, 0.01, 'while the override still holds on its own year');

deep(CF.applyOverrides([derived], null)[0].amounts, derived.amounts, 'no overrides is a no-op');
deep(CF.applyOverrides([derived], { other_id: { 2028: 1 } })[0].amounts, derived.amounts,
  'an override for a row that is gone is ignored');
deep(CF.applyOverrides([derived], { expense_rent: {} })[0].amounts, derived.amounts,
  'an empty override map is a no-op');

/* ------------------------------------------------------------ normalize ---- */

suite('Normalize — defaults and coercion');

var messy = CF.normalize({ label: 'X', amounts: { '2026': '1,200', 'bad': 5 }, endYear: '' });
near(messy.amounts[2026], 1200, 0.01, 'a formatted string amount is parsed');
eq(Object.keys(messy.amounts).length, 1, 'a non-numeric year key is dropped');
eq(messy.endYear, null, 'an empty end year becomes null, not 0');
eq(messy.cadence, 'monthly', 'cadence defaults to monthly');
eq(messy.kind, 'expense', 'kind defaults to expense');
eq(messy.group, 'Ungrouped', 'group defaults to Ungrouped');
ok(!!messy.id, 'an id is assigned');
ok(CF.normalize({}).id !== CF.normalize({}).id, 'ids are unique');

var horizon = CF.project({ startYear: 2026, horizonYears: 500, transactions: [] });
eq(horizon.years.length, 60, 'the horizon is capped so the table cannot explode');
eq(CF.project({ startYear: 2026, horizonYears: 0, transactions: [] }).years.length, 1,
  'and floored at one year');

var empty = CF.project({ startYear: 2026, horizonYears: 3, transactions: [] });
deep(empty.net, [0, 0, 0], 'an empty ledger projects zeroes, not NaN');
eq(empty.shortfallYear, null, 'and reports no shortfall');

/* ------------------------------------------------------------------- done -- */

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
