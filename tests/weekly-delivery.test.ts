import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWeeklyReport } from "../lib/reports/weekly";
import { FileSink, MemorySink } from "../lib/reports/delivery";
import { EventStore } from "../lib/store/events";
import { sha256Hex } from "../lib/idara/hash";
import type { ShiftSession } from "../lib/awards";

/* ============================================================
   Delivering the weekly report.

   A report that exists is not a report payroll has. What these
   pin is mostly about running twice: a schedule that fires on
   restart, a retried job, an operator clicking again. Payroll
   receiving the same figures twice is confusing; an audit chain
   claiming two deliveries of one report is worse, because it is
   false.
   ============================================================ */

const ORG = "org-brightwater";
const TZ = "Australia/Melbourne";

/* A fixed week so nothing depends on when the suite runs:
   Mon 25 Aug 2025 00:00 Melbourne. */
const START = Math.floor(Date.parse("2025-08-24T14:00:00Z") / 1000);
const WEEK = { start: START, end: START + 7 * 86400 };
const H = 3600;

/** A shift long enough to owe a meal break, with none taken. */
const breach = (userId: string, dayOffset: number): ShiftSession => ({
  userId,
  name: `Person ${userId}`,
  role: "Bartender",
  siteName: "Brightwater Hotel",
  employmentType: "casual",
  ordinaryHourlyRate: 30,
  clockIn: START + dayOffset * 86400 + 9 * H,
  clockOut: START + dayOffset * 86400 + 17 * H,
  plannedEnd: START + dayOffset * 86400 + 17 * H,
  breaks: [],
});

let store: EventStore;
let dir: string;

