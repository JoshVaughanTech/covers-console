import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

/* ============================================================
   Every API route decides who may call it.

   Not a test of any one route — those exist and are better. This is
   the guard against the route nobody thought about, which is the only
   way an endpoint has ever ended up ungated here. Nobody adds a
   public route on purpose; they add a route, and never form the
   thought about the gate.

   That is exactly what happened to /api/breaks. It shipped with no
   check, sat behind a middleware documented as not being a gate, and
   was therefore the one thing that middleware gated — live venue
   data, to anyone, if the file were ever deleted. Per-route tests
   could not have caught it, because the missing test was the one
   nobody wrote.

   So this enumerates instead of naming. A new route file forces a
   decision at the moment it is added: gate it, or put it on the list
   below and say why. Both are fine. Silence is not.
   ============================================================ */

const API = join(process.cwd(), "app", "api");

/**
 * Routes that are deliberately reachable without a session, each with the
 * reason it has to be.
 *
 * Short by design. Adding to it should feel like a decision, because it is —
 * every line here is an endpoint anybody on the network may call.
 */
const PUBLIC: Record<string, string> = {
  "auth/request":
    "asking for a sign-in code cannot require a session; that is the loop it exists to start",
  "auth/redeem":
    "turning a code into a session cannot require the session it is about to create",
  "auth/link":
    "the magic link is followed by somebody who has no session yet, which is the point of it",
  "auth/console/request":
    "same closed loop for operators; the protection is that the code only ever goes to a file",
  "auth/console/redeem":
    "same closed loop for operators",
};

/** Every route.ts under app/api, as a posix path relative to app/api. */
function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, acc);
    else if (entry === "route.ts") acc.push(full);
  }
  return acc;
}

const routeName = (file: string) =>
  relative(API, file).split(sep).slice(0, -1).join(posix.sep) || "(root)";

/** How this file decides who is calling, or null if it does not. */
function gateOf(source: string): string | null {
  if (/\boperatorOf\s*\(/.test(source) && /\bworkerOf\s*\(/.test(source)) return "either kind";
  if (/\boperatorOf\s*\(/.test(source)) return "operator";
  if (/\bworkerOf\s*\(/.test(source)) return "worker";
  // the weekly payroll run is triggered by a scheduler, not a person
  if (/timingSafeEqual\s*\(/.test(source)) return "shared token";
  return null;
}

const routes = routeFiles(API).map((file) => ({
  name: routeName(file),
  gate: gateOf(readFileSync(file, "utf8")),
}));

describe("every API route", () => {
  it("finds routes to check at all", () => {
    // a glob that silently matches nothing would pass every assertion below
    expect(routes.length).toBeGreaterThan(10);
  });

  it("either decides who is calling, or is on the public list with a reason", () => {
    const ungated = routes.filter((r) => !r.gate && !(r.name in PUBLIC));

    expect(
      ungated.map((r) => r.name),
      ungated.length
        ? `These routes accept anyone and are not on the public list.\n` +
          `Add operatorOf/workerOf, or add them to PUBLIC in this file with the reason:\n  ` +
          ungated.map((r) => r.name).join("\n  ")
        : "",
    ).toEqual([]);
  });

  it("keeps the public list honest, with nothing stale on it", () => {
    const names = new Set(routes.map((r) => r.name));
    const gone = Object.keys(PUBLIC).filter((n) => !names.has(n));
    // a deleted route left on the list would quietly excuse a future one that
    // happened to be given the same path
    expect(gone).toEqual([]);
  });

  it("does not let a gated route sit on the public list", () => {
    const both = routes.filter((r) => r.gate && r.name in PUBLIC);
    // it would still be gated, but the list would be lying about why
    expect(both.map((r) => r.name)).toEqual([]);
  });
});

describe("the routes that carry the venue's data", () => {
  /* Named individually as well as enumerated, because these are the ones
     where getting the KIND wrong matters rather than merely having a gate. */
  const gate = (name: string) => routes.find((r) => r.name === name)?.gate;

  it("keeps the chain to operators", () => {
    expect(gate("events")).toBe("operator");
    expect(gate("events/stream")).toBe("either kind");
  });

  it("lets both kinds see the floor, because the phone is where breaks are noticed", () => {
    expect(gate("breaks")).toBe("either kind");
  });

  it("keeps a priced week to operators", () => {
    expect(gate("breaks/week")).toBe("operator");
  });

  it("keeps minting codes to operators, and claiming shifts to workers", () => {
    expect(gate("auth/issue")).toBe("operator");
    expect(gate("shifts")).toBe("worker");
    expect(gate("shifts/claim")).toBe("worker");
  });
});
