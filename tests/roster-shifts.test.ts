import { describe, it, expect } from "vitest";
import { shiftsOf, week, DAY_IDS, OFF, type CrewRow } from "../app/(console)/schedule/roster";
import { decideMember } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import type { Identity, Site, Credential } from "../lib/idara/types";

/* ============================================================
   The roster → engine translation.

   This is the function that decides which shifts eligibility is
   asked about and what each involves. It was previously inside the
   page component, which meant the one place an unintended empty
   duty list could reach decide() was unreachable from a test.
   ============================================================ */

const row = (shifts: CrewRow["shifts"]): CrewRow => ({ name: "Test", shifts, total: "40h" });

describe("which shifts the engine is asked about", () => {
  it("drops days off — an unworked shift cannot make anyone ineligible", () => {
    const r = row(week(["11a – 7p", OFF, "11a – 7p", OFF, OFF, OFF, OFF]));
    expect(shiftsOf(r).map((s) => s.id)).toEqual(["Mon", "Wed"]);
  });

  it("names each shift by its day, so a reason can say which one", () => {
    const r = row(week(["4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a", "4p – 12a"]));
    expect(shiftsOf(r).map((s) => s.id)).toEqual(DAY_IDS);
  });

  it("carries per-day duties through", () => {
    const r = row(
      week(["4p – 12a", OFF, OFF, OFF, OFF, "4p – 12a", OFF], {
        5: { duties: ["serve_alcohol", "gaming"], label: "gaming floor" },
      }),
    );
    const out = shiftsOf(r);
    expect(out).toHaveLength(2);
    expect(out[0].duties).toBeUndefined();       // ordinary bar shift, title decides
    expect(out[1].duties).toEqual(["serve_alcohol", "gaming"]);
  });
});

describe("the empty duty list, which is the reason this is guarded", () => {
  it("collapses an empty list to undefined rather than passing it on", () => {
    const r = row(week(["4p – 12a", OFF, OFF, OFF, OFF, OFF, OFF], { 0: { duties: [], label: "x" } }));
    const out = shiftsOf(r);
    // NOT `duties: []` — that would assert the shift involves no regulated work
    expect(out[0].duties).toBeUndefined();
    expect("duties" in out[0]).toBe(false);
  });

  it("keeps a bartender gated on their RSA when the duty list arrives empty", () => {
    /* The hazard, end to end and against the real engine: with duties: [] the
       RSA requirement stops binding and an unlicensed bartender is allowed.
       Routed through shiftsOf they stay blocked. */
    const person: Identity = {
      did: "did:web:idara.app:w:test",
      name: "Test Bartender",
      role: "Bartender",
      org: "Brightwater Hospitality",
    };
    const site: Site = {
      id: "s-test",
      name: "Test Venue",
      region: "Victoria",
      kind: "venue",
      requires: [{ type: "rsa", appliesTo: ["serve_alcohol"] }],
    };
    const noCredentials: Credential[] = [];
    const verifier = new LocalCredentialVerifier();
    const at = "2026-09-03";

    const decide = (shifts: { id: string; duties?: string[] }[]) =>
      decideMember({
        person,
        credentials: noCredentials,
        action: "be_rostered",
        site,
        at,
        verifier,
        shifts: shifts as never,
      });

    // the dangerous shape, constructed by hand: no RSA demanded
    expect(decide([{ id: "Mon", duties: [] }]).allowed).toBe(true);

    // the same roster row through shiftsOf: blocked, because the empty list
    // collapsed and the job title says a bartender serves alcohol
    const viaRoster = shiftsOf(row(week(["4p – 12a", OFF, OFF, OFF, OFF, OFF, OFF], { 0: { duties: [], label: "x" } })));
    expect(decide(viaRoster).allowed).toBe(false);
  });
});
