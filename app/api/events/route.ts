/* ============================================================
   GET  /api/events?since=N  — catch-up after a reconnect
   POST /api/events          — append one event to the chain

   The chain is the only durable state Covers owns. Reads return
   exactly what was hashed, so a client can run verifyChain() over
   the response and check the server's work rather than trust it.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import type { NewAuditEvent } from "@/lib/idara/audit";

export const dynamic = "force-dynamic";

/** Single-tenant for now; the store is keyed by org so this is the seam. */
const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get("since") ?? -1);
  const store = eventStore();
  return NextResponse.json({
    events: store.since(ORG, Number.isFinite(since) ? since : -1),
    head: store.head(ORG),
  });
}

export async function POST(req: Request) {
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
