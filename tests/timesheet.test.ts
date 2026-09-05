/* ============================================================
   Reconciling an agreement against a time clock.

   This is where a mistake becomes money, so the suite is weighted
   towards the join rather than the arithmetic. A matcher that picks
   the wrong session confirms real hours against the wrong agreement
   and invoices a venue for them, and both halves look right in
   isolation afterwards — there is nothing left to notice.

   So the tests that matter most are the ones where it must REFUSE:
   two equally plausible sessions, a session that overlaps nothing,
   a shift somebody is still on. Each of those wants a person, and
   the module's job is to say so rather than to pick.
   ============================================================ */
import { describe, it, expect } from "vitest";
import {
  AUTO_CONFIRM_SEC,
  MIN_OVERLAP_RATIO,
  awaitingConfirmation,
  clockIdOf,
  describeWorked,
  dueForAutoConfirm,
  matchSession,
  timesheet,
} from "../lib/shifts/timesheet";
import { BOOKING_FEE_RATE, SUPER_GUARANTEE_RATE, type Engagement, type EngagementStatus } from "../lib/idara/engagement";
import type { ShiftSession } from "../lib/awards";

const WORKER = "did:web:idara.app:w:darie-roberts";
const CLOCK = "w:darie-roberts";
const H = 3600;

/** A Tuesday close: 16:00 for 8h, with a 30-minute unpaid break planned. */
const START = 1_756_900_800;
const END = START + 8 * H;
const NOW = END + 3 * H;

function engagement(over: Partial<Engagement> = {}): Engagement {
  return {
    id: "eng-test",
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
      superRate: SUPER_GUARANTEE_RATE,
    },
    employment: {
      firstEngagementWithEmployer: true,
      claimsTaxFreeThreshold: true,
      agreementTemplateVersion: "casual-higa-v1",
    },
    packSnapshot: {},
    employerProfileHash: "hash",
    proposedAt: "2026-08-30",
    acceptance: { worker: { at: "x", eventHash: "w" }, employer: { at: "x", eventHash: "e" } },
    releases: [],
    status: "provisioned" as EngagementStatus,
    ...over,
  };
}

function session(over: Partial<ShiftSession> = {}): ShiftSession {
  return {
    userId: CLOCK,
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
  };
}

describe("the id spaces", () => {
  it("maps an Idara did to the clock's user id", () => {
    expect(clockIdOf(WORKER)).toBe(CLOCK);
  });
});