beforeEach(() => {
  store = new EventStore(":memory:");
  dir = mkdtempSync(join(tmpdir(), "covers-reports-"));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (sessions: ShiftSession[], sink = new FileSink(dir)) =>
  runWeeklyReport({ store, orgId: ORG, sink, sessions, week: WEEK, timezone: TZ, siteName: "Brightwater Hotel" });

describe("delivering the report", () => {
  it("writes a file payroll can open, named for the venue and week", async () => {
    const r = await run([breach("w:a", 0), breach("w:b", 1)]);

    expect(r.delivered).toBe(true);
    expect(r.filename).toBe("break-loading_brightwater-hotel_2025-08-25_2025-08-31.csv");
    expect(existsSync(r.target)).toBe(true);

    const body = readFileSync(r.target, "utf8");
    expect(body).toContain("Break Loading — Brightwater Hotel");
    expect(body).toContain("MA000009");
    expect(body.split("\n").filter((l) => l.includes("MEAL_MISSED"))).toHaveLength(2);
  });

  it("records the delivery in the chain, with the hash of what was sent", async () => {
    const r = await run([breach("w:a", 0)]);

    const events = store.all(ORG).filter((e) => e.type === "report.delivered");
    expect(events).toHaveLength(1);

    const e = events[0];
    // the hash is what turns "we sent a report" into "we sent THIS report"
    expect(e.data.contentHash).toBe(sha256Hex(readFileSync(r.target, "utf8")));
    expect(e.data.filename).toBe(r.filename);
    expect(e.data.breaches).toBe(1);
    expect(e.summary).toContain("Break loading report for w/e 31 Aug 2025 delivered");
    expect(store.verify(ORG).ok).toBe(true);
  });

  it("still delivers, and records, a week with nothing owed", async () => {
    // silence is a finding: payroll needs to know the week was checked
    const r = await run([]);
    expect(r.delivered).toBe(true);
    expect(r.report.totals.breaches).toBe(0);
    expect(store.all(ORG).filter((e) => e.type === "report.delivered")).toHaveLength(1);
  });
});

describe("running twice", () => {
  it("does not deliver the same week again", async () => {
    const sessions = [breach("w:a", 0)];
    const first = await run(sessions);
    const second = await run(sessions);

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(second.eventSeq).toBeNull();
    // one file, one event — not two of either
    expect(store.all(ORG).filter((e) => e.type === "report.delivered")).toHaveLength(1);
  });

  it("delivers again when the underlying figures have changed", async () => {
    await run([breach("w:a", 0)]);
    // a late punch correction adds a second breach to the same week
    const second = await run([breach("w:a", 0), breach("w:b", 2)]);

    expect(second.delivered).toBe(true);
    const events = store.all(ORG).filter((e) => e.type === "report.delivered");
    // the clientRef keys one delivery per week, so the chain still holds one —
    // the file is rewritten, and the first record stands as what was sent then
    expect(events).toHaveLength(1);
    expect(readFileSync(second.target, "utf8").split("\n").filter((l) => l.includes("MEAL_MISSED"))).toHaveLength(2);
  });

  it("treats an identical existing file as already delivered, even across processes", async () => {
    const first = await run([breach("w:a", 0)]);
    const body = readFileSync(first.target, "utf8");

    // a fresh store, as a restarted scheduler would have
    const other = new EventStore(":memory:");
    const again = await runWeeklyReport({
      store: other, orgId: ORG, sink: new FileSink(dir),
      sessions: [breach("w:a", 0)], week: WEEK, timezone: TZ, siteName: "Brightwater Hotel",
    });
    expect(again.delivered).toBe(false);
    expect(readFileSync(first.target, "utf8")).toBe(body);
    other.close();
  });
});

describe("refusing to write outside the directory", () => {
  it("rejects a filename that climbs out", async () => {
    const sink = new FileSink(dir);
    await expect(sink.deliver("../escaped.csv", "x")).rejects.toThrow(/refusing to write outside/);
    expect(existsSync(join(dir, "..", "escaped.csv"))).toBe(false);
  });

  it("rejects an absolute path", async () => {
    const sink = new FileSink(dir);
    const outside = join(tmpdir(), "covers-should-not-exist.csv");
    await expect(sink.deliver(outside, "x")).rejects.toThrow(/refusing to write outside/);
    expect(existsSync(outside)).toBe(false);
  });
});

describe("a dry run", () => {
  it("produces the report without touching the filesystem", async () => {
    const sink = new MemorySink();
    const r = await runWeeklyReport({
      store, orgId: ORG, sink, sessions: [breach("w:a", 0)],
      week: WEEK, timezone: TZ, siteName: "Brightwater Hotel",
    });
    expect(r.delivered).toBe(true);
    expect(sink.delivered.get(r.filename)).toContain("MEAL_MISSED");
    expect(existsSync(join(dir, r.filename))).toBe(false);
  });
});

describe("a file changed underneath us", () => {
  it("rewrites when the existing file is not what we would send", async () => {
    const first = await run([breach("w:a", 0)]);
    writeFileSync(first.target, "someone edited this", "utf8");

    const again = await run([breach("w:a", 0)]);
    expect(again.delivered).toBe(true);
    expect(readFileSync(again.target, "utf8")).toContain("MEAL_MISSED");
  });
});

describe("who delivered it", () => {
  it("records a scheduled run as nobody, with the trigger in the data", async () => {
    await run([breach("w:a", 0)]);
    const e = store.all(ORG).find((x) => x.type === "report.delivered")!;

    expect(e.actor).toBe("system");
    expect(e.data.trigger).toBe("schedule");
    // a schedule is not a person, so it must not be given an invented identity
    expect(e.actorDid).toBeUndefined();
    expect("actorDid" in e && e.actorDid === null).toBe(false);
    expect(store.verify(ORG).ok).toBe(true);
  });

  it("records the person when someone sends it by hand", async () => {
    const r = await runWeeklyReport({
      store, orgId: ORG, sink: new FileSink(dir), sessions: [breach("w:a", 0)],
      week: WEEK, timezone: TZ, siteName: "Brightwater Hotel",
      actor: "Priya Raman", actorDid: "did:web:idara.app:w:priya-raman", trigger: "manual",
    });
    expect(r.delivered).toBe(true);

    const e = store.all(ORG).find((x) => x.type === "report.delivered")!;
    expect(e.actor).toBe("Priya Raman");
    // a display name is not unique; the DID is what a dispute can rely on
    expect(e.actorDid).toBe("did:web:idara.app:w:priya-raman");
    expect(e.data.trigger).toBe("manual");
    expect(store.verify(ORG).ok).toBe(true);
  });
});
