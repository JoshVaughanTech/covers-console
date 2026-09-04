/* ============================================================
   GET  /api/notifications — what this worker has been told about
   POST /api/notifications — mark some or all of it seen

   Always about the caller, never about a did in the request. A route
   that took whose notifications to read would be a way to see what
   somebody else has been offered; one that took whose to CLEAR would
   be a way to hide a shift from them, with the badge being the only
   thing that would have said otherwise.

   Both are the same rule the shifts board follows, and both are
   cheap to get right here and impossible to retrofit once a client
   depends on passing a did.
   ============================================================ */
import { NextResponse } from "next/server";
import { notificationStore } from "@/lib/store/notifications";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const store = notificationStore();
  return NextResponse.json({
    offers: store.forWorker(ORG, caller.did),
    unseen: store.unseenCount(ORG, caller.did),
  });
}

export async function POST(req: Request) {
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { postingIds?: unknown };
  const ids = Array.isArray(body.postingIds)
    ? body.postingIds.filter((x): x is string => typeof x === "string")
    : undefined;

  const store = notificationStore();
  const seen = store.markSeen(ORG, caller.did, new Date().toISOString(), ids);
  return NextResponse.json({ seen, unseen: store.unseenCount(ORG, caller.did) });
}
