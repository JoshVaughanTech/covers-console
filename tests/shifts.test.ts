/* ============================================================
   Duties per shift, not per week.

   Someone can be fine behind the bar Monday to Thursday and
   ineligible for Saturday's gaming shift. Evaluating the week as
   one lump either over-demands (union every duty someone touches)
   or misses it entirely.

   decideMember() evaluates once per distinct duty set and merges,
   keeping the worst outcome per requirement and naming the shifts
   it came from — so a manager is told "Saturday", not "blocked".
   ============================================================ */

import { describe, it, expect } from "vitest";
import { decideMember, decideRoster, type ShiftAssignment } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import type { Credential, CredentialTypeId, Identity, Site } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

const bartender: Identity = {
  did: "did:web:idara.app:w:test-bartender",
  name: "Test Bartender",
  role: "Bartender",
  org: "Brightwater Hospitality",
};

let n = 0;
const cred = (type: CredentialTypeId, expiresAt: string | null = "2026-01-01"): Credential => ({
  id: `vc-s${n++}`,
  type,
  subject: bartender.did,
  issuer: "did:web:idara.app",
  issuedAt: "2023-01-15",
  expiresAt,
  status: "valid",
  claims: {},
});

/** RSG gated by duty, so only a gaming shift demands it. */
const venue: Site = {
  id: "s-venue",
  name: "Test Venue",
  region: "Victoria",
  kind: "venue",
  requires: [{ type: "rsg", appliesTo: ["gaming"] }],
};

const bar = (id: string): ShiftAssignment => ({ id, duties: ["serve_alcohol"] });
const gaming = (id: string): ShiftAssignment => ({ id, duties: ["serve_alcohol", "gaming"] });

const run = (shifts: ShiftAssignment[], credentials: Credential[] = [], site: Site = venue) =>
  decideMember({
    person: bartender,
    credentials,
    action: "be_rostered",
    site,
    at: AT,
    verifier,
    shifts,
  });

describe("decideMember — one week, several shifts", () => {
  it("blocks the week when a single shift demands something they lack", async () => {
    const d = run([bar("Mon"), bar("Tue"), bar("Wed"), bar("Thu"), gaming("Sat")]);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].outcome).toBe("fail");
  });

  it("names the offending shift rather than just failing", async () => {
    const d = run([bar("Mon"), bar("Tue"), gaming("Sat")]);
    expect(d.reasons[0].shifts).toEqual(["Sat"]);
    expect(d.reasons[0].detail).toContain("(Sat)");
  });

  it("keeps the shifts in roster order when several are implicated", async () => {
    const d = run([gaming("Tue"), bar("Wed"), gaming("Sat")]);
    expect(d.reasons[0].shifts).toEqual(["Tue", "Sat"]);
  });

  it("does not annotate a reason that applies to every shift", async () => {
    const d = run([gaming("Fri"), gaming("Sat")]);
    expect(d.reasons[0].outcome).toBe("fail");
    expect(d.reasons[0].shifts).toBeUndefined();
    expect(d.reasons[0].detail).not.toContain("(");
  });

  it("passes the whole week once the credential is held", async () => {
    const d = run([bar("Mon"), gaming("Sat")], [cred("rsg")]);
    expect(d.allowed).toBe(true);
  });

  it("is unaffected by shifts that demand nothing extra", async () => {
    const onlyBar = run([bar("Mon"), bar("Tue"), bar("Wed")]);
    expect(onlyBar.allowed).toBe(true);
    expect(onlyBar.reasons[0].outcome).toBe("n/a");
  });

  it("falls back to the job title for shifts with no duties of their own", async () => {
    // a Bartender's title carries no gaming duty
    const d = run([{ id: "Mon" }, { id: "Tue" }]);
    expect(d.allowed).toBe(true);
    expect(d.reasons[0].outcome).toBe("n/a");
  });

  it("treats a title-based shift as distinct from an explicit duty set", async () => {
    // "Mon" uses the title (no gaming); "Sat" explicitly adds it
    const d = run([{ id: "Mon" }, gaming("Sat")]);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].shifts).toEqual(["Sat"]);
  });

  it("behaves exactly like a single decision when no shifts are given", async () => {
    const noShifts = decideMember({
      person: bartender,
      credentials: [],
      action: "be_rostered",
      site: venue,
      at: AT,
      verifier,
    });
    expect(noShifts.allowed).toBe(true);
    expect(noShifts.reasons[0].shifts).toBeUndefined();
  });

  it("keeps the worst outcome when shifts disagree", async () => {
    const site: Site = {
      ...venue,
      requires: [{ type: "first_aid" }], // binds to every shift
    };
    // expiring soon: a warning on every shift, so no shift annotation
    const d = run([bar("Mon"), gaming("Sat")], [cred("first_aid", "2024-05-20")], site);
    expect(d.warnings).toBe(1);
    expect(d.reasons[0].outcome).toBe("warn");
    expect(d.reasons[0].shifts).toBeUndefined();
  });

  it("counts warnings once per requirement, not once per shift", async () => {
    const site: Site = { ...venue, requires: [{ type: "first_aid" }] };
    const many = run(
      [bar("Mon"), bar("Tue"), bar("Wed"), gaming("Sat")],
      [cred("first_aid", "2024-05-20")],
      site,
    );
    expect(many.warnings).toBe(1);
  });

  it("reports one reason per requirement however many shifts there are", async () => {
    const d = run([bar("Mon"), bar("Tue"), bar("Wed"), gaming("Sat")]);
    expect(d.reasons).toHaveLength(venue.requires.length);
  });
});

describe("decideRoster — per-shift duties inside a roster", () => {
  it("blocks the person whose Saturday is the problem, not their colleague", async () => {
    const other: Identity = { ...bartender, did: "did:web:idara.app:w:other", name: "Other" };
    const r = decideRoster({
      roster: [
        {
          person: bartender,
          credentials: [],
          shifts: [bar("Mon"), gaming("Sat")],
        },
        {
          person: other,
          credentials: [],
          shifts: [bar("Mon"), bar("Sat")],
        },
      ],
      action: "be_rostered",
      site: venue,
      at: AT,
      verifier,
    });
    expect(r.decisions[0].allowed).toBe(false);
    expect(r.decisions[0].reasons[0].shifts).toEqual(["Sat"]);
    expect(r.decisions[1].allowed).toBe(true);
  });
});
