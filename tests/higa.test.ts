/* ============================================================
   Awards pack — Hospitality Award cl 16 break entitlements.
   Fixed epoch, no wall clock: each case is a shift shape and a
   moment, and the assertion is what the supervisor must be told.
   ============================================================ */
import { describe, it, expect } from "vitest";
import { assess, bracket, summariseBoard, assessAll, type ShiftSession } from "../lib/awards/higa";

const H = 3600, M = 60;
const T0 = 1_756_800_000;
const shift = (over: Partial<ShiftSession> = {}): ShiftSession => ({
  userId: "w:test", name: "Test Person", role: "Bartender", siteName: "Brightwater Hotel", clockIn: T0, breaks: [], ...over,
});

describe("Table 2 brackets", () => {
  it("escalates by shift length", async () => {
    expect(bracket(4 * H).meal).toBe("none");
    expect(bracket(5.5 * H).meal).toBe("elective");
    expect(bracket(7 * H)).toMatchObject({ meal: "mandatory", rests: 0 });
    expect(bracket(9 * H).rests).toBe(1);
    expect(bracket(10.5 * H).rests).toBe(2);
  });
});

describe("unpaid meal break (cl 16.2, 16.5, 16.6)", () => {
  it("has no entitlement on a 4h shift", async () => {
    const r = assess(shift({ plannedEnd: T0 + 4 * H }), T0 + 1 * H);
    expect(r.severity).toBe(0);
    expect(r.requirements).toHaveLength(0);
  });
  it("window not open before 2h", async () => {
    expect(assess(shift({ plannedEnd: T0 + 8 * H }), T0 + 1 * H).meal.state).toBe("not_yet");
  });
  it("warns in the last hour before the 6h deadline", async () => {
    const r = assess(shift({ plannedEnd: T0 + 8 * H }), T0 + 5 * H + 20 * M);
    expect(r.meal.state).toBe("due_soon");
    expect(r.alerts[0].code).toBe("MEAL_DUE_SOON");
    expect(r.severity).toBe(2);
  });
  it("accrues 50% loading past 6h with no meal", async () => {
    const r = assess(shift({ plannedEnd: T0 + 8 * H, ordinaryHourlyRate: 30 }), T0 + 6.5 * H);
    expect(r.meal.state).toBe("overdue");
    expect(r.severity).toBe(3);
    expect(r.penalty).toMatchObject({ accruing: true, seconds: 0.5 * H, estimateAud: 7.5 });
  });
  it("records a historic (non-accruing) penalty on a completed shift", async () => {
    const r = assess(shift({ clockOut: T0 + 8 * H }), T0 + 12 * H);
    expect(r.onShift).toBe(false);
    expect(r.penalty).toMatchObject({ accruing: false, seconds: 2 * H });
  });
  it("reports an in-progress meal break", async () => {
    const r = assess(shift({ plannedEnd: T0 + 8 * H, breaks: [{ kind: "meal", start: T0 + 4 * H, end: null }] }), T0 + 4 * H + 10 * M);
    expect(r.onBreak?.kind).toBe("meal");
    expect(r.meal.state).toBe("in_progress");
  });
  it("without a roster, the entitlement escalates as hours accrue", async () => {
    expect(assess(shift(), T0 + 5.5 * H).bracket.meal).toBe("elective");
    const r7 = assess(shift(), T0 + 7 * H);
    expect(r7.bracket.meal).toBe("mandatory");
    expect(r7.meal.state).toBe("overdue");
  });
});

describe("paid rest breaks (cl 16.2, 16.3, 16.7)", () => {
  it("requires one rest on a 9h shift once the meal is taken", async () => {
    const r = assess(shift({ plannedEnd: T0 + 9 * H, breaks: [{ kind: "meal", start: T0 + 3 * H, end: T0 + 3.5 * H }] }), T0 + 4 * H);
    expect(r.meal.state).toBe("taken");
    expect(r.rests).toEqual({ required: 1, credited: 0 });
    expect(r.requirements.find((q) => q.kind === "rest")?.state).toBe("pending");
  });
  it("credits two 10-min rests as one 20-min rest", async () => {
    const r = assess(shift({
      plannedEnd: T0 + 9 * H,
      breaks: [
        { kind: "meal", start: T0 + 3 * H, end: T0 + 3.5 * H },
        { kind: "rest", start: T0 + 1 * H, end: T0 + 1 * H + 10 * M },
        { kind: "rest", start: T0 + 6 * H, end: T0 + 6 * H + 10 * M },
      ],
    }), T0 + 7 * H);
    expect(r.rests.credited).toBe(1);
  });
  it("owes an additional rest after 5h continuous post-meal (16.7a)", async () => {
    const r = assess(shift({ plannedEnd: T0 + 10 * H, breaks: [{ kind: "meal", start: T0 + 2.5 * H, end: T0 + 3 * H }] }), T0 + 8 * H + 10 * M);
    expect(r.alerts.some((a) => a.code === "ADDITIONAL_REST_DUE")).toBe(true);
    expect(r.severity).toBe(3);
  });
});

describe("board summary", () => {
  it("sorts by urgency and totals loading", async () => {
    const staff = assessAll([
      shift({ userId: "a", plannedEnd: T0 + 8 * H }),
      shift({ userId: "b", clockIn: T0 - 6.5 * H, plannedEnd: T0 + 1.5 * H, ordinaryHourlyRate: 20 }),
    ], T0 + 1 * H);
    expect(staff[0].userId).toBe("b");
    const s = summariseBoard(staff);
    expect(s.overdue).toBe(1);
    expect(s.penaltyAud).toBe(15); // 1.5h * $10 loading
  });
});
