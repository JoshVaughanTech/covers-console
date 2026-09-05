/* ============================================================
   Casual conversion.

   The rule this suite is protecting is that the flag is honest in
   both directions. A signal that fires too readily sends a venue
   into a conversation it does not owe; one that never fires leaves
   an employer obligation invisible until somebody is at a tribunal
   describing the pattern from memory.

   So the tests fix the two edges — the six-month mark and the
   thirty-day notice — and then check the three things that must
   never count: a proposal nobody signed, a cancelled engagement,
   and shifts spread across two employers being added together as
   though they were one relationship.
   ============================================================ */
import { describe, it, expect } from "vitest";
import {
  CONVERSION_DAYS,
  CONVERSION_NOTICE_DAYS,
  conversionEvent,
  conversionSignals,
} from "../lib/idara/conversion";
import type { Engagement, EngagementStatus } from "../lib/idara/engagement";

const EMPLOYER = "did:web:idara.app:o:brightwater";
const OTHER = "did:web:idara.app:o:portside-group";
const WORKER = "did:web:idara.app:w:mitch-egan";
const NOW = "2026-09-05";

/** `n` days before NOW, as a calendar date. */
function daysBefore(n: number): string {
  const d = new Date(`${NOW}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function engagement(
  date: string,
  over: { signed?: boolean; status?: EngagementStatus; employerDid?: string } = {},
): Engagement {
  const signed = over.signed ?? true;
  return {
    id: `eng-${date}-${over.employerDid ?? EMPLOYER}`,
    workerDid: WORKER,
    employerDid: over.employerDid ?? EMPLOYER,
    postingId: `p-${date}`,
    shift: {
      siteId: "s-brightwater",
      date,
      start: "17:00",
      end: "23:00",
      role: "Bartender",
      startsAt: 0,
      endsAt: 21600,
    },
    pay: {
      classification: { level: 2, stream: "food_and_beverage" },
      baseRateCents: 4062,
      offeredRateCents: 4150,
      loadings: [],
      superRate: 0.12,
    },
    employment: {
      firstEngagementWithEmployer: false,
      claimsTaxFreeThreshold: true,
      agreementTemplateVersion: "casual-higa-v1",
    },
    packSnapshot: {},
    employerProfileHash: "hash",
    proposedAt: date,
    acceptance: {
      worker: signed ? { at: date, eventHash: "h-w" } : null,
      employer: { at: date, eventHash: "h-e" },
    },
    releases: [],
    status: over.status ?? "confirmed",
  };
}

/** A shift every week from `startDaysAgo` up to today — a regular casual. */
function weekly(startDaysAgo: number, over = {}): Engagement[] {
  const shifts: Engagement[] = [];
  for (let d = startDaysAgo; d >= 0; d -= 7) shifts.push(engagement(daysBefore(d), over));
  return shifts;
}

describe("when it fires", () => {
  it("says eligible once six months of regular work have passed", () => {
    const [signal] = conversionSignals(weekly(CONVERSION_DAYS + 7), NOW);
    expect(signal.state).toBe("eligible");
    expect(signal.daysEngaged).toBeGreaterThanOrEqual(CONVERSION_DAYS);
    expect(signal.detail).toMatch(/pathway is open/i);
  });

  /* Thirty days of warning, so it is a conversation rather than a deadline. */
  it("says approaching inside the notice window", () => {
    const [signal] = conversionSignals(weekly(CONVERSION_DAYS - 10), NOW);
    expect(signal.state).toBe("approaching");
    expect(signal.detail).toMatch(/Six months in \d+ days/);
  });

  it("says nothing before the notice window opens", () => {
    expect(conversionSignals(weekly(CONVERSION_DAYS - CONVERSION_NOTICE_DAYS - 5), NOW)).toEqual([]);
  });

  /* Low on purpose. This is the threshold for MENTIONING it to two people,
     not for granting anything — and set high it misses the casual who works
     every second Saturday for a year, who is the person the pathway is for. */
  it("counts a fortnightly pattern as a pattern", () => {
    const fortnightly = Array.from({ length: 14 }, (_, i) =>
      engagement(daysBefore(CONVERSION_DAYS + 7 - i * 14)),
    );
    const [signal] = conversionSignals(fortnightly, NOW);
    expect(signal).toBeTruthy();
    expect(signal.weeksWorkedInWindow).toBeGreaterThanOrEqual(6);
  });

  it("says nothing about somebody who worked twice last winter", () => {
    const sporadic = [engagement(daysBefore(200)), engagement(daysBefore(190))];
    expect(conversionSignals(sporadic, NOW)).toEqual([]);
  });
});

describe("what it refuses to count", () => {
  it("ignores a proposal the worker never signed", () => {
    expect(conversionSignals(weekly(CONVERSION_DAYS + 7, { signed: false }), NOW)).toEqual([]);
  });

  it("ignores cancelled engagements", () => {
    expect(
      conversionSignals(weekly(CONVERSION_DAYS + 7, { status: "cancelled" as const }), NOW),
    ).toEqual([]);
  });

  /* Six months at one venue is the obligation. Three months each at two is
     not, and adding them together would invent one. */
  it("keeps two employers apart rather than adding them together", () => {
    const here = weekly(CONVERSION_DAYS + 7);
    const there = weekly(90, { employerDid: OTHER });
    const signals = conversionSignals([...here, ...there], NOW);

    expect(signals.map((s) => s.employerDid)).toEqual([EMPLOYER]);
    // and the count is this venue's shifts alone, not both venues' added up
    expect(signals[0].shifts).toBe(here.length);
  });
});

describe("the event it writes", () => {
  it("dates itself when it was noticed, and keeps the pattern in data", () => {
    const [signal] = conversionSignals(weekly(CONVERSION_DAYS + 7), NOW);
    const ev = conversionEvent(signal, "Mitch Egan", NOW);

    expect(ev.type).toBe("conversion.flagged");
    // when it was noticed, not when the pattern started — an event dated
    // before the engagements that caused it reads as out of order
    expect(ev.at).toBe(NOW);
    expect(ev.data?.since).toBe(signal.since);
    // nobody did this; it fell out of the pattern
    expect(ev.actor).toBe("system");
    expect(ev.subject).toBe(WORKER);
  });
});
