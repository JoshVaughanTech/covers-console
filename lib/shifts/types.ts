/* ============================================================
   Shifts — open postings and claims
   A posting is a request for N people to work one shift at one
   site. It carries the site id so Idara has something concrete to
   gate against, and the duties so the per-shift eligibility model
   (ShiftAssignment.duties) applies unchanged.
   ============================================================ */

import type { WorkFunction } from "@/lib/idara";
import type { SkillId, SkillLevel } from "@/lib/people";

export type PostingStatus = "draft" | "open" | "needs_review" | "filled";

/** A skill the posting asks for, and the level it asks for it at. */
export interface SkillRequirement {
  skill: SkillId;
  level: SkillLevel;
}

/** Someone has put their hand up. A request, never an auto-assignment. */
export interface Claim {
  did: string;
  at: string;
  /** set when the claim was refused, with the reason shown to the manager. */
  refused?: string;
}

export interface ShiftPosting {
  id: string;
  /** the role being filled, e.g. "Bartender". */
  role: string;
  /** how many people are wanted. */
  seats: number;
  /** the function this shift belongs to, e.g. "Brightwater Friday Live". */
  functionName: string;
  /** function reference where there is one — in-house shifts have none. */
  functionRef?: string;
  /** the paying client. Absent for in-house work, which is why the
      client-preference component simply doesn't apply there. */
  client?: string;
  siteId: string;
  /** display date and window, e.g. "Fri, 17 May" / "17:00–01:00". */
  day: string;
  window: string;
  /** shift id used when reporting a per-shift eligibility reason. */
  shiftId: string;
  /** what this shift actually involves — fed straight to decideMember(). */
  duties: WorkFunction[];
  requires: SkillRequirement[];
  claims: Claim[];
  /** DIDs already assigned. */
  assigned: string[];
  status: PostingStatus;
}

/** Seats still to fill. */
export function seatsLeft(p: ShiftPosting): number {
  return Math.max(0, p.seats - p.assigned.length);
}

/** Claims still awaiting a manager decision. */
export function openClaims(p: ShiftPosting): Claim[] {
  return p.claims.filter((c) => !c.refused && !p.assigned.includes(c.did));
}
