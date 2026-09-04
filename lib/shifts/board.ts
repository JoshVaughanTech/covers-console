/* ============================================================
   The board as the server sees it.

   The console builds its board inside a React provider, from seed
   data plus events it holds in memory. The phone cannot do that —
   it is a different process, and more to the point it must not be
   trusted to decide what it is allowed to see.

   So this rebuilds the same two things the gate needs, from the
   chain, with no React anywhere: the postings, and the credentials
   as they stand today.

   The credential half is the part that would otherwise rot quietly.
   Revoking a licence in the console writes `credential.revoked` and
   updates provider state; a server that read only the seed would
   keep saying "valid" for a credential the console has already
   struck off, and the phone would offer shifts to someone the
   console refuses. Two readings of one fact, disagreeing — which is
   the bug replay.ts exists to prevent, arriving through a different
   door.

   Folding is one-directional on purpose. A revocation we miss lets
   someone claim who should not: silent, and a compliance failure.
   An issuance we miss refuses someone who should be allowed: loud,
   and they ring the venue. Where the two cannot both be guaranteed,
   the gate should fail in the direction that gets noticed.
   ============================================================ */

import type { AuditEvent, Credential, ISODate } from "@/lib/idara/types";
// the seed directly, not the "@/lib/idara" barrel: that re-exports the
// provider, which is a client component, and this runs on the server
import { CREDENTIALS, TODAY } from "@/lib/idara/seed";
import { POSTINGS } from "./seed";
import { replayPostings } from "./replay";
import type { ShiftPosting } from "./types";

export interface Board {
  postings: ShiftPosting[];
  credentials: Credential[];
  at: ISODate;
}

interface CredentialEventData {
  credId?: unknown;
}

/** Credentials as the chain leaves them: the seed with revocations applied. */
export function credentialsNow(log: AuditEvent[]): Credential[] {
  const revoked = new Set<string>();
  for (const e of log) {
    if (e.type !== "credential.revoked") continue;
    const id = (e.data as CredentialEventData)?.credId;
    if (typeof id === "string") revoked.add(id);
  }
  if (revoked.size === 0) return CREDENTIALS;
  return CREDENTIALS.map((c) => (revoked.has(c.id) ? { ...c, status: "revoked" as const } : c));
}

/**
 * Everything a server-side eligibility answer depends on, read from the chain.
 *
 * `at` is the console's TODAY rather than the wall clock, because the whole
 * demo world is dated there — a gate running against the real date would
 * report every seeded credential as long expired and refuse everyone, which
 * looks like a broken gate rather than a dated fixture.
 */
export function boardFrom(log: AuditEvent[]): Board {
  return {
    postings: replayPostings(POSTINGS, log),
    credentials: credentialsNow(log),
    at: TODAY,
  };
}
