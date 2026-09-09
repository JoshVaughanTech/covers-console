/* ============================================================
   One posting as one worker sees it.

   This exists because a shift is now on two screens. The board
   lists it and the detail screen at /m/shifts/[id] renders it on
   its own, and both have to be answering with the same shift —
   the same rate, the same floor, the same reason it is blocked,
   the same claimable flag the claim endpoint will enforce.

   This repo has paid for the alternative twice. A manager's queue
   showed one person twice while the worker saw one claim. A card
   read the real start time while the sheet beside it read the day
   string a manager had typed, so one shift showed "Sat, 5 Sept"
   above "Sat, 18 May". Both were two code paths describing one
   fact and quietly disagreeing, and neither was caught by a test —
   they were caught by looking.

   So the mapping is written once here and both routes call it.
   Two screens can differ in what they SHOW; they cannot differ in
   what they were told.
   ============================================================ */
import type { Credential, Identity, ISODate, Site } from "@/lib/idara/types";
import type { CredentialVerifier } from "@/lib/idara/verifier";
import { claimBlockReason } from "./gate";
import { describePay } from "./pay";
import { standingFor } from "./review";
import { seatsLeft, type ShiftPosting } from "./types";

export interface ShiftViewInput {
  posting: ShiftPosting;
  person: Identity | undefined;
  /** the caller, for standing and roster checks. */
  did: string;
  /** the site the posting names; undefined when it cannot be resolved. */
  site: Site | undefined;
  /** this person's credentials — the caller filters, so this stays pure. */
  credentials: Credential[];
  at: ISODate;
  verifier: CredentialVerifier;
}

/** What a phone is told about one shift. Every figure arrives computed. */
export interface WorkerShiftView {
  id: string;
  role: string;
  functionName: string;
  client: string | null;
  siteId: string;
  siteName: string;
  day: string;
  window: string;
  seats: number;
  seatsLeft: number;
  duties: string[];
  requires: { skill: string; level: string }[];
  /** null until the venue publishes a rate. */
  pay: ReturnType<typeof describePay>;
  status: string;
  blockReason: string | null;
  standing: { standing: string; at: string; reason: string | null } | null;
  /** already on the roster for this shift, claim or no claim. */
  rostered: boolean;
  claimable: boolean;
}

export function shiftViewFor(input: ShiftViewInput): WorkerShiftView {
  const { posting: p, person, did, site, credentials, at, verifier } = input;

  const blockReason = claimBlockReason({ posting: p, person, site, credentials, at, verifier });
  const standing = standingFor(p, did, blockReason);
  const left = seatsLeft(p);

  /* Being rostered is not a standing. standingFor() answers about CLAIMS, and
     someone the manager assigned directly never made one — so without this the
     board offers a worker a shift they are already on, and the claim endpoint
     refuses it as a duplicate. The gate holds; the screen is what lies. */
  const rostered = p.assigned.includes(did);

  return {
    id: p.id,
    role: p.role,
    functionName: p.functionName,
    client: p.client ?? null,
    siteId: p.siteId,
    siteName: site?.name ?? p.siteId,
    day: p.day,
    window: p.window,
    seats: p.seats,
    seatsLeft: left,
    duties: p.duties,
    requires: p.requires,
    /* What it pays, and how that sits against the award — computed here rather
       than sent as a number to render. The phone showing "above award" has to
       be the same arithmetic that stopped the venue posting below it, or the
       badge is decoration. null when no rate is set, which the screen says
       rather than filling in. */
    pay: describePay(p),
    status: p.status,
    blockReason,
    standing: standing ? { standing: standing.standing, at: standing.at, reason: standing.reason ?? null } : null,
    rostered,
    // one flag the phone can trust for the primary action, computed the same
    // way the claim endpoint will decide it
    claimable: !blockReason && left > 0 && p.status === "open" && !standing && !rostered,
  };
}

/**
 * Whether a posting is an offer at all.
 *
 * Drafts are the manager's working copy. The board filters them out of a list;
 * the detail route has to refuse them by id, or a draft rate a venue is still
 * arguing about is one guessed URL away from the person it would underpay.
 */
export const isOffered = (p: ShiftPosting) => p.status !== "draft";
