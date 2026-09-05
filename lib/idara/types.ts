/* ============================================================
   Idara Core — domain types
   The trust/identity layer that sits underneath every module.
   Modules (Scheduling, Compliance, Time Tracking…) never make
   eligibility calls themselves — they ask the engine, which
   verifies credentials and emits an audit event.

   These types are deliberately vertical-agnostic; the hospitality
   credential taxonomy lives in hospitality.ts.

   Note on `Site`: it covers both a fixed venue (a pub, a tavern) and
   an off-premise catering operation (a wedding, a corporate lunch).
   Both are places with their own eligibility rules, which is all the
   engine needs them to be.
   ============================================================ */

/** A Decentralised Identifier. v1 issues did:web; opaque at the type level. */
export type DID = string;

/**
 * A calendar date as "YYYY-MM-DD", so string comparison is chronological.
 *
 * Some events legitimately carry a moment rather than a day — a break sent at
 * 22:10 is not the same fact as a break "on Thursday" — and those send a full
 * ISO timestamp in this field. The type cannot express the difference, so
 * anything comparing one of these for chronology must narrow it first with
 * `calendarDate()`. Comparing a timestamp against a bare date as raw strings
 * makes the timestamp sort after the date, which reads as "the day is over"
 * on the day itself.
 */
export type ISODate = string;

/** Effective state of a credential (mirrors a Bitstring Status List entry). */
export type CredentialStatus = "valid" | "expired" | "revoked" | "suspended";

/** Hospitality credential taxonomy keys — metadata in hospitality.ts. */
export type CredentialTypeId =
  | "rsa"
  | "rsg"
  | "food_safety_supervisor"
  | "food_handling"
  | "allergen_management"
  | "first_aid"
  | "site_induction"
  | "wwcc";

/**
 * What a person actually does on shift. Requirements bind to these rather
 * than to job titles, because titles drift between venues ("Bartender",
 * "Bar Attendant") while the duty that triggers a legal obligation does not.
 * The role → function mapping is vertical-specific and lives in hospitality.ts.
 */
export type WorkFunction =
  | "serve_alcohol"
  | "handle_food"
  | "gaming"
  | "supervise";

/** A person known to Idara (bar staff, chef, duty manager, casual…). */
export interface Identity {
  did: DID;
  name: string;
  role: string;
  org: string;
}

/**
 * A verifiable credential. In v1 these are records Idara holds custodially;
 * the shape already carries everything a W3C VC needs (issuer, subject,
 * validity window, status) so the verifier can be upgraded in place.
 */
export interface Credential {
  id: string;
  type: CredentialTypeId;
  subject: DID; // the worker the credential is about
  issuer: DID; // who attested it — a regulator, an RTO, or Idara itself
  issuedAt: ISODate;
  expiresAt: ISODate | null; // null = non-expiring
  status: CredentialStatus;
  /** type-specific claims: licence number, class, scoped site id, … */
  claims: Record<string, string>;
}

/** One credential a site/action demands before a person is eligible. */
export interface CredentialRequirement {
  type: CredentialTypeId;
  /** true → the credential must be scoped to this exact site (claims.siteId). */
  siteScoped?: boolean;
  /**
   * When set, the requirement binds only to people who perform at least one
   * of these functions — an RSA is demanded of whoever serves alcohol, not of
   * the kitchen. Omitted means it binds to everyone rostered.
   *
   * A role the vertical pack doesn't recognise is treated as performing every
   * function, so an unmapped job title can never quietly skip a requirement.
   */
  appliesTo?: WorkFunction[];
}

/**
 * A requirement the roster satisfies collectively rather than person by
 * person. A venue must have a nominated Food Safety Supervisor on shift; it
 * does not need every hand in the kitchen to hold the ticket. Expressing this
 * as a per-person rule would either over-demand (everyone must hold it) or
 * under-demand (nobody need hold it) — neither is the law.
 */
export interface RosterRequirement {
  type: CredentialTypeId;
  /** how many rostered people must hold it. Usually 1. */
  minHolders: number;
  /** true → the credential must be scoped to this exact site. */
  siteScoped?: boolean;
}

/** A physical place with its own eligibility rules. */
export type SiteKind = "venue" | "catering";

export interface Site {
  id: string;
  name: string;
  region: string;
  /**
   * A fixed venue trades on a standing weekly roster; a catering operation
   * exists only for its events. The schedule reads this to decide its shape.
   *
   * Required rather than optional: an optional field would let a site exist in
   * neither mode and force every consumer to guess a default. Whether the
   * operator is a caterer is derived from these values, never stored
   * separately, so the two can never disagree.
   */
  kind: SiteKind;
  /** checked against each person individually. */
  requires: CredentialRequirement[];
  /** checked against the roster as a whole; see RosterRequirement. */
  requiresOnRoster?: RosterRequirement[];
}

