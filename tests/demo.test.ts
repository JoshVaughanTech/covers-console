/* ============================================================
   The demo is the product under test in Experiment 1 (the mandate
   test), and its credibility rests on specific people being blocked
   for specific, explainable reasons. These tests pin that narrative
   to the seed data: if someone edits a credential date and quietly
   turns a blocked worker eligible, the story told in the room breaks
   before the room does.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { decide, decideRoster, summarise, summariseCoverage } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { verifyChain } from "../lib/idara/audit";
import {
  CREDENTIALS,
  SEED_AUDIT,
  SITES,
  TODAY,
  WORKERS,
} from "../lib/idara/seed";
import type { Decision, DID } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();

const HOTEL = "s-brightwater";
const GAMING = "s-brightwater-gaming";
const TAVERN = "s-northside";
const WEDDING = "s-werribee-wedding";
const LUNCH = "s-docklands-lunch";

const didOf = (name: string): DID => {
  const w = WORKERS.find((x) => x.name === name);
  if (!w) throw new Error(`no seeded worker named ${name}`);
  return w.did;
};

const siteOf = (id: string) => {
  const s = SITES.find((x) => x.id === id);
  if (!s) throw new Error(`no seeded location ${id}`);
  return s;
};

/** Mirrors IdaraProvider.decideFor: engine over the seeded dataset. */
function check(name: string, siteId = HOTEL): Decision {
  const did = didOf(name);
  return decide({
    person: WORKERS.find((w) => w.did === did)!,
    credentials: CREDENTIALS.filter((c) => c.subject === did),
    action: "be_rostered",
    site: siteOf(siteId),
    at: TODAY,
    verifier,
  });
}

const failCodes = (d: Decision) =>
  d.reasons.filter((r) => r.outcome === "fail").map((r) => r.code);

const failTypes = (d: Decision) =>
  d.reasons
    .filter((r) => r.outcome === "fail")
    .map((r) => r.credentialType)
    .sort();

describe("demo dataset — Brightwater Hotel roster", () => {
  it.each([
    "Darie Roberts",
    "Mitch Egan",
    "Aaron Patel",
    "Sophie Nguyen",
    "Hassan Ali",
    "Priya Sharma",
  ])("%s is cleanly eligible", (name) => {
    const d = check(name);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toBe(0);
  });

  it("Leanne Vidal is eligible but flagged — RSA expiring", () => {
    const d = check("Leanne Vidal");
    expect(d.allowed).toBe(true);
    expect(d.warnings).toBe(1);
    expect(d.reasons.find((r) => r.outcome === "warn")?.credentialType).toBe("rsa");
    expect(summarise(d)).toBe("Eligible with 1 warning");
  });

  it("Jake Morrison is blocked — RSA expired", () => {
    const d = check("Jake Morrison");
    expect(d.allowed).toBe(false);
    expect(failCodes(d)).toEqual(["credential.expired"]);
    expect(failTypes(d)).toEqual(["rsa"]);
  });

  it("Liam O'Brien is blocked — no induction for this location", () => {
    const d = check("Liam O'Brien");
    expect(d.allowed).toBe(false);
    expect(failCodes(d)).toEqual(["credential.missing"]);
    expect(failTypes(d)).toEqual(["site_induction"]);
  });

  it("Michael Tan is blocked — RSA revoked by the regulator", () => {
    const d = check("Michael Tan");
    expect(d.allowed).toBe(false);
    expect(failCodes(d)).toEqual(["credential.revoked"]);
    expect(failTypes(d)).toEqual(["rsa"]);
  });

  it("blocks exactly three of the ten seeded staff", () => {
    const blocked = WORKERS.filter((w) => !check(w.name).allowed).map((w) => w.name);
    expect(blocked.sort()).toEqual(
      ["Jake Morrison", "Liam O'Brien", "Michael Tan"].sort(),
    );
  });

  it("gives every blocked worker a reason a manager can act on", () => {
    for (const w of WORKERS) {
      const d = check(w.name);
      if (d.allowed) continue;
      for (const r of d.reasons.filter((x) => x.outcome === "fail")) {
        expect(r.detail.length).toBeGreaterThan(0);
        expect(r.credentialType).toBeDefined();
      }
    }
  });
});

