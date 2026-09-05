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
  standingFor,
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
  it("leaves a claim open when the person is still eligible", async () => {
    const r = reviewClaims(posting("sp-2041-wait"), openGate);
    expect(r.every((c) => c.standing === "open" || c.standing === "assigned")).toBe(true);
  });

  it("marks a claim lapsed when the credentials have moved since", async () => {
    const r = reviewClaims(posting("sp-2041-wait"), shutGate);
    const lapsed = r.filter((c) => c.standing === "lapsed");
    expect(lapsed.length).toBeGreaterThan(0);
    expect(lapsed[0].reason).toMatch(/revoked/i);
  });

  it("carries the credential reason rather than a generic refusal", async () => {
    const r = reviewClaims(posting("sp-2041-wait"), () => "RSA: Expired 2023-11-01.");
    expect(r.find((c) => c.standing === "lapsed")?.reason).toContain("2023-11-01");
  });

  it("does not consult the date the claim was made", async () => {
    // the seeded lapsed claim is older than the others; that is narrative, not
    // logic — staleness is decided by the gate today, never by the timestamp
    const p = posting("sp-2041-wait");
    const older = p.claims.find((c) => c.at === "2024-05-10");
    expect(older).toBeDefined();
    expect(reviewClaims(p, openGate).find((c) => c.at === "2024-05-10")?.standing).toBe("open");
  });
});

describe("standings that do not depend on the gate", () => {
  it("reports a claimant who has since been assigned", async () => {
    const p = posting("sp-2041-wait");
    p.assigned = [...p.assigned, did("Mitch Egan")];
    const mitch = reviewClaims(p, openGate).find((c) => c.did === did("Mitch Egan"));
    expect(mitch?.standing).toBe("assigned");
  });

  it("prefers assigned over lapsed — the request is already spent", async () => {
    const p = posting("sp-2041-wait");
    p.assigned = [...p.assigned, did("Mitch Egan")];
    const mitch = reviewClaims(p, shutGate).find((c) => c.did === did("Mitch Egan"));
    expect(mitch?.standing).toBe("assigned");
  });

  it("reports a manager's refusal with their reason", async () => {
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "Needed at Brightwater");
    const mitch = reviewClaims(p, openGate).find((c) => c.did === did("Mitch Egan"));
    expect(mitch?.standing).toBe("declined");
    expect(mitch?.reason).toBe("Needed at Brightwater");
  });

  it("keeps a manager's refusal distinct from a credential lapse", async () => {
    // one is a business decision, the other is a legal position. Collapsing
    // them would tell a manager their own call was a compliance failure
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "Needed elsewhere");
    const r = reviewClaims(p, shutGate);
    expect(r.find((c) => c.did === did("Mitch Egan"))?.standing).toBe("declined");
    expect(r.some((c) => c.standing === "lapsed")).toBe(true);
  });
});

describe("what the manager is asked to do", () => {
  it("counts only claims that can actually be acted on", async () => {
    const open = actionableClaims(reviewClaims(posting("sp-2041-wait"), openGate));
    const shut = actionableClaims(reviewClaims(posting("sp-2041-wait"), shutGate));
    expect(open.length).toBeGreaterThan(shut.length);
    expect(shut).toHaveLength(0);
  });

  it("flags a posting for review when a claim has lapsed", async () => {
    expect(needsReview(reviewClaims(posting("sp-2041-wait"), shutGate))).toBe(true);
  });

  it("does not flag one where every claim still stands", async () => {
    expect(needsReview(reviewClaims(posting("sp-2041-wait"), openGate))).toBe(false);
  });

  it("does not flag a manager's own refusal — that needed no second look", async () => {
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "Needed elsewhere");
    expect(needsReview(reviewClaims(p, openGate))).toBe(false);
  });
});

describe("declineClaim", () => {
  it("does not mutate the posting", async () => {
    const p = posting("sp-2041-wait");
    declineClaim(p, did("Mitch Egan"), "no");
    expect(p.claims.every((c) => !c.refused)).toBe(true);
  });

  it("leaves other claims alone", async () => {
    const p = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "no");
    expect(p.claims.filter((c) => c.refused)).toHaveLength(1);
  });

  it("will not overwrite a refusal already recorded", async () => {
    const once = declineClaim(posting("sp-2041-wait"), did("Mitch Egan"), "first");
    const twice = declineClaim(once, did("Mitch Egan"), "second");
    expect(twice.claims.find((c) => c.did === did("Mitch Egan"))?.refused).toBe("first");
  });
});

