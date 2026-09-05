/* ============================================================
   What another credential would open up.

   This is the one number on the profile screen that tells somebody
   to go and spend money, so the test that matters is not "does it
   count" but "does it ever count a shift that would still be
   blocked". A count assembled from refusal messages would; this is
   built from the gate's own answer to a counterfactual, and the
   tests below are what hold it to that.
   ============================================================ */
import { describe, it, expect } from "vitest";
import { unlocksFor, claimBlockReason, POSTINGS, type ShiftPosting } from "../lib/shifts";
import { CREDENTIALS, SITES, WORKERS, TODAY } from "../lib/idara/seed";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import type { Credential } from "../lib/idara";

const verifier = new LocalCredentialVerifier();
const siteOf = (id: string) => SITES.find((s) => s.id === id);
const worker = (name: string) => WORKERS.find((w) => w.name === name)!;
const credsOf = (did: string) => CREDENTIALS.filter((c) => c.subject === did);

const run = (name: string, over: { credentials?: Credential[]; postings?: ShiftPosting[] } = {}) => {
  const person = worker(name);
  return unlocksFor({
    person,
    credentials: over.credentials ?? credsOf(person.did),
    postings: over.postings ?? POSTINGS,
    siteOf,
    at: TODAY,
    verifier,
  });
};

describe("every shift counted actually opens", () => {
  /* The guard that makes the number safe to act on. For each unlock and each
     posting it names, the gate is asked directly: blocked now, and clear with
     the credential. Nothing here trusts unlocksFor's own arithmetic. */
  it("is blocked before and claimable after, for every posting named", async () => {
    for (const name of WORKERS.map((w) => w.name)) {
      const person = worker(name);
      const credentials = credsOf(person.did);

      for (const u of run(name)) {
        for (const postingId of u.postingIds) {
          const posting = POSTINGS.find((p) => p.id === postingId)!;
          const site = siteOf(posting.siteId);

          const before = claimBlockReason({ posting, person, site, credentials, at: TODAY, verifier });
          expect(before, `${name} / ${postingId} was already claimable`).not.toBeNull();

          /* Replaces rather than appends, matching the module: decideMember()
             verifies the FIRST credential of the type it finds, so appending
             beside a revoked one proves nothing. */
          const after = claimBlockReason({
            posting,
            person,
            site,
            credentials: [
              ...credentials.filter(
                (c) => !(c.type === u.type && (!u.siteScoped || c.claims.siteId === posting.siteId)),
              ),
              {
                id: "probe", type: u.type, subject: person.did, issuer: "probe",
                issuedAt: TODAY, expiresAt: "2099-12-31", status: "valid",
                claims: { siteId: posting.siteId },
              },
            ],
            at: TODAY,
            verifier,
          });
          expect(after, `${name} / ${postingId} would still be blocked by: ${after}`).toBeNull();
        }
      }
    }
  });
});

describe("what it does not count", () => {
  it("says nothing when every shift is already open to them", async () => {
    // somebody fully credentialled has nothing to go and get
    const person = worker("Darie Roberts");
    const open = POSTINGS.filter(
      (p) =>
        p.status === "open" &&
        claimBlockReason({ posting: p, person, site: siteOf(p.siteId), credentials: credsOf(person.did), at: TODAY, verifier }) === null,
    );
    const unlocks = unlocksFor({
      person, credentials: credsOf(person.did), postings: open, siteOf, at: TODAY, verifier,
    });
    expect(unlocks).toEqual([]);
  });

  it("ignores drafts and filled shifts", async () => {
    /* A certificate does not get you onto a shift nobody is offering, and it
       does not get you a seat that is taken. Counting either inflates the
       number in the direction that costs the worker a course fee. */
    const person = worker("Michael Tan");
    const drafted = POSTINGS.map((p) => ({ ...p, status: "draft" as const }));
    expect(run("Michael Tan", { postings: drafted })).toEqual([]);

    const filled = POSTINGS.map((p) => ({ ...p, assigned: Array(p.seats).fill(person.did) }));
    expect(run("Michael Tan", { postings: filled })).toEqual([]);
  });

  it("does not offer a credential they already hold, current and in scope", async () => {
    for (const name of WORKERS.map((w) => w.name)) {
      const valid = credsOf(worker(name).did).filter((c) => verifier.verify(c, TODAY).status === "valid");
      for (const u of run(name)) {
        const alreadyHas = valid.some(
          (c) => c.type === u.type && (!u.siteScoped || c.claims.siteId === u.siteId),
        );
        expect(alreadyHas, `${name} was told to get a ${u.shortLabel} they already hold`).toBe(false);
      }
    }
  });

  it("still offers a site induction for a venue they are NOT inducted at", async () => {
    /* The bug this replaced. Darie holds inductions at several venues, so
       keying "already held" on the type alone marked site_induction as held
       and skipped it — and the one venue he is actually blocked at vanished
       from the list, on the screen that exists to say what to do next. */
    const darie = run("Darie Roberts");
    const induction = darie.find((u) => u.type === "site_induction");
    expect(induction, "Darie is blocked on a Docklands induction and was told nothing").toBeDefined();
    expect(induction!.siteScoped).toBe(true);
    expect(induction!.siteName).toBe("Docklands Corporate Lunch");
  });
});

