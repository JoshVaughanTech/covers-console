/* ============================================================
   Where a completed shift comes from.

   One answer to "what does the time clock say", because there are
   now two callers who must not disagree: the weekly break-loading
   report, which tells payroll what the venue owes, and hour
   confirmation, which tells payroll what to pay. Those two reading
   the clock differently would be two accounts of the same shift,
   and the venue would be invoiced against one of them.

   The live/demo fork lives here rather than at each call site for
   the same reason. It is a fork with a real hazard in it: with no
   Connecteam credentials the app serves seeded sessions, and a
   caller that forgot the fork would present demo hours as somebody's
   worked hours. So the fork is in one place and every reader is
   told which it got — `live` is on the result, not inferred.

   Not a cache. Each call asks the clock. Hours are the thing this
   product is least entitled to be stale about.
   ============================================================ */

import { ConnecteamClient } from "./connecteam";
import { DEMO_WEEK, DEMO_WEEK_SESSIONS, type ShiftSession } from "@/lib/awards";

const TZ = process.env.TZ_VENUE ?? "Australia/Melbourne";

export interface ClockRead {
  sessions: ShiftSession[];
  /** true when these came from Connecteam; false when they are the seed. */
  live: boolean;
}

/**
 * Is a real time clock configured?
 *
 * Three states, not two, and the third is why this throws.
 *
 * NOTHING SET is the demo: seeded sessions, `live: false` on every result, and
 * a warning printed by anything that acts on them.
 *
 * FULLY SET is Connecteam.
 *
 * PARTLY SET is somebody halfway through wiring it up, and returning false
 * there would answer "somebody asked and got it wrong" as though it were
 * "nobody asked" — the same mistake the pack vault made with its key, and the
 * one sinkFromEnv() already decided about sign-in codes. It matters more here
 * than it looks: confirmation reads this, so a half-configured clock would
 * settle SEEDED hours as somebody's worked hours and invoice a venue for them.
 */
export function clockConfigured(): boolean {
  const clock = process.env.CONNECTEAM_TIME_CLOCK_ID;
  const key = process.env.CONNECTEAM_API_KEY;
  const id = process.env.CONNECTEAM_CLIENT_ID;
  const secret = process.env.CONNECTEAM_CLIENT_SECRET;

  const credentials = Boolean(key || (id && secret));
  if (clock && credentials) return true;

  const anything = Boolean(clock || key || id || secret);
  if (!anything) return false;

  const missing = [
    !clock && "CONNECTEAM_TIME_CLOCK_ID",
    !credentials && "CONNECTEAM_API_KEY (or CLIENT_ID and CLIENT_SECRET)",
  ].filter(Boolean);

  throw new Error(
    `The time clock is half-configured: ${missing.join(" and ")} missing. ` +
      `Set them, or unset the rest — falling back to seeded sessions here would ` +
      `confirm demo hours as somebody's worked hours.`,
  );
}

function client(): ConnecteamClient {
  return new ConnecteamClient({
    clientId: process.env.CONNECTEAM_CLIENT_ID,
    clientSecret: process.env.CONNECTEAM_CLIENT_SECRET,
    apiKey: process.env.CONNECTEAM_API_KEY,
    timeClockId: process.env.CONNECTEAM_TIME_CLOCK_ID as string,
    timezone: TZ,
    siteName: process.env.CONNECTEAM_SITE_NAME ?? "",
  });
}

/**
 * Sessions that started inside one week.
 *
 * The weekly report's read, unchanged: with no clock configured it serves the
 * seeded week and only when the week asked for IS the seeded week. Asking for
 * any other week returns nothing rather than the seed, so a report for March
 * cannot come back holding last week's shifts with March's dates on it.
 */
export async function sessionsInWeek(week: { start: number; end: number }): Promise<ClockRead> {
  if (!clockConfigured()) {
    return {
      sessions: week.start === DEMO_WEEK.start ? DEMO_WEEK_SESSIONS : [],
      live: false,
    };
  }
  const all = await client().sessions(week.end, true);
  return {
    sessions: all.filter((s) => s.clockIn >= week.start && s.clockIn < week.end),
    live: true,
  };
}

/**
 * Completed sessions near a moment — what hour confirmation reads.
 *
 * Only sessions with a clock-out. A shift somebody is still on has no hours to
 * confirm, and including it would let a confirmation be written against a
 * number that is still moving.
 */
export async function completedSessions(at = Math.floor(Date.now() / 1000)): Promise<ClockRead> {
  if (!clockConfigured()) {
    return { sessions: DEMO_WEEK_SESSIONS.filter((s) => s.clockOut != null), live: false };
  }
  const all = await client().sessions(at, true);
  return { sessions: all.filter((s) => s.clockOut != null), live: true };
}
