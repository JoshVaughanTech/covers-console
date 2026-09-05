/* ============================================================
   Awards — what a worked shift was worth.

   rates.ts prices a shift somebody is being OFFERED. This prices
   one they have already WORKED, from the time clock, and the
   difference is not cosmetic:

     an offer has a rate the venue published.
     a clocked shift has no rate attached to it at all.

   Nothing in this system records what a completed shift was
   actually paid. The time clock records when somebody started and
   stopped; the award says what those hours are worth as a minimum.
   So every figure here is a FLOOR — what the law says this work is
   worth at least — and it is labelled that way everywhere it
   surfaces. Calling it "earnings" and showing it as settled money
   would be inventing the one number a worker would most reasonably
   act on.

   THE UNPAID BREAK IS PRICED WHERE IT ACTUALLY FELL.

   rates.ts takes a break as a duration and removes it from the end
   of the shift, because an offer does not know when the break will
   be. A worked shift does: the clock recorded it. So this splits
   the session into the intervals actually worked and prices each,
   which matters because the two answers differ. Deducting from the
   end removes the dearest hours — safe when the question is "may
   this be published", and the wrong direction entirely when the
   question is "what am I owed". Understating a floor cannot let an
   underpaying shift through a gate. Understating what somebody is
   owed just tells them they are owed less.

   Rest breaks are paid and stay in. Meal breaks are unpaid and come
   out. That is Table 2, not a policy choice.
   ============================================================ */

import { assess, type ShiftSession } from "./higa";
import { priceShift, RateTableRangeError, type Adder, type Band, type Level } from "./rates";
import type { EmploymentType } from "./higa";

/**
 * One run of like-priced hours in a worked shift.
 *
 * Split by adder as well as band, and carrying its own subtotal, because the
 * rows have to add up to the shift total on screen. Grouping on band alone put
 * three ordinary hours and five evening hours into one row at the dearer of
 * the two rates: 8h at $36.80 reads as $294.40 against an actual $285.55, and
 * a worker checking the arithmetic finds the screen wrong.
 *
 * The subtotal is carried rather than recomputed as hours × rate, because the
 * evening and night loadings are charged per hour OR PART of an hour — 3.5
 * evening hours attract four adders, so no single rate times hours reproduces
 * the figure.
 */
export interface EarnedBand {
  band: Band;
  /** the weekday evening or night loading, where one applied. */
  adder: Adder | null;
  hours: number;
  /** the rate these hours were paid at, loading included. */
  hourlyCents: number;
  /** what these hours came to. The rows sum to awardCents exactly. */
  cents: number;
}

export interface EarnedShift {
  /** stable within a week: one person cannot clock in twice at the same second. */
  id: string;
  role: string;
  siteName: string;
  clockIn: number;
  clockOut: number;
  /** what the clock says they were on the floor for, breaks included. */
  spanHours: number;
  /** paid hours — meal breaks removed, rest breaks kept. */
  paidHours: number;
  unpaidBreakHours: number;
  bands: EarnedBand[];
  /** the award floor for the hours worked. */
  awardCents: number;
  /**
   * cl 16.6 loading the venue owes for a meal break that was missed or late.
   * Null when none is owed — never zero, because zero and "not owed" read the
   * same on a screen and only one of them is a fact about this shift.
   */
  loading: { clause: string; hours: number; cents: number } | null;
  totalCents: number;
}

export interface EarningsPeriod {
  from: number;
  to: number;
  shifts: EarnedShift[];
  paidHours: number;
  /** floor for the hours worked, before any loading. */
  awardCents: number;
  /** cl 16.6 loading owed across the period. */
  loadingCents: number;
  totalCents: number;
  /**
   * Sessions that could not be priced — no rate table covering their dates,
   * or an unknown classification. Counted rather than dropped: a total that
   * silently omits a shift is a wrong total that looks right.
   */
  unpriced: number;
}

export interface EarningsInput {
  sessions: ShiftSession[];
  level: Level;
  employment: EmploymentType;
  timezone?: string;
  publicHolidays?: readonly string[];
}

/** The intervals actually worked: the span, minus the meal breaks taken. */
function workedIntervals(s: ShiftSession, end: number): { from: number; to: number }[] {
  const meals = s.breaks
    .filter((b) => b.kind === "meal" && b.end != null)
    .map((b) => ({ from: b.start, to: b.end as number }))
    .sort((a, b) => a.from - b.from);

  const out: { from: number; to: number }[] = [];
  let cursor = s.clockIn;
  for (const m of meals) {
    // a break recorded outside the shift is ignored rather than allowed to
    // produce a negative interval
    if (m.from > cursor && m.from < end) out.push({ from: cursor, to: Math.min(m.from, end) });
    cursor = Math.max(cursor, Math.min(m.to, end));
  }
  if (cursor < end) out.push({ from: cursor, to: end });
  return out.filter((i) => i.to > i.from);
}

