/*
 * Tests for the financial health metrics. Run: node test/health.test.js
 *
 * The rule that matters most: a metric with no data reports `unknown` and is
 * left out of the score entirely. An empty app must not read as failing.
 */

var Health = require('../js/health.js');

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

function find(list, id) {
  return list.filter(function (m) { return m.id === id; })[0];
}

var HEALTHY = {
  grossIncome: 160000,
  takeHome: 110000,
  annualExpenses: 60000,
  housingAnnual: 36000,
  savingsContributions: 32000,
  liquidCash: 40000,
  investedBalance: 900000,
  netCashByYear: [18000, 19000, 20000],
  shortfallYear: null,
  effectiveTaxRate: 0.28,
  horizonYears: 20
};

/* ------------------------------------------------------------- thresholds -- */

suite('grade() handles both directions');

eq(Health.grade(0.25, { good: 0.20, ok: 0.15, warn: 0.10 }, true), 'good', 'higher is better, above target');
eq(Health.grade(0.16, { good: 0.20, ok: 0.15, warn: 0.10 }, true), 'ok', 'higher is better, mid');
eq(Health.grade(0.12, { good: 0.20, ok: 0.15, warn: 0.10 }, true), 'warn', 'higher is better, low');
eq(Health.grade(0.02, { good: 0.20, ok: 0.15, warn: 0.10 }, true), 'bad', 'higher is better, very low');

eq(Health.grade(0.20, { good: 0.25, ok: 0.30, warn: 0.40 }, false), 'good', 'lower is better, under target');
eq(Health.grade(0.28, { good: 0.25, ok: 0.30, warn: 0.40 }, false), 'ok', 'lower is better, mid');
eq(Health.grade(0.35, { good: 0.25, ok: 0.30, warn: 0.40 }, false), 'warn', 'lower is better, high');
eq(Health.grade(0.60, { good: 0.25, ok: 0.30, warn: 0.40 }, false), 'bad', 'lower is better, very high');

// Boundaries land on the better side, so a value exactly on target is not punished.
eq(Health.grade(0.20, { good: 0.20, ok: 0.15, warn: 0.10 }, true), 'good', 'exactly on target counts as good');
eq(Health.grade(0.25, { good: 0.25, ok: 0.30, warn: 0.40 }, false), 'good', 'and the same the other way');

/* ---------------------------------------------------------------- metrics -- */

suite('Savings rate');

var m = Health.metrics(HEALTHY);
var sr = find(m, 'savings-rate');
near(sr.value, 32000 / 160000, 0.0001, '32,000 of 160,000 is 20%');
eq(sr.display, '20.0%', 'shown as a percentage');
eq(sr.status, 'good', '20% hits the target');

eq(find(Health.metrics(Object.assign({}, HEALTHY, { savingsContributions: 8000 })), 'savings-rate').status,
  'bad', '5% is bad');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { savingsContributions: 25600 })), 'savings-rate').status,
  'ok', '16% is ok');

suite('Emergency fund counts cash only');

var ef = find(m, 'emergency-fund');
near(ef.value, 40000 / 5000, 0.01, '40,000 against 5,000 a month is 8 months');
eq(ef.status, 'good', 'eight months clears the six-month target');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { liquidCash: 20000 })), 'emergency-fund').status,
  'ok', 'four months is ok');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { liquidCash: 2000 })), 'emergency-fund').status,
  'bad', 'under a month is bad');

// A big portfolio must not rescue an empty current account.
var noCash = Health.metrics(Object.assign({}, HEALTHY, { liquidCash: 0, investedBalance: 5000000 }));
eq(find(noCash, 'emergency-fund').status, 'bad',
  'investments do not count as an emergency fund');

suite('Spending vs take-home');

eq(find(m, 'expense-ratio').status, 'good', '60,000 of 110,000 is 55%, comfortable');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { annualExpenses: 120000 })), 'expense-ratio').status,
  'bad', 'spending more than you take home is bad');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { annualExpenses: 88000 })), 'expense-ratio').status,
  'ok', '80% is ok');

suite('Housing');

near(find(m, 'housing').value, 36000 / 160000, 0.0001, '36,000 of 160,000 gross is 22.5%');
eq(find(m, 'housing').status, 'good', 'under 25% is good');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { housingAnnual: 56000 })), 'housing').status,
  'warn', '35% is over the 30% guideline');

suite('Does the plan hold up');

eq(find(m, 'runway').status, 'good', 'all-positive years are good');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { netCashByYear: [1000, -5000, 2000] })), 'runway').status,
  'warn', 'a negative year with the balance intact is a warning');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { shortfallYear: 2032 })), 'runway').status,
  'bad', 'a balance that runs out is bad');
ok(/2032/.test(find(Health.metrics(Object.assign({}, HEALTHY, { shortfallYear: 2032 })), 'runway').headline),
  'and names the year');

suite('Retirement progress against 25x spending');

