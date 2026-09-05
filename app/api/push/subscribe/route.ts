/* ============================================================
   POST   /api/push/subscribe — this device wants shift alerts
   DELETE /api/push/subscribe — it does not, or is signing out
   GET    /api/push/subscribe — the key to subscribe against

   Always the calling worker's own device. A route that took a did
   would let somebody register their phone to receive another
   person's shifts, which is both a leak and a way to make a
   colleague's phone silent by overwriting their subscription.

   The GET exists because the browser needs the VAPID public key
   before it can subscribe, and hardcoding it in client source means
   rotating the keypair requires a rebuild. It is a public key; there
   is nothing to protect.
   ============================================================ */
import { NextResponse } from "next/server";
import { pushStore } from "@/lib/store/push";
import { workerOf } from "@/lib/auth/session";
import { vapidFromEnv } from "@/lib/push/vapid";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  if (!(await workerOf(req))) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const keys = vapidFromEnv();
  // not configured is a fact the phone needs, so it can stop asking rather
  // than showing a button that cannot work
  return NextResponse.json({ available: Boolean(keys), publicKey: keys?.publicKey ?? null });
}

export async function POST(req: Request) {
  const caller = (await workerOf(req));
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!vapidFromEnv()) {
    return NextResponse.json({ error: "push is not configured on this server" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | null;

  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : null;
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : null;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint and keys are required" }, { status: 400 });
  }

  /* Only somewhere a push service lives. Without this the endpoint is an
     arbitrary URL the server will POST to on every posting — a request
     forgery primitive handed over by whoever can sign in on a phone. */
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return NextResponse.json({ error: "endpoint is not a URL" }, { status: 400 });
  }
  if (url.protocol !== "https:") {
    return NextResponse.json({ error: "endpoint must be https" }, { status: 400 });
  }

  (await pushStore()).save(
    ORG,
    { did: caller.did, endpoint, p256dh, auth },
    new Date().toISOString(),
  );

  return NextResponse.json({ subscribed: true, devices: (await pushStore()).countFor(ORG, caller.did) });
}

export async function DELETE(req: Request) {
  const caller = (await workerOf(req));
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });

  /* Scoped to this worker's own rows: the endpoint alone would let anyone
     signed in unsubscribe a device they had learned the endpoint of. */
  const mine = (await pushStore()).forWorker(ORG, caller.did).some((s) => s.endpoint === endpoint);
  if (!mine) return NextResponse.json({ removed: false });

  return NextResponse.json({ removed: (await pushStore()).remove(ORG, endpoint) });
}
