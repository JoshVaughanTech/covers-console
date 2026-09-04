/* ============================================================
   GET  /api/events?since=N  — catch-up after a reconnect
   POST /api/events          — append one event to the chain

   Operators only, both verbs.

   The chain is the venue's compliance record: every break decision,
   every claim, every credential revocation, for everybody. Until
   console sign-in existed this route asked nothing at all, which was
   one open door among several while nobody had a session — and would
   have become the FIRST thing a worker reached after signing in on
   their phone. Shipping console auth that left this open would read
   as protected without being it.

   A worker's own history is a different feature and would be a
   scoped endpoint returning their events, not this one with a filter
   applied on the client.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { SEED_AUDIT_EVENTS } from "@/lib/idara/seed";
import { operatorOf } from "@/lib/auth/session";
import { notificationStore } from "@/lib/store/notifications";
import { offerPosting } from "@/lib/notify/offer";
import type { NewAuditEvent } from "@/lib/idara/audit";

export const dynamic = "force-dynamic";

/** Single-tenant for now; the store is keyed by org so this is the seam. */
const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  if (!operatorOf(req)) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const since = Number(new URL(req.url).searchParams.get("since") ?? -1);
  const store = eventStore();
  // a fresh database would otherwise serve an empty audit screen
  store.seedIfEmpty(ORG, SEED_AUDIT_EVENTS);
  return NextResponse.json({
    events: store.since(ORG, Number.isFinite(since) ? since : -1),
    head: store.head(ORG),
  });
}

export async function POST(req: Request) {
  // appending to the chain is a console act; the phone appends through the
  // endpoints that know what it is allowed to say
  const caller = operatorOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | (NewAuditEvent & { clientRef?: string })
    | null;

  if (!body?.type || !body.at || !body.summary) {
    return NextResponse.json({ error: "type, at and summary are required" }, { status: 400 });
  }

  const { clientRef, ...rest } = body;
  /* The actor is the session, not the body. Screens used to send
     CONSOLE_OPERATOR because there was nothing better to send; now there is,
     and a body that named somebody would be describing an operator nobody
     checked. Overriding here means no screen has to be updated to stop
     lying. */
  const ev: NewAuditEvent = {
    ...rest,
    actor: caller.operator.name,
    actorDid: caller.operator.did,
  };
  const r = eventStore().append(ORG, ev, { clientRef });

  /* A posting nobody hears about fills as slowly as no posting at all.

     Here rather than at the call site so every posting notifies, including
     one made by a screen nobody has written yet. Only on a genuinely new
     append: a replayed clientRef must not re-offer, or a retrying client
     would put the same shift on ten phones twice. */
  const offer = r.created ? offerPosting(eventStore(), notificationStore(), ORG, r.event) : null;

  return NextResponse.json({ ...r, ...(offer ? { offered: offer } : {}) }, { status: r.created ? 201 : 200 });
}
