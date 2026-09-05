/* ============================================================
   Taking your hand back down.

   Two things have to hold. The claim must leave the posting, so
   nobody is held in a queue they have left. And the withdrawal must
   survive a reload — the board is rebuilt by folding the chain over
   the seed, so an event the fold ignores is an event that undoes
   itself the next time anybody looks.

   That second one is the failure replay.ts was written for, and it
   arrives here through the only event that removes rather than adds.
   ============================================================ */
import { describe, it, expect } from "vitest";
import { claimShift, withdrawClaim, hasClaimed, declineClaim, replayPostings, isShiftEvent } from "../lib/shifts";
import type { ShiftPosting } from "../lib/shifts";
import type { AuditEvent } from "../lib/idara";

const DID = "did:web:idara.app:w:darie-roberts";
const OTHER = "did:web:idara.app:w:aaron-patel";

const posting = (over: Partial<ShiftPosting> = {}): ShiftPosting => ({
  id: "sp-t", role: "Bartender", seats: 2, functionName: "Friday Live",
  siteId: "s-brightwater", day: "Fri, 17 May", window: "17:00–01:00", shiftId: "Fri",
  duties: ["serve_alcohol"], requires: [], claims: [], assigned: [], status: "open",
  ...over,
});

const event = (over: Partial<AuditEvent> & Pick<AuditEvent, "type">): AuditEvent =>
  ({
    seq: 0, at: "2024-05-16T10:00:00.000Z", actor: "Darie Roberts", actorDid: DID,
    subject: DID, summary: "", hash: "h", prevHash: null, org: "org-brightwater",
    data: { postingId: "sp-t" },
    ...over,
  }) as AuditEvent;

describe("withdrawing a claim", () => {
  it("removes it from the posting", async () => {
    const claimed = claimShift(posting(), DID, "2024-05-16", null);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    expect(hasClaimed(claimed.posting, DID)).toBe(true);
    const r = withdrawClaim(claimed.posting, DID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hasClaimed(r.posting, DID)).toBe(false);
    expect(r.posting.claims).toHaveLength(0);
  });

  it("leaves everybody else's claims alone", async () => {
    const p = posting({ claims: [{ did: OTHER, at: "2024-05-15" }, { did: DID, at: "2024-05-16" }] });
    const r = withdrawClaim(p, DID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posting.claims.map((c) => c.did)).toEqual([OTHER]);
  });

  it("keeps a manager's refusal, which is their record and not the worker's", async () => {
    /* declineClaim() marks; this removes. The difference is whose record it
       is — a refusal is a decision somebody has to answer for. */
    const p = declineClaim(posting({ claims: [{ did: DID, at: "2024-05-16" }] }), DID, "Not needed");
    const r = withdrawClaim(p, DID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("none");
  });

  it("refuses when there is nothing to withdraw", async () => {
    const r = withdrawClaim(posting(), DID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("none");
  });

  it("refuses once they are rostered", async () => {
    // dropping an assigned shift leaves a venue short — a conversation, not a
    // button, and the refusal says so rather than failing silently
    const p = posting({ assigned: [DID], claims: [{ did: DID, at: "2024-05-16" }] });
    const r = withdrawClaim(p, DID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("rostered");
    expect(r.reason).toMatch(/talk to the venue/i);
  });

  it("lets them claim again afterwards", async () => {
    // the whole point: a claim you cannot take back is one you hesitate to make
    const claimed = claimShift(posting(), DID, "2024-05-16", null);
    if (!claimed.ok) throw new Error("setup");
    const w = withdrawClaim(claimed.posting, DID);
    if (!w.ok) throw new Error("setup");
    const again = claimShift(w.posting, DID, "2024-05-17", null);
    expect(again.ok).toBe(true);
  });
});

describe("a withdrawal survives a reload", () => {
  it("is recognised as a shift event at all", async () => {
    // if the filter drops it, the fold never sees it and the claim comes back
    expect(isShiftEvent(event({ type: "shift.withdrawn" }))).toBe(true);
  });

  it("folds back over the claim above it", async () => {
    const log = [
      event({ type: "shift.claimed", seq: 0 }),
      event({ type: "shift.withdrawn", seq: 1 }),
    ];
    const [p] = replayPostings([posting()], log);
    expect(p.claims).toHaveLength(0);
  });

  it("does not resurrect the claim when replayed twice", async () => {
    const log = [
      event({ type: "shift.claimed", seq: 0 }),
      event({ type: "shift.withdrawn", seq: 1 }),
    ];
    const once = replayPostings([posting()], log);
    const twice = replayPostings(once, log);
    expect(twice[0].claims).toHaveLength(0);
  });

  it("keeps a claim made after the withdrawal", async () => {
    // claim, withdraw, change your mind — the order is the whole answer
    const log = [
      event({ type: "shift.claimed", seq: 0, at: "2024-05-16T10:00:00.000Z" }),
      event({ type: "shift.withdrawn", seq: 1, at: "2024-05-16T11:00:00.000Z" }),
      event({ type: "shift.claimed", seq: 2, at: "2024-05-16T12:00:00.000Z" }),
    ];
    const [p] = replayPostings([posting()], log);
    expect(p.claims.map((c) => c.did)).toEqual([DID]);
    expect(p.claims[0].at).toBe("2024-05-16T12:00:00.000Z");
  });

  it("withdraws only the person who withdrew", async () => {
    const log = [
      event({ type: "shift.claimed", seq: 0, subject: OTHER, actorDid: OTHER }),
      event({ type: "shift.claimed", seq: 1 }),
      event({ type: "shift.withdrawn", seq: 2 }),
    ];
    const [p] = replayPostings([posting()], log);
    expect(p.claims.map((c) => c.did)).toEqual([OTHER]);
  });

  it("leaves an assignment alone", async () => {
    /* Somebody assigned and then withdrawing is refused by withdrawClaim(),
       but the fold must not quietly undo an assignment if such an event ever
       reaches it — the roster is the thing a venue staffs from. */
    const log = [
      event({ type: "shift.claimed", seq: 0 }),
      event({ type: "shift.assigned", seq: 1 }),
      event({ type: "shift.withdrawn", seq: 2 }),
    ];
    const [p] = replayPostings([posting()], log);
    expect(p.assigned).toEqual([DID]);
  });
});
