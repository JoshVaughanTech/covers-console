/* ============================================================
   The duties guard.

   decide() reads `input.duties ?? functionsForRole(person.role)`,
   which makes three shapes behave differently:

     undefined  → falls back to the job title  → over-gates, loudly
     non-empty  → the shift says what it involves
     empty      → asserts no regulated work → under-gates, silently

   Only the third can turn a gate off without anyone noticing, and it
   is legitimate exactly once: for a role that carries no regulated
   duty at all. These tests pin both halves — that the constructor
   cannot produce the dangerous shape, and that the check still lets
   a glassy through.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { shiftAssignment, checkDuties, roleCarriesNoDuties } from "../lib/idara/duties";
import { decide } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { ALL_WORK_FUNCTIONS } from "../lib/idara/hospitality";
import type { Identity, Site } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

const bartender: Identity = {
  did: "did:web:idara.app:w:t",
  name: "T",
  role: "Bartender",
  org: "Brightwater Hospitality",
};

/** RSG binds only to gaming duties here, so the gate is duty-scoped. */
const venue: Site = {
  id: "s-t",
  name: "Test Venue",
  region: "Victoria",
  kind: "venue",
  requires: [{ type: "rsg", appliesTo: ["gaming"] }],
};

const gate = (duties?: ReturnType<typeof shiftAssignment>["duties"]) =>
  decide({
    person: { ...bartender, role: "Gaming Attendant" },
    credentials: [],
    action: "be_rostered",
    site: venue,
    at: AT,
    verifier,
    duties,
  });

describe("the shape that fails silently", () => {
  it("an empty duty list unbinds a duty-scoped requirement", () => {
    // this is the behaviour the guard exists to prevent reaching, not a bug:
    // it is what `?? ` means, and it is why an empty array must not be built
    expect(gate([]).allowed).toBe(true);
    expect(gate([]).reasons[0].outcome).toBe("n/a");
  });

  it("whereas omitting them falls back to the title and blocks", () => {
    expect(gate(undefined).allowed).toBe(false);
  });

  it("so the two differ, which is the whole hazard", () => {
    expect(gate([]).allowed).not.toBe(gate(undefined).allowed);
  });
});

describe("shiftAssignment", () => {
  it("collapses an empty list to omitted, turning silent into loud", () => {
    const s = shiftAssignment("Sat", []);
    expect(s.duties).toBeUndefined();
    expect(gate(s.duties).allowed).toBe(false);
  });

  it("keeps a real duty list untouched", () => {
    expect(shiftAssignment("Sat", ["gaming"])).toEqual({ id: "Sat", duties: ["gaming"] });
  });

  it("passes through an omitted list unchanged", () => {
    expect(shiftAssignment("Sat")).toEqual({ id: "Sat" });
  });

  it("is safe for a role with no duties too — the fallback is also empty", () => {
    const s = shiftAssignment("Sat", []);
    const d = decide({
      person: { ...bartender, role: "Glassy" },
      credentials: [],
      action: "be_rostered",
      site: venue,
      at: AT,
      verifier,
      duties: s.duties,
    });
    expect(d.allowed).toBe(true);
  });

  it("never returns a duties key holding an empty array", () => {
    for (const input of [[], undefined]) {
      const s = shiftAssignment("x", input as undefined);
      expect(s.duties?.length ?? 1).toBeGreaterThan(0);
    }
  });
});

describe("checkDuties", () => {
  it("objects to an empty list for a role that implies duties", () => {
    expect(checkDuties("Bartender", [])).toMatch(/not gated/i);
  });

  it("accepts an empty list for a glassy, who pours and prepares nothing", () => {
    expect(checkDuties("Glassy", [])).toBeNull();
  });

  it("accepts any non-empty list", () => {
    expect(checkDuties("Bartender", ["serve_alcohol"])).toBeNull();
    expect(checkDuties("Glassy", ["handle_food"])).toBeNull();
  });

  it("objects for an unknown role, which maps to every function", () => {
    // the fail-safe direction: an unmapped title is treated as doing
    // everything, so an empty list for one is certainly wrong
    expect(checkDuties("Sommelier", [])).not.toBeNull();
  });
});

describe("roleCarriesNoDuties", () => {
  it("is true only for a role mapped to nothing", () => {
    expect(roleCarriesNoDuties("Glassy")).toBe(true);
    expect(roleCarriesNoDuties("Bartender")).toBe(false);
  });

  it("is false for an unknown role, which gets every function", () => {
    expect(roleCarriesNoDuties("Sommelier")).toBe(false);
  });

  it("is false for no role at all", () => {
    expect(roleCarriesNoDuties("")).toBe(false);
  });

  it("agrees with the catalogue it is derived from", () => {
    expect(ALL_WORK_FUNCTIONS.length).toBeGreaterThan(0);
  });
});
