/* ============================================================
   Reviewing claims.

   A claim is made at one moment and answered at another, and
   eligibility is not constant across that gap. Someone puts their
   hand up on Monday with a valid RSA; by Friday it has expired.

   The gate already handles this correctly at the point of
   assignment — decideMember() runs against today, so the manager
   simply cannot assign them. What was missing is that the queue
   said nothing: the claim sat under "Claims to Review" looking
   like work to do, and the reason only appeared once the manager
   had gone looking for that person in the matcher.

   So a claim is re-checked when it is reviewed, never trusted from
   when it was made. A claim that no longer holds is shown as
   refused with the credential reason, which is why the design
   files this as an eligibility decision rather than a new kind of
   event: nothing about the request changed, the facts did.
   ============================================================ */

import type { Claim, ShiftPosting } from "./types";

export type ClaimStanding =
  /** eligible today; the manager can act on it. */
  | "open"
  /** was refused by a manager, with their reason. */
  | "declined"
  /** no longer eligible — the credentials moved, not the request. */
  | "lapsed"
  /** already assigned to this shift; the request is spent. */
  | "assigned";

export interface ReviewedClaim {
  did: string;
  at: string;
  standing: ClaimStanding;
  /** why, for every standing except "open". */
  reason?: string;
}

/**
 * Answer each claim against today rather than against when it was made.
 *
 * `gate` is the caller's eligibility answer for a person — null when they are
 * allowed. It is injected rather than computed here so this stays pure and the
 * engine remains the only thing that decides.
 */
export function reviewClaims(
  p: ShiftPosting,
  gate: (did: string) => string | null,
): ReviewedClaim[] {
  return p.claims.map((c): ReviewedClaim => {
    if (p.assigned.includes(c.did)) {
      return { did: c.did, at: c.at, standing: "assigned", reason: "Already on this shift" };
    }
    if (c.refused) {
      return { did: c.did, at: c.at, standing: "declined", reason: c.refused };
    }
    const blocked = gate(c.did);
    if (blocked) return { did: c.did, at: c.at, standing: "lapsed", reason: blocked };
    return { did: c.did, at: c.at, standing: "open" };
  });
}

/** Claims still genuinely awaiting a decision. */
export function actionableClaims(reviewed: ReviewedClaim[]): ReviewedClaim[] {
  return reviewed.filter((c) => c.standing === "open");
}

/**
 * Does this posting need a person to look at it?
 *
 * A lapsed claim is the case worth surfacing: nobody did anything wrong, the
 * queue simply contains a request that can no longer be granted, and it will
 * sit there unexplained until someone opens the matcher.
 */
export function needsReview(reviewed: ReviewedClaim[]): boolean {
  return reviewed.some((c) => c.standing === "lapsed");
}

/** Record a manager's refusal on the claim itself. */
export function declineClaim(p: ShiftPosting, did: string, reason: string): ShiftPosting {
  return {
    ...p,
    claims: p.claims.map((c): Claim => (c.did === did && !c.refused ? { ...c, refused: reason } : c)),
  };
}
