/*
 * Tests for the savings and investment engine. Run: node test/savings.test.js
 *
 * The double-counting rule gets the most attention — it is the one that would
 * quietly produce wrong numbers everywhere else if it broke.
 */

var Savings = require('../js/savings.js');

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

/* ------------------------------------------------------- payroll vs take-home */

suite('Where the money comes from is fixed by the account type');

eq(Savings.normalize({ type: 'retirement401k' }).fromPayroll, true, '401(k) is payroll-deducted');
eq(Savings.normalize({ type: 'hsa' }).fromPayroll, true, 'payroll HSA is payroll-deducted');
eq(Savings.normalize({ type: 'ira' }).fromPayroll, false, 'an IRA comes out of take-home');
eq(Savings.normalize({ type: 'brokerage' }).fromPayroll, false, 'a brokerage comes out of take-home');
eq(Savings.normalize({ type: 'cash' }).fromPayroll, false, 'cash savings come out of take-home');

// Letting this be set by hand would make double-counting a one-click mistake.
eq(Savings.normalize({ type: 'ira', fromPayroll: true }).fromPayroll, false,
  'fromPayroll cannot be overridden by hand — the type decides');
eq(Savings.normalize({ type: 'retirement401k', fromPayroll: false }).fromPayroll, true,
  'and cannot be turned off for a payroll account either');

suite('Only post-tax contributions reach the cash flow ledger');

var accounts = [
  { id: 'a', type: 'retirement401k', name: '401(k)', annualContribution: 12000 },
  { id: 'b', type: 'ira', name: 'Roth IRA', annualContribution: 7000 },
  { id: 'c', type: 'brokerage', name: 'Brokerage', annualContribution: 6000 }
];

var rows = Savings.ledgerRows(accounts, 2026);
eq(rows.length, 2, 'two rows — the 401(k) is deliberately absent');
ok(rows.every(function (r) { return r.label !== '401(k)'; }),
  'take-home already excludes the 401(k), so a row would count it twice');
eq(rows[0].label, 'Roth IRA', 'the IRA does reach the ledger');
eq(rows[0].kind, 'expense', 'as an outflow');
eq(rows[0].group, 'Savings & investments', 'grouped together');
near(rows[0].amounts[2026], 7000, 0.01, 'at its annual contribution');

eq(Savings.ledgerRows([{ type: 'ira', annualContribution: 0 }], 2026).length, 0,
  'an account with no contribution produces no row');

var p = Savings.project(accounts, YEARS);
near(p.annualFromPayroll, 12000, 0.01, 'payroll contributions are reported separately');
near(p.annualFromTakeHome, 13000, 0.01, 'and post-tax contributions separately');
near(p.annualContributions, 25000, 0.01, 'the total covers both');

/* ------------------------------------------------------------- projection --- */

suite('Balance projection');

var one = Savings.project([
  { type: 'brokerage', startingBalance: 10000, annualContribution: 6000, returnRate: 0 }
], YEARS);

near(one.perAccount[0].balances[0], 16000, 0.01, 'with no return, year one is opening plus contribution');
near(one.perAccount[0].balances[4], 10000 + 6000 * 5, 0.01, 'and it just adds up');
near(one.totalBalance[4], one.totalContributed[4], 0.01, 'balance equals contributions at 0% return');
near(one.totalGrowth[4], 0, 0.01, 'so growth is zero');

var grown = Savings.project([
  { type: 'brokerage', startingBalance: 10000, annualContribution: 6000, returnRate: 0.07 }
], YEARS);
// Year one: 7% on (10,000 + 6,000/2) = 7% of 13,000 = 910
near(grown.perAccount[0].balances[0], 10000 + 6000 + 910, 0.01,
  'growth credits the opening balance plus half the year contribution');
ok(grown.perAccount[0].balances[0] < 10000 + 6000 + 0.07 * 16000,
  'a full year of return on the contribution would be too generous');
ok(grown.totalBalance[4] > one.totalBalance[4], 'a positive return beats no return');
near(grown.totalContributed[4], one.totalContributed[4], 0.01,
  'contributions tracked are the same either way — only the balance differs');

suite('Employer match builds the balance but is never a cash outflow');

