/* ============================================================
   Confirmation, through the real chain.

   The route is thin on purpose — auth, then timesheet(), then
   confirmedEvent(), then append. What is worth testing is the
   composition of those, against an actual event store, because the
   two properties that matter only exist end to end:

   • CONFIRMING TWICE BILLS ONCE. Everything upstream of this can be
     retried harmlessly; this one invoices somebody. The clientRef
     is keyed on the engagement rather than the caller, so the venue
     confirming and the 48-hour sweep arriving together produce one
     event.
   • THE MONEY IS RECORDED, NOT DERIVED LATER. What was charged is a
     fact about a moment. A fee recomputed on read would move if the
     rate on the engagement ever did.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventStore } from "../lib/store/events";
import {
  BOOKING_FEE_RATE,
  acceptedEvent,
  confirmedEvent,
  proposedEvent,
  provisionedEvent,
  replayEngagements,
  type Engagement,
} from "../lib/idara/engagement";
import { verifyChain } from "../lib/idara/audit";
import { awaitingConfirmation, describeWorked, timesheet } from "../lib/shifts/timesheet";
import type { ShiftSession } from "../lib/awards";

const ORG = "org-test";
const WORKER = "did:web:idara.app:w:darie-roberts";
const H = 3600;
const START = 1_756_900_800;
const END = START + 8 * H;
const NOW = END + 3 * H;

let store: EventStore;
beforeEach(() => {
  store = new EventStore(":memory:");
});
afterEach(() => store.close());

const engagement = (): Engagement => ({
  id: "eng-confirm",
  workerDid: WORKER,
  employerDid: "did:web:idara.app:o:brightwater",
  postingId: "sp-lastweek-close",
  shift: {
    siteId: "s-brightwater",
    date: "2026-09-01",
    start: "16:00",
    end: "00:00",
    role: "Bartender",
    startsAt: START,
    endsAt: END,
    unpaidBreakSec: 30 * 60,
  },
  pay: {
    classification: { level: 2, stream: "food_and_beverage" },
    baseRateCents: 3680,
    offeredRateCents: 4150,
    loadings: ["casual_25", "evening"],
    superRate: 0.12,
  },
  employment: {
    firstEngagementWithEmployer: true,
    claimsTaxFreeThreshold: true,
    agreementTemplateVersion: "casual-higa-v1",
  },
  packSnapshot: {},
  employerProfileHash: "hash",
  proposedAt: "2026-08-30",
  acceptance: { worker: null, employer: null },
  releases: [],
  status: "proposed",
});

const session = (over: Partial<ShiftSession> = {}): ShiftSession => ({
  userId: "w:darie-roberts",
  name: "Darie Roberts",
  role: "Bartender",
  siteName: "Brightwater Hotel",
  employmentType: "casual",
  ordinaryHourlyRate: 33.85,
  clockIn: START,
  clockOut: END,
  plannedEnd: END,
  breaks: [],
  ...over,
});

/** Everything up to the point where hours can be confirmed. */
function provisioned(): Engagement {
  const e = engagement();
  store.append(ORG, proposedEvent(e, "Emma Taylor"));
  store.append(ORG, acceptedEvent(e, "employer", { at: "2026-08-30", actor: "Emma Taylor" }));
  store.append(ORG, acceptedEvent(e, "worker", { at: "2026-08-30", actor: "Darie Roberts", actorDid: WORKER }));
  store.append(
    ORG,
    provisionedEvent(e, {
      at: "2026-08-30",
      actor: "Brightwater Hospitality",
      connector: "mock",
      released: ["identity", "bank_account", "super_choice", "emergency_contact", "tfn_declaration"],
    }),
  );
  return replayEngagements(store.all(ORG))[0];
}

/** What the route does: match, then write, keyed on the engagement. */
function confirmVia(e: Engagement, via: "venue" | "auto", s = session()) {
  const w = describeWorked(e, s, NOW);
  return store.append(
    ORG,
    confirmedEvent(e, {
      at: new Date(NOW * 1000).toISOString(),
      actor: via === "auto" ? "system" : "Emma Taylor",
      hours: w.hours,
      breaks: w.breaksTaken,
      via,
      ...(w.loading ? { loadingMinutes: w.loading.minutes } : {}),
      ...(w.loading?.estimateCents != null ? { loadingCents: w.loading.estimateCents } : {}),
    }),
    { clientRef: `engagement:confirmed:${e.id}` },
  );
}