describe("a lapsed credential is a renewal, not a silence", () => {
  /* decideMember() verifies the FIRST credential matching the type, so a
     revoked one at the head of the list shadows anything added after it. The
     counterfactual therefore replaces rather than appends — which is also
     simply truer, since renewing gives you one credential and not two. */
  it.each([
    ["expired", { expiresAt: "2024-01-01" }],
    ["revoked", { status: "revoked" as const }],
    ["suspended", { status: "suspended" as const }],
  ])("offers an RSA that is %s", (_label, patch) => {
    const person = worker("Michael Tan");
    const lapsed = credsOf(person.did).map((c) => (c.type === "rsa" ? { ...c, ...patch } : c));
    const unlocks = unlocksFor({
      person, credentials: lapsed, postings: POSTINGS, siteOf, at: TODAY, verifier,
    });
    const rsa = unlocks.find((u) => u.type === "rsa");
    expect(rsa, `a ${_label} RSA surfaced no renewal`).toBeDefined();
    expect(rsa!.postingIds.length).toBeGreaterThan(0);
  });

  it("gives the seeded revoked-RSA worker something to act on", async () => {
    // Michael Tan's RSA is revoked in the seed; the board has work he could
    // take with it back, and saying nothing is the one useless answer
    const rsa = run("Michael Tan").find((u) => u.type === "rsa");
    expect(rsa).toBeDefined();
    expect(rsa!.siteScoped).toBe(false);
  });
});

describe("site-scoped credentials are one row per venue", () => {
  it("never merges two venues into one instruction", async () => {
    /* "Induction · unlocks 2 shifts" reads as one errand. An induction at
       Brightwater does nothing for a shift at Werribee, so the merged row is
       an instruction that cannot be followed. */
    for (const name of WORKERS.map((w) => w.name)) {
      for (const u of run(name)) {
        if (!u.siteScoped) continue;
        expect(u.siteId, `${u.shortLabel} for ${name} names no venue`).toBeTruthy();
        const sites = new Set(
          u.postingIds.map((id) => POSTINGS.find((p) => p.id === id)!.siteId),
        );
        expect(sites.size, `${u.shortLabel} for ${name} spans ${sites.size} venues in one row`).toBe(1);
        expect([...sites][0]).toBe(u.siteId);
      }
    }
  });

  it("gives the un-inducted worker a row per venue rather than one merged row", async () => {
    const liam = run("Liam O'Brien").filter((u) => u.type === "site_induction");
    expect(liam.length).toBeGreaterThan(1);
    expect(new Set(liam.map((u) => u.siteId)).size).toBe(liam.length);
  });

  it("leaves a portable credential without a venue", async () => {
    const hassan = run("Hassan Ali").find((u) => u.type === "rsa");
    expect(hassan).toBeDefined();
    expect(hassan!.siteScoped).toBe(false);
    expect(hassan!.siteId).toBeUndefined();
  });
});

