/* ============================================================
   Duties from the shift assignment.

   A job title is only a guess at what someone does. Put a
   bartender on the gaming floor for a night and they perform
   gaming duties regardless of what their title says — so where
   the roster knows the assignment, the assignment wins and the
   title is only the fallback.

   This is what closes the hole left by role scoping: previously a
   requirement could only be scoped by title, so covering a gaming
   shift at a venue with no separate gaming *location* went
   unchecked.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { decide, decideRoster, type RosterMember } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { functionsForRole } from "../lib/idara/hospitality";
import type {
  Credential,
  CredentialTypeId,
  Identity,
  Site,
  WorkFunction,
} from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

const bartender: Identity = {
  did: "did:web:idara.app:w:test-bartender",
  name: "Test Bartender",
  role: "Bartender",
  org: "Brightwater Hospitality",
};

let n = 0;
const cred = (type: CredentialTypeId): Credential => ({
  id: `vc-a${n++}`,
  type,
  subject: bartender.did,
  issuer: "did:web:idara.app",
  issuedAt: "2023-01-15",
  expiresAt: "2026-01-01",
  status: "valid",
  claims: {},
});

/** One venue, gaming gated by duty rather than by a separate location. */
const venue: Site = {
  id: "s-venue",
  name: "Test Venue",
  region: "Victoria",
  kind: "venue",
  requires: [{ type: "rsg", appliesTo: ["gaming"] }],
};

const run = (duties: WorkFunction[] | undefined, credentials: Credential[] = []) =>
  decide({
    person: bartender,
    credentials,
    action: "be_rostered",
    site: venue,
    at: AT,
    verifier,
    duties,
  });

describe("decide — duties from the assignment", () => {
  it("falls back to the job title when no assignment is given", () => {
    // a bartender's title carries no gaming duty
    expect(functionsForRole("Bartender")).not.toContain("gaming");
    const d = run(undefined);
    expect(d.allowed).toBe(true);
    expect(d.reasons[0].outcome).toBe("n/a");
  });

  it("closes the hole: a bartender rostered onto gaming now needs RSG", () => {
    const d = run(["serve_alcohol", "gaming"]);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].outcome).toBe("fail");
    expect(d.reasons[0].credentialType).toBe("rsg");
  });

  it("and passes once they hold it", () => {
    const d = run(["serve_alcohol", "gaming"], [cred("rsg")]);
    expect(d.allowed).toBe(true);
    expect(d.reasons[0].outcome).toBe("pass");
  });

  it("the assignment replaces the title rather than adding to it", () => {
    const foodSite: Site = {
      ...venue,
      requires: [{ type: "food_handling", appliesTo: ["handle_food"] }],
    };
    // the title implies handle_food, but tonight they are only on the bar
    expect(functionsForRole("Bartender")).toContain("handle_food");
    const d = decide({
      person: bartender,
      credentials: [],
      action: "be_rostered",
      site: foodSite,
      at: AT,
      verifier,
      duties: ["serve_alcohol"],
    });
    expect(d.allowed).toBe(true);
    expect(d.reasons[0].outcome).toBe("n/a");
  });

  it("an explicitly empty assignment is honoured, not treated as unknown", () => {
    // distinct from an unmapped title, which fails safe to every duty
    const d = run([]);
    expect(d.allowed).toBe(true);
    expect(d.reasons[0].outcome).toBe("n/a");
  });

  it("an unmapped title still fails safe when no assignment is given", () => {
    const d = decide({
      person: { ...bartender, role: "Sommelier" },
      credentials: [],
      action: "be_rostered",
      site: venue,
      at: AT,
      verifier,
    });
    expect(d.allowed).toBe(false);
  });

  it("names the assignment as the basis when a check does not bind", () => {
    expect(run(["serve_alcohol"]).reasons[0].detail).toContain("this assignment");
    // …and the title when there is no assignment
    expect(run(undefined).reasons[0].detail).toContain("Bartender");
  });

  it("does not affect unscoped requirements", () => {
    const inducted: Site = { ...venue, requires: [{ type: "site_induction" }] };
    for (const duties of [undefined, [], ["gaming"] as WorkFunction[]]) {
      const d = decide({
        person: bartender,
        credentials: [],
        action: "be_rostered",
        site: inducted,
        at: AT,
        verifier,
        duties,
      });
      expect(d.allowed, String(duties)).toBe(false);
    }
  });
});

describe("decideRoster — assignments travel with the roster", () => {
  const member = (duties?: WorkFunction[], credentials: Credential[] = []): RosterMember => ({
    person: bartender,
    credentials,
    shifts: [{ id: "Sat", duties }],
  });

  it("applies each member's own assignment", () => {
    const r = decideRoster({
      roster: [member(["gaming"]), member(undefined)],
      action: "be_rostered",
      site: venue,
      at: AT,
      verifier,
    });
    expect(r.decisions[0].allowed).toBe(false); // on gaming, no RSG
    expect(r.decisions[1].allowed).toBe(true); // title only, gaming n/a
    expect(r.allowed).toBe(false);
  });

  it("an under-qualified assignment also removes them from coverage", () => {
    const covered: Site = {
      ...venue,
      requiresOnRoster: [{ type: "food_safety_supervisor", minHolders: 1 }],
    };
    // holds the FSS, but is rostered onto gaming without an RSG, so can't work
    const r = decideRoster({
      roster: [member(["gaming"], [cred("food_safety_supervisor")])],
      action: "be_rostered",
      site: covered,
      at: AT,
      verifier,
    });
    expect(r.decisions[0].allowed).toBe(false);
    expect(r.coverage[0].holders).toHaveLength(0);
  });
});
