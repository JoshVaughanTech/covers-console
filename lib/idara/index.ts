/* ============================================================
   Idara Core — public surface
   Modules import from "@/lib/idara" only. Implementation files
   (engine, verifier, audit, seed) stay internal so the trust
   layer can evolve without churn in the modules above it.
   ============================================================ */

export * from "./types";
export { CREDENTIAL_TYPES, CREDENTIAL_ORDER, BASE_REQUIREMENTS } from "./hospitality";
export type { CredentialTypeMeta } from "./hospitality";
export { decide, summarise, EXPIRY_WARN_DAYS } from "./engine";
export type { DecideInput } from "./engine";
export { LocalCredentialVerifier } from "./verifier";
export type { CredentialVerifier, VerificationResult } from "./verifier";
export { appendEvent, verifyChain, shortHash, GENESIS_HASH, HASH_ALGORITHM } from "./audit";
export { sha256Hex, canonicalJson } from "./hash";
export type { NewAuditEvent } from "./audit";
export { IdaraProvider, useIdara } from "./provider";
export type { PublishResult } from "./provider";
export { TODAY, SITES, WORKERS, CREDENTIALS, ISSUERS } from "./seed";
