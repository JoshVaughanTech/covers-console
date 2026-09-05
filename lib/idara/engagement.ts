/* ============================================================
   Idara — the engagement.

   A booking is a row in a table. An engagement is a credential: it
   names this worker, this employer, this shift and this rate, it
   pins both parties' records by hash, and both sides sign it. The
   difference is what an auditor can do with it. A row can be
   edited by whoever owns the database; an engagement can be checked
   against the pack hashes and the employer profile hash it carries,
   by somebody who does not trust us at all.

   Four decisions are worth stating, because each of them is the
   opposite of the obvious implementation.

   1. THIS MODULE IS PURE, AND IT DOES NOT DECIDE ELIGIBILITY.
      The gate lives in the engine and in lib/shifts/gate.ts, and
      the answer is passed in — the same bargain claimShift() makes.
      One place decides who may work; this one records the deal.

   2. STATE IS FOLDED FROM THE CHAIN, NOT STORED BESIDE IT.
      `engagement.proposed` carries the whole engagement, and every
      transition is an event. replayEngagements() rebuilds them the
      way replayPostings() rebuilds the board. Two durable copies of
      one fact drift, and the drift is silent.

   3. THE ACCEPTANCE IS THE SIGNATURE.
      Not a scan of a signature, not a DocuSign envelope: a tap, by
      an identity Idara verified, recorded as an event whose hash is
      chained to everything before it. `eventHash` on each side is
      that chain position, so "prove I agreed to this" is answered
      by recomputing a hash rather than by trusting a database.

   4. THE ID IS DERIVED, NOT MINTED.
      Same posting and same worker gives the same engagement id, so
      a retried assignment cannot produce a second engagement for one
      person and one shift. An engagement duplicated is somebody
      employed twice for the same hours.
   ============================================================ */

import { sha256Hex } from "./hash";
import { calendarDate } from "./dates";
import {
  FIRST_ENGAGEMENT_RELEASES,
  agreementCompatible,
  claimsThresholdWith,
  completenessOf,
  packSnapshot,
  type PackItemKind,
  type WorkerPack,
} from "./pack";
import { canEmploy, classificationFor, employerProfileHash, profileGaps, type EmployerProfile } from "./employer";
import type { AuditEvent, DID, ISODate } from "./types";
import type { NewAuditEvent } from "./audit";
import { LEVELS, type Level } from "@/lib/awards/rates";
import type { PayrollConnectorId } from "@/lib/payroll/types";

/**
 * Where a classification sits in the ladder.
 *
 * The levels are a mixed union — "introductory" then 1 to 6 — so they cannot
 * be compared with `<`. The array in lib/awards/rates is already in award
 * order, which makes its index the comparison and keeps one definition of
 * that order rather than a second one here that could drift.
 */
function rank(level: Level): number {
  return LEVELS.indexOf(level);
}

/**
 * Superannuation guarantee, as a rate rather than a percentage.
 *
 * On the engagement rather than looked up at payment time because it is part
 * of the deal being signed: what somebody agreed to work for included the
 * super owed on it, and a rate that moved between the signing and the payslip
 * would change the agreement after the fact.
 */
export const SUPER_GUARANTEE_RATE = 0.12;

export type EngagementStatus =
  | "proposed"
  | "accepted"
  | "provisioned"
  | "worked"
  | "confirmed"
  | "cancelled";

export interface EngagementShift {
  siteId: string;
  date: ISODate;
  /** local wall clock, as the roster shows it. */
  start: string;
  end: string;
  role: string;
  /** epoch seconds — what the award was actually applied to. */
  startsAt: number;
  endsAt: number;
  /**
   * The unpaid meal break the roster plans, in seconds.
   *
   * On the engagement because the estimate a worker signs has to be the
   * estimate the board showed them. Without it the agreement quoted eight
   * hours for a shift the shift card called seven and a half, and two numbers
   * for one shift on two screens is the fastest way to lose somebody's trust
   * in both.
   */
  unpaidBreakSec?: number;
}

