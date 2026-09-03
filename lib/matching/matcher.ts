/* ============================================================
   Matching — rank who should work a shift

   The load-bearing rule: Idara eligibility is a GATE, not a score.
   An ineligible person is excluded from the ranking entirely, never
   ranked low. That is what lets the scoring model stay simple
   without becoming dangerous — a 4.9 rating can never outweigh a
   lapsed RSA, because the two are never on the same axis.

   Pure and synchronous, like decide(). It takes the data it needs
   and returns a ranking; the caller decides what to do with it.
   ============================================================ */

import {
  decideMember,
  functionsForRole,
  type Credential,
  type CredentialVerifier,
  type Identity,
  type ISODate,
  type Site,
} from "@/lib/idara";
import { SKILLS, meetsLevel, belowLevel, type StaffProfile } from "@/lib/people";
import type { ShiftPosting } from "@/lib/shifts";
import {
  FULL_WEEK_HOURS,
  WEIGHTS,
  type MatchCandidate,
  type MatchExclusion,
  type MatchResult,
  type MatchNote,
  type ScoreReason,
} from "./types";

export interface MatchInput {
  posting: ShiftPosting;
  site: Site;
  people: { person: Identity; credentials: Credential[]; profile?: StaffProfile }[];
  at: ISODate;
  verifier: CredentialVerifier;
}

/** Skill fit: the requirements are shared evenly across the budget. */
function scoreSkills(posting: ShiftPosting, profile: StaffProfile): ScoreReason[] {
  if (posting.requires.length === 0) return [];
  const share = WEIGHTS.skill / posting.requires.length;

  return posting.requires.map(({ skill, level }): ScoreReason => {
    const held = profile.skills[skill];
    const label = SKILLS[skill].label;

    if (meetsLevel(held, level)) {
      return { component: "skill", points: Math.round(share), detail: `Can run ${label}` };
    }
    if (belowLevel(held, level)) {
      // held, just not to the level asked for — partial, not zero
      return {
        component: "skill",
        points: Math.round(share / 2),
        detail: `${label} below the level wanted`,
      };
    }
    return { component: "skill", points: -Math.round(share / 2), detail: `Missing ${label}` };
  });
}

/** Rating, scaled across the range that actually occurs (3.0–5.0). */
function scoreRating(profile: StaffProfile): ScoreReason {
  const t = Math.min(1, Math.max(0, (profile.rating - 3) / 2));
  return {
    component: "rating",
    points: Math.round(t * WEIGHTS.rating),
    detail: `Rated ${profile.rating.toFixed(1)}`,
  };
}

/** Fairness: spare capacity scores; a full week already worked does not. */
function scoreFairness(profile: StaffProfile): ScoreReason {
  const h = profile.hoursThisWeek;
  if (h <= FULL_WEEK_HOURS) {
    return {
      component: "fairness",
      points: Math.round(WEIGHTS.fairness * (1 - h / FULL_WEEK_HOURS)),
      detail: `${h}h this week — room for more`,
    };
  }
  return {
    component: "fairness",
    points: -Math.round((h - FULL_WEEK_HOURS) * 1.5),
    detail: `${h}h already this week — overtime risk`,
  };
}

/** Locality: their own venue beats their own region beats neither. */
function scoreLocality(profile: StaffProfile, site: Site): ScoreReason | null {
  if (profile.homeSiteId === site.id) {
    return { component: "locality", points: WEIGHTS.locality, detail: "Home venue" };
  }
  return null;
}

/** Role: an exact match, or duties that overlap with the role wanted. */
function scoreRole(person: Identity, posting: ShiftPosting): ScoreReason {
  if (person.role === posting.role) {
    return { component: "role", points: WEIGHTS.role, detail: `Works as ${posting.role}` };
  }
  const theirs = functionsForRole(person.role);
  const wanted = functionsForRole(posting.role);
  if (theirs.some((f) => wanted.includes(f))) {
    return {
      component: "role",
      points: Math.round(WEIGHTS.role / 2),
      detail: `${person.role} — related duties`,
    };
  }
  return { component: "role", points: 0, detail: `${person.role} — unrelated duties` };
}

export function rankForShift(input: MatchInput): MatchResult {
  const { posting, site, people, at, verifier } = input;
  const candidates: MatchCandidate[] = [];
  const excluded: MatchExclusion[] = [];

  for (const { person, credentials, profile } of people) {
    const base = { did: person.did, name: person.name, role: person.role };

    if (posting.assigned.includes(person.did)) {
      excluded.push({ ...base, reason: "Already assigned to this shift", kind: "assigned" });
      continue;
    }

    // Gate first. Nothing below this line can rescue an ineligible person.
    const decision = decideMember({
      person,
      credentials,
      action: "be_rostered",
      site,
      at,
      verifier,
      shifts: [{ id: posting.shiftId, duties: posting.duties }],
    });

    if (!decision.allowed) {
      const fail = decision.reasons.find((r) => r.outcome === "fail");
      excluded.push({ ...base, reason: fail?.detail ?? "Not eligible", kind: "idara" });
      continue;
    }

    if (!profile) {
      excluded.push({ ...base, reason: "No staff profile on record", kind: "availability" });
      continue;
    }

    // A business rule, not an eligibility failure — kept visibly distinct.
    if (posting.client && profile.excludedClients?.includes(posting.client)) {
      excluded.push({ ...base, reason: "Not available for this client", kind: "availability" });
      continue;
    }

    const reasons: ScoreReason[] = [
      ...scoreSkills(posting, profile),
      scoreRole(person, posting),
      scoreRating(profile),
      scoreFairness(profile),
    ];
    const locality = scoreLocality(profile, site);
    if (locality) reasons.push(locality);
    if (posting.client) {
      reasons.push({
        component: "client",
        points: WEIGHTS.client,
        detail: `Cleared for ${posting.client}`,
      });
    }

    // Idara warnings are shown but never scored: an expiring credential
    // should reach the manager's eye without silently costing the shift.
    const notes: MatchNote[] = decision.reasons
      .filter((r) => r.outcome === "warn")
      .map((r) => ({ detail: r.detail, tone: "warning" as const }));

    candidates.push({
      ...base,
      score: reasons.reduce((sum, r) => sum + r.points, 0),
      reasons,
      notes,
      decision,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { candidates, excluded };
}
