/* ============================================================
   Idara Core — the eligibility engine
   decide(person, action, site, time) → allow/deny + reasons.
   This is THE primitive. Roster eligibility, verified clock-in,
   job-room access and verified sign-off are all the same call
   with a different `action`.

   Pure and synchronous: it takes the data it needs and returns a
   Decision. The caller decides whether the decision is worth
   writing to the audit log (previews are not; a publish is).
   ============================================================ */

import { CREDENTIAL_TYPES, functionsForRole } from "./hospitality";
import type { CredentialVerifier } from "./verifier";
import type {
  Action,
  CoverageCheck,
  Credential,
  Decision,
  DecisionReason,
  Identity,
  ISODate,
  Site,
} from "./types";

/** A valid credential within this many days of expiry raises a warning. */
export const EXPIRY_WARN_DAYS = 30;

export interface DecideInput {
  person: Identity;
  /** the person's full credential set (engine selects what's relevant). */
  credentials: Credential[];
  action: Action;
  site: Site;
  at: ISODate;
  verifier: CredentialVerifier;
}

function daysUntil(from: ISODate, to: ISODate): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Math.round((b - a) / 86_400_000);
}

export function decide(input: DecideInput): Decision {
  const { person, credentials, action, site, at, verifier } = input;
  const reasons: DecisionReason[] = [];
  const duties = functionsForRole(person.role);

  for (const req of site.requires) {
    const meta = CREDENTIAL_TYPES[req.type];

    // A requirement scoped to duties this person doesn't perform is recorded
    // as considered-and-not-binding rather than dropped, so the trail shows
    // why it went unchecked.
    if (req.appliesTo && !req.appliesTo.some((f) => duties.includes(f))) {
      reasons.push({
        code: "credential.not_applicable",
        outcome: "n/a",
        credentialType: req.type,
        detail: `${meta.shortLabel} not required for ${person.role}.`,
      });
      continue;
    }

    const match = credentials.find(
      (c) =>
        c.type === req.type &&
        (!req.siteScoped || c.claims.siteId === site.id),
    );

    if (!match) {
      reasons.push({
        code: "credential.missing",
        outcome: "fail",
        credentialType: req.type,
        detail: req.siteScoped
          ? `${meta.shortLabel} for ${site.name} not held.`
          : `${meta.shortLabel} not held.`,
      });
      continue;
    }

    const result = verifier.verify(match, at);
    if (result.status !== "valid") {
      reasons.push({
        code: `credential.${result.status}`,
        outcome: "fail",
        credentialType: req.type,
        detail: `${meta.shortLabel}: ${result.detail}`,
      });
      continue;
    }

    if (match.expiresAt) {
      const left = daysUntil(at, match.expiresAt);
      if (left <= EXPIRY_WARN_DAYS) {
        reasons.push({
          code: "credential.expiring",
          outcome: "warn",
          credentialType: req.type,
          detail: `${meta.shortLabel} expires in ${left} day${left === 1 ? "" : "s"}.`,
        });
        continue;
      }
    }

    reasons.push({
      code: "credential.valid",
      outcome: "pass",
      credentialType: req.type,
      detail: `${meta.shortLabel} verified.`,
    });
  }

  const failed = reasons.filter((r) => r.outcome === "fail");
  const warnings = reasons.filter((r) => r.outcome === "warn").length;

  return {
    allowed: failed.length === 0,
    warnings,
    reasons,
    context: {
      subject: person.did,
      subjectName: person.name,
      action,
      siteId: site.id,
      siteName: site.name,
      at,
    },
  };
}

/* ============================================================
   Roster-level requirements
   Some obligations belong to the shift, not to the person: a venue
   needs a nominated Food Safety Supervisor on, it doesn't need
   every kitchen hand to hold the ticket. decide() can't answer
   that — it only ever sees one person — so decideRoster() layers
   the collective check over the per-person ones.
   ============================================================ */

export interface RosterMember {
  person: Identity;
  credentials: Credential[];
}

export interface DecideRosterInput {
  roster: RosterMember[];
  action: Action;
  site: Site;
  at: ISODate;
  verifier: CredentialVerifier;
}

export interface RosterDecision {
  /** per-person outcomes, in roster order. */
  decisions: Decision[];
  /** one entry per roster-level requirement. */
  coverage: CoverageCheck[];
  /** everyone individually eligible AND every collective requirement met. */
  allowed: boolean;
}

/**
 * Evaluate a whole roster: every person individually, then the requirements
 * the roster must satisfy together.
 *
 * Only eligible people count toward coverage. Someone who can't lawfully be
 * rostered can't be the venue's nominated supervisor either, so counting them
 * would let a roster pass on a person who isn't going to be there.
 */
export function decideRoster(input: DecideRosterInput): RosterDecision {
  const { roster, action, site, at, verifier } = input;

  const decisions = roster.map((m) =>
    decide({
      person: m.person,
      credentials: m.credentials,
      action,
      site,
      at,
      verifier,
    }),
  );

  const eligible = roster.filter((_, i) => decisions[i].allowed);

  const coverage = (site.requiresOnRoster ?? []).map((req): CoverageCheck => {
    const meta = CREDENTIAL_TYPES[req.type];

    const holders = eligible
      .filter((m) =>
        m.credentials.some(
          (c) =>
            c.type === req.type &&
            (!req.siteScoped || c.claims.siteId === site.id) &&
            verifier.verify(c, at).status === "valid",
        ),
      )
      .map((m) => ({ did: m.person.did, name: m.person.name }));

    const met = holders.length >= req.minHolders;
    return {
      type: req.type,
      required: req.minHolders,
      holders,
      met,
      detail: met
        ? `${meta.shortLabel} covered by ${holders.map((h) => h.name).join(", ")}.`
        : `No one rostered holds a current ${meta.shortLabel} — ${req.minHolders} required on shift.`,
    };
  });

  return {
    decisions,
    coverage,
    allowed: decisions.every((d) => d.allowed) && coverage.every((c) => c.met),
  };
}

/** One-line summary of a roster's collective gaps, for the audit log / UI. */
export function summariseCoverage(coverage: CoverageCheck[]): string | null {
  const missing = coverage.filter((c) => !c.met);
  if (missing.length === 0) return null;
  return `Roster lacks ${missing
    .map((c) => CREDENTIAL_TYPES[c.type].shortLabel)
    .join(" and ")} cover`;
}

/** One-line summary of a decision for the audit log / UI. */
export function summarise(d: Decision): string {
  if (d.allowed) {
    return d.warnings > 0
      ? `Eligible with ${d.warnings} warning${d.warnings === 1 ? "" : "s"}`
      : "Eligible";
  }
  const fails = d.reasons.filter((r) => r.outcome === "fail").length;
  return `Blocked — ${fails} requirement${fails === 1 ? "" : "s"} not met`;
}
