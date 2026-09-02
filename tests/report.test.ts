import { describe, it, expect } from "vitest";
import {
  weeklyReport,
  reportToCsv,
  csvField,
  csvFilename,
  lastCompleteWeek,
  inWeek,
  localDate,
  DEMO_WEEK,
  DEMO_WEEK_SESSIONS,
  type ShiftSession,
} from "../lib/awards";

const H = 3600;
const M = 60;
const TZ = "Australia/Melbourne";

/* A fixed week so nothing depends on when the suite runs:
   Mon 25 Aug 2025 00:00 Melbourne → Mon 1 Sep 2025 00:00. */
const WEEK_START = Math.floor(Date.parse("2025-08-24T14:00:00Z") / 1000);
const WEEK_END = WEEK_START + 7 * 86400;
const day = (d: number, h: number, m = 0) => WEEK_START + d * 86400 + h * H + m * M;

const shift = (over: Partial<ShiftSession> = {}): ShiftSession => ({
  userId: "w:test",
  name: "Test Person",
  role: "Bartender",
  siteName: "Brightwater Hotel",
  employmentType: "casual",
  ordinaryHourlyRate: 30,
  clockIn: day(0, 9),
  clockOut: day(0, 9) + 8 * H,
  plannedEnd: day(0, 9) + 8 * H,
  breaks: [],
  ...over,
});

const report = (sessions: ShiftSession[]) => weeklyReport(sessions, WEEK_START, WEEK_END, { timezone: TZ });

describe("weeklyReport — what counts as a breach", () => {
  it("costs a missed meal on a >6h shift", () => {
    const r = report([shift()]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].code).toBe("MEAL_MISSED");
    // loading runs the 6h mark → clock-out: 2h at 50% of $30 = $30
    expect(r.rows[0].loadingHours).toBe(2);
    expect(r.rows[0].loadingAud).toBe(30);
  });

  it("costs a late meal from the deadline to the break", () => {
    const start = day(1, 6);
    const r = report([
      shift({
        clockIn: start,
        clockOut: start + 11 * H,
        plannedEnd: start + 11 * H,
        breaks: [{ kind: "meal", start: start + 6 * H + 40 * M, end: start + 7 * H + 10 * M }],
      }),
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].code).toBe("MEAL_LATE_HISTORIC");
    expect(r.rows[0].loadingHours).toBeCloseTo(0.67, 2);
  });

  it("does not charge a meal taken inside the window", () => {
    const start = day(0, 9);
    const r = report([
      shift({ breaks: [{ kind: "meal", start: start + 3 * H, end: start + 3.5 * H }] }),
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.totals.shiftsAssessed).toBe(1);
  });

  /* ---- the false-positive guards ---- */

  it("does not charge a 5h30 shift with no meal — elective zone, cl 16.4", () => {
    const start = day(2, 12);
    const r = report([shift({ clockIn: start, clockOut: start + 5.5 * H, plannedEnd: start + 5.5 * H })]);
    expect(r.rows).toHaveLength(0);
  });

  it("charges nothing for rest-break shortfalls — only the meal clause carries money", () => {
    const start = day(3, 8);
    const r = report([
      shift({
        clockIn: start,
        clockOut: start + 10.5 * H,
        plannedEnd: start + 10.5 * H,
        // meal on time; rests never taken on a >10h shift
        breaks: [{ kind: "meal", start: start + 3 * H, end: start + 3.5 * H }],
      }),
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.totals.pricedAud).toBe(0);
  });
});

describe("weeklyReport — pricing", () => {
  it("reports unpriced loading in hours and keeps it out of the money total", () => {
    const r = report([
      shift({ userId: "w:priced" }),
      shift({ userId: "w:unpriced", name: "No Rate", ordinaryHourlyRate: null, clockIn: day(1, 9), clockOut: day(1, 9) + 8 * H }),
    ]);
    expect(r.totals.breaches).toBe(2);
    expect(r.totals.pricedRows).toBe(1);
    expect(r.totals.unpricedRows).toBe(1);
    expect(r.totals.pricedAud).toBe(30);
    expect(r.totals.unpricedHours).toBe(2);
    // all four hours are owed, even though only two are priced
    expect(r.totals.loadingHours).toBe(4);
  });

  it("gives a person no dollar figure when every row of theirs is unpriced", () => {
    const r = report([shift({ ordinaryHourlyRate: null })]);
    expect(r.byPerson[0].loadingAud).toBeNull();
    expect(r.byPerson[0].loadingHours).toBe(2);
  });

  it("aggregates a person's breaches across the week", () => {
    const r = report([
      shift({ clockIn: day(0, 9), clockOut: day(0, 9) + 8 * H }),
      shift({ clockIn: day(3, 9), clockOut: day(3, 9) + 8 * H }),
    ]);
    expect(r.byPerson).toHaveLength(1);
    expect(r.byPerson[0].breaches).toBe(2);
    expect(r.byPerson[0].loadingAud).toBe(60);
  });
});

describe("weeklyReport — scope", () => {
  it("excludes open shifts and counts them", () => {
    const r = report([shift(), shift({ userId: "w:open", clockIn: day(4, 9), clockOut: null })]);
    expect(r.rows).toHaveLength(1);
    expect(r.openShifts).toBe(1);
    expect(r.totals.shiftsAssessed).toBe(1);
  });

  it("assigns an overnight shift to the week it started in", () => {
    // clocks in Sunday 20:00, out Monday 04:00 — belongs to this week
    const start = day(6, 20);
    const s = shift({ clockIn: start, clockOut: start + 8 * H });
    expect(inWeek(s, WEEK_START, WEEK_END)).toBe(true);
    expect(report([s]).rows).toHaveLength(1);
  });

  it("excludes a shift starting after the week ends", () => {
    const s = shift({ clockIn: WEEK_END + H, clockOut: WEEK_END + 9 * H });
    expect(inWeek(s, WEEK_START, WEEK_END)).toBe(false);
    expect(report([s]).totals.shiftsAssessed).toBe(0);
  });

  it("filters to one venue", () => {
    const r = weeklyReport(
      [shift(), shift({ userId: "w:other", siteName: "Northside Tavern", clockIn: day(1, 9), clockOut: day(1, 9) + 8 * H })],
      WEEK_START,
      WEEK_END,
      { timezone: TZ, siteName: "Northside Tavern" },
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].siteName).toBe("Northside Tavern");
  });
});

