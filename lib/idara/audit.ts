/* ============================================================
   Idara Core — append-only, hash-chained audit log
   Every consequential decision (publish, clock-in, sign-off,
   credential change) lands here. Each event hashes over the
   previous event's hash, so any tampering breaks the chain —
   this is the "show me the receipts" proof layer.

   The digest is SHA-256 over a canonical (key-sorted) encoding
   of the event body; see hash.ts. Editing, reordering or removing
   any event invalidates every hash from that point on, and
   verifyChain() reports the first break.
   ============================================================ */

import { sha256Hex, canonicalJson } from "./hash";
import type { AuditEvent, AuditEventType, DID, ISODate } from "./types";

/** Name of the digest, surfaced in the UI so the claim is checkable. */
export const HASH_ALGORITHM = "SHA-256";

/** The chain's anchor — a 64-hex-char zero root, matching digest width. */
export const GENESIS_HASH = "0".repeat(64);

/** Body of an event, without its own hash: exactly what gets digested. */
type AuditEventBody = Omit<AuditEvent, "hash">;

function digest(prevHash: string, body: AuditEventBody): string {
  return sha256Hex(prevHash + canonicalJson(body));
}

/** First 12 chars — enough to read in a table, full value on hover. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

export interface NewAuditEvent {
  type: AuditEventType;
  at: ISODate;
  actor: string;
  /** who acted, identified. Omitted for "system" and for callers that
      have no session — never null, which would alter the digest. */
  actorDid?: DID;
  subject?: DID;
  summary: string;
  data?: Record<string, unknown>;
}

/** Returns a new log array with the event appended and chained. */
export function appendEvent(log: AuditEvent[], ev: NewAuditEvent): AuditEvent[] {
  const prev = log[log.length - 1];
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const seq = prev ? prev.seq + 1 : 0;
  const body: AuditEventBody = {
    seq,
    id: `evt-${seq}`,
    type: ev.type,
    at: ev.at,
    actor: ev.actor,
    actorDid: ev.actorDid,
    subject: ev.subject,
    summary: ev.summary,
    data: ev.data ?? {},
    prevHash,
  };
  return [...log, { ...body, hash: digest(prevHash, body) }];
}

/** Recompute the chain and report the first broken link (or null). */
export function verifyChain(log: AuditEvent[]): { ok: boolean; brokenAt: number | null } {
  let prevHash = GENESIS_HASH;
  for (const e of log) {
    const { hash, ...body } = e;
    if (e.prevHash !== prevHash || hash !== digest(prevHash, body)) {
      return { ok: false, brokenAt: e.seq };
    }
    prevHash = hash;
  }
  return { ok: true, brokenAt: null };
}
