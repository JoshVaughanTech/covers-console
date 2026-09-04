/* ============================================================
   What one person holds, and what state it is in.

   verify() answers about a single credential. decide() answers
   whether somebody may work a shift, which needs a site — an RSA
   binds to whoever serves alcohol, an induction is per venue, a
   Food Safety Supervisor is owed by the roster rather than the
   person. Between those sits a question neither answers and two
   screens ask: what does this person hold, and is any of it a
   problem?

   It exists as one function because it was briefly two. The
   Credentials screen computed it inline; People was about to
   compute it again, and a second copy is how a roster comes to show
   a green dot beside somebody whose licence the engine has already
   refused. That is the failure both screens were built to remove,
   so the derivation is shared rather than repeated.

   Deliberately says nothing about eligibility. A person whose
   credentials are all current may still be refused a particular
   shift, and this cannot know that.
   ============================================================ */

import { EXPIRY_WARN_DAYS } from "./engine";
import { calendarDate } from "./dates";
import type { Credential, DID, ISODate } from "./types";
import type { CredentialVerifier } from "./verifier";

/** State of one credential as at a date. */
export type HeldState = "current" | "expiring" | "expired" | "revoked" | "suspended";

export interface HeldCredential {
  credential: Credential;
  state: HeldState;
  /** whole days until expiry; null when it does not expire. Negative once past. */
  daysLeft: number | null;
}

/** Worst state across everything somebody holds. */
export type StandingState = "current" | "expiring" | "action_needed";

export interface Standing {
  state: StandingState;
  /** everything they hold, whatever its state */
  held: HeldCredential[];
  /** just the ones that are not current */
  problems: HeldCredential[];
}

/** Whole days between two dates, each narrowed to its calendar day. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round(
    (Date.parse(calendarDate(to)) - Date.parse(calendarDate(from))) / 86_400_000,
  );
}

/**
 * Everything this person holds, verified as at `at`.
 *
 * The verifier decides revoked, suspended and expired; expiring is the
 * engine's own EXPIRY_WARN_DAYS, so a credential amber here is the same one
 * decide() raises a warning about.
 */
export function standingOf(
  did: DID,
  credentials: Credential[],
  at: ISODate,
  verifier: CredentialVerifier,
): Standing {
  const held = credentials
    .filter((c) => c.subject === did)
    .map((c): HeldCredential => {
      const result = verifier.verify(c, at);
      const daysLeft = c.expiresAt ? daysBetween(at, c.expiresAt) : null;

      let state: HeldState =
        result.status === "revoked" ? "revoked"
        : result.status === "suspended" ? "suspended"
        : result.status === "expired" ? "expired"
        : "current";

      if (state === "current" && daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS) {
        state = "expiring";
      }
      return { credential: c, state, daysLeft };
    });

  const problems = held.filter((h) => h.state !== "current");
  const blocking = problems.some(
    (h) => h.state === "expired" || h.state === "revoked" || h.state === "suspended",
  );

  return {
    state: blocking ? "action_needed" : problems.length ? "expiring" : "current",
    held,
    problems,
  };
}
