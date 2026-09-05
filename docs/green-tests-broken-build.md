# When the checks are wrong about the tree

**Date:** 2026-09-04 – 05 · **Status:** living note

The numbered entries below were found the ordinary way: something went red and
somebody read the message.

**Everything after them was found by checking a claim that was already
believed.** Not one of those came out of new work. The suite was green, the
build was green, and somebody went back to something that had already passed —
a test that had been written, a comment that had been read, a result that had
been reported and accepted — and asked what it actually said. That is the
shortest true summary of the second half of this document, and it is the half
that was expensive.

Three different failures. The first two are opposites; the third is neither,
and is the one that took longest to see.

**Eight disagreements.** A check says sound, another says broken, and only one
of them is right. In five of these a passing test suite — usually with a clean
`tsc` — sat over a tree that `next build` refuses. The sixth runs the other way:
`tsc` fails on code nobody wrote, and the build is fine. The seventh runs a
third way, and is the one that undoes the tidy version of the rule: the build
passes over a file `tsc` rejects, because the build never reads it. The eighth
is not two checks disagreeing at all — it is one check, run twice, over two
trees somebody thought were the same.

**One false agreement.** Every check passes and they are all wrong together,
because the thing being consulted is not evidence.

**One silence.** Every check passes, every check is correct, and none of them
was ever looking. A defect sat under 714 green tests that no test touched.
Nothing disagreed and nothing lied — the suite simply had nothing to say, and
had nothing to say in a way that is indistinguishable from having checked.

Both of those are sections at the bottom rather than numbered cases; numbering
them would flatten the difference.

Everything below was hit for real in this repo, not imagined.

The reason there are eight disagreements and not one is that these checks have
**different and partly disjoint coverage** — and the coverage differs by
directory, not only by tool.

| | `vitest` | `tsc` | `next lint` | `next build` |
|---|---|---|---|---|
| app code | no types | yes | yes | yes |
| `tests/` | no types | **yes** | no | **no** |

`vitest` runs through esbuild, which strips types without checking them. `tsc`
reads everything `tsconfig.json` includes, which is `**/*.ts`. `next lint` runs
ESLint over the app and does not reach test files. `next build` runs the type
checker, ESLint and Next's own route-contract validation — over the graph it can
reach from the app's entry points, which nothing under `tests/` is part of.

> **The rule:** run a build before saying "clean" — tests and typecheck together
> are not a substitute, and neither is `next lint`. Then run `tsc` too, because
> for anything the app does not import, the build is the weaker check and not
> the stronger one. And when a check tells you what you hoped to hear, read what
> it actually asserts.

---

## 1. Unused import

| check | result, before 52db7c2 | after |
|---|---|---|
| `vitest` | passes | passes |
| `tsc --noEmit` | **silent** | error |
| `eslint` | error | error |
| `next build` | **fails** | fails |

`tsconfig.json` set `strict: true` but not `noUnusedLocals`, so the type checker
had nothing to say. ESLint carries `@typescript-eslint/no-unused-vars` via
`next/typescript`, and `next build` treats it as an error rather than a warning.

**Closed by 52db7c2**, which turned `noUnusedLocals` on. The measurement is the
part worth keeping: switching it on flagged exactly four symbols and **all four
were in `tests/`**. For app code this was a timing gap — lint would have caught
it, just later than you needed. For test files it was a coverage gap wearing a
timing gap's clothes: nothing checked them, ever, by any tool. Entry 7 is why
the build could never have.

One of the four was not an import at all but a whole unused helper, `didOf` in
`tests/matching.test.ts` — dead code that had been sitting in plain sight.

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

## 7. `next build` passing on a tree `tsc` rejects

| check | result |
|---|---|
| `vitest` | passes — it never typechecks |
| `next build` | **passes** |
| `tsc --noEmit` | **fails, on a test file** |

Entry 3 says a clean `next lint` tells you nothing about the type checker, and
the fix there is to run a build before claiming clean. For anything under
`tests/`, that advice points at the weaker check.

Measured on one checkout, minutes apart, at 52db7c2:

    npx tsc --noEmit   ->  exit 1
      tests/matching.test.ts(95,13): error TS2353: Object literal may only
      specify known properties, and 'award' does not exist in type 'StaffProfile'

    npx next build     ->  exit 0
      22/22 static pages, no warnings

Both results are correct. `tsconfig.json` has `"include": ["**/*.ts", ...]` and
excludes only `node_modules`, so test files are in the program `tsc` reads.
Next builds its own graph from the app's entry points, type-checks that, and
never reaches a file nothing imports. **The build is not a superset of `tsc`.**

So for test files there are three checkers and none of them is the safety net
you would guess. `vitest` runs the code through esbuild and strips types
without checking them, which is entry 2. `next lint` does not reach `tests/`.
`next build` compiles a graph they are not in. `tsc` is the only one that reads
them, and it is the one people skip because the build is assumed to include it.

