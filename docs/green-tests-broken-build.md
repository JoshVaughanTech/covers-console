# When the checks are wrong about the tree

**Date:** 2026-09-04 – 09 · **Status:** living note

The numbered entries below were found the ordinary way: something went red and
somebody read the message.

**Everything after them was found by checking a claim that was already
believed.** Not one of those came out of new work. The suite was green, the
build was green, and somebody went back to something that had already passed —
a test that had been written, a comment that had been read, a result that had
been reported and accepted — and asked what it actually said. That is the
shortest true summary of the second half of this document, and it is the half
that was expensive.

Four different failures. The first two are opposites; the third is neither,
and is the one that took longest to see. The fourth is not about a check being
wrong at all.

**Nine disagreements.** A check says sound, another says broken, and only one
of them is right. In five of these a passing test suite — usually with a clean
`tsc` — sat over a tree that `next build` refuses. The sixth runs the other way:
`tsc` fails on code nobody wrote, and the build is fine. The seventh runs a
third way, and is the one that undoes the tidy version of the rule: the build
passes over a file `tsc` rejects, because the build never reads it. The last
two are not two checks disagreeing at all. The eighth is one check run over two
trees somebody thought were the same; the ninth is one check, one tree, run
twice, disagreeing with itself.

**One false agreement.** Every check passes and they are all wrong together,
because the thing being consulted is not evidence.

**One silence.** Every check passes, every check is correct, and none of them
was ever looking. A defect sat under 714 green tests that no test touched.
Nothing disagreed and nothing lied — the suite simply had nothing to say, and
had nothing to say in a way that is indistinguishable from having checked.

**One misattribution.** The check ran and its answer was true. It was true
about a different branch than the one it was reported for, because `HEAD` had
been read in another worktree. Nothing here is wrong except which thing the
answer was about.

Those three are sections at the bottom rather than numbered cases; numbering
them would flatten the difference.

Everything below was hit for real in this repo, not imagined.

The reason there are nine disagreements and not one is that these checks have
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

## 9. The same check, run twice, with two answers

| run | result |
|---|---|
| first | failures, all `timed out`, none carrying an assertion |
| second, nothing changed | green |

Three sessions hit this independently over two days, each with a piece, and the
final account is better than any of the three first offered. The mechanism is
now measured rather than suspected — but **the grades of evidence differ and
are worth keeping apart**, because the weakest piece is the one that nearly
became a rule.

**Established, by reading the config.** `vitest.config.ts` sets no
`testTimeout`, no `hookTimeout` and no pool options, so the defaults apply —
5000ms per test, 10000ms per hook. Both numbers turn up in real failures here,
which is consistent with nothing being configured rather than with two
different problems.

**Established, by measurement.** A PGlite instance takes ~1.4–1.8s to boot, and
everything after that is single-digit milliseconds:

    boot #1        1782 ms
    boot #2        1362 ms
    CREATE TABLE      3 ms
    20 inserts       10 ms
    TRUNCATE          3 ms

So a test that opens a fresh database spends roughly a third of its 5s budget
before it does anything at all. That is the mechanism, and it makes the fix
quantified rather than plausible: one database per file with `TRUNCATE` between
cases is 3ms where a fresh boot is ~1500ms.

**Established, by reproduction under the real condition.** Two full suites run
concurrently — which is what actually happens when two people test at once —
produced failures reading `Test timed out in 5000ms` and not one assertion
failure. The suite that won the contention passed.

**Established, by control.** Unmodified `main` was fully green on the same
machine. So the code is not implicated, and the suites are not independently
broken.

### The failing file list is not a signature

Worth stating because it looks like a contradiction and is not. A uniform low
timeout deterministically catches the *slowest* tests; contention catches
whichever tests happen to be scheduled during a spike. The two sets barely
overlap, and contention gave different sets on different runs.

So anyone confirming this by matching file names against a previous run will
conclude it does not reproduce. It does. **The identity of the losers is noise**
— which makes the natural way to check it the one thing guaranteed to mislead.

**Every entry above this one is two things disagreeing. This is one thing
disagreeing with itself, having been shown nothing new.** Same code, same
command, two answers, minutes apart.

What makes it dangerous is the response it invites, which is also the correct
response: run it again. That is right when the first run was a flake and wrong
when the first run was real, and **the two cases are indistinguishable from the
results alone.** A green run after a red one is not evidence that anything was
fixed. Nothing was touched.

The habit is worse than the incident. Re-running until green quietly discards
genuine intermittent failures, and intermittent failures are the ones about
ordering, timing and shared state — the hardest class to find any other way,
and the one this repo has already been bitten by more than once. A team that
learns "just re-run it" has built a filter that removes exactly the bugs it
most needs to see.

