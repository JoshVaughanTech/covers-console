/* ============================================================
   The weekly run: build last week's loading report and deliver it.

   Deliberately not a timer inside the app. A setInterval dies with
   the process, runs twice if the process is restarted twice, and
   cannot be tested without waiting. This is a plain function a route
   calls, so the schedule lives where schedules belong — Task
   Scheduler, cron, a CI job — and the interesting part stays
   testable.

   Delivering a payroll figure is consequential, so the run writes to
   the audit chain like any other decision. The event carries the
   sha-256 of exactly what was delivered, which is what turns "we
   sent payroll a report" into "we sent payroll this report".
   ============================================================ */
import {
  weeklyReport,
  reportToCsv,
  csvFilename,
  lastCompleteWeek,
  type ShiftSession,
  type WeeklyBreakReport,
} from "@/lib/awards";
import type { EventStore } from "@/lib/store/events";
import type { DID } from "@/lib/idara/types";
import type { ReportSink } from "./delivery";

export interface WeeklyRunInput {
  store: EventStore;
  orgId: string;
  sink: ReportSink;
  sessions: ShiftSession[];
  /** defaults to the last completed Mon–Sun, which is what payroll processes */
  week?: { start: number; end: number };
  timezone?: string;
  siteName?: string | null;
  /** a person's name when someone asked for the run; omitted for a schedule */
  actor?: string;
  /**
   * That person, identified. A payroll document is exactly the kind of thing a
   * dispute turns on, and "who sent this" answered only by a display name is
   * answered weakly. Omitted for a scheduled run, which is nobody.
   */
  actorDid?: DID;
  /** what set the run off. A schedule firing is not a person deciding. */
  trigger?: "schedule" | "manual";
}

export interface WeeklyRunResult {
  week: { start: number; end: number; label: string };
  filename: string;
  target: string;
  contentHash: string;
  bytes: number;
  /** false when this exact report had already been delivered */
  delivered: boolean;
  report: WeeklyBreakReport;
  /** seq of the audit event, or null when the run changed nothing */
  eventSeq: number | null;
}

const TZ = "Australia/Melbourne";

export async function runWeeklyReport(input: WeeklyRunInput): Promise<WeeklyRunResult> {
  const tz = input.timezone ?? TZ;
  const week = input.week ?? lastCompleteWeek(Math.floor(Date.now() / 1000), tz);

  const report = weeklyReport(input.sessions, week.start, week.end, {
    timezone: tz,
    siteName: input.siteName ?? null,
  });
  const body = reportToCsv(report, tz);
  const filename = csvFilename(report, tz);

  const delivery = await input.sink.deliver(filename, body);

  /* Re-running a week that has not changed is a no-op, not a second delivery.
     Payroll receiving the same figures twice is confusing; an audit chain
     claiming two deliveries of one report is worse, because it is false. */
  if (!delivery.written) {
    return {
      week: { ...week, label: report.weekLabel },
      filename,
      target: delivery.target,
      contentHash: delivery.contentHash,
      bytes: delivery.bytes,
      delivered: false,
      report,
      eventSeq: null,
    };
  }

  const { event } = input.store.append(
    input.orgId,
    {
      type: "report.delivered",
      at: new Date().toISOString(),
      actor: input.actor ?? "system",
      // spread rather than assign: canonicalJson drops undefined keys but keeps
      // null ones, so an explicit absent-DID would alter the digest
      ...(input.actorDid ? { actorDid: input.actorDid } : {}),
      summary:
        `Break loading report for ${report.weekLabel} delivered — ` +
        `${report.totals.breaches} breach${report.totals.breaches === 1 ? "" : "es"}, ` +
        `${report.totals.loadingHours.toFixed(2)} loading hours` +
        (report.totals.pricedAud > 0 ? `, $${report.totals.pricedAud.toFixed(2)} priced` : ""),
      data: {
        trigger: input.trigger ?? "schedule",
        weekStart: week.start,
        weekEnd: week.end,
        weekLabel: report.weekLabel,
        siteName: report.siteName,
        filename,
        target: delivery.target,
        // what was delivered, not merely that something was
        contentHash: delivery.contentHash,
        bytes: delivery.bytes,
        breaches: report.totals.breaches,
        loadingHours: report.totals.loadingHours,
        pricedAud: report.totals.pricedAud,
        unpricedRows: report.totals.unpricedRows,
        unpricedHours: report.totals.unpricedHours,
        openShifts: report.openShifts,
      },
    },
    // one delivery per week per site, however many times the trigger fires
    { clientRef: `report:${report.siteName ?? "all"}:${week.start}` },
  );

  return {
    week: { ...week, label: report.weekLabel },
    filename,
    target: delivery.target,
    contentHash: delivery.contentHash,
    bytes: delivery.bytes,
    delivered: true,
    report,
    eventSeq: event.seq,
  };
}
