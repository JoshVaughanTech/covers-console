# Six ways your checks disagree about whether the tree is sound

**Date:** 2026-09-04 · **Status:** living note

Every entry below was hit for real in this repo, not imagined. In five of them a
passing test suite — usually with a clean `tsc` — sat over a tree that
`next build` refuses. The sixth runs the other way: `tsc` fails on code nobody
wrote, and the build is fine.

The reason there are six and not one is that these checks have **different and
partly disjoint coverage**. `vitest` runs through esbuild, which strips types
without checking them. `tsc` checks types but is configured without
`noUnusedLocals`. `next lint` runs ESLint but not the route-contract checks.
Only `next build` runs the type checker, ESLint, *and* Next's own validation of
what a route module is allowed to export.

> **The rule:** run a build before saying "clean". Tests and typecheck together
> are not a substitute, and neither is `next lint`.

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