describe("never tells someone to buy a credential they already hold", () => {
  /* An invariant, and — as of ef4b5b5 — one nothing can currently violate.
     Saying so is the point of this comment.

     It was written against a real bug: decideMember() took the first
     credential of a type and verified only that, so a superseded record
     sitting earlier in the array refused somebody who lawfully held a current
     one, and this module would then have offered them the licence they were
     holding. The engine now weighs every matching record, so a renewal is no
     longer refused and the route into that failure is closed at its source.

     Which means these two tests no longer bite. Measured, not assumed: with
     the renewal shape below, the number of postings a fresh RSA would clear is
     ZERO — so removing the holdsValid guard would change nothing here, and a
     passing run proves the invariant holds rather than that it was tested.

     They stay because the invariant is worth stating and cheap to keep: any
     future path that reports somebody blocked on a credential they hold would
     surface here as a wrong instruction to go and buy it. They are a tripwire,
     not a demonstration, and dressing them up as the second would be the
     coverage-costume this file already warns about twice. */
  const shape = () => {
    const person = worker("Michael Tan");
    const others = credsOf(person.did).filter((c) => c.type !== "rsa");
    const rsa = credsOf(person.did).find((c) => c.type === "rsa")!;
    return {
      person,
      // superseded first, current second — the order that trips the gate
      credentials: [
        ...others,
        { ...rsa, id: "rsa-old", status: "expired" as const, expiresAt: "2024-01-01" },
        { ...rsa, id: "rsa-new", status: "valid" as const, expiresAt: "2099-12-31" },
      ],
    };
  };

  it("offers no RSA to someone holding a current one, whatever the gate says", async () => {
    const { person, credentials } = shape();
    const unlocks = unlocksFor({ person, credentials, postings: POSTINGS, siteOf, at: TODAY, verifier });
    expect(unlocks.some((u) => u.type === "rsa")).toBe(false);
  });

  it("still offers the things they genuinely lack", async () => {
    // the guard must not become "say nothing when anything is ambiguous"
    const { person, credentials } = shape();
    const unlocks = unlocksFor({ person, credentials, postings: POSTINGS, siteOf, at: TODAY, verifier });
    for (const u of unlocks) {
      const holdsIt = credentials.some(
        (c) =>
          c.type === u.type &&
          verifier.verify(c, TODAY).status === "valid" &&
          (!u.siteScoped || c.claims.siteId === u.siteId),
      );
      expect(holdsIt, `offered ${u.shortLabel} which they already hold`).toBe(false);
    }
  });
});

describe("a shift needing two missing credentials is claimed by neither", () => {
  /* Pinned deliberately. This is the known limit of a single-credential
     counterfactual, and it is the safe direction to be wrong in — the
     alternative sends somebody to pay for a course that changes nothing.
     If combinations are ever enumerated, this test is what should fail. */
  it("does not offer the induction that would only half-unlock Aaron's shifts", async () => {
    const person = worker("Aaron Patel");
    const credentials = credsOf(person.did);
    const docklands = POSTINGS.find((p) => p.id === "sp-2038-wait")!;
    const site = siteOf(docklands.siteId)!;

    // an induction alone leaves him blocked on allergen management
    const withInduction = claimBlockReason({
      posting: docklands, person, site,
      credentials: [
        ...credentials,
        {
          id: "probe", type: "site_induction", subject: person.did, issuer: "probe",
          issuedAt: TODAY, expiresAt: "2099-12-31", status: "valid", claims: { siteId: site.id },
        },
      ],
      at: TODAY, verifier,
    });
    expect(withInduction).toContain("Allergen");

    // so no unlock may name that posting
    for (const u of run("Aaron Patel")) {
      expect(u.postingIds, `${u.shortLabel} claims a shift it only half-opens`).not.toContain("sp-2038-wait");
    }
  });
});

describe("how it reads", () => {
  it("puts the credential that opens the most shifts first", async () => {
    for (const name of WORKERS.map((w) => w.name)) {
      const counts = run(name).map((u) => u.postingIds.length);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    }
  });

  it("carries the label and issuer, so the row can say who to ask", async () => {
    const person = worker("Michael Tan");
    const lapsed = credsOf(person.did).map((c) =>
      c.type === "rsa" ? { ...c, status: "revoked" as const } : c,
    );
    const [first] = unlocksFor({
      person, credentials: lapsed, postings: POSTINGS, siteOf, at: TODAY, verifier,
    });
    expect(first.shortLabel).toBeTruthy();
    expect(first.authority).toBeTruthy();
    expect(typeof first.siteScoped).toBe("boolean");
  });

  it("never returns an unlock with no shifts behind it", async () => {
    for (const name of WORKERS.map((w) => w.name)) {
      for (const u of run(name)) expect(u.postingIds.length).toBeGreaterThan(0);
    }
  });
});
