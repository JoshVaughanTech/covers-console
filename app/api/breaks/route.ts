/* ============================================================
   GET /api/breaks — raw ShiftSessions for the Break Compliance board.
   Live when CONNECTEAM_API_KEY is set, demo seed otherwise. The
   award engine runs in the browser against these sessions so the
   clocks tick every second without re-hitting Connecteam.
   ============================================================ */
import { NextResponse } from "next/server";
import { operatorOf, workerOf } from "@/lib/auth/session";
import { DEMO_SESSIONS, demoNow } from "@/lib/awards";
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
let cache: { at: number; sessions: unknown[] } = { at: 0, sessions: [] };
const TTL_MS = Number(process.env.CONNECTEAM_POLL_SECONDS ?? 30) * 1000;

export async function GET(req: Request) {
  /* Who is on the floor right now, which is live venue data: names, clock-in
     times, and by extension who is overdue a break.
  
     Both kinds, and both named. A supervisor reads this on their phone and the
     console reads it on the breaks board, so operator-only would break the
     floor. Writing it as two calls rather than one "is anyone signed in" is the
     distinction that matters: the dangerous question was the one a function
     could answer without telling you the kind. This route means both, and says
     so.
  
     Until now it asked nothing at all, and the middleware's redirect was the
     only thing in front of it — which made a file documented as "not a gate"
     into the gate for this data. */
  if (!(await operatorOf(req)) && !(await workerOf(req))) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const live = isLive;

  if (!live) {
    return NextResponse.json({ mode: "demo", asOf: demoNow(), sessions: DEMO_SESSIONS });
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
    if (Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), sessions: await client.sessions() };
    }
    return NextResponse.json({
      mode: "live",
      asOf: Math.floor(Date.now() / 1000),
      sessions: cache.sessions,
      // what the integration could not read, and which checks that disables
      degraded: client.degradations(),
    });
  } catch (e) {
    return NextResponse.json({ mode: "error", error: (e as Error).message, sessions: [] }, { status: 502 });
  }
}
