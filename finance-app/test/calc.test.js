/*
 * Tests for the paycheck engine. Run with: node test/calc.test.js
 *
 * Expected values are worked out by hand from the 2026 published tables in the
 * comments beside each case, NOT read back out of the implementation.
 */

var Calc = require('../js/calc.js');
var TaxData = require('../js/tax-data.js');

var passed = 0, failed = 0;
var currentSuite = '';

function suite(name) { currentSuite = name; console.log('\n' + name); }

function near(actual, expected, tolerance, label) {
  var tol = tolerance === undefined ? 0.51 : tolerance;
  var ok = Math.abs(actual - expected) <= tol;
  report(ok, label, expected, actual);
}

function eq(actual, expected, label) {
  report(actual === expected, label, expected, actual);
}

function ok(cond, label) {
  report(!!cond, label, true, !!cond);
}

function report(pass, label, expected, actual) {
  if (pass) {
    passed++;
    console.log('  ✓ ' + label);
  } else {
    failed++;
    console.log('  ✗ ' + label);
    console.log('      expected: ' + expected);
    console.log('      actual:   ' + actual);
  }
}

/* -------------------------------------------------------------- brackets -- */

suite('Federal brackets — marginal, not flat');

// Single, $83,900 taxable:
//   10% x 12,400              = 1,240.00
//   12% x (50,400 - 12,400)   = 4,560.00
//   22% x (83,900 - 50,400)   = 7,370.00
//                               ---------
//                               13,170.00
near(Calc.federalIncomeTax(83900, 'single'), 13170, 0.51, 'single $83,900 taxable -> $13,170');

// Married filing jointly, $167,800 taxable:
//   10% x 24,800              = 2,480.00
//   12% x (100,800 - 24,800)  = 9,120.00
//   22% x (167,800 - 100,800) = 14,740.00
//                               ---------
//                               26,340.00
near(Calc.federalIncomeTax(167800, 'married'), 26340, 0.51, 'MFJ $167,800 taxable -> $26,340');

near(Calc.federalIncomeTax(0, 'single'), 0, 0.01, 'zero taxable income -> no tax');
near(Calc.federalIncomeTax(12400, 'single'), 1240, 0.01, 'exactly the top of the 10% band');

// The breakdown must reconstruct the total exactly.
var bd = Calc.bracketBreakdown(233900, TaxData.FEDERAL_BRACKETS.single);
var bdSum = bd.reduce(function (a, b) { return a + b.tax; }, 0);
near(bdSum, Calc.federalIncomeTax(233900, 'single'), 0.01, 'bracket breakdown sums to the total');

eq(Calc.marginalRate(83900, TaxData.FEDERAL_BRACKETS.single), 0.22, 'marginal rate at $83,900 is 22%');
eq(Calc.marginalRate(2000000, TaxData.FEDERAL_BRACKETS.single), 0.37, 'top rate applies above $640,600');

/* ------------------------------------------------------------------ FICA -- */

suite('FICA — wage base cap and the Medicare surtax');

var fica = Calc.ficaTaxes(250000, 'single');
// SS caps at the 2026 wage base: 6.2% x 184,500 = 11,439.00
near(fica.socialSecurity, 11439, 0.51, 'Social Security caps at $11,439');
// Medicare has no cap: 1.45% x 250,000 = 3,625.00
near(fica.medicare, 3625, 0.51, 'Medicare 1.45% on all wages');
// Additional Medicare: 0.9% x (250,000 - 200,000) = 450.00
near(fica.additionalMedicare, 450, 0.51, 'additional Medicare 0.9% over $200k');

var ficaLow = Calc.ficaTaxes(50000, 'single');
near(ficaLow.socialSecurity, 3100, 0.51, 'below the wage base, SS is the full 6.2%');
near(ficaLow.additionalMedicare, 0, 0.01, 'no Medicare surtax below the threshold');

var ficaMfj = Calc.ficaTaxes(240000, 'married');
near(ficaMfj.additionalMedicare, 0, 0.01, 'MFJ surtax threshold is $250k, not $200k');

/* ------------------------------------------------------- Connecticut ------ */

suite('Connecticut — exemption phase-out, add-back and recapture');

// $100,000 CT AGI, single:
//   exemption fully phased out (15,000 - 70 x 1,000 -> 0)
//   2%   x 10,000  =   200.00
//   4.5% x 40,000  = 1,800.00
//   5.5% x 50,000  = 2,750.00
//                    --------
//                    4,750.00
//   add-back: ceil((100,000 - 56,500)/5,000) = 9 -> 9 x 20 = 180 (cap 200)
//                    --------
//                    4,930.00
near(Calc.connecticutTax(100000, 'single'), 4930, 0.51, 'CT single $100k -> $4,930');

// $300,000 CT AGI, single:
//   2% 200 + 4.5% 1,800 + 5.5% 2,750 + 6% 6,000 + 6.5% 3,250 + 6.9% 3,450 = 17,450
//   add-back capped at 200                                                 -> 17,650
//   recapture: ceil(100,000/5,000) = 20 -> 20 x 90 = 1,800 (cap 5,400)      -> 19,450
near(Calc.connecticutTax(300000, 'single'), 19450, 0.51, 'CT single $300k -> $19,450 incl. recapture');

