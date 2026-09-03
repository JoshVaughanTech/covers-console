# Design — Open Shifts: postings, claims and an explainable matcher

**Date:** 2026-09-03 · **Status:** implemented · **Last revised:** 2026-09-03, after the loop was closed

---

## 1. What this is

A casual marketplace: a manager posts open shifts, staff put their hand up, and a
matcher ranks who fits — showing its reasoning. It is the first feature that asks
Idara a question about *who could work*, rather than *may this person be rostered*.

The full loop is now built: **post → claim → review → assign or decline → the
worker is told → they can ask again.** Every step consults the same
`decideMember()`, and every decision lands on the hash chain.

## 2. The rule the feature exists to make visible

> **Idara eligibility is a gate, not a score.**

An ineligible person is excluded from the ranking entirely — never ranked low. That
single decision is what lets the scoring model stay simple without becoming
dangerous: a 4.9 rating and a lapsed RSA are never on the same axis, so no scoring
bug can become a compliance bug. `MatchResult` keeps `candidates` and `excluded`
as separate lists to make the distinction structural rather than conventional.

The staff view and the matcher both call the same `decideMember()`, so what a
worker sees as claimable and what a manager sees as rankable cannot disagree.

**That last sentence is load-bearing and has already caught a real bug.** After a
manager declined a claim and the worker asked again, the manager saw that person
twice — once declined, once open — while the worker saw one open claim. Two views
of one fact, contradicting each other. `reviewClaims()` now returns one row per
person, and a test asserts the manager's row and the worker's own standing are
`toEqual` rather than checking each separately.

## 3. Where things live

| Module | Holds |
|---|---|
| `lib/people/` | skills with levels, rating, home venue, client exclusions, hours this week |
| `lib/shifts/` | postings, seats, required skills, claims; posting, claiming and reviewing |
| `lib/matching/` | the matcher: pure, synchronous, returns reasons with every score |

`lib/shifts/` is deliberately several small modules rather than one: `types.ts`
holds shape, `claim.ts` the act of claiming, `draft.ts` turning a form into a
posting, `review.ts` answering claims. Each holds a rule that must not live in a
component, because each is something the gate depends on.

**What `lib/idara/` gained.** Two audit event types — `"shift.assigned"` and
`"shift.claimed"` — and one module, `duties.ts` (see §7). Nothing else: a rating
is not a credential and a cocktail skill is not a legal position, so none of the
workforce data went into the trust layer. The two join by DID; neither imports the
other's vocabulary.

> An earlier revision of this document said the trust layer "gained exactly one
> thing". That stopped being true and the sentence stayed, which is the failure
> mode a design doc is most prone to — a specific, confident claim about the most
> sensitive boundary in the codebase, quietly going stale.

## 4. Scoring

Six components, weights totalling 100: skill fit 32, client preference 20, rating
15, fairness 15, locality 10, role 8.

- **Skill fit** shares its budget across the required skills. Met or exceeded scores
  full; held-but-below scores half; missing scores minus half. A `lead` satisfies a
  `solid` requirement — levels are ordered.
- **Rating** scales over 3.0–5.0, the range that actually occurs, not 0–5.
- **Fairness** rewards spare capacity against a 38h week and goes negative beyond it.
  Exactly 38h counts as no room left, not room for more — the boundary belongs to
  the overtime branch, because "room for more" against someone at capacity invites
  the shift that tips them over.
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

## 5. The loop

**Posting** (`draft.ts`). A form becomes a `ShiftPosting` through `buildPosting()`,
which validates first. Validation lives here rather than in the component because a
posting is the thing Idara gates against, so a malformed one is a compliance
problem, not a cosmetic one. Duty chips prefill from the role and stay editable,
because duties are per-shift: the same person does different regulated work on
different nights.

**Claiming** (`claim.ts`). A claim is a request, never a roster change. The staff
view already hides Claim from anyone Idara blocks, but `claimShift()` refuses
independently — hiding a control is presentation, and presentation is not a gate,
so a rendering bug cannot become a compliance one. Same reason the matcher
re-decides rather than reading a stored flag.

**Reviewing** (`review.ts`). A claim is made at one moment and answered at another,
and eligibility is not constant across that gap. Claims are therefore answered
against *today*, never against the day they were made, and sort into four
standings: `open`, `lapsed`, `declined`, `assigned`.

The gate was never wrong about this — `decideMember()` runs against today, so a
lapsed claimant could not actually be assigned. What was wrong was the silence: the
claim sat under "Claims to Review" looking like work to do, with the reason
visible only if the manager went hunting in the matcher.

**A lapsed claim is not a task.** It is excluded from the actionable count, because
a headline number that counts something the gate will refuse is telling the manager
to do work that cannot be done. It surfaces instead as "*n* no longer eligible
since claiming", and the posting carries a needs-review badge.

**Telling the worker.** A refusal the worker cannot see is the mirror of a claim
that reports false success. The staff view shows their own standing, and a declined
claim reads "Declined — *reason*. You can ask again", with the button changed to
**Ask again**. Re-claiming stays allowed — circumstances change and asking again is
legitimate — but it becomes a deliberate act rather than something that happens
because the UI silently reset.

