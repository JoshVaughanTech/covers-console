/* ============================================================
   Every declared audit event is one something actually writes.

   A member of AuditEventType is not a label. It is a promise to
   whoever reads the chain that facts of that kind get recorded —
   and an auditor reading the union has no way to tell a type that
   fires from one that never has. Both compile, both render, and
   the absent one produces no evidence of its absence.

   This is not "unused export", which is a normal thing in a
   library and which a linter would flag everywhere for no reason.
   It is narrower: a declared event that nothing emits, which is a
   claim about what the system records that the system does not
   keep.

   The shape is borrowed from the auth chain's own property test —
   every auth.signed_in has an auth.code_issued at a lower seq —
   because the lesson there was the same. A per-case test gets
   written for the cases somebody was already thinking about, and
   the gap survives in the one nobody thought to check.

   Declaring a type before its writer exists is fine and often
   right; the shapes are worth settling first. What is not fine is
   that being invisible. So an unwired type must be named in
   PENDING with its blocker, which turns a silent gap into a line
   somebody has to write on purpose — and, when the blocker is
   resolved and the entry is forgotten, into a failure. A comment
   cannot do the second half: it does not know when it has stopped
   being true.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AuditEventType } from "../lib/idara/types";

/**
 * The union, enumerated where the compiler can check it.
 *
 * A Record keyed by the type is exhaustive by construction: add a member to
 * AuditEventType without adding it here and this file stops compiling. That is
 * deliberate — the prompt to say whether a new event is wired should arrive
 * when it is declared, not when somebody later wonders.
 */
const DECLARED: Record<AuditEventType, true> = {
  decision: true,
  "credential.issued": true,
  "credential.revoked": true,
  "roster.published": true,
  "break.decision": true,
  "break.pushed": true,
  "break.push_failed": true,
  "report.delivered": true,
  "auth.code_issued": true,
  "auth.signed_in": true,
  "shift.offered": true,
  "shift.assigned": true,
  "shift.claimed": true,
  "shift.withdrawn": true,
  "shift.posted": true,
};

/**
 * Types declared ahead of anything that writes them, and why.
 *
 * The reason is the point. "Pending" with no blocker named is the same silence
 * this file exists to break, one indirection further along.
 */
const PENDING: Partial<Record<AuditEventType, string>> = {};

/* ---------- reading the source ---------- */

const ROOTS = ["lib", "app"];
const DECLARATION = join("lib", "idara", "types.ts");
/** renders every type; presence here says nothing about whether one is written. */
const RENDERER = join("app", "(console)", "audit", "page.tsx");

interface Source {
  path: string;
  text: string;
}

/**
 * Source with comments removed.
 *
 * Not tidiness. The first version of this check searched raw text for callers,
 * and a builder named in a doc comment counted as one — so three unwired types
 * passed because prose about them mentioned the function that would have
 * written them. A check defeated by its own subject's documentation is worse
 * than no check, because it reports green.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sources(dir: string, out: Source[] = []): Source[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, out);
    } else if (/\.tsx?$/.test(path)) {
      out.push({ path, text: code(readFileSync(path, "utf8")) });
    }
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => sources(r));

/** Files that actually put an event on the chain. */
const APPENDERS = new Set(FILES.filter((f) => f.text.includes(".append(")).map((f) => f.path));

/** Where an event of this type is constructed, ignoring the declaration itself. */
function constructedIn(type: AuditEventType): Source[] {
  const literal = new RegExp(`type:\\s*"${type.replace(/\./g, "\\.")}"`);
  return FILES.filter(
    (f) => f.path !== DECLARATION && f.path !== RENDERER && literal.test(f.text),
  );
}

/**
 * The exported function a given offset sits inside, or null when the
 * construction is at module level — seed data, a constant table.
 *
 * Scanning backwards for the nearest `export function`, and rejecting it if a
 * column-zero `}` closed that function before we got here.
 */
function enclosingFunction(text: string, at: number): string | null {
  const before = text.slice(0, at);
  const fns = [...before.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)];
  const last = fns[fns.length - 1];
  if (!last) return null;
  const closed = before.slice(last.index).match(/\n\}/);
  return closed ? null : last[1];
}

/**
 * Wired means an event of this type can actually reach the chain.
 *
 * Three ways it can, and the third clause is the one with teeth:
 *
 *  - constructed under app/ — routes and pages are entry points, so a literal
 *    there is reached whenever somebody opens the screen or calls the route
 *  - constructed at module level in lib/ — seed data and constant tables are
 *    loaded by whoever imports them
 *  - constructed inside an exported function — reachable only if something
 *    outside that module calls it
 *
 * That last case is the one that looks most like wiring and most often isn't:
 * a builder with a test and no caller has a green check over a path the app
 * never takes.
 */
function wiredReason(type: AuditEventType): string | null {
  const literal = new RegExp(`type:\\s*"${type.replace(/\./g, "\\.")}"`);

  for (const site of constructedIn(type)) {
    if (site.path.startsWith("app")) return `constructed in ${site.path}`;
    if (APPENDERS.has(site.path)) return `appended in ${site.path}`;

    const at = site.text.search(literal);
    const fn = enclosingFunction(site.text, at);
    if (!fn) return `module-level in ${site.path}`;

    const caller = FILES.find(
      (f) =>
        f.path !== site.path &&
        f.path !== DECLARATION &&
        new RegExp(`\\b${fn}\\s*\\(`).test(f.text),
    );
    if (caller) return `${fn}() called from ${caller.path}`;
  }
  return null;
}

/* ---------- the property ---------- */

const ALL = Object.keys(DECLARED) as AuditEventType[];

describe("every declared audit event is written by something", () => {
  it("finds source to read at all", () => {
    // guards the whole file: a walk that returns nothing would pass every case
    expect(FILES.length).toBeGreaterThan(50);
    expect(APPENDERS.size).toBeGreaterThan(0);
  });

  it.each(ALL)("%s", (type) => {
    const wired = wiredReason(type);
    const pending = PENDING[type];

    if (pending) {
      expect(
        wired,
        `${type} is listed in PENDING ("${pending}") but is now wired — ${wired}. ` +
          `Remove the PENDING entry.`,
      ).toBeNull();
      return;
    }

    expect(
      wired,
      `${type} is declared but nothing writes it. Either wire it, or add it to ` +
        `PENDING in this file with the blocker that is stopping it.`,
    ).not.toBeNull();
  });
});

describe("the check itself", () => {
  it("would notice a type that only the renderer knows about", () => {
    // the failure mode this file is named for: rendered, never written
    expect(wiredReason("not.a.real.event" as AuditEventType)).toBeNull();
  });

  it("does not count the declaration or the audit screen as a writer", () => {
    const decl = readFileSync(DECLARATION, "utf8");
    expect(decl).toContain("shift.claimed");
    expect(constructedIn("shift.claimed").some((s) => s.path === DECLARATION)).toBe(false);
  });
});
