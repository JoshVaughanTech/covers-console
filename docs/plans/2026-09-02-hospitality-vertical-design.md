# Design — Re-pointing FairShift from construction to hospitality

**Date:** 2026-09-02 · **Status:** implemented

---

## 1. What changed and why

FairShift Console was built around Australian construction: White Cards, SWMS,
site inductions, carpenters and concreters. This re-points it at **hospitality** —
multi-venue pub and hotel groups, *and* the off-premise catering they run
alongside.

The architecture doc claimed "swapping verticals = swapping this file." That was
true of the **engine** — `decide()`, `CredentialVerifier` and the audit chain are
genuinely vertical-agnostic and needed no changes at all — but **not** of the
screens, which carried roughly fifty hard-coded construction nouns across thirteen
pages, the company switcher and the search index. The real job was one clean pack
swap plus a much larger copy and mock-data sweep.

---

## 2. Decisions taken

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Replace or add alongside? | **Replace construction entirely** | Multi-vertical would have required threading vertical-awareness through every hard-coded string in 13 screens — materially more work than rewriting them once, for a product that only needs one closed loop. |
| Operator archetype | **Multi-venue pub/hotel group + catering arm** | A restaurant group has milder eligibility stakes; a pure staffing agency doesn't match a console built around operating venues. |
| Depth of screen change | **Relabel everywhere + remodel the two misfits** | Relabel-only would have left `/jobs` and `/projects` reading as construction with the words changed. A full workflow remodel of all 13 screens was disproportionate. |
| Unit of eligibility | **Keep the `Site` type** | Renaming to `Venue` would have been churn *and* wrong: catering works at event sites, not venues. `Site` already covers both, and a caterer says "site" anyway. |

The catering requirement arrived after the first design pass and changed the
abstraction rather than just the labels: you cannot pre-induct someone into a
one-off marquee, `rsg` is meaningless to a caterer, and allergen management moves
from nice-to-have to central.

---

## 3. The taxonomy

Eight credential types in `lib/idara/hospitality.ts`. Only `rsg` is
venue-specific; everything else travels with the person to either a fixed venue or
an event site, which is the portability argument.

| Type | Applies to | Scoped |
|---|---|---|
| `rsa` — Responsible Service of Alcohol | Both | — |
| `food_handling` | Both | — |
| `food_safety_supervisor` | Both — central for catering | — |
| `allergen_management` | Both — critical for plated events | — |
| `first_aid` | Both | — |
| `site_induction` — venue induction *or* event briefing | Both | ✅ |
| `wwcc` | Both — school functions, kids' events | — |
| `rsg` — Responsible Service of Gaming | Fixed gaming venues only | — |

`BASE_REQUIREMENTS` = `rsa` + `site_induction` + `food_handling`.

Six locations: four fixed venues (one of them a separately-licensed gaming room
inside another) and two off-premise catering operations.

---

## 4. Known simplifications

Recorded here rather than hidden, because each is a real gap between the model and
the industry:

1. ~~**RSA is required of everyone rostered.**~~ **Resolved** — see §5.
2. ~~**Food Safety Supervisor is modelled per-person.**~~ **Resolved** — see §6.
3. **RSA expiry rules vary by state.** Victoria requires refresher training; NSW
   issues a five-year competency card. The seed uses concrete dates and the copy
   avoids asserting a national rule. This remains open, and is a copy/data
   question rather than a modelling one.

---

## 5. Role-scoped requirements (added 2026-09-02)

`CredentialRequirement` gained `appliesTo?: WorkFunction[]`. A requirement with it
set binds only to people who perform one of those duties; omitted, it binds to
everyone rostered.

Requirements bind to **duties, not job titles**, because titles drift between
venues ("Bartender" / "Bar Attendant") while the duty that triggers a legal
obligation does not. `ROLE_FUNCTIONS` in `hospitality.ts` maps titles to
`serve_alcohol | handle_food | gaming | supervise`, so the engine still knows
nothing about bars or kitchens.

Two decisions worth keeping:

