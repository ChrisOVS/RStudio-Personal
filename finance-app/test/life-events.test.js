/*
 * Tests for life events and the pay schedule.
 * Run: node test/life-events.test.js
 */

var LifeEvents = require('../js/life-events.js');
var PaySchedule = require('../js/pay-schedule.js');

var passed = 0, failed = 0;
function suite(n) { console.log('\n' + n); }
function near(a, e, tol, l) { report(Math.abs(a - e) <= (tol === undefined ? 0.01 : tol), l, e, a); }
function eq(a, e, l) { report(a === e, l, e, a); }
function deep(a, e, l) { report(JSON.stringify(a) === JSON.stringify(e), l, JSON.stringify(e), JSON.stringify(a)); }
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

var YEARS = [2026, 2027, 2028, 2029, 2030, 2031];

function ev(over) {
  return LifeEvents.normalize(Object.assign({
    label: 'Wedding', category: 'Family', kind: 'expense', amount: 30000, year: 2028
  }, over));
}

/* ====================================================== LIFE EVENTS ======== */

suite('An event lands in its year and nowhere else');

var wedding = ev();
eq(LifeEvents.isActiveIn(wedding, 2027), false, 'not active before its year');
eq(LifeEvents.isActiveIn(wedding, 2028), true, 'active in its year');
eq(LifeEvents.isActiveIn(wedding, 2029), false, 'and not after');
near(LifeEvents.signedAmountInYear(wedding, 2028, 2026), -30000, 0.01, 'an expense is negative');
near(LifeEvents.signedAmountInYear(wedding, 2029, 2026), 0, 0.01, 'and zero in other years');

var windfall = ev({ label: 'Inheritance', kind: 'income', amount: 50000, year: 2029 });
near(LifeEvents.signedAmountInYear(windfall, 2029, 2026), 50000, 0.01, 'an income event is positive');

suite('Today\'s money vs the money of the year it lands in');

var deposit = ev({ label: 'House deposit', amount: 100000, year: 2034, inflate: true, inflationRate: 0.03 });
// 100,000 compounded 8 years at 3% = 126,677
near(LifeEvents.amountInEventYear(deposit, 2026), 100000 * Math.pow(1.03, 8), 0.01,
  'an inflated event costs more by the time it arrives');
ok(LifeEvents.amountInEventYear(deposit, 2026) > 126000, 'materially more, not a rounding difference');

var flat = ev({ amount: 100000, year: 2034, inflate: false, inflationRate: 0.03 });
near(LifeEvents.amountInEventYear(flat, 2026), 100000, 0.01,
  'with inflation off the amount is taken as already being in that year money');

near(LifeEvents.amountInEventYear(ev({ year: 2026, amount: 5000, inflate: true, inflationRate: 0.03 }), 2026),
  5000, 0.01, 'an event in the base year is not inflated at all');

suite('Spreading an event over several years');

var tuition = ev({ label: 'Tuition', amount: 40000, year: 2028, spreadYears: 3 });
deep(LifeEvents.yearsTouched(tuition), [2028, 2029, 2030], 'touches three consecutive years');
eq(LifeEvents.isActiveIn(tuition, 2030), true, 'active in the last spread year');
eq(LifeEvents.isActiveIn(tuition, 2031), false, 'and done after it');
near(LifeEvents.signedAmountInYear(tuition, 2029, 2026), -40000, 0.01,
  'the amount repeats each year rather than being divided');

eq(LifeEvents.normalize({ spreadYears: 0 }).spreadYears, 1, 'spread is at least one year');
eq(LifeEvents.normalize({ spreadYears: 999 }).spreadYears, 40, 'and capped, so a typo cannot explode the table');

suite('Projection');

var state = {
  events: [
    ev({ id: 'a', label: 'Wedding', amount: 30000, year: 2028 }),
    ev({ id: 'b', label: 'Car', amount: 20000, year: 2028 }),
    ev({ id: 'c', label: 'Inheritance', kind: 'income', amount: 50000, year: 2030 })
  ]
};
var p = LifeEvents.project(state, YEARS);

near(p.outflow[2], 50000, 0.01, 'two events in the same year add up');
near(p.byYear[2], -50000, 0.01, 'and the net for that year is negative');
near(p.inflow[4], 50000, 0.01, 'the income event lands in its own year');
near(p.byYear[4], 50000, 0.01, 'positive');
near(p.byYear[0], 0, 0.01, 'a year with no events is zero');
near(p.totalOut, 50000, 0.01, 'total out');
near(p.totalIn, 50000, 0.01, 'total in');
near(p.net, 0, 0.01, 'and they net out here');

