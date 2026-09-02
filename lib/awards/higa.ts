/* ============================================================
   Awards — Hospitality Industry (General) Award 2020 [MA000009]
   Clause 16 "Breaks", consolidated to 27 Aug 2024.
   Source: https://awards.fairwork.gov.au/MA000009.html

   This is a rules pack in the same spirit as lib/idara/hospitality.ts:
   the console never reasons about breaks itself — it hands a shift
   to assess() and renders what comes back. The module is pure and
   isomorphic (no I/O, no Date.now()), so the API route, the browser
   and the test suite all run the identical code.

   Table 2 — Entitlements to meal and rest break(s)
     >5h ≤6h   elective unpaid meal ≤30 min, employee requests in writing (16.4)
     >6h ≤8h   unpaid meal ≥30 min, after the first 2h and within the first 6h
     >8h ≤10h  + one 20 min paid rest (may be 2 × 10)
     >10h      + two 20 min paid rests
   16.3   breaks spread evenly across the shift
   16.5/6 no meal by the 6h mark on a >6h shift → +50% of ordinary hourly
          rate from 6h until the break is given or the shift ends
   16.7a  >5h continuous after the unpaid meal → additional 20 min paid rest
   11.2   casual: max 12h per shift
   ============================================================ */

const H = 3600;
const M = 60;

export const HIGA = {
  awardId: "MA000009",
  awardLabel: "Hospitality Industry (General) Award 2020",
  consolidatedTo: "2024-08-27",
  MEAL_EARLIEST: 2 * H,
  MEAL_DEADLINE: 6 * H,
  MEAL_MIN: 30 * M,
  REST_LEN: 20 * M,
  REST_THRESHOLD_1: 8 * H,
  REST_THRESHOLD_2: 10 * H,
  ELECTIVE_THRESHOLD: 5 * H,
  MEAL_MANDATORY_THRESHOLD: 6 * H,
  CONTINUOUS_AFTER_MEAL_MAX: 5 * H,
  CASUAL_MAX_SHIFT: 12 * H,
  MISSED_MEAL_LOADING: 0.5,
  DUE_SOON_WINDOW: 60 * M,
} as const;

export type BreakKind = "meal" | "rest";
export type EmploymentType = "full_time" | "part_time" | "casual";

export interface ShiftBreak {
  kind: BreakKind;
  /** epoch seconds */
  start: number;
  /** epoch seconds; null while still on break */
  end: number | null;
}

/** One person's clock-in, as the console sees it. Epoch seconds throughout. */
export interface ShiftSession {
  userId: string;
  name: string;
  role: string;
  siteName: string;
  clockIn: number;
  /** null / undefined while still on shift */
  clockOut?: number | null;
  /** rostered end, if the punch is linked to a scheduled shift */
  plannedEnd?: number | null;
  breaks: ShiftBreak[];
  employmentType?: EmploymentType | null;
  /** AUD — only used for the penalty estimate */
  ordinaryHourlyRate?: number | null;
}

/** 0 clear · 1 note · 2 due · 3 overdue (penalty accruing) */
export type Severity = 0 | 1 | 2 | 3;

export type AlertCode =
  | "MEAL_OVERDUE"
  | "MEAL_MISSED"
  | "MEAL_DUE_SOON"
  | "MEAL_TOO_EARLY"
  | "MEAL_LATE_HISTORIC"
  | "ELECTIVE_ZONE"
  | "REST_DUE"
  | "ADDITIONAL_REST_DUE"
  | "ADDITIONAL_REST_SOON"
  | "CASUAL_12H";

export interface BreakAlert {
  severity: Severity;
  code: AlertCode;
  clause: string;
  text: string;
}

export type MealState =
  | "none"
  | "elective"
  | "not_yet"
  | "window_open"
  | "due_soon"
  | "overdue"
  | "in_progress"
  | "taken";

export type RequirementState = MealState | "pending" | "due";

export interface BreakRequirement {
  kind: "meal" | "rest" | "additional_rest";
  label: string;
  clause: string;
  state: RequirementState;
  windowOpen?: number;
  deadline?: number;
  takenAt?: number | null;
  required?: number;
  credited?: number;
  suggestedAt?: number[];
}

export interface PenaltyBlock {
  clause: "16.6";
  loading: string;
  accruing: boolean;
  from: number;
  to: number | null;
  seconds: number;
  /** AUD per hour of loading, when a rate is known */
  loadingPerHour: number | null;
  estimateAud: number | null;
}

export interface Bracket {
  label: string;
  meal: "none" | "elective" | "mandatory";
  rests: 0 | 1 | 2;
}

