import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventStore } from "../lib/store/events";
import { sendOnBreak, unresolvedPushes, type BreakPusher, type BreakDecisionInput } from "../lib/store/decision";

/* ============================================================
   The two-phase write.

   Payroll runs off Connecteam, so a break Covers knows about and
   Connecteam does not is a break that never happened as far as pay
   is concerned. These tests pin the ordering that makes that
   recoverable: the decision is recorded BEFORE the push is
   attempted, so a failure anywhere downstream leaves evidence rather
   than a hole.
   ============================================================ */

const ORG = "org-brightwater";
let store: EventStore;

const input: BreakDecisionInput = {
  subject: "did:web:idara.app:w:darie-roberts",
  name: "Darie Roberts",
  kind: "meal",
  at: "2026-09-03T03:56:00.000Z",
  actor: "Leanne Vidal",
  overdue: true,
};

const pusher = (impl: Partial<BreakPusher> = {}): BreakPusher => ({
  available: () => true,
  push: async () => ({ ctBreakId: "ct-1" }),
  ...impl,
});

beforeEach(() => { store = new EventStore(":memory:"); });
afterEach(() => store.close());

describe("the happy path", () => {
  it("records the decision, pushes, then records the outcome", async () => {
    const r = await sendOnBreak(store, ORG, pusher(), input);

    expect(r.pushed).toBe("ok");
    expect(r.ctBreakId).toBe("ct-1");

    const all = store.all(ORG);
    expect(all.map((e) => e.type)).toEqual(["break.decision", "break.pushed"]);
    // the outcome points back at the decision it resolves
    expect(all[1].data.decisionSeq).toBe(all[0].seq);
    expect(store.verify(ORG).ok).toBe(true);
  });

  it("keeps the supervisor's time, not the recording time", async () => {
    const r = await sendOnBreak(store, ORG, pusher(), input);
    expect(r.decision.at).toBe("2026-09-03T03:56:00.000Z");
    expect(r.decision.summary).toContain("overdue — cl 16.6 loading applies");
  });
});

describe("when Connecteam refuses", () => {
  it("still keeps the decision, and records why the push failed", async () => {
    const r = await sendOnBreak(store, ORG, pusher({
      push: async () => { throw new Error("503 upstream unavailable"); },
    }), input);

    expect(r.pushed).toBe("failed");
    const all = store.all(ORG);
    expect(all.map((e) => e.type)).toEqual(["break.decision", "break.push_failed"]);
    // the decision survives — this is the whole reason it is written first
    expect(all[0].type).toBe("break.decision");
    expect(all[1].data.retryable).toBe(true);
    expect(store.verify(ORG).ok).toBe(true);
  });

  it("marks a permission failure as not worth retrying", async () => {
    const r = await sendOnBreak(store, ORG, pusher({
      push: async () => { throw new Error('the integration is missing the "time_clock.write" scope'); },
    }), input);
    expect(r.pushed).toBe("failed");
    expect(store.all(ORG)[1].data.retryable).toBe(false);
  });

  it("never rewrites the decision to resolve it", async () => {
    await sendOnBreak(store, ORG, pusher({ push: async () => { throw new Error("nope"); } }), input);
    // the original still says pending; the outcome is a separate event
    expect(store.all(ORG)[0].data.pushed).toBe("pending");
    expect(store.verify(ORG).ok).toBe(true);
  });
});

describe("when the integration cannot write at all", () => {
  it("records the decision and says so, rather than implying a timesheet update", async () => {
    const r = await sendOnBreak(store, ORG, pusher({ available: () => false }), input);
    expect(r.pushed).toBe("skipped");
    expect(r.outcome).toBeNull();
    expect(store.all(ORG).map((e) => e.type)).toEqual(["break.decision"]);
    expect(store.all(ORG)[0].data.pushed).toBe("skipped");
  });
});

describe("idempotency under retry", () => {
  it("does not send the same person on break twice", async () => {
    let pushes = 0;
    const p = pusher({ push: async () => { pushes++; return { ctBreakId: "ct-1" }; } });

    const a = await sendOnBreak(store, ORG, p, { ...input, clientRef: "phone-1" });
    const b = await sendOnBreak(store, ORG, p, { ...input, clientRef: "phone-1" });

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.decision.seq).toBe(a.decision.seq);
    // the crucial part: a replayed request must not push a second break
    expect(pushes).toBe(1);
    expect(store.all(ORG).filter((e) => e.type === "break.decision")).toHaveLength(1);
  });
});

describe("unresolved pushes", () => {
  it("surfaces a decision whose push never resolved", async () => {
    // a push that hangs forever, as a dropped connection would
    await sendOnBreak(store, ORG, pusher({
      push: () => new Promise((_, reject) => reject(new Error("fetch failed"))),
    }), input);
    // that one resolved (as failed), so nothing is outstanding
    expect(unresolvedPushes(store, ORG, 0)).toHaveLength(0);

    // a bare decision with no outcome is the state that must be visible
    store.append(ORG, {
      type: "break.decision",
      at: input.at,
      actor: input.actor,
      subject: input.subject,
      summary: "queued on the phone",
      data: { pushed: "pending" },
    });
    const open = unresolvedPushes(store, ORG, 0);
    expect(open).toHaveLength(1);
    expect(open[0].subject).toBe(input.subject);
  });

  it("ignores ones that are merely recent", async () => {
    store.append(ORG, {
      type: "break.decision", at: input.at, actor: input.actor,
      subject: input.subject, summary: "just now", data: { pushed: "pending" },
    });
    // five minutes is the default grace; nothing should be flagged yet
    expect(unresolvedPushes(store, ORG)).toHaveLength(0);
  });

  it("ignores skipped pushes — a read-only integration is not an outage", async () => {
    await sendOnBreak(store, ORG, pusher({ available: () => false }), input);
    expect(unresolvedPushes(store, ORG, 0)).toHaveLength(0);
  });
});