/**
 * Result of one roster-level requirement.
 *
 * Only people who are themselves eligible count as holders: a supervisor
 * whose own induction has lapsed can't be rostered, so they cannot discharge
 * the venue's obligation on paper either.
 */
export interface CoverageCheck {
  type: CredentialTypeId;
  required: number;
  holders: { did: DID; name: string }[];
  met: boolean;
  detail: string;
}

/** Things a person can be checked for. Recorded on every decision. */
export type Action =
  | "be_rostered"
  | "access_site"
  | "clock_in"
  | "sign_off"
  | "view_job_room";

/**
 * Per-check result inside a decision. `n/a` records a requirement that was
 * considered and found not to bind to this person — kept in the trail rather
 * than dropped, so "why wasn't the chef's RSA checked?" has a written answer.
 */
export type CheckOutcome = "pass" | "warn" | "fail" | "n/a";

export interface DecisionReason {
  /** machine code, e.g. "credential.missing", "credential.expired". */
  code: string;
  outcome: CheckOutcome;
  credentialType?: CredentialTypeId;
  detail: string;
  /**
   * Which of the person's shifts this applies to — set only when it does not
   * apply to all of them. "Blocked" is much less useful to a manager than
   * "blocked on Saturday, fine the rest of the week".
   */
  shifts?: string[];
}

export interface DecisionContext {
  subject: DID;
  subjectName: string;
  action: Action;
  siteId: string;
  siteName: string;
  at: ISODate;
}

/** The single primitive every module consumes. */
export interface Decision {
  allowed: boolean;
  /** count of non-blocking warnings (e.g. expiring soon). */
  warnings: number;
  reasons: DecisionReason[];
  context: DecisionContext;
}

/* ---------- audit log (append-only, hash-chained) ---------- */

