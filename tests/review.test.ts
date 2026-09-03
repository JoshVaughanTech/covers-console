/* ============================================================
   Reviewing claims.

   The property this file exists for: a claim is answered against
   today, never against the day it was made. Eligibility is not
   constant across that gap, and a queue that reports otherwise is
   telling a manager to do something the gate will then refuse.

   The gate itself was never wrong here — decideMember() runs
   against today, so a lapsed claimant could never actually be
   assigned. What was wrong was the silence: the claim sat under
   "Claims to Review" with no indication it could not be granted.
   ============================================================ */

import { describe, it, expect } from "vitest";
import {
  reviewClaims,
  actionableClaims,
  needsReview,
  declineClaim,
} from "../lib/shifts/review";
import { POSTINGS } from "../lib/shifts/seed";
import { WORKERS } from "../lib/idara/seed";
import type { ShiftPosting } from "../lib/shifts/types";

const posting = (id: string): ShiftPosting => {
  const p = POSTINGS.find((x) => x.id === id);
  if (!p) throw new Error(`no posting ${id}`);
  return structuredClone(p);
};

const did = (name: string) => {
  const w = WORKERS.find((x) => x.name === name);
  if (!w) throw new Error(`no worker ${name}`);
  return w.did;
};

/** Everyone allowed. */
const openGate = () => null;
/** Nobody allowed. */
const shutGate = () => "RSA: Credential has been revoked.";

describe("answering a claim against today", () => {
  it("leaves a claim open when the person is still eligible", () => {
    const r = reviewClaims(posting("sp-2041-wait"), openGate);
    expect(r.every((c) => c.standing === "open" || c.standing === "assigned")).toBe(true);
  });

  it("marks a claim lapsed when the credentials have moved since", () => {
    const r = reviewClaims(posting("sp-2041-wait"), shutGate);
    const lapsed = r.filter((c) => c.standing === "lapsed");
    expect(lapsed.length).toBeGreaterThan(0);
    expect(lapsed[0].reason).toMatch(/revoked/i);
  });

  it("carries the credential reason rather than a generic refusal", () => {
    const r = reviewClaims(posting("sp-2041-wait"), () => "RSA: Expired 2023-11-01.");
    expect(r.find((c) => c.standing === "lapsed")?.reason).toContain("2023-11-01");
  });

  it("does not consult the date the claim was made", () => {
    // the seeded lapsed claim is older than the others; that is narrative, not
    // logic — staleness is decided by the gate today, never by the timestamp
    const p = posting("sp-2041-wait");
    const older = p.claims.find((c) => c.at === "2024-05-10");
    expect(older).toBeDefined();
    expect(reviewClaims(p, openGate).find((c) => c.at === "2024-05-10")?.standing).toBe("open");
  });
});

describe("standings that do not depend on the gate", () => {
  it("reports a claimant who has since been assigned", () => {
    const p = posting("sp-2041-wait");
    p.assigned = [...p.assigned, did("Mitch Egan")];
    const mitch = reviewClaims(p, openGate).find((c) => c.did === did("Mitch Egan"));
    expect(mitch?.standing).toBe("assigned");
  });

  it("prefers assigned over lapsed — the request is already spent", () => {
    const p = posting("sp-2041-wait");
    p.assigned = [...p.assigned, did("Mitch Egan")];
    const mitch = reviewClaims(p, shutGate).find((c) => c.did === did("Mitch Egan"));
    expect(mitch?.standing).toBe("assigned");
  });

  it("reports a manager's refusal with their reason", () => {
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "Needed at Brightwater");
    const mitch = reviewClaims(p, openGate).find((c) => c.did === did("Mitch Egan"));
    expect(mitch?.standing).toBe("declined");
    expect(mitch?.reason).toBe("Needed at Brightwater");
  });

  it("keeps a manager's refusal distinct from a credential lapse", () => {
    // one is a business decision, the other is a legal position. Collapsing
    // them would tell a manager their own call was a compliance failure
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "Needed elsewhere");
    const r = reviewClaims(p, shutGate);
    expect(r.find((c) => c.did === did("Mitch Egan"))?.standing).toBe("declined");
    expect(r.some((c) => c.standing === "lapsed")).toBe(true);
  });
});

describe("what the manager is asked to do", () => {
  it("counts only claims that can actually be acted on", () => {
    const open = actionableClaims(reviewClaims(posting("sp-2041-wait"), openGate));
    const shut = actionableClaims(reviewClaims(posting("sp-2041-wait"), shutGate));
    expect(open.length).toBeGreaterThan(shut.length);
    expect(shut).toHaveLength(0);
  });

  it("flags a posting for review when a claim has lapsed", () => {
    expect(needsReview(reviewClaims(posting("sp-2041-wait"), shutGate))).toBe(true);
  });

  it("does not flag one where every claim still stands", () => {
    expect(needsReview(reviewClaims(posting("sp-2041-wait"), openGate))).toBe(false);
  });

  it("does not flag a manager's own refusal — that needed no second look", () => {
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "Needed elsewhere");
    expect(needsReview(reviewClaims(p, openGate))).toBe(false);
  });
});

describe("declineClaim", () => {
  it("does not mutate the posting", () => {
    const p = posting("sp-2041-wait");
    declineClaim(p, did("Mitch Egan"), "no");
    expect(p.claims.every((c) => !c.refused)).toBe(true);
  });

  it("leaves other claims alone", () => {
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "no");
    expect(p.claims.filter((c) => c.refused)).toHaveLength(1);
  });

  it("will not overwrite a refusal already recorded", () => {
    const once = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "first");
    const twice = declineClaim(once, did("Mitch Egan"), "second");
    expect(twice.claims.find((c) => c.did === did("Mitch Egan"))?.refused).toBe("first");
  });
});

describe("the seeded demo", () => {
  it("ships one claim that has lapsed, so the case is visible", () => {
    // Michael's RSA was revoked after he claimed — the request was fine when
    // made, which is exactly the situation the review exists to explain
    const p = posting("sp-2041-wait");
    expect(p.claims.some((c) => c.did === did("Michael Tan"))).toBe(true);
  });
});
