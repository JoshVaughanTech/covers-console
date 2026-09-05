/* ============================================================
   What was actually worked, joined to what was agreed.

   An engagement says what somebody was employed to do. The time
   clock says what they did. Confirmation is the moment those two
   are reconciled and the venue is invoiced, so this module is
   where a mistake turns into money.

   THE MATCH IS THE WHOLE PROBLEM, and it is not equality. People
   clock in early, clock out late, and cover for each other; a
   roster window and a clock session almost never share a boundary.
   So the join asks how much of the AGREED shift a session actually
   covers — a majority, or it is not that shift — and only then uses
   the nearest clock-in to rank what qualifies.

   AND IT REFUSES TO GUESS. Two sessions equally near the start is a
   double shift, a split shift, or a clock-out somebody forgot — and
   the three want different answers. Matching either one would
   confirm real hours against the wrong agreement, which is an
   invoice nobody can unpick later because both halves look right in
   isolation. Ambiguity returns null and the venue is asked.

   Nothing here writes. It reads the clock, reads the chain, and
   answers "what is confirmable"; the event is written by the route,
   because appending is a decision and this is arithmetic.
   ============================================================ */

import { assess, type ShiftSession } from "@/lib/awards";
import { engagementCost, type Engagement, type EngagementCost } from "@/lib/idara/engagement";

/**
 * The clock keys people as "w:darie-roberts"; Idara keys them as
 * "did:web:idara.app:w:darie-roberts". One prefix apart, and written here
 * rather than inline so the one place the two id spaces meet is findable.
 */
export const clockIdOf = (did: string): string => did.replace(/^did:web:idara\.app:/, "");

/**
 * How much of the agreed shift a session has to cover to BE that shift.
 *
 * A majority, and the ratio is the primary gate rather than a tie-breaker.
 * The first version of this used proximity — a clock-in within six hours of
 * the agreed start — and that admitted a session sharing two hours of an
 * eight-hour shift, because it was the only candidate and "near enough". Two
 * hours is not that shift; it is somebody else's afternoon that happened to
 * end during it.
 *
 * Overlap answers the question proximity only approximates: did this person
 * work the hours that were agreed? A long session that swallows the whole
 * agreed window still matches at 100% however early it started, which is
 * right — a double shift covering the roster is the roster worked.
 */
export const MIN_OVERLAP_RATIO = 0.5;

/** The venue has this long to confirm before the hours stand on their own. */
export const AUTO_CONFIRM_SEC = 48 * 3600;

export interface Loading {
  clause: "16.6";
  seconds: number;
  minutes: number;
  /** integer cents, or null when the session carries no rate to price it. */
  estimateCents: number | null;
}

export interface WorkedShift {
  engagementId: string;
  engagement: Engagement;
  session: ShiftSession;
  clockIn: number;
  clockOut: number;
  /** paid hours from the clock, less any unpaid break actually taken. */
  hours: number;
  /** hours the agreement planned, for the variance the venue is confirming. */
  plannedHours: number;
  breaksTaken: number;
  /** what cl 16.6 says the venue owes for a break that was not given. */
  loading: Loading | null;
  cost: EngagementCost;
  /** when the venue's window to confirm runs out. */
  autoConfirmAt: number;
  /** true once that window has passed and nobody has confirmed. */
  dueForAutoConfirm: boolean;
}

/** Why an engagement has no confirmable hours, when it has none. */
export type UnmatchedReason = "no_session" | "ambiguous" | "still_open";

export interface Unmatched {
  engagementId: string;
  engagement: Engagement;
  reason: UnmatchedReason;
  /** the candidates, when the reason is that there were too many. */
  candidates: ShiftSession[];
}

/**
 * The completed session that is this engagement's shift, or null.
 *
 * Exported because the refusal is worth testing directly: a matcher that
 * silently picks one of two plausible sessions passes every test that only
 * checks the happy path.
 */
export function matchSession(
  engagement: Engagement,
  sessions: readonly ShiftSession[],
): { session: ShiftSession } | { session: null; reason: UnmatchedReason; candidates: ShiftSession[] } {
  const clockId = clockIdOf(engagement.workerDid);
  const { startsAt, endsAt } = engagement.shift;

  const mine = sessions.filter((s) => s.userId === clockId);
  if (mine.length === 0) return { session: null, reason: "no_session", candidates: [] };

  const completed = mine.filter((s) => s.clockOut != null);
  if (completed.length === 0) {
    // they are on it right now, or forgot to clock out. Either way the hours
    // are still moving and confirming would freeze a number mid-shift
    return { session: null, reason: "still_open", candidates: mine };
  }

  /* Overlap is the gate, and it is a share of the agreed shift rather than any
     overlap at all. A session that clips the end of the window is not this
     shift, however close its clock-in happens to land. */
  const agreed = Math.max(1, endsAt - startsAt);
  const overlapOf = (s: ShiftSession) =>
    Math.max(0, Math.min(s.clockOut as number, endsAt) - Math.max(s.clockIn, startsAt));

  const touching = completed.filter((s) => overlapOf(s) > 0);
  const near = touching.filter((s) => overlapOf(s) / agreed >= MIN_OVERLAP_RATIO);
  if (near.length === 0) return { session: null, reason: "no_session", candidates: touching };
  if (near.length === 1) return { session: near[0] };

  const distance = (s: ShiftSession) => Math.abs(s.clockIn - startsAt);
  const ranked = [...near].sort((a, b) => distance(a) - distance(b));

  /* A tie is a question, not a coin toss. Two sessions the same distance from
     the agreed start is a split shift, a double, or a missed clock-out, and
     those three want different answers from a person who was there. */
  if (distance(ranked[0]) === distance(ranked[1])) {
    return { session: null, reason: "ambiguous", candidates: ranked };
  }
  return { session: ranked[0] };
}