describe("demo dataset — same building, different licence", () => {
  it("Darie works the hotel floor but is blocked from the gaming room — no RSG", () => {
    expect(check("Darie Roberts", HOTEL).allowed).toBe(true);

    const d = check("Darie Roberts", GAMING);
    expect(d.allowed).toBe(false);
    // he IS inducted for the gaming room; RSG is the only thing missing
    expect(failTypes(d)).toEqual(["rsg"]);
    expect(failCodes(d)).toEqual(["credential.missing"]);
  });

  it("Mitch clears both the floor and the gaming room", () => {
    expect(check("Mitch Egan", HOTEL).allowed).toBe(true);
    expect(check("Mitch Egan", GAMING).allowed).toBe(true);
  });

  it("Sophie, as venue manager, clears the floor, the gaming room and the tavern", () => {
    expect(check("Sophie Nguyen", HOTEL).allowed).toBe(true);
    expect(check("Sophie Nguyen", GAMING).allowed).toBe(true);
    expect(check("Sophie Nguyen", TAVERN).allowed).toBe(true);
  });
});

describe("demo dataset — requirements bind to duties, not to everyone", () => {
  it("Hassan holds no RSA at all, and is still eligible on the floor", () => {
    const rsas = CREDENTIALS.filter(
      (c) => c.subject === didOf("Hassan Ali") && c.type === "rsa",
    );
    expect(rsas).toHaveLength(0);

    const d = check("Hassan Ali");
    expect(d.allowed).toBe(true);
    const rsaCheck = d.reasons.find((r) => r.credentialType === "rsa");
    expect(rsaCheck?.outcome).toBe("n/a");
    expect(rsaCheck?.detail).toContain("Head Chef");
  });

  it("the same missing RSA still blocks people who do serve alcohol", () => {
    // Jake is a Bar Attendant — the licence binds, and his has expired
    expect(check("Jake Morrison").allowed).toBe(false);
    expect(failTypes(check("Jake Morrison"))).toEqual(["rsa"]);
  });

  it("records the skipped check rather than dropping it from the trail", () => {
    const d = check("Hassan Ali");
    // one entry per requirement at this location, none silently missing
    expect(d.reasons).toHaveLength(siteOf(HOTEL).requires.length);
  });

  it("a bartender is still blocked from the gaming room — the room implies the duty", () => {
    // RSG is not role-scoped: rostering someone into the gaming room IS the
    // gaming duty, so a bartender without RSG cannot work it.
    const d = check("Darie Roberts", GAMING);
    expect(d.allowed).toBe(false);
    expect(failTypes(d)).toEqual(["rsg"]);
  });

  it("food tickets bind to the kitchen, not to the bar", () => {
    // allergen training is genuinely per-person, so it binds to Hassan.
    // FSS is not: it's owed by the operation, so it never appears here.
    expect(failTypes(check("Hassan Ali", WEDDING))).toEqual(["allergen_management"]);
    expect(
      check("Hassan Ali", WEDDING).reasons.some(
        (r) => r.credentialType === "food_safety_supervisor",
      ),
    ).toBe(false);
  });
});

describe("demo dataset — venues vs. off-premise catering", () => {
  it("Hassan clears the hotel but is blocked at the wedding", () => {
    expect(check("Hassan Ali", HOTEL).allowed).toBe(true);

    const d = check("Hassan Ali", WEDDING);
    expect(d.allowed).toBe(false);
    // he is briefed for the event; off-premise catering demands allergen
    // training of anyone plating
    expect(failTypes(d)).toEqual(["allergen_management"]);
  });

  it("Priya carries one RSA across the venue and both catering operations", () => {
    for (const where of [HOTEL, WEDDING, LUNCH]) {
      expect(check("Priya Sharma", where).allowed, where).toBe(true);
    }
    // one RSA, three separate inductions — the portability argument
    const inductions = CREDENTIALS.filter(
      (c) => c.subject === didOf("Priya Sharma") && c.type === "site_induction",
    );
    expect(inductions).toHaveLength(3);
    expect(
      CREDENTIALS.filter((c) => c.subject === didOf("Priya Sharma") && c.type === "rsa"),
    ).toHaveLength(1);
  });

  it("a hotel-eligible worker is not automatically eligible off-premise", () => {
    expect(check("Aaron Patel", HOTEL).allowed).toBe(true);
    expect(check("Aaron Patel", WEDDING).allowed).toBe(false);
  });

  it("every location is reachable by at least one worker", () => {
    for (const s of SITES) {
      const anyEligible = WORKERS.some((w) => check(w.name, s.id).allowed);
      expect(anyEligible, `nobody can work ${s.name}`).toBe(true);
    }
  });
});

