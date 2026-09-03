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

/** Calendar date as "YYYY-MM-DD" so string comparison is chronological. */
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
  /** a manager assigning someone to an open shift (Open Shifts). */
  | "shift.assigned"
  /** a worker putting their hand up for an open shift. A request, not a
      roster change — the assignment that may follow is a separate event. */
  | "shift.claimed"
  /**
   * a manager opening a shift to be claimed. Carries the posting itself in
   * `data`, because the board is rebuilt by folding this log over the seed —
   * a posting whose creation went unrecorded could not survive a reload.
   */
  | "shift.posted";

export interface AuditEvent {
  /** monotonic sequence number, 0-based. */
  seq: number;
  id: string;
  type: AuditEventType;
  at: ISODate;
  /** who triggered it — a manager, or "system". */
  actor: string;
  subject?: DID;
  summary: string;
  data: Record<string, unknown>;
  /** hash of the previous event, linking the chain. */
  prevHash: string;
  /** digest over (prevHash + canonical event body). */
  hash: string;
}
