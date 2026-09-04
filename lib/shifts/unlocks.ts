/* ============================================================
   What holding one more credential would open up.

   The board tells a worker why each shift is closed to them. This
   answers the question that follows and that nothing else does:
   "so what is it worth going and getting?"

   The method is deliberately not inference. A refusal names a
   credential, but naming it does not mean it is the ONLY thing in
   the way — a shift can be blocked on an RSG and a lapsed induction
   at once, and telling someone an RSG unlocks it would send them to
   a course that changes nothing. So this does not read reasons. For
   each credential the person does not hold, it hands the gate a
   hypothetical valid one and asks the same claimBlockReason() again.
   A shift is counted only if it actually flips to claimable.

   That makes the number expensive to be wrong about: it is the
   gate's own answer to a counterfactual, not a guess assembled from
   its explanations. It costs types × postings decisions, which for
   a venue-sized board is nothing.

   The hypothetical is never stored, never audited and never leaves
   this function. It exists for the length of one comparison.

   KNOWN LIMIT, and the safe one: the counterfactual is a single
   credential at a time. A shift blocked on two missing things is
   counted by neither, so it appears nowhere. Aaron Patel in the
   demo seed is exactly this — an induction alone leaves "Allergen
   not held", so the induction is not offered as unlocking it.

   That understates the list, which is the direction to be wrong in.
   Overstating sends somebody to pay for a course that changes
   nothing, and they only discover it after. Understating means the
   shift stays on their board with its reason still showing, which
   is where they were anyway. Combinations could be enumerated
   later; they should not be guessed at.
   ============================================================ */

import {
  CREDENTIAL_TYPES,
  CREDENTIAL_ORDER,
  type Credential,
  type CredentialTypeId,
  type CredentialVerifier,
  type Identity,
  type ISODate,
  type Site,
} from "@/lib/idara";
import { claimBlockReason } from "./gate";
import { seatsLeft } from "./types";
import type { ShiftPosting } from "./types";

export interface CredentialUnlock {
  type: CredentialTypeId;
  shortLabel: string;
  label: string;
  authority: string;
  /**
   * true when the credential is issued per venue rather than carried between
   * them. Worth separating on screen: "go and sit an RSA" is something a
   * worker can act on, where an induction is something the venue owes them.
   */
  siteScoped: boolean;
  /**
   * Which venue this one is for — set only when siteScoped.
   *
   * A site-scoped credential gets a row per site rather than one row for the
   * type. Collapsing them reads as one errand and is two: an induction at
   * Brightwater does nothing for a shift at Werribee, so "Induction · unlocks
   * 2 shifts" would be an instruction that cannot be followed.
   */
  siteId?: string;
  siteName?: string;
  /** the postings that become claimable — verified, not inferred. */
  postingIds: string[];
}

export interface UnlockInput {
  person: Identity;
  /** this person's real credentials. */
  credentials: Credential[];
  postings: ShiftPosting[];
  siteOf: (siteId: string) => Site | undefined;
  at: ISODate;
  verifier: CredentialVerifier;
}

/** A credential that would verify as valid, for asking a what-if. */
function hypothetical(type: CredentialTypeId, person: Identity, siteId: string, at: ISODate): Credential {
  return {
    // marked in the id because a hypothetical that ever reached a store or a
    // chain would be a forged credential, and it should be obvious on sight
    id: `hypothetical-${type}`,
    type,
    subject: person.did,
    issuer: "hypothetical",
    issuedAt: at,
    // far enough out that expiry is never what decides the comparison
    expiresAt: "2099-12-31",
    status: "valid",
    // site-scoped requirements match on this; portable ones ignore it
    claims: { siteId },
  };
}

/**
 * Credentials this person does not hold that would open shifts on the board.
 *
 * Only postings that are actually open and have a seat left are counted — a
 * filled shift is not something a certificate would have got them.
 */
export function unlocksFor(input: UnlockInput): CredentialUnlock[] {
  const { person, credentials, postings, siteOf, at, verifier } = input;

  const open = postings.filter((p) => p.status === "open" && seatsLeft(p) > 0);

  const blocked = open.filter(
    (p) =>
      claimBlockReason({
        posting: p,
        person,
        site: siteOf(p.siteId),
        credentials,
        at,
        verifier,
      }) !== null,
  );
  if (blocked.length === 0) return [];

  /* Held-and-valid, and for a site-scoped credential, valid FOR THAT SITE.

     Keying this on type alone was wrong in a way that read fine: somebody with
     inductions at three venues "holds an induction", so the whole type was
     skipped and the fourth venue they are actually blocked at never appeared.
     A site-scoped credential is only held where it is scoped. */
  const key = (type: CredentialTypeId, siteId: string | null) =>
    siteId === null ? type : `${type}@${siteId}`;

  const holdsValid = new Set(
    credentials
      .filter((c) => c.subject === person.did && verifier.verify(c, at).status === "valid")
      .map((c) =>
        key(c.type, CREDENTIAL_TYPES[c.type].siteScoped ? (c.claims.siteId as string) ?? null : null),
      ),
  );

  const unlocks: CredentialUnlock[] = [];

  for (const type of CREDENTIAL_ORDER) {
    const meta = CREDENTIAL_TYPES[type];

    /* Opened postings, grouped by the thing the person would have to go and
       get: one errand for a portable credential, one per venue for a scoped
       one. */
    const opened = new Map<string | null, string[]>();

    for (const p of blocked) {
      const site = siteOf(p.siteId);
      if (!site) continue;

      const scope = meta.siteScoped ? site.id : null;
      if (holdsValid.has(key(type, scope))) continue;

      /* The hypothetical REPLACES what they hold of this type rather than
         sitting beside it. decideMember() takes the first credential matching
         the type and then verifies it, so a revoked RSA at the head of the
         list shadows a valid one appended after — and the renewal case, the
         single most useful thing this function can surface, silently reported
         nothing. Replacing is also the truer counterfactual: somebody who
         renews an RSA has one RSA, not two. */
      const withIt = [
        ...credentials.filter(
          (c) => !(c.type === type && (!meta.siteScoped || c.claims.siteId === site.id)),
        ),
        hypothetical(type, person, site.id, at),
      ];

      const clear =
        claimBlockReason({ posting: p, person, site, credentials: withIt, at, verifier }) === null;
      if (clear) opened.set(scope, [...(opened.get(scope) ?? []), p.id]);
    }

    for (const [scope, postingIds] of opened) {
      if (postingIds.length === 0) continue;
      unlocks.push({
        type,
        shortLabel: meta.shortLabel,
        label: meta.label,
        authority: meta.authority,
        siteScoped: meta.siteScoped,
        ...(scope ? { siteId: scope, siteName: siteOf(scope)?.name ?? scope } : {}),
        postingIds,
      });
    }
  }

  // most shifts first: the whole point is what is worth doing next
  return unlocks.sort((a, b) => b.postingIds.length - a.postingIds.length);
}