So the question is not *is this flaky*. It is **did anything change between the
two runs**, which is answerable and usually answered by "no". If nothing
changed, both results are facts about the harness under load and neither is a
fact about the code — and quoting the green one as though it were the second
kind is the move to avoid.

### What discriminates, and what does not

Two signals, both binary, both visible in output somebody is already reading:

1. **The failures say `timed out`** rather than carrying an assertion and a
   diff. A regression tells you what it expected.
2. **The failing file passes in isolation**, immediately, every time.

**Duration does not discriminate, and the attempt to make it is recorded below
as its own failure.** `vitest` prints two numbers — `Duration` is wall clock,
the `tests` figure inside the parentheses is CPU time summed across parallel
workers and is several times larger on any multi-core machine. Measured here on
a fully green run, 961 of 961 passing: `Duration 83.95s (… tests 490.18s …)`.
Any threshold in the low hundreds flags that healthy run as contended.

Wall clock fails too, and worse: one machine's clean run was 87s while another
machine's *contended* run was 85.75s. Two clean runs on the same install forty
minutes apart were 69s and 87s. **The between-machine spread and the
run-to-run variance are both larger than the effect.**

Duration is good for exactly one thing: **same machine, same install,
before-and-after**, which is what verifying the truncation fix would need. A
baseline, never a threshold.

### Raising the timeout is not the fix

This one is not an empirical claim and does not depend on any of the above.
Raising the limit converts a fast, loud, reproducible failure into a slow one,
and buys the same silence for a genuine hang. The fix is to stop paying the boot
cost per test.

**One hazard if anyone implements it.** A shared database per file needs the
truncation to cover *every* table, and `audit_event` with `chain_head` is the
pair that bites hardest and most quietly. Clear the events and miss the head and
the next append chains onto a hash whose row is gone — so `verifyChain` reports
the chain broken, and the symptom is **tamper detected** in a test that has
nothing to do with tampering. That is a false positive on the one alarm this
system exists to raise. `TRUNCATE ... CASCADE` over the table list read from
`information_schema`, not an enumerated list: an enumerated list is correct the
day it is written and silently wrong the first time somebody adds a store.

**How it arises:** a red run, a re-run, and relief. The fix is a sentence, not
a tool: say which run you are quoting, and say whether anything changed between
them. Entry 8 asks you to say which tree. This one asks you to say which run.

---

## A different failure: things that look like evidence

The nine above are all **checks disagreeing** — one says sound, another says
broken, and the disagreement is the signal. Seven of them disagree about one
tree; the eighth disagrees because it was shown two; the ninth disagrees with
itself, over one tree, having been shown nothing new at all. These are the opposite and deserve separating
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

**A list that quietly claimed one per file.** Reviewing a branch for calls to a
newly-async `workerOf()`, the grep was:

    git show BRANCH:FILE | grep -oE "(await )?(workerOf|operatorOf)\(req\)" | head -1

`head -1`. So for each file it asked *is there an unawaited call here* and the
answer was read as *here is the unawaited call here*. Two of the files had two.
The review reported five sites; there were eight.

Nothing about that output looks truncated — one row per file is exactly what a
per-file list should look like. And the missed ones sit in the worst place: a
**second** call site in a file already on the list, which is the one a careful
reader is least likely to go back for, because the file appears and therefore
feels handled.

Filed here rather than as a slip because of where it happened. Not in the code
under review — in the instrument built to review it, run by somebody who had
spent the week writing this exact failure down. The tool truncated, the
truncation looked like an answer, and the wrong count was published twice before
anyone counted rows.

**A number that arrived with a name instead of a method.** One session measured
a clean suite at 69s. Another had reported a flaky suite stretching "from 70s to
250s". Between the two a rule appeared — *green is 50–70s, past 200s is
contention* — and a third session's fresh measurement read as confirming it.

Every number in that chain was real. The comparison was not. One figure was wall
clock; the other was vitest's cumulative `tests` time, which sums across
parallel workers and runs several times larger. A fully green run here reports
`Duration 83.95s (… tests 490.18s …)`, so the threshold flags a healthy suite.
Wall clock fails too: one machine's clean run was 87s against another machine's
*contended* 85.75s. And the rule was attributed to a session that had never sent
a duration figure at all.

**This is the only case here with no author.** The test that pinned wrong
behaviour was written by somebody. The fence that was only a sentence was typed
by somebody. Nobody wrote this rule — it accumulated across three messages, each
contributing something true, and arrived looking better sourced than any of its
parts, because a figure with a citation looks like a figure somebody has already
checked.

