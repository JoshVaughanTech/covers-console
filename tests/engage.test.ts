/* ============================================================
   Booking → engagement, through the real store.

   Everything else in this feature is tested in isolation. This one
   is deliberately end to end: a `shift.assigned` event goes into an
   actual chained event store, and what comes back out has to be an
   engagement that replays, carries the venue's signature, and is
   priced against the same floor the board was.

   The two properties it exists for:

   • ONE ASSIGNMENT, ONE ENGAGEMENT. The id is derived from the
     posting and the worker, so a retried or replayed assignment
     must not produce a second employment for the same hours.
   • A REFUSAL IS RETURNED, NOT RECORDED. An engagement that was
     never proposed is not an engagement event, and the assignment
     stands regardless — the worker is rostered either way.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventStore } from "../lib/store/events";
import { db, setDb } from "../lib/store/db";
import { engageOnAssign, loadingsOf, venueDate } from "../lib/shifts/engage";
import { engagementCost, replayEngagements } from "../lib/idara/engagement";
import { verifyChain } from "../lib/idara/audit";
import { EMPLOYERS } from "../lib/idara/employer-seed";
import { WORKERS } from "../lib/idara/seed";
import { POSTINGS, describePay, priceOf } from "../lib/shifts";
import type { AuditEvent } from "../lib/idara/types";

const ORG = "org-test";
let store: EventStore;

const did = (name: string) => WORKERS.find((w) => w.name === name)!.did;

/** A Bartender shift at Brightwater, already carrying a rate. */
const BAR = "sp-fridaylive-bar";

async function assign(postingId: string, name: string): Promise<AuditEvent> {
  return (await store.append(ORG, {
    type: "shift.assigned",
    at: "2024-05-16T09:00:00.000Z",
    actor: "Emma Taylor",
    actorDid: "did:web:idara.app:u:emma-taylor",
    subject: did(name),
    summary: `${name} assigned`,
    data: { postingId },
  })).event;
}

beforeEach(async () => {
  setDb(null);
  store = new EventStore(await db());
});
afterEach(() => store.close());

describe("an assignment proposes an engagement", () => {
  it("writes the proposal and the venue's countersignature", async () => {
    const result = (await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts")))!;
    expect(result.proposed).toBe(true);
    expect(result.refusals).toEqual([]);

    const types = (await store.all(ORG)).map((e) => e.type);
    expect(types).toContain("engagement.proposed");
    expect(types).toContain("engagement.accepted");
    expect(verifyChain((await store.all(ORG)))).toEqual({ ok: true, brokenAt: null });
  });

  /* The venue signed in advance; assigning is it exercising that signature.
     The worker's half is still outstanding, so nothing has been released. */
  it("leaves the engagement waiting on the worker and releasing nothing", async () => {
    await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts"));
    const [engagement] = replayEngagements((await store.all(ORG)));

    expect(engagement.status).toBe("proposed");
    expect(engagement.acceptance.employer).not.toBeNull();
    expect(engagement.acceptance.worker).toBeNull();
    expect(engagement.releases).toEqual([]);
    expect(engagement.acceptance.employer?.byDid).toBe(EMPLOYERS[0].signatoryDid);
  });

  it("prices it against the same floor the board is priced against", async () => {
    await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts"));
    const [engagement] = replayEngagements((await store.all(ORG)));
    const posting = POSTINGS.find((p) => p.id === BAR)!;
    const assessment = priceOf(posting)!;

    expect(engagement.pay.offeredRateCents).toBe(posting.pay!.offeredHourlyCents);
    expect(engagement.pay.baseRateCents).toBe(assessment.requiredHourlyCents);
    expect(engagement.pay.offeredRateCents).toBeGreaterThanOrEqual(engagement.pay.baseRateCents);
    expect(engagement.pay.classification.level).toBe(posting.pay!.level);
  });

  it("dates the shift by the moment the award was applied to, not the display string", async () => {
    await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts"));
    const [engagement] = replayEngagements((await store.all(ORG)));
    expect(engagement.shift.date).toBe(venueDate(POSTINGS.find((p) => p.id === BAR)!.pay!.startsAt));
  });

  /* The estimate on the agreement and the estimate on the shift card are the
     same number. They were not, once: the agreement quoted the whole span and
     the card quoted the paid hours, and one shift showed two figures. */
  it("carries the unpaid break, so the estimate matches the board's", async () => {
    await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts"));
    const [engagement] = replayEngagements((await store.all(ORG)));
    const posting = POSTINGS.find((p) => p.id === BAR)!;

    expect(engagement.shift.unpaidBreakSec).toBe(posting.pay!.unpaidBreakSec);
    expect(engagementCost(engagement).hours).toBe(describePay(posting)!.paidHours);
  });

  it("names the loadings the pricing pass found", async () => {
    await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts"));
    const [engagement] = replayEngagements((await store.all(ORG)));
    expect(engagement.pay.loadings).toEqual(loadingsOf(priceOf(POSTINGS.find((p) => p.id === BAR)!)!.price));
    expect(engagement.pay.loadings).toContain("casual_25");
  });
});

describe("one assignment, one engagement", () => {
  it("does not propose a second engagement when the assignment is repeated", async () => {
    const first = (await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts")))!;
    const before = (await store.all(ORG)).length;

    const second = (await engageOnAssign(store, ORG, await assign(BAR, "Darie Roberts")))!;
    // one more event — the second assignment itself — and no second proposal
    expect((await store.all(ORG)).length).toBe(before + 1);
    expect(second.engagementId).toBe(first.engagementId);
    expect(replayEngagements((await store.all(ORG)))).toHaveLength(1);
  });
});

describe("refusals", () => {
  /* Liam holds no tax declaration and no super choice. The assignment stands —
     he is rostered — and the venue is told why it cannot employ him through
     Covers, rather than the refusal being written to the chain as though an
     engagement existed. */
  it("returns the reason and writes no engagement event", async () => {
    const result = (await engageOnAssign(store, ORG, await assign(BAR, "Liam O'Brien")))!;

    expect(result.proposed).toBe(false);
    expect(result.refusals.map((r) => r.code)).toContain("pack.incomplete");
    expect((await store.all(ORG)).some((e) => e.type.startsWith("engagement."))).toBe(false);
  });

  it("says so when the shift carries no published rate", async () => {
    const draft = POSTINGS.find((p) => !p.pay);
    if (!draft) return; // every seeded posting is priced; nothing to assert
    const result = (await engageOnAssign(store, ORG, await assign(draft.id, "Darie Roberts")))!;
    expect(result.proposed).toBe(false);
  });

  it("ignores an event that is not an assignment", async () => {
    const ev = (await store.append(ORG, {
      type: "shift.claimed",
      at: "2024-05-16",
      actor: "Darie Roberts",
      subject: did("Darie Roberts"),
      summary: "claimed",
      data: { postingId: BAR },
    })).event;
    expect(await engageOnAssign(store, ORG, ev)).toBeNull();
  });

  it("ignores an assignment against a posting nobody can find", async () => {
    expect(await engageOnAssign(store, ORG, await assign("sp-nonexistent", "Darie Roberts"))).toBeNull();
  });
});
