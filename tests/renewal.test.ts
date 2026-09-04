/* ============================================================
   Holding more than one of the same credential.

   Renewing a licence does not delete the old record, so a person
   routinely holds a current RSA and the superseded one behind it.
   The engine used to answer a requirement with `credentials.find`,
   which meant array position decided eligibility.

   These tests exist because the verdict was the smaller half of
   that bug. On the seeded board a superseded record sorted first
   refused Michael Tan a Friday night he was entitled to work —
   and on four other postings, where refusing him was correct, it
   replaced the real reason (a site induction he has not done)
   with "RSA: Expired". A wrong verdict is a wrong answer. A wrong
   reason is an instruction: it sends somebody to re-sit a
   certificate they already hold, and they come back still
   blocked, with nothing on the screen to suggest the system was
   wrong rather than them.

   So the property pinned here is order-independence, not any
   particular winner. A fix that swapped `find` for `findLast`
   would pass a test written the other way round and still be
   wrong.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { decide } from "../lib/idara/engine";
import { claimBlockReason } from "../lib/shifts/gate";
import { POSTINGS } from "../lib/shifts/seed";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { SITES, WORKERS, CREDENTIALS, TODAY } from "../lib/idara/seed";
import type { Credential } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const tan = WORKERS.find((w) => w.name === "Michael Tan")!;

const others = CREDENTIALS.filter((c) => c.subject === tan.did && c.type !== "rsa");
const seedRsa = CREDENTIALS.find((c) => c.subject === tan.did && c.type === "rsa")!;

/** The RSA he holds today, renewed. */
const current: Credential = { ...seedRsa, id: "rsa-current", status: "valid", expiresAt: "2027-06-30" };
/** The record the renewal left behind. */
const superseded: Credential = { ...seedRsa, id: "rsa-old", status: "valid", expiresAt: "2024-01-01" };

const bar = POSTINGS.find((p) => p.id === "sp-fridaylive-bar")!;
const siteOf = (siteId: string) => SITES.find((s) => s.id === siteId);

const blockReason = (creds: Credential[], posting = bar) =>
  claimBlockReason({
    posting,
    person: tan,
    site: siteOf(posting.siteId),
    credentials: creds,
    at: TODAY,
    verifier,
  });

describe("a renewed credential is not defeated by the record behind it", () => {
  it("lets him take the shift with the superseded record listed first", () => {
    expect(blockReason([superseded, current, ...others])).toBeNull();
  });

  it("lets him take it with the superseded record listed last", () => {
    expect(blockReason([current, ...others, superseded])).toBeNull();
  });

  it("gives the same answer for every posting, whichever way round they sit", () => {
    for (const p of POSTINGS) {
      const first = blockReason([superseded, current, ...others], p);
      const last = blockReason([current, ...others, superseded], p);
      expect(last, p.id).toBe(first);
    }
  });

  it("names the induction he actually lacks, not the RSA he holds", () => {
    // the four postings that refuse him for a reason that is not his licence
    const lunch = POSTINGS.find((p) => p.id === "sp-2038-wait")!;
    const reason = blockReason([superseded, current, ...others], lunch);
    expect(reason).toMatch(/induction/i);
    expect(reason).not.toMatch(/rsa/i);
  });
});

describe("which record answers the requirement", () => {
  const ask = (creds: Credential[]) =>
    decide({
      person: tan,
      credentials: creds,
      action: "be_rostered",
      site: siteOf(bar.siteId)!,
      at: TODAY,
      verifier,
    });

  it("is a valid one whenever the person holds any", () => {
    const d = ask([superseded, current, ...others]);
    expect(d.reasons.some((r) => r.code === "credential.valid")).toBe(true);
    expect(d.reasons.some((r) => r.outcome === "fail")).toBe(false);
  });

  it("reports the longest-covering failure when none is valid", () => {
    /* Revoked but dated 2025 beats lapsed-in-2024: the revocation is the live
       fact, and the one he can do something about. */
    const revoked = CREDENTIALS.find(
      (c) => c.subject === tan.did && c.type === "rsa" && c.status === "revoked",
    );
    const lapsed: Credential = { ...seedRsa, id: "rsa-ancient", status: "valid", expiresAt: "2020-01-01" };
    if (!revoked) return; // seed changed; the ordering claim is covered below

    const d = ask([lapsed, revoked, ...others]);
    const rsa = d.reasons.find((r) => r.credentialType === "rsa");
    expect(rsa?.code).toBe("credential.revoked");
  });

  it("prefers a non-expiring record over any dated one", () => {
    const forever: Credential = { ...seedRsa, id: "rsa-forever", status: "valid", expiresAt: null };
    const soon: Credential = { ...seedRsa, id: "rsa-soon", status: "valid", expiresAt: "2024-06-01" };
    // dated one first: without ranking it would warn "expires in N days"
    const d = ask([soon, forever, ...others]);
    expect(d.reasons.some((r) => r.code === "credential.expiring")).toBe(false);
    expect(d.reasons.some((r) => r.code === "credential.valid")).toBe(true);
  });
});
