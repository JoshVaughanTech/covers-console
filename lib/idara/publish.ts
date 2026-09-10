/* ============================================================
   The receipt a publish leaves behind.

   Separated from the provider because of what it was doing there.
   recordPublish() built these events inside a setAuditLog()
   updater and appended them with appendEvent() — straight into
   the React replica, never to the server. record() in the same
   file does the opposite and says why: the server holds the lock
   that decides seq and prevHash, so it is the only writer.

   So the blocked-publish receipt existed in one browser tab until
   it was reloaded, while the modal told the operator "This
   attempt has been written to the audit log."

   That is the worst of the two directions this repo keeps finding.
   An invented figure claims a measurement nobody took. This
   claimed a RECORD nobody kept, of the one event most worth
   keeping: a venue tried to roster somebody ineligible and was
   stopped. The whole argument for the gate is that refusing
   leaves a trace.

   Pure and separate now, so it can be tested without a DOM and
   so the provider has one appending path rather than two.
   ============================================================ */

import { summarise, summariseCoverage } from "./engine";
import { CREDENTIAL_TYPES } from "./hospitality";
import type { NewAuditEvent } from "./audit";
import type { CoverageCheck, Decision } from "./types";

export interface PublishResult {
  decisions: Decision[];
  eligible: Decision[];
  blocked: Decision[];
  warnings: Decision[];
  /** roster-level requirements — a venue's nominated FSS and the like. */
  coverage: CoverageCheck[];
  /** collective requirements the roster fails to cover. */
  uncovered: CoverageCheck[];
  published: boolean;
}

/**
 * A publish can be blocked by individuals, by the roster as a whole, or by
 * both at once — the audit summary has to say which.
 */
export function blockedSummary(siteName: string, r: PublishResult): string {
  const parts: string[] = [];
  if (r.blocked.length > 0) {
    parts.push(
      `${r.blocked.length} ineligible staff member${r.blocked.length === 1 ? "" : "s"}`,
    );
  }
  for (const c of r.uncovered) {
    parts.push(`no ${CREDENTIAL_TYPES[c.type].shortLabel} on shift`);
  }
  return `Publish blocked for ${siteName} — ${parts.join(" and ")}`;
}

/**
 * Every event one publish attempt should leave on the chain, in order.
 *
 * Order is the contract, not an accident of how this was written. The
 * per-person reasons come first and the summary last, so a partial append —
 * the network dropping between two of them — can leave reasons without a
 * conclusion but never a "blocked, 4 ineligible" claim with nothing behind
 * it. A reader finding the second could not tell which four.
 *
 * A clean publish is one event: there are no refusals to itemise, and the
 * eligible decisions are not news. Warnings are counted in its data rather
 * than written out, because an expiring credential is a thing to see on the
 * screen, not a fact about this publish.
 */
export function publishEvents(
  siteName: string,
  siteId: string,
  result: PublishResult,
  actor: string,
  at: string,
): NewAuditEvent[] {
  if (result.published) {
    return [
      {
        type: "roster.published",
        at,
        actor,
        summary: `Roster published for ${siteName} — ${result.eligible.length} staff, all eligible`,
        data: {
          siteId,
          eligible: result.eligible.length,
          warnings: result.warnings.length,
          published: true,
        },
      },
    ];
  }

  const events: NewAuditEvent[] = [];

  // the receipts: one decision record per blocked worker…
  for (const d of result.blocked) {
    events.push({
      type: "decision",
      at,
      actor,
      subject: d.context.subject,
      summary: `${d.context.subjectName}: ${summarise(d)}`,
      data: { siteId, reasons: d.reasons.filter((r) => r.outcome === "fail") },
    });
  }

  // …a record of any collective gap…
  const coverageGap = summariseCoverage(result.coverage);
  if (coverageGap) {
    events.push({
      type: "decision",
      at,
      actor,
      summary: `${siteName}: ${coverageGap}`,
      data: { siteId, uncovered: result.uncovered },
    });
  }

  // …then the blocked attempt itself, last
  events.push({
    type: "roster.published",
    at,
    actor,
    summary: blockedSummary(siteName, result),
    data: {
      siteId,
      attempted: result.decisions.length,
      blocked: result.blocked.length,
      uncovered: result.uncovered.map((c) => c.type),
      published: false,
    },
  });

  return events;
}
