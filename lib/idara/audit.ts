/* ============================================================
   Idara Core — append-only, hash-chained audit log
   Every consequential decision (publish, clock-in, sign-off,
   credential change) lands here. Each event hashes over the
   previous event's hash, so any tampering breaks the chain —
   this is the "show me the receipts" proof layer.

   NOTE: digest() below is a fast non-cryptographic placeholder.
   Production swaps in SHA-256 (crypto.subtle) — the chain shape
   and verifyChain() stay identical.
   ============================================================ */

import type { AuditEvent, AuditEventType, DID, ISODate } from "./types";

export const GENESIS_HASH = "00000000";

function digest(input: string): string {
  // djb2 — placeholder for SHA-256.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface NewAuditEvent {
  type: AuditEventType;
  at: ISODate;
  actor: string;
  subject?: DID;
  summary: string;
  data?: Record<string, unknown>;
}

/** Returns a new log array with the event appended and chained. */
export function appendEvent(log: AuditEvent[], ev: NewAuditEvent): AuditEvent[] {
  const prev = log[log.length - 1];
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const seq = prev ? prev.seq + 1 : 0;
  const body = {
    seq,
    id: `evt-${seq}`,
    type: ev.type,
    at: ev.at,
    actor: ev.actor,
    subject: ev.subject,
    summary: ev.summary,
    data: ev.data ?? {},
    prevHash,
  };
  const hash = digest(prevHash + JSON.stringify(body));
  return [...log, { ...body, hash }];
}

/** Recompute the chain and report the first broken link (or null). */
export function verifyChain(log: AuditEvent[]): { ok: boolean; brokenAt: number | null } {
  let prevHash = GENESIS_HASH;
  for (const e of log) {
    const { hash, ...body } = e;
    const expected = digest(prevHash + JSON.stringify(body));
    if (e.prevHash !== prevHash || hash !== expected) {
      return { ok: false, brokenAt: e.seq };
    }
    prevHash = hash;
  }
  return { ok: true, brokenAt: null };
}
