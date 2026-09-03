/* ============================================================
   The verifier is the documented swap-point: v2 replaces
   LocalCredentialVerifier with one that resolves did:web, checks
   an SD-JWT signature and a status list. These tests pin the
   contract the engine relies on, so the swap can be judged
   against something concrete.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { LocalCredentialVerifier, type CredentialVerifier } from "../lib/idara/verifier";
import { decide } from "../lib/idara/engine";
import type { Credential, Identity, Site } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

const base: Credential = {
  id: "vc-v0",
  type: "first_aid",
  subject: "did:web:idara.app:w:test-worker",
  issuer: "did:web:trainsafe.rto.au",
  issuedAt: "2023-01-15",
  expiresAt: "2026-01-01",
  status: "valid",
  claims: {},
};

describe("LocalCredentialVerifier", () => {
  it("passes a current credential", () => {
    expect(verifier.verify(base, AT).status).toBe("valid");
  });

  it("passes a non-expiring credential", () => {
    expect(verifier.verify({ ...base, expiresAt: null }, AT).status).toBe("valid");
  });

  it("reports expiry only once the date has passed", () => {
    expect(verifier.verify({ ...base, expiresAt: "2024-05-15" }, AT).status).toBe("expired");
    expect(verifier.verify({ ...base, expiresAt: AT }, AT).status).toBe("valid");
    expect(verifier.verify({ ...base, expiresAt: "2024-05-17" }, AT).status).toBe("valid");
  });

  it("honours revocation and suspension ahead of expiry", () => {
    expect(verifier.verify({ ...base, status: "revoked" }, AT).status).toBe("revoked");
    expect(verifier.verify({ ...base, status: "suspended" }, AT).status).toBe("suspended");
    // a revoked credential stays revoked even if it is also in date
    expect(
      verifier.verify({ ...base, status: "revoked", expiresAt: "2099-01-01" }, AT).status,
    ).toBe("revoked");
  });

  it("always returns a human-readable detail string", () => {
    for (const s of ["valid", "revoked", "suspended"] as const) {
      expect(verifier.verify({ ...base, status: s }, AT).detail.length).toBeGreaterThan(0);
    }
    expect(verifier.verify({ ...base, expiresAt: "2020-01-01" }, AT).detail).toContain("2020-01-01");
  });
});

describe("the verifier seam", () => {
  const person: Identity = {
    did: base.subject,
    name: "Test Worker",
    role: "Bartender",
    org: "Brightwater Hospitality",
  };
  const site: Site = {
    id: "s-test",
    name: "Test Site",
    region: "Victoria",
    kind: "venue",
    requires: [{ type: "first_aid" }],
  };

  it("lets the engine's verdict be driven entirely by the injected verifier", () => {
    // a stub that rejects everything stands in for a failing signature check
    const rejectAll: CredentialVerifier = {
      verify: () => ({ status: "revoked", detail: "Issuer signature invalid." }),
    };

    const args = { person, credentials: [base], action: "be_rostered" as const, site, at: AT };

    expect(decide({ ...args, verifier }).allowed).toBe(true);

    const denied = decide({ ...args, verifier: rejectAll });
    expect(denied.allowed).toBe(false);
    expect(denied.reasons[0].detail).toContain("Issuer signature invalid.");
  });

  it("is consulted for every required credential, not just the first", () => {
    const seen: string[] = [];
    const spy: CredentialVerifier = {
      verify: (c) => {
        seen.push(c.type);
        return { status: "valid", detail: "ok" };
      },
    };
    decide({
      person,
      credentials: [base, { ...base, id: "vc-v1", type: "rsa", expiresAt: null }],
      action: "be_rostered",
      site: { ...site, requires: [{ type: "first_aid" }, { type: "rsa" }] },
      at: AT,
      verifier: spy,
    });
    expect(seen).toEqual(["first_aid", "rsa"]);
  });
});