**Unknown roles fail safe.** `functionsForRole()` returns *every* function for a
title it doesn't recognise, so an unmapped job title can only ever be asked for
more than it needs, never less. Getting this backwards would mean a compliance
tool quietly stops demanding a licence someone genuinely owes. An explicitly
empty duty list (a glassy, who neither pours nor prepares) is distinct from an
unknown role, and both are pinned by tests.

**Skipped requirements are recorded, not dropped.** `CheckOutcome` gained `"n/a"`,
and a non-binding requirement produces a reason like *"RSA not required for Head
Chef."* The product's pitch is "there's a dated record of why", and a check that
silently vanishes is weaker in front of a regulator than one that shows it was
considered and deliberately not applied. Every existing consumer already filtered
for `outcome === "fail"`, so nothing in the UI needed changing.

### The nuance found while implementing

Scoping RSG by the `gaming` duty was **wrong**, and the demo test caught it: Darie
is a Bartender, has no `gaming` duty, and so became eligible for the gaming room —
destroying the "same building, different licence" beat.

Being rostered *into* the gaming room **is** the gaming duty, whatever the
person's usual title. The room already scopes the requirement. So:

> Where a location implies the duty, let the location scope the requirement.
> Role scoping is for requirements that differ **between people at the same
> location** — RSA versus the kitchen at one pub.

RSG is therefore deliberately unscoped at the gaming room. This is the limit of
the current model: duties are derived from the person's title, not from the
assignment. A bartender covering a gaming shift at a venue that *doesn't* have a
dedicated gaming location would still be under-checked. Fixing that properly means
duties travelling with the roster assignment rather than the person.

---

## 6. Roster-level requirements (added 2026-09-02)

`Site` gained `requiresOnRoster?: RosterRequirement[]`, and the engine gained
`decideRoster()`. A `RosterRequirement` carries `minHolders`, and is satisfied by
the roster collectively rather than by each person.

This is the shape `decide()` could never express: it only ever sees one person, so
a "the venue must have a nominated FSS on shift" rule had to be forced into either
*everyone must hold it* (over-demanding) or *nobody need hold it* (under-demanding).
Neither is the law.

`decideRoster()` composes rather than replaces — it maps `decide()` over the roster,
then evaluates coverage. The per-person primitive is untouched.

**Only eligible people count as holders.** A supervisor whose own induction has
lapsed can't be rostered, so they aren't going to be on shift and can't discharge
the venue's obligation on paper either. Counting them would let a roster pass on
somebody's absence — the single most important rule here, and the one most easily
got wrong.

Consequences worth noting:

- **A publish can now be blocked with nobody at fault.** Every person individually
  eligible, and the shift still illegal. The gate UI says so explicitly, and the
  *"publish the verified subset"* action is withdrawn rather than disabled — dropping
  people can never satisfy a collective requirement, so offering it would mislead.
- **`publishEligibleOnly` re-checks rather than assuming.** Previously it filtered
  the blocked staff out and declared success; now it re-evaluates, because removing
  individuals leaves a coverage gap exactly where it was.
- **The audit trail records the collective gap** as its own entry, alongside the
  per-person receipts, so "why was Friday refused?" has an answer even when no
  individual was at fault.

Seeded so it's real rather than theoretical: Brightwater Hotel has a bistro and so
owes an FSS (covered by Sophie and Priya), and Darie is inducted at Northside
Tavern — personally eligible there, but unable to be rostered alone, because the
venue still owes a supervisor.

---

## 7. Verification

The demo narrative is pinned by `tests/demo.test.ts` so a seed edit can't quietly
turn a blocked person eligible:

- **Jake Morrison** — blocked, RSA expired (the most recognisable failure in the industry)
- **Liam O'Brien** — blocked, no venue induction
- **Michael Tan** — blocked, RSA revoked by the regulator, with a dated audit record
- **Leanne Vidal** — eligible, warned: RSA expiring in 18 days
- **Darie Roberts** — clears the hotel floor, blocked from the gaming room (no RSG) — *same building*
- **Hassan Ali** — holds **no RSA at all** and still clears the hotel floor; blocked at the wedding (no allergen, no FSS)
- **Priya Sharma** — clears the venue and both catering operations on one RSA and three inductions

126 tests pass; typecheck, lint and production build are clean.