describe("weeklyReport — totals reconcile", () => {
  it("row hours sum to the reported total", () => {
    const r = report(DEMO_WEEK_SESSIONS.map((s) => ({ ...s, clockIn: s.clockIn - DEMO_WEEK.start + WEEK_START, clockOut: s.clockOut == null ? null : s.clockOut - DEMO_WEEK.start + WEEK_START })));
    const summed = +r.rows.reduce((a, x) => a + x.loadingHours, 0).toFixed(2);
    expect(summed).toBe(r.totals.loadingHours);
    expect(r.totals.pricedRows + r.totals.unpricedRows).toBe(r.totals.breaches);
  });

  it("is deterministic — folding the same week twice is identical", () => {
    const a = report([shift(), shift({ userId: "w:b", clockIn: day(2, 9), clockOut: day(2, 9) + 9 * H })]);
    const b = report([shift(), shift({ userId: "w:b", clockIn: day(2, 9), clockOut: day(2, 9) + 9 * H })]);
    expect(a).toEqual(b);
  });
});

describe("CSV", () => {
  it("escapes commas and quotes per RFC 4180", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("Tan, Michael")).toBe('"Tan, Michael"');
    expect(csvField('He said "go"')).toBe('"He said ""go"""');
    expect(csvField(null)).toBe("");
  });

  it("quotes a name containing a comma in the rendered file", () => {
    const r = report([shift({ name: "Tan, Michael", role: 'Bar "lead"' })]);
    const csv = reportToCsv(r, TZ);
    expect(csv).toContain('"Tan, Michael"');
    expect(csv).toContain('"Bar ""lead"""');
  });

  it("carries provenance and a total row", () => {
    const r = report([shift()]);
    const lines = reportToCsv(r, TZ).split("\n");
    expect(lines[1]).toContain("MA000009");
    expect(lines[1]).toContain("consolidated");
    expect(reportToCsv(r, TZ)).toContain("TOTAL (1 priced row)");
  });

  it("reports unpriced rows separately in the file, never folded into the total", () => {
    const csv = reportToCsv(report([shift({ ordinaryHourlyRate: null })]), TZ);
    expect(csv).toContain("UNPRICED (1 row, no hourly rate)");
    expect(csv).toContain("TOTAL (0 priced rows)");
  });

  it("names the file by venue and week", () => {
    const r = weeklyReport([shift()], WEEK_START, WEEK_END, { timezone: TZ, siteName: "Brightwater Hotel" });
    expect(csvFilename(r, TZ)).toBe("break-loading_brightwater-hotel_2025-08-25_2025-08-31.csv");
  });
});

describe("week helpers", () => {
  it("lastCompleteWeek returns a Monday-to-Monday span of exactly 7 days", () => {
    const w = lastCompleteWeek(Math.floor(Date.parse("2025-09-03T05:00:00Z") / 1000), TZ);
    expect(w.end - w.start).toBe(7 * 86400);
    // the week must be complete — it ends on or before now
    expect(w.end).toBeLessThanOrEqual(Math.floor(Date.parse("2025-09-03T05:00:00Z") / 1000));
    expect(localDate(w.start, TZ)).toBe("2025-08-25");
  });
});

describe("demo week", () => {
  it("is mostly clean, with both breach codes and an unpriced row present", () => {
    const r = weeklyReport(DEMO_WEEK_SESSIONS, DEMO_WEEK.start, DEMO_WEEK.end, { timezone: TZ });
    expect(r.totals.shiftsAssessed).toBeGreaterThan(r.totals.breaches);
    expect(r.rows.some((x) => x.code === "MEAL_MISSED")).toBe(true);
    expect(r.rows.some((x) => x.code === "MEAL_LATE_HISTORIC")).toBe(true);
    expect(r.totals.unpricedRows).toBe(1);
    expect(r.openShifts).toBe(1);
  });

  it("does not flag its two guard shifts", () => {
    const r = weeklyReport(DEMO_WEEK_SESSIONS, DEMO_WEEK.start, DEMO_WEEK.end, { timezone: TZ });
    expect(r.rows.some((x) => x.name === "Liam O'Brien")).toBe(false);
    expect(r.rows.some((x) => x.name === "Sophie Nguyen")).toBe(false);
  });
});
