# Paycheck & Finance

A browser app for working out what an annual salary actually pays you. Enter a
salary, a bonus, your pre-tax deductions and a state, and it breaks the year
down into take-home pay, federal tax, state tax and FICA — weekly, bi-weekly,
semi-monthly, monthly or annually.

Six tabs: **Health**, **Salary**, **Cash flow**, **Expenses**, **Life events**
and **Savings & investments**. Salary, Expenses and Life events feed the cash
flow ledger; Savings and Health read from it.

## Running it

No build step, no dependencies, no network calls. Open the file:

```
open finance-app/index.html
```

Or serve it if you prefer a real origin:

```
cd finance-app && python3 -m http.server 8000
```

## Tests

The calculation engine is a pure module with no DOM, so it runs under plain Node:

```
cd finance-app && npm test
```

430 assertions across six suites — 63 for the tax engine, 98 for the cash flow
ledger, 56 for savings, 67 for expenses, 83 for life events and the pay schedule,
63 for health. Expected values are worked out by hand from the published 2026
tables rather than read back out of the implementation.

## What it models

| Input | Effect |
|---|---|
| Annual salary | Ordinary wage income |
| Bonus / commission | Added to gross and taxed as ordinary income for the year |
| 401(k) / 403(b) | Cuts income tax, **not** FICA |
| Health / HSA / FSA | Cuts income tax **and** FICA (Section 125) |
| State | Brackets, flat rate or no tax, plus state disability/paid-leave withholding |
| Filing status | Single, married filing jointly, head of household |

The two pre-tax boxes are separate on purpose. Retirement deferrals still pay
Social Security and Medicare; Section 125 health premiums do not. Lumping them
together would overstate take-home for anyone with a 401(k) by about 7.65% of
their contribution.

### Rules the engine gets right that a flat "salary × rate" calculator misses

- **Marginal brackets.** Only the top slice of income pays the top rate.
- **Social Security wage base.** 6.2% stops at $184,500, so the marginal rate
  visibly drops there — you can see the cliff on the rate chart.
- **Additional Medicare.** 0.9% over $200,000 ($250,000 filing jointly).
- **Connecticut**, in full: the personal exemption phase-out, the low-bracket
  add-back and the high-income benefit recapture.
- **Pennsylvania** taxes 401(k) deferrals — the one state that does — so
  retirement contributions don't reduce PA tax.
- **Deferral ceiling.** You can't defer past what FICA claims first, so a very
  large 401(k) figure is capped rather than driving take-home negative.
- **Measured marginal rate.** The "next dollar" rate is found by re-running the
  whole model $5,000 higher and diffing, not by reading a bracket table — that's
  the only way to catch wage-base cliffs and recapture. The probe is $5,000 wide
  because several rules are step functions charged per $5,000; a narrower probe
  lands either side of a step and reports a rate that swings between neighbouring
  salaries.

## Data sources

Tax year **2026**.

- Federal brackets and the standard deduction: IRS Rev. Proc. 2025-32 (Oct 2025).
  Single, married-filing-jointly and head-of-household tables were each
  cross-checked against a published source.
- Social Security wage base $184,500 and the FICA rates: SSA / IRS Pub. 926.
- State rates: law in effect 1 January 2026, including the 2026 changes —
  Indiana 3.00 → 2.95%, Kentucky 4.00 → 3.50%, North Carolina 4.25 → 3.99%,
  Mississippi 4.40 → 4.00%, Georgia 5.19 → 4.99%, Ohio to a single 2.75% rate
  above $26,050, and New York's 0.1pt cut to the bottom five brackets.

Each state carries a `confidence` field in `js/tax-data.js`:

- `verified` — cross-checked against a published 2026 source while building.
- `indexed` — the rates and structure are right, but the bracket thresholds are
  inflation-projected for 2026 rather than copied from a published table, so
  cut-offs may be off by a little. The app says so in the state note when you
  pick one of these.

## Known limits

Deliberately out of scope, and called out in the app's footer:

- Tax credits (child tax credit, EITC, state low-income credits) and itemised
  deductions — standard deduction only.
