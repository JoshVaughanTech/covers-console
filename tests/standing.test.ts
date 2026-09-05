/* ============================================================
   What one person holds.

   This exists because it was briefly about to be two copies. The
   Credentials screen computed credential state inline and People was
   about to compute it again — and a second copy is exactly how a
   roster comes to show a green dot beside somebody whose licence the
   engine has already refused. People did show that: Michael Tan's
   RSA is revoked in the seed and the mock had him clear.

   So these tests pin the derivation against the seeded demo beats
   rather than against invented fixtures. If a future change makes a
   screen disagree with the gate, one of these fails first.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { standingOf, daysBetween } from "../lib/idara/standing";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { EXPIRY_WARN_DAYS } from "../lib/idara/engine";
import { CREDENTIALS, WORKERS, TODAY } from "../lib/idara/seed";

const verifier = new LocalCredentialVerifier();

const didOf = (name: string) => {
  const w = WORKERS.find((x) => x.name === name);
  if (!w) throw new Error(`no worker ${name}`);
  return w.did;
};

const standing = (name: string, at = TODAY) =>
  standingOf(didOf(name), CREDENTIALS, at, verifier);

describe("the seeded demo beats", () => {
  it("has Michael Tan needing action — his RSA is revoked", async () => {
    // the row People showed as clear, which is why this file exists
    const s = standing("Michael Tan");
    expect(s.state).toBe("action_needed");
    expect(s.problems.some((h) => h.state === "revoked")).toBe(true);
  });

  it("has Jake Morrison needing action — his RSA expired", async () => {
    const s = standing("Jake Morrison");
    expect(s.state).toBe("action_needed");
    expect(s.problems.some((h) => h.state === "expired")).toBe(true);
  });

  it("has Leanne Vidal expiring, which is a warning rather than a block", async () => {
    const s = standing("Leanne Vidal");
    expect(s.state).toBe("expiring");
    expect(s.problems.every((h) => h.state === "expiring")).toBe(true);
  });

  it("has Darie Roberts current", async () => {
    expect(standing("Darie Roberts").state).toBe("current");
  });

  it("agrees with itself: exactly the people with problems are not current", async () => {
    for (const w of WORKERS) {
      const s = standingOf(w.did, CREDENTIALS, TODAY, verifier);
      expect(s.problems.length > 0, w.name).toBe(s.state !== "current");
    }
  });
});

describe("what counts as which state", () => {
  const held = (name: string, type: string) =>
    standing(name).held.find((h) => h.credential.type === type);

  it("counts everything the person holds, problems included", async () => {
    const s = standing("Michael Tan");
    expect(s.held.length).toBeGreaterThan(s.problems.length);
  });

  it("treats revoked as blocking regardless of the expiry date", async () => {
    // Michael's RSA does not expire until 2025 and is still refused
    const rsa = held("Michael Tan", "rsa");
    expect(rsa?.state).toBe("revoked");
    expect(rsa?.daysLeft).toBeGreaterThan(0);
  });

  it("uses the engine's own warning window, not a second number", async () => {
    const leanne = standing("Leanne Vidal");
    const expiring = leanne.problems.find((h) => h.state === "expiring");
    expect(expiring?.daysLeft).toBeLessThanOrEqual(EXPIRY_WARN_DAYS);
    expect(expiring?.daysLeft).toBeGreaterThan(0);
  });

  it("reports null days for a credential that does not expire", async () => {
    const nonExpiring = WORKERS.flatMap((w) =>
      standingOf(w.did, CREDENTIALS, TODAY, verifier).held,
    ).find((h) => h.credential.expiresAt === null);
    if (nonExpiring) expect(nonExpiring.daysLeft).toBeNull();
  });

  it("is current for somebody holding nothing at all", async () => {
    const s = standingOf("did:web:idara.app:w:nobody", CREDENTIALS, TODAY, verifier);
    expect(s.held).toEqual([]);
    expect(s.problems).toEqual([]);
    expect(s.state).toBe("current");
  });
});

describe("it answers as at a date, not as at today", () => {
  it("turns an expiring credential into an expired one by moving the date", async () => {
    const before = standing("Leanne Vidal");
    const after = standing("Leanne Vidal", "2030-01-01");
    expect(before.state).toBe("expiring");
    expect(after.state).toBe("action_needed");
  });

  it("shows a credential as current well before its warning window", async () => {
    // far enough back that nothing is inside EXPIRY_WARN_DAYS
    const s = standing("Leanne Vidal", "2024-01-01");
    expect(s.state).toBe("current");
  });
});

describe("daysBetween", () => {
  it("counts whole days", async () => {
    expect(daysBetween("2024-05-16", "2024-06-03")).toBe(18);
  });

  it("narrows a timestamp to its day, so the answer does not drift", async () => {
    // the bug this guards: parsing a moment against a bare date rounds down
    expect(daysBetween("2024-05-16T22:10:00Z", "2024-06-03")).toBe(18);
    expect(daysBetween("2024-05-16T00:00:01Z", "2024-06-03")).toBe(18);
  });

  it("goes negative once the date has passed", async () => {
    expect(daysBetween("2024-05-16", "2024-05-14")).toBe(-2);
  });
});
