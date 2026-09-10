/* ============================================================
   The venue's own record, folded from the chain.

   POST /api/employer used to mutate EMPLOYERS[0] in place — a
   module-level seed object — and write nothing anywhere. Three
   things followed from that, worst first:

     - no record. acceptsPacks is one-tap employment: turned off, a
       worker who has completed a pack cannot be employed here.
       Nothing said who turned it off or when, in a product whose
       whole argument is that consequential acts leave a trace.
     - not durable. Lost on restart.
     - per-instance. lib/store/events.ts names the deployment
       target as serverless and db.ts notes that "Vercel runs many
       short-lived instances", so a venue could connect payroll,
       refresh, and be told it was not connected — depending on
       which instance answered.

   So the profile is now the seed with every employer event folded
   over it, which is the same arrangement as the board, the
   postings and the run sheet. The seed is never written to.

   Small and deliberately dull: this holds no policy about what a
   valid connector is, only what the chain said happened. The route
   refuses an unknown connector before it appends, because a chain
   that records a refusal as a fact is worse than one that never
   heard about it.
   ============================================================ */

import type { AuditEvent } from "./types";
import type { EmployerProfile, PayrollConnection } from "./employer";
import type { PayrollConnectorId } from "@/lib/payroll/types";

const EMPLOYER_EVENTS = new Set([
  "employer.payroll_connected",
  "employer.payroll_disconnected",
  "employer.packs_set",
]);

/** A payroll connection off an event, or null when the event cannot describe one. */
function connectionFrom(data: Record<string, unknown>): PayrollConnection | null {
  const connector = data.connector;
  const tenantRef = data.tenantRef;
  const connectedAt = data.connectedAt;
  if (typeof connector !== "string" || typeof tenantRef !== "string") return null;
  return {
    connector: connector as PayrollConnectorId,
    tenantRef,
    // an event written before this field existed still describes a connection
    connectedAt: typeof connectedAt === "string" ? connectedAt : "",
  };
}

/**
 * The employer profile as the chain leaves it.
 *
 * `seed` is copied on the way in and never touched again, so a caller can fold
 * twice and get the same answer — and so the bug this replaces cannot come
 * back by accident. Events apply in seq order, last one wins, because these
 * are settings rather than a ledger: the venue's current position is whatever
 * it most recently said.
 *
 * Anything that is not an employer event, or that names a change it cannot
 * describe, is skipped rather than guessed at.
 */
export function replayEmployer(seed: EmployerProfile, log: readonly AuditEvent[]): EmployerProfile {
  const p: EmployerProfile = { ...seed, ...(seed.payroll ? { payroll: { ...seed.payroll } } : {}) };

  const events = log
    .filter((e) => EMPLOYER_EVENTS.has(e.type))
    .slice()
    .sort((a, b) => a.seq - b.seq);

  for (const e of events) {
    const data = (e.data ?? {}) as Record<string, unknown>;

    if (e.type === "employer.payroll_connected") {
      const conn = connectionFrom(data);
      if (conn) p.payroll = conn;
      continue;
    }

    if (e.type === "employer.payroll_disconnected") {
      delete p.payroll;
      continue;
    }

    // employer.packs_set
    if (typeof data.accepts === "boolean") p.acceptsPacks = data.accepts;
  }

  return p;
}
