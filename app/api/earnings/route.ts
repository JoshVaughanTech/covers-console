/* ============================================================
   GET /api/earnings — what this worker's clocked hours are worth.

   The screen it feeds is called Earnings and it must not pretend to
   be a payslip. Nothing in Covers records what a completed shift was
   PAID: the time clock records when somebody started and stopped,
   and the award says what those hours are worth as a minimum. So
   every figure is a floor, and the payload says so in a field the
   screen is obliged to render — `basis` — rather than leaving the
   distinction to a caption somebody might drop.

   No net, no tax, no super, no payment status. Those need the
   payroll connector layer, and a "net pay" figure Covers had not
   seen a payment for would be the single worst number on the phone:
   the one a worker would budget against.

   Scoped to the caller before anything else happens to it. The week
   feed is the whole venue, which is why /api/breaks/week is
   operators-only; this returns one person's own rows.
   ============================================================ */
import { NextResponse } from "next/server";
import { DEMO_WEEK, DEMO_WEEK_SESSIONS, earningsFor, fmtAud } from "@/lib/awards";
import { profileOf } from "@/lib/people";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const TZ = process.env.TZ_VENUE ?? "Australia/Melbourne";

/** The clock keys people as "w:darie-roberts"; Idara as "did:web:idara.app:w:…". */
const clockIdOf = (did: string) => did.replace(/^did:web:idara\.app:/, "");

export async function GET(req: Request) {
  const caller = await workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { did, person } = caller;
  const profile = profileOf(did);

  /* Without a recorded classification there is no lawful rate to price
     against, and a screen full of zeroes would read as "you earned nothing"
     rather than "nobody has recorded what you are classified as". */
  if (!profile) {
    return NextResponse.json({
      worker: { did, name: person.name, role: person.role },
      classified: false,
      reason: "No award classification on file for you. Your venue records this.",
      period: null,
    });
  }

  const clockId = clockIdOf(did);
  const mine = DEMO_WEEK_SESSIONS.filter((s) => s.userId === clockId);

  const period = earningsFor({
    sessions: mine,
    level: profile.award.level,
    employment: profile.award.employment,
    timezone: TZ,
  });

  return NextResponse.json({
    worker: { did, name: person.name, role: person.role },
    classified: true,
    award: {
      awardId: "MA000009",
      level: profile.award.level,
      levelLabel: profile.award.level === "introductory" ? "Introductory" : `Level ${profile.award.level}`,
      employment: profile.award.employment,
    },
    week: { start: DEMO_WEEK.start, end: DEMO_WEEK.end },
    /* The single most important field in this payload. The screen renders it
       verbatim; if it is ever dropped the numbers become a claim nobody
       checked. */
    basis: "award_floor_from_time_clock",
    period: {
      shifts: period.shifts.map((s) => ({
        id: s.id,
        role: s.role,
        siteName: s.siteName,
        clockIn: s.clockIn,
        clockOut: s.clockOut,
        paidHours: s.paidHours,
        unpaidBreakHours: s.unpaidBreakHours,
        /* Each row carries its own amount. Hours × rate does not reproduce it
           when a part-hour loading is involved, so the screen must render the
           subtotal rather than multiply — see EarnedBand. */
        bands: s.bands.map((b) => ({
          band: b.band,
          adder: b.adder,
          hours: b.hours,
          hourly: fmtAud(b.hourlyCents),
          hourlyCents: b.hourlyCents,
          amount: fmtAud(b.cents),
          cents: b.cents,
        })),
        award: fmtAud(s.awardCents),
        awardCents: s.awardCents,
        loading: s.loading ? { clause: s.loading.clause, hours: s.loading.hours, amount: fmtAud(s.loading.cents), cents: s.loading.cents } : null,
        total: fmtAud(s.totalCents),
        totalCents: s.totalCents,
      })),
      paidHours: period.paidHours,
      award: fmtAud(period.awardCents),
      awardCents: period.awardCents,
      loading: fmtAud(period.loadingCents),
      loadingCents: period.loadingCents,
      total: fmtAud(period.totalCents),
      totalCents: period.totalCents,
      /* Named rather than hidden: a total that quietly omits a shift is a
         wrong total that looks right. */
      unpriced: period.unpriced,
    },
    /** What this figure is not, carried with it so the screen cannot forget. */
    excludes: ["tax", "superannuation", "overtime", "allowances", "anything actually paid"],
  });
}
