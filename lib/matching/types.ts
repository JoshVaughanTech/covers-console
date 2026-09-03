/* ============================================================
   Matching — types
   Every score is accompanied by the reasons that produced it, and
   the reasons must add up to the score. If a manager can't verify
   the number from the chips, "explainable" is decoration.
   ============================================================ */

import type { Decision } from "@/lib/idara";

export type ScoreComponent =
  | "skill"
  | "role"
  | "client"
  | "rating"
  | "fairness"
  | "locality";

/** One scored reason. `points` may be negative. */
export interface ScoreReason {
  component: ScoreComponent;
  points: number;
  detail: string;
}

/**
 * Something a manager should see before assigning, that deliberately
 * carries no points — an expiring credential shouldn't quietly cost
 * someone the shift, but it shouldn't be hidden either.
 */
export interface MatchNote {
  detail: string;
  tone: "warning" | "info";
}

export interface MatchCandidate {
  did: string;
  name: string;
  role: string;
  /** sum of `reasons`, by construction. */
  score: number;
  reasons: ScoreReason[];
  notes: MatchNote[];
  /** the Idara decision that let them through the gate. */
  decision: Decision;
}

/**
 * Someone the gate refused. Kept separate from candidates rather than
 * ranked last: eligibility is a gate, not a score, so an ineligible
 * person has no position in the ranking at all.
 */
export interface MatchExclusion {
  did: string;
  name: string;
  role: string;
  reason: string;
  /** "idara" — a credential fact. "availability" — a business rule. */
  kind: "idara" | "availability" | "assigned";
}

export interface MatchResult {
  candidates: MatchCandidate[];
  excluded: MatchExclusion[];
}

/** The published weighting, shown to managers so the ranking is auditable. */
export const WEIGHTS: Record<ScoreComponent, number> = {
  skill: 32,
  client: 20,
  rating: 15,
  fairness: 15,
  locality: 10,
  role: 8,
};

/** A full week, past which extra hours read as overtime risk. */
export const FULL_WEEK_HOURS = 38;
