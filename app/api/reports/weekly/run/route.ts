/* ============================================================
   POST /api/reports/weekly/run — build and deliver last week's
   break-loading report.

   The schedule lives outside the app, in whatever already runs on a
   timer: Task Scheduler, cron, a CI job. An in-process timer would
   die with the process, fire twice if it were restarted twice, and
   could not be tested without waiting.

   Authenticated with a shared token because this endpoint writes
   files, and the app is sometimes bound to 0.0.0.0 so a phone on the
   venue Wi-Fi can reach it. Open, it would let anyone on that
   network write into the payroll directory.
   ============================================================ */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eventStore } from "@/lib/store/events";
import { runWeeklyReport } from "@/lib/reports/weekly";
import { FileSink, MemorySink, type ReportSink } from "@/lib/reports/delivery";
import { lastCompleteWeek } from "@/lib/awards";
/* One reader of the time clock, shared with hour confirmation. Two callers
   deriving sessions for themselves would be two accounts of the same shift —
   one telling payroll what the venue owes, the other telling it what to pay. */
import { sessionsInWeek } from "@/lib/integrations/clock";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const TZ = process.env.TZ_VENUE ?? "Australia/Melbourne";

/** Constant-time compare, so the token cannot be guessed a character at a time. */
function tokenOk(given: string | null): boolean {
  const want = process.env.REPORTS_RUN_TOKEN;
  if (!want) return false;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!tokenOk(req.headers.get("x-run-token"))) {
    // 404 rather than 401: an unauthenticated caller learns nothing about
    // whether this endpoint exists or whether a token was merely wrong
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dir = process.env.REPORTS_DIR;
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  if (!dir && !dryRun) {
    return NextResponse.json(
      { error: "REPORTS_DIR is not set, so there is nowhere to deliver to" },
      { status: 500 },
    );
  }

  const sink: ReportSink = dryRun ? new MemorySink() : new FileSink(dir as string);
  const week = lastCompleteWeek(Math.floor(Date.now() / 1000), TZ);

  try {
    const result = await runWeeklyReport({
      store: eventStore(),
      orgId: ORG,
      sink,
      sessions: (await sessionsInWeek(week)).sessions,
      week,
      timezone: TZ,
      siteName: process.env.CONNECTEAM_SITE_NAME || null,
      // the token is not a person, so the run is nobody: the trigger goes in
      // data rather than a third kind of string in the actor slot
      trigger: "schedule",
    });

    return NextResponse.json({
      week: result.week,
      filename: result.filename,
      target: result.target,
      contentHash: result.contentHash,
      bytes: result.bytes,
      delivered: result.delivered,
      eventSeq: result.eventSeq,
      totals: result.report.totals,
      openShifts: result.report.openShifts,
      dryRun,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
