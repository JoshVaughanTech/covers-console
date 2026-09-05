/* ============================================================
   GET /api/employer/engagements — every engagement this venue is a
   party to, and the casual-conversion signals falling out of them.

   Operators only, and the mirror of /api/engagements: the same
   engagements, folded from the same chain, described by the same
   describeEngagement(). Two endpoints rather than one with a
   branch, because lib/auth's split is that a route names the kind
   of caller it accepts — a single handler that resolved a session
   and checked a field would authorise a worker's phone the day
   somebody forgot the check.

   The conversion signals are the part a venue cannot get anywhere
   else. It is the employer's obligation, and it is the employer
   that has just delegated its record-keeping here, so this is the
   only place the pattern is visible before somebody is at a
   tribunal describing it from memory.
   ============================================================ */
import { NextResponse } from "next/server";
import { operatorOf } from "@/lib/auth/session";
import { eventStore } from "@/lib/store/events";
import { replayEngagements } from "@/lib/idara/engagement";
import { describeEngagement, standingOfEngagement } from "@/lib/idara/engagement-view";
import { conversionSignals } from "@/lib/idara/conversion";
import { EMPLOYERS } from "@/lib/idara/employer-seed";
import { WORKERS } from "@/lib/idara/seed";
import { completedSessions } from "@/lib/integrations/clock";
import { timesheet } from "@/lib/shifts/timesheet";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const TZ = process.env.TZ_VENUE ?? "Australia/Melbourne";
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

export async function GET(req: Request) {
  if (!operatorOf(req)) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const employer = EMPLOYERS[0];
  const all = replayEngagements(eventStore().all(ORG));
  const mine = all.filter((e) => e.employerDid === employer.did || e.hostDid === employer.did);

  /* Real time, not the console's demo clock.

     TODAY is a fixture for credential expiry — it exists so a seeded RSA
     dated 2024 reads as current. Conversion is about how long a working
     relationship has actually run, measured against shift dates that are real
     moments (see lib/shifts/seed.ts on why those two calendars differ), so
     answering it against the fixture would report six months of service from a
     venue that opened last week. */
  const now = new Date().toISOString().slice(0, 10);

  /* What the time clock says about the ones that have already run.

     Read here rather than left to the confirm endpoint so the console can show
     the hours BEFORE anybody confirms them — a Confirm button with no figure
     behind it is asking somebody to agree to a number they cannot see. Keyed
     by engagement so the table row and the confirmation are looking at one
     answer from one read. */
  const nowSec = Math.floor(Date.now() / 1000);
  const { sessions, live: clockLive } = await completedSessions(nowSec);
  const sheet = timesheet({ engagements: mine, sessions, now: nowSec, timezone: TZ });
  const workedBy = new Map(sheet.worked.map((w) => [w.engagementId, w]));
  const unmatchedBy = new Map(sheet.unmatched.map((u) => [u.engagementId, u]));

  return NextResponse.json({
    employer: { did: employer.did, name: employer.tradingName },
    at: now,
    clockLive,
    engagements: mine
      .map((e) => {
        const w = workedBy.get(e.id);
        return {
          ...describeEngagement(e),
          standing: standingOfEngagement(e),
          worker: {
            did: e.workerDid,
            name: workerIndex.get(e.workerDid)?.name ?? e.workerDid,
            role: workerIndex.get(e.workerDid)?.role ?? "",
          },
          /* The clock's answer, or why there isn't one. Both are rendered:
             "no session against a shift that was agreed and has passed" is the
             row a venue most needs to see, and dropping it would make the
             screen calmest exactly when something is wrong. */
          worked: w
            ? {
                hours: w.hours,
                plannedHours: w.plannedHours,
                varianceHours: +(w.hours - w.plannedHours).toFixed(2),
                breaksTaken: w.breaksTaken,
                clockIn: w.clockIn,
                clockOut: w.clockOut,
                loading: w.loading,
                cost: w.cost,
                autoConfirmAt: w.autoConfirmAt,
                dueForAutoConfirm: w.dueForAutoConfirm,
                confirmable: e.status !== "confirmed",
              }
            : null,
          unmatched: unmatchedBy.get(e.id)?.reason ?? null,
        };
      })
      // newest first: an operator is looking at what just happened
      .reverse(),
    conversion: conversionSignals(mine, now).map((s) => ({
      ...s,
      workerName: workerIndex.get(s.workerDid)?.name ?? s.workerDid,
    })),
  });
}
