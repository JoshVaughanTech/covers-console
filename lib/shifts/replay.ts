/* ============================================================
   Rebuilding postings from the trail.

   The problem this solves: the audit chain is durable and the
   marketplace was not. After a reload /audit still said "Darie
   Roberts claimed Wait Staff on Werribee Park Wedding", with the
   chain verifying, while the queue showed no such claim and the
   shift someone had been assigned to was open again. For a product
   whose central claim is a tamper-evident record of who was cleared
   to work, "the chain says it happened, the app says it didn't" is
   the worst inconsistency available.

   The fix is not a second durable store beside the chain — two
   stores of the same fact can drift, which is the bug rather than
   the cure. It is to make the chain the source of truth: current
   state is the seed with every consequential event folded over it.
   Then the log and the screen cannot disagree, because they are the
   same data read twice.

   This also honours what the event store already says of itself —
   "Covers stores what happened, not what is". A posting is not an
   exception to that; it just needed its creation recorded, which is
   why "shift.posted" exists.
   ============================================================ */

import type { AuditEvent } from "@/lib/idara";
import { declineClaim } from "./review";
import type { ShiftPosting } from "./types";

/** An event carrying a posting id, which is what makes it ours to replay. */
interface ShiftEventData {
  postingId?: unknown;
  outcome?: unknown;
  posting?: unknown;
  reason?: unknown;
}

const postingIdOf = (e: AuditEvent): string | null => {
  const id = (e.data as ShiftEventData)?.postingId;
  return typeof id === "string" ? id : null;
};

/** Does this event belong to Open Shifts at all? */
export function isShiftEvent(e: AuditEvent): boolean {
  if (e.type === "shift.posted" || e.type === "shift.claimed" || e.type === "shift.assigned") {
    return true;
  }
  // a declined claim writes as a plain decision, so it is identified by
  // carrying a posting id and a declined outcome rather than by its type
  return (
    e.type === "decision" &&
    postingIdOf(e) !== null &&
    (e.data as ShiftEventData)?.outcome === "declined"
  );
}

function applyOne(postings: ShiftPosting[], e: AuditEvent): ShiftPosting[] {
  if (e.type === "shift.posted") {
    const p = (e.data as ShiftEventData).posting as ShiftPosting | undefined;
    // an unreadable posting is skipped rather than crashing the whole replay:
    // one bad event should cost that posting, not the entire board
    if (!p || typeof p.id !== "string") return postings;
    return postings.some((x) => x.id === p.id) ? postings : [p, ...postings];
  }

  const id = postingIdOf(e);
  const did = e.subject;
  if (!id || !did) return postings;

  return postings.map((p) => {
    if (p.id !== id) return p;

    if (e.type === "shift.claimed") {
      // a replayed claim is not a new request; if it is already recorded,
      // replaying must not duplicate it
      if (p.claims.some((c) => c.did === did && c.at === e.at && !c.refused)) return p;
      return { ...p, claims: [...p.claims, { did, at: e.at }] };
    }

    if (e.type === "shift.assigned") {
      if (p.assigned.includes(did)) return p;
      const assigned = [...p.assigned, did];
      return {
        ...p,
        assigned,
        status: assigned.length >= p.seats ? "filled" : p.status,
      };
    }

    // decision · declined
    const reason = (e.data as ShiftEventData).reason;
    return declineClaim(p, did, typeof reason === "string" ? reason : "Not needed for this shift");
  });
}

/**
 * The board as the trail says it stands.
 *
 * `base` is the seed — the postings that exist before anything happened.
 * Events are applied in order, so the result is a function of the chain and
 * nothing else. Replaying the same log twice gives the same board, which is
 * what lets a reload be lossless rather than a reset.
 */
export function replayPostings(base: ShiftPosting[], log: AuditEvent[]): ShiftPosting[] {
  return log
    .filter(isShiftEvent)
    .reduce<ShiftPosting[]>((postings, e) => applyOne(postings, e), base);
}
