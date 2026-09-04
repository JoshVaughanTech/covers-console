/* ============================================================
   Awards pack — MA000009 pay rates.

   The first block is the one that matters. lib/awards/rates.ts stores
   seven base rates and eight percentages, and claims it can regenerate
   the Fair Work pay guide from them. These tests are that claim, checked
   against the figures printed in the guide effective 01/07/2026 — every
   expected value below was read off the published document, not computed
   by the code under test. If one of them fails, the model is wrong.

   Four of the cells land exactly on a half-cent ($32.175 → $32.18,
   $48.195 → $48.20), which is why the module works in integer cents.
   ============================================================ */
import { describe, it, expect } from "vitest";
import {
  HIGA_RATES_2026,
  RateTableRangeError,
  assessOffer,
  covers,
  floorHourly,
  fmtAud,
  priceShift,
  suggestedLevel,
  type Level,
} from "../lib/awards/rates";

/** Melbourne local time in July 2026 — AEST, UTC+10, no daylight saving. */
const aest = (day: number, hour: number, min = 0) =>
  Math.floor(Date.UTC(2026, 6, day, hour - 10, min) / 1000);

/* 17 July 2026 is a Friday; the shift below runs into Saturday the 18th. */
const FRI = 17;

describe("the published pay guide regenerates from the stored model", () => {
  /* Full-time & part-time, Table 1 of 3 — "Hourly pay rate" column. */
  it("matches the printed permanent hourly rates", () => {
    const printed: [Level, string][] = [
      ["introductory", "$25.74"],
      [1, "$26.44"],
      [2, "$27.08"],
      [3, "$27.97"],
      [4, "$29.45"],
      [5, "$31.30"],
      [6, "$32.13"],
    ];
    for (const [level, cell] of printed) {
      expect(fmtAud(floorHourly(level, "full_time"))).toBe(cell);
      // part-time shares the column; that they agree is the point of one lookup
      expect(floorHourly(level, "part_time")).toBe(floorHourly(level, "full_time"));
    }
  });

  /* The weekly rates in clause 18 Table 3, ÷ 38, as the guide prints them. */
  it("derives the hourly rate from the printed weekly rate", () => {
    const weekly: [Level, number][] = [
      ["introductory", 978.1],
      [1, 1004.9],
      [2, 1029.1],
      [3, 1062.9],
      [4, 1119.1],
      [5, 1189.4],
      [6, 1221.1],
    ];
    for (const [level, w] of weekly) {
      expect(floorHourly(level, "full_time")).toBe(Math.round((w * 100) / 38));
    }
  });

  /* Casual, Table 1 of 2 — "Hourly pay rate", "Saturday", "Sunday" columns. */
  it("matches the printed casual weekday, Saturday and Sunday rates", () => {
    const printed: [Level, string, string, string][] = [
      ["introductory", "$32.18", "$38.61", "$45.05"],
      [1, "$33.05", "$39.66", "$46.27"],
      [2, "$33.85", "$40.62", "$47.39"],
      [6, "$40.16", "$48.20", "$56.23"],
    ];
    for (const [level, ordinary, saturday, sunday] of printed) {
      expect(fmtAud(floorHourly(level, "casual", "ordinary"))).toBe(ordinary);
      expect(fmtAud(floorHourly(level, "casual", "saturday"))).toBe(saturday);
      expect(fmtAud(floorHourly(level, "casual", "sunday"))).toBe(sunday);
    }
  });

  /* Permanent Table 2 of 3, and casual Table 2 of 2 — public holiday columns. */
  it("matches the printed Sunday and public holiday rates", () => {
    expect(fmtAud(floorHourly("introductory", "full_time", "saturday"))).toBe("$32.18");
    expect(fmtAud(floorHourly("introductory", "full_time", "sunday"))).toBe("$38.61");
    expect(fmtAud(floorHourly("introductory", "full_time", "public_holiday"))).toBe("$57.92");
    expect(fmtAud(floorHourly("introductory", "casual", "public_holiday"))).toBe("$64.35");
    expect(fmtAud(floorHourly(2, "casual", "public_holiday"))).toBe("$67.70");
  });

  it("rounds the half-cent cells the way the guide prints them", () => {
    // 2574 × 1.25 = 3217.5 and the guide says $32.18, not $32.17
    expect(floorHourly("introductory", "casual")).toBe(3218);
    // 3213 × 1.5 = 4819.5 and the guide says $48.20
    expect(floorHourly(6, "casual", "saturday")).toBe(4820);
  });

  it("refuses a classification it has no rate for", () => {
    expect(() => floorHourly(9 as Level, "casual")).toThrow(/classification/);
  });
});