It was caught only because the misattributed session was still in the
conversation and **did not recognise its own claim**. Written down, it would have
been unfalsifiable: a threshold with a name on it and nobody left to deny the
name.

The countermeasure is a format rather than a discipline: **record how, not
who.** "Wall clock, single suite, otherwise-idle machine" can be checked by
anyone reading it in a year; "that session's figure" can only be checked by that
session. And the format catches it while writing, without needing anybody —
nobody can write *wall clock, single suite* beside a number lifted from a
cumulative line, because the sentence will not finish.

Applied to the numbers above, so this entry does not commit its own error:

    69s / 87s   wall clock, full suite, isolated 15.5.25 install,
                otherwise-idle machine, two runs 40 minutes apart
    490.18s     vitest's cumulative tests figure from the second of those,
                961 of 961 passing

All eight are the same failure: **an artefact carrying the authority of
evidence without the substance of it.** A passing assertion, a familiar
identifier, a rendered page, an absent name, a present one, a red result, a
one-row-per-file list and a cited number are all things we read as
confirmation, and none of them was confirming anything.

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
barrel mentions it. What the commit changed, rather than whose name is on it.
How many rows the command returned, rather than whether it returned one. What a
number measured, rather than who measured it.

Every instance here was found by someone who had a reason to look at the thing
rather than at its result.

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

The nine disagreements are checks that contradict each other. The evidence
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

## A fourth failure: a correct answer about the wrong thing

The nine disagreements are checks that contradict each other. The evidence cases
are checks that agree and are wrong together. The silence is a check that was
never looking. This one is none of those. **The check ran, asked its own
question, and answered it correctly — and the answer was bound to the wrong
subject on the way out.**

Two sessions had independently implemented the same change on two branches,
`self-host-fonts` and `local-fonts`, neither able to see the other's work. To
compare them, one session ran:

```bash
git merge-base --is-ancestor 40fe86e HEAD
```

in the `fairshift-fonts` worktree. That is a true statement about
`local-fonts`, which is what `HEAD` resolves to there. It was then reported as
a property of `self-host-fonts` — in the same sentence comparing the two — and
offered as the tiebreaker for which branch should be held. On that axis the
answer was backwards: the branch it was claimed for was the one behind.

Nothing failed. `merge-base` is not approximate, and it did not disagree with
anything, because nothing else was asked.

### Why it read as verified

The ordinary version of this mistake is asserting something unmeasured, and
that one at least feels like a guess while you are making it. This did not,
and the reason is worth stating exactly:

> **It looked verified because something HAD been verified, a moment earlier,
> about something else.**

A recent true measurement is the most convincing thing available, and nothing
about the result carries its own subject. `yes` does not say what it was
`yes` about.

### `HEAD` is the whole mechanism

`HEAD` is relative. It resolves against the working directory, and the working
directory is the one variable that never appears in the sentence reporting the
result. So do `.`, a bare `git status`, `npm test`, and `npx tsc --noEmit`:
every one takes its subject from where the shell happens to be standing.

This was a footnote when a repo was one checkout. It is not one now. The
listing at the moment of the mistake held **four** — main, a Postgres worktree,
and two separate fonts worktrees belonging to two different sessions — and one
session was moving between several of them inside a single task. Half an hour
later the same command returned three, because a session had finished and
removed one. The count is not a property of the repo; it is a property of who
is working, right now, and it changes without announcement.

That is what makes `HEAD` worse here than it would be in a shared checkout with
a stable layout: the set of things it could mean is not merely large, it is
moving.

(The first draft of this paragraph said five. It was corrected by running the
command, which is the countermeasure below being applied to the section
describing it.)

### The countermeasure

> **In a repo with multiple worktrees, name the ref.**
> `git merge-base --is-ancestor 40fe86e self-host-fonts` cannot be wrong about
> its subject. The version with `HEAD` can only be wrong about its subject.

It costs one word, and unlike most of this document it needs no judgement to
apply: the named form is never worse. The same holds for `--git-dir`/`-C` over
`cd`, and for naming the file rather than `.` when a linter's scope is the
thing in question.

Worth recording how it was caught, because it was not caught by the person who
made it. The claim favoured one branch; the session whose branch it favoured
checked it anyway and found it false. **A claim that flatters you is the one
you are least likely to audit and the one where auditing pays most** — and the
report of that check was itself careful to say it had become a habit from being
contradicted repeatedly, not a disposition. That is the thinner claim and the
truer one.

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
