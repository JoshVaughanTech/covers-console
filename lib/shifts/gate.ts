/* ============================================================
   Can this person take this shift?

   One answer, in one place, because there are now three callers who
   must not disagree: the console renders a board from it, the phone
   renders a list from it, and the claim endpoint enforces it.

   The rule the marketplace rests on is that the gate is structural,
   not presentational. claimShift() already says this about hiding a
   button — but that argument was made inside one process, where the
   button and the check were the same code. A phone is a different
   process on a network the venue does not control, so "the client
   didn't render the button" stops being evidence of anything. The
   claim is refused on the server, by this function, whatever the
   phone believed.

   Two refusals from different layers, deliberately kept apart. A
   credential fact is about whether the law allows the work. A client
   exclusion is about whether the business will send this person to
   that client. Collapsing them would make an RSA problem and a
   commercial preference indistinguishable in the trail, and only one
   of those is a compliance matter.
   ============================================================ */

import {
  decideMember,
  type Credential,
  type CredentialVerifier,
  type Decision,
  type Identity,
  type ISODate,
  type Site,
} from "@/lib/idara";
import { profileOf } from "@/lib/people";
import type { ShiftPosting } from "./types";

export interface GateInput {
  posting: ShiftPosting;
  person: Identity | undefined;
  /** the site the posting names; undefined when it cannot be resolved. */
  site: Site | undefined;
  /** this person's credentials — the caller filters, so the gate stays pure. */
  credentials: Credential[];
  at: ISODate;
  verifier: CredentialVerifier;
}

/**
 * The reason this person cannot take this shift, or null when they can.
 *
 * A missing person or site returns a refusal rather than an allowance. It is
 * the only safe direction: the alternative is that an unresolvable id becomes
 * an unchecked claim, which is the one failure mode a gate must not have.
 */
export function claimBlockReason(input: GateInput): string | null {
  const { posting, person, site, credentials, at, verifier } = input;
  if (!person || !site) return "Not eligible";

  const decision: Decision = decideMember({
    person,
    credentials,
    action: "be_rostered",
    site,
    at,
    verifier,
    // duties come from the posting, never the job title — the same shift-scoped
    // model the roster uses, so a Bartender on the gaming floor is gated on
    // what that shift involves rather than on what the role usually involves
    shifts: [{ id: posting.shiftId, duties: posting.duties }],
  });

  if (!decision.allowed) {
    return decision.reasons.find((r) => r.outcome === "fail")?.detail ?? "Not eligible";
  }

  if (posting.client && profileOf(person.did)?.excludedClients?.includes(posting.client)) {
    return "Not available for this client";
  }

  return null;
}