describe("confirming", () => {
  it("moves the engagement to confirmed and keeps the chain intact", () => {
    const e = provisioned();
    expect(e.status).toBe("provisioned");

    confirmVia(e, "venue");
    const after = replayEngagements(store.all(ORG))[0];

    expect(after.status).toBe("confirmed");
    expect(verifyChain(store.all(ORG))).toEqual({ ok: true, brokenAt: null });
  });

  it("records the clock's hours, the plan, and the gap between them", () => {
    const e = provisioned();
    const { event } = confirmVia(e, "venue");

    expect(event.data.hours).toBe(8);
    expect(event.data.plannedHours).toBe(7.5);
    // the number a manager scanning the trail actually looks for
    expect(event.data.varianceHours).toBe(0.5);
    expect(event.data.breaks).toBe(0);
  });

  it("records the money at the moment it was charged", () => {
    const e = provisioned();
    const { event } = confirmVia(e, "venue");

    expect(event.data.wagesCents).toBe(4150 * 8);
    expect(event.data.bookingFeeCents).toBe(Math.round(4150 * 8 * BOOKING_FEE_RATE));
  });

  it("carries the cl 16.6 loading for the break he never got", () => {
    const e = provisioned();
    const { event } = confirmVia(e, "venue");
    expect(Number(event.data.loadingMinutes)).toBeGreaterThan(0);
  });

  /* The two are different facts. "The venue agreed these hours" is somebody
     looking at a timesheet; "the venue did not disagree in 48 hours" is a
     deadline. A dispute that turns on whether anybody actually checked has to
     be able to tell them apart. */
  it("says which of the two settled it, in the data and in the summary", () => {
    const venue = confirmVia(provisioned(), "venue");
    expect(venue.event.data.via).toBe("venue");
    expect(venue.event.summary).toMatch(/^Hours confirmed/);

    store.close();
    store = new EventStore(":memory:");
    const auto = confirmVia(provisioned(), "auto");
    expect(auto.event.data.via).toBe("auto");
    expect(auto.event.summary).toMatch(/auto-confirmed after 48h/);
    expect(auto.event.actor).toBe("system");
  });
});

describe("confirming twice", () => {
  /* The property this whole feature rests on. Everything upstream can be
     retried harmlessly; this one bills somebody. */
  it("writes one event and charges one fee", () => {
    const e = provisioned();
    const first = confirmVia(e, "venue");
    const second = confirmVia(e, "venue");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.seq).toBe(first.event.seq);
    expect(store.all(ORG).filter((x) => x.type === "engagement.confirmed")).toHaveLength(1);
  });

  it("keeps the venue's confirmation when the sweep arrives after it", () => {
    const e = provisioned();
    confirmVia(e, "venue");
    const sweep = confirmVia(e, "auto");

    // the sweep is a no-op, and the record still says a person agreed
    expect(sweep.created).toBe(false);
    const confirmations = store.all(ORG).filter((x) => x.type === "engagement.confirmed");
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].data.via).toBe("venue");
  });
});

describe("what the sheet offers the route", () => {
  /* The route confirms what awaitingConfirmation() hands it, so this is the
     list that decides whether a Confirm button can bill twice. */
  it("stops offering an engagement once it is confirmed", () => {
    const e = provisioned();
    const before = timesheet({ engagements: [e], sessions: [session()], now: NOW });
    expect(awaitingConfirmation(before).map((w) => w.engagementId)).toEqual([e.id]);

    confirmVia(e, "venue");
    const after = replayEngagements(store.all(ORG));
    const sheet = timesheet({ engagements: after, sessions: [session()], now: NOW });

    expect(sheet.worked[0].engagement.status).toBe("confirmed");
    expect(awaitingConfirmation(sheet)).toEqual([]);
  });
});