## 6. Three kinds of refusal

Kept visibly distinct, because they are not the same kind of fact:

- **"RSA: Expired 2023-11-01"** — Idara. A credential fact, and a legal position.
- **"Not available for this client"** — `lib/people`. A commercial rule.
- **"Not needed for this shift"** — the manager. A judgement about this shift only.

The third is why a declined claimant stays in the ranking with an Assign button:
what was refused is the request, not the worker. Collapsing these would let a
manager's own call read back to them as a compliance failure.

## 7. Duties, and the shape that fails silently

`decide()` reads `input.duties ?? functionsForRole(person.role)`, which makes three
shapes behave differently:

| `duties` | behaviour | how it fails |
|---|---|---|
| `undefined` | falls back to the job title | over-gates — **loud** |
| non-empty | the shift says what it involves | — |
| `[]` | asserts no regulated work; every `appliesTo` requirement stops binding | under-gates — **silent** |

Only the third can turn a gate off without anyone noticing, and it is reachable
from anywhere a duty list is computed, filtered or user-supplied. `lib/idara/duties.ts`
closes it at the point of construction: `shiftAssignment()` collapses an empty list
to `undefined`, which is safe in every case rather than merely most — for a role
with no duties the fallback is also empty, and for any other role it over-gates.

**One role legitimately carries no duties.** `ROLE_FUNCTIONS.Glassy` is `[]`,
because a glassy clears tables and triggers no licence. So the rule is not "duties
must be non-empty" but "non-empty for a role that implies some", which is what
`checkDuties()` asks. Getting this wrong made a real role unpostable, and it
shipped that way before being caught.

## 8. The trail

Two new event types, not four. An **assignment** and a **claim** are each new kinds
of thing, so each has one. A **declined claim** is not — it is an eligibility
decision, so it writes as the existing `"decision"` type and renders under the
existing label. A **lapsed** claim writes nothing at all: nothing happened, the
facts simply moved, and the trail records acts rather than the passage of time.

Everything lands on the same SHA-256 hash chain as publishes and revocations.

## 9. What is derived, and therefore not stored

Two functions were deleted rather than left available, on the same reasoning:

- **`openClaims()`** filtered on `refused` and knew nothing about a claim whose
  holder had since become ineligible. It would return, confidently, the wrong
  answer.
- **`needs_review` on `PostingStatus`** was never assigned by anything. Whether a
  posting wants attention depends on its claims and on eligibility today, so it is
  computed by `needsReview()`.

A derived value kept in an authored field is one that can disagree with what it was
derived from, with no way to tell which is right. And a superseded function exported
beside the correct one is not neutral — it is a trap with a plausible name, and
whoever picks it has no reason to suspect.

## 10. Seed changes

Darie and Mitch gained Werribee inductions and allergen tickets; Leanne gained a
Docklands induction. Without them no one was eligible for the catering postings and
the matcher had nothing to rank. **Aaron and Sophie were deliberately left alone** —
the demo tests pin both as off-premise-ineligible, and that beat is worth keeping.

The seed also ships **one lapsed claim**, so that case is visible rather than
theoretical: Michael Tan claimed the Werribee wedding on 10 May and his RSA was
revoked afterwards. The request was fine when it was made.

## 11. Verification

367 tests across 25 files at the time of writing, of which the marketplace
contributes the matcher, claim, posting, duties and review suites.

The load-bearing test gives Jake a perfect profile — top rating, every skill at
`lead`, zero hours — and asserts he still doesn't appear in the ranking, because
his RSA has expired.

Two others earn their place by pinning a hazard rather than describing it:

- With a duty-scoped RSG requirement, the same person at the same site is
  **allowed** with `duties: []` and **blocked** with `duties: undefined`. That
  difference is the entire reason `duties.ts` exists.
- The manager's claim row and the worker's own standing come from the same call and
  must be equal.

**Three bugs this quarter were found only by running the app**, none of which a
unit test would have caught: a claims count that read zero because the seed made
every claimant also the assignee; a fairness chip reading "room for more" at exactly
a full week; and one person appearing twice in the review queue in contradictory
states. Tests check that data is correct per case. Only a person looking at the
screen sees that two correct rows are together incoherent.

## 12. Known gap — actor identity

**The chain says who an action was about, but not reliably who did it.**
`AuditEvent.subject` is a `DID`; `AuditEvent.actor` is a display-name `string`.
Two people with the same name are indistinguishable in the log, and a display name
is not stable across a rename.

State as of this revision: the supervisor phone carries the actor's DID in
`data.actorDid` alongside the display name, with `via: "mobile"` recording which
surface a decision came from (`ad2aee9`). That is a working mitigation on one path.
Open Shifts still writes `actor: "Emma Taylor"` as a bare string, so the two
surfaces identify actors differently — which is the thing worth fixing, not just
the missing DID.

Closing it properly means a typed actor on `AuditEvent` in the trust layer.
One caution recorded here because it is not visible from the type: `verifyChain()`
re-hashes the object it is given, so adding a field changes what *new* events hash
over. New events chain correctly and existing ones keep verifying, since each hash
covers only its own body — but anything that reconstructs an event and re-hashes it
must include the new field or the result reads as tampering.
