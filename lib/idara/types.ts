/* ============================================================
   Idara Core — domain types
   The trust/identity layer that sits underneath every module.
   Modules (Scheduling, Compliance, Time Tracking…) never make
   eligibility calls themselves — they ask the engine, which
   verifies credentials and emits an audit event.

   These types are deliberately vertical-agnostic; the construction
   credential taxonomy lives in construction.ts.
   ============================================================ */

/** A Decentralised Identifier. v1 issues did:web; opaque at the type level. */
export type DID = string;

/** Calendar date as "YYYY-MM-DD" so string comparison is chronological. */
export type ISODate = string;

/** Effective state of a credential (mirrors a Bitstring Status List entry). */
export type CredentialStatus = "valid" | "expired" | "revoked" | "suspended";

/** Construction credential taxonomy keys — metadata in construction.ts. */
export type CredentialTypeId =
  | "white_card"
  | "high_risk_work"
  | "ewp_licence"
  | "working_at_heights"
  | "first_aid"
  | "site_induction"
  | "swms_ack";

/** A person known to Idara (worker, supervisor, contractor…). */
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
  expiresAt: ISODate | null; // null = non-expiring (e.g. White Card)
  status: CredentialStatus;
  /** type-specific claims: licence number, class, scoped site id, … */
  claims: Record<string, string>;
}

/** One credential a site/action demands before a person is eligible. */
export interface CredentialRequirement {
  type: CredentialTypeId;
  /** true → the credential must be scoped to this exact site (claims.siteId). */
  siteScoped?: boolean;
}

/** A physical place with its own eligibility rules. */
export interface Site {
  id: string;
  name: string;
  region: string;
  requires: CredentialRequirement[];
}

/** Things a person can be checked for. Recorded on every decision. */
export type Action =
  | "be_rostered"
  | "access_site"
  | "clock_in"
  | "sign_off"
  | "view_job_room";

/** Per-check result inside a decision. */
export type CheckOutcome = "pass" | "warn" | "fail";

export interface DecisionReason {
  /** machine code, e.g. "credential.missing", "credential.expired". */
  code: string;
  outcome: CheckOutcome;
  credentialType?: CredentialTypeId;
  detail: string;
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
  | "roster.published";

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
