# Design — Open Shifts: postings, claims and an explainable matcher

**Date:** 2026-09-03 · **Status:** implemented · **Last revised:** 2026-09-04, after durability and actor identity

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
| `lib/shifts/` | postings, seats, required skills, claims; posting, claiming, reviewing, and rebuilding the board from the log |
| `lib/matching/` | the matcher: pure, synchronous, returns reasons with every score |

`lib/shifts/` is deliberately several small modules rather than one: `types.ts`
holds shape, `claim.ts` the act of claiming, `draft.ts` turning a form into a
posting, `review.ts` answering claims, `replay.ts` rebuilding the board from the
log (§8). Each holds a rule that must not live in a component, because each is
something the gate depends on.

**What `lib/idara/` gained**, as of this revision: three audit event types
(`"shift.assigned"`, `"shift.claimed"`, `"shift.posted"`), one module —
`duties.ts` (§7) — and one field on `AuditEvent`, `actorDid` (§12). Nothing else:
a rating is not a credential and a cocktail skill is not a legal position, so none
of the workforce data went into the trust layer. The two join by DID; neither
imports the other's vocabulary.

> **This paragraph has now gone stale twice.** It first said the trust layer
> "gained exactly one thing", which stopped being true and stayed. It was
> corrected to "two event types and one module", which stopped being true within
> hours. A confident, specific, countable claim about the most sensitive boundary
> in the codebase is exactly the sentence most likely to rot, because everything
> that changes it is a change worth making. If you are editing the trust layer,
> this line is the one to re-check — and if it has drifted again, say so here
> rather than quietly fixing it.

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

## 8. The trail, which is also the state

Three new event types, not five. A **posting**, an **assignment** and a **claim**
are each new kinds of thing, so each has one. A **declined claim** is not — it is
an eligibility decision, so it writes as the existing `"decision"` type and renders
under the existing label. A **lapsed** claim writes nothing at all: nothing
happened, the facts simply moved, and the trail records acts rather than the
passage of time.

Everything lands on the same SHA-256 hash chain as publishes and revocations.

**The board is not stored beside the trail. It is read from it.** `replayPostings()`
folds the log over the seed, and the page holds no posting state of its own — every
action records an event and nothing else.

This was not the original shape. The chain became durable before the marketplace
did, and after a reload `/audit` still said someone had claimed a shift, chain
verifying, while the queue showed no such claim and the assigned shift was open
again. For a product whose central claim is a tamper-evident record of who was
cleared to work, "the chain says it happened, the app says it didn't" is the worst
inconsistency available.

The fix was not a postings table. Two durable stores of one fact drift, which is
the bug rather than the cure. It also honours what `lib/store/events.ts` says of
itself — *"Covers stores what happened, not what is"* — whose reasoning is that
the source of truth lives elsewhere, in Connecteam. Open Shifts has no elsewhere:
a posting exists only here, so it needed its creation recorded rather than an
exception to the principle. Hence `"shift.posted"`, which carries the posting
itself.

Two consequences worth knowing:

- **The replay is idempotent per event.** The same log applied twice does not
  double a claim, an assignment or a posting. The stream is at-least-once by
  design — a reconnecting client re-reads the log — so this is what makes a
  reconnect safe rather than inflationary.
- **A failed append shows as nothing, not as a phantom.** When the backend refuses,
  the provider records nothing locally, so the action does not appear on the board
  either. An event in the log that no chain contains would be worse than a missing
  one — but it means "it didn't show up" can mean "the server said no", not only
  "it is slow".

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

415 tests across 29 files at the time of writing, of which the marketplace
contributes the matcher, claim, posting, duties, review and replay suites.

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

## 12. Actor identity — closed, with one constraint worth keeping

The chain used to answer "who was this about" precisely and "who did this" only
loosely: `subject` was a `DID`, `actor` was a display name. Two people with the
same name were indistinguishable in a compliance log.

`AuditEvent.actorDid` closes it (`1a82d95`). The console writes
`CONSOLE_OPERATOR.did`, the phone writes the signed-in supervisor's DID, and the
mobile path's earlier `data.actorDid` was folded into the typed field so there is
one meaning in one place. `via: "mobile"` stayed in `data`, because which surface
a decision came from is payload, not identity.

**The constraint that made it dangerous, kept here because it looks like a style
choice in the code:** an absent `actorDid` must read back as `undefined`, never
`null`. `canonicalJson` drops keys whose value is undefined and keeps keys whose
value is null, and the digest covers `Omit<AuditEvent, "hash">`. So a NULL column
mapped to `null` adds `"actorDid":null` to the body of every event written before
the field existed, changing its digest, and `verifyChain` reports the whole chain
as tampered. `subject` already does `?? undefined` for exactly this reason.

**And the part neither of us anticipated:** the DDL is `CREATE TABLE IF NOT
EXISTS`, which is silent on a table that already exists, so a database written
before the column never receives it and every append afterwards fails. Invisible
in development, where the file is deleted between runs; total in a deployment,
where it is not. `migrate()` now checks the live schema on every open. Confirmed
against the real store: the same request returned 500 before and 201 after.

## 13. Known gaps

- **Identification is not authentication.** Both surfaces record who *claims* to
  be acting. The phone's sign-in is a name picked from a list, and the console's
  operator is a seed constant. The DID makes the record unambiguous; it does not
  make it verified. A real session changes where the DID comes from, not what the
  chain records.
- **`ISODate` is narrower than the events that use it.** It is documented as
  `YYYY-MM-DD`, but events carrying a moment rather than a day send a full
  timestamp, and are right to. The renderer was fixed to accept both; the type
  still claims otherwise.
