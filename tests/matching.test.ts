/* ============================================================
   The matcher.

   The property that matters most is negative: no combination of
   skill, rating, locality or fairness can put an Idara-ineligible
   person into the ranking. Eligibility is a gate, not a score, and
   a scoring bug must never become a compliance bug.

   The second property is that the explanation is real: the chips a
   manager reads must add up to the number they're ranked by.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { rankForShift } from "../lib/matching/matcher";
import { WEIGHTS, FULL_WEEK_HOURS } from "../lib/matching/types";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { CREDENTIALS, SITES, TODAY, WORKERS } from "../lib/idara/seed";
import { PROFILES, profileOf } from "../lib/people/seed";
import { POSTINGS } from "../lib/shifts/seed";
import type { Identity, Site } from "../lib/idara/types";
import type { ShiftPosting } from "../lib/shifts/types";

const verifier = new LocalCredentialVerifier();

const siteOf = (id: string): Site => {
  const s = SITES.find((x) => x.id === id);
  if (!s) throw new Error(`no site ${id}`);
  return s;
};

const posting = (id: string): ShiftPosting => {
  const p = POSTINGS.find((x) => x.id === id);
  if (!p) throw new Error(`no posting ${id}`);
  return p;
};

const didOf = (name: string) => {
  const w = WORKERS.find((x) => x.name === name);
  if (!w) throw new Error(`no worker ${name}`);
  return w.did;
};

/** Everyone, as the manage view would pass them in. */
const everyone = () =>
  WORKERS.map((person) => ({
    person,
    credentials: CREDENTIALS.filter((c) => c.subject === person.did),
    profile: profileOf(person.did),
  }));

const run = (postingId: string) => {
  const p = posting(postingId);
  return rankForShift({
    posting: p,
    site: siteOf(p.siteId),
    people: everyone(),
    at: TODAY,
    verifier,
  });
};

describe("the Idara gate", () => {
  it("excludes ineligible people from the ranking entirely", () => {
    const r = run("sp-fridaylive-bar");
    const ranked = r.candidates.map((c) => c.name);
    // Jake's RSA expired; Michael's was revoked; Liam has no induction
    for (const name of ["Jake Morrison", "Michael Tan", "Liam O'Brien"]) {
      expect(ranked, `${name} must not be ranked`).not.toContain(name);
    }
  });

  it("does not merely rank them last — they have no position at all", () => {
    const r = run("sp-fridaylive-bar");
    const excludedNames = r.excluded.map((e) => e.name);
    expect(excludedNames).toContain("Jake Morrison");
    // and the exclusion carries the credential reason, not a score
    const jake = r.excluded.find((e) => e.name === "Jake Morrison")!;
    expect(jake.kind).toBe("idara");
    expect(jake.reason).toMatch(/RSA/i);
  });

  it("a strong profile cannot buy a way past the gate", () => {
    // give Jake a perfect profile: top rating, every skill at lead, no hours
    const p = posting("sp-fridaylive-bar");
    const jake = WORKERS.find((w) => w.name === "Jake Morrison")!;
    const r = rankForShift({
      posting: p,
      site: siteOf(p.siteId),
      people: [
        {
          person: jake,
          credentials: CREDENTIALS.filter((c) => c.subject === jake.did),
          profile: {
            did: jake.did,
            rating: 5,
            homeSiteId: p.siteId,
            skills: { cocktails: "lead", till_pos: "lead" },
            hoursThisWeek: 0,
          },
        },
      ],
      at: TODAY,
      verifier,
    });
    expect(r.candidates).toHaveLength(0);
    expect(r.excluded[0].kind).toBe("idara");
  });

  it("separates a business rule from a compliance failure", () => {
    // Michael is excluded from Meridian Group, but that is availability,
    // not eligibility — and at this site his RSA blocks him first anyway
    const r = run("sp-2038-wait");
    const michael = r.excluded.find((e) => e.name === "Michael Tan");
    expect(michael).toBeDefined();
    expect(["idara", "availability"]).toContain(michael!.kind);
  });

  it("excludes people already assigned to the shift", () => {
    const r = run("sp-fridaylive-bar");
    const darie = r.excluded.find((e) => e.name === "Darie Roberts");
    expect(darie?.kind).toBe("assigned");
    expect(r.candidates.map((c) => c.name)).not.toContain("Darie Roberts");
  });
});

