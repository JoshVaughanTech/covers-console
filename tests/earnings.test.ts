/* ============================================================
   What a worked shift was worth.

   The test that carries this file is the one about WHERE the meal
   break falls. rates.ts removes a break from the end of a shift
   because an offer does not know when it will be taken; a worked
   shift does, and the two answers differ. Pricing the dearest hours
   away is safe for a gate and wrong for a figure shown to the person
   who is owed it.
   ============================================================ */
import { describe, it, expect } from "vitest";
import { earningsFor, priceWorkedShift, fmtAud, type ShiftSession, type Level } from "../lib/awards";

/** Melbourne local time in July 2026 — AEST, UTC+10. 17 July is a Friday. */
const aest = (day: number, hour: number, min = 0) =>
  Math.floor(Date.UTC(2026, 6, day, hour - 10, min) / 1000);

const session = (over: Partial<ShiftSession> = {}): ShiftSession => ({
  userId: "w:darie-roberts",
  name: "Darie Roberts",
  role: "Bartender",
  siteName: "Brightwater Hotel",
  clockIn: aest(17, 17),
  clockOut: aest(18, 1),
  breaks: [],
  employmentType: "casual",
  ordinaryHourlyRate: 33.85,
  ...over,
});

const L2 = 2 as Level;

describe("a shift with no break", () => {
  const s = priceWorkedShift(session(), L2, "casual")!;

  it("prices every band the hours actually crossed", () => {
    // 17:00-19:00 ordinary, 19:00-24:00 evening, 00:00-01:00 Saturday
    expect(s.bands.map((b) => b.band).sort()).toEqual(["ordinary", "ordinary", "saturday"]);
    expect(s.paidHours).toBe(8);
    expect(s.unpaidBreakHours).toBe(0);
  });

  it("keeps the evening loading as its own row rather than folding it in", () => {
    /* Grouping on band alone put 3 ordinary and 5 evening hours in one row at
       the dearer rate, so the screen showed 8h at $36.80 = $294.40 against an
       actual $285.55. The rows a worker can check have to be the rows the
       total was built from. */
    const ordinary = s.bands.find((b) => b.band === "ordinary" && b.adder === null)!;
    const evening = s.bands.find((b) => b.band === "ordinary" && b.adder === "evening")!;
    expect(fmtAud(ordinary.hourlyCents)).toBe("$33.85");
    expect(fmtAud(evening.hourlyCents)).toBe("$36.80");
    expect(ordinary.hours).toBe(2);
    expect(evening.hours).toBe(5);
  });

  it("has rows that sum to the shift total, exactly", () => {
    // the property the split exists to hold, and the one a worker checks
    expect(s.bands.reduce((n, b) => n + b.cents, 0)).toBe(s.awardCents);
  });

  it("totals the award floor for those hours", () => {
    // 2h @ $33.85 + 5h @ $36.80 + 1h @ $40.62
    expect(fmtAud(s.awardCents)).toBe("$292.32");
  });
});

describe("the meal break is priced where it actually fell", () => {
  /* The whole reason this module exists rather than calling priceShift with a
     duration. A 30-minute meal at 20:00 costs half an hour of EVENING time;
     removing it from the end would cost half an hour of SATURDAY time, which
     is dearer — so the shift would be reported as worth less than it was. */
  const atEight = session({
    breaks: [{ kind: "meal", start: aest(17, 20), end: aest(17, 20, 30) }],
  });

  it("removes the hours that were actually unworked", () => {
    const s = priceWorkedShift(atEight, L2, "casual")!;
    expect(s.paidHours).toBe(7.5);
    expect(s.unpaidBreakHours).toBe(0.5);
    // the Saturday hour survives in full — it was worked
    expect(s.bands.find((b) => b.band === "saturday")!.hours).toBe(1);
  });

  it("is worth more than the same break taken off the end", () => {
    const real = priceWorkedShift(atEight, L2, "casual")!;

    // the same shift with the break at the very end instead
    const atEnd = session({
      breaks: [{ kind: "meal", start: aest(18, 0, 30), end: aest(18, 1) }],
      clockOut: aest(18, 1),
    });
    const trimmed = priceWorkedShift(atEnd, L2, "casual")!;

    /* Both worked 7.5h. The one that gave up evening time is worth more than
       the one that gave up Saturday time.

       The gap is half an hour moving between the two BASE rates — $40.62
       Saturday against $33.85 ordinary — and not against the $36.80 effective
       evening rate, because the evening adder is charged per hour or part of
       an hour and comes to five either way. Splitting the evening run in two
       does not add a sixth. Worth stating: the first version of this test
       asserted $1.91 from the effective rate and the code was right. */
    expect(real.paidHours).toBe(trimmed.paidHours);
    expect(real.awardCents).toBeGreaterThan(trimmed.awardCents);
    expect(fmtAud(real.awardCents - trimmed.awardCents)).toBe("$3.39");
  });

  it("keeps a paid rest break in the hours", () => {
    // Table 2: rest breaks are paid, meal breaks are not
    const withRest = session({
      breaks: [{ kind: "rest", start: aest(17, 21), end: aest(17, 21, 20) }],
    });
    const s = priceWorkedShift(withRest, L2, "casual")!;
    expect(s.paidHours).toBe(8);
    expect(s.unpaidBreakHours).toBe(0);
  });

  it("handles two meal breaks", () => {
    const twice = session({
      breaks: [
        { kind: "meal", start: aest(17, 19), end: aest(17, 19, 30) },
        { kind: "meal", start: aest(17, 22), end: aest(17, 22, 30) },
      ],
    });
    const s = priceWorkedShift(twice, L2, "casual")!;
    expect(s.paidHours).toBe(7);
    expect(s.unpaidBreakHours).toBe(1);
  });

  it("ignores a break still open at clock-out", () => {
    // an unclosed break has no duration to remove; guessing one would invent
    // unpaid time out of a missing record
    const open = session({ breaks: [{ kind: "meal", start: aest(17, 20), end: null }] });
    expect(priceWorkedShift(open, L2, "casual")!.paidHours).toBe(8);
  });
});