**How it arises:** treating "the build passed" as the strongest claim available.
It is the strongest claim about what ships. It is not a claim about the repo,
and a test fixture that no longer typechecks is exactly the kind of thing that
lives in the gap — invisible to the build forever, because nothing in the app
imports a test.

This one cost something real. Two sessions ran isolated builds of the same
commit, both got exit 0, and both reported main healthy while main had not
typechecked for an hour. The disagreement was found by a third check nobody had
thought to run, on a checkout with no uncommitted work in it — which is the only
place it was visible, since every working tree in play had the missing field
sitting in it uncommitted.

---

## 8. Two builds that disagree because they are not the same tree

| check | result |
|---|---|
| `next build` on a copy of the working tree | **fails** |
| `next build` on `git archive HEAD` | passes |

Neither is broken and neither is stale. They are answers to different
questions, and the failure is quoting one while meaning the other.

    git archive HEAD  ->  does MAIN build?   blind to everything uncommitted
    copy of the tree  ->  does MINE build?   blind to nobody's work but yours

In a checkout three sessions share, "I ran an isolated build and it was clean"
is not one claim. One session built a copy of the working tree — which compiles
their own uncommitted work, and everybody else's — and reported it as an
isolated build, with a real ESLint error sitting in their tree. Another treated
the archive method as strictly better, and was structurally unable to see that
error, because `git archive` emits committed content only.

Both had one method and one sentence. The methods were fine.

**How it arises:** reaching for the isolated build because a shared `.next` was
causing trouble, and then answering whichever question the words "isolated
build" happen to suggest. Say which tree. "Main builds" and "my tree builds"
are different promises and only one of them is about the repo.

---

## A different failure: things that look like evidence

The eight above are all **checks disagreeing** — one says sound, another says
broken, and the disagreement is the signal. Seven of them disagree about one
tree; the eighth disagrees because it was shown two, which is the same lesson
entered from the other side. These are the opposite and deserve separating
rather than numbering: **every check agrees, confidently, on the wrong answer.**

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

**A fence that was only ever a sentence.** `lib/awards/rates.ts` carried a doc
comment on `suggestedLevel()` reading *"Deliberately not exported through
lib/awards/index.ts."* Line 11 of that file is `export * from "./rates"`. It had
been exported the whole time, and `import { suggestedLevel } from "@/lib/awards"`
compiles clean.

This is not the same thing as somebody writing a careless comment, and filing it
that way loses the lesson. The intention was real and the author was being
careful — careful enough to write down *why* the function wanted fencing, which
is more than most guards get. What defeated it was mechanical: a barrel one
directory up re-exports everything a module exposes, including what you never
chose to expose, and neither file says a word about it. **Fencing by
not-mentioning is not fencing.** `export *` will do this again, to anyone, in
silence.

Note what it did to the reader as well as to the code. Somebody grepping
`lib/awards/index.ts` for `suggestedLevel` finds nothing and concludes the fence
holds — the shadowed `WORKERS` above, run in reverse. There a name was present
and meant nothing; here a name is absent and means nothing. Absence reads as
evidence more readily than presence does, because there is nothing to inspect.

The repair is the part worth copying. The comment was not corrected to say
"exported, but please don't". It was replaced with a description of the fences
that do exist: `priceShift()` never calls it, and it may pre-fill a level a
person then confirms but never write one. A comment describing a real
constraint degrades honestly when the code moves — you can go and check it. A
comment describing an imaginary one was never true, and nothing will ever say
so. If a module genuinely must not be reachable through a barrel, the barrel
has to name its exports; anything else is a wish with a comment attached.

The general form, from the session that found it: **a comment asserting a
constraint is the cheapest thing in a codebase to write and the only thing
nothing checks.**

**An author field that names everybody.** Three Claude sessions worked this
repo in one shared checkout on one branch, and every commit any of us made
reads `Joshua Vaughan`. So `git log --format=%an` answers the attribution
question with a name that is true, constant, and useless — the same value for
every candidate you are trying to distinguish between.

What makes it belong here rather than in a footnote about git: **"check who
wrote it" is the natural response to an attribution doubt, and here the check
runs, succeeds, and returns something answer-shaped that answers nothing.** A
missing author field would have sent you looking elsewhere. A present one ends
the search.

It cost three misattributions between two sessions in a single day, each caught
only because somebody read the change rather than the metadata: in-flight
`PayPanel` work assigned to the wrong session, award-rates work assigned to the
session that had not written it, and a `.gitignore` commit assigned by topical
proximity to whoever had last mentioned TLS certificates. None of the three was
careless. All three were an assumption standing where a thirty-second read of
the diff belonged.

