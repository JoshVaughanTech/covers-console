/* ============================================================
   Claiming an open shift.

   The property that matters is the same one the matcher protects,
   from the other side: the staff view hides the Claim button from
   anyone Idara blocks, but claimShift() refuses independently. A
   rendering bug must not be able to become a compliance bug.

   The rest is ordinary request hygiene — no duplicates, no claims
   on a shift that is already full, no claim from someone already
   working it.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { claimShift, hasClaimed } from "../lib/shifts/claim";
import { POSTINGS } from "../lib/shifts/seed";
import type { ShiftPosting } from "../lib/shifts/types";

const AT = "2024-05-16";
const DID = "did:web:idara.app:w:someone";

const posting = (id: string): ShiftPosting => {
  const p = POSTINGS.find((x) => x.id === id);
  if (!p) throw new Error(`no posting ${id}`);
  return structuredClone(p);
};

/** The Werribee bar shift: no claims, no one assigned, 2 seats. */
const empty = () => posting("sp-2041-bar");

describe("the gate", () => {
  it("refuses a claim when the caller reports a block", () => {
    const r = claimShift(empty(), DID, AT, "RSA expired on 2 May 2024");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.kind).toBe("blocked");
    expect(r.reason).toMatch(/RSA/);
  });

  it("refuses before considering anything else", () => {
    // a posting that would also fail the duplicate check: blocked still wins,
    // so the person is told the real reason rather than a procedural one
    const p = empty();
    p.claims = [{ did: DID, at: AT }];
    const r = claimShift(p, DID, AT, "No site induction");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.kind).toBe("blocked");
  });

  it("does not mutate the posting it refuses", () => {
    const p = empty();
    claimShift(p, DID, AT, "blocked");
    expect(p.claims).toHaveLength(0);
  });
});

describe("a successful claim", () => {
  it("adds the claim and leaves everything else alone", () => {
    const p = empty();
    const r = claimShift(p, DID, AT, null);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.claims).toHaveLength(1);
    expect(r.claim).toEqual({ did: DID, at: AT });
    expect(r.posting.assigned).toEqual(p.assigned);
    expect(r.posting.status).toBe(p.status);
  });

  it("is a request, not a roster change — nobody is assigned by claiming", () => {
    const r = claimShift(empty(), DID, AT, null);
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.assigned).not.toContain(DID);
  });

  it("does not mutate the original posting", () => {
    const p = empty();
    claimShift(p, DID, AT, null);
    expect(p.claims).toHaveLength(0);
  });
});

describe("duplicates and capacity", () => {
  it("refuses a second claim from the same person", () => {
    const p = empty();
    const first = claimShift(p, DID, AT, null);
    if (!first.ok) throw new Error("unreachable");
    const second = claimShift(first.posting, DID, AT, null);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.kind).toBe("duplicate");
  });

  it("lets a different person claim the same shift", () => {
    const p = empty();
    const first = claimShift(p, DID, AT, null);
    if (!first.ok) throw new Error("unreachable");
    const second = claimShift(first.posting, "did:web:idara.app:w:other", AT, null);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.posting.claims).toHaveLength(2);
  });

  it("allows a fresh claim after an earlier one was refused by a manager", () => {
    const p = empty();
    p.claims = [{ did: DID, at: "2024-05-15", refused: "Needed elsewhere" }];
    expect(hasClaimed(p, DID)).toBe(false);
    expect(claimShift(p, DID, AT, null).ok).toBe(true);
  });

  it("refuses someone already assigned to the shift", () => {
    const p = empty();
    p.assigned = [DID];
    const r = claimShift(p, DID, AT, null);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.kind).toBe("duplicate");
  });

  it("refuses a shift that is already filled", () => {
    const p = empty();
    p.status = "filled";
    const r = claimShift(p, "did:web:idara.app:w:other", AT, null);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.kind).toBe("full");
  });

  it("refuses when every seat is taken even if the status lags behind", () => {
    const p = empty();
    p.assigned = ["did:a", "did:b"]; // seats === 2
    const r = claimShift(p, DID, AT, null);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.kind).toBe("full");
  });
});

describe("hasClaimed", () => {
  it("is false on a posting with no claims", () => {
    expect(hasClaimed(empty(), DID)).toBe(false);
  });

  it("is true once claimed, and only for that person", () => {
    const r = claimShift(empty(), DID, AT, null);
    if (!r.ok) throw new Error("unreachable");
    expect(hasClaimed(r.posting, DID)).toBe(true);
    expect(hasClaimed(r.posting, "did:web:idara.app:w:other")).toBe(false);
  });
});
