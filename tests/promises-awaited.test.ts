/* ============================================================
   Every call to a promise-returning store or session accessor is
   awaited.

   A missing `await` on one of these is not a type error you can
   rely on. `if (!operatorOf(req)) return 401` compiles, runs, and
   never returns 401 — a Promise is always truthy — so the endpoint
   authorises nobody and everybody. That exact line shipped on two
   routes when #21 made workerOf() and operatorOf() async, and it
   served the employer profile, engagements and worker names to any
   caller until review caught it.

   WHAT MAKES THIS WORTH A CHECK RATHER THAN CARE. The eight call
   sites were found by a human grep, and the grep found five. It
   ended in `head -1`, so it asked each file "is there an unawaited
   call here" and its output was read as "here is the unawaited call
   here" — a per-file list silently asserts one site per file, and
   nothing about it looks like an assertion. Two of the three misses
   were second calls in files already on the list, which is the
   worst place for one to hide: the file appears, so the file feels
   handled. A ninth site then appeared in a route written an hour
   after the review that flagged the other eight. A warning is a
   fact about a moment; the class outlives it.

   `tsc` catches most of these eventually, on a property access the
   Promise does not have. It did not catch the two that mattered,
   because `!promise` is perfectly well typed.

   Two properties, because one of them would rot:

    1. every call to a guarded name is awaited
    2. the guarded list still names everything it should — a new
       promise-returning export in one of those modules fails this
       until somebody decides about it

   Without the second, the list is right on the day it is written
   and quietly incomplete afterwards, which is the failure mode of
   every hand-maintained list of things to remember.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Modules whose exported promise-returning functions must always be awaited.
 *
 * Scoped rather than "every async export in the repo" on purpose. These are
 * accessors whose result is used immediately at every call site — a session or
 * a store handle — so an unawaited one is always a bug. Plenty of legitimate
 * code passes a promise around without awaiting it, and a check that flagged
 * that would be noise everywhere for the sake of six functions.
 */
const GUARDED_MODULES = [
  join("lib", "auth", "session.ts"),
  join("lib", "store", "events.ts"),
  join("lib", "store", "auth.ts"),
  join("lib", "store", "notifications.ts"),
  join("lib", "store", "push.ts"),
];

/** The names themselves. Test 2 holds this list to GUARDED_MODULES. */
const MUST_AWAIT = [
  "workerOf",
  "operatorOf",
  "eventStore",
  "authStore",
  "notificationStore",
  "pushStore",
];

const ROOTS = ["lib", "app"];

interface Source {
  path: string;
  text: string;
}

/**
 * Source with comments removed.
 *
 * Borrowed from tests/audit-events-wired.test.ts, where the first version of
 * that check was satisfied by prose about the thing it was looking for. The
 * same hazard applies here in reverse: this file's own header contains
 * `if (!operatorOf(req))`, and a scan that read comments would flag the
 * document explaining the bug.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sources(dir: string, out: Source[] = []): Source[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(path)) out.push({ path, text: code(readFileSync(path, "utf8")) });
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => sources(r));

/* ---------- the detector ---------- */

export interface Unawaited {
  name: string;
  /** 1-based, for an error message somebody can act on. */
  line: number;
  snippet: string;
}

/**
 * Calls to `names` that are not preceded by `await`.
 *
 * A pure function over text rather than a scan welded to the file walk, so the
 * tests at the bottom can hand it known-bad input. A detector only ever run
 * over a passing tree is a detector nobody has seen work.
 *
 * Two forms are deliberately not matches:
 *
 *  - the declaration — `export function eventStore(): Promise<…>` — recognised
 *    by the preceding `function` keyword, so it is skipped wherever it appears
 *    rather than by exempting the file it lives in
 *  - the name used as a value — `foo(workerOf)` — which has no call parens
 *    after it and so never matches in the first place
 *
 * KNOWN LIMIT: a legitimate pass-through would be flagged. `return eventStore()`
 * from a non-async function, or `Promise.all([eventStore(), authStore()])`, are
 * both correct and both look exactly like the bug to this. Neither exists in
 * the tree today. If one arrives, the fix is a named exemption here with its
 * reason — the shape PENDING uses in audit-events-wired.test.ts — and not a
 * loosened regex, because the thing that makes those safe is context this
 * cannot see.
 */
export function unawaitedCalls(text: string, names: readonly string[]): Unawaited[] {
  const found: Unawaited[] = [];

  for (const name of names) {
    const call = new RegExp(`\\b${name}\\s*\\(`, "g");
    for (const m of text.matchAll(call)) {
      const before = text.slice(0, m.index).trimEnd();

      // the declaration, not a call
      if (/\bfunction$/.test(before)) continue;
      // `await name(` and `await (await name(` both end in the keyword
      if (/\bawait$/.test(before)) continue;

      const line = text.slice(0, m.index).split("\n").length;
      const lineText = text.split("\n")[line - 1] ?? "";
      found.push({ name, line, snippet: lineText.trim().slice(0, 90) });
    }
  }

  return found.sort((a, b) => a.line - b.line);
}