export interface BreakAssessment {
  userId: string;
  name: string;
  role: string;
  siteName: string;
  employmentType: EmploymentType | null;
  onShift: boolean;
  onBreak: { kind: BreakKind; since: number } | null;
  clockIn: number;
  plannedEnd: number | null;
  elapsedSec: number;
  expectedSec: number;
  bracket: Bracket;
  breaks: ShiftBreak[];
  meal: { state: MealState; earliestAt: number; deadlineAt: number; takenAt: number | null; endedAt: number | null };
  rests: { required: number; credited: number };
  penalty: PenaltyBlock | null;
  requirements: BreakRequirement[];
  alerts: BreakAlert[];
  severity: Severity;
  nextAction: string;
}

export interface AssessOptions {
  timezone?: string;
}

/* ---------- helpers ---------- */

export function fmtClock(ts: number, tz = "Australia/Melbourne"): string {
  return new Date(ts * 1000).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
}

/** "6:20" style elapsed formatting. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / H);
  const m = Math.floor((s % H) / M);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Roster wins; otherwise the shift is "at least as long as it's been". */
export function expectedShiftLength(session: ShiftSession, now: number): number {
  const end = session.clockOut ?? now;
  const elapsed = end - session.clockIn;
  if (session.plannedEnd) return Math.max(session.plannedEnd - session.clockIn, elapsed);
  return elapsed;
}

/** Table 2 bracket for a shift length in seconds. */
export function bracket(lengthSec: number): Bracket {
  if (lengthSec > HIGA.REST_THRESHOLD_2) return { label: ">10h", meal: "mandatory", rests: 2 };
  if (lengthSec > HIGA.REST_THRESHOLD_1) return { label: ">8h–10h", meal: "mandatory", rests: 1 };
  if (lengthSec > HIGA.MEAL_MANDATORY_THRESHOLD) return { label: ">6h–8h", meal: "mandatory", rests: 0 };
  if (lengthSec > HIGA.ELECTIVE_THRESHOLD) return { label: ">5h–6h", meal: "elective", rests: 0 };
  return { label: "≤5h", meal: "none", rests: 0 };
}

const PRIORITY: AlertCode[] = [
  "MEAL_OVERDUE",
  "ADDITIONAL_REST_DUE",
  "CASUAL_12H",
  "MEAL_DUE_SOON",
  "ADDITIONAL_REST_SOON",
  "REST_DUE",
];
const rank = (c: AlertCode) => {
  const i = PRIORITY.indexOf(c);
  return i < 0 ? 99 : i;
};

function penaltyBlock(secs: number, session: ShiftSession, from: number, to: number | null, accruing: boolean): PenaltyBlock {
  const rate = session.ordinaryHourlyRate ?? null;
  const loadingPerHour = rate != null ? rate * HIGA.MISSED_MEAL_LOADING : null;
  return {
    clause: "16.6",
    loading: "+50% of ordinary hourly rate",
    accruing,
    from,
    to,
    seconds: Math.max(0, secs),
    loadingPerHour,
    estimateAud: loadingPerHour != null ? +((Math.max(0, secs) / H) * loadingPerHour).toFixed(2) : null,
  };
}

/** cl 16.3 "spread evenly" — midpoints of the work blocks either side of the meal. */
function suggestRestTimes(session: ShiftSession, expected: number, meal: ShiftBreak | null, count: number): number[] {
  const start = session.clockIn;
  const finish = session.clockIn + expected;
  if (count === 1) {
    if (meal && meal.end != null) {
      const pre = meal.start - start;
      const post = finish - meal.end;
      return post >= pre ? [meal.end + post / 2] : [start + pre / 2];
    }
    const assumedMealEnd = start + 4 * H + HIGA.MEAL_MIN;
    return [assumedMealEnd + (finish - assumedMealEnd) / 2];
  }
  const mealStart = meal ? meal.start : start + 4 * H;
  const mealEnd = meal && meal.end != null ? meal.end : mealStart + HIGA.MEAL_MIN;
  return [start + (mealStart - start) / 2, mealEnd + (finish - mealEnd) / 2].sort((a, b) => a - b);
}

/* ---------- the engine ---------- */

