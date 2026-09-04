/* ============================================================
   Idara Core — public surface
   Modules import from "@/lib/idara" only. Implementation files
   (engine, verifier, audit, seed) stay internal so the trust
   layer can evolve without churn in the modules above it.
   ============================================================ */

export * from "./types";
export {
  CREDENTIAL_TYPES,
  CREDENTIAL_ORDER,
  BASE_REQUIREMENTS,
  ROLE_FUNCTIONS,
  ALL_WORK_FUNCTIONS,
  functionsForRole,
} from "./hospitality";
export type { CredentialTypeMeta } from "./hospitality";
export { shiftAssignment, checkDuties, roleCarriesNoDuties } from "./duties";
export type { DutiedShift } from "./duties";
export {
  decide,
  decideMember,
  decideRoster,
  summarise,
  summariseCoverage,
  EXPIRY_WARN_DAYS,
} from "./engine";
export type {
  DecideInput,
  DecideMemberInput,
  DecideRosterInput,
  RosterDecision,
  RosterMember,
  ShiftAssignment,
} from "./engine";
export { LocalCredentialVerifier } from "./verifier";
export type { CredentialVerifier, VerificationResult } from "./verifier";
export { appendEvent, verifyChain, shortHash, GENESIS_HASH, HASH_ALGORITHM } from "./audit";
export { sha256Hex, canonicalJson } from "./hash";
export { calendarDate, isBeforeDay } from "./dates";
export { standingOf, daysBetween } from "./standing";
export type { Standing, StandingState, HeldCredential, HeldState } from "./standing";
export type { NewAuditEvent } from "./audit";
export { IdaraProvider, useIdara } from "./provider";
export type { PublishResult, RosterAssignment } from "./provider";
export { TODAY, SITES, WORKERS, CREDENTIALS, ISSUERS, CONSOLE_OPERATOR } from "./seed";
