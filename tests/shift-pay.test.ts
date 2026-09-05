/* ============================================================
   What a posting pays, and whether it may be published.

   The rates pack is tested against the printed pay guide in
   tests/rates.test.ts. This tests the promise built on top of it:
   Covers will not publish a shift below the award floor, and the
   number a worker is shown is the one the gate used.
   ============================================================ */
import { describe, it, expect } from "vitest";
import { buildPosting, describePay, emptyDraft, payBlockReason, payFromDraft, priceOf, POSTINGS, type PostingDraft, type ShiftPay, type ShiftPosting } from "../lib/shifts";
import { fmtAud } from "../lib/awards/rates";

/** Melbourne local time in July 2026 — AEST, UTC+10. 17 July is a Friday. */
const aest = (day: number, hour: number, min = 0) =>
  Math.floor(Date.UTC(2026, 6, day, hour - 10, min) / 1000);

const posting = (pay?: ShiftPay): ShiftPosting =>
  ({
    id: "sp-t", role: "Bartender", seats: 1, functionName: "Friday Live",
    siteId: "s-brightwater", day: "Fri, 17 Jul", window: "17:00–01:00", shiftId: "Fri",
    duties: ["serve_alcohol"], requires: [], claims: [], assigned: [], status: "open",
    ...(pay ? { pay } : {}),
  }) as ShiftPosting;

/** Friday 17:00–01:00, casual Level 2 — three bands, dearest is $40.62. */
const fridayNight = (offeredHourlyCents: number): ShiftPay => ({
  level: 2, employment: "casual", offeredHourlyCents,
  startsAt: aest(17, 17), endsAt: aest(18, 1),
});

describe("a posting with no rate set", () => {
  it("is not priced and is not blocked", async () => {
    // "no rate yet" is an ordinary state, not a failure — and never a $0
    expect(priceOf(posting())).toBeNull();
    expect(describePay(posting())).toBeNull();
    expect(payBlockReason(posting())).toBeNull();
  });
});

describe("the publish gate", () => {
  it("refuses a rate below the floor for any hour of the shift", async () => {
    const reason = payBlockReason(posting(fridayNight(3700)));
    expect(reason).toContain("$37.00/h is below");
    expect(reason).toContain("MA000009");
    expect(reason).toContain("$40.62/h"); // the Saturday hours after midnight
    expect(reason).toContain("at least $40.62/h");
  });

  it("lets through a rate that clears every hour", async () => {
    expect(payBlockReason(posting(fridayNight(4150)))).toBeNull();
    expect(payBlockReason(posting(fridayNight(4062)))).toBeNull();
  });

  it("refuses one cent under the floor", async () => {
    expect(payBlockReason(posting(fridayNight(4061)))).not.toBeNull();
  });

  it("refuses a shift it has no rates on file for", async () => {
    // June 2026 predates the table. Publishing a shift with an unverifiable
    // compliance claim attached is worse than refusing to publish it.
    const stale = payBlockReason(
      posting({
        level: 2, employment: "casual", offeredHourlyCents: 9999,
        startsAt: Math.floor(Date.UTC(2026, 5, 19, 7) / 1000),
        endsAt: Math.floor(Date.UTC(2026, 5, 19, 15) / 1000),
      }),
    );
    expect(stale).toContain("No MA000009 rates on file");
  });
});

