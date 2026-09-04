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
  if (!operatorOf(req)) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | (NewAuditEvent & { clientRef?: string })
    | null;

  if (!body?.type || !body.at || !body.actor || !body.summary) {
    return NextResponse.json(
      { error: "type, at, actor and summary are required" },
      { status: 400 },
    );
  }

  const { clientRef, ...ev } = body;
  const r = eventStore().append(ORG, ev, { clientRef });
  // 200 rather than 201 on a replay, so a retrying client can tell the
  // difference without it being an error
  return NextResponse.json(r, { status: r.created ? 201 : 200 });
}
