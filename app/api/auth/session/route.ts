/* ============================================================
   GET  /api/auth/session — who is holding this phone?
   POST /api/auth/session/signout is DELETE here: signing out is
   removing the session, and a verb is cheaper than another route.

   The phone asks this on load instead of reading a name out of
   localStorage. That is the whole change in one line: identity is
   now something the server answers, not something the device
   asserts.
   ============================================================ */
import { NextResponse } from "next/server";
import { workerOf, operatorOf, clearSessionCookie, secretOf } from "@/lib/auth/session";
import { authStore } from "@/lib/store/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* Asked separately rather than resolved once and labelled, so this route
     cannot become the place that hands a worker session to a console caller
     by reporting a kind and trusting whoever reads it. */
  const worker = workerOf(req);
  if (worker) {
    return NextResponse.json({
      signedIn: true,
      kind: "worker",
      worker: { did: worker.did, name: worker.person.name, role: worker.person.role },
    });
  }

  const op = operatorOf(req);
  if (op) {
    return NextResponse.json({
      signedIn: true,
      kind: "operator",
      operator: { did: op.did, name: op.operator.name, role: op.operator.role },
    });
  }

  return NextResponse.json({ signedIn: false }, { status: 200 });
}

export async function DELETE(req: Request) {
  const secret = secretOf(req);
  if (secret) authStore().revoke(secret);

  const res = NextResponse.json({ signedIn: false });
  // clear the cookie whether or not a session was found: a stale cookie that
  // resolves to nothing should still leave the device rather than linger
  clearSessionCookie(res, req);
  return res;
}
