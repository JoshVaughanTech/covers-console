# Design — Open Shifts: postings, claims and an explainable matcher

**Date:** 2026-09-03 · **Status:** implemented

---

## 1. What this is

A casual marketplace: a manager posts open shifts, staff put their hand up, and a
matcher ranks who fits — showing its reasoning. It is the first feature that asks
Idara a question about *who could work*, rather than *may this person be rostered*.

## 2. The rule the feature exists to make visible

> **Idara eligibility is a gate, not a score.**

An ineligible person is excluded from the ranking entirely — never ranked low. That
single decision is what lets the scoring model stay simple without becoming
dangerous: a 4.9 rating and a lapsed RSA are never on the same axis, so no scoring
bug can become a compliance bug. `MatchResult` keeps `candidates` and `excluded`
as separate lists to make the distinction structural rather than conventional.

The staff view and the matcher both call the same `decideMember()`, so what a
worker sees as claimable and what a manager sees as rankable cannot disagree.

## 3. Where things live

| Module | Holds |
|---|---|
| `lib/people/` | skills with levels, rating, home venue, client exclusions, hours this week |
| `lib/shifts/` | postings, seats, required skills, claims, status |
| `lib/matching/` | the matcher: pure, synchronous, returns reasons with every score |

**`lib/idara/` gained exactly one thing:** `"shift.assigned"` on `AuditEventType`.
A rating is not a credential and a cocktail skill is not a legal position, so none
of the workforce data went into the trust layer. The two join by DID; neither
imports the other's vocabulary.

## 4. Scoring

Six components, weights totalling 100: skill fit 32, client preference 20, rating
15, fairness 15, locality 10, role 8.

- **Skill fit** shares its budget across the required skills. Met or exceeded scores
  full; held-but-below scores half; missing scores minus half. A `lead` satisfies a
  `solid` requirement — levels are ordered.
- **Rating** scales over 3.0–5.0, the range that actually occurs, not 0–5.
- **Fairness** rewards spare capacity against a 38h week and goes negative beyond it.
- **Locality** rewards the person's home venue.
- **Client preference** applies only where a function has a client, which is why it
  is correctly absent from in-house shifts.
- **Role** scores an exact match full, and overlapping duties half — reusing
  `functionsForRole()` rather than inventing a second notion of relatedness.

**Chips must sum to the score.** Pinned by a test across every candidate on every
posting. If a manager can't verify the number from the reasons shown, "explainable"
is decoration. Idara *warnings* are shown as notes and deliberately score nothing —
an expiring credential should reach the manager's eye without silently costing
someone the shift.

### Where this departs from the mock

The mock's arithmetic doesn't reconcile: Mitch's chips sum exactly to his 56, but
Aaron's sum to 40 against a displayed 52. Self-consistency was chosen over matching
the mock. Rating and fairness reproduce the mock's numbers closely once rating is
scaled 3–5; skill fit does not, and wasn't contorted to.

## 5. Two kinds of refusal

Kept visibly distinct, because only one is a legal position:

- **"RSA: Expired 2023-11-01"** — Idara. A credential fact.
- **"Not available for this client"** — `lib/people`. A commercial rule.

## 6. The trail

Only one new event type. A *refused* claim is not a new kind of thing — it is an
eligibility decision, so it writes as the existing `"decision"` type. Assignments
write through `recordEvent`, landing on the same hash chain as publishes and
revocations.

## 7. Seed changes

Darie and Mitch gained Werribee inductions and allergen tickets; Leanne gained a
Docklands induction. Without them no one was eligible for the catering postings and
the matcher had nothing to rank. **Aaron and Sophie were deliberately left alone** —
the demo tests pin both as off-premise-ineligible, and that beat is worth keeping.

## 8. Verification

203 tests (20 new). The load-bearing test gives Jake a perfect profile — top rating,
every skill at `lead`, zero hours — and asserts he still doesn't appear in the
ranking, because his RSA has expired.