- **City and county income taxes.** These are material in some places: NYC adds
  ~3–3.9%, every Maryland county adds 2.25–3.2%, and Ohio, Kentucky, Indiana,
  Michigan, Missouri and Pennsylvania all have local wage taxes. The state note
  flags this where it applies.
- Multi-state work, part-year residency, and non-wage income.
- Supplemental withholding. A bonus is usually withheld at a flat 22% on the day
  and trued up at filing; this shows the trued-up annual position, not the stub.
- Actual W-4 withholding, which depends on how you filled the form in.

Treat it as a planning estimate, not tax advice.

## Layout

```
finance-app/
├── index.html          markup and tab shell
├── styles.css          design tokens, light/dark, layout
├── js/
│   ├── tax-data.js     2026 federal + 50 states + DC parameters
│   ├── calc.js         the tax engine — pure, no DOM, testable
│   ├── cashflow.js     the shared ledger — pure, no DOM, testable
│   ├── savings.js      accounts and balance projection — pure, testable
│   ├── expenses.js     recurring expenses, inflation, buffer — pure, testable
│   ├── life-events.js  one-off lumpy money — pure, testable
│   ├── pay-schedule.js expected pay by year — pure, testable
│   ├── health.js       financial health metrics — pure, testable
│   ├── storage.js      save, restore, export — pure, testable
│   ├── charts.js       hand-rolled SVG charts, no chart library
│   ├── cashflow-ui.js  the cash flow tab: table, editor, charts
│   ├── savings-ui.js   the savings & investments tab
│   ├── expenses-ui.js  the expenses tab
│   ├── life-events-ui.js  the life events tab
│   ├── health-ui.js    the health tab and the data panel
│   └── app.js          salary tab wiring and rendering
└── test/
    ├── calc.test.js
    ├── cashflow.test.js
    ├── savings.test.js
    ├── expenses.test.js
    ├── life-events.test.js
    └── health.test.js
```

`tax-data.js` and `calc.js` export via UMD so the browser and the test suite run
the same code — the numbers on screen are the numbers under test.

## The cash flow ledger

`js/cashflow.js` is the shared spine the other tabs hang off. It holds a list of
**transactions** projected across a horizon of years: rows are transactions,
columns are years.

Two rules carry most of the weight.

### Carry-forward

A transaction's `amounts` map is **sparse**, keyed by year. A year with no entry
inherits the most recent earlier year that has one:

```js
{ label: 'Rent', cadence: 'monthly', amounts: { 2026: 2400, 2031: 2900 } }
// 2026-2030 -> 2,400/mo     2031 onward -> 2,900/mo
```

So you only type the years that change. In the table, a figure you set reads in
full-strength ink and an inherited one is muted, so the rule is visible rather
than something you have to remember. Clearing a cell reverts it to inheriting;
clearing the last remaining entry is refused, so a row can't be silently zeroed.

An optional per-transaction `growth` fills the gaps with a yearly increase, and
**re-anchors** on every explicit entry — a value you typed always means exactly
what it says.

### Derived vs manual rows

Other tabs don't write rows directly. They register a provider:

```js
CashFlowTab.registerSource('salary', function () {
  return [{ label: 'Take-home pay', group: 'Income', kind: 'income',
            cadence: 'annual', startYear: 2026, amounts: { 2026: 94000 } }];
});
```

On every refresh each provider is re-run and its rows **replace** the previous
batch from that source, so changing your salary can never leave a stale income
row behind. Derived rows are locked in the table — editing them by hand would be
silently overwritten on the next refresh. Only manual rows are hand-editable and
persisted to localStorage.

The Salary tab pushes exactly one row: **net take-home pay**, as income. See
"Not counting the same money twice" below for why it is only one.

### What it projects

Per year: income, expenses, net, and two running balances — `cumulativeNet`
(saved, no growth) and `balance` (compounded at `annualReturn`). It also reports
`shortfallYear`, the first year the balance goes negative.

Growth credits the opening balance plus **half** the year's net flow, since
contributions arrive spread across the year. Compounding the full contribution
would overstate returns by roughly half a year, every year.