The same shape has a harder version. When a push made six commits and one
deliberately-withheld commit public at once, no session had issued a push and
git records nothing about who did — a push leaves no reflog entry to attribute.
There the metadata is not misleading, it is simply absent, and absence at least
announces itself. The author field is worse precisely because it responds.

**A fixture that makes correct code look broken.** A probe checking whether
withdrawing a shift twice was idempotent returned `409` on the first attempt
and `409` on the retry. That reads unambiguously as a broken route: the write
that should have succeeded did not.

The route was correct. The probe had picked a worker who could not claim that
shift in the first place, so there was never a claim to withdraw and both calls
were refused for a reason that had nothing to do with idempotency. Rerun with a
worker who could actually claim it: `200` then `409` without a client
reference, `200` then `200` with one — exactly right.

This one runs opposite to the other five, which all make broken things look
sound. A fixture wrong in this direction manufactures a defect, and the cost is
the hour spent fixing code that was never wrong — or worse, "fixing" it and
breaking it to make the probe agree. It was caught by asking what the numbers
*should* be before deciding what they meant.

All six are the same failure: **an artefact carrying the authority of
evidence without the substance of it.** A passing assertion, a familiar
identifier, a rendered page, an absent name, a present one and a red result are
all things we read as confirmation, and none of them was confirming anything.

The screen adds a wrinkle worth keeping separate, because it is the one that
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
does the page load. Whether the barrel re-exports it, rather than whether the
barrel mentions it. What the commit changed, rather than whose name is on it. Every instance here was found by someone who had a reason
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

## A third failure: a check with nothing to say

The eight disagreements are checks that contradict each other. The evidence
cases are checks that agree and are wrong together. This one is neither. **Every
check passed, every check was correct, and none of them was ever looking.**

`decide()` answered a credential requirement with `credentials.find()`, taking
the first record of a type and deciding on that alone. Renewal leaves the
superseded record in place, so array position decided whether somebody could
work. On the seeded board it cost one worker a Friday night and, on four other
postings, replaced the true reason for refusing him with a false one.

The suite at the time: **714 tests, all passing, not one of them touching the
behaviour.** Measured by putting the bug back and running everything — only the
six tests written afterwards go red, and the other 49 files stay green exactly
as they had all along.

Nothing was wrong with those 714 tests. That is the entire difficulty. A suite
that has nothing to say about a defect is indistinguishable, from the outside,
from a suite that has checked and found nothing: same colour, same count, same
duration. Every other failure in this document announces itself to somebody
willing to read carefully. This one has no surface to read.

### It also runs forwards, and that is worse

A test can start load-bearing and stop, without being touched and without
failing. One session had a guard that never offers somebody a credential they
already hold, pinned by a real test against a constructed case. Fixing
`find()` removed the only path that reached it. The test still passes. It now
describes the world rather than holding any code to anything, and nothing
anywhere records that it changed meaning.

Nobody made a mistake. A correct fix in one module quietly retired a test in
another, and the only signal available — green — is the same signal it gave
when it was doing its job.

### The countermeasure

> **A test earns its place by failing when the thing it guards is removed.** If
> deleting the guard changes nothing, the test is describing the world rather
> than holding the code to anything.

That is mutation testing, done by hand and aimed. Full tooling is real cost for
a repo this size, but the aimed version is minutes: revert the fix, or break the
guard, in a copy of the tree, and run the suite.

**What it is worth depends entirely on when you run it**, and the difference is
large enough to state:

| run it on | it asks | what it found here |
|---|---|---|
| a **fix** | was this bug invisible? | 714 green tests, none looking |
| **new code** | is this promise held? | three guards, all already guarded |

Only the first can surprise you. The second is cheap insurance and rarely
returns anything — worth ten minutes, not worth overselling. "We mutation-tested
and everything was fine" is close to no information while sounding like a lot,
and this document has enough sentences of that kind in its history already.

The affordable habit, then, is narrow: **when you fix a bug, look at what was
guarding it.** That is exactly the set of tests that just went quiet, and it is
small enough to check by hand every time.

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
- A credential gate refused a renewed licence, because the record it replaced
  happened to sort first in an array.

Tests check that data is correct case by case. A build checks that the tree is
coherent. Neither checks that a screen makes sense to the person reading it, and
not one of the bugs listed above was found by a test.

**So: build before claiming clean, and open the app before claiming done.**

And — added the day someone spent two steps debugging a stranger's login page —
**check it is your app.** Every rule here assumes you are looking at the right
thing, which is the one assumption none of them check.

And one more, which the 714 earned: **when you fix something, ask what was
guarding it.** A green suite is not a claim that anybody looked.

Which returns to the top. The numbered entries arrived on their own — a check
went red and somebody read it. Nothing in the second half did. Every one of
those came from going back to something already agreed and asking what it
actually said, in a repo that was green the entire time.
