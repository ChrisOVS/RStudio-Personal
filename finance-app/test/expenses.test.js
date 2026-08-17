/*
 * Tests for the expense engine. Run: node test/expenses.test.js
 *
 * The two rules worth guarding are the inflation default (null means "follow
 * the default", which is not the same as a pinned 0%) and the buffer staying a
 * true percentage of a total whose parts grow at different rates.
 */

var Expenses = require('../js/expenses.js');

var passed = 0, failed = 0;
function suite(n) { console.log('\n' + n); }
function near(a, e, tol, l) { report(Math.abs(a - e) <= (tol === undefined ? 0.01 : tol), l, e, a); }
function eq(a, e, l) { report(a === e, l, e, a); }
function ok(c, l) { report(!!c, l, true, !!c); }
function report(pass, label, expected, actual) {
  if (pass) { passed++; console.log('  ✓ ' + label); }
  else {
    failed++;
    console.log('  ✗ ' + label);
    console.log('      expected: ' + expected);
    console.log('      actual:   ' + actual);
  }
}

var YEARS = [2026, 2027, 2028, 2029, 2030];

function exp(over) {
  return Expenses.normalize(Object.assign({
    label: 'Rent', category: 'Housing', cadence: 'monthly', amount: 2000, startYear: 2026
  }, over));
}

/* ------------------------------------------------------------- cadence ----- */

suite('Cadence scales the per-period amount to a year');

near(Expenses.annualAmount(exp({ cadence: 'monthly', amount: 2000 })), 24000, 0.01, 'monthly x 12');
near(Expenses.annualAmount(exp({ cadence: 'weekly', amount: 150 })), 7800, 0.01, 'weekly x 52');
near(Expenses.annualAmount(exp({ cadence: 'annual', amount: 1200 })), 1200, 0.01, 'annual x 1');
near(Expenses.annualAmount(exp({ cadence: 'quarterly', amount: 300 })), 1200, 0.01, 'quarterly x 4');

/* ----------------------------------------------------------- inflation ---- */

suite('Inflation — null follows the default, a number pins it');

eq(exp({ inflation: null }).inflation, null, 'null is preserved, not coerced to 0');
eq(exp({}).inflation, null, 'a missing rate follows the default');
eq(exp({ inflation: 0 }).inflation, 0, 'an explicit 0% is a real override, not "use default"');
eq(exp({ inflation: '' }).inflation, null, 'an empty string means follow the default');

eq(Expenses.usesDefault(exp({})), true, 'an unpinned expense follows the default');
eq(Expenses.usesDefault(exp({ inflation: 0 })), false, 'a 0% pin does not follow the default');

near(Expenses.effectiveInflation(exp({}), 0.03), 0.03, 0.0001, 'unpinned takes the default rate');
near(Expenses.effectiveInflation(exp({ inflation: 0.06 }), 0.03), 0.06, 0.0001, 'a pin wins over the default');
// The distinction that matters: a 0% pin must NOT inherit 3%.
near(Expenses.effectiveInflation(exp({ inflation: 0 }), 0.03), 0, 0.0001,
  'a 0% pin stays at 0% even when the default is 3%');

suite('Inflation compounds from the expense start year');

var rent = exp({ amount: 1000, cadence: 'monthly', inflation: 0.10 });
near(Expenses.annualAmountInYear(rent, 2026, 2026, 0), 12000, 0.01, 'year one is the stated amount');
near(Expenses.annualAmountInYear(rent, 2027, 2026, 0), 13200, 0.01, 'year two is up 10%');
near(Expenses.annualAmountInYear(rent, 2028, 2026, 0), 14520, 0.01, 'and compounds');

// An expense starting later inflates from ITS start, not the horizon start.
var later = exp({ amount: 1000, cadence: 'annual', startYear: 2028, inflation: 0.10 });
near(Expenses.annualAmountInYear(later, 2028, 2026, 0), 1000, 0.01,
  'a later expense begins at its stated amount in its own start year');
near(Expenses.annualAmountInYear(later, 2029, 2026, 0), 1100, 0.01, 'then inflates from there');
near(Expenses.annualAmountInYear(later, 2027, 2026, 0), 0, 0.01, 'and costs nothing before it starts');

