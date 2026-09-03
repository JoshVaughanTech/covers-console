/* ============================================================
   Roster-level requirements: obligations that belong to the
   shift rather than to any one person. A venue must have a
   nominated Food Safety Supervisor on; it does not need every
   kitchen hand to hold the ticket.

   The load-bearing rule is that only *eligible* people count as
   holders. A supervisor who can't lawfully be rostered isn't
   going to be there, so counting them would let a roster pass on
   somebody's absence.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { decideRoster, summariseCoverage, type RosterMember } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import type { Credential, CredentialTypeId, Site } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

let n = 0;
const cred = (
  subject: string,
  type: CredentialTypeId,
  over: Partial<Credential> = {},
): Credential => ({
  id: `vc-rr${n++}`,
  type,
  subject,
  issuer: "did:web:idara.app",
  issuedAt: "2023-01-15",
  expiresAt: "2026-01-01",
  status: "valid",
  claims: {},
  ...over,
});

/** Someone who satisfies the per-person rules below. */
const member = (
  name: string,
  role: string,
  extra: CredentialTypeId[] = [],
): RosterMember => {
  const did = `did:web:idara.app:w:${name.toLowerCase()}`;
  return {
    person: { did, name, role, org: "Brightwater Hospitality" },
    credentials: [
      cred(did, "site_induction", { claims: { siteId: "s-kitchen" } }),
      ...extra.map((t) => cred(did, t)),
    ],
  };
};

/** Induction for everyone; one FSS across the whole roster. */
const kitchen: Site = {
  id: "s-kitchen",
  name: "Test Kitchen",
  region: "Victoria",
  kind: "venue",
  requires: [{ type: "site_induction", siteScoped: true }],
  requiresOnRoster: [{ type: "food_safety_supervisor", minHolders: 1 }],
};

const run = (roster: RosterMember[], site: Site = kitchen) =>
  decideRoster({ roster, action: "be_rostered", site, at: AT, verifier });