describe("matching a session to an agreement", () => {
  it("takes the one that overlaps", () => {
    const m = matchSession(engagement(), [session()]);
    expect(m.session).not.toBeNull();
  });

  it("tolerates clocking in early and out late", () => {
    const m = matchSession(engagement(), [
      session({ clockIn: START - 20 * 60, clockOut: END + 40 * 60 }),
    ]);
    expect(m.session?.clockIn).toBe(START - 20 * 60);
  });

  it("ignores another worker's session", () => {
    const m = matchSession(engagement(), [session({ userId: "w:aaron-patel" })]);
    expect(m.session).toBeNull();
    expect(m).toMatchObject({ reason: "no_session" });
  });

  /* Overlap is a hard gate, not a tie-breaker. Without it the only session in
     the list wins by default, and a shift from another day gets confirmed
     against this agreement. */
  it("refuses a session that overlaps nothing, even as the only candidate", () => {
    const m = matchSession(engagement(), [
      session({ clockIn: END + 24 * H, clockOut: END + 32 * H }),
    ]);
    expect(m.session).toBeNull();
  });

  /* The case that made the rule. A first version gated on proximity — a
     clock-in within six hours of the agreed start — and this session passed
     it: Priya's 10:00–18:00 against a 16:00–00:00 close, sharing two hours of
     eight. Two hours is not that shift; it is somebody else's afternoon that
     happened to end during it. */
  it("refuses a session that only clips the end of the agreed shift", () => {
    const m = matchSession(engagement(), [
      session({ clockIn: START - 6 * H, clockOut: START + 2 * H }),
    ]);
    expect(m.session).toBeNull();
    expect(m).toMatchObject({ reason: "no_session" });
  });

  it("takes a long session that swallows the whole agreed shift", () => {
    // a double, covering the roster from well before it started
    const m = matchSession(engagement(), [
      session({ clockIn: START - 6 * H, clockOut: END }),
    ]);
    expect(m.session).not.toBeNull();
  });

  it("needs a majority of the agreed shift, not just most of the session", () => {
    const agreed = END - START;
    const justUnder = session({ clockIn: START, clockOut: START + Math.floor(agreed * MIN_OVERLAP_RATIO) - 60 });
    const justOver = session({ clockIn: START, clockOut: START + Math.ceil(agreed * MIN_OVERLAP_RATIO) + 60 });
    expect(matchSession(engagement(), [justUnder]).session).toBeNull();
    expect(matchSession(engagement(), [justOver]).session).not.toBeNull();
  });

  it("prefers the session starting nearest the agreed start", () => {
    const m = matchSession(engagement(), [
      session({ clockIn: START + 2 * H, clockOut: END }),
      session({ clockIn: START + 5 * 60, clockOut: END }),
    ]);
    expect(m.session?.clockIn).toBe(START + 5 * 60);
  });

  /* The test this module exists for. A tie is a split shift, a double, or a
     clock-out somebody forgot, and those three want different answers from a
     person who was there. Picking either would be an invoice nobody can unpick
     later, because both halves look right on their own. */
  it("refuses to choose between two equally near sessions", () => {
    // both cover most of the agreed shift, and both start an hour off it —
    // one before, one after. Nothing in the data prefers either
    const m = matchSession(engagement(), [
      session({ clockIn: START - H, clockOut: END - H }),
      session({ clockIn: START + H, clockOut: END + H }),
    ]);
    expect(m.session).toBeNull();
    expect(m).toMatchObject({ reason: "ambiguous" });
    if (m.session === null) expect(m.candidates).toHaveLength(2);
  });

  it("says so when somebody is still clocked in rather than guessing an end", () => {
    const m = matchSession(engagement(), [session({ clockOut: null })]);
    expect(m.session).toBeNull();
    expect(m).toMatchObject({ reason: "still_open" });
  });
});

describe("what a confirmation records", () => {
  /* The clock's break, never the roster's plan. Somebody who worked through
     their break worked those minutes, and deducting the planned half hour
     would be the venue keeping the difference. */
  it("pays the break that was not taken", () => {
    const w = describeWorked(engagement(), session({ breaks: [] }), NOW);
    expect(w.hours).toBe(8);
    expect(w.plannedHours).toBe(7.5);
    expect(w.breaksTaken).toBe(0);
  });

  it("deducts a break that was taken", () => {
    const w = describeWorked(
      engagement(),
      session({ breaks: [{ kind: "meal", start: START + 3 * H, end: START + 3.5 * H }] }),
      NOW,
    );
    expect(w.hours).toBe(7.5);
    expect(w.breaksTaken).toBe(1);
  });

  it("ignores a break nobody closed — it is not evidence of a break taken", () => {
    const w = describeWorked(
      engagement(),
      session({ breaks: [{ kind: "meal", start: START + 3 * H, end: null }] }),
      NOW,
    );
    expect(w.hours).toBe(8);
    expect(w.breaksTaken).toBe(0);
  });

  it("prices the money off the CONFIRMED hours, not the planned ones", () => {
    const w = describeWorked(engagement(), session({ breaks: [] }), NOW);
    expect(w.cost.wagesCents).toBe(4150 * 8);
    expect(w.cost.bookingFeeCents).toBe(Math.round(4150 * 8 * BOOKING_FEE_RATE));
    expect(w.cost.superCents).toBe(Math.round(4150 * 8 * SUPER_GUARANTEE_RATE));
  });

  /* An 8h shift with no meal break is a cl 16.6 breach, and the loading is the
     venue's own figure from the same assess() the Break Board runs. */
  it("carries the cl 16.6 loading for a break that was never given", () => {
    const w = describeWorked(engagement(), session({ breaks: [] }), NOW);
    expect(w.loading).not.toBeNull();
    expect(w.loading?.clause).toBe("16.6");
    expect(w.loading?.minutes).toBeGreaterThan(0);
  });

  it("carries no loading for a clean shift", () => {
    const w = describeWorked(
      engagement(),
      session({ breaks: [{ kind: "meal", start: START + 3 * H, end: START + 3.5 * H }] }),
      NOW,
    );
    expect(w.loading).toBeNull();
  });

  /* A missing price is not a price of nothing. The report module already draws
     this line — hours count, dollars must not — and confirmation has to draw
     it the same way or the two disagree about the same shift. */
  it("reports loading minutes with no dollars when the session carries no rate", () => {
    const w = describeWorked(engagement(), session({ breaks: [], ordinaryHourlyRate: null }), NOW);
    expect(w.loading?.minutes).toBeGreaterThan(0);
    expect(w.loading?.estimateCents).toBeNull();
  });
});