export function assess(session: ShiftSession, now: number, opts: AssessOptions = {}): BreakAssessment {
  const tz = opts.timezone ?? "Australia/Melbourne";
  const onShift = session.clockOut == null;
  const end = session.clockOut ?? now;
  const elapsed = end - session.clockIn;
  const expected = expectedShiftLength(session, now);
  const br = bracket(expected);

  const breaks = [...session.breaks].sort((a, b) => a.start - b.start);
  const onBreak = breaks.find((b) => b.end == null) ?? null;

  const meal =
    breaks.find((b) => b.kind === "meal" && (b.end == null || b.end - b.start >= HIGA.MEAL_MIN)) ?? null;
  const mealTakenAt = meal ? meal.start : null;
  const mealEndedAt = meal && meal.end != null ? meal.end : null;

  const restsTaken = breaks.filter((b): b is ShiftBreak & { end: number } => b.kind === "rest" && b.end != null);
  const restSecondsTaken = restsTaken.reduce((s, b) => s + (b.end - b.start), 0);
  const restsCredited = Math.floor(restSecondsTaken / HIGA.REST_LEN);

  const alerts: BreakAlert[] = [];
  const requirements: BreakRequirement[] = [];

  const mealEarliestAt = session.clockIn + HIGA.MEAL_EARLIEST;
  const mealDeadlineAt = session.clockIn + HIGA.MEAL_DEADLINE;

  let mealState: MealState = "none";
  let penalty: PenaltyBlock | null = null;

  if (br.meal === "mandatory") {
    if (meal) {
      mealState = meal.end == null ? "in_progress" : "taken";
      if (meal.start < mealEarliestAt) {
        alerts.push({ severity: 1, code: "MEAL_TOO_EARLY", clause: "16.2", text: `Meal break started before the 2h mark (${fmtClock(meal.start, tz)}). The award says after the first 2 hours.` });
      }
      if (meal.start > mealDeadlineAt) {
        penalty = penaltyBlock(meal.start - mealDeadlineAt, session, mealDeadlineAt, meal.start, false);
        alerts.push({ severity: 1, code: "MEAL_LATE_HISTORIC", clause: "16.6", text: `Meal break given late — 50% loading applies ${fmtClock(mealDeadlineAt, tz)}–${fmtClock(meal.start, tz)}.` });
      }
    } else if (elapsed < HIGA.MEAL_EARLIEST) {
      mealState = "not_yet";
    } else if (elapsed < HIGA.MEAL_DEADLINE - HIGA.DUE_SOON_WINDOW) {
      mealState = "window_open";
    } else if (elapsed < HIGA.MEAL_DEADLINE) {
      mealState = "due_soon";
      const mins = Math.ceil((mealDeadlineAt - now) / M);
      alerts.push({ severity: 2, code: "MEAL_DUE_SOON", clause: "16.2", text: `Unpaid meal break must start by ${fmtClock(mealDeadlineAt, tz)} — ${mins} min left.` });
    } else {
      mealState = "overdue";
      if (onShift) {
        penalty = penaltyBlock(now - mealDeadlineAt, session, mealDeadlineAt, null, true);
        alerts.push({ severity: 3, code: "MEAL_OVERDUE", clause: "16.5", text: `Meal break overdue since ${fmtClock(mealDeadlineAt, tz)}. 50% loading is accruing until they are sent on break.` });
      } else {
        penalty = penaltyBlock(end - mealDeadlineAt, session, mealDeadlineAt, end, false);
        alerts.push({ severity: 1, code: "MEAL_MISSED", clause: "16.6", text: `No meal break on a >6h shift — 50% loading owed ${fmtClock(mealDeadlineAt, tz)}–${fmtClock(end, tz)}.` });
      }
    }
    requirements.push({ kind: "meal", label: "Unpaid meal break ≥30 min", clause: "16.2", state: mealState, windowOpen: mealEarliestAt, deadline: mealDeadlineAt, takenAt: mealTakenAt });
  } else if (br.meal === "elective") {
    mealState = meal ? "taken" : "elective";
    requirements.push({ kind: "meal", label: "Elective unpaid meal break (≤30 min, on request)", clause: "16.4", state: mealState, takenAt: mealTakenAt });
    if (!meal && onShift && !session.plannedEnd) {
      alerts.push({ severity: 1, code: "ELECTIVE_ZONE", clause: "16.4", text: "Past 5h with no meal break and no roster attached. Becomes mandatory if the shift passes 6h." });
    }
  }

  const restsRequired = br.rests;
  const restsOutstanding = Math.max(0, restsRequired - restsCredited);
  if (restsRequired > 0) {
    const suggestions = suggestRestTimes(session, expected, meal, restsRequired).filter((_, i) => i >= restsCredited);
    const nextSuggested = suggestions[0] ?? null;
    let restState: RequirementState = restsOutstanding === 0 ? "taken" : "pending";
    if (restsOutstanding > 0 && nextSuggested != null && now >= nextSuggested && onShift) {
      restState = "due";
      alerts.push({ severity: 2, code: "REST_DUE", clause: "16.2", text: `Paid rest break due (${restsOutstanding} of ${restsRequired} outstanding). Suggested slot was ${fmtClock(nextSuggested, tz)}.` });
    }
    requirements.push({
      kind: "rest",
      label: `${restsRequired} × 20 min paid rest${restsRequired > 1 ? "s" : ""} (each may be 2 × 10)`,
      clause: "16.2",
      state: restState,
      required: restsRequired,
      credited: restsCredited,
      suggestedAt: suggestions,
    });
  }

  if (mealEndedAt != null && onShift) {
    const restsAfterMeal = restsTaken.filter((b) => b.start >= mealEndedAt);
    const lastRestEnd = restsAfterMeal.length ? Math.max(...restsAfterMeal.map((b) => b.end)) : null;
    const anchor = lastRestEnd ?? mealEndedAt;
    const continuous = now - anchor;
    const deadline = anchor + HIGA.CONTINUOUS_AFTER_MEAL_MAX;
    if (continuous > HIGA.CONTINUOUS_AFTER_MEAL_MAX) {
      alerts.push({ severity: 3, code: "ADDITIONAL_REST_DUE", clause: "16.7(a)", text: "Over 5h continuous since the meal break — an additional 20 min paid rest is owed now." });
      requirements.push({ kind: "additional_rest", label: "Additional 20 min paid rest", clause: "16.7(a)", state: "overdue", deadline });
    } else if (continuous > HIGA.CONTINUOUS_AFTER_MEAL_MAX - HIGA.DUE_SOON_WINDOW) {
      const mins = Math.ceil((deadline - now) / M);
      alerts.push({ severity: 2, code: "ADDITIONAL_REST_SOON", clause: "16.7(a)", text: `Approaching 5h continuous since the meal break — extra paid rest needed by ${fmtClock(deadline, tz)} (${mins} min).` });
      requirements.push({ kind: "additional_rest", label: "Additional 20 min paid rest", clause: "16.7(a)", state: "due_soon", deadline });
    }
  }

  if (session.employmentType === "casual" && elapsed > HIGA.CASUAL_MAX_SHIFT - HIGA.DUE_SOON_WINDOW) {
    const over = elapsed > HIGA.CASUAL_MAX_SHIFT;
    alerts.push({ severity: over ? 3 : 2, code: "CASUAL_12H", clause: over ? "11.4" : "11.2", text: over ? "Casual has exceeded the 12h/shift cap — overtime rates apply." : "Casual approaching the 12h/shift cap." });
  }

  alerts.sort((a, b) => b.severity - a.severity || rank(a.code) - rank(b.code));
  const severity: Severity = alerts.length ? alerts[0].severity : 0;

  return {
    userId: session.userId,
    name: session.name,
    role: session.role,
    siteName: session.siteName,
    employmentType: session.employmentType ?? null,
    onShift,
    onBreak: onBreak ? { kind: onBreak.kind, since: onBreak.start } : null,
    clockIn: session.clockIn,
    plannedEnd: session.plannedEnd ?? null,
    elapsedSec: elapsed,
    expectedSec: expected,
    bracket: br,
    breaks,
    meal: { state: mealState, earliestAt: mealEarliestAt, deadlineAt: mealDeadlineAt, takenAt: mealTakenAt, endedAt: mealEndedAt },
    rests: { required: restsRequired, credited: restsCredited },
    penalty,
    requirements,
    alerts,
    severity,
    nextAction: nextAction(alerts, mealState, restsOutstanding, onBreak, br, mealEarliestAt, tz),
  };
}

