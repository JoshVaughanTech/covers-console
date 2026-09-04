# When the checks are wrong about the tree

**Date:** 2026-09-04 · **Status:** living note

Two different failures, and they are opposites.

**Six disagreements.** A check says sound, another says broken, and only one of
them is right. In five of these a passing test suite — usually with a clean
`tsc` — sat over a tree that `next build` refuses. The sixth runs the other way:
`tsc` fails on code nobody wrote, and the build is fine.

**One false agreement.** Every check passes and they are all wrong together,
because the thing being consulted is not evidence. That section is at the
bottom; it is not a seventh case and numbering it as one would flatten it.

Everything below was hit for real in this repo, not imagined.

The reason there are six disagreements and not one is that these checks have
**different and partly disjoint coverage**. `vitest` runs through esbuild, which
strips types without checking them. `tsc` checks types but is configured without
`noUnusedLocals`. `next lint` runs ESLint but not the route-contract checks.
Only `next build` runs the type checker, ESLint, *and* Next's own validation of
what a route module is allowed to export.

> **The rule:** run a build before saying "clean". Tests and typecheck together
> are not a substitute, and neither is `next lint`. And when a check tells you
> what you hoped to hear, read what it actually asserts.

---

## 1. Unused import

| check | result |
|---|---|
| `vitest` | passes |
| `tsc --noEmit` | **silent** |
| `eslint` | error |
| `next build` | **fails** |

`tsconfig.json` sets `strict: true` but not `noUnusedLocals`, so the type checker
has nothing to say. ESLint carries `@typescript-eslint/no-unused-vars` via
`next/typescript`, and `next build` treats it as an error rather than a warning.

Verified by adding an unused `Credential` import to `lib/shifts/replay.ts`: 20
tests passed, `tsc` exited 0, the build failed with
`'Credential' is defined but never used`.

**How it arises:** removing the last use of something without removing the
import. Deleting a helper, refactoring state out of a component, extracting a
function elsewhere.

## 2. Type error inside a test file

| check | result |
|---|---|
| `vitest` | **passes** |
| `tsc --noEmit` | error |
| `next build` | fails |

`vitest` transforms through esbuild, which erases types without checking them, so
a test can assert against a property that does not exist and still go green. A
test file referenced `recordedAt` on `AuditEvent` — a field deliberately kept off
that type — and the suite passed.

**How it arises:** writing a test against a shape you believe exists. The test is
the thing that was supposed to catch that, and it doesn't.

**Two causes, one mechanism.** The file that produced this had *two* `tsc`
errors and only one was a wrong shape. The other was a `1n` literal against our
`ES2017` target — `BigInt literals are not available when targeting lower than
ES2020`. Not "I asserted against something that doesn't exist" but "I used
syntax the configured target doesn't allow". esbuild is blind to both for the
same reason, so watching only for the first will miss the second.

Verified: a test file containing `1n` passes `vitest` and produces
`error TS2737` from `tsc`.

## 3. `next lint` is not a build

| check | result |
|---|---|
| `next lint` | passes |
| `next build` | can still fail |

Linting is one of several things a build does. A clean `next lint` says nothing
about the type checker or Next's route validation. This one is a habit rather
than a mechanism: reaching for the cheaper command and reporting its result as
though it were the expensive one.

## 4. `viewport` declared inside `metadata`

| check | result |
|---|---|
| `vitest` | passes |
| `tsc --noEmit` | passes |
| `next build` | warns; the tag never ships |

Next 15 moved `viewport` out of the `metadata` export into its own. Declared in
the old place it is silently ignored, so the meta tag never reaches the document
and a phone renders the page at desktop width. The build says so; nothing else
does.

**How it arises:** following a pattern that was correct in an earlier major
version.

## 5. A page module exporting anything but the route contract

| check | result |
|---|---|
| `vitest` | passes |
| `tsc --noEmit` | passes *(then fails once `.next/types` regenerates)* |
| `next build` | **fails** |

An App Router `page.tsx` may only export the route's own contract — `default`,
`metadata`, `generateStaticParams`, and the rest of the known set. Any other
named export fails the build with a type error about `OmitWithTag` on the
route's exports.

Hit by exporting `fmtDate` from `app/(console)/audit/page.tsx` to make it
testable. The fix is to colocate it in a sibling module the page imports —
`app/(console)/audit/format.ts`, following `app/(console)/schedule/roster.ts`.

**How it arises:** wanting to test a helper that lives in a page.

## 6. `tsc` failing on code you did not write

| check | result |
|---|---|
| `vitest` | passes |
| `tsc --noEmit` | **fails, on a file that is not yours** |
| `next build` | passes once the stale artifact is gone |

The inverse of the others, and the only entry where the right response is to
distrust the checker rather than the code.

`tsconfig.json` includes `.next/types/**/*.ts`, so `tsc` reads Next's generated
route types as part of your program. After a route was renamed from `/jobs` to
`/events`, `tsc` reported two errors inside
`.next/types/app/(console)/jobs/page.ts` — generated types for a route that no
longer existed. The source was correct; the artifact was stale. Deleting that
generated directory fixed it.

