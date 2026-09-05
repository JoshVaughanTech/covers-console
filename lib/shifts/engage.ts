/* ============================================================
   Booking → engagement.

   When a manager assigns somebody to a shift, the employment offer
   assembles itself: the worker's pack, the venue's employer
   profile, the award floor this shift was priced against, and the
   eligibility answer the gate already gives. Nobody types anything.

   This runs behind the append, next to offerPosting(), and for the
   same reason that one does: an engagement created at the call site
   is one more thing to forget, and forgetting it would be silent —
   the assignment lands, the worker is on the roster, and nothing
   ever put them on payroll.

   The venue's signature goes on immediately. That is not the venue
   being skipped; it is the venue having signed already. §4 of the
   design puts a named signatory on the employer profile precisely
   so that its half of the agreement exists before any particular
   shift does, and the act of assigning somebody is the venue
   exercising it. The worker's half is a tap on their own phone, and
   until it arrives the engagement sits at `proposed` and nothing is
   released to anybody.

   A refusal is returned rather than recorded. An engagement that
   was never proposed is not an engagement event, and writing one
   would put a thing on the chain that does not exist. The
   assignment stands either way — the worker is rostered, the venue
   just cannot employ them through Covers until whatever is named in
   the refusal is fixed.

   SERVER ONLY, and not exported from lib/shifts. It reaches the
   pack seed and therefore the vault; the barrel is imported by a
   client screen. See the note at the top of index.ts.
   ============================================================ */

import {
  proposeEngagement,
  acceptedEvent,
  proposedEvent,
  replayEngagements,
  type Engagement,
  type Refusal,
} from "@/lib/idara/engagement";
import { employerForSite } from "@/lib/idara/employer-seed";
import { packOf } from "@/lib/idara/pack-seed";
import { LocalCredentialVerifier } from "@/lib/idara/verifier";
import { SITES, TODAY, WORKERS } from "@/lib/idara/seed";
import type { AuditEvent } from "@/lib/idara/types";
import type { EventStore } from "@/lib/store/events";
import type { RateSegment, ShiftPrice } from "@/lib/awards/rates";
import { boardFrom } from "./board";
import { claimBlockReason } from "./gate";
import { priceOf } from "./pay";
import type { ShiftPosting } from "./types";

const TZ = "Australia/Melbourne";
const siteIndex = new Map(SITES.map((s) => [s.id, s]));
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));
const verifier = new LocalCredentialVerifier();

/** The calendar date a moment falls on at the venue, not on this server. */
export function venueDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ts * 1000);
}

/**
 * The loadings this shift attracts, named.
 *
 * Read off the priced segments rather than recomputed, so the list on the
 * engagement is the same one that produced the floor it was checked against.
 * A second derivation of "is this a Saturday" is a second chance to disagree
 * with the first.
 */
export function loadingsOf(price: ShiftPrice): string[] {
  const out = new Set<string>();
  if (price.employment === "casual") out.add("casual_25");
  for (const s of price.segments as RateSegment[]) {
    if (s.band !== "ordinary") out.add(s.band);
    if (s.adder) out.add(s.adder);
  }
  return [...out];
}

export interface EngageResult {
  postingId: string;
  workerDid: string;
  /** set when an engagement was proposed. */
  engagementId?: string;
  proposed: boolean;
  refusals: Refusal[];
}

/** Is this the event that means somebody has been put on a shift? */
function isAssignment(e: AuditEvent): boolean {
  return e.type === "shift.assigned" && typeof e.subject === "string";
}

/**
 * Propose the engagement an assignment implies.
 *
 * Returns null when the event is not an assignment, so the caller can hand it
 * every append without filtering. Returns a result with `proposed: false` and
 * the reasons when the engagement cannot be assembled — those go back to the
 * console, which is the only place they can be acted on.
 */