// A low earner keeps the full exemption: 25,000 AGI - 15,000 exemption = 10,000 taxable
//   2% x 10,000 = 200, no add-back (below 56,500)
near(Calc.connecticutTax(25000, 'single'), 200, 0.51, 'CT single $25k keeps the full exemption');

ok(Calc.connecticutTax(600000, 'single') > Calc.connecticutTax(500000, 'single'),
  'CT tax keeps rising past the recapture cap');

/* ----------------------------------------------------------- whole model -- */

suite('End-to-end — $100,000 single in Connecticut');

var r = Calc.calculate({ salary: 100000, bonus: 0, retirement: 0, section125: 0, state: 'CT', status: 'single' });

near(r.gross, 100000, 0.01, 'gross is $100,000');
near(r.federalTaxableIncome, 83900, 0.01, 'taxable income = gross - $16,100 standard deduction');
near(r.federalTax, 13170, 0.51, 'federal tax $13,170');
near(r.fica.total, 7650, 0.51, 'FICA $7,650 (6,200 SS + 1,450 Medicare)');
near(r.stateTax, 4930, 0.51, 'CT income tax $4,930');
near(r.statePayrollTotal, 500, 0.51, 'CT paid-leave withholding 0.5% = $500');
// 13,170 + 7,650 + 4,930 + 500 = 26,250
near(r.totalTax, 26250, 1, 'total tax $26,250');
near(r.takeHome, 73750, 1, 'take-home $73,750');
near(r.effectiveRate, 0.2625, 0.0001, 'effective rate 26.25%');

suite('End-to-end — $250,000 single in Texas (no state tax)');

var tx = Calc.calculate({ salary: 250000, bonus: 0, retirement: 0, section125: 0, state: 'TX', status: 'single' });
// Federal taxable 233,900:
//   1,240 + 4,560 + 22% x 55,300 (12,166) + 24% x 96,075 (23,058) + 32% x 32,125 (10,280) = 51,304
near(tx.federalTax, 51304, 1, 'federal tax $51,304');
near(tx.stateTax, 0, 0.01, 'Texas has no income tax');
near(tx.fica.total, 15514, 1, 'FICA $15,514 with the SS cap and Medicare surtax');
near(tx.takeHome, 250000 - 51304 - 15514, 1, 'take-home nets out');

/* ------------------------------------------------- pre-tax deduction rules - */

suite('Pre-tax deductions — 401(k) vs Section 125 treated differently');

var base = { salary: 100000, bonus: 0, retirement: 0, section125: 0, state: 'TX', status: 'single' };
var with401k = Calc.calculate(Object.assign({}, base, { retirement: 10000 }));
var withHealth = Calc.calculate(Object.assign({}, base, { section125: 10000 }));

near(with401k.federalTaxableIncome, withHealth.federalTaxableIncome, 0.01,
  'both cut federal taxable income by the same $10,000');
near(with401k.federalTax, withHealth.federalTax, 0.51, 'so federal income tax matches');

near(with401k.ficaWages, 100000, 0.01, '401(k) money still pays FICA');
near(withHealth.ficaWages, 90000, 0.01, 'Section 125 money escapes FICA');
// 6.2% + 1.45% = 7.65% of the $10,000 difference = $765
near(with401k.fica.total - withHealth.fica.total, 765, 0.51,
  'the FICA gap is 7.65% of $10,000 = $765');

ok(withHealth.takeHome > with401k.takeHome, 'health premiums beat 401(k) on take-home, dollar for dollar');

suite('Pennsylvania taxes 401(k) deferrals; other states do not');

var pa = Calc.calculate({ salary: 100000, bonus: 0, retirement: 10000, section125: 0, state: 'PA', status: 'single' });
near(pa.stateWages, 100000, 0.01, 'PA state wages ignore the deferral');
near(pa.stateTax, 3070, 0.51, 'PA flat 3.07% on the full $100,000');

var nc = Calc.calculate({ salary: 100000, bonus: 0, retirement: 10000, section125: 0, state: 'NC', status: 'single' });
near(nc.stateWages, 90000, 0.01, 'NC state wages drop by the deferral');
// (90,000 - 12,750) x 3.99% = 3,082.28
near(nc.stateTax, 3082.28, 0.51, 'NC 3.99% after its standard deduction');

/* -------------------------------------------------------------- bonuses --- */

suite('Bonus is treated as ordinary annual income');

var noBonus = Calc.calculate({ salary: 100000, bonus: 0, retirement: 0, section125: 0, state: 'TX', status: 'single' });
var withBonus = Calc.calculate({ salary: 90000, bonus: 10000, retirement: 0, section125: 0, state: 'TX', status: 'single' });
near(withBonus.totalTax, noBonus.totalTax, 0.51, '$90k + $10k bonus taxes the same as $100k salary');
near(withBonus.gross, 100000, 0.01, 'bonus rolls into gross');