describe("buildPosting refuses to build an underpaying posting", () => {
  /* Built on emptyDraft() rather than a literal: a literal is a second copy of
     the shape that goes stale the moment a field is added, and it fails as a
     type error in the test rather than as a gap in what is covered. */
  const draft = (over: Partial<PostingDraft> = {}): PostingDraft => ({
    ...emptyDraft(),
    role: "Bartender", seats: "2", functionName: "Friday Live",
    siteId: "s-brightwater", day: "Fri, 17 Jul", window: "17:00–01:00",
    duties: ["serve_alcohol", "handle_food"], publish: true, ...over,
  });

  it("builds without a pay block, as before", async () => {
    const r = buildPosting(draft(), "sp-1", "Fri");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.posting.pay).toBeUndefined();
  });

  it("carries the pay block onto the posting", async () => {
    const r = buildPosting(draft(), "sp-2", "Fri", fridayNight(4150));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.posting.pay?.offeredHourlyCents).toBe(4150);
  });

  it("reports the shortfall as a validation error", async () => {
    const r = buildPosting(draft(), "sp-3", "Fri", fridayNight(3700));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("below the MA000009 floor");
  });

  it("refuses an underpaying DRAFT too, not just a publish", async () => {
    // a draft saved today is published later; telling them then is too late
    const r = buildPosting(draft({ publish: false }), "sp-4", "Fri", fridayNight(3700));
    expect(r.ok).toBe(false);
  });

  it("still reports the ordinary validation errors alongside the rate", async () => {
    const r = buildPosting(draft({ role: "" }), "sp-5", "Fri", fridayNight(3700));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /pick a role/i.test(e))).toBe(true);
      expect(r.errors.some((e) => /below the MA000009 floor/.test(e))).toBe(true);
    }
  });
});

describe("the form's rate section, parsed", () => {
  const d = (over: Partial<PostingDraft> = {}): PostingDraft => ({
    ...emptyDraft(),
    role: "Bartender", seats: "2", functionName: "Friday Live",
    siteId: "s-brightwater", day: "Fri, 17 Jul", window: "17:00–01:00",
    duties: ["serve_alcohol", "handle_food"], ...over,
  });

  /** a complete rate section: Friday 17:00–01:00, casual Level 2, $41.50 */
  const priced = (over: Partial<PostingDraft> = {}) =>
    d({ date: "2026-07-17", startTime: "17:00", endTime: "01:00", level: "2", rate: "41.50", ...over });

  it("returns no pay for an untouched section", async () => {
    const r = payFromDraft(d());
    expect(r).toEqual({ ok: true });
  });

  it("refuses a half-filled section rather than dropping it", async () => {
    // somebody who typed a rate and no date meant to publish a rate; ignoring
    // it would put the shift on the board paying nothing anyone agreed to
    const r = payFromDraft(d({ rate: "41.50" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /date/i.test(e))).toBe(true);
      expect(r.errors.some((e) => /start time/i.test(e))).toBe(true);
      expect(r.errors.some((e) => /classification/i.test(e))).toBe(true);
    }
  });

  it("builds the moments the award is applied to", async () => {
    const r = payFromDraft(priced());
    expect(r.ok).toBe(true);
    if (!r.ok || !r.pay) throw new Error("expected a pay block");
    expect(r.pay).toMatchObject({ level: 2, employment: "casual", offeredHourlyCents: 4150 });
    // 17:00 Melbourne in July is 07:00Z — AEST, no daylight saving
    expect(r.pay.startsAt).toBe(Math.floor(Date.UTC(2026, 6, 17, 7) / 1000));
  });

  it("reads an end before the start as crossing midnight", async () => {
    const r = payFromDraft(priced());
    if (!r.ok || !r.pay) throw new Error("expected a pay block");
    expect(r.pay.endsAt - r.pay.startsAt).toBe(8 * 3600);
    // and it must actually reach Saturday, or the whole gate is pointless
    expect(describePay({ ...posting(r.pay), pay: r.pay })!.bands.map((b) => b.label)).toEqual([
      "Weekday",
      "Saturday",
    ]);
  });

  it("keeps the introductory level as a name, not a number", async () => {
    const r = payFromDraft(priced({ level: "introductory" }));
    if (!r.ok || !r.pay) throw new Error("expected a pay block");
    expect(r.pay.level).toBe("introductory");
  });

  it("carries the unpaid break through in seconds", async () => {
    const r = payFromDraft(priced({ unpaidBreakMin: "30" }));
    if (!r.ok || !r.pay) throw new Error("expected a pay block");
    expect(r.pay.unpaidBreakSec).toBe(1800);
  });

  it.each([
    ["a bad time", { startTime: "25:00" }, /start time/i],
    ["a zero rate", { rate: "0" }, /hourly rate/i],
    ["a negative break", { unpaidBreakMin: "-5" }, /minutes/i],
  ])("reports %s", (_label, over, pattern) => {
    const r = payFromDraft(priced(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => pattern.test(e))).toBe(true);
  });

  it("refuses the underpaying draft through the form's own path", async () => {
    /* The form must not be a second opinion. This goes through buildPosting
       with no override, so the rate the manager typed reaches the same
       payBlockReason() that guards every other route in. */
    const r = buildPosting(priced({ rate: "37.00" }), "sp-form", "Fri");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("below the MA000009 floor");
  });

  it("publishes the same posting when the rate clears", async () => {
    const r = buildPosting(priced(), "sp-form-ok", "Fri");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.posting.pay?.offeredHourlyCents).toBe(4150);
      expect(describePay(r.posting)?.atOrAboveFloor).toBe(true);
    }
  });
});