Amounts are stored at the transaction's own cadence — a monthly row holds a
per-month figure — so entry stays natural and nothing goes stale if the cadence
changes.

## Savings & investments

Each account carries its own balance, contribution, expected return and — the
part that matters — **where the contribution comes from**:

| Type | Comes from | On the cash flow table? |
|---|---|---|
| 401(k) / 403(b), payroll HSA | Pre-tax payroll | **No** |
| IRA, brokerage, cash savings | Your take-home | **Yes**, as an outflow |

The 401(k) row is **mirrored from the Salary tab's pre-tax field** rather than
asked for twice, so there is one place to change it and no way for the two to
disagree. The employer match is the one thing this tab adds to it.

`fromPayroll` is a property of the account *type* and cannot be set by hand —
letting it be chosen freely would make double-counting a one-click mistake.

### Not counting the same money twice

Take-home pay is already net of tax, the 401(k) deferral and health premiums. So
the ledger takes **net take-home as the income line, and nothing else from the
Salary tab.**

An earlier version also pushed the 401(k) and health premiums through as outflow
rows. That subtracted the same money twice and understated every year's net — on
a $145k salary with a $12k deferral it reported $82k of net cash flow instead of
$94k. Payroll deductions now belong to the tab that owns them: the Savings tab
shows the 401(k) building a balance without ever touching cash flow.

Money invested **out of take-home** is a different case and does belong on the
table — it competes with the rest of your spending. Employer match never does:
it is money arriving, not leaving.

## Expenses

Every recurring outgoing lives here — this is where you type things in; the Cash
flow tab reads the result.

### Inflation, per expense with a shared default

Rent and groceries rarely climb at the same rate, so each expense may pin its own
rate. Leave the box blank and it follows the tab's default, which means changing
the default moves everything that has not been pinned — the common case.

`null` and `0` are deliberately different: `null` means "follow the default",
while a typed `0` pins the expense at 0% even when the default is 3%. Collapsing
those two would make it impossible to say "this one does not inflate".

### The safety buffer

One percentage padding the whole set, for the fact that budgets are optimistic.
It reaches the cash flow ledger as **its own row**, not folded into each expense,
so you can always see what the padding costs and take it back off. Silently
inflating every line would make the numbers untraceable.

The buffer row carries an **explicit amount for every year** rather than a single
growth rate. It has to: the expenses underneath it grow at different rates and
start and stop in different years, so a lone growth rate would drift away from
being a true percentage. It is recomputed against the real total each year.

## Overriding a derived row

The Cash flow tab takes its rows from the other tabs, but any single year can
still be typed over. That edit is stored as an **override** — kept separately,
keyed by transaction and year, and re-applied after every rebuild.

The result is that changing rent on the Expenses tab flows through to every year
*except* the one you pinned by hand. Clearing the cell hands that year back.
Overridden cells are marked with a rule as well as weight, so the distinction
survives a greyscale print.

## Life events

The lumpy stuff that lands in one year: a wedding, a car, a house deposit, an
inheritance. Same idea as Expenses, but each row belongs to a year rather than
recurring.

**Today's money vs then's money.** Tick *Inflate* and the amount is treated as
today's money and compounded to the year it lands in — a $100k deposit five years
out is budgeted at what you will actually have to find, and the uplift is
reported so the assumption stays visible.

**Spreading.** `spreadYears` repeats the amount for a run of years (three years of
tuition). One year becomes a `once` ledger row; more becomes an annual row
bounded by an end year.

## Pay growth

The Salary tab holds what you earn *today*. The pay table projects it forward:
every year grows at a default raise, and you can type a salary or bonus into any
year to pin it — a promotion, a jump, a step down. The raise then re-anchors and
carries on from the pinned figure.

Salary and bonus pin independently, since a promotion usually moves the bonus
target by a different amount than the base.

Each year's take-home is computed by running **the full tax model on that year's
pay**, not by escalating year one's take-home. Tax is progressive, so a raise does
not lift take-home proportionally — a flat growth rate on the net figure would
overstate every year after a promotion. Every year is taxed with 2026 rules, since
later brackets are not published; real brackets index with inflation, so tax in
later years is slightly overstated.