eq(p.biggestYear.year, 2028, 'the worst year is the one that breaks a plan');
near(p.biggestYear.amount, 50000, 0.01, 'and reports what it costs');
eq(LifeEvents.project({ events: [] }, YEARS).biggestYear, null, 'no events means no worst year');

eq(p.perEvent[0].event.label, 'Wedding', 'events are sorted by year');
eq(p.perEvent[2].event.label, 'Inheritance', 'latest last');

var spread = LifeEvents.project({ events: [ev({ amount: 40000, year: 2028, spreadYears: 3 })] }, YEARS);
near(spread.perEvent[0].total, 120000, 0.01, 'a spread event totals across every year it touches');

var infl = LifeEvents.project({
  events: [ev({ amount: 100000, year: 2030, inflate: true, inflationRate: 0.05 })]
}, YEARS);
ok(infl.perEvent[0].inflationUplift > 20000, 'the inflation uplift is reported so the assumption is visible');
near(infl.perEvent[0].inflationUplift,
  infl.perEvent[0].amountInYear - 100000, 0.01, 'uplift is the difference from what was typed');

suite('Ledger rows');

var rows = LifeEvents.ledgerRows(state, YEARS);
eq(rows.length, 3, 'one row per event');
eq(rows[0].group, 'Life events', 'all in one group');
eq(rows[0].cadence, 'once', 'a single-year event is a one-off');
eq(rows[0].startYear, 2028, 'in its year');
eq(rows[0].endYear, null, 'with no end year');
eq(rows[2].kind, 'income', 'an income event stays income');

var spreadRow = LifeEvents.ledgerRows({ events: [ev({ year: 2028, spreadYears: 3 })] }, YEARS)[0];
eq(spreadRow.cadence, 'annual', 'a spread event becomes an annual row');
eq(spreadRow.startYear, 2028, 'starting in its year');
eq(spreadRow.endYear, 2030, 'and bounded by an end year');

eq(LifeEvents.ledgerRows({ events: [ev({ amount: 0 })] }, YEARS).length, 0, 'a zero event produces no row');
eq(LifeEvents.ledgerRows({ events: [ev({ disabled: true })] }, YEARS).length, 0, 'nor a disabled one');
eq(LifeEvents.ledgerRows({ events: [ev({ year: null })] }, YEARS).length, 0, 'nor one with no year');

var inflRow = LifeEvents.ledgerRows({
  events: [ev({ amount: 100000, year: 2030, inflate: true, inflationRate: 0.05 })]
}, YEARS)[0];
near(inflRow.amounts[2030], 100000 * Math.pow(1.05, 4), 0.01,
  'the ledger gets the inflated figure, not what was typed');

suite('Life event edge cases');

var junk = LifeEvents.normalize({ amount: '30,000', year: '2028', category: 'Nonsense' });
near(junk.amount, 30000, 0.01, 'a formatted amount is parsed');
eq(junk.year, 2028, 'a string year becomes a number');
eq(junk.category, 'Other', 'an unknown category falls back to Other');
near(LifeEvents.normalize({ amount: -5000 }).amount, 0, 0.01, 'a negative amount is floored at zero');

var far = LifeEvents.project({ events: [ev({ year: 2099 })] }, YEARS);
eq(far.perEvent[0].inHorizon, false, 'an event past the horizon is flagged rather than hidden');
near(far.totalOut, 0, 0.01, 'and contributes nothing inside it');

/* ====================================================== PAY SCHEDULE ======= */

suite('Pay schedule — the base year comes from the Salary tab');

var base = PaySchedule.withBase({ defaultRaise: 0 }, 2026, 145000, 15000);
near(base.salaryByYear[2026], 145000, 0.01, 'base salary is written into the first year');
near(base.bonusByYear[2026], 15000, 0.01, 'and so is the bonus');
near(PaySchedule.payForYear(base, 2026).salary, 145000, 0.01, 'year one pays the base');
near(PaySchedule.payForYear(base, 2030).salary, 145000, 0.01, 'with no raise it holds flat');

suite('The default raise fills the gaps');

var raising = PaySchedule.withBase({ defaultRaise: 0.04 }, 2026, 100000, 0);
near(PaySchedule.payForYear(raising, 2026).salary, 100000, 0.01, 'the base year is exactly the base');
near(PaySchedule.payForYear(raising, 2027).salary, 104000, 0.01, 'the next year takes one raise');
near(PaySchedule.payForYear(raising, 2029).salary, 100000 * Math.pow(1.04, 3), 0.01, 'and compounds');