describe("demo dataset — obligations owed by the roster, not the person", () => {
  const rosterAt = (names: string[], siteId: string) =>
    decideRoster({
      roster: names.map((n) => {
        const did = didOf(n);
        return {
          person: WORKERS.find((w) => w.did === did)!,
          credentials: CREDENTIALS.filter((c) => c.subject === did),
        };
      }),
      action: "be_rostered",
      site: siteOf(siteId),
      at: TODAY,
      verifier,
    });

  it("blocks a tavern shift with no Food Safety Supervisor on, though nobody is at fault", () => {
    // Darie is personally eligible at the tavern — RSA, induction, food handling
    const alone = rosterAt(["Darie Roberts"], TAVERN);
    expect(alone.decisions.every((d) => d.allowed)).toBe(true);

    // …and the shift is still unpublishable, because the venue owes an FSS
    expect(alone.allowed).toBe(false);
    expect(summariseCoverage(alone.coverage)).toBe("Roster lacks FSS cover");
    expect(alone.coverage[0].detail).toContain("No one rostered holds");
  });

  it("the same shift publishes once a supervisor is on it", () => {
    const withSophie = rosterAt(["Darie Roberts", "Sophie Nguyen"], TAVERN);
    expect(withSophie.allowed).toBe(true);
    expect(withSophie.coverage[0].holders.map((h) => h.name)).toEqual(["Sophie Nguyen"]);
    expect(summariseCoverage(withSophie.coverage)).toBeNull();
  });

  it("the wedding is covered by its functions coordinator", () => {
    const r = rosterAt(["Priya Sharma"], WEDDING);
    expect(r.allowed).toBe(true);
    expect(r.coverage[0].holders.map((h) => h.name)).toEqual(["Priya Sharma"]);
  });

  it("does not demand the FSS ticket of every cook", () => {
    const r = rosterAt(["Priya Sharma", "Hassan Ali"], TAVERN);
    // Hassan holds no FSS and is not personally faulted for it
    expect(
      r.decisions.some((d) =>
        d.reasons.some((x) => x.credentialType === "food_safety_supervisor"),
      ),
    ).toBe(false);
  });

  it("won't accept a supervisor who can't be rostered anyway", () => {
    // Sophie holds the FSS but has no induction for the wedding site
    const r = rosterAt(["Sophie Nguyen"], WEDDING);
    expect(r.decisions[0].allowed).toBe(false);
    expect(r.coverage[0].holders).toHaveLength(0);
    expect(r.coverage[0].met).toBe(false);
  });

  it("the hotel bistro owes a supervisor, and the seeded crew covers it", () => {
    const r = rosterAt(["Sophie Nguyen", "Darie Roberts", "Aaron Patel"], HOTEL);
    expect(r.coverage[0].met).toBe(true);
    expect(r.coverage[0].holders.map((h) => h.name)).toEqual(["Sophie Nguyen"]);
    expect(r.allowed).toBe(true);
  });

  it("the gaming room owes no collective ticket", () => {
    expect(rosterAt(["Mitch Egan"], GAMING).coverage).toHaveLength(0);
  });
});

describe("demo dataset — the publish gate", () => {
  const roster = (names: string[], siteId = HOTEL) => {
    const decisions = names.map((n) => check(n, siteId));
    const blocked = decisions.filter((d) => !d.allowed);
    return { decisions, blocked, published: blocked.length === 0 };
  };

  it("refuses to publish a roster containing an ineligible worker", () => {
    const r = roster(["Darie Roberts", "Aaron Patel", "Michael Tan"]);
    expect(r.published).toBe(false);
    expect(r.blocked).toHaveLength(1);
  });

  it("one bad worker is enough to block the whole roster", () => {
    expect(roster(WORKERS.map((w) => w.name)).published).toBe(false);
  });

  it("publishes once the ineligible workers are removed", () => {
    const eligible = WORKERS.map((w) => w.name).filter((n) => check(n).allowed);
    expect(roster(eligible).published).toBe(true);
    expect(eligible).toHaveLength(7);
  });

  it("still publishes when the only issue is an expiring credential", () => {
    const r = roster(["Darie Roberts", "Leanne Vidal"]);
    expect(r.published).toBe(true);
    expect(r.decisions.some((d) => d.warnings > 0)).toBe(true);
  });
});

describe("demo dataset — the audit trail", () => {
  it("ships with an intact hash chain", () => {
    expect(verifyChain(SEED_AUDIT)).toEqual({ ok: true, brokenAt: null });
  });

  it("is sequential and fully linked from genesis", () => {
    expect(SEED_AUDIT.length).toBeGreaterThan(0);
    SEED_AUDIT.forEach((e, i) => expect(e.seq).toBe(i));
  });

  it("explains Michael Tan's block with a dated, recorded revocation", () => {
    // the demo claim: "there's a dated record of why"
    const revocation = SEED_AUDIT.find(
      (e) => e.type === "credential.revoked" && e.subject === didOf("Michael Tan"),
    );
    expect(revocation).toBeDefined();
    expect(revocation!.at).toBe("2024-05-10");
    expect(revocation!.at < TODAY).toBe(true);
    expect(check("Michael Tan").allowed).toBe(false);
  });
});
