# Design — Weekly missed-break loading report (HIGA cl 16.6)

**Date:** 2026-09-03 · **Status:** designed (`feature/break-loading-report`)

---

## 1. What this is

The payroll counterpart to the Break Compliance board. `/breaks` tells a duty manager
who is *about* to cost 50% loading; this tells payroll what the venue *already owes*
for the week just gone, per person, per shift, with the clause and the arithmetic
attached.

It is production path item 2 from the [break compliance design](2026-09-02-break-compliance-design.md),
reached without item 1. That plan assumed assessments had to be persisted per shift
before a weekly report was possible. They don't: `assess()` already handles closed
shifts, so the report is a pure fold over a week of sessions.

The pitch line: *"Covers already told you who was about to cost you. On Monday it
tells payroll exactly what it cost, and which clause says so."*

---

## 2. Decisions taken

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Where the rules live | **Nowhere new — reuse `assess()`** | The engine already emits `MEAL_MISSED` and `MEAL_LATE_HISTORIC` with finite penalty blocks for closed shifts. A separate retrospective rules path would be a second implementation of cl 16.6 that could silently disagree with the board. |
| Persistence | **None. Fold sessions on demand** | Persisting assessments means the report can drift from the engine as rules change, and creates a migration burden the moment an award is amended. Sessions are the source of truth; the engine is pure; recomputing is cheap and always current. |
| Determinism | **Guaranteed by closed shifts** | Every shift in a past week has `clockOut` set, so `end = clockOut` and `now` cannot influence the result. Re-running the report yields byte-identical output — the property that makes it safe to hand to payroll. |
| Unpriced rows | **Hours always, dollars only when a rate is known** | `ordinaryHourlyRate` is null in live mode until `/pay-rates` is wired. Applying a default rate would put an invented, authoritative-looking number on a payroll document. Unpriced loading is reported in hours, never converted, and never folded into the money total. |
| Screen placement | **New `/reports/breaks` route** | A tab on `/breaks` would put a board that re-assesses every second and an immutable payroll artifact in one component tree, sharing a timer. Different audiences, different refresh semantics. |
| Export | **Real CSV, built in-browser from the report object** | Every other export in the console is a toast. Payroll needs a file. Generating it from the same `WeeklyBreakReport` the screen renders means the file and the page cannot drift. XLSX/PDF were rejected as new dependencies for no added payroll value. |
| Week assignment | **By clock-in date** | Hospitality close shifts cross midnight and cross week boundaries. Assigning by clock-in is a stated rule rather than an accident of comparison order. |
| Open shifts | **Excluded, and counted** | A shift clocked in but never clocked out has no defensible end, so assessing it would invent loading. Excluding it silently would understate the week, so `openShifts` is surfaced on the report. |

---

## 3. Shape (`lib/awards/report.ts`)

A row is a **breach**, not a shift. The fold keeps only assessments carrying a
penalty block, which is exactly the two retrospective codes:

- `MEAL_MISSED` — no meal on a >6h shift; loading runs deadline → clock-out
- `MEAL_LATE_HISTORIC` — meal taken after the 6h mark; loading runs deadline → meal start

```ts
interface BreachRow {
  name; role; siteName;
  shiftDate;                    // local YYYY-MM-DD, by clock-in
  clockIn; clockOut; hoursWorked;
  code; clause;                 // "16.6"
  loadingSec; loadingHours;
  hourlyRate:  number | null;
  loadingAud:  number | null;   // null ⇒ unpriced
}

interface WeeklyBreakReport {
  awardId; awardLabel; consolidatedTo;   // provenance rides on the artifact
  weekStart; weekEnd; weekLabel;         // "w/e 6 Sep 2026"
  rows; byPerson; bySite;
  totals: {
    shiftsAssessed; breaches;
    loadingHours;                        // all rows
    pricedAud; pricedRows;
    unpricedRows; unpricedHours;         // never folded into pricedAud
  };
  openShifts: number;
}
```

`pricedAud` sums only rows with a rate; `unpricedHours` sits beside it. The split is
enforced in the type, so the screen cannot accidentally total them together.

Only the meal clause carries the 50% loading. Rest shortfalls (16.7) produce alerts on
the board but never money here.

---

## 4. Screen and file

`/reports/breaks`, built from the existing `Card` / `CardHead` / `Badge` / `Button`
primitives. Week picker and venue filter drive the same pure fold; no ticking timer
anywhere on the page.

Banner states, shown only when they apply: *N of M rows have no hourly rate and are
excluded from the total*, and *N shifts still open, not assessed*.

CSV carries a title line and provenance, then one row per breach, then totals:

```
Break Loading — Brightwater Hotel — w/e 6 Sep 2026
MA000009 · Hospitality Industry (General) Award 2020 · consolidated 2024-08-27

name,role,shift_date,clock_in,clock_out,hours,breach,clause,loading_hrs,rate_aud,loading_aud
Darie Roberts,Bartender,2026-09-02,13:53,21:53,8.00,MEAL_MISSED,16.6,2.00,31.23,31.23

TOTAL (8 priced rows),,,,,,,,,,147.82
UNPRICED,,,,,,,,4.75,,
```

Fields are RFC 4180 escaped — a name or role containing a comma or quote is quoted and
its quotes doubled. Download is `Blob` → `createObjectURL` → anchor → revoke; no
dependencies. Export is disabled at zero breaches.

---

## 5. Failure mode that matters

A failed Connecteam fetch must never render as a clean zero. *"0 breaches this week"* is
a substantive payroll claim. On `mode: "error"` the page shows the unavailable state and
refuses to render a report or enable Export, matching the board's behaviour.

---

## 6. Not modelled

Rest-break shortfalls as a money figure (16.7 carries no loading), 16.7(b) overtime rest,
split shifts, junior rates, EBAs, and the Restaurant Award. Ordinary hourly rate still
comes from the session — wiring `/pay-rates` remains open, and until it lands, live-mode
reports will show loading hours with the money column empty.

> Not legal advice. Verify against current award text and any EBA before relying on
> these figures for payment.