export type AuditEventType =
  | "decision"
  | "credential.issued"
  | "credential.revoked"
  | "roster.published"
  /** a supervisor acting on an award break entitlement (Break Compliance). */
  | "break.decision"
  /**
   * Whether that decision reached Connecteam's timesheet. Separate events
   * rather than a field on the decision: resolving pending by rewriting the
   * original would break the chain, which is the point of having one.
   */
  | "break.pushed"
  | "break.push_failed"
  /**
   * A report handed to payroll. Carries the sha-256 of exactly what was
   * delivered, so a later dispute is about a specific document rather than
   * about whether a report was sent.
   */
  | "report.delivered"
  /**
   * A sign-in code was minted for somebody — the cause, where auth.signed_in
   * is the effect, and the two are not always the same person's doing.
   *
   * A worker requesting their own code and an operator minting one for them
   * are different facts, told apart by the actor: "system" for the first,
   * because nobody authorised it, and the operator for the second. A disputed
   * claim turns on which of those happened, and only this event can say.
   *
   * It closes attribution, not impersonation. While the console has no login
   * of its own, "an operator minted this" means whoever could open the
   * console — which is worth recording precisely because it is not yet worth
   * trusting.
   *
   * Carries the grant id, never the code nor a hash of it. The audit screen is
   * readable by anyone who can reach it, so a secret in the chain would be a
   * credential published to the surface it protects.
   */
  | "auth.code_issued"
  /**
   * Somebody proved who they were and got a session. The fact belongs in the
   * chain because a claim later disputed is read alongside it; the secret
   * that let them in does not, and never leaves lib/store/auth.ts.
   */
  | "auth.signed_in"
  /**
   * A shift was put in front of a set of people. The cause of a claim, where
   * shift.claimed is the effect, and the answer to "I was never told about
   * that shift" — which is only answerable if the offer was recorded when it
   * happened, rather than reconstructed afterwards from who was eligible.
   *
   * Carries the audience as dids and the refusals as counts, never as names.
   * "Six would qualify with a current RSA" is what a manager can act on;
   * naming who is short of what turns a posting record into a roster of
   * everybody's credential problems.
   */
  | "shift.offered"
  /** a manager assigning someone to an open shift (Open Shifts). */
  | "shift.assigned"
  /** a worker putting their hand up for an open shift. A request, not a
      roster change — the assignment that may follow is a separate event. */
  | "shift.claimed"
  /**
   * a worker taking that request back down, before anyone acted on it.
   *
   * Recorded rather than erased. The claim leaves the posting so nobody is
   * held in a queue they have left, which means the chain is the only place
   * the request ever existed — and "I did apply for that" has to stay
   * answerable after the applying stops being visible.
   */
  | "shift.withdrawn"
  /**
   * a manager opening a shift to be claimed. Carries the posting itself in
   * `data`, because the board is rebuilt by folding this log over the seed —
   * a posting whose creation went unrecorded could not survive a reload.
   */
  | "shift.posted"
  /**
   * An employment offer assembled from a worker's pack and a venue's employer
   * profile: this worker, this venue, this shift, this rate. Carries the
   * engagement itself in `data` for the same reason shift.posted carries the
   * posting — engagements are rebuilt by folding this log, and one whose terms
   * went unrecorded could not be reconstructed, which is the only thing that
   * makes it evidence rather than an assertion.
   */
  | "engagement.proposed"
  /**
   * One side signing. `data.side` says which, because the two are different
   * facts with different actors: the worker taps Accept on their own phone,
   * where the venue signed its half in advance and the assignment is the act.
   *
   * The event's own hash is the signature. Nothing else is stored to prove
   * somebody agreed — the chain position is the evidence, and it is checkable
   * by an auditor who does not trust this database.
   */
  | "engagement.accepted"
  /**
   * The payroll has what it needs: the employee exists, the TFN declaration is
   * lodged, the fund is recorded, the statements are delivered.
   *
   * `data.released` carries pack item KINDS and never payloads. "A TFN was
   * released to Xero on Friday" is the fact an auditor and the worker both
   * need; the number itself has no business in a log that a screen renders.
   */
  | "engagement.provisioned"
  /**
   * What was actually worked, settled and priced.
   *
   * The hours come from the time clock and never from a request — see
   * app/api/engagements/confirm. `data.via` says whether the venue agreed the
   * timesheet or whether the 48-hour window closed on it, because those are
   * different facts and only one is anybody's affirmation.
   *
   * Carries the wages, super and booking fee it implies rather than leaving
   * them to be recomputed: this is what Covers invoices against, and what was
   * charged is a fact about a moment.
   */
  | "engagement.confirmed"
  /* ---- declared, and nothing writes them yet ----

     The four below are part of the model §5 and §8 of
     docs/plans/2026-09-05-one-tap-employment-design.md describe, and the
     replay in engagement.ts already folds them, so an event of any of these
     types would be handled correctly today. Nothing emits one.

     Stated here rather than only in the design note, because the union and
     eventMeta() in app/(console)/audit/page.tsx are what a reader consults —
     and between them they would say pack verification is supported. A type
     surface that promises what the system cannot do is the shape this repo
     has spent two days cataloguing: it looks like coverage because every
     check of it passes.

     Each names what it is waiting on. When you write the emitter, delete its
     line — engagement.confirmed was on this list until the time-clock read
     was written, and moving it out was part of that change rather than a
     tidy-up afterwards. */

  /**
   * NO WRITER YET. cancelledEvent() exists and is called by nothing. There is
   * no screen on either side that cancels an engagement — a venue standing
   * somebody down and a worker pulling out are different facts with different
   * consequences, and neither is designed.
   */
  | "engagement.cancelled"
  /**
   * A pack item verified — the moment "verified, not self-declared" becomes true.
   *
   * NO WRITER YET, and no builder either. The packs are seeded; §10 names KYC
   * provider selection (Stripe Identity / Onfido / GreenID) as an unresolved
   * P0, and this is the event its callback would write.
   */
  | "pack.item_verified"
  /**
   * A pack item withdrawn or revoked, by its issuer or by the worker.
   *
   * NO WRITER YET, and no builder either. Same blocker as pack.item_verified:
   * revocation arrives from the issuer that did the verifying.
   */
  | "pack.item_revoked"
  /**
   * A casual working a regular pattern with one venue is approaching the point
   * where the employer owes them a conversion offer.
   *
   * Recorded rather than ignored: it is the employer's obligation, and the
   * venue has just delegated its record-keeping to us. Flagged, never decided
   * — whether the pattern is regular and systematic is a judgement, and this
   * says only that it is time somebody made it.
   *
   * NO WRITER YET. conversionSignals() computes the signal live and
   * /settings/employer renders it, so the venue does see it; conversionEvent()
   * exists and only a test calls it. Putting it ON THE CHAIN needs something
   * that runs on a schedule and writes each signal once — and "once" is the
   * hard half, because a signal that re-fires daily is thirty events saying
   * the same thing.
   */
  | "conversion.flagged";

export interface AuditEvent {
  /** monotonic sequence number, 0-based. */
  seq: number;
  id: string;
  type: AuditEventType;
  at: ISODate;
  /** who triggered it, for display — a person's name, or "system". */
  actor: string;
  /**
   * Who triggered it, identified. A display name is neither unique nor stable
   * across a rename, so a log that answers "who did this" only by name answers
   * it weakly — two people called Sam Taylor are indistinguishable in it.
   *
   * Optional because "system" has no DID and pre-existing events have none.
   * It must be `undefined` rather than `null` when absent: canonicalJson drops
   * undefined keys and keeps null ones, so a null here would change the digest
   * of every event written before this field existed and read as tampering.
   */
  actorDid?: DID;
  /** who it was about. */
  subject?: DID;
  summary: string;
  data: Record<string, unknown>;
  /** hash of the previous event, linking the chain. */
  prevHash: string;
  /** digest over (prevHash + canonical event body). */
  hash: string;
}