export function engageOnAssign(
  store: EventStore,
  orgId: string,
  ev: AuditEvent,
): EngageResult | null {
  if (!isAssignment(ev)) return null;
  const workerDid = ev.subject as string;

  const log = store.all(orgId);
  const board = boardFrom(log);
  const postingId = (ev.data as { postingId?: unknown }).postingId;
  const posting = board.postings.find((p) => p.id === postingId);
  if (!posting) return null;

  const refuse = (refusals: Refusal[]): EngageResult => ({
    postingId: posting.id,
    workerDid,
    proposed: false,
    refusals,
  });

  const worker = workerIndex.get(workerDid);
  if (!worker) return refuse([{ code: "eligibility.blocked", detail: "Unknown worker." }]);

  const employer = employerForSite(posting.siteId);
  if (!employer) {
    return refuse([
      {
        code: "employer.not_ready",
        detail: `No employer profile covers ${siteIndex.get(posting.siteId)?.name ?? posting.siteId}.`,
      },
    ]);
  }

  const pack = packOf(workerDid);
  if (!pack) {
    return refuse([
      { code: "pack.incomplete", detail: `${worker.name} has no employment pack yet.` },
    ]);
  }

  /* No rate, no engagement. An employment agreement whose pay was left blank
     is not one somebody can sign, and the floor cannot be enforced against a
     number nobody set. */
  const assessment = priceOf(posting);
  if (!posting.pay || !assessment) {
    return refuse([
      {
        code: "rate.below_floor",
        detail: "This shift has no published rate, so there is nothing to agree to.",
      },
    ]);
  }

  const alreadyEngaged = replayEngagements(log);

  const result = proposeEngagement({
    worker: { did: worker.did, name: worker.name },
    pack,
    employer,
    postingId: posting.id,
    shift: {
      siteId: posting.siteId,
      /* The real moment, from the pay block, not the demo week's display
         string. lib/shifts/seed.ts explains why those two differ; what
         matters here is that the date on the agreement is the date the award
         was applied to. */
      date: venueDate(posting.pay.startsAt),
      start: posting.window.split("–")[0] ?? posting.window,
      end: posting.window.split("–")[1] ?? posting.window,
      role: posting.role,
      startsAt: posting.pay.startsAt,
      endsAt: posting.pay.endsAt,
      // so the estimate on the agreement is the estimate the board showed
      ...(posting.pay.unpaidBreakSec ? { unpaidBreakSec: posting.pay.unpaidBreakSec } : {}),
    },
    offeredRateCents: posting.pay.offeredHourlyCents,
    // the DEAREST hour, never the blended average — see assessOffer()
    floorRateCents: assessment.requiredHourlyCents,
    // and the level that floor was worked out at, so an agreement cannot name
    // a classification the money does not belong to
    pricedLevel: posting.pay.level,
    loadings: loadingsOf(assessment.price),
    blockReason: claimBlockReason({
      posting,
      person: worker,
      site: siteIndex.get(posting.siteId),
      credentials: board.credentials.filter((c) => c.subject === workerDid),
      at: board.at,
      verifier,
    }),
    priorEngagements: alreadyEngaged,
    // the console's demo clock, the same one the gate ran against
    at: TODAY,
  });

  if (!result.ok) return refuse(result.refusals);

  const engagement = result.engagement;

  /* Already proposed. The id is derived from the posting and the worker, so a
     replayed or retried assignment lands on the same engagement — and this is
     where that pays off: the second attempt returns the first one rather than
     proposing a duplicate employment for the same hours. */
  if (alreadyEngaged.some((e) => e.id === engagement.id)) {
    return { postingId: posting.id, workerDid, engagementId: engagement.id, proposed: true, refusals: [] };
  }

  store.append(orgId, proposedEvent(engagement, ev.actor, ev.actorDid), {
    clientRef: `engagement:proposed:${engagement.id}`,
  });

  store.append(
    orgId,
    acceptedEvent(engagement, "employer", {
      at: engagement.proposedAt,
      actor: ev.actor,
      ...(ev.actorDid ? { actorDid: ev.actorDid } : {}),
      // the signature is the profile's, not the operator's: whoever assigned
      // the shift acted for the venue, and the venue's signatory is who stands
      // behind the agreement
      byDid: employer.signatoryDid,
    }),
    { clientRef: `engagement:accepted:employer:${engagement.id}` },
  );

  return {
    postingId: posting.id,
    workerDid,
    engagementId: engagement.id,
    proposed: true,
    refusals: [],
  };
}

/** The engagement covering one posting for one worker, if there is one. */
export function engagementForAssignment(
  engagements: Engagement[],
  postingId: string,
  workerDid: string,
): Engagement | undefined {
  return engagements.find((e) => e.postingId === postingId && e.workerDid === workerDid);
}

/** The posting an engagement names, for a screen that has one and needs the other. */
export function postingOf(postings: ShiftPosting[], e: Engagement): ShiftPosting | undefined {
  return postings.find((p) => p.id === e.postingId);
}
