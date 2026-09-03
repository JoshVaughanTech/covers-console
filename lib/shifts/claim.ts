/* ============================================================
   Claiming an open shift.

   A claim is a request, never a roster change. It puts someone in
   the manager's queue and does nothing else — the assignment that
   may follow is a separate decision, separately audited.

   The rule worth protecting here is that the gate is structural.
   The staff view already hides the Claim button from anyone Idara
   blocks, but hiding a control is presentation, and presentation is
   not a gate: this function refuses the claim on its own, so a
   rendering bug cannot become a compliance one.
   ============================================================ */

import type { Claim, ShiftPosting } from "./types";

export type ClaimResult =
  | { ok: true; posting: ShiftPosting; claim: Claim }
  | { ok: false; reason: string; kind: "blocked" | "duplicate" | "full" };

/** Has this person already got an open claim on the posting? */
export function hasClaimed(p: ShiftPosting, did: string): boolean {
  return p.claims.some((c) => c.did === did && !c.refused);
}

/**
 * Attempt a claim.
 *
 * `blockReason` is the caller's eligibility answer — null when Idara and the
 * commercial rules both allow it. It is passed in rather than computed here so
 * this stays pure and the engine stays the single place that decides, but it is
 * *checked* here so that no caller can skip it.
 */
export function claimShift(
  p: ShiftPosting,
  did: string,
  at: string,
  blockReason: string | null,
): ClaimResult {
  if (blockReason) return { ok: false, reason: blockReason, kind: "blocked" };
  if (hasClaimed(p, did)) {
    return { ok: false, reason: "You have already claimed this shift", kind: "duplicate" };
  }
  if (p.assigned.includes(did)) {
    return { ok: false, reason: "You are already on this shift", kind: "duplicate" };
  }
  if (p.status === "filled" || p.assigned.length >= p.seats) {
    return { ok: false, reason: "This shift is already filled", kind: "full" };
  }

  const claim: Claim = { did, at };
  return { ok: true, posting: { ...p, claims: [...p.claims, claim] }, claim };
}
