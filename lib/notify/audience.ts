/* ============================================================
   Who should hear about a shift.

   The same question the board answers, asked once more — and
   deliberately through the same function. If this had its own idea
   of eligibility, a worker could be told about a shift the board
   then refuses them, which is worse than not telling them at all: it
   is an invitation followed by a closed door, and the reason would
   be invisible to everybody.

   So the audience is exactly the set claimBlockReason() returns null
   for. Nothing more clever. Ranking, preference and fairness belong
   to the matcher and are a different feature; this decides who is
   ALLOWED to hear, not who most deserves to.

   Eligibility at the moment of posting, and only that. Somebody
   whose RSA lapses on Thursday was genuinely eligible on Tuesday, so
   the notification was not wrong when it was sent — but the claim
   will be refused, correctly, by the gate at the door. Recording who
   was told and when is what lets those two facts sit together
   instead of looking like a contradiction.
   ============================================================ */

import { claimBlockReason } from "@/lib/shifts";
import type { ShiftPosting } from "@/lib/shifts";
import { LocalCredentialVerifier } from "@/lib/idara/verifier";
import { SITES, WORKERS } from "@/lib/idara/seed";
import type { Credential, ISODate } from "@/lib/idara/types";

const siteIndex = new Map(SITES.map((s) => [s.id, s]));
const verifier = new LocalCredentialVerifier();

export interface Audience {
  /** who may be told, because they could actually take it today. */
  eligible: string[];
  /**
   * Who could not, and why — counted rather than named.
   *
   * The count is what makes a thin audience explainable to the manager who
   * posted it: "two people, and six more would qualify with a current RSA" is
   * actionable, where "two people" reads as a quiet shift.
   */
  blocked: Record<string, number>;
}

export interface AudienceInput {
  posting: ShiftPosting;
  credentials: Credential[];
  at: ISODate;
}

/** Everybody who could claim this posting right now. */
export function audienceFor({ posting, credentials, at }: AudienceInput): Audience {
  const site = siteIndex.get(posting.siteId);
  const eligible: string[] = [];
  const blocked: Record<string, number> = {};

  for (const person of WORKERS) {
    /* Already on it, or already asked — telling them again is noise, and the
       phone would show a shift they cannot act on. */
    if (posting.assigned.includes(person.did)) continue;
    if (posting.claims.some((c) => c.did === person.did && !c.refused)) continue;

    const reason = claimBlockReason({
      posting,
      person,
      site,
      credentials: credentials.filter((c) => c.subject === person.did),
      at,
      verifier,
    });

    if (reason) blocked[reason] = (blocked[reason] ?? 0) + 1;
    else eligible.push(person.did);
  }

  return { eligible, blocked };
}
