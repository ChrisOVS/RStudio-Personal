/*
 * tax-data.js — US federal and state payroll/income tax parameters for TAX YEAR 2026.
 *
 * Federal figures come from IRS Rev. Proc. 2025-32 (published Oct 2025) and the
 * SSA 2026 wage-base announcement. State figures reflect rates in effect
 * 1 Jan 2026, including the 2026 rate changes (IN 3.00->2.95, KY 4.00->3.50,
 * NC 4.25->3.99, MS 4.40->4.00, GA 5.19->4.99, OH to a single 2.75% rate,
 * NY's 0.1pt cut to the bottom five brackets).
 *
 * Every bracket entry is { upTo, rate } where `upTo` is the TOP of that bracket
 * (Infinity for the last one) and `rate` is a decimal fraction. Brackets are
 * marginal: you only pay a rate on the income inside its band.
 *
 * `confidence` per state:
 *   'verified'  - cross-checked against a published 2026 source while building
 *   'indexed'   - structure is right; thresholds are inflation-projected for 2026
 *
 * This is a planning tool, not tax advice. It models the common salaried case
 * and deliberately ignores credits, itemized deductions, local/city taxes,
 * multi-state allocation, and anything income-source specific.
 */

(function (root, factory) {
  var data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.TaxData = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAX_YEAR = 2026;

  /* ---------------------------------------------------------------- federal */

  // IRS Rev. Proc. 2025-32, tax year 2026.
  var FEDERAL_BRACKETS = {
    single: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ],
    married: [
      { upTo: 24800, rate: 0.10 },
      { upTo: 100800, rate: 0.12 },
      { upTo: 211400, rate: 0.22 },
      { upTo: 403550, rate: 0.24 },
      { upTo: 512450, rate: 0.32 },
      { upTo: 768700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ],
    hoh: [
      { upTo: 17700, rate: 0.10 },
      { upTo: 67450, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201750, rate: 0.24 },
      { upTo: 256200, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ]
  };

  var FEDERAL_STANDARD_DEDUCTION = {
    single: 16100,
    married: 32200,
    hoh: 24150
  };

  // FICA, 2026.
  var FICA = {
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 184500,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: {
      single: 200000,
      married: 250000,
      hoh: 200000
    }
  };

  var FILING_STATUSES = [
    { id: 'single', label: 'Single' },
    { id: 'married', label: 'Married, filing jointly' },
    { id: 'hoh', label: 'Head of household' }
  ];

  var PAY_FREQUENCIES = [
    { id: 'weekly', label: 'Weekly', periods: 52, note: '52 paychecks' },
    { id: 'biweekly', label: 'Bi-weekly', periods: 26, note: '26 paychecks (every 2 weeks)' },
    { id: 'semimonthly', label: 'Semi-monthly', periods: 24, note: '24 paychecks (twice a month)' },
    { id: 'monthly', label: 'Monthly', periods: 12, note: '12 paychecks' },
    { id: 'annual', label: 'Annual', periods: 1, note: 'full year' }
  ];

  /* ------------------------------------------------------------------ states */

  // Helper for the many states whose married brackets are exactly double single.
  function doubled(brackets) {
    return brackets.map(function (b) {
      return { upTo: b.upTo === Infinity ? Infinity : b.upTo * 2, rate: b.rate };
    });
  }

  function flat(name, rate, opts) {
    opts = opts || {};
    return {
      name: name,
      type: 'flat',
      rate: rate,
      exemptAmount: opts.exemptAmount || 0,
      standardDeduction: opts.standardDeduction || { single: 0, married: 0, hoh: 0 },
      personalExemption: opts.personalExemption || { single: 0, married: 0, hoh: 0 },
      taxesRetirementDeferral: !!opts.taxesRetirementDeferral,
      special: opts.special || null,
      confidence: opts.confidence || 'verified',
      notes: opts.notes || ''
    };
  }

  function none(name, notes) {
    return {
      name: name,
      type: 'none',
      confidence: 'verified',
      notes: notes || 'No state income tax on wages.'
    };
  }

  function graduated(name, brackets, opts) {
    opts = opts || {};
    return {
      name: name,
      type: 'brackets',
      brackets: brackets,
      standardDeduction: opts.standardDeduction || { single: 0, married: 0, hoh: 0 },
      personalExemption: opts.personalExemption || { single: 0, married: 0, hoh: 0 },
      taxesRetirementDeferral: !!opts.taxesRetirementDeferral,
      special: opts.special || null,
      confidence: opts.confidence || 'indexed',
      notes: opts.notes || ''
    };
  }

  var caSingle = [
    { upTo: 11047, rate: 0.01 },
    { upTo: 26187, rate: 0.02 },
    { upTo: 41332, rate: 0.04 },
    { upTo: 57374, rate: 0.06 },
    { upTo: 72512, rate: 0.08 },
    { upTo: 370397, rate: 0.093 },
    { upTo: 444472, rate: 0.103 },
    { upTo: 740790, rate: 0.113 },
    { upTo: Infinity, rate: 0.123 }
  ];

  var njSingle = [
    { upTo: 20000, rate: 0.014 },
    { upTo: 35000, rate: 0.0175 },
    { upTo: 40000, rate: 0.035 },
    { upTo: 75000, rate: 0.05525 },
    { upTo: 500000, rate: 0.0637 },
    { upTo: 1000000, rate: 0.0897 },
    { upTo: Infinity, rate: 0.1075 }
  ];

  var ctSingle = [
    { upTo: 10000, rate: 0.02 },
    { upTo: 50000, rate: 0.045 },
    { upTo: 100000, rate: 0.055 },
    { upTo: 200000, rate: 0.06 },
    { upTo: 250000, rate: 0.065 },
    { upTo: 500000, rate: 0.069 },
    { upTo: Infinity, rate: 0.0699 }
  ];

  var STATES = {
    AL: graduated('Alabama', {
      single: [{ upTo: 500, rate: 0.02 }, { upTo: 3000, rate: 0.04 }, { upTo: Infinity, rate: 0.05 }],
      married: [{ upTo: 1000, rate: 0.02 }, { upTo: 6000, rate: 0.04 }, { upTo: Infinity, rate: 0.05 }],
      hoh: [{ upTo: 500, rate: 0.02 }, { upTo: 3000, rate: 0.04 }, { upTo: Infinity, rate: 0.05 }]
    }, {
      standardDeduction: { single: 3000, married: 8500, hoh: 3000 },
      personalExemption: { single: 1500, married: 3000, hoh: 3000 },
      notes: 'Alabama standard deduction phases down at higher incomes; not modeled. Some cities levy an occupational tax.'
    }),

    AK: none('Alaska'),

    AZ: flat('Arizona', 0.025, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Flat 2.5%. Arizona matches the federal standard deduction.'
    }),

    AR: graduated('Arkansas', {
      single: [{ upTo: 5300, rate: 0.02 }, { upTo: 10600, rate: 0.03 }, { upTo: Infinity, rate: 0.039 }],
      married: [{ upTo: 5300, rate: 0.02 }, { upTo: 10600, rate: 0.03 }, { upTo: Infinity, rate: 0.039 }],
      hoh: [{ upTo: 5300, rate: 0.02 }, { upTo: 10600, rate: 0.03 }, { upTo: Infinity, rate: 0.039 }]
    }, {
      standardDeduction: { single: 2410, married: 4820, hoh: 2410 },
      notes: 'Top rate 3.9%. Low-income tax tables can reduce this further; not modeled.'
    }),

    CA: graduated('California', {
      single: caSingle,
      married: doubled(caSingle),
      hoh: [
        { upTo: 22107, rate: 0.01 },
        { upTo: 52400, rate: 0.02 },
        { upTo: 67548, rate: 0.04 },
        { upTo: 83593, rate: 0.06 },
        { upTo: 98737, rate: 0.08 },
        { upTo: 503896, rate: 0.093 },
        { upTo: 604696, rate: 0.103 },
        { upTo: 1007827, rate: 0.113 },
        { upTo: Infinity, rate: 0.123 }
      ]
    }, {
      standardDeduction: { single: 5706, married: 11412, hoh: 11412 },
      special: 'ca_mhst',
      notes: 'Plus a 1% Mental Health Services Tax on taxable income over $1,000,000 (13.3% top effective rate). Also 1.2% SDI on all wages, applied separately below. Bracket thresholds are inflation-projected for 2026.'
    }),

    CO: flat('Colorado', 0.044, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Flat 4.4% on federal taxable income, so the federal standard deduction carries over.'
    }),

    CT: graduated('Connecticut', {
      single: ctSingle,
      married: doubled(ctSingle),
      hoh: [
        { upTo: 16000, rate: 0.02 },
        { upTo: 80000, rate: 0.045 },
        { upTo: 160000, rate: 0.055 },
        { upTo: 320000, rate: 0.06 },
        { upTo: 400000, rate: 0.065 },
        { upTo: 800000, rate: 0.069 },
        { upTo: Infinity, rate: 0.0699 }
      ]
    }, {
      special: 'ct',
      confidence: 'verified',
      notes: 'Includes the personal exemption phase-out, the low-bracket add-back, and the high-income benefit recapture. The low-income personal tax credit is not modeled.'
    }),

    DE: graduated('Delaware', {
      single: [
        { upTo: 2000, rate: 0 }, { upTo: 5000, rate: 0.022 }, { upTo: 10000, rate: 0.039 },
        { upTo: 20000, rate: 0.048 }, { upTo: 25000, rate: 0.052 }, { upTo: 60000, rate: 0.0555 },
        { upTo: Infinity, rate: 0.066 }
      ],
      married: [
        { upTo: 2000, rate: 0 }, { upTo: 5000, rate: 0.022 }, { upTo: 10000, rate: 0.039 },
        { upTo: 20000, rate: 0.048 }, { upTo: 25000, rate: 0.052 }, { upTo: 60000, rate: 0.0555 },
        { upTo: Infinity, rate: 0.066 }
      ],
      hoh: [
        { upTo: 2000, rate: 0 }, { upTo: 5000, rate: 0.022 }, { upTo: 10000, rate: 0.039 },
        { upTo: 20000, rate: 0.048 }, { upTo: 25000, rate: 0.052 }, { upTo: 60000, rate: 0.0555 },
        { upTo: Infinity, rate: 0.066 }
      ]
    }, {
      standardDeduction: { single: 5700, married: 11400, hoh: 5700 },
      notes: 'Wilmington levies an additional 1.25% city wage tax; not modeled.'
    }),

    DC: graduated('District of Columbia', {
      single: [
        { upTo: 10000, rate: 0.04 }, { upTo: 40000, rate: 0.06 }, { upTo: 60000, rate: 0.065 },
        { upTo: 250000, rate: 0.085 }, { upTo: 500000, rate: 0.0925 }, { upTo: 1000000, rate: 0.0975 },
        { upTo: Infinity, rate: 0.1075 }
      ],
      married: [
        { upTo: 10000, rate: 0.04 }, { upTo: 40000, rate: 0.06 }, { upTo: 60000, rate: 0.065 },
        { upTo: 250000, rate: 0.085 }, { upTo: 500000, rate: 0.0925 }, { upTo: 1000000, rate: 0.0975 },
        { upTo: Infinity, rate: 0.1075 }
      ],
      hoh: [
        { upTo: 10000, rate: 0.04 }, { upTo: 40000, rate: 0.06 }, { upTo: 60000, rate: 0.065 },
        { upTo: 250000, rate: 0.085 }, { upTo: 500000, rate: 0.0925 }, { upTo: 1000000, rate: 0.0975 },
        { upTo: Infinity, rate: 0.1075 }
      ]
    }, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'DC matches the federal standard deduction.'
    }),

    FL: none('Florida'),

    GA: flat('Georgia', 0.0499, {
      standardDeduction: { single: 12000, married: 24000, hoh: 12000 },
      notes: 'Flat rate stepped down from 5.19% to 4.99% for 2026.'
    }),

    HI: graduated('Hawaii', {
      single: [
        { upTo: 9600, rate: 0.014 }, { upTo: 14400, rate: 0.032 }, { upTo: 19200, rate: 0.055 },
        { upTo: 24000, rate: 0.064 }, { upTo: 36000, rate: 0.068 }, { upTo: 48000, rate: 0.072 },
        { upTo: 125000, rate: 0.076 }, { upTo: 175000, rate: 0.079 }, { upTo: 225000, rate: 0.0825 },
        { upTo: 275000, rate: 0.09 }, { upTo: 325000, rate: 0.10 }, { upTo: Infinity, rate: 0.11 }
      ],
      married: [
        { upTo: 19200, rate: 0.014 }, { upTo: 28800, rate: 0.032 }, { upTo: 38400, rate: 0.055 },
        { upTo: 48000, rate: 0.064 }, { upTo: 72000, rate: 0.068 }, { upTo: 96000, rate: 0.072 },
        { upTo: 250000, rate: 0.076 }, { upTo: 350000, rate: 0.079 }, { upTo: 450000, rate: 0.0825 },
        { upTo: 550000, rate: 0.09 }, { upTo: 650000, rate: 0.10 }, { upTo: Infinity, rate: 0.11 }
      ],
      hoh: [
        { upTo: 14400, rate: 0.014 }, { upTo: 21600, rate: 0.032 }, { upTo: 28800, rate: 0.055 },
        { upTo: 36000, rate: 0.064 }, { upTo: 54000, rate: 0.068 }, { upTo: 72000, rate: 0.072 },
        { upTo: 187500, rate: 0.076 }, { upTo: 262500, rate: 0.079 }, { upTo: 337500, rate: 0.0825 },
        { upTo: 412500, rate: 0.09 }, { upTo: 487500, rate: 0.10 }, { upTo: Infinity, rate: 0.11 }
      ]
    }, {
      standardDeduction: { single: 8000, married: 16000, hoh: 12000 },
      notes: 'Hawaii is mid-way through a multi-year bracket widening; thresholds are projected for 2026.'
    }),

    ID: flat('Idaho', 0.053, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Flat 5.3%. Idaho matches the federal standard deduction.'
    }),

    IL: flat('Illinois', 0.0495, {
      personalExemption: { single: 2925, married: 5850, hoh: 2925 },
      notes: 'Flat 4.95%. The personal exemption is unavailable above roughly $250k single / $500k joint; not modeled.'
    }),

    IN: flat('Indiana', 0.0295, {
      personalExemption: { single: 1000, married: 2000, hoh: 1000 },
      notes: 'State rate dropped to 2.95% for 2026. Counties add their own rate (roughly 0.5%-3%); not included.'
    }),

    IA: flat('Iowa', 0.038, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Flat 3.8% since 2025.'
    }),

    KS: graduated('Kansas', {
      single: [{ upTo: 23000, rate: 0.052 }, { upTo: Infinity, rate: 0.0558 }],
      married: [{ upTo: 46000, rate: 0.052 }, { upTo: Infinity, rate: 0.0558 }],
      hoh: [{ upTo: 23000, rate: 0.052 }, { upTo: Infinity, rate: 0.0558 }]
    }, {
      standardDeduction: { single: 3605, married: 8240, hoh: 6180 },
      personalExemption: { single: 18320, married: 36640, hoh: 18320 },
      notes: 'Kansas exempts a large fixed amount before the two brackets apply.'
    }),

    KY: flat('Kentucky', 0.035, {
      standardDeduction: { single: 3570, married: 7140, hoh: 3570 },
      notes: 'Flat rate cut from 4.0% to 3.5% for 2026. Many localities add an occupational tax; not included.'
    }),

    LA: flat('Louisiana', 0.03, {
      standardDeduction: { single: 12500, married: 25000, hoh: 12500 },
      notes: 'Flat 3% since 2025.'
    }),

    ME: graduated('Maine', {
      single: [{ upTo: 27000, rate: 0.058 }, { upTo: 64000, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
      married: [{ upTo: 54000, rate: 0.058 }, { upTo: 128000, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
      hoh: [{ upTo: 40500, rate: 0.058 }, { upTo: 96000, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }]
    }, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Standard deduction phases out at high incomes; not modeled.'
    }),

    MD: graduated('Maryland', {
      single: [
        { upTo: 1000, rate: 0.02 }, { upTo: 2000, rate: 0.03 }, { upTo: 3000, rate: 0.04 },
        { upTo: 100000, rate: 0.0475 }, { upTo: 125000, rate: 0.05 }, { upTo: 150000, rate: 0.0525 },
        { upTo: 250000, rate: 0.055 }, { upTo: Infinity, rate: 0.0575 }
      ],
      married: [
        { upTo: 1000, rate: 0.02 }, { upTo: 2000, rate: 0.03 }, { upTo: 3000, rate: 0.04 },
        { upTo: 150000, rate: 0.0475 }, { upTo: 175000, rate: 0.05 }, { upTo: 225000, rate: 0.0525 },
        { upTo: 300000, rate: 0.055 }, { upTo: Infinity, rate: 0.0575 }
      ],
      hoh: [
        { upTo: 1000, rate: 0.02 }, { upTo: 2000, rate: 0.03 }, { upTo: 3000, rate: 0.04 },
        { upTo: 150000, rate: 0.0475 }, { upTo: 175000, rate: 0.05 }, { upTo: 225000, rate: 0.0525 },
        { upTo: 300000, rate: 0.055 }, { upTo: Infinity, rate: 0.0575 }
      ]
    }, {
      standardDeduction: { single: 2700, married: 5450, hoh: 5450 },
      personalExemption: { single: 3200, married: 6400, hoh: 3200 },
      notes: 'Every Maryland county adds a local income tax of roughly 2.25%-3.20%; NOT included here, so real Maryland tax is meaningfully higher.'
    }),

    MA: flat('Massachusetts', 0.05, {
      personalExemption: { single: 4400, married: 8800, hoh: 6800 },
      special: 'ma_surtax',
      notes: 'Flat 5%, plus a 4% surtax on income above roughly $1.11M (the "millionaires tax").'
    }),

    MI: flat('Michigan', 0.0425, {
      personalExemption: { single: 5950, married: 11900, hoh: 5950 },
      notes: 'Flat 4.25%. Several cities (Detroit, Grand Rapids, others) add a local income tax; not included.'
    }),

    MN: graduated('Minnesota', {
      single: [{ upTo: 32570, rate: 0.0535 }, { upTo: 106990, rate: 0.068 }, { upTo: 198630, rate: 0.0785 }, { upTo: Infinity, rate: 0.0985 }],
      married: [{ upTo: 47620, rate: 0.0535 }, { upTo: 189180, rate: 0.068 }, { upTo: 330410, rate: 0.0785 }, { upTo: Infinity, rate: 0.0985 }],
      hoh: [{ upTo: 40100, rate: 0.0535 }, { upTo: 161080, rate: 0.068 }, { upTo: 264530, rate: 0.0785 }, { upTo: Infinity, rate: 0.0985 }]
    }, {
      standardDeduction: { single: 15150, married: 30300, hoh: 22750 },
      notes: 'Thresholds inflation-projected for 2026.'
    }),

    MS: flat('Mississippi', 0.04, {
      exemptAmount: 10000,
      notes: 'Flat 4% for 2026 (down from 4.4%), and the first $10,000 of taxable income is exempt.'
    }),

    MO: graduated('Missouri', {
      single: [
        { upTo: 1340, rate: 0 }, { upTo: 2680, rate: 0.02 }, { upTo: 4020, rate: 0.025 },
        { upTo: 5360, rate: 0.03 }, { upTo: 6700, rate: 0.035 }, { upTo: 8040, rate: 0.04 },
        { upTo: 9380, rate: 0.045 }, { upTo: Infinity, rate: 0.047 }
      ],
      married: [
        { upTo: 1340, rate: 0 }, { upTo: 2680, rate: 0.02 }, { upTo: 4020, rate: 0.025 },
        { upTo: 5360, rate: 0.03 }, { upTo: 6700, rate: 0.035 }, { upTo: 8040, rate: 0.04 },
        { upTo: 9380, rate: 0.045 }, { upTo: Infinity, rate: 0.047 }
      ],
      hoh: [
        { upTo: 1340, rate: 0 }, { upTo: 2680, rate: 0.02 }, { upTo: 4020, rate: 0.025 },
        { upTo: 5360, rate: 0.03 }, { upTo: 6700, rate: 0.035 }, { upTo: 8040, rate: 0.04 },
        { upTo: 9380, rate: 0.045 }, { upTo: Infinity, rate: 0.047 }
      ]
    }, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Kansas City and St. Louis each levy a 1% earnings tax; not included.'
    }),

    MT: graduated('Montana', {
      single: [{ upTo: 21100, rate: 0.047 }, { upTo: Infinity, rate: 0.059 }],
      married: [{ upTo: 42200, rate: 0.047 }, { upTo: Infinity, rate: 0.059 }],
      hoh: [{ upTo: 31700, rate: 0.047 }, { upTo: Infinity, rate: 0.059 }]
    }, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'Thresholds inflation-projected for 2026.'
    }),

    NE: graduated('Nebraska', {
      single: [{ upTo: 4030, rate: 0.0246 }, { upTo: 24120, rate: 0.0351 }, { upTo: 38870, rate: 0.0501 }, { upTo: Infinity, rate: 0.0499 }],
      married: [{ upTo: 8060, rate: 0.0246 }, { upTo: 48240, rate: 0.0351 }, { upTo: 77740, rate: 0.0501 }, { upTo: Infinity, rate: 0.0499 }],
      hoh: [{ upTo: 7530, rate: 0.0246 }, { upTo: 38700, rate: 0.0351 }, { upTo: 57840, rate: 0.0501 }, { upTo: Infinity, rate: 0.0499 }]
    }, {
      standardDeduction: { single: 8300, married: 16600, hoh: 12200 },
      notes: 'Nebraska is phasing its top rate down toward 3.99%; thresholds projected for 2026.'
    }),

    NV: none('Nevada'),

    NH: none('New Hampshire', 'No tax on wages. The interest-and-dividends tax was fully repealed as of 2025.'),

    NJ: graduated('New Jersey', {
      single: njSingle,
      married: [
        { upTo: 20000, rate: 0.014 },
        { upTo: 50000, rate: 0.0175 },
        { upTo: 70000, rate: 0.0245 },
        { upTo: 80000, rate: 0.035 },
        { upTo: 150000, rate: 0.05525 },
        { upTo: 500000, rate: 0.0637 },
        { upTo: 1000000, rate: 0.0897 },
        { upTo: Infinity, rate: 0.1075 }
      ],
      hoh: [
        { upTo: 20000, rate: 0.014 },
        { upTo: 50000, rate: 0.0175 },
        { upTo: 70000, rate: 0.0245 },
        { upTo: 80000, rate: 0.035 },
        { upTo: 150000, rate: 0.05525 },
        { upTo: 500000, rate: 0.0637 },
        { upTo: 1000000, rate: 0.0897 },
        { upTo: Infinity, rate: 0.1075 }
      ]
    }, {
      personalExemption: { single: 1000, married: 2000, hoh: 1000 },
      confidence: 'verified',
      notes: 'New Jersey also withholds UI/WF/SWF, disability and family-leave contributions (well under 1% combined); not included.'
    }),

    NM: graduated('New Mexico', {
      single: [
        { upTo: 5500, rate: 0.015 }, { upTo: 16500, rate: 0.032 }, { upTo: 33500, rate: 0.043 },
        { upTo: 66500, rate: 0.047 }, { upTo: 210000, rate: 0.049 }, { upTo: Infinity, rate: 0.059 }
      ],
      married: [
        { upTo: 8000, rate: 0.015 }, { upTo: 25000, rate: 0.032 }, { upTo: 50000, rate: 0.043 },
        { upTo: 100000, rate: 0.047 }, { upTo: 315000, rate: 0.049 }, { upTo: Infinity, rate: 0.059 }
      ],
      hoh: [
        { upTo: 8000, rate: 0.015 }, { upTo: 25000, rate: 0.032 }, { upTo: 50000, rate: 0.043 },
        { upTo: 100000, rate: 0.047 }, { upTo: 315000, rate: 0.049 }, { upTo: Infinity, rate: 0.059 }
      ]
    }, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'New Mexico matches the federal standard deduction.'
    }),

    NY: graduated('New York', {
      single: [
        { upTo: 8500, rate: 0.04 }, { upTo: 11700, rate: 0.045 }, { upTo: 13900, rate: 0.0525 },
        { upTo: 80650, rate: 0.055 }, { upTo: 215400, rate: 0.06 }, { upTo: 1077550, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 }, { upTo: 25000000, rate: 0.103 }, { upTo: Infinity, rate: 0.109 }
      ],
      married: [
        { upTo: 17150, rate: 0.04 }, { upTo: 23600, rate: 0.045 }, { upTo: 27900, rate: 0.0525 },
        { upTo: 161550, rate: 0.055 }, { upTo: 323200, rate: 0.06 }, { upTo: 2155350, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 }, { upTo: 25000000, rate: 0.103 }, { upTo: Infinity, rate: 0.109 }
      ],
      hoh: [
        { upTo: 12800, rate: 0.04 }, { upTo: 17650, rate: 0.045 }, { upTo: 20900, rate: 0.0525 },
        { upTo: 107650, rate: 0.055 }, { upTo: 269300, rate: 0.06 }, { upTo: 1616450, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 }, { upTo: 25000000, rate: 0.103 }, { upTo: Infinity, rate: 0.109 }
      ]
    }, {
      standardDeduction: { single: 8000, married: 16050, hoh: 11200 },
      confidence: 'verified',
      notes: 'The bottom five rates were each cut 0.1pt for 2026. New York City residents owe an extra ~3.0%-3.9% city tax; not included.'
    }),

    NC: flat('North Carolina', 0.0399, {
      standardDeduction: { single: 12750, married: 25500, hoh: 19125 },
      notes: 'Flat rate stepped down from 4.25% to 3.99% for 2026.'
    }),

    ND: graduated('North Dakota', {
      single: [{ upTo: 48475, rate: 0 }, { upTo: 244825, rate: 0.0195 }, { upTo: Infinity, rate: 0.025 }],
      married: [{ upTo: 80975, rate: 0 }, { upTo: 298075, rate: 0.0195 }, { upTo: Infinity, rate: 0.025 }],
      hoh: [{ upTo: 64950, rate: 0 }, { upTo: 271450, rate: 0.0195 }, { upTo: Infinity, rate: 0.025 }]
    }, {
      notes: 'North Dakota exempts a large first bracket outright; thresholds projected for 2026.'
    }),

    OH: graduated('Ohio', {
      single: [{ upTo: 26050, rate: 0 }, { upTo: Infinity, rate: 0.0275 }],
      married: [{ upTo: 26050, rate: 0 }, { upTo: Infinity, rate: 0.0275 }],
      hoh: [{ upTo: 26050, rate: 0 }, { upTo: Infinity, rate: 0.0275 }]
    }, {
      confidence: 'verified',
      notes: 'Ohio consolidated to a single 2.75% rate for 2026, with income at or below $26,050 untaxed. Most Ohio cities add a 1%-3% municipal income tax; not included.'
    }),

    OK: graduated('Oklahoma', {
      single: [
        { upTo: 1000, rate: 0.0025 }, { upTo: 2500, rate: 0.0075 }, { upTo: 3750, rate: 0.0175 },
        { upTo: 4900, rate: 0.0275 }, { upTo: 7200, rate: 0.0375 }, { upTo: Infinity, rate: 0.0475 }
      ],
      married: [
        { upTo: 2000, rate: 0.0025 }, { upTo: 5000, rate: 0.0075 }, { upTo: 7500, rate: 0.0175 },
        { upTo: 9800, rate: 0.0275 }, { upTo: 12200, rate: 0.0375 }, { upTo: Infinity, rate: 0.0475 }
      ],
      hoh: [
        { upTo: 2000, rate: 0.0025 }, { upTo: 5000, rate: 0.0075 }, { upTo: 7500, rate: 0.0175 },
        { upTo: 9800, rate: 0.0275 }, { upTo: 12200, rate: 0.0375 }, { upTo: Infinity, rate: 0.0475 }
      ]
    }, {
      standardDeduction: { single: 6350, married: 12700, hoh: 9350 },
      notes: 'Top rate 4.75%.'
    }),

    OR: graduated('Oregon', {
      single: [{ upTo: 4400, rate: 0.0475 }, { upTo: 11050, rate: 0.0675 }, { upTo: 125000, rate: 0.0875 }, { upTo: Infinity, rate: 0.099 }],
      married: [{ upTo: 8800, rate: 0.0475 }, { upTo: 22100, rate: 0.0675 }, { upTo: 250000, rate: 0.0875 }, { upTo: Infinity, rate: 0.099 }],
      hoh: [{ upTo: 8800, rate: 0.0475 }, { upTo: 22100, rate: 0.0675 }, { upTo: 250000, rate: 0.0875 }, { upTo: Infinity, rate: 0.099 }]
    }, {
      standardDeduction: { single: 2900, married: 5800, hoh: 4670 },
      notes: 'Portland-area residents also pay Metro SHS and Multnomah County PFA taxes; not included.'
    }),

    PA: flat('Pennsylvania', 0.0307, {
      taxesRetirementDeferral: true,
      notes: 'Flat 3.07% with no standard deduction. Pennsylvania is the one state that taxes 401(k)/403(b) elective deferrals, so retirement contributions do NOT reduce PA tax. Philadelphia and other municipalities add a local wage tax; not included.'
    }),

    RI: graduated('Rhode Island', {
      single: [{ upTo: 81900, rate: 0.0375 }, { upTo: 186050, rate: 0.0475 }, { upTo: Infinity, rate: 0.0599 }],
      married: [{ upTo: 81900, rate: 0.0375 }, { upTo: 186050, rate: 0.0475 }, { upTo: Infinity, rate: 0.0599 }],
      hoh: [{ upTo: 81900, rate: 0.0375 }, { upTo: 186050, rate: 0.0475 }, { upTo: Infinity, rate: 0.0599 }]
    }, {
      standardDeduction: { single: 11250, married: 22500, hoh: 16875 },
      notes: 'Thresholds inflation-projected for 2026.'
    }),

    SC: graduated('South Carolina', {
      single: [{ upTo: 3560, rate: 0 }, { upTo: 17830, rate: 0.03 }, { upTo: Infinity, rate: 0.062 }],
      married: [{ upTo: 3560, rate: 0 }, { upTo: 17830, rate: 0.03 }, { upTo: Infinity, rate: 0.062 }],
      hoh: [{ upTo: 3560, rate: 0 }, { upTo: 17830, rate: 0.03 }, { upTo: Infinity, rate: 0.062 }]
    }, {
      standardDeduction: { single: 16100, married: 32200, hoh: 24150 },
      notes: 'South Carolina is phasing its top rate down; thresholds projected for 2026.'
    }),

    SD: none('South Dakota'),

    TN: none('Tennessee'),

    TX: none('Texas'),

    UT: flat('Utah', 0.045, {
      notes: 'Flat 4.5% on federal AGI with no standard deduction. A taxpayer credit reduces tax at lower incomes and phases out; not modeled.'
    }),

    VT: graduated('Vermont', {
      single: [{ upTo: 47900, rate: 0.0335 }, { upTo: 116000, rate: 0.066 }, { upTo: 242000, rate: 0.076 }, { upTo: Infinity, rate: 0.0875 }],
      married: [{ upTo: 79950, rate: 0.0335 }, { upTo: 193300, rate: 0.066 }, { upTo: 294600, rate: 0.076 }, { upTo: Infinity, rate: 0.0875 }],
      hoh: [{ upTo: 64150, rate: 0.0335 }, { upTo: 165600, rate: 0.066 }, { upTo: 268300, rate: 0.076 }, { upTo: Infinity, rate: 0.0875 }]
    }, {
      standardDeduction: { single: 7400, married: 14850, hoh: 7400 },
      personalExemption: { single: 5100, married: 10200, hoh: 5100 },
      notes: 'Thresholds inflation-projected for 2026.'
    }),

    VA: graduated('Virginia', {
      single: [{ upTo: 3000, rate: 0.02 }, { upTo: 5000, rate: 0.03 }, { upTo: 17000, rate: 0.05 }, { upTo: Infinity, rate: 0.0575 }],
      married: [{ upTo: 3000, rate: 0.02 }, { upTo: 5000, rate: 0.03 }, { upTo: 17000, rate: 0.05 }, { upTo: Infinity, rate: 0.0575 }],
      hoh: [{ upTo: 3000, rate: 0.02 }, { upTo: 5000, rate: 0.03 }, { upTo: 17000, rate: 0.05 }, { upTo: Infinity, rate: 0.0575 }]
    }, {
      standardDeduction: { single: 8500, married: 17000, hoh: 8500 },
      personalExemption: { single: 930, married: 1860, hoh: 930 },
      notes: 'Virginia\'s top rate starts at just $17,000, so most salaries are effectively at 5.75%.'
    }),

    WA: none('Washington', 'No tax on wages. Washington taxes long-term capital gains only.'),

    WV: graduated('West Virginia', {
      single: [{ upTo: 10000, rate: 0.0209 }, { upTo: 25000, rate: 0.0296 }, { upTo: 40000, rate: 0.0333 }, { upTo: 60000, rate: 0.0444 }, { upTo: Infinity, rate: 0.0482 }],
      married: [{ upTo: 10000, rate: 0.0209 }, { upTo: 25000, rate: 0.0296 }, { upTo: 40000, rate: 0.0333 }, { upTo: 60000, rate: 0.0444 }, { upTo: Infinity, rate: 0.0482 }],
      hoh: [{ upTo: 10000, rate: 0.0209 }, { upTo: 25000, rate: 0.0296 }, { upTo: 40000, rate: 0.0333 }, { upTo: 60000, rate: 0.0444 }, { upTo: Infinity, rate: 0.0482 }]
    }, {
      personalExemption: { single: 2000, married: 4000, hoh: 2000 },
      notes: 'West Virginia is phasing rates down; 2026 rates are projected.'
    }),

    WI: graduated('Wisconsin', {
      single: [{ upTo: 14680, rate: 0.035 }, { upTo: 29370, rate: 0.044 }, { upTo: 323290, rate: 0.053 }, { upTo: Infinity, rate: 0.0765 }],
      married: [{ upTo: 19580, rate: 0.035 }, { upTo: 39150, rate: 0.044 }, { upTo: 431060, rate: 0.053 }, { upTo: Infinity, rate: 0.0765 }],
      hoh: [{ upTo: 14680, rate: 0.035 }, { upTo: 29370, rate: 0.044 }, { upTo: 323290, rate: 0.053 }, { upTo: Infinity, rate: 0.0765 }]
    }, {
      standardDeduction: { single: 13930, married: 25780, hoh: 17980 },
      notes: 'Wisconsin\'s standard deduction phases out as income rises; not modeled.'
    }),

    WY: none('Wyoming')
  };

  /* -------------------------------------------- state-specific payroll taxes */

  // Employee-side state disability / paid-leave withholding on wages. These show
  // up on a real paycheck, so leaving them out would overstate take-home.
  var STATE_PAYROLL = {
    CA: [{ label: 'CA SDI', rate: 0.012, wageCap: Infinity }],
    NY: [{ label: 'NY PFL', rate: 0.00388, wageCap: 91373 }],
    NJ: [{ label: 'NJ FLI/UI', rate: 0.0041, wageCap: 165400 }],
    RI: [{ label: 'RI TDI', rate: 0.011, wageCap: 89200 }],
    WA: [{ label: 'WA Paid Leave', rate: 0.0092, wageCap: 184500 }],
    MA: [{ label: 'MA PFML', rate: 0.0046, wageCap: 184500 }],
    CT: [{ label: 'CT Paid Leave', rate: 0.005, wageCap: 184500 }],
    OR: [{ label: 'OR Paid Leave', rate: 0.006, wageCap: 184500 }],
    CO: [{ label: 'CO FAMLI', rate: 0.0045, wageCap: 184500 }],
    MD: [{ label: 'MD FAMLI', rate: 0.005, wageCap: 184500 }],
    DE: [{ label: 'DE Paid Leave', rate: 0.0039, wageCap: 184500 }],
    ME: [{ label: 'ME Paid Leave', rate: 0.005, wageCap: 184500 }],
    MN: [{ label: 'MN Paid Leave', rate: 0.0044, wageCap: 184500 }],
    HI: [{ label: 'HI TDI', rate: 0.005, wageCap: 74000 }]
  };

  return {
    TAX_YEAR: TAX_YEAR,
    FEDERAL_BRACKETS: FEDERAL_BRACKETS,
    FEDERAL_STANDARD_DEDUCTION: FEDERAL_STANDARD_DEDUCTION,
    FICA: FICA,
    FILING_STATUSES: FILING_STATUSES,
    PAY_FREQUENCIES: PAY_FREQUENCIES,
    STATES: STATES,
    STATE_PAYROLL: STATE_PAYROLL
  };
});