/**
 * Price one completed shift.
 *
 * Returns null when it cannot be priced rather than guessing — see
 * EarningsPeriod.unpriced for why that is counted and not dropped.
 */
export function priceWorkedShift(
  s: ShiftSession,
  level: Level,
  employment: EmploymentType,
  opts: { timezone?: string; publicHolidays?: readonly string[] } = {},
): EarnedShift | null {
  if (s.clockOut == null) return null;
  const end = s.clockOut;
  if (end <= s.clockIn) return null;

  const intervals = workedIntervals(s, end);
  if (intervals.length === 0) return null;

  // keyed on band AND adder — see EarnedBand
  const byBand = new Map<string, { band: Band; adder: Adder | null; seconds: number; hourlyCents: number; cents: number }>();
  let awardCents = 0;

  try {
    for (const iv of intervals) {
      const p = priceShift({
        level,
        employment,
        start: iv.from,
        end: iv.to,
        timezone: opts.timezone,
        publicHolidays: opts.publicHolidays,
      });
      awardCents += p.floorCents;
      for (const seg of p.segments) {
        const key = `${seg.band}|${seg.adder ?? ""}`;
        const row = byBand.get(key) ?? {
          band: seg.band,
          adder: seg.adder,
          seconds: 0,
          hourlyCents: seg.effectiveHourlyCents,
          cents: 0,
        };
        row.seconds += seg.seconds;
        row.cents += seg.subtotalCents;
        byBand.set(key, row);
      }
    }
  } catch (e) {
    // no rate table for these dates: unpriceable, and said so rather than
    // reported as a shift worth nothing
    if (e instanceof RateTableRangeError) return null;
    throw e;
  }

  /* The loading the venue owes, from the same assess() the Break Board runs.
     `now` is the clock-out because the shift is closed — a completed shift's
     entitlement cannot depend on when somebody happens to open the screen. */
  const a = assess(s, end, { timezone: opts.timezone });
  const loading =
    a.penalty && a.penalty.seconds > 0 && a.penalty.estimateAud != null
      ? {
          clause: "16.6",
          hours: +(a.penalty.seconds / 3600).toFixed(2),
          cents: Math.round(a.penalty.estimateAud * 100),
        }
      : null;

  const paidSeconds = intervals.reduce((n, i) => n + (i.to - i.from), 0);
  const span = end - s.clockIn;

  return {
    id: `${s.userId}-${s.clockIn}`,
    role: s.role,
    siteName: s.siteName,
    clockIn: s.clockIn,
    clockOut: end,
    spanHours: +(span / 3600).toFixed(2),
    paidHours: +(paidSeconds / 3600).toFixed(2),
    unpaidBreakHours: +((span - paidSeconds) / 3600).toFixed(2),
    bands: [...byBand.values()]
      .map((r) => ({
        band: r.band,
        adder: r.adder,
        hours: +(r.seconds / 3600).toFixed(2),
        hourlyCents: r.hourlyCents,
        cents: r.cents,
      }))
      // biggest contribution first: what the shift was mostly made of
      .sort((x, y) => y.cents - x.cents),
    awardCents,
    loading,
    totalCents: awardCents + (loading?.cents ?? 0),
  };
}

/** Fold a period of completed shifts into what the award says they are worth. */
export function earningsFor(input: EarningsInput): EarningsPeriod {
  const closed = input.sessions
    .filter((s) => s.clockOut != null)
    .sort((a, b) => b.clockIn - a.clockIn);

  const shifts: EarnedShift[] = [];
  let unpriced = 0;

  for (const s of closed) {
    const priced = priceWorkedShift(s, input.level, input.employment, {
      timezone: input.timezone,
      publicHolidays: input.publicHolidays,
    });
    if (priced) shifts.push(priced);
    else unpriced++;
  }

  const awardCents = shifts.reduce((n, s) => n + s.awardCents, 0);
  const loadingCents = shifts.reduce((n, s) => n + (s.loading?.cents ?? 0), 0);

  return {
    from: closed.length ? Math.min(...closed.map((s) => s.clockIn)) : 0,
    to: closed.length ? Math.max(...closed.map((s) => s.clockOut as number)) : 0,
    shifts,
    paidHours: +shifts.reduce((n, s) => n + s.paidHours, 0).toFixed(2),
    awardCents,
    loadingCents,
    totalCents: awardCents + loadingCents,
    unpriced,
  };
}
