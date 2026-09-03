/* ============================================================
   People — workforce profile data
   Skills, ratings, availability and hours worked. Deliberately
   NOT in lib/idara: a rating is not a credential, and a cocktail
   skill is not a legal position. Idara holds what can be verified
   and audited; this holds what the business knows.

   Keyed by DID so the two layers join without either importing
   the other's vocabulary.
   ============================================================ */

import type { DID } from "@/lib/idara";

/** What a person can do behind a bar or on a floor. */
export type SkillId =
  | "cocktails"
  | "till_pos"
  | "silver_service"
  | "wine_service"
  | "plated_events"
  | "canapes"
  | "bump_in_out";

/**
 * How good they are at it. Ordered — `lead` satisfies a `solid`
 * requirement, `basic` does not.
 */
export type SkillLevel = "basic" | "solid" | "lead";

export interface StaffProfile {
  did: DID;
  /** 0–5, as shown to managers. Only 3.0–5.0 is meaningful in practice. */
  rating: number;
  /** where they normally work; drives the locality component. */
  homeSiteId: string;
  skills: Partial<Record<SkillId, SkillLevel>>;
  /**
   * Clients this person may not be placed with — a commercial or
   * preference fact, deliberately distinct from an Idara eligibility
   * failure. One is a business rule, the other is a legal position.
   */
  excludedClients?: string[];
  /** hours already rostered this week; drives the fairness component. */
  hoursThisWeek: number;
}