var ends = exp({ amount: 500, cadence: 'annual', startYear: 2026, endYear: 2027 });
near(Expenses.annualAmountInYear(ends, 2027, 2026, 0), 500, 0.01, 'active in its end year');
near(Expenses.annualAmountInYear(ends, 2028, 2026, 0), 0, 0.01, 'and gone after it');

near(Expenses.annualAmountInYear(exp({ disabled: true }), 2026, 2026, 0), 0, 0.01,
  'a disabled expense costs nothing');

/* -------------------------------------------------------------- buffer ---- */

suite('Safety buffer — a true percentage of the real total');

var state = {
  defaultInflation: 0,
  bufferPct: 0.20,
  expenses: [
    exp({ id: 'r', label: 'Rent', category: 'Housing', amount: 2000, cadence: 'monthly' }),
    exp({ id: 'f', label: 'Food', category: 'Food', amount: 600, cadence: 'monthly' })
  ]
};

var p = Expenses.project(state, YEARS);
near(p.baseAnnual, 31200, 0.01, 'base is (2,000 + 600) x 12 = 31,200');
near(p.bufferAnnual, 6240, 0.01, '20% buffer = 6,240');
near(p.totalAnnual, 37440, 0.01, 'total is base plus buffer');
near(p.totalMonthly, 3120, 0.01, 'and the monthly figure follows');
near(p.baseMonthly, 2600, 0.01, 'base monthly is the un-padded figure');

// Base, buffer and total are reported separately on purpose — a single padded
// number would hide the assumption.
near(p.base[0] + p.buffer[0], p.total[0], 0.01, 'base + buffer reconciles to total');

var noBuffer = Expenses.project(Object.assign({}, state, { bufferPct: 0 }), YEARS);
near(noBuffer.bufferAnnual, 0, 0.01, 'no buffer means no padding');
near(noBuffer.totalAnnual, noBuffer.baseAnnual, 0.01, 'and total equals base');

suite('The buffer tracks a total whose parts grow at different rates');

var mixed = {
  defaultInflation: 0,
  bufferPct: 0.20,
  expenses: [
    exp({ id: 'a', amount: 1000, cadence: 'annual', inflation: 0.10 }),
    exp({ id: 'b', amount: 1000, cadence: 'annual', inflation: 0 })
  ]
};
var mp = Expenses.project(mixed, YEARS);
near(mp.base[0], 2000, 0.01, 'year one base');
near(mp.base[1], 1100 + 1000, 0.01, 'year two: one line inflated, one did not');
near(mp.buffer[1], (1100 + 1000) * 0.20, 0.01, 'the buffer is 20% of the real year-two total');
// A single growth rate on the buffer row could not track this.
ok(Math.abs(mp.buffer[1] - mp.buffer[0] * 1.10) > 1,
  'the buffer does not simply grow at one rate — it is recomputed each year');

YEARS.forEach(function (y, i) {
  var ratio = mp.buffer[i] / mp.base[i];
  if (Math.abs(ratio - 0.20) > 1e-9) {
    report(false, 'buffer stays exactly 20% in ' + y, 0.2, ratio);
    throw new Error('buffer drifted');
  }
});
report(true, 'the buffer stays exactly 20% of base in every year', '', '');

/* --------------------------------------------------------- ledger rows ---- */

suite('Ledger rows');

var rows = Expenses.ledgerRows(state, YEARS);
eq(rows.length, 3, 'two expenses plus the buffer row');
eq(rows[0].kind, 'expense', 'expenses are outflows');
eq(rows[0].group, 'Housing', 'grouped by category');
eq(rows[0].cadence, 'monthly', 'cadence is carried through');
near(rows[0].amounts[2026], 2000, 0.01, 'at the per-period amount, not the annual one');

var bufferRow = rows[rows.length - 1];
eq(bufferRow.id, Expenses.BUFFER_ROW_ID, 'the buffer is its own row');
eq(bufferRow.group, 'Buffer', 'in its own group, so it is never mistaken for real spending');
ok(/20%/.test(bufferRow.label), 'and says what percentage it is');
eq(bufferRow.cadence, 'annual', 'the buffer is an annual figure');
near(bufferRow.amounts[2026], 6240, 0.01, 'year one buffer');