describe("a shift is priced hour by hour, not as one rate", () => {
  /* The shift from the marketplace mockup: Friday 17:00–01:00, casual Level 2.
     Three bands — ordinary, evening, then Saturday after midnight. */
  const fridayNight = { level: 2 as Level, employment: "casual" as const, start: aest(FRI, 17), end: aest(FRI + 1, 1) };

  it("splits at 19:00 and at midnight", () => {
    const p = priceShift(fridayNight);
    expect(p.segments.map((s) => [s.band, s.adder, s.seconds / 3600])).toEqual([
      ["ordinary", null, 2],
      ["ordinary", "evening", 5],
      ["saturday", null, 1],
    ]);
  });

  it("prices each band at its own rate", () => {
    const p = priceShift(fridayNight);
    expect(p.segments.map((s) => fmtAud(s.effectiveHourlyCents))).toEqual(["$33.85", "$36.80", "$40.62"]);
    expect(fmtAud(p.floorCents)).toBe("$292.32");
    expect(fmtAud(p.blendedHourlyCents)).toBe("$36.54");
    expect(fmtAud(p.minimumFlatHourlyCents)).toBe("$40.62");
  });

  it("charges no night loading on Saturday morning", () => {
    // the guide's night column is headed "Monday to Friday"; 00:00–01:00 on a
    // Saturday is Saturday-rated and attracts no adder
    const p = priceShift(fridayNight);
    expect(p.segments[2]).toMatchObject({ band: "saturday", adder: null, adderCents: 0 });
  });

  it("charges the night loading when the hours really are a weekday night", () => {
    // Tuesday 04:00–06:00
    const p = priceShift({ level: 2, employment: "casual", start: aest(21, 4), end: aest(21, 6) });
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0]).toMatchObject({ band: "ordinary", adder: "night", adderHours: 2 });
    expect(fmtAud(p.segments[0].effectiveHourlyCents)).toBe("$38.27"); // $33.85 + $4.42
  });

  it("charges a part of an hour as a whole hour of loading", () => {
    // 19:00–20:10 is one hour and ten minutes of evening: two adders, not 1.17
    const p = priceShift({ level: 2, employment: "casual", start: aest(FRI, 19), end: aest(FRI, 20, 10) });
    expect(p.segments[0].adderHours).toBe(2);
    expect(p.segments[0].adderCents).toBe(590);
  });

  it("takes the unpaid meal break off the paid hours", () => {
    const p = priceShift({ ...fridayNight, unpaidBreakSec: 30 * 60 });
    expect(p.paidSeconds).toBe(7.5 * 3600);
    expect(p.unpaidSeconds).toBe(1800);
    expect(fmtAud(p.floorCents)).toBe("$272.01"); // the last half-hour, at the Saturday rate
  });

  it("keeps every band the shift spans, break or no break", () => {
    /* The break comes out of the money, never out of the bands. It is the
       difference between a shift that is priced short and a shift whose
       Saturday hours stop existing — and the second is a hole in the gate,
       tested below. */
    const p = priceShift({ ...fridayNight, unpaidBreakSec: 30 * 60 });
    expect(p.segments.map((s) => s.band)).toEqual(["ordinary", "ordinary", "saturday"]);
    expect(p.segments.reduce((a, s) => a + s.seconds, 0)).toBe(8 * 3600);
    expect(fmtAud(p.minimumFlatHourlyCents)).toBe("$40.62");
  });

  it("prices a Sunday brunch as Sunday throughout", () => {
    const p = priceShift({ level: 2, employment: "casual", start: aest(19, 7), end: aest(19, 14) });
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].band).toBe("sunday");
    expect(fmtAud(p.floorCents)).toBe("$331.73"); // 7h × $47.39
  });

  it("refuses a shift that does not go forwards", () => {
    expect(() => priceShift({ level: 2, employment: "casual", start: aest(FRI, 17), end: aest(FRI, 17) })).toThrow();
  });
});

describe("public holidays are checked only when a calendar is supplied", () => {
  it("says so when none was given", () => {
    const p = priceShift({ level: 2, employment: "casual", start: aest(FRI, 10), end: aest(FRI, 14) });
    expect(p.publicHolidaysChecked).toBe(false);
    expect(p.segments[0].band).toBe("ordinary");
  });

  it("prices the day at the public holiday rate when it is one", () => {
    const p = priceShift({
      level: 2,
      employment: "casual",
      start: aest(FRI, 10),
      end: aest(FRI, 14),
      publicHolidays: ["2026-07-17"],
    });
    expect(p.publicHolidaysChecked).toBe(true);
    expect(p.segments[0].band).toBe("public_holiday");
    expect(fmtAud(p.segments[0].effectiveHourlyCents)).toBe("$67.70");
  });

  it("drops the evening loading on a public holiday", () => {
    // the evening column is a Monday-to-Friday ORDINARY-hours loading; the
    // public holiday rate is not an ordinary rate and does not stack with it
    const p = priceShift({
      level: 2,
      employment: "casual",
      start: aest(FRI, 20),
      end: aest(FRI, 22),
      publicHolidays: ["2026-07-17"],
    });
    expect(p.segments[0]).toMatchObject({ band: "public_holiday", adder: null });
  });
});

