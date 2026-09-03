/* ============================================================
   GET /api/breaks/week?start=&end= — closed ShiftSessions for the
   weekly loading report. Live when CONNECTEAM_API_KEY is set, demo
   seed otherwise.

   Serves raw sessions, not a computed report: the fold lives in
   lib/awards/report.ts so the page, the CSV and the test suite all
   run the identical code. Unlike /api/breaks this is not polled —
   a completed week does not change — so there is no cache TTL.
   ============================================================ */
import { NextResponse } from "next/server";
import { DEMO_WEEK, DEMO_WEEK_SESSIONS, lastCompleteWeek } from "@/lib/awards";
import { ConnecteamClient } from "@/lib/integrations/connecteam";

export const dynamic = "force-dynamic";

let client: ConnecteamClient | null = null;

const CT = {
  clientId: process.env.CONNECTEAM_CLIENT_ID,
  clientSecret: process.env.CONNECTEAM_CLIENT_SECRET,
  apiKey: process.env.CONNECTEAM_API_KEY,
  timeClockId: process.env.CONNECTEAM_TIME_CLOCK_ID,
};
/** Live needs a time clock plus one of the two credential shapes. */
const isLive = Boolean(CT.timeClockId && (CT.apiKey || (CT.clientId && CT.clientSecret)));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const now = Math.floor(Date.now() / 1000);
  const fallback = lastCompleteWeek(now, process.env.TZ_VENUE ?? "Australia/Melbourne");
  const start = Number(url.searchParams.get("start")) || fallback.start;
  const end = Number(url.searchParams.get("end")) || fallback.end;

  const live = isLive;

  if (!live) {
    // the seed covers exactly one week; asking for another returns an honest empty
    const sessions = start === DEMO_WEEK.start ? DEMO_WEEK_SESSIONS : [];
    return NextResponse.json({ mode: "demo", start, end, sessions });
  }

  client ??= new ConnecteamClient({
    clientId: CT.clientId,
    clientSecret: CT.clientSecret,
    apiKey: CT.apiKey,
    timeClockId: CT.timeClockId as string,
    schedulerId: process.env.CONNECTEAM_SCHEDULER_ID ?? null,
    timezone: process.env.TZ_VENUE ?? "Australia/Melbourne",
    siteName: process.env.CONNECTEAM_SITE_NAME ?? "",
  });

  try {
    const sessions = await client.sessions(end, true);
    return NextResponse.json({
      mode: "live",
      start,
      end,
      sessions: sessions.filter((s) => s.clockIn >= start && s.clockIn < end),
    });
  } catch (e) {
    // never fall back to demo data here — a silent zero is a payroll claim
    return NextResponse.json({ mode: "error", error: (e as Error).message, start, end, sessions: [] }, { status: 502 });
  }
}
