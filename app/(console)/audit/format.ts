/* ============================================================
   Rendering an audit event for the eye.

   Colocated with the page rather than in lib/, because it is
   presentation for this screen and nothing else depends on it. It
   lives outside page.tsx because a Next App Router page module may
   only export the route's own contract — a named export there is a
   build error, not a style preference.
   ============================================================ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Render an event's `at` as a date.
 *
 * Takes only the first ten characters, because `at` is not always a bare
 * calendar date. AuditEvent.at is typed ISODate and documented as
 * "YYYY-MM-DD", but the events carrying a moment rather than a day — a break
 * decision, and the push outcome that follows it — send a full timestamp, and
 * they are right to: a break at 22:10 is not the same fact as a break "on
 * Thursday". Splitting the whole string on "-" made the day "16T12:10:00Z",
 * and every one of those events rendered as "NaN May 2024" — on the one
 * screen whose entire job is to be believable.
 */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
