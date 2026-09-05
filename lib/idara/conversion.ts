/* ============================================================
   Idara — casual conversion, read off the chain.

   A casual who has worked a regular pattern for one employer for
   six months can ask to become permanent, and the employer has to
   answer. That is the employer's obligation, not ours — but the
   venue has just handed us its record of who worked when, which
   makes us the only party that can see the pattern forming.

   So this FLAGS and never decides. Whether a pattern is "regular
   and systematic" is a judgement with case law behind it, and code
   that answered it would be code quietly issuing legal opinions
   about somebody's employment status. What this can say without
   guessing is arithmetic: this person has worked here in N of the
   last M weeks, since this date, and the six-month mark is close.

   Both sides see it, which is the point. A worker who does not
   know the pathway exists cannot use it, and a venue that finds out
   at the tribunal finds out too late.

   Deliberately not modelled: the small-business twelve-month
   threshold, and the exclusions. Those change the date this fires,
   and a date computed from a fact nobody recorded (headcount) would
   be worse than a flag that says "check this".
   ============================================================ */

import { calendarDate } from "./dates";
import { daysBetween } from "./standing";
import type { Engagement } from "./engagement";
import type { DID, ISODate } from "./types";
import type { NewAuditEvent } from "./audit";

/** The employee-choice pathway opens at six months. */
export const CONVERSION_DAYS = 183;

/** How early to raise it, so it is a conversation rather than a deadline. */
export const CONVERSION_NOTICE_DAYS = 30;

/** Weeks looked back over when asking whether the pattern is a regular one. */
export const PATTERN_WINDOW_WEEKS = 12;

/**
 * How much work counts as a pattern worth flagging.
 *
 * Half the weeks in the window, which is low on purpose: this is the
 * threshold for MENTIONING it to two people, not for granting anything. Set
 * high, it misses the casual who works every second Saturday for a year —
 * who is exactly the person the pathway was written for.
 */
export const PATTERN_MIN_WEEK_RATIO = 0.5;

export type ConversionState = "approaching" | "eligible";

export interface ConversionSignal {
  workerDid: DID;
  employerDid: DID;
  /** first engagement with this employer that was actually signed. */
  since: ISODate;
  daysEngaged: number;
  shifts: number;
  /** distinct ISO weeks worked inside the look-back window. */
  weeksWorkedInWindow: number;
  windowWeeks: number;
  state: ConversionState;
  /** one sentence, safe to render to either side as-is. */
  detail: string;
}

/** The ISO week a date falls in, as a sortable key. Ties a pattern to weeks. */
function weekKey(iso: ISODate): string {
  const d = new Date(`${calendarDate(iso)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Conversion signals for every worker/employer pair the chain describes.
 *
 * Only engagements the worker actually signed and that were not cancelled
 * count. A proposal nobody accepted is not work, and counting it would start
 * somebody's six months on a shift they never took.
 */
export function conversionSignals(engagements: Engagement[], at: ISODate): ConversionSignal[] {
  const worked = engagements.filter(
    (e) => e.status !== "cancelled" && e.acceptance.worker !== null,
  );

  const pairs = new Map<string, Engagement[]>();
  for (const e of worked) {
    const key = `${e.workerDid}|${e.employerDid}`;
    pairs.set(key, [...(pairs.get(key) ?? []), e]);
  }

  const windowStartDays = PATTERN_WINDOW_WEEKS * 7;
  const signals: ConversionSignal[] = [];

  for (const [key, list] of pairs) {
    const [workerDid, employerDid] = key.split("|");
    const dates = list.map((e) => calendarDate(e.shift.date)).sort();
    const since = dates[0];
    const daysEngaged = daysBetween(since, at);

    if (daysEngaged < CONVERSION_DAYS - CONVERSION_NOTICE_DAYS) continue;

    const inWindow = dates.filter((d) => daysBetween(d, at) <= windowStartDays);
    const weeksWorkedInWindow = new Set(inWindow.map(weekKey)).size;
    if (weeksWorkedInWindow < PATTERN_WINDOW_WEEKS * PATTERN_MIN_WEEK_RATIO) continue;

    const state: ConversionState = daysEngaged >= CONVERSION_DAYS ? "eligible" : "approaching";
    const daysToGo = CONVERSION_DAYS - daysEngaged;

    signals.push({
      workerDid,
      employerDid,
      since,
      daysEngaged,
      shifts: list.length,
      weeksWorkedInWindow,
      windowWeeks: PATTERN_WINDOW_WEEKS,
      state,
      detail:
        state === "eligible"
          ? `Worked ${list.length} shifts here since ${since}, in ${weeksWorkedInWindow} of the last ${PATTERN_WINDOW_WEEKS} weeks. Past six months — the employee-choice pathway is open.`
          : `Worked ${list.length} shifts here since ${since}, in ${weeksWorkedInWindow} of the last ${PATTERN_WINDOW_WEEKS} weeks. Six months in ${daysToGo} days.`,
    });
  }

  return signals.sort((a, b) => b.daysEngaged - a.daysEngaged);
}

export function conversionEvent(
  signal: ConversionSignal,
  workerName: string,
  at: ISODate,
): NewAuditEvent {
  return {
    type: "conversion.flagged",
    // when it was noticed, not when the pattern started. `since` is the fact
    // and lives in data; putting it in `at` would date an event to before the
    // engagements that caused it, and the log would read as out of order
    at,
    // nobody did this; it fell out of the pattern, and the actor should say so
    actor: "system",
    subject: signal.workerDid,
    summary: `Casual conversion ${signal.state === "eligible" ? "available" : "approaching"} — ${workerName}`,
    data: {
      employerDid: signal.employerDid,
      since: signal.since,
      shifts: signal.shifts,
      weeksWorkedInWindow: signal.weeksWorkedInWindow,
      state: signal.state,
    },
  };
}
