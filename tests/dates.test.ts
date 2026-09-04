/* ============================================================
   Comparing days, not moments.

   ISODate is documented as "YYYY-MM-DD" and most callers honour it,
   but events carrying a moment rather than a day send a full ISO
   timestamp in the same field — a break at 22:10 is not the same
   fact as a break "on Thursday".

   That is harmless until something compares one for chronology, and
   the engine does it twice:

     verifier   `expiresAt < at` as raw strings. A timestamp sorts
                after a bare date, so a credential expiring on the
                16th, checked at noon on the 16th, reads as expired.

     daysUntil  Date.parse of a timestamp against a bare date leaves
                most of a day on one side, and Math.round takes it
                off: 18 days becomes 17.

   Both fail in the safe direction — over-gating and under-reporting
   the window. Both are still wrong, and the first one blames the
   person's licence for a bug in the comparison, which sends whoever
   investigates to entirely the wrong place.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { calendarDate, isBeforeDay } from "../lib/idara/dates";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { decide, EXPIRY_WARN_DAYS } from "../lib/idara/engine";
import type { Credential, Identity, Site } from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();

const cred = (expiresAt: string | null): Credential => ({
  id: "vc-d1",
  type: "rsa",
  subject: "did:web:idara.app:w:t",
  issuer: "did:web:idara.app",
  issuedAt: "2023-01-01",
  expiresAt,
  status: "valid",
  claims: {},
});

const person: Identity = {
  did: "did:web:idara.app:w:t",
  name: "T",
  role: "Bartender",
  org: "Brightwater Hospitality",
};

const site: Site = {
  id: "s-t",
  name: "Test Venue",
  region: "Victoria",
  kind: "venue",
  requires: [{ type: "rsa" }],
};

const at = (when: string) =>
  decide({ person, credentials: [cred("2024-05-16")], action: "be_rostered", site, at: when, verifier });

describe("calendarDate", () => {
  it("leaves a bare date alone", () => {
    expect(calendarDate("2024-05-16")).toBe("2024-05-16");
  });

  it("narrows a timestamp to its day", () => {
    expect(calendarDate("2024-05-16T22:10:00.412Z")).toBe("2024-05-16");
  });

  it("does not parse, so no timezone can shift the day", () => {
    // Date.parse would apply the runtime's zone and could land on the 15th or
    // the 17th depending on where this runs. Slicing cannot.
    expect(calendarDate("2024-05-16T23:59:59Z")).toBe("2024-05-16");
    expect(calendarDate("2024-05-16T00:00:00Z")).toBe("2024-05-16");
  });
});

describe("isBeforeDay", () => {
  it("is false for the same day in either form", () => {
    expect(isBeforeDay("2024-05-16", "2024-05-16")).toBe(false);
    expect(isBeforeDay("2024-05-16", "2024-05-16T12:10:00Z")).toBe(false);
    expect(isBeforeDay("2024-05-16T00:00:00Z", "2024-05-16")).toBe(false);
  });

  it("still orders different days", () => {
    expect(isBeforeDay("2024-05-15", "2024-05-16T00:00:00Z")).toBe(true);
    expect(isBeforeDay("2024-05-17", "2024-05-16T23:59:59Z")).toBe(false);
  });
});

describe("a credential expiring today", () => {
  it("is valid when checked with a bare date", () => {
    expect(verifier.verify(cred("2024-05-16"), "2024-05-16").status).toBe("valid");
  });

  it("is still valid when checked with a timestamp on the same day", () => {
    // the whole point: the raw string comparison called this expired
    expect(verifier.verify(cred("2024-05-16"), "2024-05-16T12:10:00Z").status).toBe("valid");
    expect(verifier.verify(cred("2024-05-16"), "2024-05-16T23:59:59Z").status).toBe("valid");
  });

  it("is expired the next day, in either form", () => {
    expect(verifier.verify(cred("2024-05-16"), "2024-05-17").status).toBe("expired");
    expect(verifier.verify(cred("2024-05-16"), "2024-05-17T00:00:01Z").status).toBe("expired");
  });

  it("blocks nobody on the day it expires, whichever form the clock arrives in", () => {
    expect(at("2024-05-16").allowed).toBe(true);
    expect(at("2024-05-16T22:10:00Z").allowed).toBe(true);
  });
});

describe("the expiry warning window", () => {
  const daysLeft = (when: string) => {
    const d = decide({
      person,
      credentials: [cred("2024-06-03")],
      action: "be_rostered",
      site,
      at: when,
      verifier,
    });
    const warn = d.reasons.find((r) => r.outcome === "warn");
    return warn ? Number(/expires in (\d+) day/.exec(warn.detail)?.[1]) : null;
  };

  it("counts the same number of days from a date and from a timestamp", () => {
    // 22:10 on the 16th used to lose most of a day to Math.round
    expect(daysLeft("2024-05-16")).toBe(18);
    expect(daysLeft("2024-05-16T22:10:00Z")).toBe(18);
    expect(daysLeft("2024-05-16T00:00:00Z")).toBe(18);
  });

  it("keeps the manager-facing number stable across the day", () => {
    const morning = daysLeft("2024-05-16T06:00:00Z");
    const night = daysLeft("2024-05-16T23:30:00Z");
    expect(morning).toBe(night);
  });

  it("does not move the threshold itself", () => {
    expect(EXPIRY_WARN_DAYS).toBe(30);
    // exactly on the boundary warns, from either form
    expect(daysLeft("2024-05-04")).toBe(30);
    expect(daysLeft("2024-05-04T18:00:00Z")).toBe(30);
  });
});