This runs both ways, which is what makes it worth its own entry:

- a **red** `tsc` may be an error in generated state rather than in your code
- a **green** `tsc` may be reading generated state that no longer matches

Entry 5 is the same coupling seen from the other side: the named export passed
`tsc` until `.next/types` regenerated, and failed after.

**How it arises:** renaming, moving or deleting a route, then trusting `tsc`
without regenerating. When an error names a path under `.next/`, check whether
that route still exists before changing anything.

---

## A different failure: things that look like evidence

The six above are all **checks disagreeing about one tree** — one says sound,
another says broken, and the disagreement is the signal. These are the
opposite and deserve separating rather than numbering: **every check agrees,
confidently, on the wrong answer.**

Agreement is what we normally treat as evidence. That is what makes this class
expensive.

**A test that pins the wrong behaviour.** `auth-delivery.test.ts` asserted
`expect(new FileSink("/tmp/x").configured).toBe(true)`. `configured` is checked
by callers *before minting a sign-in code*, and a grant is spent the moment it
is minted — so a sink that claimed to be configured and then failed left a
worker's previous code dead, the new one written nowhere, and no audit event at
all. The test did not merely miss that. It stated the broken behaviour as the
specification, so the next reader had no way to tell an untested case from an
intended one.

An absent test is a known gap. A test asserting the wrong thing is a gap
wearing the costume of coverage.

**A mock that shadows a real export.** `credentials/page.tsx` declared a local
`const WORKERS` — the same name as the real staff list exported from
`lib/idara/seed.ts`, the one with DIDs that the engine gates and the chain
names. The page never imported the real one. Anyone grepping for `WORKERS`
found the mock, concluded the page was joined to real identities, and was
wrong. Somebody did, passed it on as guidance, and it cost another session a
wrong turn before they opened the file.

**A screen that was never the one under test.** Checking that the console door
worked, I opened `localhost:3000`, read a sign-in page, and got two steps into
diagnosing why our middleware redirected an API route — before noticing it
redirected to `/login`, a path that exists nowhere in this repository. The
server belonged to another project, running from another checkout, on the port
I happened to try first.

Nothing on that page was false. It was a real sign-in screen for a real
product, rendering correctly and answering honestly. It simply was not ours,
and I had never asked whether it was. Three ports were listening; I typed the
lowest.

All three are the same failure: **an artefact carrying the authority of
evidence without the substance of it.** A passing assertion, a familiar
identifier and a rendered page are all things we read as confirmation, and none
of them was confirming anything.

The third one adds a wrinkle worth keeping separate, because it is the one that
generalises furthest. The test and the mock were *wrong about this tree*. The
page was *right about a different one*. Correctness does not travel with
relevance: a thing can be entirely accurate and still be no evidence at all
about what you are looking at, and there is no property of the thing itself
that tells you which — only the question of how you came to be looking at it.

What makes them worse than an ordinary bug is that the normal response makes it
worse. Finding a gap, you write a test — but the test is there. Doubting a
join, you grep for the name — but the name is there. Doubting a screen, you
open it — but it renders. The check you would reach for has already been
answered, incorrectly, by the thing you are checking.

**The habit that catches these** is not more checking. It is reading one level
past the answer when the answer is what you hoped for. What is this test
asserting, rather than does it pass. Which module does this identifier come
from, rather than does the name match. Which server is answering, rather than
does the page load. Every instance here was found by someone who had a reason
to look at the thing rather than at its result.

From the session that found the second of these, and it covers all three:

> a confident sentence is cheaper to write than a verification, and it reads
> the same afterwards

That is the economics of this whole class. "Credentials works in DIDs" cost me
a second to write and the next person a second to read; the verification that
would have made it true cost opening one file, and neither of us paid it. The
checked sentence and the unchecked one are indistinguishable on the page. That
is not a lapse of care, it is a property of prose — which is why the checking
has to happen before the sentence, not after somebody has acted on it.

---

## The shape underneath

Most of these share a shape with the worst bugs we found this quarter:
**correct under the conditions we check, wrong under the conditions that ship.**

That shape is not confined to the build:

- A claims counter read zero because the seed made every claimant the assignee.
- A fairness chip read "room for more" at exactly a full week.
- One person appeared twice in a review queue, each row individually correct.
- The audit log rendered `NaN May 2024` for every event a real device produced —
  and correctly for every seeded one.
- A break classifier was right on demo data and wrong on the actual account.

Tests check that data is correct case by case. A build checks that the tree is
coherent. Neither checks that a screen makes sense to the person reading it, and
not one of the bugs listed above was found by a test.

**So: build before claiming clean, and open the app before claiming done.**

And — added the day someone spent two steps debugging a stranger's login page —
**check it is your app.** Every rule here assumes you are looking at the right
thing, which is the one assumption none of them check.
