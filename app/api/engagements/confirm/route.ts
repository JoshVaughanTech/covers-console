/* ============================================================
   POST /api/engagements/confirm — settle what was actually worked.

   The last transition, and the one money follows. Until now an
   engagement said what somebody was employed to do; this says what
   they did, reads it off the time clock, and writes it to the chain
   with the wages, super and booking fee it implies.

   TWO CALLERS, AND THEY ARE NOT THE SAME ACT.

   An operator confirming is the venue looking at a timesheet and
   agreeing with it. The scheduled sweep is a deadline passing —
   §5's 48-hour auto-confirm, which exists so a worker is not left
   unpaid by a manager on holiday. Both end with somebody paid and
   only one is anybody's affirmation, so `data.via` records which
   and the summary on the audit screen says so in words.

   THE HOURS ARE NEVER TAKEN FROM THE REQUEST. The body names an
   engagement; the hours come from the clock, matched here. A
   confirm endpoint that accepted a number would be a payroll input
   form with an audit chain attached, and the chain would faithfully
   record whatever was typed.

   Idempotent on the engagement, not on the caller: the clientRef is
   derived from the engagement id, so the venue confirming and the
   sweep arriving at the same moment produce one event rather than
   two. Whichever lands first is the one that counts, which is also
   the honest answer — if the venue confirmed, it confirmed.
   ============================================================ */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eventStore } from "@/lib/store/events";
import { operatorOf } from "@/lib/auth/session";
import { confirmedEvent, replayEngagements, type Engagement } from "@/lib/idara/engagement";
import { describeEngagement } from "@/lib/idara/engagement-view";
import { completedSessions } from "@/lib/integrations/clock";
import { dueForAutoConfirm, timesheet, type WorkedShift } from "@/lib/shifts/timesheet";
import type { EventStore } from "@/lib/store/events";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const TZ = process.env.TZ_VENUE ?? "Australia/Melbourne";

/** Constant-time compare, so the token cannot be guessed a character at a time. */
function tokenOk(given: string | null): boolean {
  const want = process.env.REPORTS_RUN_TOKEN;
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Write one confirmation. Returns the event and whether this call created it. */
function confirm(
  store: EventStore,
  worked: WorkedShift,
  input: { at: string; actor: string; actorDid?: string; via: "venue" | "auto" },
) {
  return store.append(
    ORG,
    confirmedEvent(worked.engagement, {
      at: input.at,
      actor: input.actor,
      ...(input.actorDid ? { actorDid: input.actorDid } : {}),
      hours: worked.hours,
      breaks: worked.breaksTaken,
      via: input.via,
      ...(worked.loading ? { loadingMinutes: worked.loading.minutes } : {}),
      ...(worked.loading?.estimateCents != null ? { loadingCents: worked.loading.estimateCents } : {}),
    }),
    /* Keyed on the engagement, so a second confirmation of the same shift is a
       no-op rather than a second invoice. This is the ref that matters most in
       the whole feature: everything upstream can be retried harmlessly, and
       this one bills somebody. */
    { clientRef: `engagement:confirmed:${worked.engagement.id}` },
  );
}

interface ConfirmBody {
  engagementId?: unknown;
}

export async function POST(req: Request) {
  const store = eventStore();
  const now = Math.floor(Date.now() / 1000);
  const at = new Date().toISOString();

  const engagements: Engagement[] = replayEngagements(store.all(ORG));
  const { sessions, live } = await completedSessions(now);
  const sheet = timesheet({ engagements, sessions, now, timezone: TZ });

  /* ---------- the scheduled sweep ---------- */

  if (tokenOk(req.headers.get("x-run-token"))) {
    const due = dueForAutoConfirm(sheet);
    const written = due.map((w) => {
      const r = confirm(store, w, { at, actor: "system", via: "auto" });
      return {
        engagementId: w.engagement.id,
        hours: w.hours,
        created: r.created,
        seq: r.event.seq,
      };
    });
    return NextResponse.json({
      via: "auto",
      clockLive: live,
      confirmed: written.filter((w) => w.created).length,
      alreadyConfirmed: written.filter((w) => !w.created).length,
      results: written,
    });
  }

  /* ---------- a venue confirming one shift ---------- */

  const caller = operatorOf(req);
  if (!caller) {
    // 404 for a bad token, 401 for no session: an unauthenticated caller with
    // a wrong token learns nothing about whether this endpoint exists
    return NextResponse.json(
      { error: req.headers.get("x-run-token") ? "not found" : "not signed in" },
      { status: req.headers.get("x-run-token") ? 404 : 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as ConfirmBody | null;
  const engagementId = typeof body?.engagementId === "string" ? body.engagementId : null;
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  const worked = sheet.worked.find((w) => w.engagement.id === engagementId);
  if (!worked) {
    /* Nothing to confirm is not the same as nothing to say. The venue is told
       WHY — no session against it, two candidates the clock cannot separate,
       or somebody still on the shift — because each of those is a different
       thing for a manager to go and do. */
    const unmatched = sheet.unmatched.find((u) => u.engagement.id === engagementId);
    const known = engagements.some((e) => e.id === engagementId);
    if (!known) return NextResponse.json({ error: "unknown engagement" }, { status: 404 });
    return NextResponse.json(
      {
        error:
          unmatched?.reason === "ambiguous"
            ? "The clock shows more than one shift that could be this one. Confirm it in the time clock first."
            : unmatched?.reason === "still_open"
              ? "That shift has no clock-out yet, so there are no final hours to confirm."
              : "The time clock has no completed shift matching this engagement.",
        kind: unmatched?.reason ?? "not_worked",
        candidates:
          unmatched?.candidates.map((c) => ({ clockIn: c.clockIn, clockOut: c.clockOut ?? null })) ?? [],
      },
      { status: 409 },
    );
  }

  if (worked.engagement.status === "confirmed") {
    return NextResponse.json({
      confirmed: true,
      created: false,
      engagement: describeEngagement(worked.engagement),
    });
  }

  const { event, created } = confirm(store, worked, {
    at,
    actor: caller.operator.name,
    actorDid: caller.operator.did,
    via: "venue",
  });

  const after = replayEngagements(store.all(ORG)).find((e) => e.id === engagementId);

  return NextResponse.json(
    {
      confirmed: true,
      created,
      clockLive: live,
      hours: worked.hours,
      plannedHours: worked.plannedHours,
      breaks: worked.breaksTaken,
      loading: worked.loading,
      cost: worked.cost,
      seq: event.seq,
      engagement: describeEngagement(after ?? worked.engagement),
    },
    { status: created ? 201 : 200 },
  );
}
