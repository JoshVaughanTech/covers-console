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
import type { EmploymentType } from "@/lib/awards";
import type { Level } from "@/lib/awards/rates";

/**
 * How this person is classified under the award.
 *
 * Authored per person, not derived from their role — the same rule ShiftPay
 * follows, and for the same reason: which level a job sits at depends on what
 * the person actually does, and getting it wrong underpays them. It lives on
 * the profile rather than in Idara because a classification is what the
 * business records, not something an issuer verified.
 *
 * A posting carries its own level, and it may differ: someone classified at
 * Level 2 who works a supervisor shift is paid for the shift they worked.
 */
export interface AwardClassification {
  level: Level;
  employment: EmploymentType;
}

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
  /** what the award pays them at. See AwardClassification. */
  award: AwardClassification;
}
