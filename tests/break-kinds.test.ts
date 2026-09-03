import { describe, it, expect } from "vitest";
import { classifyBreak } from "../lib/integrations/connecteam";

/* ============================================================
   Meal vs rest classification.

   These are the break types actually configured on the live
   Connecteam account, copied verbatim from the API response. The
   first case is the one that was broken: a 30-minute unpaid meal
   break named simply "Break", which the old name-based classifier
   read as a rest break — so cl 16.2 was never satisfied, 50%
   loading accrued from the 6h mark for the rest of the shift, and
   the weekly report billed for breaks that had been taken.
   ============================================================ */

describe("classifyBreak — the live account's configured types", () => {
  it("reads an unpaid 30-minute break as the meal break, whatever it is called", () => {
    expect(classifyBreak({ id: "8a47c921", name: "Break", isPaid: false, duration: 30 })).toBe("meal");
  });

  it("reads a paid 20-minute break as a rest break", () => {
    expect(classifyBreak({ id: "97572c22", name: "Rest Break", isPaid: true, duration: 20 })).toBe("rest");
  });

  it("would have got the meal break wrong on name alone", () => {
    // the guard against reintroducing the old heuristic: "Break" matches none
    // of meal/lunch/dinner/unpaid, so anything name-first fails this case
    const nameOnly = /meal|lunch|dinner|unpaid/i.test("Break");
    expect(nameOnly).toBe(false);
    expect(classifyBreak({ id: "x", name: "Break", isPaid: false, duration: 30 })).toBe("meal");
  });
});

describe("classifyBreak — payment status wins over the name", () => {
  it("trusts isPaid even when the name suggests otherwise", () => {
    // a venue calling its paid 20-minute break "Lunch" is still a rest break
    expect(classifyBreak({ id: "x", name: "Lunch", isPaid: true, duration: 20 })).toBe("rest");
    // and an unpaid break called "Tea" is still the meal break
    expect(classifyBreak({ id: "x", name: "Tea", isPaid: false, duration: 30 })).toBe("meal");
  });
});

describe("classifyBreak — fallbacks when isPaid is absent", () => {
  it("falls back to the name", () => {
    expect(classifyBreak({ id: "x", name: "Meal break" })).toBe("meal");
    expect(classifyBreak({ id: "x", name: "Unpaid break" })).toBe("meal");
    expect(classifyBreak({ id: "x", name: "Rest break" })).toBe("rest");
    expect(classifyBreak({ id: "x", name: "Smoko" })).toBe("rest");
  });

  it("falls back to duration when the name says nothing", () => {
    expect(classifyBreak({ id: "x", name: "Break", duration: 30 })).toBe("meal");
    expect(classifyBreak({ id: "x", name: "Break", duration: 45 })).toBe("meal");
    expect(classifyBreak({ id: "x", name: "Break", duration: 20 })).toBe("rest");
  });

  it("defaults to rest when nothing is known", () => {
    // rest is the safer default: a missed rest break raises an alert, while a
    // wrongly assumed meal break would silently satisfy cl 16.2 and stop the
    // loading clock on a break that may never have happened
    expect(classifyBreak({ id: "x" })).toBe("rest");
  });
});
