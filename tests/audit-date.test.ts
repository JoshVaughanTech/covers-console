/* ============================================================
   Rendering an event's date.

   AuditEvent.at is typed ISODate and documented as "YYYY-MM-DD",
   but not every event carries a bare day. A break decision and the
   push outcome that follows it send a full timestamp, and they are
   right to — a break at 22:10 is not the same fact as a break "on
   Thursday".

   The renderer assumed the narrow shape, split the whole string on
   "-", and read the day as "16T12:10:00Z". Number() of that is NaN,
   so every break decision sent from a phone appeared in the audit
   log as "NaN May 2024" — on the one screen whose entire job is to
   be believable.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { fmtDate } from "../app/(console)/audit/format";

describe("fmtDate", () => {
  it("renders a bare calendar date", () => {
    expect(fmtDate("2024-05-16")).toBe("16 May 2024");
  });

  it("renders a full timestamp as the day it happened", () => {
    expect(fmtDate("2024-05-16T12:10:00Z")).toBe("16 May 2024");
  });

  it("renders a timestamp with milliseconds, which is what toISOString gives", () => {
    expect(fmtDate("2024-05-16T12:10:00.000Z")).toBe("16 May 2024");
  });

  it("never renders NaN for anything a real event carries", () => {
    for (const at of [
      "2024-05-16",
      "2024-05-16T00:00:00Z",
      "2024-05-16T22:10:33.412Z",
      new Date("2024-05-16T22:10:00Z").toISOString(),
    ]) {
      expect(fmtDate(at), at).not.toContain("NaN");
    }
  });

  it("drops a leading zero on the day, as it always did", () => {
    expect(fmtDate("2024-05-06")).toBe("6 May 2024");
  });

  it("handles every month boundary", () => {
    expect(fmtDate("2024-01-01")).toBe("1 Jan 2024");
    expect(fmtDate("2024-12-31")).toBe("31 Dec 2024");
  });
});
