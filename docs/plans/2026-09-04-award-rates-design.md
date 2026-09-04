# Design — Award rates: what a shift must pay

**Date:** 2026-09-04 · **Status:** implemented

---

## 1. What this is

`lib/awards/rates.ts` — the second half of the awards pack. `higa.ts` answers *what is
owed in time* (breaks, and the 50% loading when they are missed). This answers *what is
owed in money*: the minimum lawful rate for a given person on a given shift, hour by hour.

It is the module every dollar figure in the marketplace was waiting on. Until now
`ordinaryHourlyRate` was a hand-typed number on a seed row — `31.23`, `28.87`, `25.8` —
with nothing behind it. Those numbers reached three places that present them as facts:

- the missed-break penalty estimate in `assess()` (`estimateAud`),
- the weekly payroll report's `penaltyAud` total,
- every "$ vs award" claim in the marketplace mockup.

A made-up rate in those places is not a cosmetic problem. It is the product claiming to
prove a worker was paid correctly, using a number nobody checked.

## 2. The rule the module exists to make visible

> **The award floor is per hour worked, not per shift.**

A single "rate for this shift" is the wrong shape and quietly underpays people. A Friday
17:00–01:00 bar shift crosses three rate bands: ordinary until 19:00, evening until
midnight, then Saturday. For a casual Level 2 those hours are worth $33.85, $36.80 and
$40.62 respectively. The blended average is $36.54.

So a venue offering a flat **$37.00/h** beats the average — and still underpays the
midnight hour by $3.62. `priceShift()` therefore returns *segments*, and `assessOffer()`
refuses an offer that falls below **any** segment rather than below the mean. The gate
compares hour to hour; only the display uses the blend.

## 3. Where the numbers come from

Source: **Fair Work Ombudsman Pay Guide, MA000009, effective 01/07/2026, published
24/06/2026**, cross-checked against clause 18 Table 3 and clause 29 of the award.

Only the seven adult base hourly rates are stored. Every other figure in the guide is
derived from them:

| Band | Permanent | Casual |
|---|---|---|
| Ordinary (Mon–Fri 07:00–19:00) | 100% | 125% |
| Saturday | 125% | 150% |
| Sunday | 150% | 175% |
| Public holiday | 225% | 250% |

plus two flat adders, both employment types, **Monday to Friday only**:
evening 19:00–24:00 `+$2.95/h`, night 00:00–07:00 `+$4.42/h`.

Storing percentages rather than the guide's ~40 printed dollar cells is the whole
argument for this design being checkable. `tests/rates.test.ts` regenerates the printed
cells for Introductory, Level 1, Level 2 and Level 6 and asserts them to the cent against
the published figures. If a derived cell ever disagrees with the guide, the model is
wrong and the test says so — which is the same bargain `tests/push-encrypt.test.ts` makes
with RFC 8291.

Arithmetic is in **integer cents** with multipliers as integer percent. `25.74 × 1.25`
in floats is not reliably `32.175`, and the guide prints `$32.18`; `2574 × 125 / 100`
is exactly `3217.5` and rounds half-up to `3218`. Four of the printed cells sit exactly
on a half-cent, so this is load-bearing, not fastidiousness.

## 4. Chosen / rejected

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Rate storage | 7 base rates + percentages | the guide's printed dollar grid | a grid is 40 numbers nobody can check; percentages are 8 that regenerate the grid |
| Offer test | below **any** segment refuses | below the blended average refuses | the average hides the underpaid hour — see §2 |
| Unpaid break | comes out of the **money only**; segments span the whole shift | trim the paid window first, then find the bands | see §4a — trimming first opens a hole in the gate |
| Evening/night loading | flat $/h adder, `ceil` of hours | percentage of base | the guide states dollars "per hour or part of an hour", not a percentage |
| "part of an hour" | `ceil(minutes / 60)` per band | prorate the adder per minute | the phrase means a part-hour attracts the whole adder; prorating underpays |
| Classification | **authored** on the posting | derived from the role string | "Bartender" is not a level. Which level a job sits at is the venue's call and a legal position; a string match guessing it would be inventing an answer to the question that decides someone's pay |
| Public holidays | injected; absent = **not checked** | a built-in calendar | they are state-specific and legislated yearly. `publicHolidaysChecked: false` travels with the result so a screen can say so rather than imply a clear answer |
| Out-of-range dates | refuse to price | extrapolate from the newest table | a rate table has a validity window. Pricing 2028 off the 2026 table returns a confident wrong number, and wage underpayment is the exact failure this pack exists to prevent |
| Employment vocabulary | reuse `EmploymentType` from `higa.ts` | a new `"permanent" \| "casual"` type | two employment vocabularies in one pack is a mapping bug waiting to happen; full-time and part-time simply share a column |

## 4a. The unpaid break must not choose the bands

Found by looking at the real board output rather than at the tests, and worth
writing down because the first implementation was wrong in a way that read fine.

The meal break is unpaid, so it has to come out of the total. The obvious move is
to trim it off the paid window and then work out which bands the remaining hours
fall in. Where the break actually falls is not recorded, so the trim takes the
last minutes — the dearest ones, which understates the total rather than
overstating it, and that direction is deliberate.

But trimming *first* means the bands are derived from a window the person did not
actually work. On a **17:00–00:20** shift with a 30-minute break, the paid window
ends at 23:50 — and the Saturday run disappears entirely. The dearest rate on file
becomes the $36.80 evening one, a $37.00/h offer passes the gate, and every minute
worked after midnight is underpaid by $3.62. The refusal that is the entire point
of the module never fires.

So the two are separated. `segments` covers the **whole span**, break included,
and the rate test runs on those: the only safe assumption is that the person works
in every band the shift touches. The trim applies to `floorCents` alone. An
understated total can no longer become a hole in the gate.

The consequence surfaces in the UI: the band rows sum to more than the paid hours,
so `PaySummary` carries `unpaidHours` and the screen shows the deduction as its own
line. Making it add up on screen is the honest version — the alternative is
assigning the break to a band, which is a guess presented as a fact about
somebody's pay.

## 5. What is deliberately not modelled

Named in `NOT_MODELLED` and returned on every result, so a caller can print the list
rather than assume the figure is a complete wage calculation:

overtime · junior and apprentice rates · casino classifications · the managerial salary
path (cl 18.3) · allowances (split shift, cold work, laundry, meal, fork-lift, airport
catering supervisory) · annual leave loading · overnight stay · higher duties ·
enterprise agreements, which displace the award entirely.

This module answers **"what is the floor for these ordinary hours"**. It does not compute
payroll, and `priceShift()` should never be presented as if it does.

## 6. Interaction with the break pack

`floorHourly()` gives `assess()` a real `ordinaryHourlyRate`, so the missed-meal 50%
loading estimate stops being null and the weekly report's `penaltyAud` stops being zero.

Note the two clauses compound in the venue's disfavour and that is correct: a casual
Level 2 whose meal break is missed on a Sunday accrues 50% of the *ordinary* hourly rate
under cl 16.6, on top of Sunday hours already at 175%. Nothing in the code needs to know
that — it falls out of keeping the two questions in separate modules.