suite('A pinned year means exactly what it says, and re-anchors the raise');

var promo = PaySchedule.withBase(
  { defaultRaise: 0.04, salaryByYear: { 2029: 175000 } }, 2026, 145000, 15000);

near(PaySchedule.payForYear(promo, 2028).salary, 145000 * Math.pow(1.04, 2), 0.01,
  'years before the promotion just take the default raise');
near(PaySchedule.payForYear(promo, 2029).salary, 175000, 0.01,
  'the promotion year is exactly what was typed, not the compounded figure');
near(PaySchedule.payForYear(promo, 2030).salary, 175000 * 1.04, 0.01,
  'and the raise re-anchors on the new figure');
near(PaySchedule.payForYear(promo, 2032).salary, 175000 * Math.pow(1.04, 3), 0.01,
  'compounding from the promotion, not from the original base');

eq(PaySchedule.isPinned(promo, 'salary', 2029), true, 'the pinned year is flagged');
eq(PaySchedule.isPinned(promo, 'salary', 2030), false, 'an inherited year is not');

suite('Salary and bonus are pinned independently');

var both = PaySchedule.withBase(
  { defaultRaise: 0.03, salaryByYear: { 2028: 160000 }, bonusByYear: { 2028: 40000 } },
  2026, 140000, 14000);
near(PaySchedule.payForYear(both, 2028).salary, 160000, 0.01, 'salary takes its pin');
near(PaySchedule.payForYear(both, 2028).bonus, 40000, 0.01, 'bonus takes its own');

// A promotion often moves the bonus target by a different amount than the base,
// so pinning one must not disturb the other.
var salaryOnly = PaySchedule.withBase(
  { defaultRaise: 0.03, salaryByYear: { 2028: 160000 } }, 2026, 140000, 14000);
near(PaySchedule.payForYear(salaryOnly, 2028).salary, 160000, 0.01, 'salary is pinned');
near(PaySchedule.payForYear(salaryOnly, 2028).bonus, 14000 * Math.pow(1.03, 2), 0.01,
  'while the bonus carries on at the default raise');

suite('Setting and clearing a pin');

var set = PaySchedule.setPay({ defaultRaise: 0.03 }, 'salary', 2030, 200000);
near(set.salaryByYear[2030], 200000, 0.01, 'a pin is written');
var cleared = PaySchedule.setPay(set, 'salary', 2030, null);
eq(Object.prototype.hasOwnProperty.call(cleared.salaryByYear, 2030), false,
  'and clearing removes it so the year inherits again');
near(PaySchedule.setPay({}, 'salary', 2030, -5000).salaryByYear[2030], 0, 0.01,
  'a negative pin is floored at zero');

suite('Projection with a tax calculator injected');

// A stand-in calculator: flat 30%, so the arithmetic under test is the schedule.
function fakeCalc(salary, bonus) {
  var gross = salary + bonus;
  return { takeHome: gross * 0.7, effectiveRate: 0.3 };
}

var proj = PaySchedule.project(
  { defaultRaise: 0.04, salaryByYear: { 2029: 175000 } },
  YEARS, 145000, 15000, fakeCalc);

eq(proj.rows.length, YEARS.length, 'a row per year');
near(proj.rows[0].gross, 160000, 0.01, 'year one gross is salary plus bonus');
near(proj.rows[0].takeHome, 112000, 0.01, 'take-home comes from the calculator');
near(proj.rows[3].salary, 175000, 0.01, 'the promotion shows in its year');
ok(proj.rows[3].salaryPinned, 'and is flagged as pinned');
ok(!proj.rows[4].salaryPinned, 'the year after is not');
deep(proj.pinnedYears, [2029], 'pinned years are reported for the summary');
ok(proj.endGross > proj.startGross, 'pay grows across the horizon');
near(proj.totalTakeHome,
  proj.rows.reduce(function (a, r) { return a + r.takeHome; }, 0), 0.01,
  'total take-home is the sum of the rows');

var flatProj = PaySchedule.project({ defaultRaise: 0 }, YEARS, 100000, 0, fakeCalc);
near(flatProj.grossMultiple, 1, 0.001, 'no raise means no growth multiple');

var zero = PaySchedule.project({ defaultRaise: 0.03 }, YEARS, 0, 0, fakeCalc);
near(zero.grossMultiple, 1, 0.001, 'zero pay does not divide by zero');
near(zero.totalTakeHome, 0, 0.01, 'and totals zero');

/* ------------------------------------------------------------------- done -- */

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
