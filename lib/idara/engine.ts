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

import { CREDENTIAL_TYPES } from "./construction";
import type { CredentialVerifier } from "./verifier";
import type {
  Action,
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

  for (const req of site.requires) {
    const meta = CREDENTIAL_TYPES[req.type];
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