## Cash left over vs better off

The cash flow table ends with two different bottom lines, because they answer
different questions:

- **Net cash for the year** — what is left liquid after everything, including
  money moved into savings.
- **Net including savings** — the same figure with your contributions added back.
  Money moved into an investment account is not spent; it is still yours. This is
  the "how much better off am I" number.

Employer match is deliberately excluded from the add-back: it builds your balance
on the Savings tab but never passed through your hands, so counting it as retained
cash would misstate what you kept.

## Health

Seven ratios against the usual rules of thumb, each with the reasoning attached
so the number is never just a colour: savings rate, emergency fund, spending vs
take-home, housing share, whether the plan holds up, retirement progress against
25× spending, and effective tax rate for context.

Two rules keep the score honest:

- **A metric with no data reports `unknown` and is left out of the score
  entirely** — not scored zero. An empty app says "not enough to say yet"; it
  does not tell you your finances are broken because you have not typed anything.
- **Tax is reported, not scored.** Most of it is not a choice, so weighting it
  would punish you for your bracket.

Cards are ordered worst-first, so the thing to fix is at the top. Status colour
is never alone — every card carries a worded chip and a coloured rule.

## Saving your data

There is no server. The app is one file that runs entirely in your browser and
never sends anything anywhere, which is also why there is no Google or Apple
sign-in: OAuth needs a backend holding client secrets, and any such flow would
mean your salary leaving your machine. Persistence is done three ways instead:

| | What it survives | Effort |
|---|---|---|
| **Automatic** (localStorage) | Closing the tab, restarting the browser | none |
| **Backup file** (JSON) | Clearing your browser, moving machines | one click |
| **Restore link** (URL fragment) | Any device, no account | one click |

All three carry the same payload, so a file saved today opens from a link
tomorrow. Restoring clears existing keys first rather than merging — a
half-merged ledger would be worse than either version.

The backup uses the artifact `downloads` capability where the page has it, and
falls back to an ordinary blob download everywhere else.

## Mobile

The one that matters: **iOS Safari zooms the page whenever a focused control has
a font-size under 16px.** Every control is therefore 16px on coarse-pointer
devices. The usual shortcut — `maximum-scale=1` in the viewport tag — also stops
the zoom, by disabling pinch-zoom entirely, which breaks the page for anyone who
needs to magnify it. That is not a trade worth making, so it is not used here.

## Charts

Eight, all inline SVG with hover tooltips and keyboard focus:

1. **Where your gross pay goes** — one bar per component, single hue.
2. **How your federal tax is built** — tax generated inside each bracket, with
   your marginal bracket emphasised.
3. **Effective vs marginal rate** — both series on one axis (both are
   percentages), with a marker at your salary.
4. **Net cash flow by year** — diverging bars, surplus against shortfall, off a
   zero baseline.
5. **Projected balance** (Cash flow) — balance with growth against contributions
   alone, both in dollars on one axis, so the gap between them is exactly the
   compounding.
6. **Projected balance** (Savings) — the same treatment across all accounts.
7. **What it costs over time** (Expenses) — stacked bars, the buffer as a lighter
   band of the same hue on top, because it is padding on the bar beneath rather
   than a different kind of thing.
8. **When they land** (Life events) — diverging bars off a zero baseline, so the
   year that breaks a plan is the one that stands out.

Colors come from a palette validated for colour-blind separation and contrast in
both light and dark mode. An earlier draft used a stacked bar for chart 1; it was
dropped because in a no-income-tax state the state segment vanishes and put two
hues side by side that fail the separation floor.

## Single-file build

To get a version you can open by double-clicking (no server, no separate
CSS/JS files), bundle everything into one HTML file:

```
cd finance-app && node build-single-file.js
```

That writes `dist/paycheck-calculator.html` — around 90 KB, fully self-contained,
works offline. `--fragment` writes a version without the document wrapper for
hosts that supply their own.

The script list is **read out of `index.html`**, not hardcoded, and the build
fails if any file in `js/` is not loaded by the page. A hardcoded list had gone
stale once and shipped a bundle containing the Cash flow markup with none of its
code — a build that looked fine and did nothing.