function nextAction(
  alerts: BreakAlert[],
  mealState: MealState,
  restsOutstanding: number,
  onBreak: ShiftBreak | null,
  br: Bracket,
  mealEarliestAt: number,
  tz: string,
): string {
  if (onBreak) return `On ${onBreak.kind} break since ${fmtClock(onBreak.start, tz)}.`;
  if (alerts.length && alerts[0].severity >= 2) return alerts[0].text;
  if (mealState === "elective") return "Past 5h with no meal break — becomes mandatory (and penalised) past 6h. Plan it now.";
  if (mealState === "not_yet") return `Meal window opens ${fmtClock(mealEarliestAt, tz)}.`;
  if (mealState === "window_open") return "Meal window open — send whenever service allows.";
  if (restsOutstanding > 0) return `${restsOutstanding} paid rest break${restsOutstanding > 1 ? "s" : ""} still to schedule.`;
  if (br.meal === "none") return "No break entitlement yet (≤5h).";
  return "All breaks covered.";
}

export function assessAll(sessions: ShiftSession[], now: number, opts?: AssessOptions): BreakAssessment[] {
  return sessions.map((s) => assess(s, now, opts)).sort((a, b) => b.severity - a.severity || b.elapsedSec - a.elapsedSec);
}

export interface BoardSummary {
  onShift: number;
  onBreak: number;
  dueNow: number;
  overdue: number;
  penaltyAud: number;
}

export function summariseBoard(staff: BreakAssessment[]): BoardSummary {
  return {
    onShift: staff.filter((s) => s.onShift).length,
    onBreak: staff.filter((s) => s.onBreak).length,
    dueNow: staff.filter((s) => s.severity === 2).length,
    overdue: staff.filter((s) => s.severity === 3).length,
    penaltyAud: +staff.reduce((a, s) => a + (s.penalty?.estimateAud ?? 0), 0).toFixed(2),
  };
}
