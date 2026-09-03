/* ============================================================
   Sending someone on a break — the two-phase write.

   A break decision has two effects that fail independently: it must
   reach Connecteam's timesheet, or payroll will not see it, and it
   must reach Covers' chain, or there is no evidence it was given.
   Treating them as one operation is the trap.

   So: append first, push second, then append the outcome. The order
   is deliberate. Pushing first and appending second means a crash
   between them loses the supervisor's decision — the one thing that
   must never be lost, because it is the evidence the break happened.
   Appending first means the worst case is a decision we know about
   and can retry.

   `pushed` is a state, never a mutated field: pending resolves to ok
   or failed by a SECOND event. Rewriting the first would break the
   chain, which is the point of having one.
   ============================================================ */
import { EventStore } from "./events";
import type { AuditEvent } from "@/lib/idara/types";

export type PushState = "pending" | "ok" | "failed" | "skipped";

export interface BreakDecisionInput {
  /** who was sent */
  subject: string;
  name: string;
  kind: "meal" | "rest";
  /** when the supervisor acted — not when we recorded it */
  at: string;
  actor: string;
  /** past the 6h mark, so cl 16.6 loading was already accruing */
  overdue?: boolean;
  /** idempotency: minted by the client, survives its retries */
  clientRef?: string;
  /** award context, carried onto the receipt */
  data?: Record<string, unknown>;
}

/** What actually effects the break in the customer's system of record. */
export interface BreakPusher {
  /** Resolves with the created break id, or throws. */
  push(input: BreakDecisionInput): Promise<{ ctBreakId: string }>;
  /** False when the integration cannot write — no scope, or read-only mode. */
  available(): boolean;
}

export interface DecisionResult {
  decision: AuditEvent;
  outcome: AuditEvent | null;
  pushed: PushState;
  ctBreakId?: string;
  reason?: string;
  /** false when a replayed clientRef matched an existing decision */
  created: boolean;
}

const RETRYABLE = /timeout|network|fetch failed|ECONN|502|503|504|429/i;

export async function sendOnBreak(
  store: EventStore,
  orgId: string,
  pusher: BreakPusher,
  input: BreakDecisionInput,
): Promise<DecisionResult> {
  const willPush = pusher.available();

  /* phase 1 — ours, and it always succeeds */
  const first = store.append(
    orgId,
    {
      type: "break.decision",
      at: input.at,
      actor: input.actor,
      subject: input.subject,
      summary:
        `${input.name} sent on ${input.kind} break at ${clock(input.at)}` +
        (input.overdue ? " (overdue — cl 16.6 loading applies)" : ""),
      data: {
        ...input.data,
        kind: input.kind,
        overdue: Boolean(input.overdue),
        pushed: willPush ? "pending" : "skipped",
      },
    },
    { clientRef: input.clientRef },
  );

  // a replay is not a second break: return the original and push nothing
  if (!first.created) {
    return {
      decision: first.event,
      outcome: null,
      pushed: (first.event.data.pushed as PushState) ?? "pending",
      created: false,
    };
  }

  if (!willPush) {
    // read-only integration. The record stands, and the caller is expected to
    // say so on screen rather than imply the timesheet was updated.
    return { decision: first.event, outcome: null, pushed: "skipped", created: true };
  }

  /* phase 2 — the customer's system of record, which may refuse */
  try {
    const { ctBreakId } = await pusher.push(input);
    const outcome = store.append(orgId, {
      type: "break.pushed",
      at: new Date().toISOString(),
      actor: "system",
      subject: input.subject,
      summary: `${input.name}'s ${input.kind} break written to Connecteam`,
      data: { decisionSeq: first.event.seq, ok: true, ctBreakId },
    }).event;
    return { decision: first.event, outcome, pushed: "ok", ctBreakId, created: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const outcome = store.append(orgId, {
      type: "break.push_failed",
      at: new Date().toISOString(),
      actor: "system",
      subject: input.subject,
      summary: `${input.name}'s ${input.kind} break could not be written to Connecteam`,
      data: { decisionSeq: first.event.seq, ok: false, reason, retryable: RETRYABLE.test(reason) },
    }).event;
    return { decision: first.event, outcome, pushed: "failed", reason, created: true };
  }
}

/**
 * Decisions whose push never resolved.
 *
 * This is the state that must reach a screen rather than a log: Covers saying a
 * break was given while the timesheet disagrees is the exact divergence
 * write-through exists to prevent.
 */
export function unresolvedPushes(store: EventStore, orgId: string, olderThanMs = 5 * 60_000) {
  const events = store.withMeta(orgId);
  const resolved = new Set(
    events
      .filter((m) => m.event.type === "break.pushed" || m.event.type === "break.push_failed")
      .map((m) => m.event.data.decisionSeq as number),
  );
  const cutoff = Date.now() - olderThanMs;
  return events
    .filter(
      (m) =>
        m.event.type === "break.decision" &&
        m.event.data.pushed === "pending" &&
        !resolved.has(m.event.seq) &&
        // inclusive: "older than 0ms" means everything still unresolved, and a
        // record written in the same millisecond as the check is not younger
        Date.parse(m.recordedAt) <= cutoff,
    )
    .map((m) => ({ seq: m.event.seq, subject: m.event.subject, since: m.recordedAt }));
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: process.env.TZ_VENUE ?? "Australia/Melbourne",
  });
}