export interface EngagementPay {
  classification: { level: Level; stream: string };
  /** the award floor a flat rate has to clear for every hour, integer cents. */
  baseRateCents: number;
  /** what the venue offered, integer cents. Enforced at or above baseRateCents. */
  offeredRateCents: number;
  /** the bands and loadings this shift attracts, e.g. ["casual_25", "saturday"]. */
  loadings: string[];
  superRate: number;
}

export interface Acceptance {
  at: string;
  /** position in the chain — the evidence, not a flag. */
  eventHash: string;
  byDid?: DID;
}

export interface Release {
  item: PackItemKind;
  toConnector: PayrollConnectorId;
  at: string;
}

export interface Engagement {
  id: string;
  workerDid: DID;
  employerDid: DID;
  /**
   * Set only on the partner-EOR path (§9): a licensed labour-hire partner is
   * the employer and the venue is the host. Absent means the venue employs,
   * which is the whole product; this exists so the difference is on the
   * credential rather than in a config file somewhere.
   */
  hostDid?: DID;
  postingId: string;
  shift: EngagementShift;
  pay: EngagementPay;
  employment: {
    /** triggers payroll create + statements. False on every shift after the first. */
    firstEngagementWithEmployer: boolean;
    /** true only when this employer is the worker's nominated primary. */
    claimsTaxFreeThreshold: boolean;
    agreementTemplateVersion: string;
  };
  /** what was true at signing: pack item kind → hash. */
  packSnapshot: Record<string, string>;
  employerProfileHash: string;
  proposedAt: string;
  acceptance: {
    worker: Acceptance | null;
    employer: Acceptance | null;
  };
  releases: Release[];
  status: EngagementStatus;
  /** set when cancelled, so the trail says why rather than just that. */
  cancelledReason?: string;
}

/* ---------- proposing ---------- */

export type RefusalCode =
  | "employer.not_ready"
  | "pack.incomplete"
  | "agreement.version_mismatch"
  | "rate.below_floor"
  | "eligibility.blocked"
  | "classification.missing"
  /**
   * The shift was PRICED below the level the venue itself classifies this role
   * at. Pricing above is fine and common — an off-premise wedding is rostered
   * at a level up from the same job in the bistro, and nobody is harmed by
   * being paid more. Pricing below is the venue paying under its own recorded
   * position for the work, which is the shape an underpayment actually takes:
   * not a rate anybody argues about, a classification quietly dropped a level.
   */
  | "classification.below_profile";

export interface Refusal {
  code: RefusalCode;
  detail: string;
  /** the pack items in the way, when that is what it is. */
  missing?: PackItemKind[];
}

export interface ProposeInput {
  worker: { did: DID; name: string };
  pack: WorkerPack;
  employer: EmployerProfile;
  postingId: string;
  shift: EngagementShift;
  /** integer cents per hour the venue is offering. */
  offeredRateCents: number;
  /** the award floor a flat rate must clear, from assessOffer().requiredHourlyCents. */
  floorRateCents: number;
  /**
   * The classification the floor above was computed at.
   *
   * This is the level the engagement NAMES, because it is the level the money
   * was worked out at — an agreement that said one thing while the rate meant
   * another would be unreadable in a dispute. The venue's profile supplies the
   * stream and the floor beneath it; see "classification.below_profile".
   *
   * Optional only because a caller that has not priced the shift has nothing
   * to pass — and such a caller cannot clear the rate check either.
   */
  pricedLevel?: Level;
  /** band and loading labels for the shift, from the same pricing pass. */
  loadings: string[];
  /**
   * Why this person cannot work this shift, or null. Computed by the caller
   * against the engine — see the note at the top of the file.
   */
  blockReason: string | null;
  /** engagements this worker already has, for the first-engagement test. */
  priorEngagements: Engagement[];
  at: string;
  /** the partner-EOR path; the venue becomes the host. */
  employerOfRecordDid?: DID;
}

export type ProposeResult =
  | { ok: true; engagement: Engagement }
  | { ok: false; refusals: Refusal[] };