describe("what the venue owes on top", () => {
  it("carries cl 16.6 loading when the meal was missed", () => {
    // 8h with no meal break: loading runs from the 6h mark to clock-out
    const s = priceWorkedShift(session(), L2, "casual")!;
    expect(s.loading).not.toBeNull();
    expect(s.loading!.clause).toBe("16.6");
    expect(s.loading!.hours).toBe(2);
    // 50% of the ordinary hourly rate for two hours
    expect(fmtAud(s.loading!.cents)).toBe("$33.85");
    expect(s.totalCents).toBe(s.awardCents + s.loading!.cents);
  });

  it("is null rather than zero when nothing is owed", () => {
    /* Zero and "not owed" read identically on a screen and only one of them
       is a fact about this shift. */
    const proper = session({
      breaks: [{ kind: "meal", start: aest(17, 20), end: aest(17, 20, 30) }],
    });
    expect(priceWorkedShift(proper, L2, "casual")!.loading).toBeNull();
  });
});

describe("what it refuses to price", () => {
  it("returns null for a shift still open", () => {
    // no clock-out is not a zero-value shift, it is an unfinished one
    expect(priceWorkedShift(session({ clockOut: null }), L2, "casual")).toBeNull();
  });

  it("returns null when no rate table covers the dates", () => {
    const old = session({
      clockIn: Math.floor(Date.UTC(2026, 5, 19, 7) / 1000),
      clockOut: Math.floor(Date.UTC(2026, 5, 19, 15) / 1000),
    });
    expect(priceWorkedShift(old, L2, "casual")).toBeNull();
  });

  it("counts what it could not price rather than dropping it", () => {
    /* A total that silently omits a shift is a wrong total that looks right. */
    const r = earningsFor({
      sessions: [
        session(),
        session({ clockIn: Math.floor(Date.UTC(2026, 5, 19, 7) / 1000), clockOut: Math.floor(Date.UTC(2026, 5, 19, 15) / 1000) }),
      ],
      level: L2,
      employment: "casual",
    });
    expect(r.shifts).toHaveLength(1);
    expect(r.unpriced).toBe(1);
  });
});

describe("a period", () => {
  const week = earningsFor({
    sessions: [
      session(),
      session({
        clockIn: aest(15, 9),
        clockOut: aest(15, 17),
        breaks: [{ kind: "meal", start: aest(15, 13), end: aest(15, 13, 30) }],
      }),
    ],
    level: L2,
    employment: "casual",
  });

  it("sums the hours and the award value", () => {
    expect(week.shifts).toHaveLength(2);
    expect(week.paidHours).toBe(15.5);
    expect(week.totalCents).toBe(week.awardCents + week.loadingCents);
  });

  it("separates the loading from the wages", () => {
    // one shift missed its meal break, the other did not
    expect(week.loadingCents).toBeGreaterThan(0);
    expect(week.shifts.filter((s) => s.loading).length).toBe(1);
  });

  it("puts the most recent shift first", () => {
    expect(week.shifts[0].clockIn).toBeGreaterThan(week.shifts[1].clockIn);
  });

  it("is empty rather than wrong when there is nothing to price", () => {
    const none = earningsFor({ sessions: [], level: L2, employment: "casual" });
    expect(none).toMatchObject({ shifts: [], paidHours: 0, totalCents: 0, unpriced: 0 });
  });

  it("every shift's rows sum to its own total, and the shifts to the period", () => {
    /* Held across the whole period rather than one fixture, because the
       part-hour adder means no row can be checked by multiplying its rate by
       its hours — the subtotal is the only thing that reconciles. */
    for (const s of week.shifts) {
      expect(s.bands.reduce((n, b) => n + b.cents, 0), `${s.id} rows`).toBe(s.awardCents);
      expect(s.totalCents).toBe(s.awardCents + (s.loading?.cents ?? 0));
    }
    expect(week.shifts.reduce((n, s) => n + s.awardCents, 0)).toBe(week.awardCents);
    expect(week.shifts.reduce((n, s) => n + (s.loading?.cents ?? 0), 0)).toBe(week.loadingCents);
  });
});