// Explicit per-year amounts, because a growth rate could not track a mixed basket.
eq(Object.keys(bufferRow.amounts).length, YEARS.length, 'the buffer has an entry for every year');

var mixedRows = Expenses.ledgerRows(mixed, YEARS);
var mixedBuffer = mixedRows[mixedRows.length - 1];
near(mixedBuffer.amounts[2027], (1100 + 1000) * 0.20, 0.01,
  'and each entry is 20% of that year real total');

suite('Inflation reaches the ledger as per-row growth');

var infl = Expenses.ledgerRows({
  defaultInflation: 0.03,
  bufferPct: 0,
  expenses: [exp({ id: 'a' }), exp({ id: 'b', inflation: 0.07 })]
}, YEARS);
near(infl[0].growth, 0.03, 0.0001, 'an unpinned expense carries the default rate');
near(infl[1].growth, 0.07, 0.0001, 'a pinned expense carries its own');

suite('Rows that should not reach the ledger');

eq(Expenses.ledgerRows({ bufferPct: 0, expenses: [exp({ amount: 0 })] }, YEARS).length, 0,
  'a zero-amount expense produces no row');
eq(Expenses.ledgerRows({ bufferPct: 0, expenses: [exp({ disabled: true })] }, YEARS).length, 0,
  'a disabled expense produces no row');
eq(Expenses.ledgerRows({ bufferPct: 0.2, expenses: [] }, YEARS).length, 0,
  'a buffer on nothing produces no buffer row');
eq(Expenses.ledgerRows({ bufferPct: 0.2, expenses: [exp({ amount: 0 })] }, YEARS).length, 0,
  'nor does a buffer on only zero-amount expenses');

/* ------------------------------------------------------------ categories -- */

suite('Category rollup');

var cat = Expenses.project({
  defaultInflation: 0, bufferPct: 0,
  expenses: [
    exp({ id: '1', category: 'Housing', amount: 2000, cadence: 'monthly' }),
    exp({ id: '2', category: 'Food', amount: 600, cadence: 'monthly' }),
    exp({ id: '3', category: 'Food', amount: 200, cadence: 'monthly' })
  ]
}, YEARS);
eq(cat.categories.length, 2, 'two categories');
eq(cat.categories[0].name, 'Housing', 'sorted biggest first');
near(cat.categories[0].annual, 24000, 0.01, 'Housing total');
near(cat.categories[1].annual, 9600, 0.01, 'Food rolls up both of its lines');
near(cat.categories.reduce(function (a, c) { return a + c.annual; }, 0), cat.baseAnnual, 0.01,
  'categories reconcile to the base total');

/* ------------------------------------------------------------ edge cases -- */

suite('Edge cases');

var empty = Expenses.project({ expenses: [], defaultInflation: 0.03, bufferPct: 0.2 }, YEARS);
near(empty.totalAnnual, 0, 0.01, 'no expenses totals zero, not NaN');
eq(empty.categories.length, 0, 'and no categories');
near(empty.inflationMultiple, 1, 0.01, 'the inflation multiple is 1 with nothing to inflate');

var junk = Expenses.normalize({ amount: '1,250', cadence: 'nonsense', category: '', endYear: '' });
near(junk.amount, 1250, 0.01, 'a formatted string amount is parsed');
eq(junk.cadence, 'monthly', 'an unknown cadence falls back to monthly');
eq(junk.category, 'Other', 'a missing category falls back to Other');
eq(junk.endYear, null, 'an empty end year is null, not 0');
near(Expenses.normalize({ amount: -500 }).amount, 0, 0.01, 'a negative amount is floored at zero');

var multiple = Expenses.project({
  defaultInflation: 0.03, bufferPct: 0,
  expenses: [exp({ amount: 1000, cadence: 'annual' })]
}, YEARS);
near(multiple.inflationMultiple, Math.pow(1.03, 4), 0.001,
  'the inflation multiple reports what the same basket costs by the horizon end');

/* ------------------------------------------------------------------- done -- */

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