describe("the sheet", () => {
  it("leaves a shift alone until it has finished", () => {
    const sheet = timesheet({ engagements: [engagement()], sessions: [session()], now: START + H });
    expect(sheet.worked).toEqual([]);
    expect(sheet.unmatched).toEqual([]);
  });

  /* Nothing is released to a payroll before provisioning, so there is nothing
     for confirmed hours to be paid through. A shift that somehow ran against
     an unsigned engagement is a problem to raise, not an invoice to send. */
  it("ignores engagements that never reached payroll", () => {
    for (const status of ["proposed", "accepted", "cancelled"] as const) {
      const sheet = timesheet({
        engagements: [engagement({ status })],
        sessions: [session()],
        now: NOW,
      });
      expect(sheet.worked, status).toEqual([]);
    }
  });

  it("reports a shift that ran with no clock-in against it", () => {
    const sheet = timesheet({ engagements: [engagement()], sessions: [], now: NOW });
    expect(sheet.worked).toEqual([]);
    expect(sheet.unmatched[0].reason).toBe("no_session");
  });

  it("counts an already-confirmed shift as worked but no longer awaiting", () => {
    const sheet = timesheet({
      engagements: [engagement({ status: "confirmed" })],
      sessions: [session()],
      now: NOW,
    });
    expect(sheet.worked).toHaveLength(1);
    expect(awaitingConfirmation(sheet)).toEqual([]);
  });
});

describe("the 48-hour rule", () => {
  it("is not due while the venue's window is open", () => {
    const sheet = timesheet({
      engagements: [engagement()],
      sessions: [session()],
      now: END + AUTO_CONFIRM_SEC - H,
    });
    expect(sheet.worked[0].dueForAutoConfirm).toBe(false);
    expect(dueForAutoConfirm(sheet)).toEqual([]);
  });

  it("is due once it has closed", () => {
    const sheet = timesheet({
      engagements: [engagement()],
      sessions: [session()],
      now: END + AUTO_CONFIRM_SEC + 1,
    });
    expect(dueForAutoConfirm(sheet)).toHaveLength(1);
  });

  /* The window runs from the CLOCK-OUT, not from the rostered end. A shift
     that ran three hours over gives the venue 48 hours from when it actually
     finished, which is when there was something to look at. */
  it("counts from the clock-out rather than the rostered end", () => {
    const late = session({ clockOut: END + 3 * H });
    const sheet = timesheet({
      engagements: [engagement()],
      sessions: [late],
      now: END + AUTO_CONFIRM_SEC + H,
    });
    expect(sheet.worked[0].autoConfirmAt).toBe(END + 3 * H + AUTO_CONFIRM_SEC);
    expect(dueForAutoConfirm(sheet)).toEqual([]);
  });

  it("never auto-confirms something already confirmed", () => {
    const sheet = timesheet({
      engagements: [engagement({ status: "confirmed" })],
      sessions: [session()],
      now: END + AUTO_CONFIRM_SEC + H,
    });
    expect(dueForAutoConfirm(sheet)).toEqual([]);
  });
});
