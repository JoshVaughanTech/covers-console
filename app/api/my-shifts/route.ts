/* ============================================================
   GET /api/my-shifts — the worker's own commitments.

   /api/shifts answers "what work is going?". This answers "what
   have I got on?", and they are different questions about the same
   board: one is discovery, the other is a diary. Keeping them apart
   is why the shift board no longer carries "You're on" and "Waiting
   on the manager" — one fact, one screen, so the two cannot show
   different counts for the same shift.

   THREE STATES, AND THE THIRD IS THE HONEST ONE.

   Upcoming and Applied are read from the board. Done is read from
   the TIME CLOCK — not from the board — and that distinction is the
   whole reason a Done tab is allowed to exist here at all. Being
   rostered on a shift that has now passed is not evidence anybody
   worked it; a clock-in is. So "done" means the clock says you were
   there, and a shift you were rostered for and did not attend never
   appears as work you did.

   That also makes this the first screen to tell a worker what the
   break rules earned them. assess() is the same function the venue's
   Break Board runs, so if the venue owes cl 16.6 loading, the person
   owed it can see the same figure rather than taking it on trust.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { boardFrom, describePay, seatsLeft } from "@/lib/shifts";
import { SITES } from "@/lib/idara/seed";
import { profileOf } from "@/lib/people";
import { assess, DEMO_WEEK, DEMO_WEEK_SESSIONS, fmtAud } from "@/lib/awards";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const TZ = process.env.TZ_VENUE ?? "Australia/Melbourne";
const FULL_WEEK_HOURS = 38;

const siteIndex = new Map(SITES.map((s) => [s.id, s]));

/**
 * The time clock keys people as "w:darie-roberts"; Idara keys them as
 * "did:web:idara.app:w:darie-roberts". One prefix apart, and the join is
 * written here rather than inline so the one place it happens is findable.
 */
const clockIdOf = (did: string) => did.replace(/^did:web:idara\.app:/, "");

export async function GET(req: Request) {
  const caller = (await workerOf(req));
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { did, person } = caller;
  const board = boardFrom((await (await eventStore()).all(ORG)));
  const profile = profileOf(did);
  const now = Math.floor(Date.now() / 1000);

  const mine = board.postings
    .filter((p) => p.status !== "draft")
    .map((p) => {
      const rostered = p.assigned.includes(did);
      // an open claim only: a refused one is not something they are waiting on
      const claim = p.claims.find((c) => c.did === did && !c.refused);
      const refused = p.claims.find((c) => c.did === did && c.refused);
      if (!rostered && !claim && !refused) return null;

      const pay = describePay(p);
      return {
        id: p.id,
        role: p.role,
        functionName: p.functionName,
        client: p.client ?? null,
        siteName: siteIndex.get(p.siteId)?.name ?? p.siteId,
        region: siteIndex.get(p.siteId)?.region ?? null,
        day: p.day,
        window: p.window,
        pay,
        /* Real moments where the posting has a rate, null where it has not.
           The countdown and the clock-in time both read off these, so a
           posting with no rate simply shows neither rather than a guess. */
        startsAt: p.pay?.startsAt ?? null,
        endsAt: p.pay?.endsAt ?? null,
        state: rostered ? ("confirmed" as const) : claim ? ("applied" as const) : ("declined" as const),
        claimedAt: claim?.at ?? refused?.at ?? null,
        declinedReason: refused?.refused ?? null,
        /* How many people are in front of them. Their own claim is included —
           "1 of 4" reads as the whole field, and "3 others" would need the
           reader to add themselves back in. */
        applicants: rostered ? null : p.claims.filter((c) => !c.refused).length,
        seats: p.seats,
        seatsLeft: seatsLeft(p),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // soonest first; anything without a time sinks below what has one
    .sort((a, b) => (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity));

  /* ---------- what they actually worked ----------

     Scoped to this person before anything else happens to it. The week feed
     is the whole venue, and /api/breaks/week is operators-only for exactly
     that reason; this returns one worker's own rows and nobody else's. */
  const clockId = clockIdOf(did);
  const done = DEMO_WEEK_SESSIONS.filter((s) => s.userId === clockId && s.clockOut != null)
    .map((s) => {
      const a = assess(s, now, { timezone: TZ });
      const worked = (s.clockOut as number) - s.clockIn;
      return {
        sessionId: `${s.userId}-${s.clockIn}`,
        role: s.role,
        siteName: s.siteName,
        clockIn: s.clockIn,
        clockOut: s.clockOut as number,
        hours: +(worked / 3600).toFixed(2),
        breaksTaken: s.breaks.filter((b) => b.end != null).length,
        /* What the award says the venue owes for a break they did not get.
           The same assess() the Break Board runs, so the person owed it reads
           the venue's own number rather than a second opinion. */
        owed:
          a.penalty && a.penalty.seconds > 0
            ? {
                clause: "16.6",
                minutes: Math.round(a.penalty.seconds / 60),
                amount: a.penalty.estimateAud != null ? fmtAud(Math.round(a.penalty.estimateAud * 100)) : null,
              }
            : null,
      };
    })
    .sort((x, y) => y.clockIn - x.clockIn);

  const upcoming = mine.filter((m) => m.state === "confirmed");
  const next = upcoming.find((m) => m.startsAt != null && m.startsAt > now) ?? null;

  return NextResponse.json({
    worker: { did, name: person.name, role: person.role },
    at: board.at,
    now,
    shifts: mine,
    done,
    /** the demo's completed week, so the screen can say which week "done" is. */
    doneWeek: { start: DEMO_WEEK.start, end: DEMO_WEEK.end },
    counts: {
      confirmed: upcoming.length,
      applied: mine.filter((m) => m.state === "applied").length,
      declined: mine.filter((m) => m.state === "declined").length,
      done: done.length,
    },
    nextStartsAt: next?.startsAt ?? null,
    hours: profile ? { thisWeek: profile.hoursThisWeek, fullWeek: FULL_WEEK_HOURS } : null,
  });
}
