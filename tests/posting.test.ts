/* ============================================================
   Posting a shift.

   The load-bearing test here is the empty-duties one. decideMember()
   reads `input.duties ?? functionsForRole(person.role)`, so:

     duties absent  → falls back to the job title  → over-gates, loudly
     duties empty   → no duty-scoped requirement binds → under-gates, silently

   A form that can produce `duties: []` can therefore create a posting
   that looks gated, reports Eligible, and checks nothing. So the
   validator refuses it, and this file pins that refusal.
   ============================================================ */

import { describe, it, expect } from "vitest";
import {
  buildPosting,
  dutiesForRole,
  emptyDraft,
  validateDraft,
  type PostingDraft,
} from "../lib/shifts/draft";
import { ALL_WORK_FUNCTIONS } from "../lib/idara/hospitality";

/** A draft that passes, so each test can spoil exactly one thing. */
const good = (over: Partial<PostingDraft> = {}): PostingDraft => ({
  ...emptyDraft(),
  role: "Bartender",
  seats: "2",
  functionName: "Brightwater Friday Live",
  siteId: "s-brightwater",
  day: "Fri, 17 May",
  window: "17:00–01:00",
  duties: ["serve_alcohol", "handle_food"],
  ...over,
});

describe("duties", () => {
  it("refuses a posting with no duties", async () => {
    const errors = validateDraft(good({ duties: [] }));
    expect(errors.some((e) => /duty/i.test(e))).toBe(true);
  });

  it("allows none for a role that carries none — a glassy clears tables", async () => {
    // the rule is not "duties must be non-empty", it is "non-empty for a role
    // that implies some". Getting this wrong makes a real shift unpostable.
    expect(validateDraft(good({ role: "Glassy", duties: [] }))).toEqual([]);
  });

  it("builds that posting rather than only tolerating it", async () => {
    const r = buildPosting(good({ role: "Glassy", duties: [] }), "sp-g", "Fri");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.duties).toEqual([]);
  });

  it("says why, in terms of the gate rather than the form", async () => {
    const [msg] = validateDraft(good({ duties: [] })).filter((e) => /duty/i.test(e));
    expect(msg).toMatch(/not gated/i);
  });

  it("will not build one either — the check is not only advisory", async () => {
    const r = buildPosting(good({ duties: [] }), "sp-x", "Fri");
    expect(r.ok).toBe(false);
  });

  it("prefills from the role", async () => {
    expect(dutiesForRole("Bartender")).toEqual(["serve_alcohol", "handle_food"]);
    expect(dutiesForRole("Gaming Attendant")).toContain("gaming");
  });

  it("treats an unmapped role as doing everything, not nothing", async () => {
    // the fail-safe direction: over-gate an unknown title rather than wave it through
    expect(dutiesForRole("Sommelier")).toEqual(ALL_WORK_FUNCTIONS);
  });

  it("has no duties before a role is picked", async () => {
    expect(dutiesForRole("")).toEqual([]);
  });

  it("still requires a role, so an empty draft is not mistaken for a glassy", async () => {
    // "" is not a role that carries no duties, it is no role — and
    // functionsForRole("") would otherwise return every function
    const errors = validateDraft({ ...emptyDraft(), duties: [] });
    expect(errors.some((e) => /role/i.test(e))).toBe(true);
  });
});

describe("validation", () => {
  it("accepts a complete draft", async () => {
    expect(validateDraft(good())).toEqual([]);
  });

  it.each([
    ["role", { role: "" }, /role/i],
    ["function name", { functionName: "" }, /event|function/i],
    ["site", { siteId: "" }, /site/i],
    ["day", { day: "" }, /day/i],
    ["window", { window: "" }, /window|time/i],
  ])("requires a %s", (_label, over, pattern) => {
    const errors = validateDraft(good(over as Partial<PostingDraft>));
    expect(errors.some((e) => pattern.test(e))).toBe(true);
  });

  it("treats whitespace as missing", async () => {
    expect(validateDraft(good({ functionName: "   " })).length).toBeGreaterThan(0);
  });

  it.each(["0", "-1", "2.5", "abc", ""])("rejects %o seats", (seats) => {
    const errors = validateDraft(good({ seats }));
    expect(errors.some((e) => /seats/i.test(e))).toBe(true);
  });

  it("accepts a plain whole number of seats", async () => {
    expect(validateDraft(good({ seats: "4" }))).toEqual([]);
  });

  it("reports every problem at once rather than one at a time", async () => {
    const errors = validateDraft({ ...emptyDraft(), seats: "0" });
    expect(errors.length).toBeGreaterThan(3);
  });
});

describe("building the posting", () => {
  it("produces a posting with no claims and nobody assigned", async () => {
    const r = buildPosting(good(), "sp-new-1", "Fri");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.claims).toEqual([]);
    expect(r.posting.assigned).toEqual([]);
    expect(r.posting.seats).toBe(2);
  });

  it("posts to the board or holds it as a draft", async () => {
    const open = buildPosting(good({ publish: true }), "a", "Fri");
    const drafted = buildPosting(good({ publish: false }), "b", "Fri");
    if (!open.ok || !drafted.ok) throw new Error("unreachable");
    expect(open.posting.status).toBe("open");
    expect(drafted.posting.status).toBe("draft");
  });

  it("omits the optional fields rather than storing empty strings", async () => {
    const r = buildPosting(good({ client: "", functionRef: "" }), "a", "Fri");
    if (!r.ok) throw new Error("unreachable");
    expect("client" in r.posting).toBe(false);
    expect("functionRef" in r.posting).toBe(false);
  });

  it("keeps a client when one is given — it is what makes the preference apply", async () => {
    const r = buildPosting(good({ client: "Meridian Group" }), "a", "Fri");
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.client).toBe("Meridian Group");
  });

  it("trims the text it stores", async () => {
    const r = buildPosting(good({ functionName: "  Quayside Launch  " }), "a", "Fri");
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.functionName).toBe("Quayside Launch");
  });

  it("carries the duties through untouched", async () => {
    const r = buildPosting(good({ duties: ["serve_alcohol", "gaming"] }), "a", "Fri");
    if (!r.ok) throw new Error("unreachable");
    expect(r.posting.duties).toEqual(["serve_alcohol", "gaming"]);
  });
});