/**
 * The id, derived from the two things that make an engagement unique.
 *
 * Deliberately not random. An assignment that is retried, replayed from the
 * chain, or made twice by two operators must land on one engagement — and a
 * random id would make each attempt a new employment relationship for the
 * same person and the same hours.
 */
export function engagementId(postingId: string, workerDid: DID): string {
  return `eng-${sha256Hex(`${postingId}|${workerDid}`).slice(0, 16)}`;
}

/** Has this worker been employed by this employer before? */
export function hasWorkedFor(engagements: Engagement[], workerDid: DID, employerDid: DID): boolean {
  return engagements.some(
    (e) =>
      e.workerDid === workerDid &&
      e.employerDid === employerDid &&
      e.status !== "cancelled" &&
      // a proposal nobody accepted never employed anybody, so it must not
      // suppress the payroll creation the real first engagement depends on
      e.acceptance.worker !== null,
  );
}

/**
 * Assemble the engagement, or say why not.
 *
 * Every refusal is collected rather than the first one thrown, because a
 * worker two items short of a complete pack and a venue with no payroll
 * connected are two different people's jobs to fix, and returning one at a
 * time means two round trips to learn both.
 *
 * The rate check is the one that cannot be relaxed. floorRateCents is the
 * DEAREST hour of the shift, not its blended average — a flat offer that
 * beats the average and underpays the midnight hour is exactly the shape
 * assessOffer() exists to catch, and passing the average in here would undo
 * that quietly.
 */
export function proposeEngagement(input: ProposeInput): ProposeResult {
  const {
    worker, pack, employer, postingId, shift, offeredRateCents, floorRateCents,
    loadings, blockReason, priorEngagements, at,
  } = input;

  const refusals: Refusal[] = [];

  if (!canEmploy(employer, at)) {
    for (const gap of profileGaps(employer, at)) {
      refusals.push({ code: "employer.not_ready", detail: gap.detail });
    }
  }

  const completeness = completenessOf(pack, at);
  if (!completeness.ok) {
    refusals.push({
      code: "pack.incomplete",
      detail: `${worker.name}'s pack is missing ${completeness.missing.length} item${completeness.missing.length === 1 ? "" : "s"}.`,
      missing: completeness.missing,
    });
  }

  if (!agreementCompatible(pack.agreementTemplateVersion, employer.agreementTemplateVersion)) {
    refusals.push({
      code: "agreement.version_mismatch",
      detail: `Signed on ${pack.agreementTemplateVersion}; this venue is on ${employer.agreementTemplateVersion}. The agreement needs re-signing.`,
    });
  }

  if (offeredRateCents < floorRateCents) {
    refusals.push({
      code: "rate.below_floor",
      detail: `The offer is below the award floor for at least one hour of this shift (floor ${floorRateCents}c/h, offered ${offeredRateCents}c/h).`,
    });
  }

  if (blockReason) {
    refusals.push({ code: "eligibility.blocked", detail: blockReason });
  }

  const classification = classificationFor(employer, shift.role);
  if (!classification) {
    refusals.push({
      code: "classification.missing",
      detail: `${employer.tradingName} has not classified "${shift.role}" under the award. A level cannot be guessed — it decides what this shift pays.`,
    });
  } else if (input.pricedLevel != null && rank(input.pricedLevel) < rank(classification.level)) {
    refusals.push({
      code: "classification.below_profile",
      detail: `This shift is priced at Level ${String(input.pricedLevel)}, but ${employer.tradingName} classifies "${shift.role}" at Level ${String(classification.level)}. A shift cannot pay under the venue's own classification for the job.`,
    });
  }

  if (refusals.length > 0 || !classification) return { ok: false, refusals };

  const employerDid = input.employerOfRecordDid ?? employer.did;

  return {
    ok: true,
    engagement: {
      id: engagementId(postingId, worker.did),
      workerDid: worker.did,
      employerDid,
      ...(input.employerOfRecordDid ? { hostDid: employer.did } : {}),
      postingId,
      shift,
      pay: {
        /* The level the money was worked out at, with the venue's own stream
           for the role. Naming the profile's level here instead would put a
           classification on the agreement that the rate does not belong to. */
        classification: { level: input.pricedLevel ?? classification.level, stream: classification.stream },
        baseRateCents: floorRateCents,
        offeredRateCents,
        loadings,
        superRate: SUPER_GUARANTEE_RATE,
      },
      employment: {
        firstEngagementWithEmployer: !hasWorkedFor(priorEngagements, worker.did, employerDid),
        claimsTaxFreeThreshold: claimsThresholdWith(pack, employerDid),
        agreementTemplateVersion: employer.agreementTemplateVersion,
      },
      packSnapshot: packSnapshot(pack, at),
      employerProfileHash: employerProfileHash(employer),
      proposedAt: at,
      acceptance: { worker: null, employer: null },
      releases: [],
      status: "proposed",
    },
  };
}