/* ---------- 1: every call is awaited ---------- */

describe("every guarded call is awaited", () => {
  it("finds source to read at all", () => {
    // guards the whole file: a walk that returned nothing would pass every case
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.text.includes("workerOf("))).toBe(true);
  });

  it.each(FILES.map((f) => f.path))("%s", (path) => {
    const file = FILES.find((f) => f.path === path) as Source;
    const missing = unawaitedCalls(file.text, MUST_AWAIT);

    expect(
      missing.map((m) => `line ${m.line}: ${m.snippet}`),
      `${path} calls a promise-returning accessor without awaiting it. ` +
        `A Promise is always truthy, so a truthiness check on one never fires.`,
    ).toEqual([]);
  });
});

/* ---------- 2: the list still names everything ---------- */

/**
 * Exported functions in a module that return a promise.
 *
 * Both spellings are in use and they are not interchangeable to a regex:
 * `export async function workerOf(...)`, and `export function eventStore():
 * Promise<EventStore>` — the singleton accessors are not async, they hand back
 * a cached promise. A check that only looked for `async` would have missed
 * every store in the list.
 */
function promiseReturningExports(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/export\s+async\s+function\s+(\w+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*:\s*Promise</g)) {
    names.add(m[1]);
  }
  return [...names];
}

describe("the guarded list is still complete", () => {
  it.each(GUARDED_MODULES)("%s", (path) => {
    const exported = promiseReturningExports(code(readFileSync(path, "utf8")));
    const unguarded = exported.filter((n) => !MUST_AWAIT.includes(n));

    expect(
      unguarded,
      `${path} exports promise-returning ${unguarded.join(", ")} which MUST_AWAIT does not name. ` +
        `Add it, or move the function somewhere this file does not guard — but decide, ` +
        `rather than leaving the list quietly incomplete.`,
    ).toEqual([]);
  });

  it("names nothing that has stopped returning a promise", () => {
    const all = GUARDED_MODULES.flatMap((p) => promiseReturningExports(code(readFileSync(p, "utf8"))));
    // a name here that is no longer async is a guard with nothing behind it
    expect(MUST_AWAIT.filter((n) => !all.includes(n))).toEqual([]);
  });
});

/* ---------- 3: the detector actually detects ---------- */

/* The half that is easy to leave out. Tests 1 and 2 pass on a clean tree
   whether or not the regex works at all, so without these the whole file could
   be vacuous and green — which is the failure this repo has now collected
   several times, including in the grep that motivated this check. */
describe("the detector itself", () => {
  const names = ["operatorOf", "eventStore"];

  it("catches the truthiness check that shipped", () => {
    const bad = `if (!operatorOf(req)) return NextResponse.json({}, { status: 401 });`;
    expect(unawaitedCalls(bad, names).map((u) => u.name)).toEqual(["operatorOf"]);
  });

  it("catches a bare assignment", () => {
    expect(unawaitedCalls(`const store = eventStore();`, names)).toHaveLength(1);
  });

  /* The one the human grep missed twice: a second call further down a file
     whose first call is correct. */
  it("catches a second call in a file whose first is awaited", () => {
    const mixed = `const a = await eventStore();\nconst b = eventStore();`;
    const found = unawaitedCalls(mixed, names);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
  });

  it("accepts an awaited call", () => {
    expect(unawaitedCalls(`const caller = await operatorOf(req);`, names)).toEqual([]);
  });

  it("accepts the nested form the store reads use", () => {
    expect(unawaitedCalls(`const log = await (await eventStore()).all(ORG);`, names)).toEqual([]);
  });

  it("does not flag the declaration", () => {
    const decl = `export function eventStore(): Promise<EventStore> {\n  return x;\n}`;
    expect(unawaitedCalls(decl, names)).toEqual([]);
  });

  it("does not flag the name used as a value or imported", () => {
    expect(unawaitedCalls(`import { eventStore } from "@/lib/store/events";`, names)).toEqual([]);
    expect(unawaitedCalls(`register(eventStore);`, names)).toEqual([]);
  });

  /* Not cosmetic: this file's own header contains the offending line, and the
     module comments in the routes discuss these functions by name. */
  it("ignores calls that appear only in comments", () => {
    const commented = `/* if (!operatorOf(req)) return 401; */\nconst c = await operatorOf(req);`;
    expect(unawaitedCalls(code(commented), names)).toEqual([]);
  });

  it("reports the line, so the failure is actionable", () => {
    const bad = `const a = 1;\nconst b = 2;\nconst store = eventStore();`;
    expect(unawaitedCalls(bad, names)[0].line).toBe(3);
  });
});
