/*
 * calc.js — the paycheck engine.
 *
 * Pure functions, no DOM. Loaded as a global in the browser and require()'d by
 * the test suite, so the numbers the UI draws are the same numbers under test.
 *
 * The model, in order:
 *   1. Gross     = salary + bonus
 *   2. Pre-tax   = retirement deferral + Section 125 (health/HSA/FSA)
 *   3. FICA      is charged on gross MINUS Section 125 only. Retirement
 *                deferrals are NOT exempt from Social Security or Medicare.
 *   4. Federal   taxable income = gross - all pre-tax - standard deduction
 *   5. State     starts from gross - pre-tax (PA excepted: it taxes deferrals)
 *                then applies that state's own deduction/exemption/brackets.
 */

(function (root, factory) {
  var mod = factory(
    typeof module === 'object' && module.exports ? require('./tax-data.js') : root.TaxData
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Calc = mod;
})(typeof self !== 'undefined' ? self : this, function (TaxData) {
  'use strict';

  /**
   * Marginal tax over a bracket table. `brackets` are { upTo, rate } with upTo
   * being the top of the band.
   */
  function taxFromBrackets(income, brackets) {
    if (!(income > 0)) return 0;
    var tax = 0;
    var floor = 0;
    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      if (income <= floor) break;
      var slice = Math.min(income, b.upTo) - floor;
      if (slice > 0) tax += slice * b.rate;
      floor = b.upTo;
    }
    return tax;
  }

  /** Per-bracket breakdown, for the "how your tax is built" chart. */
  function bracketBreakdown(income, brackets) {
    var out = [];
    var floor = 0;
    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      var slice = Math.max(0, Math.min(income, b.upTo) - floor);
      out.push({
        rate: b.rate,
        from: floor,
        to: b.upTo,
        incomeInBracket: slice,
        tax: slice * b.rate
      });
      floor = b.upTo;
      if (income <= floor) break;
    }
    return out;
  }

  /** The rate the next dollar of taxable income would be charged. */
  function marginalRate(income, brackets) {
    for (var i = 0; i < brackets.length; i++) {
      if (income < brackets[i].upTo) return brackets[i].rate;
    }
    return brackets[brackets.length - 1].rate;
  }

  /* ----------------------------------------------------------------- federal */

  function federalIncomeTax(taxableIncome, status) {
    return taxFromBrackets(taxableIncome, TaxData.FEDERAL_BRACKETS[status]);
  }

  function ficaTaxes(ficaWages, status) {
    var f = TaxData.FICA;
    var socialSecurity = Math.min(ficaWages, f.socialSecurityWageBase) * f.socialSecurityRate;
    var medicare = ficaWages * f.medicareRate;
    var over = Math.max(0, ficaWages - f.additionalMedicareThreshold[status]);
    var additionalMedicare = over * f.additionalMedicareRate;
    return {
      socialSecurity: socialSecurity,
      medicare: medicare,
      additionalMedicare: additionalMedicare,
      total: socialSecurity + medicare + additionalMedicare
    };
  }

  /* ------------------------------------------------------------------- state */

  /**
   * Connecticut's return is not a plain bracket table. CGS 12-700 layers on a
   * personal exemption that phases out, an add-back that claws back the lowest
   * bracket's benefit, and a "benefit recapture" for high earners.
   */
  function connecticutTax(ctAgi, status) {
    var brackets = TaxData.STATES.CT.brackets[status];

    var exemptionBase = { single: 15000, married: 24000, hoh: 19000 }[status];
    var exemptionStart = { single: 30000, married: 48000, hoh: 38000 }[status];
    var steps = Math.ceil(Math.max(0, ctAgi - exemptionStart) / 1000);
    var exemption = Math.max(0, exemptionBase - steps * 1000);

    var taxableIncome = Math.max(0, ctAgi - exemption);
    var tax = taxFromBrackets(taxableIncome, brackets);

    // Low-bracket add-back: recaptures the benefit of the 2% band.
    var addBack = { single: 56500, married: 100500, hoh: 78500 }[status];
    var addBackPer = { single: 20, married: 40, hoh: 32 }[status];
    var addBackMax = { single: 200, married: 400, hoh: 320 }[status];
    if (ctAgi > addBack) {
      tax += Math.min(addBackMax, Math.ceil((ctAgi - addBack) / 5000) * addBackPer);
    }

    // Benefit recapture: phases out the lower brackets entirely for high earners.
    var recaptureStart = { single: 200000, married: 400000, hoh: 320000 }[status];
    var recapturePer = { single: 90, married: 180, hoh: 140 }[status];
    var recaptureMax = { single: 5400, married: 10800, hoh: 8400 }[status];
    if (ctAgi > recaptureStart) {
      tax += Math.min(recaptureMax, Math.ceil((ctAgi - recaptureStart) / 5000) * recapturePer);
    }

    return Math.max(0, tax);
  }

  /**
   * State income tax on wage income.
   * `stateWages` is gross minus the pre-tax deductions that state recognises.
   */
  function stateIncomeTax(stateCode, stateWages, status) {
    var st = TaxData.STATES[stateCode];
    if (!st || st.type === 'none') return 0;

    if (st.special === 'ct') return connecticutTax(stateWages, status);

    var deduction = (st.standardDeduction && st.standardDeduction[status]) || 0;
    var exemption = (st.personalExemption && st.personalExemption[status]) || 0;
    var taxable = Math.max(0, stateWages - deduction - exemption - (st.exemptAmount || 0));

    var tax;
    if (st.type === 'flat') {
      tax = taxable * st.rate;
      if (st.special === 'ma_surtax') {
        tax += Math.max(0, stateWages - 1109000) * 0.04;
      }
    } else {
      tax = taxFromBrackets(taxable, st.brackets[status]);
      if (st.special === 'ca_mhst') {
        tax += Math.max(0, taxable - 1000000) * 0.01;
      }
    }
    return Math.max(0, tax);
  }

  /** Employee-side disability / paid-family-leave withholding, if any. */
  function statePayrollTaxes(stateCode, wages) {
    var items = TaxData.STATE_PAYROLL[stateCode] || [];
    return items.map(function (item) {
      return {
        label: item.label,
        amount: Math.min(wages, item.wageCap) * item.rate
      };
    });
  }

  /* -------------------------------------------------------------- main entry */

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[$,\s]/g, ''));
    return isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * The whole model in one pass. `calculate` wraps this and adds the marginal
   * probe, which needs to run the model again — hence the split.
   *
   * @param {object} input
   *   salary      {number} annual base salary
   *   bonus       {number} annual bonus / commission
   *   retirement  {number} annual 401(k)/403(b) deferral (income-tax free, FICA-taxed)
   *   section125  {number} annual health/HSA/FSA premiums (income-tax AND FICA free)
   *   state       {string} two-letter code, e.g. 'CT'
   *   status      {string} 'single' | 'married' | 'hoh'
   */
  function runModel(input) {
    var salary = num(input.salary);
    var bonus = num(input.bonus);
    var retirement = num(input.retirement);
    var section125 = num(input.section125);
    var status = TaxData.FEDERAL_BRACKETS[input.status] ? input.status : 'single';
    var stateCode = TaxData.STATES[input.state] ? input.state : null;
    var st = stateCode ? TaxData.STATES[stateCode] : null;

    var gross = salary + bonus;

    // Pre-tax money can't exceed what you earn.
    section125 = Math.min(section125, gross);

    // Section 125 escapes FICA; 401(k) does not. FICA therefore depends only on
    // gross and Section 125, so it can be settled before the deferral is capped.
    var ficaWages = Math.max(0, gross - section125);
    var fica = ficaTaxes(ficaWages, status);

    // Payroll will not let you defer money that FICA has first claim on, so the
    // retirement deferral is capped at what is left after Social Security and
    // Medicare come out. Without this, a large deferral drives take-home negative.
    var deferralRoom = Math.max(0, gross - section125 - fica.total);
    var deferralCapped = retirement > deferralRoom;
    retirement = Math.min(retirement, deferralRoom);
    var preTaxTotal = retirement + section125;

    var federalStandardDeduction = TaxData.FEDERAL_STANDARD_DEDUCTION[status];
    var federalTaxableIncome = Math.max(0, gross - preTaxTotal - federalStandardDeduction);
    var federalTax = federalIncomeTax(federalTaxableIncome, status);

    // Pennsylvania taxes retirement deferrals, so they don't reduce state wages.
    var stateWages = st && st.taxesRetirementDeferral
      ? Math.max(0, gross - section125)
      : Math.max(0, gross - preTaxTotal);
    var stateTax = stateCode ? stateIncomeTax(stateCode, stateWages, status) : 0;

    var statePayroll = stateCode ? statePayrollTaxes(stateCode, ficaWages) : [];
    var statePayrollTotal = statePayroll.reduce(function (a, b) { return a + b.amount; }, 0);

    var totalTax = federalTax + stateTax + fica.total + statePayrollTotal;
    var takeHome = Math.max(0, gross - preTaxTotal - totalTax);

    return {
      gross: gross,
      deferralCapped: deferralCapped,
      salary: salary,
      bonus: bonus,
      retirement: retirement,
      section125: section125,
      preTaxTotal: preTaxTotal,

      federalStandardDeduction: federalStandardDeduction,
      federalTaxableIncome: federalTaxableIncome,
      federalTax: federalTax,
      federalBrackets: bracketBreakdown(federalTaxableIncome, TaxData.FEDERAL_BRACKETS[status]),
      federalMarginalRate: marginalRate(federalTaxableIncome, TaxData.FEDERAL_BRACKETS[status]),

      fica: fica,
      ficaWages: ficaWages,

      stateCode: stateCode,
      stateName: st ? st.name : 'No state selected',
      stateWages: stateWages,
      stateTax: stateTax,
      stateNotes: st ? st.notes : '',
      stateConfidence: st ? st.confidence : null,
      statePayroll: statePayroll,
      statePayrollTotal: statePayrollTotal,

      totalTax: totalTax,
      takeHome: takeHome,

      // Effective rate is measured against gross, the number on the offer letter.
      effectiveRate: gross > 0 ? totalTax / gross : 0,
      takeHomeRate: gross > 0 ? takeHome / gross : 0
    };
  }

  /**
   * The public entry point: the full model plus the true marginal rate.
   *
   * The marginal rate is measured, not looked up — re-run the model higher up
   * and diff the tax. That catches the Social Security wage-base cliff,
   * Connecticut's recapture and every phase-out, none of which a bracket
   * lookup would see.
   *
   * The probe is $5,000 wide rather than $1,000 on purpose. Several rules are
   * step functions charged per $5,000 of income (Connecticut's recapture and
   * add-back among them), so a narrower probe lands either side of a step and
   * reports a rate that swings wildly between neighbouring salaries. A $5,000
   * probe crosses exactly one step and returns the rate you actually feel.
   */
  function calculate(input) {
    var result = runModel(input);
    if (result.gross > 0) {
      var step = 5000;
      var bumped = runModel(Object.assign({}, input, { salary: num(input.salary) + step }));
      result.combinedMarginalRate = (bumped.totalTax - result.totalTax) / step;
    } else {
      result.combinedMarginalRate = 0;
    }
    return result;
  }

  /** Split an annual result across pay periods. */
  function perPeriod(result, periods) {
    return {
      gross: result.gross / periods,
      preTax: result.preTaxTotal / periods,
      federalTax: result.federalTax / periods,
      stateTax: (result.stateTax + result.statePayrollTotal) / periods,
      fica: result.fica.total / periods,
      takeHome: result.takeHome / periods
    };
  }

  /** Take-home at every pay cadence, for the summary table. */
  function allFrequencies(result) {
    return TaxData.PAY_FREQUENCIES.map(function (f) {
      return {
        id: f.id,
        label: f.label,
        note: f.note,
        periods: f.periods,
        gross: result.gross / f.periods,
        takeHome: result.takeHome / f.periods
      };
    });
  }

  /**
   * Effective- and marginal-rate curve across a salary range, for the rate chart.
   * Holds every other input fixed and sweeps base salary.
   */
  function rateCurve(input, maxSalary, points) {
    points = points || 40;
    var out = [];
    for (var i = 0; i <= points; i++) {
      var salary = (maxSalary / points) * i;
      if (salary <= 0) continue;
      var probe = Object.assign({}, input, { salary: salary });
      var r = calculate(probe);
      out.push({
        salary: salary,
        effectiveRate: r.effectiveRate,
        marginalRate: r.combinedMarginalRate,
        takeHome: r.takeHome
      });
    }
    return out;
  }

  return {
    calculate: calculate,
    perPeriod: perPeriod,
    allFrequencies: allFrequencies,
    rateCurve: rateCurve,
    taxFromBrackets: taxFromBrackets,
    bracketBreakdown: bracketBreakdown,
    marginalRate: marginalRate,
    federalIncomeTax: federalIncomeTax,
    ficaTaxes: ficaTaxes,
    stateIncomeTax: stateIncomeTax,
    connecticutTax: connecticutTax
  };
});
