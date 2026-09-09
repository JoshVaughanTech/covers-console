/* ============================================================
   Idara — the venue's side of the same agreement.

   A worker holds a pack. A venue holds this. An engagement is what
   happens when the two are put together, and the reason the venue
   types nothing at booking time is that everything it would have
   typed is already here: its ABN, the payroll the employee will be
   created in, the workers' compensation policy that covers them,
   which award level each role sits at, and the signature on its
   half of the casual agreement.

   The profile is a fact about a legal employer, not a settings
   page. So the two things that decide whether it may employ anybody
   are computed from it — profileGaps() — rather than stored as a
   flag somebody ticked. An expired workers' comp policy is a real
   state, and a profile that still said "ready" because nothing had
   re-run would be putting an uninsured worker on a floor.

   `acceptsPacks` is the one authored switch, and it is authored
   precisely because it is a commercial decision rather than a
   derived fact: a venue can be perfectly able to employ through
   Covers and choose not to.
   ============================================================ */

import { canonicalJson, sha256Hex } from "./hash";
import { calendarDate, isBeforeDay } from "./dates";
import type { DID, ISODate } from "./types";
import type { Level } from "@/lib/awards/rates";
import type { PayrollConnectorId } from "@/lib/payroll/types";

/**
 * How this employer's pay floor is decided.
 *
 * "eba" is here as a value the profile can hold and the pricing layer
 * deliberately cannot honour yet — an enterprise agreement displaces the
 * award entirely, and lib/awards prices one award. A venue on an EBA is
 * refused at proposal rather than priced against a floor that does not apply
 * to it, which is the difference between "not supported" and "quietly wrong".
 */
export type AwardMode = "higa" | "restaurant" | "eba";

export interface EmployerClassification {
  level: Level;
  /** the award's own stream name, e.g. "food_and_beverage", "kitchen". */
  stream: string;
}

export interface PayrollConnection {
  connector: PayrollConnectorId;
  /** the tenant/company id inside that payroll — opaque to us. */
  tenantRef: string;
  connectedAt: ISODate;
}

export interface EmployerProfile {
  /** did:web:idara.app:o:<slug> */
  did: DID;
  abn: string;
  legalName: string;
  /** trading name, for the screens a worker sees. */
  tradingName: string;
  /** the sites this employer operates, joined to lib/idara SITES. */
  siteIds: string[];
  payroll?: PayrollConnection;
  timeClock?: { connector: "connecteam"; timeClockId: string };
  workersComp: { insurer: string; policyRef: string; expiresAt: ISODate };
  awardMode: AwardMode;
  /** role → award classification. The venue's legal position, authored. */
  classifications: Record<string, EmployerClassification>;
  agreementTemplateVersion: string;
  /** who pre-signed the employer half. Named, because a signature needs one. */
  signatoryDid: DID;
  signatoryName: string;
  acceptsPacks: boolean;
}

/* ---------- readiness ---------- */

export type EmployerGapCode =
  | "payroll.not_connected"
  | "workers_comp.expired"
  | "award.unsupported"
  | "packs.not_accepted";

export interface EmployerGap {
  code: EmployerGapCode;
  detail: string;
  /** true when a venue can fix it themselves on /settings/employer. */
  actionable: boolean;
}

/**
 * Everything standing between this profile and employing somebody.
 *
 * Returned as a list rather than a boolean because the console has to say
 * which — "not ready" on a settings screen is a dead end, and the whole
 * argument of this product is that a refusal names its cause.
 */
export function profileGaps(profile: EmployerProfile, at: ISODate): EmployerGap[] {
  const gaps: EmployerGap[] = [];

  if (!profile.payroll) {
    gaps.push({
      code: "payroll.not_connected",
      detail: "No payroll connected. An engagement cannot create the employee it needs.",
      actionable: true,
    });
  }

  if (isBeforeDay(profile.workersComp.expiresAt, calendarDate(at))) {
    gaps.push({
      code: "workers_comp.expired",
      detail: `Workers' compensation policy ${profile.workersComp.policyRef} expired ${profile.workersComp.expiresAt}.`,
      actionable: true,
    });
  }

  if (profile.awardMode === "eba") {
    gaps.push({
      code: "award.unsupported",
      // stated plainly: the rate floor this app enforces is the award's, and
      // an enterprise agreement replaces it. Pricing an EBA shift against
      // MA000009 would produce a number with no legal meaning
      detail:
        "This venue is on an enterprise agreement. Covers prices against the award and cannot check an EBA floor.",
      actionable: false,
    });
  }

  if (!profile.acceptsPacks) {
    gaps.push({
      code: "packs.not_accepted",
      detail: "This venue has not turned on one-tap employment.",
      actionable: true,
    });
  }

  return gaps;
}

/** True when this employer can be the employer on an engagement today. */
export function canEmploy(profile: EmployerProfile, at: ISODate): boolean {
  return profileGaps(profile, at).length === 0;
}

/**
 * The classification a role sits at here, or undefined.
 *
 * Undefined is an answer, not a hole to fill with a guess. Which level a job
 * sits at decides what somebody is paid, and suggestedLevel() in
 * lib/awards/rates.ts is fenced off from writing one for exactly this reason:
 * a venue records its classifications, and an unrecorded role is a question
 * for the venue rather than a default of Level 1.
 */
export function classificationFor(
  profile: EmployerProfile,
  role: string,
): EmployerClassification | undefined {
  return profile.classifications[role] ?? profile.classifications[role.trim().toLowerCase()];
}

/* ---------- hashing ---------- */

/**
 * The digest an engagement pins the employer to.
 *
 * Over the whole profile, deliberately including the payroll connection and
 * the classifications: "which payroll did my TFN go to" and "what level was I
 * employed at" are exactly the questions a dispute turns on, and a hash that
 * skipped the volatile fields would verify happily while the answers changed
 * underneath it.
 */
export function employerProfileHash(profile: EmployerProfile): string {
  return sha256Hex(canonicalJson(profile));
}