describe("what the worker is shown", () => {
  const summary = describePay(posting(fridayNight(4150)))!;

  it("folds the shift into one row per rate band", async () => {
    // the 17:00–19:00 and 19:00–24:00 runs are both weekday and fold together;
    // the hours after midnight are Saturday and stay their own line
    expect(summary.bands.map((b) => [b.label, b.hours])).toEqual([
      ["Weekday", 7],
      ["Saturday", 1],
    ]);
    expect(summary.mixedRates).toBe(true);
  });

  it("shows the dearest hour of each band", async () => {
    expect(summary.bands.map((b) => fmtAud(b.hourlyCents))).toEqual(["$36.80", "$40.62"]);
  });

  it("quotes the gross for the shift, and the margin over the floor", async () => {
    expect(fmtAud(summary.estGrossCents)).toBe("$332.00");
    expect(summary.paidHours).toBe(8);
    expect(fmtAud(summary.floorHourlyCents)).toBe("$40.62");
    expect(fmtAud(summary.marginHourlyCents)).toBe("$0.88");
    expect(summary.atOrAboveFloor).toBe(true);
  });

  it("says when public holidays were not checked", async () => {
    expect(summary.publicHolidaysChecked).toBe(false);
  });

  it("carries what the figure does not cover", async () => {
    expect(summary.notModelled).toContain("overtime");
    expect(summary.notModelled.some((n) => /enterprise agreements/.test(n))).toBe(true);
  });

  it("describes an underpaying posting rather than hiding it", async () => {
    // the manager has to see the shortfall to fix it
    const short = describePay(posting(fridayNight(3700)))!;
    expect(short.atOrAboveFloor).toBe(false);
    expect(fmtAud(short.marginHourlyCents)).toBe("-$3.62");
  });

  it("returns null rather than throwing when no rates cover the shift", async () => {
    // one stale posting must not take the whole board down
    const stale = describePay(
      posting({
        level: 2, employment: "casual", offeredHourlyCents: 4150,
        startsAt: Math.floor(Date.UTC(2026, 5, 19, 7) / 1000),
        endsAt: Math.floor(Date.UTC(2026, 5, 19, 15) / 1000),
      }),
    );
    expect(stale).toBeNull();
  });
});

describe("the seeded demo board", () => {
  it("prices every posting that carries a rate", async () => {
    for (const p of POSTINGS) {
      expect(p.pay, `${p.id} has no pay block`).toBeDefined();
      expect(describePay(p), `${p.id} could not be priced`).not.toBeNull();
    }
  });

  it("has the Friday bar shift crossing into Saturday rates", async () => {
    const s = describePay(POSTINGS.find((p) => p.id === "sp-fridaylive-bar")!)!;
    expect(s.bands.map((b) => b.label)).toEqual(["Weekday", "Saturday"]);
    expect(fmtAud(s.floorHourlyCents)).toBe("$40.62");
    expect(s.atOrAboveFloor).toBe(true);
  });

  it("keeps every published posting at or above the floor", async () => {
    for (const p of POSTINGS.filter((x) => x.status === "open")) {
      expect(payBlockReason(p), `${p.id} is on the board underpaying`).toBeNull();
    }
  });

  it("has one underpaying draft, so the refusal is reachable in the demo", async () => {
    const draft = POSTINGS.find((p) => p.id === "sp-quayside-wait")!;
    expect(draft.status).toBe("draft");
    expect(payBlockReason(draft)).toContain("Sunday");
  });
});