describe("explanations", () => {
  it("every candidate's chips sum exactly to their score", () => {
    for (const id of POSTINGS.map((p) => p.id)) {
      for (const c of run(id).candidates) {
        const sum = c.reasons.reduce((s, r) => s + r.points, 0);
        expect(sum, `${c.name} on ${id}`).toBe(c.score);
      }
    }
  });

  it("gives every candidate at least one reason", () => {
    for (const c of run("sp-fridaylive-bar").candidates) {
      expect(c.reasons.length).toBeGreaterThan(0);
      for (const r of c.reasons) expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  it("ranks highest score first", () => {
    const scores = run("sp-fridaylive-bar").candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("never scores an Idara warning — it notes it instead", () => {
    // Leanne's RSA expires inside the warning window
    const r = run("sp-fridaylive-bar");
    const leanne = r.candidates.find((c) => c.name === "Leanne Vidal");
    expect(leanne).toBeDefined();
    expect(leanne!.notes.some((n) => /RSA/i.test(n.detail))).toBe(true);
    expect(leanne!.reasons.some((x) => /expires/i.test(x.detail))).toBe(false);
  });
});

describe("the scoring components", () => {
  it("rewards a met skill and penalises a missing one", () => {
    const r = run("sp-fridaylive-bar");
    const aaron = r.candidates.find((c) => c.name === "Aaron Patel")!;
    const cocktails = aaron.reasons.find((x) => /Can run Cocktails/.test(x.detail));
    const till = aaron.reasons.find((x) => /Missing Till/.test(x.detail));
    expect(cocktails!.points).toBeGreaterThan(0);
    expect(till!.points).toBeLessThan(0);
  });

  it("gives partial credit for a skill held below the level wanted", () => {
    // Mitch has cocktails at basic; the shift wants solid
    const mitch = run("sp-fridaylive-bar").candidates.find((c) => c.name === "Mitch Egan")!;
    const below = mitch.reasons.find((x) => /below the level wanted/.test(x.detail))!;
    expect(below.points).toBeGreaterThan(0);
    expect(below.points).toBeLessThan(WEIGHTS.skill);
  });

  it("turns fairness negative past a full week", () => {
    const r = run("sp-fridaylive-bar");
    const sophie = r.candidates.find((c) => c.name === "Sophie Nguyen")!;
    const fairness = sophie.reasons.find((x) => x.component === "fairness")!;
    expect(sophie.reasons.some((x) => x.component === "fairness")).toBe(true);
    expect(fairness.points).toBeLessThan(0);
    expect(fairness.detail).toContain("overtime risk");
  });

  it("treats exactly a full week as no room left, not room for more", () => {
    // Leanne sits on exactly FULL_WEEK_HOURS. The boundary belongs to the
    // overtime branch: at a full week there is no spare capacity to reward,
    // and reading "room for more" there would invite the extra shift.
    const leanne = run("sp-fridaylive-bar").candidates.find((c) => c.name === "Leanne Vidal")!;
    const fairness = leanne.reasons.find((x) => x.component === "fairness")!;
    expect(fairness.detail).toContain("overtime risk");
    expect(fairness.detail).not.toContain("room for more");
    expect(fairness.points).toBe(0);
    // and never -0, which Object.is separates from 0
    expect(Object.is(fairness.points, -0)).toBe(false);
  });

  it("rewards spare capacity", () => {
    const aaron = run("sp-fridaylive-bar").candidates.find((c) => c.name === "Aaron Patel")!;
    const fairness = aaron.reasons.find((x) => x.component === "fairness")!;
    expect(fairness.points).toBeGreaterThan(0);
    expect(fairness.detail).toContain("room for more");
  });

  it("applies client preference only where there is a client", () => {
    // in-house: no client component at all
    const inHouse = run("sp-fridaylive-bar").candidates;
    expect(inHouse.every((c) => !c.reasons.some((r) => r.component === "client"))).toBe(true);

    // client-paid: the component applies
    const clientPaid = run("sp-2041-wait").candidates;
    expect(clientPaid.length).toBeGreaterThan(0);
    expect(clientPaid.every((c) => c.reasons.some((r) => r.component === "client"))).toBe(true);
  });

  it("scores an exact role above a merely related one", () => {
    const r = run("sp-fridaylive-bar");
    const aaron = r.candidates.find((c) => c.name === "Aaron Patel")!; // Bartender
    const mitch = r.candidates.find((c) => c.name === "Mitch Egan")!; // Gaming Attendant
    const aRole = aaron.reasons.find((x) => x.component === "role")!.points;
    const mRole = mitch.reasons.find((x) => x.component === "role")!.points;
    expect(aRole).toBe(WEIGHTS.role);
    expect(mRole).toBeLessThan(aRole);
    expect(mRole).toBeGreaterThan(0);
  });

  it("rewards the home venue", () => {
    const aaron = run("sp-fridaylive-bar").candidates.find((c) => c.name === "Aaron Patel")!;
    expect(aaron.reasons.find((x) => x.component === "locality")?.points).toBe(WEIGHTS.locality);
  });

  it("weights are the published ones and total 100", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    expect(WEIGHTS.skill).toBe(32);
    expect(FULL_WEEK_HOURS).toBe(38);
  });
});

describe("the seeded postings", () => {
  it("every posting can be ranked without throwing", () => {
    for (const p of POSTINGS) expect(() => run(p.id)).not.toThrow();
  });

  it("every seeded worker has a profile", () => {
    for (const w of WORKERS) expect(profileOf(w.did), w.name).toBeDefined();
    expect(PROFILES).toHaveLength(WORKERS.length);
  });

  it("finds somebody eligible for the Friday bar shift", () => {
    expect(run("sp-fridaylive-bar").candidates.length).toBeGreaterThan(0);
  });
});