/* ----------------------------------------------------------- state quirks - */

suite('State rules');

var ms = Calc.calculate({ salary: 60000, bonus: 0, retirement: 0, section125: 0, state: 'MS', status: 'single' });
// Mississippi exempts the first $10,000: (60,000 - 10,000) x 4% = 2,000
near(ms.stateTax, 2000, 0.51, 'MS exempts the first $10,000, then 4%');

var oh = Calc.calculate({ salary: 60000, bonus: 0, retirement: 0, section125: 0, state: 'OH', status: 'single' });
// Ohio: nothing on the first 26,050, then 2.75% on 33,950 = 933.63
near(oh.stateTax, 933.63, 0.51, 'OH zero bracket then a single 2.75% rate');

var ma = Calc.calculate({ salary: 1500000, bonus: 0, retirement: 0, section125: 0, state: 'MA', status: 'single' });
// 5% on (1,500,000 - 4,400) = 74,780, plus 4% surtax on (1,500,000 - 1,109,000) = 15,640
near(ma.stateTax, 74780 + 15640, 1, 'MA adds the 4% millionaires surtax');

TaxData.FILING_STATUSES.forEach(function (st) {
  Object.keys(TaxData.STATES).forEach(function (code) {
    var out = Calc.calculate({ salary: 120000, bonus: 5000, retirement: 8000, section125: 3000, state: code, status: st.id });
    if (!(out.stateTax >= 0) || !isFinite(out.stateTax) || !isFinite(out.takeHome) || out.takeHome <= 0) {
      report(false, code + ' / ' + st.id + ' produces a sane result', 'finite, positive', out.stateTax + ' / ' + out.takeHome);
      throw new Error('bad state: ' + code);
    }
  });
});
report(true, 'every state x filing status produces a finite, positive take-home', '', '');

/* ------------------------------------------------------------ edge cases -- */

suite('Edge cases');

var zero = Calc.calculate({ salary: 0, bonus: 0, retirement: 0, section125: 0, state: 'CT', status: 'single' });
near(zero.takeHome, 0, 0.01, 'zero salary -> zero take-home, no NaN');
near(zero.totalTax, 0, 0.01, 'zero salary -> zero tax');

var junk = Calc.calculate({ salary: 'not a number', bonus: -500, retirement: null, section125: undefined, state: 'ZZ', status: 'nope' });
near(junk.gross, 0, 0.01, 'garbage input is coerced to zero, not NaN');
eq(junk.stateCode, null, 'an unknown state code falls back to no state tax');

var over = Calc.calculate({ salary: 50000, bonus: 0, retirement: 90000, section125: 0, state: 'TX', status: 'single' });
ok(over.preTaxTotal <= over.gross, 'pre-tax deductions cannot exceed gross pay');
ok(over.takeHome >= 0, 'take-home never goes negative');

var low = Calc.calculate({ salary: 14000, bonus: 0, retirement: 0, section125: 0, state: 'TX', status: 'single' });
near(low.federalTax, 0, 0.01, 'below the standard deduction there is no federal income tax');
ok(low.fica.total > 0, 'but FICA is still owed from dollar one');

/* ---------------------------------------------------------- derived views - */

suite('Derived views');

var freqs = Calc.allFrequencies(r);
eq(freqs.length, 5, 'five pay cadences');
near(freqs.filter(function (f) { return f.id === 'biweekly'; })[0].takeHome, r.takeHome / 26, 0.01,
  'bi-weekly take-home is the annual figure over 26');
near(freqs.filter(function (f) { return f.id === 'weekly'; })[0].gross, r.gross / 52, 0.01,
  'weekly gross is the annual figure over 52');

var per = Calc.perPeriod(r, 24);
near(per.gross - per.preTax - per.federalTax - per.stateTax - per.fica, per.takeHome, 0.01,
  'per-period lines reconcile to per-period take-home');

var curve = Calc.rateCurve({ salary: 100000, bonus: 0, retirement: 0, section125: 0, state: 'CT', status: 'single' }, 400000, 20);
ok(curve.length > 10, 'the rate curve produces points');
ok(curve[curve.length - 1].effectiveRate > curve[0].effectiveRate,
  'effective rate rises with salary across the curve');
ok(curve.every(function (p) { return p.marginalRate >= p.effectiveRate - 0.02; }),
  'marginal rate sits at or above the effective rate');

// The marginal-rate probe must see the Social Security cliff: just under the wage
// base the next dollar pays SS, well above it that 6.2% is gone.
var below = Calc.calculate({ salary: 150000, bonus: 0, retirement: 0, section125: 0, state: 'TX', status: 'single' });
var above = Calc.calculate({ salary: 400000, bonus: 0, retirement: 0, section125: 0, state: 'TX', status: 'single' });
ok(below.combinedMarginalRate > 0.28, 'below the SS wage base the marginal rate includes 6.2%');
ok(above.combinedMarginalRate < below.combinedMarginalRate + 0.10,
  'past the wage base the SS component drops out of the marginal rate');

/* ------------------------------------------------------------------ done -- */

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
