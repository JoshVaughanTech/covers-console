/* ============================================================
   Idara Core — credential verification seam
   This interface is the single point where "is this credential
   real and current?" is answered. The engine depends ONLY on the
   interface, so the implementation can grow without any module
   change.

   v1  LocalCredentialVerifier — checks stored status + expiry.
   v2  W3cCredentialVerifier — resolve issuer did:web, verify the
       SD-JWT signature, check the Bitstring Status List, and
       validate holder binding. Drops in here.
   ============================================================ */

import type { Credential, CredentialStatus, ISODate } from "./types";
import { isBeforeDay } from "./dates";

export interface VerificationResult {
  /** effective status of the credential at the decision time. */
  status: CredentialStatus;
  detail: string;
}

export interface CredentialVerifier {
  verify(cred: Credential, at: ISODate): VerificationResult;
}

/**
 * Trust-by-record verifier: honours the stored status and expiry.
 * No cryptography yet — but the contract is identical to the real
 * VC verifier, so swapping it in changes nothing upstream.
 */
export class LocalCredentialVerifier implements CredentialVerifier {
  verify(cred: Credential, at: ISODate): VerificationResult {
    if (cred.status === "revoked") {
      return { status: "revoked", detail: "Credential has been revoked." };
    }
    if (cred.status === "suspended") {
      return { status: "suspended", detail: "Credential is suspended." };
    }
    // compared by day, not as raw strings: `at` may arrive as a full timestamp,
    // which sorts after the bare expiry date and would read as expired on the
    // very day the credential is still good
    if (cred.expiresAt && isBeforeDay(cred.expiresAt, at)) {
      return { status: "expired", detail: `Expired ${cred.expiresAt}.` };
    }
    return { status: "valid", detail: "Verified and current." };
  }
}