var matched = Savings.project([
  { type: 'retirement401k', startingBalance: 0, annualContribution: 10000, employerMatch: 5000, returnRate: 0 }
], YEARS);
near(matched.perAccount[0].balances[0], 15000, 0.01, 'the match lands in the balance');
near(matched.annualMatch, 5000, 0.01, 'and is reported');
eq(Savings.ledgerRows([{ type: 'retirement401k', annualContribution: 10000, employerMatch: 5000 }], 2026).length, 0,
  'but never becomes a ledger row — it is money arriving, not leaving');

// A matched post-tax account still only sends its OWN contribution to the ledger.
var iraMatch = Savings.ledgerRows([{ type: 'ira', name: 'IRA', annualContribution: 7000, employerMatch: 3000 }], 2026);
near(iraMatch[0].amounts[2026], 7000, 0.01, 'the ledger row excludes the match');

suite('Contribution growth');

var rising = Savings.project([
  { type: 'brokerage', annualContribution: 1000, contributionGrowth: 0.10, returnRate: 0 }
], YEARS);
near(Savings.contributionForYear(Savings.normalize({ annualContribution: 1000, contributionGrowth: 0.10 }), 0), 1000, 0.01,
  'year one is the stated contribution');
near(Savings.contributionForYear(Savings.normalize({ annualContribution: 1000, contributionGrowth: 0.10 }), 2), 1210, 0.01,
  'and compounds from there');
near(rising.perAccount[0].balances[2], 1000 + 1100 + 1210, 0.01, 'the balance follows the rising contribution');

var risingRow = Savings.ledgerRows([{ type: 'ira', annualContribution: 1000, contributionGrowth: 0.10 }], 2026)[0];
near(risingRow.growth, 0.10, 0.001, 'growth is passed to the ledger row so the table escalates it too');

/* ------------------------------------------------------------ many accounts - */

suite('Totals across accounts');

var many = Savings.project([
  { type: 'retirement401k', startingBalance: 50000, annualContribution: 12000, employerMatch: 4000, returnRate: 0.06 },
  { type: 'ira', startingBalance: 20000, annualContribution: 7000, returnRate: 0.06 },
  { type: 'cash', startingBalance: 15000, annualContribution: 3000, returnRate: 0.02 }
], YEARS);

eq(many.perAccount.length, 3, 'three accounts');
near(many.startingBalance, 85000, 0.01, 'starting balances add up');
near(many.totalBalance[0],
  many.perAccount.reduce(function (a, x) { return a + x.balances[0]; }, 0), 0.01,
  'the total is the sum of the accounts, year by year');
near(many.totalBalance[4],
  many.perAccount.reduce(function (a, x) { return a + x.balances[4]; }, 0), 0.01,
  'and still is at the end of the horizon');
near(many.totalGrowth[4], many.totalBalance[4] - many.totalContributed[4], 0.01,
  'growth is balance minus what was put in');
ok(many.totalGrowth[4] > 0, 'and is positive with positive returns');

/* ------------------------------------------------------------- edge cases --- */

suite('Edge cases');

var empty = Savings.project([], YEARS);
eq(empty.perAccount.length, 0, 'no accounts is fine');
near(empty.totalBalance[0], 0, 0.01, 'totals are zero, not NaN');
near(empty.totalGrowth[4], 0, 0.01, 'and so is growth');
eq(Savings.ledgerRows([], 2026).length, 0, 'and no ledger rows');

var junk = Savings.normalize({ type: 'nonsense', annualContribution: '1,200', startingBalance: '-500', returnRate: '7' });
eq(junk.type, 'brokerage', 'an unknown type falls back to brokerage');
near(junk.annualContribution, 1200, 0.01, 'a formatted string contribution is parsed');
near(junk.startingBalance, 0, 0.01, 'a negative starting balance is floored at zero');
ok(!!junk.name, 'a missing name falls back to the type label');

var negative = Savings.project([
  { type: 'brokerage', startingBalance: 100000, annualContribution: 0, returnRate: -0.10 }
], YEARS);
ok(negative.totalBalance[4] < 100000, 'a negative return shrinks the balance');
ok(isFinite(negative.totalBalance[4]), 'and stays a real number');

/* ------------------------------------------------------------------- done -- */

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