/** Seconds of break actually taken and closed on a session. */
function breakSecondsTaken(session: ShiftSession): number {
  return session.breaks.reduce(
    (total, b) => (b.end != null ? total + (b.end - b.start) : total),
    0,
  );
}

/**
 * Turn a matched session into the figures a confirmation records.
 *
 * Paid hours are the clock span less the unpaid break that was actually taken
 * — from the clock, never from the roster's plan. The plan is what somebody
 * intended; a person who worked through their break worked those minutes, and
 * confirming the planned deduction would be the venue keeping the difference.
 */
export function describeWorked(
  engagement: Engagement,
  session: ShiftSession,
  now: number,
  timezone?: string,
): WorkedShift {
  const clockIn = session.clockIn;
  const clockOut = session.clockOut as number;
  const paidSeconds = clockOut - clockIn - breakSecondsTaken(session);
  const hours = +(paidSeconds / 3600).toFixed(2);

  const a = assess(session, now, timezone ? { timezone } : undefined);
  const penalty = a.penalty && a.penalty.seconds > 0 ? a.penalty : null;

  return {
    engagementId: engagement.id,
    engagement,
    session,
    clockIn,
    clockOut,
    hours,
    plannedHours: +(
      (engagement.shift.endsAt - engagement.shift.startsAt - (engagement.shift.unpaidBreakSec ?? 0)) /
      3600
    ).toFixed(2),
    breaksTaken: session.breaks.filter((b) => b.end != null).length,
    loading: penalty
      ? {
          clause: "16.6",
          seconds: penalty.seconds,
          minutes: Math.round(penalty.seconds / 60),
          /* null rather than zero where the session carries no rate. A missing
             price is not a price of nothing, and the report module already
             makes this distinction — hours count, dollars must not. */
          estimateCents:
            penalty.estimateAud != null ? Math.round(penalty.estimateAud * 100) : null,
        }
      : null,
    // the money follows the CONFIRMED hours, not the planned ones
    cost: engagementCost(engagement, hours),
    autoConfirmAt: clockOut + AUTO_CONFIRM_SEC,
    dueForAutoConfirm: now >= clockOut + AUTO_CONFIRM_SEC,
  };
}

export interface TimesheetInput {
  engagements: readonly Engagement[];
  sessions: readonly ShiftSession[];
  now: number;
  timezone?: string;
}

export interface Timesheet {
  /** engagements the clock can price, whether or not anyone has confirmed. */
  worked: WorkedShift[];
  /** engagements past their signing that the clock cannot yet answer for. */
  unmatched: Unmatched[];
}

/**
 * Everything confirmable, and everything that should be and isn't.
 *
 * Only engagements that reached `provisioned` are considered. Before that the
 * worker is not on the venue's payroll, so there is nothing for confirmed
 * hours to be paid through — and an engagement still waiting on a signature
 * whose shift somehow got worked is a problem to raise, not to invoice.
 *
 * `unmatched` is returned rather than dropped. A shift that was agreed, ran,
 * and has no hours against it is the one case a venue must see; silently
 * omitting it would make the screen calmest exactly when something is wrong.
 */
export function timesheet(input: TimesheetInput): Timesheet {
  const { engagements, sessions, now, timezone } = input;
  const worked: WorkedShift[] = [];
  const unmatched: Unmatched[] = [];

  for (const e of engagements) {
    if (e.status === "cancelled" || e.status === "proposed" || e.status === "accepted") continue;
    // nothing to reconcile until the shift has actually finished
    if (e.shift.endsAt > now) continue;

    const m = matchSession(e, sessions);
    if (m.session) {
      worked.push(describeWorked(e, m.session, now, timezone));
    } else {
      unmatched.push({ engagementId: e.id, engagement: e, reason: m.reason, candidates: m.candidates });
    }
  }

  return {
    worked: worked.sort((a, b) => b.clockOut - a.clockOut),
    unmatched,
  };
}

/** Worked shifts nobody has confirmed yet. */
export function awaitingConfirmation(sheet: Timesheet): WorkedShift[] {
  return sheet.worked.filter((w) => w.engagement.status !== "confirmed");
}

/**
 * The ones the 48-hour rule now confirms on the venue's behalf.
 *
 * The rule exists so a worker is not left unpaid by a manager who is on
 * holiday, and it is deliberately the CLOCK's numbers that stand — the venue
 * had two days to disagree with them and did not.
 */
export function dueForAutoConfirm(sheet: Timesheet): WorkedShift[] {
  return awaitingConfirmation(sheet).filter((w) => w.dueForAutoConfirm);
}
