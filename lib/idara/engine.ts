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
import { calendarDate } from "./dates";
import type { CredentialVerifier } from "./verifier";
import type {
  Action,
  CheckOutcome,
  CoverageCheck,
  Credential,
  Decision,
  DecisionReason,
  Identity,
  ISODate,
  Site,
  WorkFunction,
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
  /**
   * What this person is rostered to actually do on this shift.
   *
   * A job title is only a guess at someone's duties: put a bartender on the
   * gaming floor for a night and they perform gaming duties regardless of what
   * their title says. Where the roster knows the assignment, it is the
   * authority; omit this and the engine falls back to the title.
   *
   * An explicitly empty array is a real statement — "rostered, performs none of
   * the gated duties" — and is honoured. The fail-safe for *unknown* titles
   * lives in functionsForRole().
   */
  duties?: WorkFunction[];
}

/**
 * Whole days between two dates.
 *
 * Both ends are narrowed to their calendar day first, because `at` may arrive
 * as a full timestamp. Parsing "2024-05-16T22:10:00Z" against a bare date
 * leaves most of a day on one side of the subtraction, which rounds the answer
 * down: an expiry 18 days out reports as 17, and at the warning threshold it
 * decides whether the manager is told anything at all.
 */
function daysUntil(from: ISODate, to: ISODate): number {
  const a = Date.parse(calendarDate(from));
  const b = Date.parse(calendarDate(to));
  return Math.round((b - a) / 86_400_000);
}

export function decide(input: DecideInput): Decision {
  const { person, credentials, action, site, at, verifier } = input;
  const reasons: DecisionReason[] = [];
  // the assignment is the authority; the job title is only the fallback
  const duties = input.duties ?? functionsForRole(person.role);

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
        // name the actual basis: the shift's assignment, or the job title
        detail: input.duties
          ? `${meta.shortLabel} not required for this assignment.`
          : `${meta.shortLabel} not required for ${person.role}.`,
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

/** One shift on the roster: when it is, and what it is. */
export interface ShiftAssignment {
  /** short label used when reporting — "Sat", "Sat 4p – 12a". */
  id: string;
  /** duties for this shift; omitted falls back to the person's job title. */
  duties?: WorkFunction[];
}

export interface RosterMember {
  person: Identity;
  credentials: Credential[];
  /**
   * The shifts this person is rostered for. Omitted or empty means a single
   * notional shift carrying whatever their job title implies, which is the
   * behaviour for callers that don't model shifts.
   */
  shifts?: ShiftAssignment[];
}

/** fail beats warn beats pass beats not-applicable, when merging shifts. */
const SEVERITY: Record<CheckOutcome, number> = {
  "n/a": 0,
  pass: 1,
  warn: 2,
  fail: 3,
};

export interface DecideMemberInput extends Omit<DecideInput, "duties"> {
  shifts?: ShiftAssignment[];
}

/**
 * One person's eligibility across everything they are rostered for.
 *
 * Duties belong to a shift, not to a week: someone can be fine behind the bar
 * Monday to Thursday and ineligible for Saturday's gaming shift. Evaluating the
 * week as one lump would either over-demand (union every duty) or miss it.
 *
 * Shifts are grouped by duty set before evaluation — five identical bar shifts
 * are one question, not five — and the merged result keeps the worst outcome per
 * requirement, naming the shifts it came from when they aren't all of them.
 */
export function decideMember(input: DecideMemberInput): Decision {
  const { shifts, ...base } = input;
  const list = shifts && shifts.length > 0 ? shifts : [{ id: "" }];

  const groups = new Map<string, { duties?: WorkFunction[]; ids: string[] }>();
  for (const s of list) {
    // a shift with no duties of its own is a different question from one with
    // an explicit set, so the two never share a key
    const key = s.duties ? `d:${[...s.duties].sort().join("|")}` : "title";
    const found = groups.get(key);
    if (found) found.ids.push(s.id);
    else groups.set(key, { duties: s.duties, ids: [s.id] });
  }

  const evaluated = [...groups.values()].map((g) => ({
    ids: g.ids,
    decision: decide({ ...base, duties: g.duties }),
  }));

  // one duty set across the whole week: nothing to merge
  if (evaluated.length === 1) return evaluated[0].decision;

  const order = new Map(list.map((s, i) => [s.id, i]));
  const reasons: DecisionReason[] = [];

  for (let i = 0; i < evaluated[0].decision.reasons.length; i++) {
    let worst = evaluated[0].decision.reasons[i];
    let ids = [...evaluated[0].ids];

    for (let g = 1; g < evaluated.length; g++) {
      const r = evaluated[g].decision.reasons[i];
      if (SEVERITY[r.outcome] > SEVERITY[worst.outcome]) {
        worst = r;
        ids = [...evaluated[g].ids];
      } else if (SEVERITY[r.outcome] === SEVERITY[worst.outcome]) {
        ids.push(...evaluated[g].ids);
      }
    }

    if (ids.length === list.length) {
      reasons.push(worst);
      continue;
    }
    ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    reasons.push({
      ...worst,
      shifts: ids,
      detail: `${worst.detail.replace(/\.$/, "")} (${ids.join(", ")}).`,
    });
  }

  return {
    allowed: reasons.every((r) => r.outcome !== "fail"),
    warnings: reasons.filter((r) => r.outcome === "warn").length,
    reasons,
    context: evaluated[0].decision.context,
  };
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
    decideMember({
      person: m.person,
      credentials: m.credentials,
      action,
      site,
      at,
      verifier,
      shifts: m.shifts,
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