var ret = find(m, 'retirement');
near(ret.value, 900000 / (60000 * 25), 0.001, '900,000 against a 1.5M target is 60%');
eq(ret.status, 'ok', '60% of the way is ok');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { investedBalance: 1600000 })), 'retirement').status,
  'good', 'past the target is good');
eq(find(Health.metrics(Object.assign({}, HEALTHY, { investedBalance: 100000 })), 'retirement').status,
  'bad', 'barely started is bad');

suite('Tax is reported, not scored');

var tax = find(m, 'tax');
eq(tax.status, 'info', 'tax carries an info status');
eq(tax.weight, 0, 'and no weight, so it cannot move the score');

/* ------------------------------------------------------------------ score -- */

suite('Score');

var healthyScore = Health.score(m);
ok(healthyScore.value >= 85, 'a healthy picture scores strongly (' + healthyScore.value + ')');
eq(healthyScore.band, 'good', 'and lands in the good band');
ok(!!healthyScore.blurb, 'with something to read');

var strained = Health.metrics(Object.assign({}, HEALTHY, {
  savingsContributions: 3000, liquidCash: 1000, annualExpenses: 105000,
  housingAnnual: 70000, shortfallYear: 2030, investedBalance: 50000
}));
var strainedScore = Health.score(strained);
ok(strainedScore.value < 40, 'a strained picture scores low (' + strainedScore.value + ')');
eq(strainedScore.band, 'bad', 'and lands in the bad band');

ok(healthyScore.value > strainedScore.value, 'healthy outscores strained');

suite('Empty input reports "not enough to say", never a failing grade');

var empty = Health.metrics({
  grossIncome: 0, takeHome: 0, annualExpenses: 0, housingAnnual: 0,
  savingsContributions: 0, liquidCash: 0, investedBalance: 0,
  netCashByYear: [], shortfallYear: null, effectiveTaxRate: 0, horizonYears: 20
});
ok(empty.every(function (x) { return x.status === 'unknown'; }), 'every metric is unknown');
ok(empty.every(function (x) { return !!x.headline; }), 'and each says what to do about it');

var emptyScore = Health.score(empty);
eq(emptyScore.value, null, 'the score is null, not zero');
eq(emptyScore.band, 'unknown', 'the band is unknown');
eq(emptyScore.counted, 0, 'nothing was counted');

// The important part: an unknown metric must not drag a real score down.
var partial = Health.metrics(Object.assign({}, HEALTHY, {
  housingAnnual: 0, investedBalance: 0
}));
eq(find(partial, 'housing').status, 'unknown', 'a missing housing figure is unknown');
eq(find(partial, 'retirement').status, 'unknown', 'and so is a missing balance');
var partialScore = Health.score(partial);
ok(partialScore.value >= 85,
  'the remaining metrics still score strongly (' + partialScore.value + '), undragged by the unknowns');
ok(partialScore.counted < healthyScore.counted, 'while reporting fewer counted metrics');

/* ----------------------------------------------------------------- ranked -- */

suite('Ranked puts the thing to fix first');

var mixed = Health.metrics(Object.assign({}, HEALTHY, {
  savingsContributions: 3000, shortfallYear: 2031
}));
var order = Health.ranked(mixed);
eq(order[0].status, 'bad', 'the worst metric is first');
ok(order.length === mixed.length, 'nothing is dropped');

// Sinking is only observable when an unknown is actually present.
var withUnknown = Health.ranked(Health.metrics(Object.assign({}, HEALTHY, {
  savingsContributions: 3000, housingAnnual: 0
})));
eq(withUnknown[0].status, 'bad', 'the worst is still first');
eq(withUnknown[withUnknown.length - 1].status, 'unknown', 'and an unknown sinks below even the unscored metric');

var allGood = Health.ranked(m);
eq(allGood[allGood.length - 1].id, 'tax', 'with nothing wrong, the unscored metric sits last');

/* ---------------------------------------------------------------- analyse -- */

suite('analyse() bundles it together');

var a = Health.analyse(HEALTHY);
eq(a.metrics.length, 7, 'seven metrics');
eq(a.ranked.length, 7, 'ranked has the same set');
ok(a.score.value > 0, 'and a score');

/* ------------------------------------------------------------- edge cases -- */

suite('Edge cases');

var huge = Health.metrics(Object.assign({}, HEALTHY, { liquidCash: 99999999 }));
eq(find(huge, 'emergency-fund').display, '99+ mo', 'an absurd cash pile is capped in the display');

var over = Health.metrics(Object.assign({}, HEALTHY, { investedBalance: 999999999 }));
ok(parseFloat(find(over, 'retirement').display) <= 999, 'retirement progress is capped too');

var negativeFlow = Health.metrics(Object.assign({}, HEALTHY, { netCashByYear: [-1, -2, -3] }));
eq(find(negativeFlow, 'runway').status, 'warn', 'all-negative years with no shortfall is a warning');

ok(Health.metrics(Object.assign({}, HEALTHY, { takeHome: 0 })).every(function (x) { return !!x.label; }),
  'zero take-home still produces labelled metrics rather than crashing');

/* ------------------------------------------------------------------- done -- */

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
