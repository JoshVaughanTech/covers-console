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

export type WithdrawResult =
  | { ok: true; posting: ShiftPosting }
  | { ok: false; reason: string; kind: "none" | "rostered" };

/**
 * Take your hand back down.
 *
 * A claim you cannot retract is a claim you think twice about making, and a
 * board where people hesitate to put their hand up is the failure mode this
 * marketplace exists to avoid. So withdrawing is always allowed while the
 * request is still a request.
 *
 * It REMOVES the claim rather than marking it, which is the opposite of
 * declineClaim(). The difference is whose record it is: a refusal is a
 * decision the manager made and has to answer for, so it stays on the posting
 * where the queue can show it. A withdrawal is the worker taking back a
 * request nobody acted on, and leaving it visible would put them in a queue
 * they have left. What happened is not lost — `shift.withdrawn` is on the
 * chain, which is where this system keeps what happened.
 *
 * Being rostered is the one refusal. Once a manager has assigned the shift,
 * dropping it is a cancellation with a venue short-staffed at the other end,
 * and that is a conversation rather than a button.
 */
export function withdrawClaim(p: ShiftPosting, did: string): WithdrawResult {
  if (p.assigned.includes(did)) {
    return {
      ok: false,
      kind: "rostered",
      reason: "You're already rostered on this shift — talk to the venue if you can't make it.",
    };
  }
  if (!hasClaimed(p, did)) {
    return { ok: false, kind: "none", reason: "You don't have a claim on this shift" };
  }
  // only the open claim goes; a refused one is the manager's record and stays
  return { ok: true, posting: { ...p, claims: p.claims.filter((c) => !(c.did === did && !c.refused)) } };
}
