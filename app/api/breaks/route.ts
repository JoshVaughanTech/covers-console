/* ============================================================
   GET /api/breaks — raw ShiftSessions for the Break Compliance board.
   Live when CONNECTEAM_API_KEY is set, demo seed otherwise. The
   award engine runs in the browser against these sessions so the
   clocks tick every second without re-hitting Connecteam.
   ============================================================ */
import { NextResponse } from "next/server";
import { DEMO_SESSIONS, demoNow } from "@/lib/awards";
import { ConnecteamClient } from "@/lib/integrations/connecteam";

export const dynamic = "force-dynamic";

let client: ConnecteamClient | null = null;
let cache: { at: number; sessions: unknown[] } = { at: 0, sessions: [] };
const TTL_MS = Number(process.env.CONNECTEAM_POLL_SECONDS ?? 30) * 1000;

export async function GET() {
  const key = process.env.CONNECTEAM_API_KEY;
  const live = Boolean(key && process.env.CONNECTEAM_TIME_CLOCK_ID);

  if (!live) {
    return NextResponse.json({ mode: "demo", asOf: demoNow(), sessions: DEMO_SESSIONS });
  }

  client ??= new ConnecteamClient({
    apiKey: key as string,
    timeClockId: process.env.CONNECTEAM_TIME_CLOCK_ID as string,
    schedulerId: process.env.CONNECTEAM_SCHEDULER_ID ?? null,
    timezone: process.env.TZ_VENUE ?? "Australia/Melbourne",
    siteName: process.env.CONNECTEAM_SITE_NAME ?? "",
  });

  try {
    if (Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), sessions: await client.sessions() };
    }
    return NextResponse.json({ mode: "live", asOf: Math.floor(Date.now() / 1000), sessions: cache.sessions });
  } catch (e) {
    return NextResponse.json({ mode: "error", error: (e as Error).message, sessions: [] }, { status: 502 });
  }
}
