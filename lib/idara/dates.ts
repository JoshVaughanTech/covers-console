/* ============================================================
   Narrowing a moment to the day it happened.

   ISODate is documented as "YYYY-MM-DD", and most of the system
   honours that. But events carrying a moment rather than a day — a
   break decision, and the push outcome that follows it — send a full
   ISO timestamp in the same field, and they are right to: a break at
   22:10 is not the same fact as a break "on Thursday".

   That is harmless until something compares one for chronology.
   String comparison puts "2024-05-16T12:10:00Z" after "2024-05-16",
   so a credential expiring on the 16th, checked at noon on the 16th,
   compares as already expired. The person is blocked from a shift
   they are entitled to work, and the reason shown names their
   licence — so the search starts in the wrong place entirely.

   It is the safe direction to fail in. It is still wrong, and it is
   the kind of wrong that costs somebody an afternoon proving a valid
   licence is valid.
   ============================================================ */

import type { ISODate } from "./types";

/**
 * The calendar day of an ISO date or timestamp.
 *
 * Use this before comparing two of these values for chronology. Both a bare
 * date and a full timestamp narrow to the same ten characters, so a
 * same-day comparison answers the same way whichever form arrives.
 *
 * Deliberately does not parse: `new Date(...)` would apply the runtime's
 * timezone and could shift the day, which is precisely the error this
 * exists to prevent.
 */
export function calendarDate(iso: ISODate): ISODate {
  return iso.slice(0, 10);
}

/** True when `a` falls strictly before `b`, comparing days rather than moments. */
export function isBeforeDay(a: ISODate, b: ISODate): boolean {
  return calendarDate(a) < calendarDate(b);
}