describe("an offer is tested against every hour, not the average", () => {
  const fridayNight = { level: 2 as Level, employment: "casual" as const, start: aest(FRI, 17), end: aest(FRI + 1, 1) };

  /* The bug this whole module is shaped around. */
  it("refuses a flat rate that beats the average but underpays an hour", () => {
    const a = assessOffer(3700, fridayNight); // $37.00/h

    expect(a.atOrAboveFloor).toBe(false);
    expect(a.shortSegments).toHaveLength(1);
    expect(a.shortSegments[0].band).toBe("saturday");
    expect(fmtAud(a.requiredHourlyCents)).toBe("$40.62");
    expect(fmtAud(a.marginHourlyCents)).toBe("-$3.62");

    // and it really does beat the average and the shift total — which is
    // exactly why testing against either of those would let it through
    expect(a.offeredHourlyCents).toBeGreaterThan(a.price.blendedHourlyCents);
    expect(a.aboveFloorCents).toBeGreaterThan(0);
    expect(a.summary).toContain("below the award");
    expect(a.summary).toContain("Saturday");
  });

  it("accepts a rate that clears the dearest hour", () => {
    const a = assessOffer(4150, fridayNight); // $41.50/h
    expect(a.atOrAboveFloor).toBe(true);
    expect(a.shortSegments).toEqual([]);
    expect(fmtAud(a.marginHourlyCents)).toBe("$0.88");
    expect(fmtAud(a.offeredGrossCents)).toBe("$332.00");
    expect(a.summary).toContain("clears the award floor");
  });

  it("accepts a rate sitting exactly on the floor", () => {
    const a = assessOffer(4062, fridayNight);
    expect(a.atOrAboveFloor).toBe(true);
    expect(a.marginHourlyCents).toBe(0);
    expect(a.summary).toContain("exactly at the floor");
  });

  it("still sees the Saturday hours when the break would have eaten them", () => {
    /* The bug this guards. 17:00–00:20 with a 30-minute unpaid break: deduct
       the break from the end first and the 20-minute Saturday run vanishes,
       the dearest rate on file becomes the $36.80 evening one, and $37.00/h
       sails through — underpaying every minute worked after midnight. */
    const shift = {
      level: 2 as Level,
      employment: "casual" as const,
      start: aest(FRI, 17),
      end: aest(FRI + 1, 0, 20),
      unpaidBreakSec: 30 * 60,
    };
    const a = assessOffer(3700, shift);
    expect(a.price.segments.some((s) => s.band === "saturday")).toBe(true);
    expect(a.atOrAboveFloor).toBe(false);
    expect(fmtAud(a.requiredHourlyCents)).toBe("$40.62");
  });

  it("names every period an offer is short of, dearest first", () => {
    const a = assessOffer(3400, fridayNight); // clears only the 17:00–19:00 hours
    expect(a.shortSegments.map((s) => s.band)).toEqual(["saturday", "ordinary"]);
  });
});

describe("the rate table knows what it can price", () => {
  it("covers dates from its effective date", () => {
    expect(covers(HIGA_RATES_2026, "2026-06-30")).toBe(false);
    expect(covers(HIGA_RATES_2026, "2026-07-01")).toBe(true);
    expect(covers(HIGA_RATES_2026, "2027-05-01")).toBe(true);
  });

  it("stops covering dates once superseded", () => {
    const old = { ...HIGA_RATES_2026, supersededFrom: "2027-07-01" };
    expect(covers(old, "2027-06-30")).toBe(true);
    expect(covers(old, "2027-07-01")).toBe(false);
  });

  it("refuses to price a shift outside the table rather than extrapolating", () => {
    // June 2026 is last year's floor; answering with this table would report a
    // number that is confidently wrong in the direction of underpaying
    expect(() =>
      priceShift({ level: 2, employment: "casual", start: Math.floor(Date.UTC(2026, 5, 20, 2) / 1000), end: Math.floor(Date.UTC(2026, 5, 20, 8) / 1000) }),
    ).toThrow(RateTableRangeError);
  });

  it("explains itself when it refuses", () => {
    try {
      priceShift({ level: 2, employment: "casual", start: Math.floor(Date.UTC(2026, 5, 20, 2) / 1000), end: Math.floor(Date.UTC(2026, 5, 20, 8) / 1000) });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("MA000009");
      expect((e as Error).message).toContain("2026-07-01");
    }
  });
});

describe("classification is suggested, never assumed", () => {
  it("suggests a level for roles it recognises", () => {
    expect(suggestedLevel("Bartender")).toBe(2);
    expect(suggestedLevel("Barback")).toBe(1);
    expect(suggestedLevel("Head Chef")).toBe(5);
    expect(suggestedLevel("Duty Manager")).toBe(5);
  });

  it("returns null rather than guessing", () => {
    // a wrong default is indistinguishable from a confirmed one downstream
    expect(suggestedLevel("Sommelier")).toBeNull();
    expect(suggestedLevel("")).toBeNull();
  });
});

describe("money formatting", () => {
  it("pads the cents and keeps the sign", () => {
    expect(fmtAud(3385)).toBe("$33.85");
    expect(fmtAud(3400)).toBe("$34.00");
    expect(fmtAud(5)).toBe("$0.05");
    expect(fmtAud(-362)).toBe("-$3.62");
  });
});