/* ---------- accepting ---------- */

export type Side = "worker" | "employer";

/**
 * Can this side still sign?
 *
 * Returns a reason rather than a boolean so the phone can say why a sheet it
 * has open is no longer signable — the shift was cancelled while it sat in
 * somebody's pocket, or the tap arrived twice.
 */
export function acceptRefusal(engagement: Engagement, side: Side): string | null {
  if (engagement.status === "cancelled") return "This engagement was cancelled.";
  if (engagement.acceptance[side]) return "Already signed.";
  if (engagement.status !== "proposed") return "This engagement has already been agreed by both sides.";
  return null;
}

/**
 * Record one side's signature.
 *
 * Pure, and used by the replay: the eventHash comes from the chain, so this
 * is only ever called with a hash that exists. Status flips to `accepted`
 * when both sides are in — the order they arrive in does not matter, which is
 * what lets the venue's pre-signature be recorded at proposal time and the
 * worker's tap arrive an hour later.
 */
export function acceptEngagement(
  engagement: Engagement,
  side: Side,
  acceptance: Acceptance,
): Engagement {
  if (engagement.acceptance[side]) return engagement;
  const next = {
    ...engagement,
    acceptance: { ...engagement.acceptance, [side]: acceptance },
  };
  const both = next.acceptance.worker && next.acceptance.employer;
  return both && next.status === "proposed" ? { ...next, status: "accepted" } : next;
}

/** True when both signatures are in and provisioning is the next thing owed. */
export function isFullySigned(e: Engagement): boolean {
  return e.acceptance.worker !== null && e.acceptance.employer !== null;
}

/* ---------- provisioning ---------- */

/**
 * The pack items this engagement will release, and to whom.
 *
 * Computed from the engagement rather than from what the connector happens to
 * ask for, so the accept sheet can show the worker the same list that
 * provision() will act on. A consent screen and a code path that disagree is
 * a consent screen that is decoration.
 *
 * A second engagement with the same employer releases nothing: the employee
 * already exists in that payroll, their TFN declaration is lodged, their fund
 * recorded. Sending it all again would be a re-disclosure with no purpose,
 * and it is the single biggest reason to hold employment once rather than per
 * booking.
 */
export function plannedReleases(engagement: Engagement): PackItemKind[] {
  return engagement.employment.firstEngagementWithEmployer ? [...FIRST_ENGAGEMENT_RELEASES] : [];
}

export function recordProvisioned(
  engagement: Engagement,
  input: { connector: PayrollConnectorId; released: PackItemKind[]; at: string },
): Engagement {
  const releases: Release[] = input.released.map((item) => ({
    item,
    toConnector: input.connector,
    at: input.at,
  }));
  return {
    ...engagement,
    // appended, not replaced: a re-provision after a partial failure adds what
    // it sent this time, and the worker's release log shows both attempts
    releases: [...engagement.releases, ...releases],
    status: "provisioned",
  };
}

export function recordWorked(engagement: Engagement): Engagement {
  return engagement.status === "provisioned" ? { ...engagement, status: "worked" } : engagement;
}

