/* ============================================================
   Shifts — open postings and claims
   A posting is a request for N people to work one shift at one
   site. It carries the site id so Idara has something concrete to
   gate against, and the duties so the per-shift eligibility model
   (ShiftAssignment.duties) applies unchanged.
   ============================================================ */

import type { WorkFunction } from "@/lib/idara";
import type { SkillId, SkillLevel } from "@/lib/people";
import type { EmploymentType } from "@/lib/awards";
import type { Level } from "@/lib/awards/rates";

/**
 * What a posting pays, and the facts the award needs to check it.
 *
 * Optional on a posting, because a shift is a real thing before anyone has set
 * a rate on it. Absent means "no rate published yet" and renders as exactly
 * that — never as a number.
 *
 * `startsAt`/`endsAt` are epoch seconds and are NOT the same information as
 * `day`/`window`. Those two are display strings a manager types; these are the
 * moments the award is applied to. A shift priced off a hand-typed string
 * would be priced off a typo.
 *
 * `level` is authored, never inferred from `role`. Which classification a job
 * sits at is a legal position about duties and it is the venue's to record —
 * see suggestedLevel() in lib/awards/rates.ts for why the guess is fenced off.
 */
export interface ShiftPay {
  level: Level;
  employment: EmploymentType;
  /** integer cents per hour, as offered by the venue. */
  offeredHourlyCents: number;
  /** epoch seconds */
  startsAt: number;
  endsAt: number;
  /** unpaid meal break, where the roster plans one. */
  unpaidBreakSec?: number;
  /** ISO dates that are public holidays at this site. Absent = not checked. */
  publicHolidays?: readonly string[];
}

/**
 * What the manager set this posting to. Authored, never derived.
 *
 * "Needs review" is deliberately not here. Whether a posting wants attention
 * depends on the claims against it and on eligibility today, so it is
 * computed by needsReview() in review.ts and never stored — a derived value
 * kept in an authored field is one that can disagree with the thing it was
 * derived from, and then there is no way to tell which is right.
 */
export type PostingStatus = "draft" | "open" | "filled";

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
  /** what it pays. Absent until the venue sets a rate — see ShiftPay. */
  pay?: ShiftPay;
  claims: Claim[];
  /** DIDs already assigned. */
  assigned: string[];
  status: PostingStatus;
}

/** Seats still to fill. */
export function seatsLeft(p: ShiftPosting): number {
  return Math.max(0, p.seats - p.assigned.length);
}

/* Claims awaiting a decision are answered by reviewClaims() in review.ts,
   not here. A filter on `refused` alone cannot see a claim whose holder has
   become ineligible since making it, so it would report as work still to do
   something the gate will refuse. Leaving that function exported alongside
   the real one would be an invitation to pick the wrong answer. */