describe("decideRoster — collective requirements", () => {
  it("passes when one person on the roster holds the ticket", () => {
    const r = run([
      member("Ada", "Kitchen Hand"),
      member("Ben", "Head Chef", ["food_safety_supervisor"]),
    ]);
    expect(r.allowed).toBe(true);
    expect(r.coverage[0].met).toBe(true);
    expect(r.coverage[0].holders.map((h) => h.name)).toEqual(["Ben"]);
  });

  it("blocks when nobody holds it, even though everyone is individually eligible", () => {
    const r = run([member("Ada", "Kitchen Hand"), member("Cal", "Kitchen Hand")]);
    expect(r.decisions.every((d) => d.allowed)).toBe(true); // no individual fault
    expect(r.allowed).toBe(false);
    expect(r.coverage[0].met).toBe(false);
    expect(r.coverage[0].detail).toContain("No one rostered holds");
  });

  it("does not demand the ticket of everyone", () => {
    const r = run([
      member("Ada", "Kitchen Hand"),
      member("Ben", "Head Chef", ["food_safety_supervisor"]),
    ]);
    // Ada holds no FSS and is still individually eligible
    expect(r.decisions[0].allowed).toBe(true);
    expect(
      r.decisions[0].reasons.some((x) => x.credentialType === "food_safety_supervisor"),
    ).toBe(false);
  });

  it("counts only people who are themselves eligible", () => {
    // Ben holds the FSS but has no induction, so he can't be rostered at all
    const ben: RosterMember = {
      person: {
        did: "did:web:idara.app:w:ben",
        name: "Ben",
        role: "Head Chef",
        org: "Brightwater Hospitality",
      },
      credentials: [cred("did:web:idara.app:w:ben", "food_safety_supervisor")],
    };
    const r = run([member("Ada", "Kitchen Hand"), ben]);
    expect(r.decisions[1].allowed).toBe(false);
    expect(r.coverage[0].met).toBe(false);
    expect(r.coverage[0].holders).toHaveLength(0);
  });

  it("ignores a holder whose own ticket is expired or revoked", () => {
    const stale = member("Ben", "Head Chef");
    stale.credentials.push(
      cred(stale.person.did, "food_safety_supervisor", { expiresAt: "2023-01-01" }),
    );
    expect(run([stale]).coverage[0].met).toBe(false);

    const revoked = member("Cal", "Head Chef");
    revoked.credentials.push(
      cred(revoked.person.did, "food_safety_supervisor", { status: "revoked" }),
    );
    expect(run([revoked]).coverage[0].met).toBe(false);
  });

  it("honours minHolders above one", () => {
    const site: Site = {
      ...kitchen,
      requiresOnRoster: [{ type: "food_safety_supervisor", minHolders: 2 }],
    };
    const one = run([member("Ada", "Head Chef", ["food_safety_supervisor"])], site);
    expect(one.coverage[0].met).toBe(false);
    expect(one.coverage[0].required).toBe(2);

    const two = run(
      [
        member("Ada", "Head Chef", ["food_safety_supervisor"]),
        member("Ben", "Sous Chef", ["food_safety_supervisor"]),
      ],
      site,
    );
    expect(two.coverage[0].met).toBe(true);
    expect(two.coverage[0].holders).toHaveLength(2);
  });

  it("fails an empty roster that owes coverage", () => {
    const r = run([]);
    expect(r.allowed).toBe(false);
    expect(r.coverage[0].met).toBe(false);
  });

  it("allows an empty roster where nothing collective is owed", () => {
    const open: Site = { ...kitchen, requires: [], requiresOnRoster: [] };
    expect(run([], open).allowed).toBe(true);
  });

  it("treats a site with no requiresOnRoster as having no coverage duty", () => {
    const plain: Site = { id: "s-p", name: "Plain", region: "Vic", kind: "venue", requires: [] };
    const r = run([member("Ada", "Kitchen Hand")], plain);
    expect(r.coverage).toHaveLength(0);
    expect(r.allowed).toBe(true);
  });

  it("respects siteScoped on a collective requirement", () => {
    const scoped: Site = {
      ...kitchen,
      requiresOnRoster: [
        { type: "food_safety_supervisor", minHolders: 1, siteScoped: true },
      ],
    };
    const wrongSite = member("Ben", "Head Chef");
    wrongSite.credentials.push(
      cred(wrongSite.person.did, "food_safety_supervisor", {
        claims: { siteId: "s-elsewhere" },
      }),
    );
    expect(run([wrongSite], scoped).coverage[0].met).toBe(false);

    const rightSite = member("Cal", "Head Chef");
    rightSite.credentials.push(
      cred(rightSite.person.did, "food_safety_supervisor", {
        claims: { siteId: "s-kitchen" },
      }),
    );
    expect(run([rightSite], scoped).coverage[0].met).toBe(true);
  });

  it("still blocks on individual failures alongside good coverage", () => {
    const noInduction: RosterMember = {
      person: {
        did: "did:web:idara.app:w:dee",
        name: "Dee",
        role: "Kitchen Hand",
        org: "Brightwater Hospitality",
      },
      credentials: [],
    };
    const r = run([
      member("Ben", "Head Chef", ["food_safety_supervisor"]),
      noInduction,
    ]);
    expect(r.coverage[0].met).toBe(true);
    expect(r.allowed).toBe(false);
  });

  it("returns per-person decisions in roster order", () => {
    const r = run([
      member("Ada", "Kitchen Hand"),
      member("Ben", "Head Chef", ["food_safety_supervisor"]),
    ]);
    expect(r.decisions.map((d) => d.context.subjectName)).toEqual(["Ada", "Ben"]);
  });
});

describe("summariseCoverage", () => {
  it("is null when everything is covered", () => {
    const r = run([member("Ben", "Head Chef", ["food_safety_supervisor"])]);
    expect(summariseCoverage(r.coverage)).toBeNull();
  });

  it("names the missing cover", () => {
    const r = run([member("Ada", "Kitchen Hand")]);
    expect(summariseCoverage(r.coverage)).toBe("Roster lacks FSS cover");
  });
});
