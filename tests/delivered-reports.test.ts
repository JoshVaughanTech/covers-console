/* ============================================================
   The report library is the chain, read back.

   /reports showed five saved reports that were literals in the
   page, with View and Download buttons that raised a toast. #48
   removed them and put nothing in their place — which was half the
   job, because runWeeklyReport() has been appending
   report.delivered to the chain the whole time, carrying the
   filename, the byte count and a SHA-256 of what it wrote.

   So this pins the fold, and the empty case especially: an empty
   library has to be distinguishable from a library nobody built,
   which is the distinction the five literals destroyed.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { deliveredReports } from "../lib/reports/delivered";
import type { AuditEvent } from "../lib/idara/types";

let seq = 0;
const ev = (type: string, data: Record<string, unknown>): AuditEvent =>
  ({
    seq: ++seq,
    type,
    at: "2026-09-07T02:00:00.000Z",
    actor: "system",
    summary: "",
    data,
    hash: "",
    prevHash: "",
  }) as unknown as AuditEvent;

const delivery = (over: Record<string, unknown> = {}) =>
  ev("report.delivered", {
    trigger: "schedule",
    weekLabel: "w/e 6 Sep 2026",
    filename: "break-loading-2026-09-06.csv",
    target: "/payroll/break-loading-2026-09-06.csv",
    contentHash: "9f2b7c1e4a6d8b0f3e5c7a9d1b3f5e7c9a1d3b5f7e9c1a3d5b7f9e1c3a5d7b9f",
    bytes: 4096,
    breaches: 3,
    loadingHours: 6.25,
    ...over,
  });

describe("reading the library off the chain", () => {
  it("is empty when nothing has been delivered", () => {
    expect(deliveredReports([])).toEqual([]);
  });

  it("ignores every event that is not a delivery", () => {
    const log = [
      ev("roster.published", { siteId: "s-brightwater" }),
      ev("break.decision", { kind: "meal" }),
      ev("task.moved", { taskId: "t1" }),
    ];
    expect(deliveredReports(log)).toEqual([]);
  });

  it("carries the fields a row is checked against", () => {
    const [r] = deliveredReports([delivery()]);
    expect(r.weekLabel).toBe("w/e 6 Sep 2026");
    expect(r.filename).toBe("break-loading-2026-09-06.csv");
    expect(r.bytes).toBe(4096);
    expect(r.breaches).toBe(3);
    expect(r.loadingHours).toBe(6.25);
    // the hash is the reason a row means anything: it names a file to go and check
    expect(r.contentHash).toHaveLength(64);
  });

  it("puts the newest first, by position on the chain", () => {
    const log = [
      delivery({ weekLabel: "w/e 23 Aug 2026" }),
      delivery({ weekLabel: "w/e 30 Aug 2026" }),
      delivery({ weekLabel: "w/e 6 Sep 2026" }),
    ];
    expect(deliveredReports(log).map((r) => r.weekLabel)).toEqual([
      "w/e 6 Sep 2026",
      "w/e 30 Aug 2026",
      "w/e 23 Aug 2026",
    ]);
  });

  it("orders by seq rather than by the week covered", () => {
    /* A re-run of an older week is a LATER fact about that week. Sorting by the
       week would bury it under newer ones, hiding the row most worth seeing. */
    const old = delivery({ weekLabel: "w/e 23 Aug 2026" });
    const recent = delivery({ weekLabel: "w/e 6 Sep 2026" });
    const rerun = delivery({ weekLabel: "w/e 23 Aug 2026", trigger: "manual" });
    const out = deliveredReports([old, recent, rerun]);
    expect(out[0].trigger).toBe("manual");
    expect(out[0].weekLabel).toBe("w/e 23 Aug 2026");
  });

  it("keeps a row from the chain even when it arrives shuffled", () => {
    const first = delivery({ weekLabel: "w/e 30 Aug 2026" });
    const second = delivery({ weekLabel: "w/e 6 Sep 2026" });
    expect(deliveredReports([second, first])[0].weekLabel).toBe("w/e 6 Sep 2026");
  });
});

describe("what the fold refuses to invent", () => {
  it("shows an absent filename as absent, not as an empty name", () => {
    const [r] = deliveredReports([delivery({ filename: undefined })]);
    expect(r.filename).toBe("—");
  });

  it("does not turn a missing hash into a plausible one", () => {
    const [r] = deliveredReports([delivery({ contentHash: undefined })]);
    expect(r.contentHash).toBe("");
  });

  it("keeps zero breaches distinguishable from a missing count", () => {
    /* Both render as 0, which is the one place this fold could mislead — a clean
       week and an unrecorded one must not be the same row. They are separated by
       the fields around them, so the guard here is that a real zero survives
       rather than being treated as absent. */
    const [clean] = deliveredReports([delivery({ breaches: 0, loadingHours: 0 })]);
    expect(clean.breaches).toBe(0);
    expect(clean.loadingHours).toBe(0);
    expect(clean.filename).not.toBe("—");
  });

  it("does not accept a breach count that is not a number", () => {
    const [r] = deliveredReports([delivery({ breaches: "lots", loadingHours: NaN })]);
    expect(r.breaches).toBe(0);
    expect(r.loadingHours).toBe(0);
  });

  it("survives an event with no data at all", () => {
    const bare = ev("report.delivered", {});
    // @ts-expect-error — the chain outlives any one shape of an event
    bare.data = undefined;
    const [r] = deliveredReports([bare]);
    expect(r.weekLabel).toBe("—");
    expect(r.trigger).toBe("schedule");
  });
});
