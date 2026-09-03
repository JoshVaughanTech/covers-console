/* ============================================================
   Turning a roster row into what Idara is asked about.

   Colocated with the page but kept out of it so it can be tested:
   this is the function that decides which shifts the eligibility
   engine sees and what each one involves, and it is exactly the kind
   of computed, filtered list where an empty duty array appears
   without anyone deciding it should.
   ============================================================ */
import { shiftAssignment, type WorkFunction } from "@/lib/idara";
import type { DutiedShift } from "@/lib/idara/duties";

/** Shift ids, used when a reason needs to name the day it came from. */
export const DAY_IDS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Display value for a day not worked. */
export const OFF = "—";

/** One shift in the week: when it is, and what it is. */
export interface Shift {
  /** display time, or OFF for a day off */
  time: string;
  /**
   * What this shift actually is, when it isn't what the job title implies.
   * Idara checks the assignment, and it checks it per shift — someone can be
   * fine behind the bar all week and ineligible for Saturday's gaming shift.
   */
  duties?: WorkFunction[];
  label?: string;
}

/** A rostered staff member, keyed by the name Idara knows them by. */
export interface CrewRow {
  name: string;
  shifts: Shift[];
  total: string;
}

/**
 * The shifts Idara is asked about for one person.
 *
 * Days off are dropped: an unworked shift cannot make anyone ineligible, and
 * including it would invent a question nobody asked.
 *
 * Each surviving shift is built through shiftAssignment() rather than as an
 * object literal. An empty duty array reaching decide() asserts the shift
 * involves no regulated work, which silently unbinds every appliesTo
 * requirement — a bartender with `duties: []` needs no RSA. The constructor
 * collapses empty to undefined, which falls back to the job title and
 * over-gates instead: wrong in the direction someone notices.
 */
export function shiftsOf(c: CrewRow): DutiedShift[] {
  return c.shifts
    .map((sh, i) => ({ id: DAY_IDS[i], duties: sh.duties, off: sh.time === OFF }))
    .filter((sh) => !sh.off)
    .map(({ id, duties }) => shiftAssignment(id, duties));
}

/** A week of shifts from display times, with per-day assignment overrides. */
export function week(
  times: string[],
  special: Record<number, { duties: WorkFunction[]; label: string }> = {},
): Shift[] {
  return times.map((time, i) => ({ time, ...(special[i] ?? {}) }));
}