export function recordConfirmed(engagement: Engagement): Engagement {
  return engagement.status === "cancelled" ? engagement : { ...engagement, status: "confirmed" };
}

export function recordCancelled(engagement: Engagement, reason: string): Engagement {
  return { ...engagement, status: "cancelled", cancelledReason: reason };
}

/* ---------- what it costs ---------- */

export interface EngagementCost {
  hours: number;
  wagesCents: number;
  superCents: number;
  /** Covers' booking fee — the only money this company touches. */
  bookingFeeCents: number;
  totalCents: number;
}

/**
 * Covers' cut, as a rate.
 *
 * A booking fee on the wage, charged to the employer, and it is the whole
 * commercial model: Covers never holds wages, never becomes the employer of
 * record, and therefore never has a float, a labour-hire licence or a workers'
 * compensation policy of its own to get wrong.
 */
export const BOOKING_FEE_RATE = 0.09;

export function engagementCost(e: Engagement, paidHours?: number): EngagementCost {
  // PAID hours: the unpaid meal break is not worked and is not owed. Passing
  // the actual hours in overrides the plan, which is what a confirmation does
  const planned = (e.shift.endsAt - e.shift.startsAt - (e.shift.unpaidBreakSec ?? 0)) / 3600;
  const hours = paidHours ?? planned;
  const wagesCents = Math.round(e.pay.offeredRateCents * hours);
  const superCents = Math.round(wagesCents * e.pay.superRate);
  const bookingFeeCents = Math.round(wagesCents * BOOKING_FEE_RATE);
  return {
    hours,
    wagesCents,
    superCents,
    bookingFeeCents,
    totalCents: wagesCents + superCents + bookingFeeCents,
  };
}

/* ---------- audit events ---------- */

interface EngagementEventData {
  engagementId?: unknown;
  engagement?: unknown;
  side?: unknown;
  reason?: unknown;
  connector?: unknown;
  released?: unknown;
}

/** Does this event belong to an engagement at all? */
export function isEngagementEvent(e: AuditEvent): boolean {
  return e.type.startsWith("engagement.");
}

export function engagementIdOf(e: AuditEvent): string | null {
  const id = (e.data as EngagementEventData)?.engagementId;
  return typeof id === "string" ? id : null;
}

/**
 * The proposal event, carrying the engagement itself.
 *
 * The whole object in `data`, the same way `shift.posted` carries the posting:
 * the engagement is rebuilt by folding this log, so a proposal whose contents
 * were not recorded could not survive a reload — and an engagement that
 * cannot be reconstructed is not evidence of anything.
 */
export function proposedEvent(e: Engagement, actor: string, actorDid?: DID): NewAuditEvent {
  return {
    type: "engagement.proposed",
    at: e.proposedAt,
    actor,
    ...(actorDid ? { actorDid } : {}),
    subject: e.workerDid,
    summary: `Engagement proposed — ${e.shift.role} on ${calendarDate(e.shift.date)}`,
    data: { engagementId: e.id, engagement: e as unknown as Record<string, unknown> },
  };
}

export function acceptedEvent(
  e: Engagement,
  side: Side,
  input: { at: string; actor: string; actorDid?: DID; byDid?: DID },
): NewAuditEvent {
  return {
    type: "engagement.accepted",
    at: input.at,
    actor: input.actor,
    ...(input.actorDid ? { actorDid: input.actorDid } : {}),
    subject: e.workerDid,
    summary:
      side === "worker"
        ? `${input.actor} accepted the ${e.shift.role} engagement`
        : `Employer countersigned the ${e.shift.role} engagement`,
    data: {
      engagementId: e.id,
      side,
      ...(input.byDid ? { byDid: input.byDid } : {}),
      role: e.shift.role,
      date: e.shift.date,
    },
  };
}