describe("one row per person, not one per attempt", () => {
  const mitch = () => did("Mitch Egan");

  /** declined, then asked again — two claims on record, one position. */
  const askedAgain = () => {
    const declined = declineClaim(posting("sp-2041-wait"), mitch(), "Needed elsewhere");
    return { ...declined, claims: [...declined.claims, { did: mitch(), at: "2024-05-17" }] };
  };

  it("does not list the same person twice", async () => {
    const rows = reviewClaims(askedAgain(), openGate);
    expect(rows.filter((c) => c.did === mitch())).toHaveLength(1);
  });

  it("reports the later claim, so the queue shows what is unanswered", async () => {
    const row = reviewClaims(askedAgain(), openGate).find((c) => c.did === mitch());
    expect(row?.standing).toBe("open");
    expect(row?.at).toBe("2024-05-17");
  });

  it("counts them once as actionable, not twice", async () => {
    const actionable = actionableClaims(reviewClaims(askedAgain(), openGate));
    expect(actionable.filter((c) => c.did === mitch())).toHaveLength(1);
  });

  it("agrees with what that worker is shown — the two views cannot diverge", async () => {
    // the manager's row and the worker's own standing come from the same call
    const p = askedAgain();
    const managerRow = reviewClaims(p, openGate).find((c) => c.did === mitch());
    const workerRow = standingFor(p, mitch(), null);
    expect(workerRow).toEqual(managerRow);
  });

  it("still reports declined when they have not asked again", async () => {
    const p = declineClaim(posting("sp-2041-wait"), mitch(), "Needed elsewhere");
    expect(reviewClaims(p, openGate).find((c) => c.did === mitch())?.standing).toBe("declined");
  });

  it("leaves other claimants untouched", async () => {
    const rows = reviewClaims(askedAgain(), openGate);
    expect(rows.some((c) => c.did === did("Michael Tan"))).toBe(true);
  });
});

describe("what the worker who claimed sees", () => {
  const mitch = () => did("Mitch Egan");

  it("is nothing when they have not claimed", async () => {
    expect(standingFor(posting("sp-2041-wait"), did("Sophie Nguyen"), null)).toBeNull();
  });

  it("reports their claim as open while it stands", async () => {
    expect(standingFor(posting("sp-2041-wait"), mitch(), null)?.standing).toBe("open");
  });

  it("tells them they were declined, and why", async () => {
    // the whole point: before this, a refusal was visible to the manager and
    // silently invisible to the person who asked
    const p = declineClaim(posting("sp-2041-wait"), mitch(), "Needed at Brightwater");
    const s = standingFor(p, mitch(), null);
    expect(s?.standing).toBe("declined");
    expect(s?.reason).toBe("Needed at Brightwater");
  });

  it("reports lapsed against their own eligibility today", async () => {
    const s = standingFor(posting("sp-2041-wait"), mitch(), "RSA: Expired 2024-05-01.");
    expect(s?.standing).toBe("lapsed");
    expect(s?.reason).toMatch(/2024-05-01/);
  });

  it("shows the fresh claim after they ask again, not the old refusal", async () => {
    // a refusal followed by a new claim means they have moved on from that
    // state; reporting the older one would report a position they have left
    const declined = declineClaim(posting("sp-2041-wait"), mitch(), "Needed elsewhere");
    const asked = { ...declined, claims: [...declined.claims, { did: mitch(), at: "2024-05-17" }] };
    const s = standingFor(asked, mitch(), null);
    expect(s?.standing).toBe("open");
    expect(s?.at).toBe("2024-05-17");
  });

  it("does not leak another person's standing", async () => {
    const p = declineClaim(posting("sp-2041-wait"), mitch(), "Needed elsewhere");
    expect(standingFor(p, did("Michael Tan"), null)?.standing).not.toBe("declined");
  });
});

describe("the seeded demo", () => {
  it("ships one claim that has lapsed, so the case is visible", async () => {
    // Michael's RSA was revoked after he claimed — the request was fine when
    // made, which is exactly the situation the review exists to explain
    const p = posting("sp-2041-wait");
    expect(p.claims.some((c) => c.did === did("Michael Tan"))).toBe(true);
  });
});