export function provisionedEvent(
  e: Engagement,
  input: { at: string; actor: string; connector: PayrollConnectorId; released: PackItemKind[]; externalId?: string },
): NewAuditEvent {
  return {
    type: "engagement.provisioned",
    at: input.at,
    actor: input.actor,
    subject: e.workerDid,
    summary: input.released.length
      ? `Payroll provisioned — ${input.released.length} pack item${input.released.length === 1 ? "" : "s"} released to ${input.connector}`
      : `Shift added to the roster — nothing further released to ${input.connector}`,
    data: {
      engagementId: e.id,
      connector: input.connector,
      // kinds, never payloads. The chain says what was released and to whom;
      // what was in it stays in the vault
      released: input.released,
      ...(input.externalId ? { externalId: input.externalId } : {}),
    },
  };
}

export function confirmedEvent(
  e: Engagement,
  input: { at: string; actor: string; actorDid?: DID; hours: number; breaks: number },
): NewAuditEvent {
  const cost = engagementCost(e, input.hours);
  return {
    type: "engagement.confirmed",
    at: input.at,
    actor: input.actor,
    ...(input.actorDid ? { actorDid: input.actorDid } : {}),
    subject: e.workerDid,
    summary: `Hours confirmed — ${input.hours}h on ${e.shift.role}`,
    data: {
      engagementId: e.id,
      hours: input.hours,
      breaks: input.breaks,
      wagesCents: cost.wagesCents,
      superCents: cost.superCents,
      bookingFeeCents: cost.bookingFeeCents,
    },
  };
}

export function cancelledEvent(
  e: Engagement,
  input: { at: string; actor: string; actorDid?: DID; reason: string },
): NewAuditEvent {
  return {
    type: "engagement.cancelled",
    at: input.at,
    actor: input.actor,
    ...(input.actorDid ? { actorDid: input.actorDid } : {}),
    subject: e.workerDid,
    summary: `Engagement cancelled — ${e.shift.role} on ${calendarDate(e.shift.date)}`,
    data: { engagementId: e.id, reason: input.reason },
  };
}

/* ---------- replay ---------- */

function applyOne(engagements: Engagement[], ev: AuditEvent): Engagement[] {
  if (ev.type === "engagement.proposed") {
    const e = (ev.data as EngagementEventData).engagement as Engagement | undefined;
    // an unreadable proposal costs that engagement, not the whole fold
    if (!e || typeof e.id !== "string") return engagements;
    return engagements.some((x) => x.id === e.id) ? engagements : [...engagements, e];
  }

  const id = engagementIdOf(ev);
  if (!id) return engagements;

  return engagements.map((e) => {
    if (e.id !== id) return e;
    const data = ev.data as EngagementEventData;

    switch (ev.type) {
      case "engagement.accepted": {
        const side = data.side === "employer" ? "employer" : "worker";
        return acceptEngagement(e, side, {
          at: ev.at,
          // the event's own position in the chain IS the evidence of the
          // signature; nothing else needs to be stored to prove it
          eventHash: ev.hash,
          ...(typeof (data as { byDid?: unknown }).byDid === "string"
            ? { byDid: (data as { byDid: string }).byDid }
            : ev.actorDid
              ? { byDid: ev.actorDid }
              : {}),
        });
      }
      case "engagement.provisioned":
        return recordProvisioned(e, {
          connector: (data.connector as PayrollConnectorId) ?? "mock",
          released: Array.isArray(data.released) ? (data.released as PackItemKind[]) : [],
          at: ev.at,
        });
      case "engagement.confirmed":
        return recordConfirmed(e);
      case "engagement.cancelled":
        return recordCancelled(e, typeof data.reason === "string" ? data.reason : "Cancelled");
      default:
        return e;
    }
  });
}

/**
 * Every engagement the chain describes, in the order they were proposed.
 *
 * A function of the log and nothing else, so a reload is lossless and two
 * readers of the same chain cannot disagree about who is employed.
 */
export function replayEngagements(log: AuditEvent[]): Engagement[] {
  return log.filter(isEngagementEvent).reduce<Engagement[]>(applyOne, []);
}

export function engagementsFor(log: AuditEvent[], workerDid: DID): Engagement[] {
  return replayEngagements(log).filter((e) => e.workerDid === workerDid);
}
